import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import { localObsidianService } from './local-storage';

export type AgentContextKind =
  | 'instructions'
  | 'soul'
  | 'user'
  | 'telos'
  | 'memory'
  | 'projects'
  | 'project-context';

export interface AgentContextSource {
  path: string;
  kind: AgentContextKind;
  content: string;
  truncated: boolean;
}

export interface AgentContextBundle {
  sources: AgentContextSource[];
  missing: string[];
  warnings: string[];
  matchedProjects: string[];
  alwaysContext: string;
  projectContext: string;
  totalChars: number;
}

export interface LoadAgentContextOptions {
  vaultPath?: string;
  userMessage?: string;
  useCache?: boolean;
}

interface ProjectManifest {
  version?: number;
  id: string;
  aliases: string[];
  contextFiles: string[];
}

interface AlwaysFile {
  path: string;
  kind: Exclude<AgentContextKind, 'project-context'>;
}

export const AGENT_CONTEXT_LIMITS = {
  perFileChars: 8_000,
  alwaysChars: 24_000,
  projectChars: 12_000,
  totalChars: 36_000,
} as const;

const ALWAYS_FILES: AlwaysFile[] = [
  { path: '_agent/AGENTS.md', kind: 'instructions' },
  { path: '_agent/SOUL.md', kind: 'soul' },
  { path: '_agent/USER.md', kind: 'user' },
  { path: '_agent/TELOS.md', kind: 'telos' },
  { path: '_agent/MEMORY.md', kind: 'memory' },
  { path: '_agent/PROJECTS.md', kind: 'projects' },
];

const CACHE_TTL_MS = 5 * 60 * 1_000;
const cache = new Map<string, { loadedAt: number; bundle: AgentContextBundle }>();

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Canonical context and decision files cannot be changed through generic vault
 * mutation tools. Approved changes are applied manually; legacy memory updates
 * must use the proposal queue instead.
 */
export function isProtectedAgentContextPath(filePath: string): boolean {
  const normalized = toPosix(filePath).replace(/^\.\//, '').replace(/^\//, '').toLocaleLowerCase();
  const withExtension = normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  const configured = process.env.AGENT_CONTEXT_DIR || '_agent';
  const configuredName = path.isAbsolute(configured)
    ? path.basename(configured).toLocaleLowerCase()
    : toPosix(configured).replace(/^\.\//, '').replace(/\/$/, '').toLocaleLowerCase();
  const roots = new Set([configuredName, '_agent']);

  for (const root of roots) {
    const protectedFiles = new Set([
      `${root}/readme.md`,
      `${root}/agents.md`,
      `${root}/soul.md`,
      `${root}/user.md`,
      `${root}/telos.md`,
      `${root}/memory.md`,
      `${root}/projects.md`,
    ]);
    if (protectedFiles.has(withExtension)) return true;

    const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^${escapedRoot}/projects/[^/]+/decisions\\.md$`, 'i').test(withExtension)) {
      return true;
    }
  }

  return false;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function truncate(content: string, limit: number): { content: string; truncated: boolean } {
  if (content.length <= limit) return { content, truncated: false };
  if (limit <= 0) return { content: '', truncated: true };
  const suffix = '\n\n[truncated by agent-context budget]';
  if (limit <= suffix.length) return { content: content.slice(0, limit), truncated: true };
  return { content: content.slice(0, limit - suffix.length) + suffix, truncated: true };
}

function renderSources(sources: AgentContextSource[]): string {
  return sources
    .map((source) => `[SOURCE: ${source.path} | ${source.kind}${source.truncated ? ' | truncated' : ''}]\n${source.content}`)
    .join('\n\n');
}

async function readSource(
  vaultRoot: string,
  relativePath: string,
  kind: AgentContextKind,
  remainingBudget: number,
): Promise<AgentContextSource | null> {
  if (remainingBudget <= 0) return null;

  const absolutePath = path.resolve(vaultRoot, relativePath);
  if (!isPathInside(vaultRoot, absolutePath)) {
    throw new Error(`Context path escapes vault root: ${relativePath}`);
  }

  const raw = await fs.readFile(absolutePath, 'utf8');
  const perFile = truncate(raw.trim(), AGENT_CONTEXT_LIMITS.perFileChars);
  const layerBounded = truncate(perFile.content, remainingBudget);

  return {
    path: toPosix(relativePath),
    kind,
    content: layerBounded.content,
    truncated: perFile.truncated || layerBounded.truncated,
  };
}

function aliasMatches(message: string, alias: string): boolean {
  const normalizedMessage = message.toLocaleLowerCase();
  const normalizedAlias = alias.trim().toLocaleLowerCase();
  if (!normalizedAlias) return false;

  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(normalizedMessage);
}

function validateManifest(value: unknown): value is ProjectManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<ProjectManifest>;
  return (
    typeof manifest.id === 'string' &&
    manifest.id.trim().length > 0 &&
    Array.isArray(manifest.aliases) &&
    manifest.aliases.every((alias) => typeof alias === 'string' && alias.trim().length > 0) &&
    Array.isArray(manifest.contextFiles) &&
    manifest.contextFiles.every((file) => typeof file === 'string' && file.trim().length > 0)
  );
}

async function loadProjectManifests(
  vaultRoot: string,
  agentDir: string,
  warnings: string[],
): Promise<ProjectManifest[]> {
  const projectsDir = path.join(vaultRoot, agentDir, 'projects');
  let entries: Dirent<string>[];

  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') warnings.push(`Unable to read project manifests: ${code || 'unknown error'}`);
    return [];
  }

  const manifests: ProjectManifest[] = [];
  const directories = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of directories) {
    const manifestPath = path.join(projectsDir, directory.name, 'project.json');
    const displayPath = toPosix(path.relative(vaultRoot, manifestPath));
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (!validateManifest(parsed)) {
        warnings.push(`Invalid project manifest skipped: ${displayPath}`);
        continue;
      }
      manifests.push(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      warnings.push(`Invalid project manifest skipped: ${displayPath}${code ? ` (${code})` : ''}`);
    }
  }

  return manifests;
}

export async function loadAgentContext(options: LoadAgentContextOptions = {}): Promise<AgentContextBundle> {
  if (process.env.AGENT_CONTEXT_ENABLED?.toLocaleLowerCase() !== 'true') {
    return {
      sources: [],
      missing: [],
      warnings: ['Agent context is disabled pending Amer review.'],
      matchedProjects: [],
      alwaysContext: '',
      projectContext: '',
      totalChars: 0,
    };
  }

  const vaultRoot = path.resolve(options.vaultPath || await localObsidianService.getVaultPath());
  const configuredDir = process.env.AGENT_CONTEXT_DIR || '_agent';
  const agentDir = path.isAbsolute(configuredDir)
    ? toPosix(path.relative(vaultRoot, configuredDir))
    : toPosix(configuredDir);
  const userMessage = options.userMessage || '';
  const cacheKey = `${vaultRoot}\u0000${agentDir}\u0000${userMessage.toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);

  if (options.useCache !== false && cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.bundle;
  }

  const missing: string[] = [];
  const warnings: string[] = [];
  const alwaysSources: AgentContextSource[] = [];
  let alwaysRemaining = AGENT_CONTEXT_LIMITS.alwaysChars;

  for (const file of ALWAYS_FILES) {
    const relativePath = file.path.replace(/^_agent(?=\/|$)/, agentDir);
    if (alwaysRemaining <= 0) {
      warnings.push(`Always-context budget exhausted before: ${relativePath}`);
      continue;
    }
    try {
      const source = await readSource(vaultRoot, relativePath, file.kind, alwaysRemaining);
      if (source) {
        alwaysSources.push(source);
        alwaysRemaining -= source.content.length;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') missing.push(toPosix(relativePath));
      else warnings.push(`Unable to load context source: ${toPosix(relativePath)} (${code || 'error'})`);
    }
  }

  const manifests = await loadProjectManifests(vaultRoot, agentDir, warnings);
  const matched = manifests.filter((manifest) => manifest.aliases.some((alias) => aliasMatches(userMessage, alias)));
  const matchedProjects = matched.map((manifest) => manifest.id);
  const projectSources: AgentContextSource[] = [];
  const seenProjectFiles = new Set<string>();
  let projectRemaining = Math.min(
    AGENT_CONTEXT_LIMITS.projectChars,
    AGENT_CONTEXT_LIMITS.totalChars - alwaysSources.reduce((sum, source) => sum + source.content.length, 0),
  );

  for (const manifest of matched) {
    for (const declaredPath of manifest.contextFiles) {
      const relativePath = toPosix(declaredPath);
      if (seenProjectFiles.has(relativePath)) continue;
      seenProjectFiles.add(relativePath);

      if (projectRemaining <= 0) {
        warnings.push(`Project-context budget exhausted before: ${relativePath}`);
        continue;
      }

      try {
        const source = await readSource(vaultRoot, relativePath, 'project-context', projectRemaining);
        if (source) {
          projectSources.push(source);
          projectRemaining -= source.content.length;
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') missing.push(relativePath);
        else warnings.push(`Unable to load project source: ${relativePath} (${code || 'error'})`);
      }
    }
  }

  const sources = [...alwaysSources, ...projectSources];
  const bundle: AgentContextBundle = {
    sources,
    missing,
    warnings,
    matchedProjects,
    alwaysContext: renderSources(alwaysSources),
    projectContext: renderSources(projectSources),
    totalChars: sources.reduce((sum, source) => sum + source.content.length, 0),
  };

  if (options.useCache !== false) cache.set(cacheKey, { loadedAt: Date.now(), bundle });
  return bundle;
}

export function renderAgentContext(bundle: AgentContextBundle): string {
  const sections = [bundle.alwaysContext, bundle.projectContext].filter(Boolean);
  return sections.join('\n\n');
}

export function invalidateAgentContextCache(): void {
  cache.clear();
}
