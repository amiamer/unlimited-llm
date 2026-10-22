import { describe, expect, it } from 'vitest';
import type { AgentContextBundle } from '../agent-context';
import { buildSystemPrompt } from '../system-prompt';

function bundle(): AgentContextBundle {
  return {
    sources: [{
      path: '_agent/AGENTS.md',
      kind: 'instructions',
      content: 'curated test instruction',
      truncated: false,
    }],
    missing: [],
    warnings: [],
    matchedProjects: [],
    alwaysContext: '[SOURCE: _agent/AGENTS.md | instructions]\ncurated test instruction',
    projectContext: '',
    totalChars: 24,
  };
}

describe('system prompt context contract', () => {
  it('includes source-marked curated context and approval boundaries', () => {
    const prompt = buildSystemPrompt({ agentContext: bundle() });

    expect(prompt).toContain('[SOURCE: _agent/AGENTS.md | instructions]');
    expect(prompt).toContain('curated test instruction');
    expect(prompt).toContain('Amer approval is required');
    expect(prompt).toContain('searchable evidence, not automatic memory');
  });

  it('does not claim the whole vault is loaded or already known', () => {
    const prompt = buildSystemPrompt({ agentContext: bundle() });

    expect(prompt).not.toContain('front-loaded');
    expect(prompt).not.toContain('full content of Amer\'s personal notes');
    expect(prompt).not.toContain('you already know this');
    expect(prompt).not.toContain('FULL read/write access');
  });

  it('uses a safe fallback without scanning the vault when context is missing', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('IDENTITY FALLBACK');
    expect(prompt).toContain('Do not compensate by loading the whole vault');
  });
});
