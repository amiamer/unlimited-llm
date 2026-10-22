/**
 * Reader Workspace — shared types.
 * Feature: reader-workspace
 *
 * Data models for the Google Docs-style annotation subsystem layered on top of
 * the (already-built) read-along engine. These types are intentionally free of
 * React/DOM dependencies so the pure modules (anchor, annotation-store,
 * book-note) can be unit/property tested in a Node environment.
 */

/**
 * The sentence-index range a selection resolves to. Anchoring is
 * sentence-granular: a partial-sentence selection anchors to the whole
 * sentence(s) it intersects. Sub-sentence/character-level offsets are out of
 * scope (Requirement 2.6).
 */
export interface SelectionAnchor {
  /** Inclusive start sentence index (global `data-sentence-index`). */
  startSentenceIndex: number;
  /** Inclusive end sentence index, always >= startSentenceIndex. */
  endSentenceIndex: number;
  /** The text the reader actually selected (stored verbatim for context). */
  selectedText: string;
}

/** A single AI response within a comment thread (Requirement 5.3). */
export interface AiReply {
  id: string;
  content: string;
  /**
   * The follow-up question that produced this reply, if any. Absent for the
   * first reply (which answers the annotation's `comment`). Stored so the thread
   * renders as a real back-and-forth and later turns can be sent as context.
   */
  prompt?: string;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * A Google Docs-style annotation: a highlighted passage plus its comment
 * thread (the user comment and any AI replies).
 *
 * `docId` is identical to the read-along `docId` for the same document, so
 * annotation state and read-along session state key adjacently in
 * localStorage (Requirement 7.3).
 */
export interface Annotation {
  /** Stable unique id (uuid). */
  id: string;
  /** Document key — matches the read-along docId. */
  docId: string;
  /** Inclusive start sentence index of the anchored passage. */
  startSentenceIndex: number;
  /** Inclusive end sentence index of the anchored passage (>= start). */
  endSentenceIndex: number;
  /** Passage text captured at selection time (survives re-render). */
  selectedText: string;
  /** The user comment (may be edited later). */
  comment: string;
  /**
   * When set, this highlight is also saved as an Obsidian [[wikilink]] in the
   * article note. Empty string = use selectedText as the link target.
   * Undefined = not a link (comment-only annotation).
   */
  linkTarget?: string;
  /** Ordered AI responses for this annotation. */
  aiReplies: AiReply[];
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-updated timestamp. */
  updatedAt: string;
}

/** Per-annotation Obsidian sync status, surfaced in-thread (Req 6.9/8.9). */
export type SyncState = 'idle' | 'saving' | 'error';

/** Per-annotation AI-reply request status, surfaced in-thread (Req 5.5/5.6). */
export type AiState = 'idle' | 'pending' | 'error';

/**
 * Transient state for the comment popover shown at an active selection
 * (Requirement 2). `rect` is in viewport coordinates for positioning.
 */
export interface PendingPopover {
  anchor: SelectionAnchor;
  rect: { top: number; left: number; width: number; height: number };
  /** The pending comment text being entered/dictated. */
  text: string;
  /** True when the user toggled the Link button — this highlight will also become a wikilink. */
  linkEnabled: boolean;
  /** Custom wikilink target (empty = use selectedText). Only meaningful when linkEnabled. */
  linkTarget: string;
  /** True when the selection overlaps an existing highlight (shown as a hint). */
  alreadyHighlighted?: boolean;
  /** True when this term is already saved as a link ELSEWHERE in the article. */
  alreadyLinked?: boolean;
}
