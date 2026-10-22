/**
 * Type definitions for the Voice-Activated ePub Reader feature
 */

/**
 * Reading session stored in local storage
 */
export interface ReadingSession {
  id: string;                    // Sanitized book title (matches audiobook folder name)
  epubUrl: string;               // Serving URL (/api/reader/serve/filename.epub)
  title: string;                 // Book title from filename
  currentChapter: number;        // 0-indexed chapter position
  currentSentence: number;       // 0-indexed sentence position within chapter
  lastAccessed: number;          // Unix timestamp
  createdAt: number;             // Unix timestamp
}

/**
 * A footnote / endnote reference marker found inside a sentence.
 *
 * The reader preserves these when extracting EPUB text so the visible marker
 * (e.g. "[1]") can be rendered as a clickable link that jumps to the matching
 * note at the back of the book — and back again.
 */
export interface FootnoteRef {
  /** Visible marker label as it appears in text, e.g. "[1]", "*", "a". */
  label: string;
  /**
   * Stable key identifying the target note. Derived from the reference's href
   * fragment (e.g. "filepos5362969") so it matches the note's anchor id.
   */
  noteKey: string;
  /**
   * The reference anchor's own id (e.g. "filepos61237"), used as the return
   * target so the note's back-link can scroll to exactly this marker.
   */
  refId: string;
  /**
   * Global note lookup key: "basefile#fragment" of the note target (e.g.
   * "war_and_peace_split_038.html#filepos5012484"). Notes can live in a
   * different file than the reference, so this fully qualifies the target for
   * the book-wide notes map used to show the note inline.
   */
  targetKey: string;
}

/**
 * A single note collected from the "back of the book" notes section.
 */
export interface NoteEntry {
  /** Stable key matching a FootnoteRef.noteKey (the note anchor's id). */
  key: string;
  /** Visible marker label for the note, e.g. "[1]". */
  label: string;
  /** Plain-text body of the note. */
  text: string;
  /**
   * The reference id this note links back to (from the note's back-link href
   * fragment), if present. Lets the note "return" arrow scroll to the marker.
   */
  backRefId?: string;
}

/**
 * Paragraph structure with sentences
 */
export interface Paragraph {
  sentences: string[];           // Sentences in this paragraph
  /**
   * Footnote references keyed by sentence index within this paragraph. Each
   * entry lists the markers that appear in that sentence, in order.
   */
  footnotes?: Record<number, FootnoteRef[]>;
  /**
   * Element ids (anchors) inside this paragraph mapped to the local sentence
   * index they fall in. Used to build the chapter-level anchor map for
   * footnote back-link navigation.
   */
  anchors?: Record<string, number>;
}

/**
 * Chapter structure extracted from ePub
 */
export interface Chapter {
  index: number;                 // 0-indexed position
  title: string;                 // Chapter title from ePub
  href: string;                  // Internal ePub reference
  sentences: string[];           // Extracted sentences (flat list)
  paragraphs: Paragraph[];       // Sentences grouped by paragraph
  /**
   * Footnote references keyed by the chapter-local flat sentence index (the
   * index into `sentences`). Mirror of paragraph-level footnotes, flattened so
   * renderers that iterate `sentences` can look markers up directly.
   */
  footnotes?: Record<number, FootnoteRef[]>;
  /**
   * Element ids (anchors) that live in this chapter, mapped to the flat
   * sentence index they belong to. Used to resolve a footnote back-link target
   * (refId) to a scroll position when returning from a note.
   */
  anchors?: Record<string, number>;
}

/**
 * Configuration for Ollama AI service
 */
export interface OllamaConfig {
  baseUrl: string;               // Default: 'http://localhost:11434'
  model: string;                 // Default: 'llama3.1:70b'
  temperature: number;           // Default: 0.7
  maxTokens: number;             // Default: 500
}

/**
 * Metadata extracted from ePub file
 */
export interface EpubMetadata {
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
}

/**
 * Voice command types
 */
export type Command = 
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'read_again' }
  | { type: 'next_chapter' }
  | { type: 'previous_chapter' }
  | { type: 'explain' };

/**
 * Ollama connection status
 */
export type OllamaStatus = 'connected' | 'disconnected' | 'checking';
