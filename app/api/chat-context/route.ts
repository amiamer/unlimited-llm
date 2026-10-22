import { NextResponse } from 'next/server';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { loadAgentContext } from '@/lib/agent-context';

/**
 * GET /api/chat-context
 * Returns the current system prompt and safe metadata for the context panel.
 */
export async function GET() {
  try {
    const agentContext = await loadAgentContext({ userMessage: '' });
    const systemPrompt = buildSystemPrompt({ agentContext });

    return NextResponse.json({
      systemPrompt,
      systemPromptLength: systemPrompt.length,
      systemPromptTokenEstimate: Math.ceil(systemPrompt.length / 4),
      agentContext: {
        totalChars: agentContext.totalChars,
        tokenEstimate: Math.ceil(agentContext.totalChars / 4),
        matchedProjects: agentContext.matchedProjects,
        missing: agentContext.missing,
        warnings: agentContext.warnings,
        sources: agentContext.sources.map((source) => ({
          path: source.path,
          kind: source.kind,
          chars: source.content.length,
          truncated: source.truncated,
        })),
      },
    });
  } catch (error) {
    console.error('Context API error:', error);
    return NextResponse.json(
      { error: 'Failed to load context' },
      { status: 500 },
    );
  }
}
