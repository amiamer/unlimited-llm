import { NextRequest } from 'next/server';
import { openRouterService, isChatModelKey } from '@/lib/llm-providers';
import { ChatRequest, Message } from '@/lib/types';
import { localStorageService } from '@/lib/local-storage';
import { loadAgentContext } from '@/lib/agent-context';
import { setToolContext, clearToolContext } from '@/lib/tool-context';

/**
 * Streaming Chat API endpoint (SSE)
 * POST /api/chat-stream
 *
 * Same logic as /api/chat but returns a ReadableStream of server-sent events.
 * Any OpenRouter model key works (Kiro is non-streaming). Tool calls are
 * collected from the stream and run; the final text streams token by token.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();

    if (!body.message || body.message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Message cannot be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userMessage = body.message.trim();

    if (userMessage.length > 500_000) {
      return new Response(
        JSON.stringify({ error: 'Message too long. Maximum length is 500,000 characters.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timestamp = new Date().toISOString();
    const sessionId = body.sessionId;
    const model = isChatModelKey(body.model) ? body.model : 'glm';

    const sessionMessages = body.sessionMessages || [];
    const sessionSummary = typeof body.sessionSummary === 'string' ? body.sessionSummary : undefined;
    const t0 = Date.now();
    const agentContext = await loadAgentContext({ userMessage });
    console.log(`[chat-stream] agent context loaded in ${Date.now() - t0}ms`);

    // Set tool context for scheduler (use Discord defaults from env so web can schedule too)
    const discordUserId = body.discordContext?.userId || process.env.DISCORD_DEFAULT_USER_ID || '';
    const discordChannelId = body.discordContext?.channelId || process.env.DISCORD_DEFAULT_CHANNEL_ID || '';
    if (discordUserId && discordChannelId) {
      setToolContext({ discordUserId, discordChannelId });
    }

    const userMessageObj: Message = {
      role: 'user',
      content: userMessage,
      timestamp,
    };

    const generator = openRouterService.getInstance(model).generateStreamingResponse(
      { userMessage, sessionMessages, agentContext, sessionSummary },
    );

    let fullContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          for await (const chunk of generator) {
            if (chunk.type === 'tool_results') {
              send('tool_results', chunk.data);
            } else if (chunk.type === 'text_delta') {
              fullContent += chunk.data;
              send('text_delta', { content: chunk.data });
            } else if (chunk.type === 'done') {
              send('done', { timestamp: chunk.data.timestamp });
              clearToolContext();

              // Persist conversation + session in the background
              const assistantMessage: Message = {
                role: 'assistant',
                content: fullContent,
                timestamp: chunk.data.timestamp,
              };
              const service = localStorageService();
              service.storeConversation([userMessageObj, assistantMessage]).catch((e) =>
                console.error('Failed to store conversation:', e),
              );
              if (sessionId) {
                const allMessages = [...sessionMessages, userMessageObj, assistantMessage];
                const sessionTitle =
                  allMessages.find((m) => m.role === 'user')?.content.substring(0, 50) || 'New Session';
                service.storeSession(sessionId, allMessages, sessionTitle, sessionSummary).catch((e) =>
                  console.error('Failed to store session:', e),
                );
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          send('error', { error: msg });
          clearToolContext();
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat stream API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: `Chat stream failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
