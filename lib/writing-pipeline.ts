/**
 * Writing Pipeline
 * 
 * Tracks essay drafts, their status, and editorial notes.
 * Stored as a JSON file in the data/ directory.
 * The LLM can read and update this via tools.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const PIPELINE_FILE = path.join(process.cwd(), 'data', 'writing-pipeline.json');

export type DraftStatus = 'idea' | 'draft' | 'editing' | 'ready' | 'published';

export interface WritingDraft {
  id: string;
  title: string;
  vaultPath: string;        // Path in Obsidian vault
  status: DraftStatus;
  lastEdited: string;       // ISO timestamp
  created: string;
  editorialNotes: string;   // What still needs work
  nextAction: string;       // Concrete next step
  wordCount?: number;
  publishedUrl?: string;
}

export interface WritingPipeline {
  drafts: WritingDraft[];
  lastUpdated: string;
}

async function loadPipeline(): Promise<WritingPipeline> {
  try {
    const raw = await fs.readFile(PIPELINE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { drafts: [], lastUpdated: new Date().toISOString() };
  }
}

async function savePipeline(pipeline: WritingPipeline): Promise<void> {
  pipeline.lastUpdated = new Date().toISOString();
  await fs.mkdir(path.dirname(PIPELINE_FILE), { recursive: true });
  const tmp = PIPELINE_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(pipeline, null, 2));
  await fs.rename(tmp, PIPELINE_FILE);
}

export async function listDrafts(): Promise<string> {
  const pipeline = await loadPipeline();
  if (pipeline.drafts.length === 0) return 'No drafts in the pipeline yet.';

  const byStatus: Record<string, WritingDraft[]> = {};
  for (const d of pipeline.drafts) {
    (byStatus[d.status] ||= []).push(d);
  }

  const lines: string[] = [];
  for (const status of ['idea', 'draft', 'editing', 'ready', 'published'] as DraftStatus[]) {
    const drafts = byStatus[status];
    if (!drafts) continue;
    lines.push(`[${status.toUpperCase()}]`);
    for (const d of drafts) {
      const age = Math.floor((Date.now() - new Date(d.lastEdited).getTime()) / 86400000);
      lines.push(`  ${d.title} (${d.vaultPath}) — ${age}d ago — next: ${d.nextAction}`);
    }
  }
  return lines.join('\n');
}

export async function addDraft(title: string, vaultPath: string, status: DraftStatus, editorialNotes: string, nextAction: string): Promise<string> {
  const pipeline = await loadPipeline();
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const existing = pipeline.drafts.find(d => d.id === id);
  if (existing) return `Draft "${title}" already exists. Use update_draft to modify it.`;

  pipeline.drafts.push({
    id, title, vaultPath, status,
    lastEdited: new Date().toISOString(),
    created: new Date().toISOString(),
    editorialNotes, nextAction,
  });
  await savePipeline(pipeline);
  return `Added "${title}" to pipeline as [${status}].`;
}

export async function updateDraft(title: string, updates: Partial<Pick<WritingDraft, 'status' | 'editorialNotes' | 'nextAction' | 'wordCount' | 'publishedUrl'>>): Promise<string> {
  const pipeline = await loadPipeline();
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const draft = pipeline.drafts.find(d => d.id === id);
  if (!draft) return `Draft "${title}" not found. Use add_draft to create it.`;

  if (updates.status) draft.status = updates.status;
  if (updates.editorialNotes) draft.editorialNotes = updates.editorialNotes;
  if (updates.nextAction) draft.nextAction = updates.nextAction;
  if (updates.wordCount) draft.wordCount = updates.wordCount;
  if (updates.publishedUrl) draft.publishedUrl = updates.publishedUrl;
  draft.lastEdited = new Date().toISOString();

  await savePipeline(pipeline);
  return `Updated "${title}" — now [${draft.status}], next: ${draft.nextAction}`;
}

export async function removeDraft(title: string): Promise<string> {
  const pipeline = await loadPipeline();
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const idx = pipeline.drafts.findIndex(d => d.id === id);
  if (idx === -1) return `Draft "${title}" not found.`;
  pipeline.drafts.splice(idx, 1);
  await savePipeline(pipeline);
  return `Removed "${title}" from pipeline.`;
}
