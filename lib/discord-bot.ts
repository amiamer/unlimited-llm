/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client, GatewayIntentBits, Message as DiscordMessage } from 'discord.js';
import { Message } from '@/lib/types';
import { getScheduler } from '@/lib/discord-scheduler';
import { openRouterComplete } from '@/lib/llm-providers';
import * as fs from 'fs';
import * as path from 'path';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHAT_API_URL = process.env.DISCORD_CHAT_API_URL || 
  `http://localhost:${process.env.NEXT_DEV_PORT || '3000'}`;

interface DiscordBotConfig {
  token: string;
  chatApiUrl: string;
}

/** Persisted session state: messages + structured rolling summary */
interface SessionState {
  messages: Message[];
  summary: string | null;
  /** Timestamp of the last message in the session */
  lastMessageTime: string | null;
}

/** Directory for raw message archives — never deleted */
const RAW_ARCHIVE_DIR = path.join('./data', 'discord-archives');

/** Directory for summary metadata (not stored in backend session) */
const SUMMARY_DIR = path.join('./data', 'discord-summaries');

export class DiscordBot {
  private client: Client;
  private config: DiscordBotConfig;
  private sessions: Map<string, SessionState> = new Map();

  /**
   * Token budget for context sent to the LLM.
   * Gemini 2.5 Pro has 1M context. We cap at 32k to keep
   * costs reasonable and latency low. Summarization kicks in at 40k.
   */
  private static readonly CONTEXT_TOKEN_BUDGET = 32_000;
  private static readonly SUMMARIZE_TOKEN_THRESHOLD = 40_000;

  /** Sessions older than this are auto-reset (archive + clear). 24 hours. */
  private static readonly SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

  /** Approximate tokens from character count (1 token ≈ 4 chars) */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Estimate total tokens for a set of messages */
  private static estimateSessionTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + DiscordBot.estimateTokens(m.content) + 4, 0); // +4 per message for role/overhead
  }

  /**
   * Return the most recent messages that fit within a token budget.
   * Works backwards from the newest message, adding until the budget is exhausted.
   */
  private fitToTokenBudget(messages: Message[], tokenBudget: number): Message[] {
    let tokensUsed = 0;
    let startIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = DiscordBot.estimateTokens(messages[i].content) + 4;
      if (tokensUsed + msgTokens > tokenBudget) break;
      tokensUsed += msgTokens;
      startIndex = i;
    }

    return messages.slice(startIndex);
  }

  private processedMessages: Set<string> = new Set();
  private static readonly DEDUP_CACHE_SIZE = 100;
  private channelLocks: Map<string, Promise<void>> = new Map();
  private summarizing: Set<string> = new Set();

  constructor(config: DiscordBotConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.loadSummaries();
    this.setupEventHandlers();
  }

  /**
   * Headers for the shared session store. Includes the bot API key so the Clerk
   * middleware lets this headless process through to /api/sessions (the bot can't
   * do browser auth). Without it the request is redirected to /sign-in and the
   * bot silently loses shared context.
   */
  private sessionHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'ngrok-skip-browser-warning': 'true',
      'x-discord-bot-key': process.env.DISCORD_BOT_API_KEY || '',
      ...extra,
    };
  }

  /**
   * Load session from the shared backend (same storage as web UI).
   * Falls back to empty session if not found.
   */
  private async loadSessionFromBackend(sessionId: string): Promise<SessionState> {
    try {
      const response = await fetch(`${this.config.chatApiUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        headers: this.sessionHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        const messages: Message[] = data.messages || [];
        const lastMessageTime = messages.length > 0
          ? messages[messages.length - 1].timestamp
          : null;
        // Load summary from local file (summaries are Discord-specific metadata)
        const summary = this.loadSummary(sessionId);
        console.log(`[DISCORD] Loaded session ${sessionId} from backend: ${messages.length} messages`);
        return { messages, summary, lastMessageTime };
      }
    } catch (error) {
      console.warn(`[DISCORD] Failed to load session ${sessionId} from backend:`, error);
    }
    return { messages: [], summary: this.loadSummary(sessionId), lastMessageTime: null };
  }

  /**
   * Save session to the shared backend (same storage as web UI).
   */
  private async saveSessionToBackend(sessionId: string, session: SessionState): Promise<void> {
    try {
      // Use the chat API's internal session storage by calling the sessions endpoint
      // We POST the full session data
      const response = await fetch(`${this.config.chatApiUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        headers: this.sessionHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          messages: session.messages,
          title: session.messages.find(m => m.role === 'user')?.content.substring(0, 50) || 'Discord Session',
        }),
      });
      if (!response.ok) {
        console.warn(`[DISCORD] Backend session save returned ${response.status}`);
      }
    } catch (error) {
      console.warn(`[DISCORD] Failed to save session ${sessionId} to backend:`, error);
    }
    // Also save summary locally (summaries are Discord-specific)
    this.saveSummary(sessionId, session.summary);
  }

  /**
   * Load the most recent web session to seed Discord context.
   * Called when Discord session is empty/expired so the LLM knows
   * what was discussed on the web UI.
   */
  private async loadLatestWebSession(): Promise<{ messages: Message[]; sessionId: string } | null> {
    try {
      const response = await fetch(`${this.config.chatApiUrl}/api/sessions`, {
        headers: this.sessionHeaders(),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const sessions = data.sessions || [];
      if (sessions.length === 0) return null;

      // Sort by lastActivity descending, pick the most recent
      sessions.sort((a: any, b: any) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
      );
      const latest = sessions[0];

      // Only use if it's recent (within 24 hours)
      const age = Date.now() - new Date(latest.lastActivity).getTime();
      if (age > 24 * 60 * 60 * 1000) return null;

      // Load full session
      const sessionResponse = await fetch(
        `${this.config.chatApiUrl}/api/sessions/${encodeURIComponent(latest.sessionId)}`,
        { headers: this.sessionHeaders() },
      );
      if (!sessionResponse.ok) return null;
      const sessionData = await sessionResponse.json();
      console.log(`[DISCORD] Loaded latest web session ${latest.sessionId}: ${sessionData.messages?.length || 0} messages`);
      return { messages: sessionData.messages || [], sessionId: latest.sessionId };
    } catch (error) {
      console.warn('[DISCORD] Failed to load latest web session:', error);
      return null;
    }
  }

  /** Load summary metadata from local disk (Discord-specific, not shared) */
  private loadSummary(sessionId: string): string | null {
    try {
      const filePath = path.join(SUMMARY_DIR, `${sessionId}.txt`);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch {}
    return null;
  }

  /** Save summary metadata to local disk */
  private saveSummary(sessionId: string, summary: string | null): void {
    try {
      if (!fs.existsSync(SUMMARY_DIR)) {
        fs.mkdirSync(SUMMARY_DIR, { recursive: true });
      }
      const filePath = path.join(SUMMARY_DIR, `${sessionId}.txt`);
      if (summary) {
        const tmpFile = filePath + '.tmp';
        fs.writeFileSync(tmpFile, summary, 'utf-8');
        fs.renameSync(tmpFile, filePath);
      } else if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`[DISCORD] Failed to save summary for ${sessionId}:`, error);
    }
  }

  /** Load all summaries from disk on startup */
  private loadSummaries() {
    try {
      if (fs.existsSync(SUMMARY_DIR)) {
        const files = fs.readdirSync(SUMMARY_DIR).filter(f => f.endsWith('.txt'));
        console.log(`[DISCORD] Found ${files.length} summary file(s) on disk`);
      }
    } catch (error) {
      console.warn('[DISCORD] Error loading summaries:', error);
    }
  }

  /**
   * Get or load a session. Checks in-memory cache first, then backend.
   */
  private async getSession(sessionId: string): Promise<SessionState> {
    // Always reload from the shared backend so writes from the other surface
    // (the web chat) are reflected — 'main' is one shared stream, not bot-local
    // state. Every mutation is saved back to the backend right after, so a fresh
    // read here is always current. Falls back to any in-memory copy if the
    // backend read fails, so a transient network blip doesn't drop context.
    try {
      const session = await this.loadSessionFromBackend(sessionId);
      this.sessions.set(sessionId, session);
      return session;
    } catch {
      const cached = this.sessions.get(sessionId);
      if (cached) return cached;
      const empty = await this.loadSessionFromBackend(sessionId);
      this.sessions.set(sessionId, empty);
      return empty;
    }
  }

  private setupEventHandlers() {
    this.client.on('ready', () => {
      console.log(`Discord bot logged in as ${this.client.user?.tag}`);
      const scheduler = getScheduler();
      scheduler.setDiscordClient(this.client);
      scheduler.start();
    });

    this.client.on('messageCreate', async (message: DiscordMessage) => {
      const channelId = message.channelId;
      const prev = this.channelLocks.get(channelId) || Promise.resolve();
      const current = prev.then(() => this.handleMessage(message)).catch(() => {});
      this.channelLocks.set(channelId, current);
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });
  }

  private async handleMessage(message: DiscordMessage) {
    if (message.author.bot) return;
    if (!message.content || message.content.trim().length === 0) return;

    // Deduplicate
    if (this.processedMessages.has(message.id)) {
      console.log(`[DISCORD] Skipping duplicate message ${message.id}`);
      return;
    }
    this.processedMessages.add(message.id);
    if (this.processedMessages.size > DiscordBot.DEDUP_CACHE_SIZE) {
      const first = this.processedMessages.values().next().value;
      if (first) this.processedMessages.delete(first);
    }

    console.log(`Received message from ${message.author.tag}: ${message.content}`);

    // --- Session management commands (no LLM call needed) ---
    const trimmed = message.content.trim().toLowerCase();

    if (trimmed === '!reset' || trimmed === '!clear') {
      const sessionId = 'main';
      const session = await this.getSession(sessionId);
      if (session.messages.length > 0 || session.summary) {
        // Archive before wiping so nothing is lost
        if (session.messages.length > 0) {
          this.archiveRawMessages(sessionId, session.messages);
        }
        session.messages = [];
        session.summary = null;
        session.lastMessageTime = null;
        this.sessions.set(sessionId, session);
        this.saveSessionToBackend(sessionId, session).catch(() => {});
        await message.reply('context cleared — starting fresh. my memory (personality, learnings, etc.) is still intact, just the conversation history for this channel is gone.');
      } else {
        await message.reply('nothing to clear — this channel already has a fresh context.');
      }
      return;
    }

    if (trimmed === '!status') {
      const sessionId = 'main';
      const session = await this.getSession(sessionId);
      if (session.messages.length === 0 && !session.summary) {
        await message.reply('this channel has no conversation history.');
        return;
      }
      const msgCount = session.messages.length;
      const tokenEst = DiscordBot.estimateSessionTokens(session.messages);
      const hasSummary = session.summary ? `yes (${session.summary.length} chars)` : 'no';
      const lastMsg = session.lastMessageTime
        ? `${this.formatTimeGap(session.lastMessageTime)} ago`
        : 'unknown';
      await message.reply(
        `**context status**\n` +
        `messages: ${msgCount} (~${tokenEst.toLocaleString()} tokens)\n` +
        `summary: ${hasSummary}\n` +
        `last message: ${lastMsg}\n` +
        `budget: ${DiscordBot.CONTEXT_TOKEN_BUDGET.toLocaleString()} tokens\n` +
        `summarize threshold: ${DiscordBot.SUMMARIZE_TOKEN_THRESHOLD.toLocaleString()} tokens`
      );
      return;
    }

    try {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      // Model selection — GLM default (glm-5.2), prefix overrides for others.
      // Use !kiro / !claude / !kimi / !gemini explicitly to switch models.
      let model = 'glm';
      let userMessage = message.content;

      if (message.content.startsWith('!glm ')) {
        model = 'glm';
        userMessage = message.content.substring(5);
      } else if (message.content.startsWith('!claude ')) {
        model = 'claude';
        userMessage = message.content.substring(8);
      } else if (message.content.startsWith('!kimi ')) {
        model = 'kimi';
        userMessage = message.content.substring(6);
      } else if (message.content.startsWith('!pro ')) {
        model = 'claude';  // Claude as the "pro" heavy-hitter model
        userMessage = message.content.substring(5);
      } else if (message.content.startsWith('!gemini-pro ')) {
        model = 'gemini-pro';
        userMessage = message.content.substring(12);
      } else if (message.content.startsWith('!gemini ')) {
        model = 'gemini';
        userMessage = message.content.substring(8);
      } else if (message.content.startsWith('!kiro ')) {
        model = 'kiro';
        userMessage = message.content.substring(6);
      }

      // ONE shared chat stream across surfaces: Discord and the web chat tab both
      // read/write the same 'main' session in /api/sessions, so they share a single
      // conversation history and context window (not two separate sessions).
      const sessionId = 'main';
      const session = await this.getSession(sessionId);

      // Auto-expire stale sessions (>24h since last message)
      // Archives old messages, clears history, but preserves summary for continuity
      if (session.lastMessageTime) {
        const staleMs = Date.now() - new Date(session.lastMessageTime).getTime();
        if (staleMs > DiscordBot.SESSION_EXPIRY_MS && session.messages.length > 0) {
          console.log(`[DISCORD] Session ${sessionId} expired (${Math.round(staleMs / 3600000)}h stale). Auto-resetting.`);
          
          // If no summary exists yet, generate one from the messages being archived
          if (!session.summary && session.messages.length >= 4) {
            // Build a quick summary synchronously from the archived messages
            const archiveText = session.messages.map(m => {
              const label = m.role === 'user' ? 'Amer' : 'Assistant';
              return `${label}: ${m.content}`;
            }).join('\n');
            session.summary = `[Auto-archived ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}]\n${archiveText.slice(0, 3000)}`;
            console.log(`[DISCORD] No existing summary — preserved raw messages as summary (${session.summary.length} chars)`);
          }
          
          this.archiveRawMessages(sessionId, session.messages);
          session.messages = [];
          // Keep summary and lastMessageTime so the LLM has continuity
        }
      }

      // If Discord session is empty, seed from the latest web session for cross-platform continuity
      if (session.messages.length === 0 && !session.summary) {
        const webSession = await this.loadLatestWebSession();
        if (webSession && webSession.messages.length > 0) {
          console.log(`[DISCORD] Seeding Discord context from web session ${webSession.sessionId} (${webSession.messages.length} messages)`);
          session.messages = webSession.messages;
          session.lastMessageTime = webSession.messages[webSession.messages.length - 1].timestamp;
          this.sessions.set(sessionId, session);
        }
      }

      // Compute time since last message for the LLM
      const lastMsgTime = session.lastMessageTime;

      // Prepare what to send: fit as many recent messages as the token budget allows
      const recentMessages = this.fitToTokenBudget(session.messages, DiscordBot.CONTEXT_TOKEN_BUDGET);

      // Build session summary with time gap info
      let enrichedSummary = session.summary || undefined;
      if (lastMsgTime) {
        const gap = this.formatTimeGap(lastMsgTime);
        const timeContext = `[Last message was ${gap} ago, at ${new Date(lastMsgTime).toLocaleString('en-US', { timeZone: 'America/Chicago' })}]`;
        enrichedSummary = enrichedSummary 
          ? `${timeContext}\n\n${enrichedSummary}`
          : timeContext;
      }

      console.log(`Calling chat API at: ${this.config.chatApiUrl}/api/discord/chat`);
      console.log(`Model: ${model}, Message: ${userMessage}, History: ${recentMessages.length} msgs (~${DiscordBot.estimateSessionTokens(recentMessages)} tok), Summary: ${session.summary ? 'yes' : 'no'}`);

      const response = await fetch(`${this.config.chatApiUrl}/api/discord/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'x-discord-bot-key': process.env.DISCORD_BOT_API_KEY || 'default-key',
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId,
          sessionMessages: recentMessages,
          sessionSummary: enrichedSummary,
          model,
          discordContext: {
            userId: message.author.id,
            channelId: message.channelId,
          },
        }),
      });

      console.log(`Chat API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Chat API error response: ${errorText}`);
        throw new Error(`Chat API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log(`Received response, length: ${data.response?.length || 0}`);

      const now = new Date().toISOString();

      const userMessageObj: Message = {
        role: 'user',
        content: userMessage,
        timestamp: now,
      };
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response,
        timestamp: data.timestamp,
      };

      session.messages.push(userMessageObj, assistantMessage);
      session.lastMessageTime = now;
      // Save to shared backend (same storage as web UI) — non-blocking
      this.saveSessionToBackend(sessionId, session).catch(error => {
        console.warn(`[DISCORD] Background session save failed:`, error);
      });

      console.log('Sending response to Discord...');
      await this.sendLongMessage(message.channel, data.response);
      console.log('Response sent successfully');

      // Summarize in background AFTER response is sent and session is saved
      // This way the new messages are included and there's no race with the push above
      this.maybeSummarize(sessionId, session).catch(error => {
        console.error(`[DISCORD] Background summarization failed for ${sessionId}:`, error);
      });

    } catch (error) {
      console.error('Error handling Discord message:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (!errorMsg.includes('Unexpected token') && !errorMsg.includes('not valid JSON')) {
        // Sanitize error — don't leak internal details to Discord
        const safeMsg = errorMsg.includes('Rate limit') ? 'rate limited, try again in a moment'
          : errorMsg.includes('timeout') || errorMsg.includes('Timeout') ? 'request timed out, try again'
          : errorMsg.includes('401') || errorMsg.includes('Unauthorized') ? 'authentication issue on my end'
          : 'something went wrong on my end, try again in a sec';
        await message.reply(`sorry, ${safeMsg}`);
      }
    }
  }

  /**
   * Format a time gap between now and a past ISO timestamp into human-readable form.
   */
  private formatTimeGap(isoTimestamp: string): string {
    const then = new Date(isoTimestamp).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'less than a minute';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  /**
   * Archive raw messages to disk before they get summarized away.
   * These are never deleted — they're the ground truth if the summary loses something.
   */
  private archiveRawMessages(sessionId: string, messages: Message[]) {
    try {
      if (!fs.existsSync(RAW_ARCHIVE_DIR)) {
        fs.mkdirSync(RAW_ARCHIVE_DIR, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${sessionId}_${timestamp}.json`;
      const filePath = path.join(RAW_ARCHIVE_DIR, filename);
      const tmpFile = filePath + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(messages, null, 2), 'utf-8');
      fs.renameSync(tmpFile, filePath);
      console.log(`[DISCORD] Archived ${messages.length} raw messages to ${filename}`);
    } catch (error) {
      console.error('[DISCORD] Failed to archive raw messages:', error);
    }
  }

  /**
   * Summarize older messages through OpenRouter (default model).
   * 
   * Strategy:
   * 1. Archive raw messages to disk (never lost)
   * 2. Use local LLM to produce a structured summary (topics, decisions, tasks, key facts)
   * 3. Run a separate key facts extraction pass
   * 4. Replace old messages with summary + recent window
   */
  private async maybeSummarize(sessionId: string, session: SessionState): Promise<void> {
    const totalTokens = DiscordBot.estimateSessionTokens(session.messages);
    if (totalTokens <= DiscordBot.SUMMARIZE_TOKEN_THRESHOLD) return;
    if (this.summarizing.has(sessionId)) return;

    this.summarizing.add(sessionId);
    try {
      // Keep messages that fit in the token budget, summarize the rest
      const recentMessages = this.fitToTokenBudget(session.messages, DiscordBot.CONTEXT_TOKEN_BUDGET);
      const cutoff = session.messages.length - recentMessages.length;
      const messagesToSummarize = session.messages.slice(0, cutoff);

      if (messagesToSummarize.length === 0) return;

      // 1. Archive raw messages before they leave the session
      this.archiveRawMessages(sessionId, messagesToSummarize);

      // 2. Build conversation text for summarization
      let conversationText = '';
      if (session.summary) {
        conversationText += `PREVIOUS SUMMARY:\n${session.summary}\n\n`;
        conversationText += 'NEW MESSAGES TO INCORPORATE:\n';
      }
      for (const msg of messagesToSummarize) {
        const label = msg.role === 'user' ? 'Amer' : 'Assistant';
        const time = msg.timestamp ? ` [${new Date(msg.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}]` : '';
        conversationText += `${label}${time}: ${msg.content}\n\n`;
      }

      console.log(`[DISCORD] Summarizing ${messagesToSummarize.length} messages for session ${sessionId} using local LLM`);

      // 3. Structured summarization
      const summaryPrompt = `Summarize this conversation between Amer and his AI assistant. This summary maintains context for an ongoing conversation.

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
- Keep total under 600 words.
- Use third person ("Amer said...", "The assistant suggested...").
- Preserve specific details. Do not generalize.
- If something was corrected, only keep the final version.

CONVERSATION:
${conversationText}`;

      let newSummary: string;
      try {
        newSummary = await openRouterComplete(summaryPrompt, {
          system: 'You are a precise conversation summarizer. Output only the structured summary, nothing else.',
        });
      } catch (error) {
        console.warn(`[DISCORD] Summarization failed, skipping:`, error);
        return;
      }

      if (!newSummary || newSummary.trim().length === 0) {
        console.warn('[DISCORD] Summarization returned empty result, skipping');
        return;
      }

      // Update session — re-slice to preserve any messages that arrived during summarization
      const newMessagesDuringLLM = session.messages.length - (messagesToSummarize.length + recentMessages.length);
      session.summary = newSummary.trim();
      if (newMessagesDuringLLM > 0) {
        // Messages were added while we were summarizing — keep recent window + new arrivals
        session.messages = session.messages.slice(cutoff);
        console.log(`[DISCORD] ${newMessagesDuringLLM} messages arrived during summarization, preserved them`);
      } else {
        session.messages = recentMessages;
      }
      this.saveSessionToBackend(sessionId, session).catch(error => {
        console.warn(`[DISCORD] Background session save after summarization failed:`, error);
      });

      console.log(`[DISCORD] Summarized session ${sessionId}: ${messagesToSummarize.length} msgs (~${DiscordBot.estimateSessionTokens(messagesToSummarize)} tok) → ${newSummary.length} char summary, ${recentMessages.length} msgs (~${DiscordBot.estimateSessionTokens(recentMessages)} tok) kept`);

    } catch (error) {
      console.error(`[DISCORD] Summarization failed for ${sessionId}:`, error);
    } finally {
      this.summarizing.delete(sessionId);
    }
  }

  private async sendLongMessage(channel: any, content: string) {
    const MAX_LENGTH = 2000;

    if (content.length <= MAX_LENGTH) {
      await channel.send(content);
      return;
    }

    const chunks: string[] = [];
    let currentChunk = '';
    let inCodeBlock = false;
    let codeBlockLang = '';

    const lines = content.split('\n');
    for (const line of lines) {
      // Track code block state
      if (line.trimStart().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.trimStart().slice(3).trim();
        } else {
          inCodeBlock = false;
        }
      }

      if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
        // If we're inside a code block, close it before splitting
        if (inCodeBlock) {
          currentChunk += '\n```';
        }
        chunks.push(currentChunk);
        // Re-open the code block in the next chunk
        currentChunk = inCodeBlock ? `\`\`\`${codeBlockLang}\n${line}` : line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  async start() {
    if (!this.config.token) {
      throw new Error('Discord bot token is not configured');
    }

    try {
      await this.client.login(this.config.token);
    } catch (error) {
      if (error instanceof Error && error.message.includes('disallowed intents')) {
        throw new Error(
          'Discord bot intents not enabled. Please enable "Message Content Intent" in Discord Developer Portal:\n' +
          '1. Go to https://discord.com/developers/applications\n' +
          '2. Select your application\n' +
          '3. Go to "Bot" section\n' +
          '4. Enable "Message Content Intent" under Privileged Gateway Intents\n' +
          '5. Save changes and try again'
        );
      }
      throw error;
    }
  }

  async stop() {
    const scheduler = getScheduler();
    scheduler.stop();
    await this.client.destroy();
  }
}

// Create and export bot instance
export function createDiscordBot(): DiscordBot {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN environment variable is not set');
  }

  return new DiscordBot({
    token: DISCORD_BOT_TOKEN,
    chatApiUrl: CHAT_API_URL,
  });
}
