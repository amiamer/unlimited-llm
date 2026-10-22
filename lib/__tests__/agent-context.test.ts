import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AGENT_CONTEXT_LIMITS,
  isProtectedAgentContextPath,
  loadAgentContext,
} from '../agent-context';

const ALWAYS_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TELOS.md', 'MEMORY.md', 'PROJECTS.md'];

describe('agent context loader', () => {
  let vaultPath: string;
  const originalAgentDir = process.env.AGENT_CONTEXT_DIR;
  const originalEnabled = process.env.AGENT_CONTEXT_ENABLED;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-context-'));
    delete process.env.AGENT_CONTEXT_DIR;
    process.env.AGENT_CONTEXT_ENABLED = 'true';
  });

  afterEach(async () => {
    if (originalAgentDir === undefined) delete process.env.AGENT_CONTEXT_DIR;
    else process.env.AGENT_CONTEXT_DIR = originalAgentDir;
    if (originalEnabled === undefined) delete process.env.AGENT_CONTEXT_ENABLED;
    else process.env.AGENT_CONTEXT_ENABLED = originalEnabled;
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  async function write(relativePath: string, content: string): Promise<void> {
    const target = path.join(vaultPath, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }

  async function writeAlways(contentFor?: (file: string, index: number) => string): Promise<void> {
    await Promise.all(ALWAYS_FILES.map((file, index) =>
      write(path.join('_agent', file), contentFor?.(file, index) ?? `content:${file}`),
    ));
  }

  it('stays disabled unless explicitly enabled', async () => {
    delete process.env.AGENT_CONTEXT_ENABLED;

    const bundle = await loadAgentContext({ vaultPath, useCache: false });

    expect(bundle.sources).toEqual([]);
    expect(bundle.totalChars).toBe(0);
    expect(bundle.warnings).toContain('Agent context is disabled pending Amer review.');
  });

  it('loads always-context files in fixed order and preserves source paths', async () => {
    await writeAlways();

    const bundle = await loadAgentContext({ vaultPath, useCache: false });

    expect(bundle.sources.map((source) => source.path)).toEqual(
      ALWAYS_FILES.map((file) => `_agent/${file}`),
    );
    expect(bundle.sources.map((source) => source.kind)).toEqual([
      'instructions', 'soul', 'user', 'telos', 'memory', 'projects',
    ]);
    expect(bundle.alwaysContext).toContain('[SOURCE: _agent/AGENTS.md | instructions]');
  });

  it('returns explicit missing metadata without throwing', async () => {
    const bundle = await loadAgentContext({ vaultPath, useCache: false });

    expect(bundle.sources).toEqual([]);
    expect(bundle.missing).toEqual(ALWAYS_FILES.map((file) => `_agent/${file}`));
    expect(bundle.totalChars).toBe(0);
  });

  it('enforces the per-file limit and marks truncation', async () => {
    await write('_agent/AGENTS.md', 'x'.repeat(AGENT_CONTEXT_LIMITS.perFileChars + 500));

    const bundle = await loadAgentContext({ vaultPath, useCache: false });
    const source = bundle.sources[0];

    expect(source.content.length).toBe(AGENT_CONTEXT_LIMITS.perFileChars);
    expect(source.truncated).toBe(true);
    expect(source.content).toContain('[truncated by agent-context budget]');
  });

  it('enforces always, project, and total budgets deterministically', async () => {
    await writeAlways(() => 'a'.repeat(AGENT_CONTEXT_LIMITS.perFileChars));
    await write('_agent/projects/test/project.json', JSON.stringify({
      id: 'test', aliases: ['bounded project'], contextFiles: ['project/one.md', 'project/two.md'],
    }));
    await write('project/one.md', 'p'.repeat(AGENT_CONTEXT_LIMITS.perFileChars));
    await write('project/two.md', 'q'.repeat(AGENT_CONTEXT_LIMITS.perFileChars));

    const bundle = await loadAgentContext({
      vaultPath,
      userMessage: 'Open the BOUNDED PROJECT please.',
      useCache: false,
    });
    const alwaysChars = bundle.sources
      .filter((source) => source.kind !== 'project-context')
      .reduce((sum, source) => sum + source.content.length, 0);
    const projectChars = bundle.sources
      .filter((source) => source.kind === 'project-context')
      .reduce((sum, source) => sum + source.content.length, 0);

    expect(alwaysChars).toBeLessThanOrEqual(AGENT_CONTEXT_LIMITS.alwaysChars);
    expect(projectChars).toBeLessThanOrEqual(AGENT_CONTEXT_LIMITS.projectChars);
    expect(bundle.totalChars).toBeLessThanOrEqual(AGENT_CONTEXT_LIMITS.totalChars);
    expect(bundle.warnings.some((warning) => warning.includes('budget exhausted'))).toBe(true);
  });

  it('matches project aliases case-insensitively and excludes unrelated projects', async () => {
    await writeAlways();
    await write('_agent/projects/alpha/project.json', JSON.stringify({
      id: 'alpha', aliases: ['Unlimited LLM'], contextFiles: ['projects/alpha.md'],
    }));
    await write('_agent/projects/beta/project.json', JSON.stringify({
      id: 'beta', aliases: ['other system'], contextFiles: ['projects/beta.md'],
    }));
    await write('projects/alpha.md', 'alpha project context');
    await write('projects/beta.md', 'beta project context');

    const bundle = await loadAgentContext({
      vaultPath,
      userMessage: 'What changed in unlimited llm?',
      useCache: false,
    });

    expect(bundle.matchedProjects).toEqual(['alpha']);
    expect(bundle.projectContext).toContain('alpha project context');
    expect(bundle.projectContext).not.toContain('beta project context');
  });

  it('warns on invalid manifests and skips paths outside the vault', async () => {
    await writeAlways();
    await write('_agent/projects/broken/project.json', '{not json');
    await write('_agent/projects/escape/project.json', JSON.stringify({
      id: 'escape', aliases: ['escape test'], contextFiles: ['../outside.md'],
    }));

    const bundle = await loadAgentContext({
      vaultPath,
      userMessage: 'escape test',
      useCache: false,
    });

    expect(bundle.warnings.some((warning) => warning.includes('Invalid project manifest skipped'))).toBe(true);
    expect(bundle.warnings.some((warning) => warning.includes('Unable to load project source'))).toBe(true);
    expect(bundle.sources.some((source) => source.path === '../outside.md')).toBe(false);
  });

  it('identifies protected canonical context without blocking mutable destinations', () => {
    expect(isProtectedAgentContextPath('_agent/USER.md')).toBe(true);
    expect(isProtectedAgentContextPath('_agent/projects/unlimited-llm/DECISIONS.md')).toBe(true);
    expect(isProtectedAgentContextPath('_agent/state/ACTIVE.md')).toBe(false);
    expect(isProtectedAgentContextPath('_agent/proposals/pending.md')).toBe(false);
  });

  it('does not load unrelated raw vault notes', async () => {
    await writeAlways();
    await write('idk what this is.md', 'private raw rant marker');
    await write('excluded/source-dump.md', 'large source marker');

    const bundle = await loadAgentContext({
      vaultPath,
      userMessage: 'neutral question',
      useCache: false,
    });

    expect(bundle.sources.map((source) => source.path)).not.toContain('idk what this is.md');
    expect(bundle.alwaysContext).not.toContain('private raw rant marker');
    expect(bundle.alwaysContext).not.toContain('large source marker');
  });
});
