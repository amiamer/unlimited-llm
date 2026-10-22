import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One fake OpenAI client shared by every test; each test queues its responses.
const create = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts;
    this.chat = { completions: { create } };
  }),
}));

const executeTool = vi.fn();
vi.mock('../tool-registry', () => ({
  toOpenAITools: () => [{ type: 'function', function: { name: 'read_obsidian_note' } }],
  executeTool: (...args: any[]) => executeTool(...args),
}));
vi.mock('../system-prompt', () => ({ buildSystemPrompt: () => 'SYSTEM' }));

import OpenAI from 'openai';
import { openRouterService, openRouterModelId, openRouterComplete, isChatModelKey } from '../llm-providers';

function stream(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) yield { choices: [{ delta }] };
    },
  };
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  create.mockReset();
  executeTool.mockReset();
});

afterEach(() => {
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_CLAUDE_MODEL;
});

describe('model map', () => {
  it('defaults the chat to GLM 5.2 and keeps every picker key', () => {
    expect(openRouterModelId()).toBe('z-ai/glm-5.2');
    expect(openRouterModelId('glm')).toBe('z-ai/glm-5.2');
    expect(openRouterModelId('claude')).toBe('anthropic/claude-opus-4.6');
    expect(openRouterModelId('gemini')).toBe('google/gemini-3-flash-preview');
    expect(openRouterModelId('gemini-pro')).toBe('google/gemini-3.1-pro-preview');
    expect(openRouterModelId('kimi')).toBe('moonshotai/kimi-k2.6');
    expect(isChatModelKey('kiro')).toBe(false);
    expect(isChatModelKey('glm')).toBe(true);
  });

  it('lets env vars swap a model without code changes', () => {
    process.env.OPENROUTER_CLAUDE_MODEL = 'anthropic/claude-opus-5.5';
    expect(openRouterModelId('claude')).toBe('anthropic/claude-opus-5.5');
  });
});

describe('generateResponse', () => {
  it('talks to OpenRouter with the chosen model and returns the text', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: 'hello' } }] });
    const res = await openRouterService.generateResponse({ userMessage: 'hi' }, 'glm');
    expect(res.content).toBe('hello');
    const params = create.mock.calls[0][0];
    expect(params.model).toBe('z-ai/glm-5.2');
    expect(params.max_tokens).toBe(16384);
    expect(params.tools).toHaveLength(1);
    const clientOpts = (vi.mocked(OpenAI).mock.instances[0] as any).opts;
    expect(clientOpts.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(clientOpts.apiKey).toBe('test-key');
  });

  it('runs tool calls, returns reasoning_details with them, then answers', async () => {
    create
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_obsidian_note', arguments: '{"path":"a.md"}' } }],
            reasoning_details: [{ type: 'reasoning.text', text: 'look it up', index: 0 }],
          },
        }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'done' } }] });
    executeTool.mockResolvedValueOnce({ response: { content: 'note body' }, category: 'obsidian', call: { path: 'a.md' } });

    const res = await openRouterService.generateResponse({ userMessage: 'read a.md' }, 'gemini-pro');
    expect(executeTool).toHaveBeenCalledWith('read_obsidian_note', { path: 'a.md' });
    expect(res.content).toBe('done');
    expect(res.obsidianNoteCalls).toEqual([{ path: 'a.md' }]);
    const second = create.mock.calls[1][0].messages;
    const assistant = second.find((m: any) => m.role === 'assistant');
    expect(assistant.reasoning_details).toEqual([{ type: 'reasoning.text', text: 'look it up', index: 0 }]);
    expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 't1', content: 'note body' });
  });

  it('feeds malformed tool arguments back instead of failing', async () => {
    create
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_obsidian_note', arguments: '{"path":' } }] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'retried' } }] });
    const res = await openRouterService.generateResponse({ userMessage: 'x' });
    expect(executeTool).not.toHaveBeenCalled();
    expect(res.content).toBe('retried');
    expect(create.mock.calls[1][0].messages.at(-1).content).toContain('could not be parsed');
  });

  it('shows thinking only for the thinking key, and never on Discord', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'answer', reasoning: 'why' } }] });
    expect((await openRouterService.generateResponse({ userMessage: 'q' }, 'kimi')).content).toBe('answer');
    expect((await openRouterService.generateResponse({ userMessage: 'q' }, 'kimi-thinking')).content).toContain('why');
    const discord = await openRouterService.generateResponse(
      { userMessage: 'q', discordContext: { userId: 'u', channelId: 'c' } }, 'kimi-thinking');
    expect(discord.content).toBe('answer');
  });
});

describe('generateStreamingResponse', () => {
  it('streams text after running a streamed tool call', async () => {
    create
      .mockResolvedValueOnce(stream([
        { reasoning: 'plan ', reasoning_details: [{ type: 'reasoning.text', text: 'pl', index: 0 }] },
        { reasoning_details: [{ type: 'reasoning.text', text: 'an', index: 0, signature: 'sig' }] },
        { tool_calls: [{ index: 0, id: 't1', type: 'function', function: { name: 'read_obsidian_note', arguments: '{"pa' } }] },
        { tool_calls: [{ index: 0, function: { arguments: 'th":"a.md"}' } }] },
      ]))
      .mockResolvedValueOnce(stream([{ content: 'hel' }, { content: 'lo' }]));
    executeTool.mockResolvedValueOnce({ response: { content: 'body' }, category: 'obsidian', call: { path: 'a.md' } });

    const events: any[] = [];
    for await (const e of openRouterService.getInstance('glm').generateStreamingResponse({ userMessage: 'go' })) events.push(e);

    expect(executeTool).toHaveBeenCalledWith('read_obsidian_note', { path: 'a.md' });
    expect(events.filter((e) => e.type === 'text_delta').map((e) => e.data).join('')).toBe('hello');
    expect(events[0]).toEqual({ type: 'tool_results', data: expect.objectContaining({ obsidianNoteCalls: [{ path: 'a.md' }] }) });
    expect(events.at(-1).type).toBe('done');
    expect(create.mock.calls[0][0].stream).toBe(true);
    const assistant = create.mock.calls[1][0].messages.find((m: any) => m.role === 'assistant');
    expect(assistant.reasoning_details).toEqual([{ type: 'reasoning.text', text: 'plan', index: 0, signature: 'sig' }]);
  });
});

describe('openRouterComplete', () => {
  it('sends a plain prompt with no tools', async () => {
    create.mockResolvedValueOnce({ choices: [{ message: { content: '  summary  ' } }] });
    const text = await openRouterComplete('summarize this', { system: 'be brief' });
    expect(text).toBe('summary');
    const params = create.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'summarize this' },
    ]);
  });
});
