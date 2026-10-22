import { NextRequest, NextResponse } from 'next/server';
import { openRouterComplete, isChatModelKey } from '@/lib/llm-providers';
import { Message } from '@/lib/types';
import { localStorageService } from '@/lib/local-storage';
import { LocalObsidianService } from '@/lib/local-storage/local-obsidian-service';

/**
 * POST /api/chat/compact
 *
 * Compacts a web chat session by summarizing older messages using the
 * currently-selected model (same one the user is chatting with).
 *
 * Flow:
 * 1. Receive all messages + which ones to keep (recent window)
 * 2. Summarize the older messages using the selected model
 * 3. Save the summary to Obsidian as a compacted-session note
 * 4. Update the session file with summary + trimmed messages
 * 5. Return the summary + trimmed messages to the frontend
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sessionId,
      messages,
      keepCount,
      model,
      existingSummary,
      sessionTitle,
    }: {
      sessionId: string;
      messages: Message[];
      keepCount: number;
      model: string;
      existingSummary?: string;
      sessionTitle?: string;
    } = body;

    if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'sessionId and messages are required' },
        { status: 400 },
      );
    }

    // Split messages: older ones to summarize, recent ones to keep
    const cutoff = Math.max(0, messages.length - keepCount);
    const messagesToSummarize = messages.slice(0, cutoff);
    const recentMessages = messages.slice(cutoff);

    if (messagesToSummarize.length === 0) {
      return NextResponse.json({
        summary: existingSummary || null,
        messages: recentMessages,
        compacted: false,
      });
    }

    // Build conversation text for summarization
    let conversationText = '';
    if (existingSummary) {
      conversationText += `PREVIOUS SUMMARY:\n${existingSummary}\n\n`;
      conversationText += 'NEW MESSAGES TO INCORPORATE:\n';
    }
    for (const msg of messagesToSummarize) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      const time = msg.timestamp
        ? ` [${new Date(msg.timestamp).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            hour: 'numeric',
            minute: '2-digit',
            month: 'short',
            day: 'numeric',
            hour12: true,
          })}]`
        : '';
      conversationText += `${label}${time}: ${msg.content}\n\n`;
    }

    const summaryPrompt = `Summarize this conversation. This summary will maintain context for an ongoing conversation session.

OUTPUT FORMAT (use these exact headers):

TOPICS:
- main topics covered (1 line each)

KEY FACTS & DECISIONS:
- specific facts, preferences, decisions, or conclusions
- preserve names, dates, numbers exactly

TASKS:
- anything to track, follow up on, or remind about (include deadlines if mentioned)

OPEN THREADS:
- topics started but not finished

RULES:
- If there is a PREVIOUS SUMMARY, merge new info into it. Don't repeat what's already covered.
- Keep total under 800 words.
- Preserve specific details — do not generalize.
- If something was corrected, only keep the final version.

CONVERSATION:
${conversationText}`;

    // Use the same model the user is chatting with to generate the summary
    let summaryContent: string;
    try {
      summaryContent = await openRouterComplete(summaryPrompt, {
        model: isChatModelKey(model) ? model : 'glm',
        system: 'You are a precise conversation summarizer. Output only the structured summary, nothing else.',
      });
    } catch (error) {
      console.error('[compact] Summarization failed:', error);
      return NextResponse.json(
        { error: 'Failed to generate summary' },
        { status: 500 },
      );
    }

    if (!summaryContent || summaryContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'Summary generation returned empty result' },
        { status: 500 },
      );
    }

    const trimmedSummary = summaryContent.trim();

    // Save to Obsidian
    try {
      const obsidian = await LocalObsidianService.create();
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const title = sessionTitle
        ? `compacted-sessions/compacted-${sessionTitle.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 40)}-${dateStr}`
        : `compacted-sessions/compacted-session-${dateStr}`;

      const noteContent = `# Session Compaction — ${now.toLocaleString('en-US', { timeZone: 'America/Chicago' })}

**Session:** ${sessionId}
**Messages summarized:** ${messagesToSummarize.length}
**Messages kept:** ${recentMessages.length}
**Model:** ${model}

---

${trimmedSummary}
`;
      const filename = await obsidian.createNote(title, noteContent);
      console.log(`[compact] Saved compaction note to Obsidian: ${filename}`);
    } catch (error) {
      // Non-fatal — log but don't fail the compaction
      console.warn('[compact] Failed to save compaction note to Obsidian:', error);
    }

    // Update the session file with summary + trimmed messages
    try {
      const service = localStorageService();
      const sessionTitleFinal = sessionTitle
        || recentMessages.find((m) => m.role === 'user')?.content.substring(0, 50)
        || 'Compacted Session';
      await service.storeSession(sessionId, recentMessages, sessionTitleFinal, trimmedSummary);
    } catch (error) {
      console.warn('[compact] Failed to update session file:', error);
    }

    console.log(
      `[compact] Session ${sessionId}: ${messagesToSummarize.length} msgs compacted → ${trimmedSummary.length} char summary, ${recentMessages.length} msgs kept`,
    );

    return NextResponse.json({
      summary: trimmedSummary,
      messages: recentMessages,
      compacted: true,
      summarizedCount: messagesToSummarize.length,
      keptCount: recentMessages.length,
    });
  } catch (error) {
    console.error('[compact] API error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Compaction failed: ${msg}` }, { status: 500 });
  }
}
