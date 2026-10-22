import { NextRequest, NextResponse } from 'next/server';
import { openRouterService, isChatModelKey } from '@/lib/llm-providers';
import { kiroService } from '@/lib/kiro-integration';
import { ChatRequest, ChatResponseWithTools, Message } from '@/lib/types';
import { localStorageService } from '@/lib/local-storage';
import { setToolContext, clearToolContext } from '@/lib/tool-context';
import { loadAgentContext } from '@/lib/agent-context';

// Rate limiting map: IP -> { count, resetTime }
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // 20 requests per minute per IP

/**
 * Discord Bot Chat API endpoint
 * POST /api/discord/chat
 * 
 * Security measures:
 * - API key authentication
 * - Rate limiting per IP
 * - Input validation
 * - No sensitive data exposure
 */
export async function POST(request: NextRequest) {
  try {
    // 1. API Key Authentication
    const apiKey = request.headers.get('x-discord-bot-key');
    const expectedKey = process.env.DISCORD_BOT_API_KEY;
    
    if (!expectedKey) {
      console.error('DISCORD_BOT_API_KEY not configured');
      return NextResponse.json(
        { error: 'Service misconfigured' },
        { status: 500 }
      );
    }
    
    if (!apiKey || apiKey !== expectedKey) {
      console.warn('Unauthorized Discord bot access attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Rate Limiting
    const clientIp = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     'unknown';
    
    const now = Date.now();
    const rateLimitData = rateLimitMap.get(clientIp);
    
    if (rateLimitData) {
      if (now < rateLimitData.resetTime) {
        if (rateLimitData.count >= RATE_LIMIT_MAX_REQUESTS) {
          return NextResponse.json(
            { error: 'Rate limit exceeded. Please try again later.' },
            { status: 429 }
          );
        }
        rateLimitData.count++;
      } else {
        // Reset window
        rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
      }
    } else {
      rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    }

    // Clean up old entries periodically
    if (rateLimitMap.size > 1000) {
      rateLimitMap.forEach((data, ip) => {
        if (now > data.resetTime) {
          rateLimitMap.delete(ip);
        }
      });
    }

    // 3. Input Validation
    const body: ChatRequest = await request.json();
    
    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: 'Invalid message format' },
        { status: 400 }
      );
    }

    const userMessage = body.message.trim();
    
    if (userMessage.length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    // Limit message length to prevent abuse
    if (userMessage.length > 4000) {
      return NextResponse.json(
        { error: 'Message too long (max 4000 characters)' },
        { status: 400 }
      );
    }

    // Validate model selection
    const allowedModels = ['glm', 'kimi', 'claude', 'gemini', 'gemini-pro', 'kiro'];
    const model = body.model && allowedModels.includes(body.model) ? body.model : 'glm';

    // Validate session messages array — bot handles token-based trimming, no arbitrary limit here
    const sessionMessages = Array.isArray(body.sessionMessages) ? body.sessionMessages : [];

    // Session summary from bot-side summarization of older messages
    const sessionSummary = typeof body.sessionSummary === 'string' ? body.sessionSummary : undefined;

    const timestamp = new Date().toISOString();
    const sessionId = body.sessionId;

    // Set Discord context for tool calls
    if (body.discordContext) {
      setToolContext({
        discordUserId: body.discordContext.userId,
        discordChannelId: body.discordContext.channelId,
      });
    }

    // Create user message
    const userMessageObj: Message = {
      role: 'user',
      content: userMessage,
      timestamp: timestamp
    };

    // Use the same compact, project-aware context contract as web chat.
    let agentContext;
    try {
      agentContext = await loadAgentContext({ userMessage });
    } catch (contextError) {
      console.warn('Failed to load agent context, using fallback identity:', contextError);
      agentContext = undefined;
    }

    // Call the selected model. Kiro (desktop only) and GLM fall back to Gemini Pro
    // through OpenRouter so the bot still replies.
    const llmRequest = { userMessage, sessionMessages, discordContext: body.discordContext, agentContext, sessionSummary };
    let llmResponse;
    try {
      try {
        llmResponse = model === 'kiro'
          ? await kiroService.generateResponse(llmRequest)
          : await openRouterService.generateResponse(llmRequest, isChatModelKey(model) ? model : 'glm');
      } catch (primaryError) {
        if (model !== 'kiro' && model !== 'glm' && model !== 'kimi') throw primaryError;
        console.warn(`${model} failed, falling back to Gemini Pro:`, primaryError instanceof Error ? primaryError.message : primaryError);
        llmResponse = await openRouterService.generateResponse(llmRequest, 'gemini-pro');
      }
    } catch (llmError) {
      console.error('LLM service error:', llmError);
      clearToolContext(); // Clean up context on error
      return NextResponse.json(
        { error: 'Failed to generate response' },
        { status: 500 }
      );
    }

    // Clear context after LLM call
    clearToolContext();

    // Create assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: llmResponse.content,
      timestamp: llmResponse.timestamp
    };

    // Store conversation turn to local storage (non-blocking)
    const conversationTurn: Message[] = [userMessageObj, assistantMessage];
    const service = localStorageService();
    service.storeConversation(conversationTurn).catch(error => {
      console.error('Failed to store conversation:', error);
    });

    // Session storage is handled by the Discord bot via PUT /api/sessions/[sessionId]
    // to ensure the full session (not just the trimmed context window) is persisted.

    // Return response (sanitize any sensitive data)
    const response: ChatResponseWithTools = {
      response: llmResponse.content,
      timestamp: llmResponse.timestamp,
      sessionId: sessionId || 'no-session',
      codeAnalysisCalls: llmResponse.codeAnalysisCalls,
      obsidianNoteCalls: llmResponse.obsidianNoteCalls,
      googleCalendarCalls: llmResponse.googleCalendarCalls,
      schedulerCalls: llmResponse.schedulerCalls,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Discord chat API error:', error);
    
    // Don't expose internal error details
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
