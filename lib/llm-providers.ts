/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LLM provider: OpenRouter.
 *
 * One OpenAI-compatible adapter for every model. The chat picker's model keys
 * (glm, claude, gemini, ...) map to OpenRouter model ids, each overridable with
 * an env var, so adding or swapping a model is a config change, not new code.
 * Kiro stays separate (lib/kiro-integration.ts) and only runs on the desktop.
 */

import OpenAI from 'openai';
import { Message, CodeAnalysisCall, ObsidianNoteCall, GoogleCalendarCall, SchedulerCall, ShellCall, GitCall, SelfEditCall, SearchCall, GmailCall } from './types';
import { LLMProvider, LLMRequest, LLMResponse } from './llm-service';
import { toOpenAITools, executeTool } from './tool-registry';
import { buildSystemPrompt } from './system-prompt';
import type { AgentContextBundle } from './agent-context';

// ─── Shared Helpers ──────────────────────────────────────────────────────────

interface ToolCallTracker {
  codeAnalysisCalls: CodeAnalysisCall[];
  obsidianNoteCalls: ObsidianNoteCall[];
  googleCalendarCalls: GoogleCalendarCall[];
  schedulerCalls: SchedulerCall[];
  shellCalls: ShellCall[];
  gitCalls: GitCall[];
  selfEditCalls: SelfEditCall[];
  searchCalls: SearchCall[];
  gmailCalls: GmailCall[];
}

function createTracker(): ToolCallTracker {
  return {
    codeAnalysisCalls: [],
    obsidianNoteCalls: [],
    googleCalendarCalls: [],
    schedulerCalls: [],
    shellCalls: [],
    gitCalls: [],
    selfEditCalls: [],
    searchCalls: [],
    gmailCalls: [],
  };
}

function trackToolCall(tracker: ToolCallTracker, toolResult: any): void {
  if (!toolResult.call) return;
  if (toolResult.category === 'code') tracker.codeAnalysisCalls.push(toolResult.call as CodeAnalysisCall);
  else if (toolResult.category === 'obsidian') tracker.obsidianNoteCalls.push(toolResult.call as ObsidianNoteCall);
  else if (toolResult.category === 'calendar') tracker.googleCalendarCalls.push(toolResult.call as GoogleCalendarCall);
  else if (toolResult.category === 'scheduler') tracker.schedulerCalls.push(toolResult.call as SchedulerCall);
  else if (toolResult.category === 'shell') tracker.shellCalls.push(toolResult.call as ShellCall);
  else if (toolResult.category === 'git') tracker.gitCalls.push(toolResult.call as GitCall);
  else if (toolResult.category === 'self-edit') tracker.selfEditCalls.push(toolResult.call as SelfEditCall);
  else if (toolResult.category === 'search') tracker.searchCalls.push(toolResult.call as SearchCall);
  else if (toolResult.category === 'gmail') tracker.gmailCalls.push(toolResult.call as GmailCall);
}

function trackerToResponse(tracker: ToolCallTracker): Pick<LLMResponse, 'codeAnalysisCalls' | 'obsidianNoteCalls' | 'googleCalendarCalls' | 'schedulerCalls' | 'shellCalls' | 'gitCalls' | 'selfEditCalls' | 'searchCalls' | 'gmailCalls'> {
  return {
    codeAnalysisCalls: tracker.codeAnalysisCalls.length > 0 ? tracker.codeAnalysisCalls : undefined,
    obsidianNoteCalls: tracker.obsidianNoteCalls.length > 0 ? tracker.obsidianNoteCalls : undefined,
    googleCalendarCalls: tracker.googleCalendarCalls.length > 0 ? tracker.googleCalendarCalls : undefined,
    schedulerCalls: tracker.schedulerCalls.length > 0 ? tracker.schedulerCalls : undefined,
    shellCalls: tracker.shellCalls.length > 0 ? tracker.shellCalls : undefined,
    gitCalls: tracker.gitCalls.length > 0 ? tracker.gitCalls : undefined,
    selfEditCalls: tracker.selfEditCalls.length > 0 ? tracker.selfEditCalls : undefined,
    searchCalls: tracker.searchCalls.length > 0 ? tracker.searchCalls : undefined,
    gmailCalls: tracker.gmailCalls.length > 0 ? tracker.gmailCalls : undefined,
  };
}

function extractToolResultContent(toolResult: any): string {
  const val = toolResult.response.error
    || toolResult.response.answer
    || toolResult.response.content
    || toolResult.response.results
    || toolResult.response.notes
    || toolResult.response.result
    || toolResult.response.events
    || toolResult.response.event;
  if (val === undefined || val === null) return JSON.stringify(toolResult.response);
  return typeof val === 'string' ? val : JSON.stringify(val);
}

/**
 * Parse the `arguments` string of an OpenAI-style tool call, tolerating the
 * malformed JSON a model emits when it runs out of output tokens mid-argument
 * (a large file write, say) and truncates the string.
 *
 * On success returns `{ ok: true, args }`. On failure returns `{ ok: false,
 * error }` with a message the caller feeds back to the model as the tool
 * result, so one bad tool call self-corrects on the next turn instead of
 * throwing and 500-ing the whole chat. `raw` is included in the log for
 * debugging but never surfaced to the user.
 */
function parseToolArgs(raw: string): { ok: true; args: any } | { ok: false; error: string } {
  try {
    return { ok: true, args: raw ? JSON.parse(raw) : {} };
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'invalid JSON';
    console.error(`Malformed tool-call arguments (${raw?.length ?? 0} chars): ${detail}`);
    return {
      ok: false,
      error:
        `Your tool call could not be parsed: ${detail}. This usually means the ` +
        `arguments were truncated because they were too long. Retry with smaller ` +
        `arguments — e.g. write the file in multiple smaller chunks.`,
    };
  }
}

/** Build a messages array with system + history */
function buildMessagesArray(userMessage: string, sessionMessages?: Message[], discordContext?: { userId: string; channelId: string }, agentContext?: AgentContextBundle, sessionSummary?: string, systemPromptOverride?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  messages.push({
    role: 'system',
    content: systemPromptOverride ?? buildSystemPrompt({
      isDiscord: !!discordContext,
      discordUserId: discordContext?.userId,
      discordChannelId: discordContext?.channelId,
      agentContext,
    }),
  });

  // Inject summary of older messages as a system message before recent history
  if (sessionSummary) {
    messages.push({
      role: 'system',
      content: `EARLIER CONVERSATION SUMMARY:\n${sessionSummary}`,
    });
  }

  if (sessionMessages && sessionMessages.length > 0) {
    sessionMessages.forEach((msg) => {
      // Include timestamp in content so the LLM has temporal context
      let content = msg.content;
      if (msg.timestamp) {
        const time = new Date(msg.timestamp).toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
          hour12: true,
        });
        content = `[${time}] ${content}`;
      }
      messages.push({ role: msg.role as 'user' | 'assistant', content });
    });
  }

  messages.push({ role: 'user', content: userMessage });
  return messages;
}

function validateRequest(request: LLMRequest): void {
  if (!request.userMessage || request.userMessage.trim().length === 0) {
    throw new Error('User message cannot be empty');
  }
}

const OUT_OF_TOOL_CALLS = '(i ran out of tool calls for this response — ask me to continue if i missed something)';

function thinkingBlock(reasoning: string): string {
  return `🧠 **Thinking Process:**\n\n${reasoning}\n\n---\n\n**Response:**\n\n`;
}

/**
 * Streaming deltas carry reasoning_details in pieces that share an `index`.
 * Merge them back into whole entries so they can be returned to the model with
 * the tool call (some models, e.g. Gemini and Claude, need them to continue).
 */
function mergeReasoningDetails(target: any[], incoming: any[]): void {
  for (const piece of incoming) {
    const i = typeof piece?.index === 'number' ? piece.index : target.length;
    const existing = target[i];
    if (!existing) { target[i] = { ...piece }; continue; }
    for (const [key, value] of Object.entries(piece)) {
      if (key === 'index' || value === undefined || value === null) continue;
      if (typeof value === 'string' && typeof existing[key] === 'string' && (key === 'text' || key === 'summary' || key === 'data')) {
        existing[key] += value;
      } else {
        existing[key] = value;
      }
    }
  }
}

// ─── Model map ───────────────────────────────────────────────────────────────

export type ChatModelKey = 'glm' | 'claude' | 'gemini' | 'gemini-pro' | 'kimi' | 'kimi-thinking';
export const CHAT_MODEL_KEYS: readonly ChatModelKey[] = ['glm', 'claude', 'gemini', 'gemini-pro', 'kimi', 'kimi-thinking'];

const MODEL_MAP: Record<ChatModelKey, { env: string; fallback: string; showReasoning?: boolean }> = {
  glm: { env: 'OPENROUTER_MODEL', fallback: 'z-ai/glm-5.2' },
  claude: { env: 'OPENROUTER_CLAUDE_MODEL', fallback: 'anthropic/claude-opus-4.6' },
  gemini: { env: 'OPENROUTER_GEMINI_MODEL', fallback: 'google/gemini-3-flash-preview' },
  'gemini-pro': { env: 'OPENROUTER_GEMINI_PRO_MODEL', fallback: 'google/gemini-3.1-pro-preview' },
  kimi: { env: 'OPENROUTER_KIMI_MODEL', fallback: 'moonshotai/kimi-k2.6' },
  'kimi-thinking': { env: 'OPENROUTER_KIMI_MODEL', fallback: 'moonshotai/kimi-k2.6', showReasoning: true },
};

export function isChatModelKey(value: unknown): value is ChatModelKey {
  return typeof value === 'string' && (CHAT_MODEL_KEYS as readonly string[]).includes(value);
}

/** OpenRouter model id for a picker key (env override, else the default). */
export function openRouterModelId(key: ChatModelKey = 'glm'): string {
  const entry = MODEL_MAP[key] ?? MODEL_MAP.glm;
  return process.env[entry.env] || entry.fallback;
}

function maxOutputTokens(): number {
  // Large default so big tool-call arguments (file writes) aren't cut off
  // mid-JSON. Reasoning models spend part of this on thinking.
  const parsed = parseInt(process.env.OPENROUTER_MAX_TOKENS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16384;
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY environment variable is required');
    _client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    });
  }
  return _client;
}

// ─── OpenRouter Provider ─────────────────────────────────────────────────────

type StreamEvent =
  | { type: 'tool_results'; data: Record<string, any> }
  | { type: 'text_delta'; data: string }
  | { type: 'done'; data: Record<string, any> };

class OpenRouterService implements LLMProvider {
  constructor(private readonly key: ChatModelKey = 'glm') {}

  getModelId(): string { return openRouterModelId(this.key); }

  private get showReasoning(): boolean { return !!MODEL_MAP[this.key]?.showReasoning; }

  private baseParams(messages: OpenAI.Chat.ChatCompletionMessageParam[]): any {
    const params: any = {
      model: this.getModelId(),
      messages,
      max_tokens: maxOutputTokens(),
      tools: toOpenAITools(),
    };
    // Sampling the GLM chat has always used.
    if (this.key === 'glm') { params.temperature = 0.7; params.top_p = 0.9; }
    return params;
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    validateRequest(request);
    const tracker = createTracker();
    const conversationHistory = buildMessagesArray(request.userMessage, request.sessionMessages, request.discordContext, request.agentContext, request.sessionSummary, request.systemPromptOverride);
    const isDiscord = !!request.discordContext;
    const maxIterations = isDiscord ? 20 : 25;

    try {
      let iterations = 0;
      while (true) {
        iterations++;
        const response = await client().chat.completions.create(this.baseParams(conversationHistory));
        const message: any = response.choices[0]?.message;
        if (!message) throw new Error('No message in response');

        if (message.tool_calls && message.tool_calls.length > 0) {
          if (iterations >= maxIterations) {
            return { content: message.content || OUT_OF_TOOL_CALLS, timestamp: new Date().toISOString(), ...trackerToResponse(tracker) };
          }

          const assistantMsg: any = { role: 'assistant', content: message.content || null, tool_calls: message.tool_calls };
          if (message.reasoning_details) assistantMsg.reasoning_details = message.reasoning_details;
          conversationHistory.push(assistantMsg);

          for (const toolCall of message.tool_calls) {
            if (toolCall.type !== 'function') continue;
            const parsed = parseToolArgs(toolCall.function.arguments);
            if (!parsed.ok) {
              // Feed the parse error back so the model can retry instead of
              // crashing the whole request on one truncated tool call.
              conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: parsed.error });
              continue;
            }
            const toolResult = await executeTool(toolCall.function.name, parsed.args);
            trackToolCall(tracker, toolResult);
            conversationHistory.push({ role: 'tool', tool_call_id: toolCall.id, content: extractToolResultContent(toolResult) });
          }
          continue;
        }

        const content: string | null = message.content;
        if (!content) throw new Error('No content in response');
        const reasoning: string | undefined = message.reasoning || message.reasoning_content;
        // Thinking is shown in the web UI only; Discord gets plain text.
        const finalContent = reasoning && this.showReasoning && !isDiscord ? thinkingBlock(reasoning) + content : content;
        return { content: finalContent, timestamp: new Date().toISOString(), ...trackerToResponse(tracker) };
      }
    } catch (error) {
      console.error(`Error invoking OpenRouter (${this.getModelId()}):`, error);
      throw new Error(`Failed to generate response from ${this.getModelId()}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Streaming variant: every call is streamed. Tool calls are collected from
   * the stream and executed, then the loop continues; the final text streams to
   * the caller token by token. Yields tool results before the first text.
   */
  async *generateStreamingResponse(request: LLMRequest): AsyncGenerator<StreamEvent> {
    validateRequest(request);
    const tracker = createTracker();
    const conversationHistory = buildMessagesArray(request.userMessage, request.sessionMessages, request.discordContext, request.agentContext, request.sessionSummary, request.systemPromptOverride);
    const maxIterations = 25;

    let iterations = 0;
    while (true) {
      iterations++;
      const stream = await client().chat.completions.create({ ...this.baseParams(conversationHistory), stream: true });

      const toolCalls: { id: string; type: string; function: { name: string; arguments: string } }[] = [];
      const reasoningDetails: any[] = [];
      let textContent = '';
      let reasoningContent = '';
      let isStreaming = false;

      for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as any;

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index === undefined) continue;
            if (!toolCalls[tc.index]) {
              toolCalls[tc.index] = { id: tc.id || '', type: tc.type || 'function', function: { name: tc.function?.name || '', arguments: '' } };
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].function.name = tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }

        const reasoningPiece = delta?.reasoning ?? delta?.reasoning_content;
        if (reasoningPiece) reasoningContent += reasoningPiece;
        if (Array.isArray(delta?.reasoning_details)) mergeReasoningDetails(reasoningDetails, delta.reasoning_details);

        if (delta?.content) {
          if (!isStreaming) {
            // First text chunk: emit tool results (and the thinking block) first
            yield { type: 'tool_results', data: trackerToResponse(tracker) };
            if (reasoningContent && this.showReasoning) yield { type: 'text_delta', data: thinkingBlock(reasoningContent) };
            isStreaming = true;
          }
          textContent += delta.content;
          yield { type: 'text_delta', data: delta.content };
        }
      }

      const validToolCalls = toolCalls.filter((tc) => tc && tc.function?.name);
      if (validToolCalls.length > 0) {
        if (iterations >= maxIterations) {
          yield { type: 'tool_results', data: trackerToResponse(tracker) };
          yield { type: 'text_delta', data: OUT_OF_TOOL_CALLS };
          yield { type: 'done', data: { timestamp: new Date().toISOString() } };
          return;
        }

        const assistantMsg: any = {
          role: 'assistant',
          content: textContent || null,
          tool_calls: validToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        const details = reasoningDetails.filter(Boolean);
        if (details.length > 0) assistantMsg.reasoning_details = details;
        conversationHistory.push(assistantMsg);

        for (const tc of validToolCalls) {
          const parsed = parseToolArgs(tc.function.arguments);
          if (!parsed.ok) {
            conversationHistory.push({ role: 'tool', tool_call_id: tc.id, content: parsed.error });
            continue;
          }
          const toolResult = await executeTool(tc.function.name, parsed.args);
          trackToolCall(tracker, toolResult);
          conversationHistory.push({ role: 'tool', tool_call_id: tc.id, content: extractToolResultContent(toolResult) });
        }
        continue;
      }

      if (isStreaming) {
        yield { type: 'done', data: { timestamp: new Date().toISOString() } };
        return;
      }

      // No tool calls and no streamed text: send whatever came back
      yield { type: 'tool_results', data: trackerToResponse(tracker) };
      if (textContent) yield { type: 'text_delta', data: textContent };
      yield { type: 'done', data: { timestamp: new Date().toISOString() } };
      return;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.generateResponse({ userMessage: 'Reply with just "OK".' });
      return true;
    } catch { return false; }
  }
}

// ─── Accessors ───────────────────────────────────────────────────────────────

const _instances = new Map<ChatModelKey, OpenRouterService>();

export const openRouterService = {
  getInstance(key: ChatModelKey = 'glm'): OpenRouterService {
    const safeKey = isChatModelKey(key) ? key : 'glm';
    let instance = _instances.get(safeKey);
    if (!instance) { instance = new OpenRouterService(safeKey); _instances.set(safeKey, instance); }
    return instance;
  },
  async generateResponse(request: LLMRequest, key: ChatModelKey = 'glm'): Promise<LLMResponse> {
    return this.getInstance(key).generateResponse(request);
  },
  async testConnection(key: ChatModelKey = 'glm'): Promise<boolean> {
    return this.getInstance(key).testConnection();
  },
  getModelId(key: ChatModelKey = 'glm'): string {
    return openRouterModelId(key);
  },
};

/**
 * Plain prompt-in, text-out call with no tools and no personal system prompt,
 * for plumbing such as conversation summaries.
 */
export async function openRouterComplete(prompt: string, options?: {
  system?: string;
  model?: ChatModelKey;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { system, model = 'glm', maxTokens = maxOutputTokens(), temperature = 0.2 } = options || {};
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const response = await client().chat.completions.create({
    model: openRouterModelId(model),
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  return (response.choices[0]?.message?.content || '').trim();
}

export { OpenRouterService };
