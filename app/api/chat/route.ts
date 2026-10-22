import { NextRequest, NextResponse } from 'next/server';
import { openRouterService, isChatModelKey } from '@/lib/llm-providers';
import { kiroService } from '@/lib/kiro-integration';
import { ChatRequest, ChatResponseWithTools, Message } from '@/lib/types';
import { localStorageService } from '@/lib/local-storage';
import { loadAgentContext } from '@/lib/agent-context';
import { setToolContext, clearToolContext } from '@/lib/tool-context';

/**
 * System prompt for reader-mode replies (annotation threads in the reader).
 * Deliberately contains NO personal context: the highlighted passage and the
 * reader's note are the whole world. Tone matches the main assistant.
 */
const READER_SYSTEM_PROMPT = `you are a sharp reading companion inside Amer's reader app. he highlights passages in articles and books, writes notes, and asks questions; you respond to the passage and his note.

rules:
- engage THE MATERIAL: explain, challenge, or extend the passage and his note. answer his actual question first.
- do NOT bring up his personal projects, work, goals, apps, or anything from outside the reading unless HIS NOTE explicitly mentions it. no "this connects to your project" tie-ins. if he wants a connection to his own life, he'll ask for it.
- examples and analogies are welcome — draw them from the material itself, history, or general knowledge.
- all lowercase, direct, no fluff, no flattery, no "great question". be willing to disagree with him bluntly.
- keep it compact: a few short paragraphs at most. end with a question only when it genuinely advances the thread, not as a habit.`;

// Rate limiting map: IP -> { count, resetTime }. The route is already gated by
// Clerk in middleware; this bounds runaway cost from a single authorized client.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // per IP per window

/**
 * Chat API endpoint
 * POST /api/chat
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = request.headers.get('x-forwarded-for') ||
                     request.headers.get('x-real-ip') ||
                     'unknown';
    const now = Date.now();
    const rl = rateLimitMap.get(clientIp);
    if (rl && now < rl.resetTime) {
      if (rl.count >= RATE_LIMIT_MAX_REQUESTS) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please try again later.' },
          { status: 429 }
        );
      }
      rl.count++;
    } else {
      rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    }
    if (rateLimitMap.size > 1000) {
      rateLimitMap.forEach((data, ip) => {
        if (now > data.resetTime) rateLimitMap.delete(ip);
      });
    }

    const body: ChatRequest = await request.json();
    
    if (!body.message || body.message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    const userMessage = body.message.trim();

    // Cap message length (500K chars ≈ 125K tokens): room for a whole
    // highlighted chapter in the reader, still inside Kimi's 262K fallback window.
    if (userMessage.length > 500_000) {
      return NextResponse.json(
        { error: 'Message too long. Maximum length is 500,000 characters.' },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString();
    const sessionId = body.sessionId;
    const model = body.model || 'glm'; // Default to GLM (glm-5.2)

    // Create user message
    const userMessageObj: Message = {
      role: 'user',
      content: userMessage,
      timestamp: timestamp
    };

    // Get session messages from frontend
    const sessionMessages = body.sessionMessages || [];

    // Session summary from frontend-side compaction of older messages
    const sessionSummary = typeof body.sessionSummary === 'string' ? body.sessionSummary : undefined;

    // Reader mode: replies to highlighted passages get a focused
    // reading-companion prompt and NO personal memory/vault context. The full
    // personal prompt made every reader reply drag Amer's current projects
    // into unrelated material ("your world dashboard…") — in the reader, the
    // material IS the context.
    const isReaderMode = body.mode === 'reader';

    // Reader mode stays context-free. Normal chat receives only the bounded,
    // curated agent layer plus deterministic project matches for this message.
    const agentContext = isReaderMode
      ? undefined
      : await loadAgentContext({ userMessage });

    const systemPromptOverride = isReaderMode ? READER_SYSTEM_PROMPT : undefined;

    // Set tool context for scheduler (use Discord defaults from env so web can schedule too)
    const discordUserId = body.discordContext?.userId || process.env.DISCORD_DEFAULT_USER_ID || '';
    const discordChannelId = body.discordContext?.channelId || process.env.DISCORD_DEFAULT_CHANNEL_ID || '';
    if (discordUserId && discordChannelId) {
      setToolContext({ discordUserId, discordChannelId });
    }

    // Call the selected model: Kiro on the desktop, everything else through OpenRouter
    const llmRequest = { userMessage, sessionMessages, agentContext, sessionSummary, systemPromptOverride };
    const llmResponse = model === 'kiro'
      ? await kiroService.generateResponse(llmRequest)
      : await openRouterService.generateResponse(llmRequest, isChatModelKey(model) ? model : 'glm');

    // Create assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: llmResponse.content,
      timestamp: llmResponse.timestamp
    };

    // Clear tool context after LLM call
    clearToolContext();

    // Store conversation turn to local storage
    const conversationTurn: Message[] = [userMessageObj, assistantMessage];
    const service = localStorageService();
    service.storeConversation(conversationTurn).catch(error => {
      console.error('Failed to store conversation:', error);
    });

    // Store session if sessionId provided
    if (sessionId) {
      const allMessages = [...sessionMessages, userMessageObj, assistantMessage];
      const sessionTitle = allMessages.find(m => m.role === 'user')?.content.substring(0, 50) || 'New Session';
      
      service.storeSession(sessionId, allMessages, sessionTitle, sessionSummary).catch(error => {
        console.error('Failed to store session:', error);
      });
    }

    // Return response with tool calls
    const response: ChatResponseWithTools = {
      response: llmResponse.content,
      timestamp: llmResponse.timestamp,
      sessionId: sessionId || 'no-session',
      codeAnalysisCalls: llmResponse.codeAnalysisCalls,
      obsidianNoteCalls: llmResponse.obsidianNoteCalls,
      googleCalendarCalls: llmResponse.googleCalendarCalls,
      schedulerCalls: llmResponse.schedulerCalls,
      shellCalls: llmResponse.shellCalls,
      gitCalls: llmResponse.gitCalls,
      selfEditCalls: llmResponse.selfEditCalls,
      searchCalls: llmResponse.searchCalls,
      gmailCalls: llmResponse.gmailCalls,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Chat API error:', error);
    clearToolContext();
    
    return NextResponse.json(
      { error: 'Chat request failed. Please try again.' },
      { status: 500 }
    );
  }
}
