'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useReadAlongAlignment } from '@/lib/read-along/use-read-along';
import { useAnnotationWorkspace } from '@/lib/reader-workspace/use-annotation-workspace';
import { CommentMargin } from './reader/CommentMargin';
import { CommentPopover } from './reader/CommentPopover';

// ============================================================================
// Types
// ============================================================================

export interface ArticleSession {
  id: string;
  title: string;
  content: string;
  url?: string;
}

export interface ArticleReaderConfig {
  title: string;
  storageKey: string;
  currentSessionKey: string;
  searchPlaceholder: string;
  emptyStateMessage: string;
  contentClassName: string;
  apiEndpoint: string;
  unwantedSelectors: string[];
  parseLinkClick: (href: string) => string | null;
  renderSuggestions?: (props: { query: string; show: boolean; onSelect: (value: string) => void }) => ReactNode;
  renderTitleExtra?: (session: ArticleSession) => ReactNode;
  contentStyles: string;
  lightContent?: boolean;
  hideHeader?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

const TTS_STRIP_SELECTORS = [
  'style', 'script', 'noscript',
  '.infobox', '.infobox_v2', '.sidebar', '.navbox', '.vertical-navbox',
  '.metadata', '.mw-editsection', '.hatnote', '.toc',
  '.reference', 'sup.reference', '.reflist', '.refbegin',
  '.thumb', '.thumbinner', '.gallery', '.mw-empty-elt',
  '.mbox-small', '.ambox', '.ombox', '.tmbox', '.cmbox', '.fmbox', '.imbox',
  '.sistersitebox', '.noprint', '.mw-authority-control',
  '.catlinks', '.printfooter', '.mw-jump-link',
  'table',
  '.toc', '.footnotes', '.bibliography',
];

function extractSentences(html: string, unwanted: string[]): { sentences: string[]; paragraphBreaks: Set<number>; headingIndices: Set<number>; listItemIndices: Set<number> } {
  const div = document.createElement('div');
  div.innerHTML = html;
  const allSelectors = Array.from(new Set([...unwanted, ...TTS_STRIP_SELECTORS]));
  allSelectors.forEach(sel => {
    try { div.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
  });

  // Collect heading and list item text before extraction
  const headingTexts = new Set<string>();
  const listItemTexts = new Set<string>();
  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) headingTexts.add(t);
  });
  div.querySelectorAll('li').forEach(el => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) listItemTexts.add(t);
  });

  // Extract text per block element for proper paragraph boundaries
  const blocks: { text: string; tag: string }[] = [];
  const blockEls = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');

  if (blockEls.length > 0) {
    const seen = new Set<string>();
    blockEls.forEach(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !seen.has(t)) {
        // Skip parent blocks that contain child blocks (avoid double-counting)
        const childBlocks = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
        if (childBlocks.length === 0 || /^(LI|BLOCKQUOTE)$/.test(el.tagName)) {
          blocks.push({ text: t, tag: el.tagName.toLowerCase() });
          seen.add(t);
        }
      }
    });
  }

  // Fallback: use full text as one block
  if (blocks.length === 0) {
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ text, tag: 'p' });
  }

  // Split each block into sentences
  const sentences: string[] = [];
  const paragraphBreaks = new Set<number>();
  const headingIndices = new Set<number>();
  const listItemIndices = new Set<number>();

  for (const block of blocks) {
    const isHeadingBlock = /^h[1-6]$/.test(block.tag);
    const isListItem = block.tag === 'li';

    if (isHeadingBlock) {
      // Headings are always their own sentence
      const idx = sentences.length;
      paragraphBreaks.add(idx);
      headingIndices.add(idx);
      sentences.push(block.text);
      continue;
    }

    // Split block into sentences
    const blockSentences = block.text
      .split(/(?<=[.!?])\s+(?=[A-Z""\u201C])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (blockSentences.length > 0) {
      paragraphBreaks.add(sentences.length);

      for (const sent of blockSentences) {
        const idx = sentences.length;
        if (isListItem) listItemIndices.add(idx);
        sentences.push(sent);
      }
    }
  }

  return { sentences, paragraphBreaks, headingIndices, listItemIndices };
}

// ============================================================================
// Component
// ============================================================================

export function ArticleReader({ config }: { config: ArticleReaderConfig }) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [sessions, setSessions] = useState<ArticleSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sentences, setSentences] = useState<string[]>([]);
  const [paragraphBreaks, setParagraphBreaks] = useState<Set<number>>(new Set());
  const [headingIndices, setHeadingIndices] = useState<Set<number>>(new Set());
  const [listItemIndices, setListItemIndices] = useState<Set<number>>(new Set());
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // Read-along (voice-follows-reader) mode. You read aloud; Chrome STT tracks
  // your position and the highlight follows you.
  const [readAlongMode, setReadAlongMode] = useState(false);
  const readAlong = useReadAlongAlignment(sentences, {
    docId: currentSessionId || undefined,
    docTitle: currentSession?.title,
    headingIndices,
  });

  // When read-along is active, drive the highlight from its pointer.
  useEffect(() => {
    if (readAlongMode) setCurrentSentenceIndex(readAlong.pointer);
  }, [readAlongMode, readAlong.pointer]);

  const toggleReadAlong = () => {
    if (readAlongMode) {
      readAlong.stop();
      setReadAlongMode(false);
    } else {
      readAlong.start();
      setReadAlongMode(true);
    }
  };

  // ── Notes / annotations ───────────────────────────────────────────────────
  // The exact same workspace the EPUB reader uses, so Wikipedia, SEP, and any
  // article source get highlight-to-note with Obsidian Book_Note sync. Notes
  // key off the session id (docId) and persist locally + to the vault.
  const scrollRef = useRef<HTMLDivElement>(null);
  const workspace = useAnnotationWorkspace({
    docId: currentSessionId ?? null,
    docTitle: currentSession?.title ?? null,
    sentenceCount: sentences.length,
    sentences,
    onSelectionPauseReadAlong: () => {
      if (readAlongMode) {
        readAlong.stop();
        setReadAlongMode(false);
      }
    },
  });

  // A completed, non-empty text selection opens the comment popover.
  const handleSelectionMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (sel.toString().trim().length === 0) return;
    const container = contentRef.current;
    if (!container) return;
    workspace.beginSelection(sel.getRangeAt(0), container);
  };

  // Sentence index → isActive, so each sentence can paint a persistent
  // annotation highlight (mirrors TextDisplay's annotationCover).
  const annotationCover = new Map<number, boolean>();
  for (const a of workspace.annotations) {
    const isActive = a.id === workspace.activeThreadId;
    for (let i = a.startSentenceIndex; i <= a.endSentenceIndex; i++) {
      annotationCover.set(i, (annotationCover.get(i) ?? false) || isActive);
    }
  }

  // Load sessions from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(config.storageKey);
      const savedId = localStorage.getItem(config.currentSessionKey);
      if (saved) {
        let parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Migrate old timestamp-based IDs to sanitized title IDs
          let migrated = false;
          parsed = parsed.map((s: ArticleSession) => {
            if (/^\d+$/.test(s.id) && s.title) {
              migrated = true;
              return { ...s, id: s.title.replace(/[<>:"/\\|?*]/g, '_') };
            }
            return s;
          });
          // Deduplicate by ID after migration (in case two timestamps mapped to same title)
          const seen = new Set<string>();
          parsed = parsed.filter((s: ArticleSession) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });
          setSessions(parsed);
          if (migrated) {
            try { localStorage.setItem(config.storageKey, JSON.stringify(parsed)); } catch {}
          }
          // Resolve saved current session ID (might have been a timestamp)
          if (savedId) {
            const match = parsed.find((s: ArticleSession) => s.id === savedId);
            if (match) {
              setCurrentSessionId(match.id);
            } else {
              // savedId was a timestamp — find by checking if any session's title sanitizes to match
              const migratedMatch = parsed.find((s: ArticleSession) => s.title && s.title.replace(/[<>:"/\\|?*]/g, '_') === s.id);
              if (migratedMatch) setCurrentSessionId(migratedMatch.id);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[${config.title}] Failed to load sessions from localStorage:`, err);
    }
  }, [config.storageKey, config.currentSessionKey]);

  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem(config.storageKey, JSON.stringify(sessions));
      } catch (err) {
        // localStorage quota exceeded — article HTML can be large
        console.error(`[${config.title}] Failed to save sessions to localStorage (quota exceeded?):`, err);
      }
    }
  }, [sessions, config.storageKey]);

  useEffect(() => {
    if (currentSessionId) localStorage.setItem(config.currentSessionKey, currentSessionId);
  }, [currentSessionId, config.currentSessionKey]);

  // Extract sentences when session changes
  useEffect(() => {
    if (currentSession) {
      const { sentences: extracted, paragraphBreaks: breaks, headingIndices: heads, listItemIndices: items } = extractSentences(currentSession.content, config.unwantedSelectors);
      console.log(`[extractSentences] ${extracted.length} sentences, ${heads.size} headings, ${items.size} list items`);
      console.log(`[extractSentences] first 5:`, extracted.slice(0, 5));
      setSentences(extracted);
      setParagraphBreaks(breaks);
      setHeadingIndices(heads);
      setListItemIndices(items);
      setCurrentSentenceIndex(0);
    } else {
      setSentences([]);
      setParagraphBreaks(new Set());
      setHeadingIndices(new Set());
      setListItemIndices(new Set());
      setCurrentSentenceIndex(0);
    }
  }, [currentSession?.id]);

  // Highlight current sentence
  // Build HTML with sentence anchors injected
  const [, setProcessedHtml] = useState('');

  useEffect(() => {
    if (currentSession) {
      setProcessedHtml(currentSession.content);
    } else {
      setProcessedHtml('');
    }
  }, [currentSession?.id]);

  // Scroll to current sentence — but only when it's actually out of the
  // comfortable viewport, so smooth reading doesn't get yanked every sentence.
  useEffect(() => {
    if (!contentRef.current || sentences.length === 0 || currentSentenceIndex < 0) return;
    const el = contentRef.current.querySelector(`[data-sentence-index="${currentSentenceIndex}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    // Keep the active sentence within the middle band of the screen; only
    // scroll if it drifts into the top 20% or bottom 30%.
    const tooHigh = rect.top < vh * 0.2;
    const tooLow = rect.bottom > vh * 0.7;
    if (tooHigh || tooLow) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSentenceIndex, sentences]);

  const handleLinkClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A') {
      e.preventDefault();
      const query = config.parseLinkClick((target as HTMLAnchorElement).href);
      if (query) await searchArticle(query);
      return;
    }
    // A plain click (not a drag-select) on a sentence.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
    const sentEl = target.closest('[data-sentence-index]');
    if (sentEl) {
      const idx = Number.parseInt(sentEl.getAttribute('data-sentence-index') || '', 10);
      if (Number.isInteger(idx)) {
        // While reading aloud, click the sentence you're actually on to snap the
        // read-along pointer back — the manual recovery when STT loses track on a
        // hard word. Otherwise, click an annotated passage to open its note.
        if (readAlongMode) {
          readAlong.seekTo(idx);
          setCurrentSentenceIndex(idx);
          return;
        }
        const covering = workspace.annotations.find(
          (a) => idx >= a.startSentenceIndex && idx <= a.endSentenceIndex,
        );
        if (covering) workspace.setActiveThread(covering.id);
      }
    }
  };

  const searchArticle = async (query?: string) => {
    const searchTerm = query || searchQuery;
    if (!searchTerm.trim()) return;
    const existing = sessions.find(s => s.title.toLowerCase() === searchTerm.toLowerCase());
    if (existing) { setCurrentSessionId(existing.id); setSearchQuery(''); setShowSuggestions(false); return; }
    setLoading(true); setError(null); setShowSuggestions(false);
    try {
      const res = await fetch(`${config.apiEndpoint}?q=${encodeURIComponent(searchTerm)}`);
      if (!res.ok) throw new Error('Failed to fetch article');
      const data = await res.json();
      const existingByTitle = sessions.find(s => s.title.toLowerCase() === data.title.toLowerCase());
      if (existingByTitle) { setCurrentSessionId(existingByTitle.id); setSearchQuery(''); return; }
      // Use sanitized title as ID to match audiobook folder naming (same as EPUB reader)
      const sanitizedId = data.title.replace(/[<>:"/\\|?*]/g, '_');
      const newSession: ArticleSession = { id: sanitizedId, title: data.title, content: data.content, url: data.url };
      setSessions(prev => [...prev, newSession]);
      setCurrentSessionId(newSession.id);
      setSearchQuery('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load article'); }
    finally { setLoading(false); }
  };

  const deleteSession = (id: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      if (updated.length === 0) { localStorage.removeItem(config.storageKey); localStorage.removeItem(config.currentSessionKey); }
      return updated;
    });
    if (currentSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setCurrentSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  const lt = config.lightContent;

  return (
    <div className={`flex ${config.hideHeader ? 'h-full' : 'h-screen'} flex-col min-h-0`} style={{ background: lt ? '#f8f9fa' : '#000000' }}>
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto" ref={scrollRef} onMouseUp={handleSelectionMouseUp}>
          <div className="flex">
          <div className="flex-1 min-w-0">
          <div className={lt ? 'max-w-[960px] mx-auto px-6 md:px-10 py-6' : 'max-w-[1600px] mx-auto px-16 py-8'}>
            {/* Search */}
            <div className="mb-6 relative">
              <input
                type="text" value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
                onKeyPress={(e) => e.key === 'Enter' && searchArticle()}
                onFocus={() => searchQuery && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder={config.searchPlaceholder}
                className={lt
                  ? 'w-full px-4 py-2.5 bg-white text-[#202122] border border-[#a2a9b1] rounded-sm focus:outline-none focus:border-[#36c] text-sm'
                  : 'w-full px-6 py-4 bg-[#0a0a0a] text-white border border-[#1a1a1a] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#b83030] text-lg'}
              />
              {config.renderSuggestions?.({ query: searchQuery, show: showSuggestions, onSelect: (v) => { setSearchQuery(v); searchArticle(v); } })}
            </div>

            {error && <div className={lt ? 'mb-6 p-4 bg-[#fee7e6] border border-[#d33] rounded text-[#d33] text-sm' : 'mb-8 p-5 bg-[#1a0000] border border-[#4a0000] rounded-lg text-[#ff6b6b]'}>{error}</div>}
            {loading && <div className="flex items-center justify-center py-20"><div className={lt ? 'text-[#54595d] text-sm' : 'text-white text-lg'}>Loading article...</div></div>}

            {!loading && currentSession && (
              <div className={lt ? 'bg-white rounded-lg border border-[#a7d7f9] shadow-sm' : 'bg-[#0a0a0a] rounded-lg border border-[#1a1a1a]'}>
                <div className="px-12 md:px-20 py-10">
                  <h1 className={`font-serif mb-1 ${lt ? 'text-[#000] text-3xl font-normal border-b border-[#a2a9b1] pb-1' : 'text-5xl font-bold text-white mb-3'}`}>
                    {currentSession.title}
                  </h1>
                  <div className="flex items-center gap-3 mb-2 mt-2">
                    <button
                      onClick={() => {
                        const d = document.createElement('div'); d.innerHTML = currentSession.content;
                        config.unwantedSelectors.forEach(sel => { try { d.querySelectorAll(sel).forEach(el => el.remove()); } catch {} });
                        TTS_STRIP_SELECTORS.forEach(sel => { try { d.querySelectorAll(sel).forEach(el => el.remove()); } catch {} });
                        const text = (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
                        router.push(`/chat?context=${encodeURIComponent(`I'm reading "${currentSession.title}". Here's the beginning:\n\n${text}...\n\nCan you help me understand or discuss this?`)}`);
                      }}
                      className={lt ? 'px-3 py-1.5 bg-[#36c] hover:bg-[#447ff5] text-white text-xs rounded transition-colors' : 'px-4 py-2 bg-[#b83030] hover:bg-[#d84848] text-white text-sm rounded-lg transition-colors'}
                    >Ask AI</button>
                    {sentences.length > 0 && <span className="text-xs text-gray-500">{currentSentenceIndex + 1} / {sentences.length} sentences</span>}
                  </div>
                  {config.renderTitleExtra?.(currentSession)}
                  <div className={lt ? 'border-t border-[#a2a9b1] pt-4 mt-4' : 'border-t-2 border-[#2a2a2a] pt-8 mt-6'}>
                    <div ref={contentRef} className={config.contentClassName} onClick={handleLinkClick}>
                      {sentences.length > 0 ? (
                        <div>
                          {sentences.map((sentence, idx) => {
                            const isHighlighted = idx === currentSentenceIndex;
                            // In read-along mode, show a soft persistent trail
                            // on already-read sentences plus a brighter current.
                            const raState = readAlongMode ? readAlong.states[idx] : 'unread';
                            const isCurrent = readAlongMode
                              ? idx === readAlong.pointer
                              : isHighlighted;

                            // box-decoration-break makes multi-line highlights
                            // render as one continuous shape instead of broken
                            // fragments at each line wrap.
                            const cleanBg = (bg: string): React.CSSProperties => ({
                              backgroundColor: bg,
                              borderRadius: '2px',
                              boxDecorationBreak: 'clone',
                              WebkitBoxDecorationBreak: 'clone',
                            });

                            let highlightStyle: React.CSSProperties = {};
                            // Persistent note highlight (under read-along/TTS).
                            if (annotationCover.has(idx)) {
                              highlightStyle = cleanBg(
                                annotationCover.get(idx)
                                  ? (lt ? '#ffd9d9' : 'rgba(194, 32, 32, 0.38)')
                                  : (lt ? '#ffecec' : 'rgba(194, 32, 32, 0.18)'),
                              );
                            }
                            if (readAlongMode) {
                              if (isCurrent) {
                                highlightStyle = cleanBg(lt ? '#ffe9a8' : 'rgba(184, 48, 48, 0.50)');
                              } else if (raState === 'read_aloud' && !annotationCover.has(idx)) {
                                highlightStyle = cleanBg(lt ? '#f5f0dd' : 'rgba(120, 120, 130, 0.16)');
                              }
                            } else if (isHighlighted) {
                              highlightStyle = cleanBg(lt ? '#fff3bf' : 'rgba(184, 48, 48, 0.42)');
                            }

                            if (headingIndices.has(idx)) {
                              return (
                                <h2 key={idx} data-sentence-index={idx} style={{ fontSize: '1.4em', fontWeight: 600, marginTop: '1.5em', marginBottom: '0.5em', transition: 'background-color 0.3s ease', ...highlightStyle }}>
                                  {sentence}
                                </h2>
                              );
                            }

                            if (listItemIndices.has(idx)) {
                              return (
                                <div key={idx} data-sentence-index={idx} style={{ paddingLeft: '1.5em', marginBottom: '0.25em', transition: 'background-color 0.3s ease', ...highlightStyle }}>
                                  • {sentence}
                                </div>
                              );
                            }

                            return (
                              <span key={idx}>
                                {paragraphBreaks.has(idx) && idx > 0 && <><br /><br /></>}
                                <span
                                  data-sentence-index={idx}
                                  style={{ transition: 'background-color 0.3s ease', ...highlightStyle }}
                                >
                                  {sentence}
                                </span>{' '}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <div dangerouslySetInnerHTML={{ __html: currentSession.content }} />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!loading && !currentSession && (
              <div className={`flex flex-col items-center justify-center py-20 ${lt ? 'text-[#72777d]' : 'text-gray-500'}`}>
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-base">{config.emptyStateMessage}</p>
              </div>
            )}
          </div>
          </div>
          {workspace.annotations.length > 0 && (
            <CommentMargin
              annotations={workspace.annotations}
              activeThreadId={workspace.activeThreadId}
              aiStatus={workspace.aiStatus}
              syncStatus={workspace.syncStatus}
              scrollContainerRef={scrollRef}
              onSelectThread={workspace.setActiveThread}
              onRequestAi={workspace.requestAiReply}
              onEdit={workspace.editAnnotation}
              onEditSelectedText={workspace.editSelectedText}
              onDelete={workspace.deleteAnnotation}
              onRetrySync={workspace.retrySync}
            />
          )}
          </div>
        </div>

        {/* Sessions Sidebar */}
        <div className="w-80 bg-[#0a0a0a] border-l border-[#1a1a1a] flex flex-col" style={{ height: '100%' }}>
          <div className="p-6 flex-1 overflow-y-auto text-[1.05rem]" style={{ minHeight: 0 }}>
            <h2 className="text-xl font-bold text-white mb-4">Sessions</h2>
            {sessions.length === 0 ? (
              <p className="text-gray-500 text-sm">No sessions yet</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div key={session.id} className={`p-4 rounded-lg border cursor-pointer transition-colors ${currentSessionId === session.id ? 'bg-[#1a1a1a] border-[#b83030]' : 'bg-[#050505] border-[#1a1a1a] hover:border-[#2a2a2a]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div onClick={() => setCurrentSessionId(session.id)} className="flex-1 min-w-0">
                        <h3 className="text-white font-medium text-sm truncate">{session.title}</h3>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }} className="text-gray-500 hover:text-red-500 transition-colors flex-shrink-0" title="Delete session">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-[#1a1a1a] bg-[#0a0a0a] flex flex-col gap-3" style={{ flexShrink: 0 }}>
            {currentSession && sentences.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={toggleReadAlong}
                  disabled={!readAlong.isSupported}
                  title={readAlong.isSupported ? 'Read aloud — the highlight follows your voice' : 'Read-along needs Chrome (Web Speech API)'}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    !readAlong.isSupported
                      ? 'bg-[#141414] text-gray-600 cursor-not-allowed'
                      : readAlongMode
                        ? 'bg-[#b83030] text-white hover:bg-[#d84848] shadow-[0_0_0_1px_rgba(184,48,48,0.4)]'
                        : 'bg-[#141414] text-[#c8ccd1] border border-[#2a2a2a] hover:border-[#b83030] hover:text-white'
                  }`}
                >
                  {readAlongMode ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                      </span>
                      Stop Read-along
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                      </svg>
                      Read-along
                    </>
                  )}
                </button>

                {readAlongMode && (
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className={readAlong.mode === 'question' ? 'text-[#ffb454]' : 'text-gray-400'}>
                      {readAlong.mode === 'question'
                        ? 'off-script — ask away'
                        : readAlong.status === 'listening'
                          ? 'listening…'
                          : readAlong.status}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {Math.min(readAlong.pointer + 1, sentences.length)} / {sentences.length}
                    </span>
                  </div>
                )}

                {readAlong.pendingQA && (
                  <div className="text-xs text-[#ffd9a0] px-3 py-2 bg-[#1a1200] border border-[#3a2a00] rounded-lg">
                    <div className="text-[#ffb454] font-medium mb-0.5">heard a question</div>
                    <div className="text-gray-300 italic mb-1.5">“{readAlong.pendingQA.utterance.slice(0, 80)}”</div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => readAlong.askQuestion(readAlong.pendingQA!.utterance, readAlong.pendingQA!.anchorIndex).then(() => readAlong.clearPendingQA())}
                        className="text-[#6b9eff] hover:text-[#8ab4ff] font-medium"
                      >ask AI</button>
                      <button
                        onClick={() => readAlong.clearPendingQA()}
                        className="text-gray-500 hover:text-white"
                      >dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comment popover for an active text selection (note-taking). */}
      {workspace.pendingPopover && (
        <CommentPopover
          pending={workspace.pendingPopover}
          onChangeText={workspace.setPendingText}
          onCommit={workspace.commitPending}
          onToggleLink={() =>
            workspace.setPendingLink(!workspace.pendingPopover!.linkEnabled)
          }
          onChangeLinkTarget={workspace.setPendingLinkTarget}
        />
      )}

      <style jsx global>{`${config.contentStyles}`}</style>
    </div>
  );
}
