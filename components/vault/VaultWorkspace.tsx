'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { markdown } from '@codemirror/lang-markdown';
import { markdownComponents } from '@/components/markdown-message';
import {
  WIKILINK_SCHEME,
  buildNoteIndex,
  resolveWikilink,
  splitFrontmatter,
  wikilinksToMarkdown,
} from '@/lib/vault/wikilinks';

// CodeMirror touches the DOM on import; load it in the browser only.
const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false });

interface VaultEntry { path: string; mtimeMs: number; size: number }
interface SearchHit { file: string; context: string }
type Mode = 'edit' | 'split' | 'preview';
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type VaultName = 'main' | 'autodidact';
const VAULT_NAMES: VaultName[] = ['main', 'autodidact'];

interface Folder { name: string; path: string; folders: Map<string, Folder>; files: VaultEntry[] }

const MODE_KEY = 'vault:mode';
const AUTOSAVE_MS = 1200;

function buildTree(files: VaultEntry[]): Folder {
  const root: Folder = { name: '', path: '', folders: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const childPath = node.path ? `${node.path}/${part}` : part;
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: childPath, folders: new Map(), files: [] });
      node = node.folders.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

const noteName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

export default function VaultWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const vault: VaultName = params.get('vault') === 'autodidact' ? 'autodidact' : 'main';
  const q = `vault=${vault}`;

  const [files, setFiles] = useState<VaultEntry[]>([]);
  const [vaultRoot, setVaultRoot] = useState('');
  const [treeError, setTreeError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [baseMtime, setBaseMtime] = useState<number | undefined>(undefined);
  const [noteError, setNoteError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [mode, setMode] = useState<Mode>('split');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [newNote, setNewNote] = useState<string | null>(null);

  const dirty = openPath !== null && content !== savedContent;
  const saving = useRef(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'edit' || m === 'split' || m === 'preview') setMode(m);
    } catch { /* ignore */ }
  }, []);
  const changeMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };

  const loadTree = useCallback(async () => {
    const res = await fetch(`/api/vault/tree?${q}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setTreeError(data.error || 'Could not load the vault.'); return; }
    setTreeError('');
    setFiles(data.files ?? []);
    setVaultRoot(data.root ?? '');
  }, [q]);
  useEffect(() => { void loadTree(); }, [loadTree]);

  const index = useMemo(() => buildNoteIndex(files.map((f) => f.path)), [files]);
  const tree = useMemo(() => buildTree(files), [files]);

  // ── saving ───────────────────────────────────────────────────────────────
  const save = useCallback(async (opts: { force?: boolean } = {}): Promise<boolean> => {
    if (!openPath || saving.current) return false;
    saving.current = true;
    setSaveState('saving');
    const text = content;
    try {
      const res = await fetch(`/api/vault/file?${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: openPath, content: text, baseMtimeMs: opts.force ? undefined : baseMtime }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSaveState('conflict');
        setSaveMessage(data.error || 'The note changed on disk.');
        return false;
      }
      if (!res.ok) {
        setSaveState('error');
        setSaveMessage(data.error || 'Save failed.');
        return false;
      }
      setBaseMtime(data.mtimeMs);
      setSavedContent(text);
      setSaveState('saved');
      setSaveMessage('');
      return true;
    } catch {
      setSaveState('error');
      setSaveMessage('Save failed: the app server is unreachable.');
      return false;
    } finally {
      saving.current = false;
    }
  }, [openPath, content, baseMtime, q]);

  // Autosave shortly after typing stops (not while a conflict is unresolved).
  useEffect(() => {
    if (!dirty || saveState === 'conflict') return;
    const t = setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [content, dirty, saveState, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [dirty, save]);

  // ── opening notes ────────────────────────────────────────────────────────
  const openNote = useCallback(async (path: string, opts: { skipSave?: boolean } = {}) => {
    if (!opts.skipSave && dirty && saveState !== 'conflict') {
      const ok = await save();
      if (!ok) return;
    }
    setNoteError('');
    const res = await fetch(`/api/vault/file?${q}&path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNoteError(data.error || 'Could not open the note.'); return; }
    setOpenPath(data.path);
    setContent(data.content);
    setSavedContent(data.content);
    setBaseMtime(data.mtimeMs);
    setSaveState('idle');
    setSaveMessage('');
    setExpanded((prev) => {
      const next = new Set(prev);
      const parts = String(data.path).split('/');
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
    router.replace(`/vault?${q}&path=${encodeURIComponent(data.path)}`, { scroll: false });
  }, [dirty, saveState, save, router, q]);

  // Switching vaults saves the open note first, then starts from an empty editor.
  const switchVault = async (next: VaultName) => {
    if (next === vault) return;
    if (dirty && saveState !== 'conflict' && !(await save())) return;
    if (dirty && saveState === 'conflict') return;
    setOpenPath(null);
    setContent('');
    setSavedContent('');
    setResults(null);
    setFilter('');
    setExpanded(new Set());
    setNoteError('');
    router.replace(`/vault?vault=${next}`, { scroll: false });
  };

  // Deep link: /vault?path=folder/Note.md
  const initialPath = params.get('path');
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && initialPath) {
      opened.current = true;
      void openNote(initialPath, { skipSave: true });
    }
  }, [initialPath, openNote]);

  const reloadFromDisk = () => { if (openPath) void openNote(openPath, { skipSave: true }); };

  // ── creating and searching ───────────────────────────────────────────────
  const createNote = async () => {
    if (newNote === null) return;
    let path = newNote.trim().replace(/\\/g, '/');
    if (!path) return;
    if (!/\.md$/i.test(path)) path += '.md';
    const res = await fetch(`/api/vault/file?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNoteError(data.error || 'Could not create the note.'); return; }
    setNewNote(null);
    await loadTree();
    await openNote(data.path);
  };

  const runSearch = async () => {
    const text = query.trim();
    if (text.length < 2) { setResults(null); return; }
    const res = await fetch(`/api/vault/search?${q}&q=${encodeURIComponent(text)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    setResults(res.ok ? data.results ?? [] : []);
  };

  // ── preview ──────────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const { frontmatter, body } = splitFrontmatter(content);
    return { frontmatter, markdown: wikilinksToMarkdown(body) };
  }, [content]);

  const followWikilink = (target: string) => {
    const resolved = resolveWikilink(target, index, openPath ?? undefined);
    if (resolved) void openNote(resolved);
    else setNewNote(target);
  };

  // ── rendering ────────────────────────────────────────────────────────────
  const filtered = filter.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase()))
    : null;

  const renderFolder = (folder: Folder, depth: number): ReactNode => (
    <>
      {[...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map((child) => {
        const isOpen = expanded.has(child.path);
        return (
          <div key={child.path}>
            <button
              onClick={() => setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(child.path)) next.delete(child.path); else next.add(child.path);
                return next;
              })}
              className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-sm text-gray-400 hover:bg-navy-red-800 hover:text-gray-200"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <span className="w-3 text-[10px]">{isOpen ? '▾' : '▸'}</span>
              <span className="truncate">{child.name}</span>
            </button>
            {isOpen && renderFolder(child, depth + 1)}
          </div>
        );
      })}
      {folder.files.map((f) => (
        <button
          key={f.path}
          onClick={() => void openNote(f.path)}
          title={f.path}
          className={`block w-full truncate rounded px-2 py-0.5 text-left text-sm ${
            f.path === openPath ? 'bg-navy-red-700 text-white' : 'text-gray-300 hover:bg-navy-red-800'
          }`}
          style={{ paddingLeft: 20 + depth * 12 }}
        >
          {noteName(f.path)}
        </button>
      ))}
    </>
  );

  const statusText =
    saveState === 'saving' ? 'saving…'
      : saveState === 'error' ? saveMessage
        : dirty ? 'unsaved'
          : saveState === 'saved' ? 'saved' : '';

  return (
    <div className="flex h-full min-h-0 text-foreground">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-navy-red-700 bg-navy-red-850">
        <div className="space-y-2 border-b border-navy-red-700 p-3">
          <div className="flex overflow-hidden rounded border border-navy-red-700 text-xs">
            {VAULT_NAMES.map((v) => (
              <button
                key={v}
                onClick={() => void switchVault(v)}
                className={`flex-1 px-2 py-1 ${vault === v ? 'bg-navy-red-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {v}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
            placeholder="search the vault (enter)"
            className="w-full rounded border border-navy-red-700 bg-background px-2 py-1 text-sm focus:border-[#b83030] focus:outline-none"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter by name"
            className="w-full rounded border border-navy-red-700 bg-background px-2 py-1 text-sm focus:border-[#b83030] focus:outline-none"
          />
          {newNote === null ? (
            <button onClick={() => setNewNote('')} className="w-full rounded border border-navy-red-700 px-2 py-1 text-sm text-gray-300 hover:border-[#b83030] hover:text-white">
              + new note
            </button>
          ) : (
            <div className="flex gap-1">
              <input
                autoFocus
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void createNote(); if (e.key === 'Escape') setNewNote(null); }}
                placeholder="folder/Note name"
                className="min-w-0 flex-1 rounded border border-navy-red-700 bg-background px-2 py-1 text-sm focus:border-[#b83030] focus:outline-none"
              />
              <button onClick={() => void createNote()} className="rounded bg-[#b83030] px-2 text-sm text-white">add</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {treeError && <div className="p-2 text-sm text-red-300">{treeError}</div>}
          {results !== null ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 text-xs text-gray-500">
                <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
                <button onClick={() => { setResults(null); setQuery(''); }} className="hover:text-white">clear</button>
              </div>
              {results.map((r, i) => (
                <button key={`${r.file}-${i}`} onClick={() => void openNote(r.file)} className="block w-full rounded px-2 py-1 text-left hover:bg-navy-red-800">
                  <div className="truncate text-sm text-gray-200">{noteName(r.file)}</div>
                  <div className="line-clamp-2 text-xs text-gray-500">{r.context}</div>
                </button>
              ))}
            </div>
          ) : filtered ? (
            filtered.map((f) => (
              <button key={f.path} onClick={() => void openNote(f.path)} title={f.path} className="block w-full truncate rounded px-2 py-0.5 text-left text-sm text-gray-300 hover:bg-navy-red-800">
                {f.path.replace(/\.md$/i, '')}
              </button>
            ))
          ) : (
            renderFolder(tree, 0)
          )}
        </div>
        <div className="border-t border-navy-red-700 px-3 py-2 text-xs text-gray-500">{files.length} notes</div>
      </aside>

      {/* Editor */}
      <section className="flex min-w-0 flex-1 flex-col">
        {openPath === null ? (
          <div className="m-auto max-w-sm text-center text-sm text-gray-500">
            {noteError || 'Open a note from the sidebar, search the vault, or create a new note.'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-navy-red-700 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-gray-100">{noteName(openPath)}</div>
                <div className="truncate text-xs text-gray-500">{openPath}</div>
              </div>
              <span className={`text-xs ${saveState === 'error' ? 'text-red-300' : 'text-gray-500'}`}>{statusText}</span>
              <div className="flex overflow-hidden rounded border border-navy-red-700 text-xs">
                {(['edit', 'split', 'preview'] as const).map((m) => (
                  <button key={m} onClick={() => changeMode(m)} className={`px-2 py-1 ${mode === m ? 'bg-navy-red-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                    {m}
                  </button>
                ))}
              </div>
              {vaultRoot && (
                <a
                  href={`obsidian://open?path=${encodeURIComponent(`${vaultRoot}/${openPath}`)}`}
                  className="text-xs text-gray-400 hover:text-white"
                  title="Open this note in the Obsidian app (on this computer)"
                >
                  open in obsidian
                </a>
              )}
            </div>
            {saveState === 'conflict' && (
              <div className="flex flex-wrap items-center gap-3 border-b border-yellow-800 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-200">
                <span>{saveMessage} Your edits are not saved yet.</span>
                <button onClick={reloadFromDisk} className="rounded border border-yellow-700 px-2 py-0.5 hover:bg-yellow-900/50">load the disk version</button>
                <button onClick={() => void save({ force: true })} className="rounded border border-yellow-700 px-2 py-0.5 hover:bg-yellow-900/50">keep mine (overwrite)</button>
              </div>
            )}
            {noteError && <div className="px-4 py-2 text-sm text-red-300">{noteError}</div>}
            <div className="flex min-h-0 flex-1">
              {mode !== 'preview' && (
                <div className={`min-h-0 overflow-auto ${mode === 'split' ? 'w-1/2 border-r border-navy-red-700' : 'w-full'}`}>
                  <CodeMirror
                    value={content}
                    onChange={(v) => setContent(v)}
                    theme="dark"
                    height="100%"
                    basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                    extensions={[markdown()]}
                    className="h-full text-[15px]"
                  />
                </div>
              )}
              {mode !== 'edit' && (
                <div className={`min-h-0 overflow-auto px-6 py-4 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
                  <article className="max-w-none text-[15px] leading-relaxed text-gray-200">
                    {preview.frontmatter && (
                      <pre className="mb-4 rounded border border-navy-red-700 bg-navy-red-850 p-2 text-xs text-gray-400">{preview.frontmatter}</pre>
                    )}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      urlTransform={(url) => (url.startsWith(WIKILINK_SCHEME) ? url : defaultUrlTransform(url))}
                      components={{
                        ...markdownComponents,
                        a: ({ href, children }: { href?: string; children?: ReactNode }) => {
                          if (href?.startsWith(WIKILINK_SCHEME)) {
                            const target = decodeURIComponent(href.slice(WIKILINK_SCHEME.length));
                            const exists = resolveWikilink(target, index, openPath ?? undefined) !== null;
                            return (
                              <button
                                onClick={() => followWikilink(target)}
                                className={`underline decoration-dotted ${exists ? 'text-[#e06c6c]' : 'text-gray-500'}`}
                                title={exists ? target : `${target} (no such note yet; click to create)`}
                              >
                                {children}
                              </button>
                            );
                          }
                          return <a href={href} className="text-navy-red-300 underline hover:text-navy-red-200" target="_blank" rel="noopener noreferrer">{children}</a>;
                        },
                      }}
                    >
                      {preview.markdown}
                    </ReactMarkdown>
                  </article>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
