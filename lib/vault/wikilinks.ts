/**
 * Obsidian-style [[wikilinks]] for the vault editor's preview: find the note a
 * link points to, and turn links into markdown links the preview can render.
 * Pure functions, shared by server and client.
 */

export const WIKILINK_SCHEME = 'wikilink:';

const noteKey = (s: string) => s.trim().replace(/\.md$/i, '').toLowerCase();
const baseName = (p: string) => p.split('/').pop() ?? p;

/** Map note names (and full paths without .md) to vault paths. */
export function buildNoteIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (key: string, p: string) => {
    const list = index.get(key) ?? [];
    if (!list.includes(p)) list.push(p);
    index.set(key, list);
  };
  for (const p of paths) {
    add(noteKey(baseName(p)), p);
    add(noteKey(p), p);
  }
  return index;
}

/**
 * Resolve a link target ("Note", "folder/Note", "Note.md") to a vault path.
 * On a name clash, prefer a note in the same folder as the linking note, then
 * the shortest path, like Obsidian.
 */
export function resolveWikilink(target: string, index: Map<string, string[]>, fromPath?: string): string | null {
  const candidates = index.get(noteKey(target));
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const folder = fromPath?.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  const sameFolder = candidates.find((c) => folder && c.startsWith(folder) && !c.slice(folder.length).includes('/'));
  return sameFolder ?? [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

/** Drop a leading YAML frontmatter block (shown separately in the preview). */
export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[0].length) };
}

/**
 * Rewrite [[target]], [[target|alias]] and [[target#heading]] as markdown
 * links with a wikilink: URL; embeds (![[...]]) become plain links too.
 * Code spans and fenced code blocks are left untouched.
 */
export function wikilinksToMarkdown(body: string): string {
  const parts = body.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code
      return part.replace(/!?\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g, (_m, target: string, heading: string | undefined, alias: string | undefined) => {
        const label = (alias ?? `${target}${heading ?? ''}`).trim().replace(/[[\]]/g, '');
        return `[${label}](${WIKILINK_SCHEME}${encodeURIComponent(target.trim())})`;
      });
    })
    .join('');
}
