'use client';

import React, { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Annotation, AiState, SyncState } from '@/lib/reader-workspace/types';

/**
 * CommentThread — one annotation's comment + AI replies in the right margin.
 * Feature: reader-workspace
 *
 * "Marginalia" styling: threads read like notes in a book margin — the reading
 * surface's own serif, hairline separators instead of cards, no avatars or
 * caps-labels, and the AI voice as an indented passage behind an accent rule
 * rather than a chat bubble. All colors derive from the --reader-* theme
 * variables so the rail restyles with the reading surface. The follow-up
 * composer and the icon controls appear only on the SELECTED thread, so idle
 * threads are just quote + note.
 *
 * A standalone note (an annotation with no selectedText) renders without a
 * quote, marked with a ※.
 */

interface CommentThreadProps {
  annotation: Annotation;
  active: boolean;
  aiState: AiState;
  syncState: SyncState;
  onSelect: () => void;
  onRequestAi: (followUp?: string) => void;
  onEdit: (comment: string) => void;
  onEditSelectedText: (text: string) => void;
  /** Set the [[proper name]] this link points at (only for link annotations). */
  onEditLinkTarget?: (target: string) => void;
  onDelete: () => void;
  onRetrySync: () => void;
}

// The rail follows the reading surface: same serif (font picker), same theme.
const SERIF = 'var(--reader-font, Georgia, "Iowan Old Style", serif)';
const TEXT = 'var(--reader-text, #d7d3d0)';
const MUTED = 'var(--reader-muted, #9a938f)';
const ACCENT = 'var(--reader-accent, #b83030)';
const HAIRLINE = 'color-mix(in srgb, var(--reader-text, #d7d3d0) 12%, transparent)';
const ACCENT_TINT = 'color-mix(in srgb, var(--reader-accent, #b83030) 7%, transparent)';
const QUOTE_RULE = 'color-mix(in srgb, var(--reader-accent, #b83030) 40%, transparent)';
const FIELD_BG = 'color-mix(in srgb, var(--reader-text, #d7d3d0) 6%, transparent)';

// AI replies arrive as markdown — render it (bold, lists, code) instead of
// showing raw asterisks, with compact styles sized to the narrow rail.
const remarkPlugins = [remarkGfm];
const mdHeading: React.CSSProperties = {
  fontSize: '0.92rem',
  fontWeight: 700,
  margin: '0.45rem 0 0.25rem',
  color: 'var(--reader-heading, #f5f3f2)',
};
const mdCode: React.CSSProperties = {
  background: FIELD_BG,
  padding: '0.05rem 0.3rem',
  borderRadius: '3px',
  fontSize: '0.8em',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
};
const mdComponents: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 0.45rem' }}>{children}</p>,
  strong: ({ children }) => (
    <strong style={{ fontWeight: 700, color: 'var(--reader-heading, #f5f3f2)' }}>{children}</strong>
  ),
  ul: ({ children }) => <ul style={{ margin: '0 0 0.45rem 1.1rem', padding: 0 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 0.45rem 1.1rem', padding: 0 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: '0.2rem' }}>{children}</li>,
  code: ({ children }) => <code style={mdCode}>{children}</code>,
  pre: ({ children }) => (
    <pre style={{ background: FIELD_BG, padding: '0.5rem', borderRadius: '4px', overflowX: 'auto', margin: '0 0 0.45rem', fontSize: '0.78rem' }}>
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: 'underline' }}>
      {children}
    </a>
  ),
  h1: ({ children }) => <p style={mdHeading}>{children}</p>,
  h2: ({ children }) => <p style={mdHeading}>{children}</p>,
  h3: ({ children }) => <p style={mdHeading}>{children}</p>,
  h4: ({ children }) => <p style={mdHeading}>{children}</p>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: `2px solid ${HAIRLINE}`, margin: '0 0 0.45rem', paddingLeft: '0.5rem', fontStyle: 'italic', color: MUTED }}>
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 0.45rem' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ border: `1px solid ${HAIRLINE}`, padding: '0.2rem 0.4rem', fontWeight: 700, textAlign: 'left' }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{ border: `1px solid ${HAIRLINE}`, padding: '0.2rem 0.4rem' }}>{children}</td>
  ),
};

const iconBtn: React.CSSProperties = {
  width: '1.5rem',
  height: '1.5rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: MUTED,
  cursor: 'pointer',
  borderRadius: '0.25rem',
};

function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function CommentThread({
  annotation,
  active,
  aiState,
  syncState,
  onSelect,
  onRequestAi,
  onEdit,
  onEditSelectedText,
  onEditLinkTarget,
  onDelete,
  onRetrySync,
}: CommentThreadProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.comment);
  const [editingPassage, setEditingPassage] = useState(false);
  const [passageDraft, setPassageDraft] = useState(annotation.selectedText);
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState(annotation.linkTarget ?? '');
  const [followUp, setFollowUp] = useState('');

  // A link annotation has linkTarget defined. Empty string = link uses the
  // selected text as its name; a value = a distinct [[Proper Name]].
  const isLink = annotation.linkTarget !== undefined;
  const linkName = (annotation.linkTarget || annotation.selectedText || '').trim();
  // A standalone note: no anchored passage — just the reader's own words.
  const isNote = !(annotation.selectedText ?? '').trim();

  const sendFollowUp = () => {
    const q = followUp.trim();
    if (q.length === 0 || aiState === 'pending') return;
    onRequestAi(q);
    setFollowUp('');
  };
  // Collapse long threads (e.g. a big AI reply) so the margin stays scannable.
  const [collapsed, setCollapsed] = useState(false);
  const isLong = annotation.aiReplies.length > 0;

  const commitEdit = () => {
    const next = draft.trim();
    if (next.length > 0 && next !== annotation.comment) onEdit(next);
    setEditing(false);
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: FIELD_BG,
    color: TEXT,
    border: `1px solid ${HAIRLINE}`,
    borderRadius: '0.3rem',
    padding: '0.3rem 0.55rem',
    fontSize: '0.85rem',
    fontFamily: SERIF,
  };

  return (
    <div
      role="group"
      aria-label="Comment thread"
      onClick={onSelect}
      style={{
        padding: active ? '0.85rem 0.75rem 0.9rem 0.85rem' : '0.85rem 0.75rem 0.9rem',
        borderBottom: `1px solid ${HAIRLINE}`,
        borderLeft: `2px solid ${active ? ACCENT : 'transparent'}`,
        background: active ? ACCENT_TINT : 'transparent',
        fontFamily: SERIF,
        fontSize: '0.92rem',
        lineHeight: 1.55,
        color: TEXT,
        cursor: 'pointer',
      }}
    >
      {/* Anchored passage — pencil to trim it appears on the selected thread */}
      {!isNote && (
        <div style={{ marginBottom: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
          {editingPassage ? (
            <input
              aria-label="Edit passage"
              value={passageDraft}
              onChange={(e) => setPassageDraft(e.target.value)}
              onBlur={() => {
                const t = passageDraft.trim();
                if (t && t !== annotation.selectedText) onEditSelectedText(t);
                setEditingPassage(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setPassageDraft(annotation.selectedText); setEditingPassage(false); }
              }}
              autoFocus
              style={{ ...fieldStyle, fontStyle: 'italic', color: MUTED }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
              <div
                style={{
                  flex: 1,
                  color: MUTED,
                  fontStyle: 'italic',
                  fontSize: '0.88rem',
                  borderLeft: `2px solid ${QUOTE_RULE}`,
                  paddingLeft: '0.6rem',
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {annotation.selectedText}
              </div>
              {active && (
                <button
                  type="button"
                  aria-label="Edit passage"
                  title="Edit passage"
                  onClick={() => { setPassageDraft(annotation.selectedText); setEditingPassage(true); }}
                  style={{ ...iconBtn, flexShrink: 0, opacity: 0.5 }}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Link target — the [[proper name]] this highlight links to (editable) */}
      {isLink && onEditLinkTarget && (
        <div style={{ marginBottom: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
          {editingLink ? (
            <input
              aria-label="Edit link name"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={() => {
                const t = linkDraft.trim();
                if (t !== (annotation.linkTarget ?? '')) onEditLinkTarget(t);
                setEditingLink(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setLinkDraft(annotation.linkTarget ?? ''); setEditingLink(false); }
              }}
              autoFocus
              placeholder="Proper name, e.g. Mercantilism"
              style={{ ...fieldStyle, borderColor: ACCENT }}
            />
          ) : (
            <button
              type="button"
              title="Edit the link's proper name"
              onClick={() => { setLinkDraft(annotation.linkTarget || annotation.selectedText || ''); setEditingLink(true); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%',
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                color: ACCENT, fontFamily: SERIF, textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                [[{linkName}]]
              </span>
              {active && <span style={{ opacity: 0.6, flexShrink: 0 }}><PencilIcon size={11} /></span>}
            </button>
          )}
        </div>
      )}

      {/* The reader's note (editable). Standalone notes are marked with ※. */}
      {editing ? (
        <textarea
          aria-label="Edit comment"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          autoFocus
          rows={2}
          style={{ ...fieldStyle, resize: 'none' }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        annotation.comment && (
          <div style={{ whiteSpace: 'pre-wrap', color: TEXT }}>
            {isNote && (
              <span aria-hidden="true" style={{ color: ACCENT, marginRight: '0.4rem' }}>※</span>
            )}
            {annotation.comment}
          </div>
        )
      )}

      {/* AI replies, in order (collapsible) */}
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((c) => !c);
          }}
          style={{
            marginTop: '0.45rem',
            background: 'transparent',
            border: 'none',
            color: MUTED,
            cursor: 'pointer',
            fontFamily: SERIF,
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: 0,
          }}
          aria-expanded={!collapsed}
        >
          <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          {collapsed
            ? `Show ${annotation.aiReplies.length} AI repl${annotation.aiReplies.length === 1 ? 'y' : 'ies'}`
            : 'Collapse'}
        </button>
      )}
      {!collapsed &&
        annotation.aiReplies.map((reply) => (
          <div key={reply.id} style={{ marginTop: '0.55rem' }}>
            {reply.prompt && (
              <div style={{ fontStyle: 'italic', color: MUTED, fontSize: '0.85rem', marginBottom: '0.3rem', whiteSpace: 'pre-wrap' }}>
                You asked: {reply.prompt}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: '0.4rem',
                borderLeft: `2px solid ${ACCENT}`,
                paddingLeft: '0.65rem',
                color: 'color-mix(in srgb, var(--reader-text, #d7d3d0) 82%, transparent)',
                fontSize: '0.86rem',
                lineHeight: 1.55,
              }}
            >
              <span aria-hidden="true" style={{ color: ACCENT, flexShrink: 0 }}>✦</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
                  {reply.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

      {/* Pending / error indicators */}
      {aiState === 'pending' && (
        <div style={{ marginTop: '0.5rem', color: MUTED, fontSize: '0.85rem' }}>
          <span className="ra-thinking" aria-label="AI is responding">…thinking</span>
        </div>
      )}
      {aiState === 'error' && (
        <div style={{ marginTop: '0.5rem', color: ACCENT, fontSize: '0.85rem' }} role="alert">
          AI request failed.
        </div>
      )}
      {syncState === 'error' && (
        <div style={{ marginTop: '0.5rem', color: ACCENT, fontSize: '0.85rem' }} role="alert">
          Save to Obsidian failed.{' '}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetrySync();
            }}
            style={{ ...iconBtn, width: 'auto', padding: '0 0.25rem', color: ACCENT, textDecoration: 'underline', fontFamily: SERIF }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Composer + controls — only on the selected thread, so idle threads
          stay quiet (no button clutter). Clicking a thread selects it. */}
      {active && (
        <>
          <div
            style={{ display: 'flex', gap: '0.25rem', marginTop: '0.55rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              aria-label="Ask a follow-up"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendFollowUp();
                }
              }}
              placeholder="Ask a follow-up…"
              disabled={aiState === 'pending'}
              style={{ ...fieldStyle, flex: 1, minWidth: 0, fontSize: '0.8rem' }}
            />
            <button
              type="button"
              aria-label="Send follow-up"
              title="Send follow-up"
              disabled={aiState === 'pending' || followUp.trim().length === 0}
              onClick={(e) => {
                e.stopPropagation();
                sendFollowUp();
              }}
              style={{ ...iconBtn, opacity: followUp.trim().length === 0 ? 0.4 : 1 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.4rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              aria-label="Send to AI"
              title={'Ask AI — sends: your highlighted passage, your note, the surrounding paragraph (±3 sentences), the document title, and earlier replies in this thread.'}
              disabled={aiState === 'pending'}
              onClick={(e) => {
                e.stopPropagation();
                onRequestAi();
              }}
              style={iconBtn}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Edit comment"
              title="Edit"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(annotation.comment);
                setEditing(true);
              }}
              style={iconBtn}
            >
              <PencilIcon size={14} />
            </button>
            <button
              type="button"
              aria-label="Delete comment"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={iconBtn}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
