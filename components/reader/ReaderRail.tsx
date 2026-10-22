'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { ReadingSourceType } from '@/lib/reader-sources/types';
import type { Annotation, AiState, SyncState } from '@/lib/reader-workspace/types';
import { CommentThread } from './CommentThread';

/** A single Library entry — a book or article you're reading, any source. */
export interface RailLibraryItem {
  id: string;
  type: ReadingSourceType;
  title: string;
  /** Short meta line, e.g. "Chapter 3 · 2h ago" or "Wikipedia". */
  subtitle: string;
}

const TYPE_LABEL: Record<ReadingSourceType, string> = {
  epub: 'Book',
  wikipedia: 'Wiki',
  sep: 'SEP',
  iep: 'IEP',
  pdf: 'PDF',
};

/**
 * ReaderRail — the unified right rail for the reader.
 * Feature: unified-reader
 *
 * Replaces the two separate panels that used to compete for space (the reading
 * sessions sidebar and the floating comments margin) with ONE collapsible rail
 * that tabs between:
 *  - Library: everything you're reading (reading sessions).
 *  - Comments: the annotation threads for the open document.
 *
 * The Library is the future home of the cross-source unification — today it
 * lists this reader's sessions; the same list will aggregate EPUB, Wikipedia,
 * SEP, and PDF sources.
 */

type RailTab = 'library' | 'comments';

interface ReaderRailProps {
  // ── Library ────────────────────────────────────────────────────────────
  libraryItems: RailLibraryItem[];
  currentItemId: string | null;
  onOpenItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  isLoading?: boolean;
  /** Search a source and open the result. When omitted, the search box hides. */
  onSearch?: (query: string, type: 'wikipedia' | 'sep' | 'iep') => Promise<void> | void;
  // ── Comments ───────────────────────────────────────────────────────────
  annotations: Annotation[];
  activeThreadId: string | null;
  aiStatus: Record<string, AiState>;
  syncStatus: Record<string, SyncState>;
  onSelectThread: (id: string | null) => void;
  /** Create a standalone note (no highlight) at the reader's current position. */
  onAddNote?: (text: string) => void;
  onRequestAi: (id: string, followUp?: string) => void;
  onEditAnnotation: (id: string, comment: string) => void;
  onEditSelectedText: (id: string, text: string) => void;
  onEditLinkTarget: (id: string, target: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onRetrySync: (id: string) => void;
  /** Document sentences — used to order comments by intra-sentence position. */
  sentences?: string[];
  // ── Rail ───────────────────────────────────────────────────────────────
  onCollapse: () => void;
  /** Save the currently-open article to both vaults. Returns paths and stats. */
  onSaveArticleToVault?: () => Promise<{
    articlePath: string;
    articleCreated: boolean;
    linksInjected: number;
  }>;
}

export function ReaderRail({
  libraryItems,
  currentItemId,
  onOpenItem,
  onDeleteItem,
  isLoading = false,
  onSearch,
  annotations,
  activeThreadId,
  aiStatus,
  syncStatus,
  onSelectThread,
  onAddNote,
  onRequestAi,
  onEditAnnotation,
  onEditSelectedText,
  onEditLinkTarget,
  onDeleteAnnotation,
  onRetrySync,
  sentences = [],
  onCollapse,
  onSaveArticleToVault,
}: ReaderRailProps) {
  const [tab, setTab] = useState<RailTab>('library');
  const [query, setQuery] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [searchType, setSearchType] = useState<'wikipedia' | 'sep' | 'iep'>('wikipedia');
  const [searching, setSearching] = useState(false);
  const [vaultState, setVaultState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [vaultSave, setVaultSave] = useState<{
    articlePath: string;
    articleCreated: boolean;
    linksInjected: number;
  } | null>(null);
  const vaultResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Clicking a highlight in the text selects its thread — pull it up in the rail:
  // jump to the Comments tab and scroll the thread into view.
  useEffect(() => {
    if (activeThreadId) setTab('comments');
  }, [activeThreadId]);
  useEffect(() => {
    if (!activeThreadId || tab !== 'comments') return;
    const el = bodyRef.current?.querySelector(`[data-thread-id="${CSS.escape(activeThreadId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeThreadId, tab, annotations.length]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q || !onSearch || searching) return;
    setSearching(true);
    try {
      await onSearch(q, searchType);
      setQuery('');
    } finally {
      setSearching(false);
    }
  };

  // Order comments by where they appear in the article, top to bottom:
  // sentence span first, then position within the starting sentence (so two
  // highlights in the same sentence read left-to-right), then creation time.
  const sortedAnnotations = [...annotations].sort((a, b) => {
    if (a.startSentenceIndex !== b.startSentenceIndex) {
      return a.startSentenceIndex - b.startSentenceIndex;
    }
    if (a.endSentenceIndex !== b.endSentenceIndex) {
      return a.endSentenceIndex - b.endSentenceIndex;
    }
    const sentence = sentences[a.startSentenceIndex] ?? '';
    const rawA = sentence.indexOf(a.selectedText ?? '');
    const rawB = sentence.indexOf(b.selectedText ?? '');
    const posA = rawA < 0 ? Number.MAX_SAFE_INTEGER : rawA;
    const posB = rawB < 0 ? Number.MAX_SAFE_INTEGER : rawB;
    if (posA !== posB) return posA - posB;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });

  // Filter comments by note text, the quoted passage, the link target, and any
  // AI reply content — so a search finds the thread no matter where the words are.
  const cq = commentQuery.trim().toLowerCase();
  const visibleAnnotations = cq
    ? sortedAnnotations.filter((a) => {
        const haystack = [
          a.comment ?? '',
          a.selectedText ?? '',
          a.linkTarget ?? '',
          ...(a.aiReplies ?? []).map((r) => r.content ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(cq);
      })
    : sortedAnnotations;

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeleteItem(id); // no browser confirm — click delete, it's gone
  };

  const handleSaveToVault = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSaveArticleToVault || vaultState === 'saving') return;
    if (vaultResetTimer.current) clearTimeout(vaultResetTimer.current);
    setVaultState('saving');
    try {
      const result = await onSaveArticleToVault();
      setVaultSave({
        articlePath: result.articlePath,
        articleCreated: result.articleCreated,
        linksInjected: result.linksInjected,
      });
      setVaultState('saved');
    } catch (err) {
      console.error('[vault] save failed:', err);
      setVaultSave(null);
      setVaultState('error');
    }
    vaultResetTimer.current = setTimeout(() => setVaultState('idle'), 6000);
  };

  return (
    <div className="reader-rail">
      {/* Tab header */}
      <div className="rail-header">
        <div className="rail-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'library'}
            className={`rail-tab ${tab === 'library' ? 'active' : ''}`}
            onClick={() => setTab('library')}
          >
            Library
            <span className="tab-count">{libraryItems.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'comments'}
            className={`rail-tab ${tab === 'comments' ? 'active' : ''}`}
            onClick={() => setTab('comments')}
          >
            Comments
            {annotations.length > 0 && <span className="tab-count">{annotations.length}</span>}
          </button>
        </div>
        <button
          className="rail-collapse"
          onClick={onCollapse}
          aria-label="Hide panel"
          title="Hide panel"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      </div>

      {/* Vault save status banner */}
      {vaultState !== 'idle' && (
        <div className={`vault-banner vault-banner-${vaultState}`}>
          {vaultState === 'saving' && 'Saving to vault…'}
          {vaultState === 'saved' && vaultSave && (
            <span>
              ✓ {vaultSave.articleCreated ? 'Saved' : 'Updated'} —{' '}
              <code className="vault-path">{vaultSave.articlePath.split(/[\\/]/).pop()}</code>
              {vaultSave.linksInjected > 0 && ` · ${vaultSave.linksInjected} link${vaultSave.linksInjected !== 1 ? 's' : ''}`}
            </span>
          )}
          {vaultState === 'error' && '✗ Save failed — check console'}
        </div>
      )}

      {/* Pinned comments toolbar — note composer + search stay visible no
          matter how far the thread list below is scrolled. */}
      {tab === 'comments' && (onAddNote || sortedAnnotations.length > 0) && (
        <div className="rail-pinned">
          {onAddNote && (
            <input
              className="note-input"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && noteDraft.trim()) {
                  e.preventDefault();
                  onAddNote(noteDraft.trim());
                  setNoteDraft('');
                }
                if (e.key === 'Escape') setNoteDraft('');
              }}
              placeholder="Add a note… (no highlight needed)"
              aria-label="Add a standalone note"
            />
          )}
          {sortedAnnotations.length > 0 && (
            <div className="rail-search">
              <input
                className="rail-search-input"
                value={commentQuery}
                onChange={(e) => setCommentQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setCommentQuery('');
                }}
                placeholder="Search comments…"
                aria-label="Search comments"
              />
              {commentQuery && (
                <button
                  type="button"
                  className="rail-search-clear"
                  onClick={() => setCommentQuery('')}
                  aria-label="Clear comment search"
                  title="Clear"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="rail-body" ref={bodyRef}>
        {tab === 'library' ? (
          <div className="rail-list">
            {onSearch && (
              <div className="rail-search">
                <input
                  className="rail-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      runSearch();
                    }
                  }}
                  placeholder={searching ? 'Searching…' : `Search ${searchType === 'sep' ? 'SEP' : searchType === 'iep' ? 'IEP' : 'Wikipedia'}…`}
                  disabled={searching}
                  aria-label="Search for an article"
                />
                <div className="rail-search-toggle">
                  <button
                    type="button"
                    className={searchType === 'wikipedia' ? 'active' : ''}
                    onClick={() => setSearchType('wikipedia')}
                  >
                    Wiki
                  </button>
                  <button
                    type="button"
                    className={searchType === 'sep' ? 'active' : ''}
                    onClick={() => setSearchType('sep')}
                  >
                    SEP
                  </button>
                  <button
                    type="button"
                    className={searchType === 'iep' ? 'active' : ''}
                    onClick={() => setSearchType('iep')}
                  >
                    IEP
                  </button>
                </div>
              </div>
            )}
            {isLoading && (
              <div className="loading-overlay">
                <div className="spinner" />
                <p>Loading…</p>
              </div>
            )}
            {libraryItems.length === 0 ? (
              <div className="rail-empty">
                <p>Your library is empty</p>
                <span>Open a book or article to get started</span>
              </div>
            ) : (
              libraryItems.map((item) => (
                <div
                  key={item.id}
                  className={`session-item ${item.id === currentItemId ? 'active' : ''}`}
                  onClick={() => onOpenItem(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenItem(item.id);
                    }
                  }}
                >
                  <div className="session-content">
                    <div className="session-title-row">
                      <span className={`type-badge type-${item.type}`}>{TYPE_LABEL[item.type]}</span>
                      <span className="session-title">{item.title}</span>
                    </div>
                    <div className="session-meta">{item.subtitle}</div>
                  </div>
                  {item.id === currentItemId && item.type !== 'epub' && onSaveArticleToVault && (
                    <button
                      className={`session-vault vault-${vaultState}`}
                      onClick={handleSaveToVault}
                      aria-label="Save article to Obsidian vault"
                      title={
                        vaultState === 'saving' ? 'Saving…'
                        : vaultState === 'saved' ? 'Saved!'
                        : vaultState === 'error' ? 'Save failed'
                        : 'Save to vault'
                      }
                      disabled={vaultState === 'saving'}
                    >
                      {vaultState === 'saving' ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{animation: 'rail-spin 0.8s linear infinite'}}>
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 6v6l4 2" />
                        </svg>
                      ) : vaultState === 'saved' ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" />
                          <path d="M2 17l10 5 10-5" />
                          <path d="M2 12l10 5 10-5" />
                        </svg>
                      )}
                    </button>
                  )}
                  <button
                    className="session-delete"
                    onClick={(e) => handleDelete(e, item.id)}
                    aria-label={`Remove ${item.title}`}
                    title="Remove from library"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="rail-list rail-comments">
            {sortedAnnotations.length === 0 ? (
              <div className="rail-empty">
                <p>No comments yet</p>
                <span>Highlight any text — or write a note above</span>
              </div>
            ) : (
              <>
                {visibleAnnotations.length === 0 ? (
                  <div className="rail-empty">
                    <p>No matching comments</p>
                    <span>Nothing matches “{commentQuery.trim()}”</span>
                  </div>
                ) : (
                  visibleAnnotations.map((a) => (
                    <div key={a.id} data-thread-id={a.id}>
                    <CommentThread
                      annotation={a}
                      active={activeThreadId === a.id}
                      aiState={aiStatus[a.id] ?? 'idle'}
                      syncState={syncStatus[a.id] ?? 'idle'}
                      onSelect={() => onSelectThread(a.id)}
                      onRequestAi={(followUp) => onRequestAi(a.id, followUp)}
                      onEdit={(comment) => onEditAnnotation(a.id, comment)}
                      onEditSelectedText={(text) => onEditSelectedText(a.id, text)}
                      onEditLinkTarget={(target) => onEditLinkTarget(a.id, target)}
                      onDelete={() => onDeleteAnnotation(a.id)}
                      onRetrySync={() => onRetrySync(a.id)}
                    />
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        /* The rail follows the reading surface: every color derives from the
           --reader-* theme variables (set on the panel by the page), so
           switching the reader theme restyles the rail with it. */
        .reader-rail {
          --rr-line: color-mix(in srgb, var(--reader-text, #d7d3d0) 12%, transparent);
          --rr-field: color-mix(in srgb, var(--reader-text, #d7d3d0) 7%, transparent);
          --rr-hover: color-mix(in srgb, var(--reader-text, #d7d3d0) 10%, transparent);
          --rr-accent: var(--reader-accent, #b83030);
          --rr-tint: color-mix(in srgb, var(--reader-accent, #b83030) 12%, transparent);
          --rr-text: var(--reader-text, #d7d3d0);
          --rr-heading: var(--reader-heading, #f5f3f2);
          --rr-muted: var(--reader-muted, #9a938f);
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--reader-bg, #1a0505);
          border-left: 1px solid var(--rr-line);
          overflow: hidden;
          color: var(--rr-text);
        }
        .rail-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid var(--rr-line);
          gap: 0.5rem;
        }
        .rail-tabs {
          display: flex;
          gap: 0.25rem;
        }
        .rail-tab {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.35rem 0.7rem;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          color: var(--rr-muted);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .rail-tab:hover {
          color: var(--rr-heading);
          background: var(--rr-hover);
        }
        .rail-tab.active {
          color: var(--rr-heading);
          background: var(--rr-tint);
        }
        .tab-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.25rem;
          height: 1.25rem;
          padding: 0 0.35rem;
          background: var(--rr-accent);
          color: #fff;
          border-radius: 9999px;
          font-size: 0.6875rem;
        }
        .rail-collapse {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.75rem;
          height: 1.75rem;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          color: var(--rr-muted);
          cursor: pointer;
          flex-shrink: 0;
        }
        .rail-collapse:hover {
          background: var(--rr-hover);
          color: var(--rr-heading);
        }
        .vault-banner {
          padding: 0.4rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 500;
          text-align: center;
        }
        .vault-banner-saving {
          background: var(--rr-field);
          color: var(--rr-muted);
        }
        .vault-banner-saved {
          background: color-mix(in srgb, #4ade80 14%, transparent);
          color: #3cab68;
        }
        .vault-banner-error {
          background: var(--rr-tint);
          color: var(--rr-accent);
        }
        .vault-path {
          font-family: monospace;
          font-size: 0.75rem;
          word-break: break-all;
          opacity: 0.85;
        }
        .rail-body {
          flex: 1;
          min-height: 0;
          position: relative;
          overflow-y: auto;
        }
        .rail-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.5rem;
        }
        /* Comments read as margin notes: hairline-separated, no card gaps. */
        .rail-list.rail-comments {
          gap: 0;
          padding: 0.5rem 0.25rem;
        }
        /* Comments toolbar pinned above the scroll area. */
        .rail-pinned {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          padding: 0.5rem 0.5rem 0.45rem;
          border-bottom: 1px solid var(--rr-line);
        }
        .rail-pinned .rail-search {
          margin-bottom: 0;
        }
        .note-input {
          width: 100%;
          background: var(--rr-field);
          color: var(--rr-text);
          border: 1px solid var(--rr-line);
          border-radius: 0.375rem;
          padding: 0.45rem 0.6rem;
          font-size: 0.875rem;
          font-family: var(--reader-font, Georgia, serif);
        }
        .note-input::placeholder {
          color: var(--rr-muted);
          font-style: italic;
        }
        .note-input:focus {
          outline: none;
          border-color: var(--rr-accent);
        }
        .rail-search {
          display: flex;
          gap: 0.375rem;
          margin-bottom: 0.25rem;
        }
        .rail-search-input {
          flex: 1;
          min-width: 0;
          background: var(--rr-field);
          color: var(--rr-text);
          border: 1px solid var(--rr-line);
          border-radius: 0.375rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.8125rem;
        }
        .rail-search-input::placeholder {
          color: var(--rr-muted);
        }
        .rail-search-clear {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.85rem;
          background: var(--rr-field);
          color: var(--rr-muted);
          border: 1px solid var(--rr-line);
          border-radius: 0.375rem;
          font-size: 0.75rem;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .rail-search-clear:hover {
          background: var(--rr-hover);
          color: var(--rr-heading);
        }
        .rail-search-toggle {
          display: flex;
          flex-shrink: 0;
          border: 1px solid var(--rr-line);
          border-radius: 0.375rem;
          overflow: hidden;
        }
        .rail-search-toggle button {
          background: var(--rr-field);
          color: var(--rr-muted);
          border: none;
          padding: 0 0.5rem;
          font-size: 0.6875rem;
          font-weight: 600;
          cursor: pointer;
        }
        .rail-search-toggle button.active {
          background: var(--rr-accent);
          color: #fff;
        }
        .rail-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          padding: 3rem 1.5rem;
          text-align: center;
          color: var(--rr-muted);
        }
        .rail-empty p {
          margin: 0;
          font-size: 0.9375rem;
          font-weight: 500;
        }
        .rail-empty span {
          font-size: 0.8125rem;
          opacity: 0.75;
        }
        .session-item {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.75rem;
          background: var(--rr-field);
          border: 1px solid var(--rr-line);
          border-radius: 0.5rem;
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
        }
        .session-item:hover {
          background: var(--rr-hover);
        }
        .session-item.active {
          border-color: var(--rr-accent);
        }
        .session-content {
          flex: 1;
          min-width: 0;
        }
        .session-title-row {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          margin-bottom: 0.25rem;
          min-width: 0;
        }
        .session-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--rr-heading);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .session-item.active .session-title {
          color: var(--rr-accent);
        }
        .type-badge {
          flex-shrink: 0;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0.1rem 0.3rem;
          border-radius: 0.25rem;
          background: var(--rr-tint);
          color: var(--rr-accent);
        }
        .type-badge.type-epub {
          background: color-mix(in srgb, #c89a50 16%, transparent);
          color: #b98a3f;
        }
        .type-badge.type-wikipedia {
          background: color-mix(in srgb, #5f8ec9 16%, transparent);
          color: #5f8ec9;
        }
        .type-badge.type-sep {
          background: color-mix(in srgb, #9a76c9 16%, transparent);
          color: #9a76c9;
        }
        .type-badge.type-iep {
          background: color-mix(in srgb, #4fa88a 16%, transparent);
          color: #4fa88a;
        }
        .session-meta {
          font-size: 0.75rem;
          color: var(--rr-muted);
        }
        .session-delete,
        .session-vault {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.85rem;
          height: 1.85rem;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          color: var(--rr-muted);
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .session-delete:hover {
          background: var(--rr-tint);
          color: var(--rr-accent);
        }
        .session-vault:hover {
          background: var(--rr-hover);
          color: var(--rr-heading);
        }
        .session-vault.vault-saved {
          color: #3cab68;
        }
        .session-vault.vault-error {
          color: var(--rr-accent);
        }
        .session-vault:disabled {
          cursor: default;
          opacity: 0.7;
        }
        .loading-overlay {
          position: absolute;
          inset: 0;
          background: color-mix(in srgb, var(--reader-bg, #1a0505) 90%, transparent);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          color: var(--rr-muted);
          font-size: 0.8125rem;
          z-index: 10;
        }
        .spinner {
          width: 2rem;
          height: 2rem;
          border-radius: 9999px;
          border: 2px solid var(--rr-line);
          border-bottom-color: var(--rr-accent);
          animation: rail-spin 0.8s linear infinite;
        }
        @keyframes rail-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .rail-body::-webkit-scrollbar {
          width: 0.5rem;
        }
        .rail-body::-webkit-scrollbar-track {
          background: transparent;
        }
        .rail-body::-webkit-scrollbar-thumb {
          background: var(--rr-line);
          border-radius: 0.25rem;
        }
      `}</style>
    </div>
  );
}
