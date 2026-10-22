'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ReadingSession, Chapter, FootnoteRef } from '@/lib/types/reader';
import { sessionManager } from '@/lib/services/session-manager';
import { EpubDisplay } from '@/components/reader/EpubDisplay';
import { TextDisplay } from '@/components/reader/TextDisplay';
import { FootnotePopover } from '@/components/reader/FootnotePopover';
import { ReadingSchedulePanel } from '@/components/reader/ReadingSchedulePanel';
import { resolveSchedule, currentScheduleItem, parseSchedules, type BookSchedule } from '@/lib/reader-workspace/reading-schedule';
import { ReaderRail, type RailLibraryItem } from '@/components/reader/ReaderRail';
import { ReaderSummaryStrip } from '@/components/reader/ReaderSummaryStrip';
import { loadSummary } from '@/lib/reader-workspace/summary-store';
import { readArticleLibrary, removeArticleFromLibrary, fetchAndSaveArticle, type ArticleLibraryEntry } from '@/lib/reader-sources/library';
import type { ReadingSourceType } from '@/lib/reader-sources/types';
import { annotateArticleHtml } from '@/lib/reader-sources/annotate-html';
import { readPdfLibrary, loadPdfHtml, removePdfFromLibrary, type PdfLibraryEntry } from '@/lib/reader-sources/pdf-source';
import { ArticleNativeView } from '@/components/reader/ArticleNativeView';
import { ReaderThemeSwitcher } from '@/components/reader/ReaderThemeSwitcher';
import { ReaderFontPicker } from '@/components/reader/ReaderFontPicker';
import { getReaderTheme, readerThemeVars, DEFAULT_READER_THEME, READER_THEME_STORAGE_KEY } from '@/lib/reader-sources/reader-themes';
import { getReaderFont, DEFAULT_READER_FONT, READER_FONT_STORAGE_KEY } from '@/lib/reader-sources/reader-fonts';
import { UploadButton } from '@/components/reader/UploadButton';
import { PdfUploadButton } from '@/components/reader/PdfUploadButton';
import { ReadAlongControl } from '@/components/reader/ReadAlongControl';
import { TranscriptReadout } from '@/components/reader/TranscriptReadout';
import { CommentPopover } from '@/components/reader/CommentPopover';
import { useReadAlongAlignment } from '@/lib/read-along/use-read-along';
import { useAnnotationWorkspace } from '@/lib/reader-workspace/use-annotation-workspace';
import type { Annotation } from '@/lib/reader-workspace/types';
import { migrateLocalAnnotationsToServer } from '@/lib/reader-workspace/annotation-store';
import { buildArticleBodyWithLinks, isLinkAnnotation, computeWikilink } from '@/lib/reader-workspace/book-note';
import { extractArticleSentences, TTS_STRIP_SELECTORS } from '@/lib/reader-sources/extract-article';
import AppShell from '@/components/app-shell';

/**
 * ReaderPage - Main orchestration page for the reader (EPUB, articles, PDFs)
 * Requirements: 1.1, 1.7, 6.1, 7.1, 7.4, 7.5, 8.3, 10.4
 *
 * This page orchestrates all sub-components, manages global reader state,
 * and handles session loading and switching.
 */

// ── Last-open persistence ────────────────────────────────────────────────────
const LAST_OPEN_KEY = 'reader-last-open';
const LEFT_PANEL_COLLAPSED_KEY = 'reader:leftPanelCollapsed';
type LastOpen = { type: 'epub' | 'article' | 'pdf'; id: string };

function saveLastOpen(type: LastOpen['type'], id: string): void {
  try { localStorage.setItem(LAST_OPEN_KEY, JSON.stringify({ type, id })); } catch {}
}
function loadLastOpen(): LastOpen | null {
  try {
    const raw = localStorage.getItem(LAST_OPEN_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && (p.type === 'epub' || p.type === 'article' || p.type === 'pdf') && typeof p.id === 'string') return p;
  } catch {}
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

export default function ReaderPage() {
  // Global reader state
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ReadingSession | null>(null);
  const [sentences, setSentences] = useState<string[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Book-wide note bodies keyed by "file#fragment" for inline footnote popovers.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pdfUploadMsg, setPdfUploadMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  // Closed by default so the reader opens clean (text only). The last book
  // auto-loads, so the sessions list is only needed to *switch* documents — and
  // keeping it closed by default stops it from competing with the comments rail.
  const [sessionsPaneOpen, setSessionsPaneOpen] = useState(false);
  const [readerThemeId, setReaderThemeId] = useState<string>(DEFAULT_READER_THEME);
  const [readerFontId, setReaderFontId] = useState<string>(DEFAULT_READER_FONT);
  // Non-null when the open document is an article (Wikipedia/SEP) rather than an
  // EPUB. Articles reuse the same sentences/chapters state; this just marks the
  // mode (for docId/title and to keep the EPUB loader from running).
  const [articleMeta, setArticleMeta] = useState<{ id: string; title: string; type?: ReadingSourceType } | null>(null);
  // Annotated native HTML for the open article (null for EPUB). When set, the
  // center renders the native article view instead of TextDisplay.
  const [articleHtml, setArticleHtml] = useState<string | null>(null);
  // Reader "link mode": single-click a wiki link to capture it (see ArticleNativeView).
  const [linkMode, setLinkMode] = useState(false);
  const [headingIndices, setHeadingIndices] = useState<Set<number>>(new Set());
  const [listItemIndices, setListItemIndices] = useState<Set<number>>(new Set());
  const [paragraphBreaks, setParagraphBreaks] = useState<Set<number>>(new Set());
  const [articleLibrary, setArticleLibrary] = useState<ArticleLibraryEntry[]>([]);
  const [pdfLibrary, setPdfLibrary] = useState<PdfLibraryEntry[]>([]);
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [articleNavHistory, setArticleNavHistory] = useState<{ entry: ArticleLibraryEntry; scroll: number }[]>([]);

  // Debug: Log sentences state changes
  useEffect(() => {
    console.log('Sentences state changed:', sentences.length);
  }, [sentences]);

  // Load saved articles (Wikipedia/SEP) into the unified Library on mount.
  useEffect(() => {
    readArticleLibrary().then(setArticleLibrary);
  }, []);

  // Sweep browser-stored annotation sets into the server file store (the
  // durable source of truth) — idempotent, only pushes docs the server lacks.
  useEffect(() => {
    void migrateLocalAnnotationsToServer();
  }, []);

  // Restore the saved reading-surface theme and font.
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(READER_THEME_STORAGE_KEY);
      if (savedTheme) setReaderThemeId(savedTheme);
      const savedFont = localStorage.getItem(READER_FONT_STORAGE_KEY);
      if (savedFont) setReaderFontId(savedFont);
    } catch {
      /* ignore */
    }
  }, []);

  const selectReaderTheme = useCallback((id: string) => {
    setReaderThemeId(id);
    try { localStorage.setItem(READER_THEME_STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  const selectReaderFont = useCallback((id: string) => {
    setReaderFontId(id);
    try { localStorage.setItem(READER_FONT_STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  // Collapsible left panel (persisted) + browser fullscreen for the reading area.
  const readerLayoutRef = useRef<HTMLDivElement>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(LEFT_PANEL_COLLAPSED_KEY) === 'true') setLeftPanelCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(LEFT_PANEL_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => { /* ignore */ });
    } else {
      void readerLayoutRef.current?.requestFullscreen?.().catch(() => { /* ignore */ });
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Shortcuts: `f` toggles fullscreen, `[` toggles the left panel (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === '[') {
        e.preventDefault();
        toggleLeftPanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, toggleLeftPanel]);

  const readerThemeStyle = {
    ...readerThemeVars(getReaderTheme(readerThemeId)),
    '--reader-font': getReaderFont(readerFontId).stack,
  } as React.CSSProperties;

  // Load extracted PDFs into the unified Library on mount (async — server files).
  useEffect(() => {
    let alive = true;
    readPdfLibrary().then((entries) => {
      if (alive) setPdfLibrary(entries);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Refs
  const epubContainerRef = useRef<HTMLDivElement>(null);

  // ── Reader Workspace: read-along + annotations (Feature: reader-workspace) ──

  const docId = articleMeta?.id ?? currentSession?.id ?? null;
  // The workspace/Obsidian note title. Philosophy articles get a source suffix so
  // they never overwrite the Wikipedia note of the same title (e.g. "Reading:
  // Baruch Spinoza" vs "…(SEP)" vs "…(IEP)"). Only SEP/IEP are tagged, so every
  // existing Wikipedia/EPUB/PDF note keeps its exact name. Note: the visible
  // article H1 uses articleMeta.title directly, so it stays clean.
  const docTitle =
    articleMeta
      ? `${articleMeta.title}${
          articleMeta.type === 'sep' ? ' (SEP)' : articleMeta.type === 'iep' ? ' (IEP)' : ''
        }`
      : currentSession?.title ?? null;

  // Read-along alignment engine (already built). Drives the highlight from the
  // reader's own currentSentenceIndex while active.
  const readAlong = useReadAlongAlignment(sentences, {
    docId: docId ?? undefined,
    docTitle: docTitle ?? undefined,
    headingIndices,
  });
  const [readAlongActive, setReadAlongActive] = useState(false);

  // Mirror the read-along pointer into the reader's sentence index while active.
  useEffect(() => {
    if (readAlongActive) setCurrentSentenceIndex(readAlong.pointer);
  }, [readAlongActive, readAlong.pointer]);

  // Helper: given a global sentence index, compute which chapter it falls in and
  // update both the session's currentChapter and the sentence index. This makes
  // seekTo and click-to-jump work across chapters (the display only renders one chapter).
  const seekToWithChapter = useCallback((globalIndex: number) => {
    // Clamp into range so the skip-back button (pointer-1) and skip-forward at
    // the end can't run off either edge.
    const clamped = sentences.length > 0
      ? Math.max(0, Math.min(globalIndex, sentences.length - 1))
      : Math.max(0, globalIndex);
    readAlong.seekTo(clamped);
    // Move the visible current sentence directly — the read-along mirror effect
    // only runs while read-along is ACTIVE, so without this a click (or skip)
    // wouldn't move anything when you're just reading. (This was the bug.)
    setCurrentSentenceIndex(clamped);
    if (chapters.length === 0 || !currentSession) return;
    let sum = 0;
    for (let ch = 0; ch < chapters.length; ch++) {
      if (sum + chapters[ch].sentences.length > clamped) {
        if (ch !== currentSession.currentChapter) {
          sessionManager.updateSession(currentSession.id, { currentChapter: ch });
          setCurrentSession({ ...currentSession, currentChapter: ch });
        }
        return;
      }
      sum += chapters[ch].sentences.length;
    }
    // If clamped is at or past the end, go to the last chapter.
    const last = chapters.length - 1;
    if (last !== currentSession.currentChapter) {
      sessionManager.updateSession(currentSession.id, { currentChapter: last });
      setCurrentSession({ ...currentSession, currentChapter: last });
    }
  }, [readAlong, chapters, currentSession, sentences.length]);

  // Jump to the first sentence of a chapter. Works with or without read-along:
  // the sentence index is set directly so the visible chapter and highlight
  // move even when the read-along mirror effect isn't running.
  const goToChapter = useCallback(
    (ch: number) => {
      if (ch < 0 || ch >= chapters.length) return;
      let sum = 0;
      for (let i = 0; i < ch; i++) sum += chapters[i].sentences.length;
      seekToWithChapter(sum);
      setCurrentSentenceIndex(sum);
    },
    [chapters, seekToWithChapter],
  );

  // ── Footnote navigation ────────────────────────────────────────────────────
  // Build a map from every anchor id in the book to its GLOBAL sentence index,
  // so a footnote reference ("[1]") can jump to its note at the back of the
  // book — and the note's marker can jump back. Chapters carry `anchors` keyed
  // by chapter-local flat sentence index; we add the running chapter offset.
  const anchorIndex = useMemo(() => {
    const map = new Map<string, number>();
    let offset = 0;
    for (const ch of chapters) {
      if (ch.anchors) {
        for (const [id, localIdx] of Object.entries(ch.anchors)) {
          map.set(id, offset + localIdx);
        }
      }
      offset += ch.sentences.length;
    }
    return map;
  }, [chapters]);

  // ── Reading schedule ───────────────────────────────────────────────────────
  // Reading-group schedules are personal data kept in the vault; load them once.
  const [readingSchedules, setReadingSchedules] = useState<BookSchedule[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/reading-schedules')
      .then((res) => (res.ok ? res.json() : { schedules: [] }))
      .then((data) => { if (alive) setReadingSchedules(parseSchedules(data)); })
      .catch(() => { /* no schedules: the panel stays hidden */ });
    return () => { alive = false; };
  }, []);

  // Resolve the book's schedule (if one matches) to concrete chapter
  // boundaries. EPUBs have no page numbers, so each deadline pins to a
  // Volume/Part start. Null for unmatched books → panel hidden.
  const resolvedSchedule = useMemo(() => {
    if (chapters.length === 0 || !currentSession) return null;
    return resolveSchedule(currentSession.title, chapters, readingSchedules);
  }, [chapters, currentSession, readingSchedules]);

  const scheduleCurrentIndex = useMemo(() => {
    if (!resolvedSchedule) return 0;
    return currentScheduleItem(resolvedSchedule.items, currentSession?.currentChapter ?? 0);
  }, [resolvedSchedule, currentSession?.currentChapter]);

  // Fractional progress through the current chapter (0..1), from the reader's
  // global sentence position, so the weekly progress bar moves smoothly.
  const currentChapterProgress = useMemo(() => {
    if (chapters.length === 0) return 0;
    const ch = currentSession?.currentChapter ?? 0;
    let start = 0;
    for (let i = 0; i < ch && i < chapters.length; i++) start += chapters[i].sentences.length;
    const count = chapters[ch]?.sentences.length ?? 0;
    if (count <= 0) return 0;
    return Math.min(Math.max((currentSentenceIndex - start) / count, 0), 1);
  }, [chapters, currentSession?.currentChapter, currentSentenceIndex]);

  // Stack of reference positions so "return" works even when a note lacks an
  // explicit back-link in the source EPUB.
  const footnoteReturnStack = useRef<number[]>([]);

  // Flash a sentence element briefly so the jump destination is obvious.
  const flashSentence = useCallback((globalIndex: number) => {
    // Defer to next frame so the target chapter has rendered.
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-sentence-index="${globalIndex}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      el.classList.remove('footnote-flash');
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add('footnote-flash');
      window.setTimeout(() => el.classList.remove('footnote-flash'), 1700);
    });
  }, []);

  // Active inline footnote popover (null when closed).
  const [footnotePopover, setFootnotePopover] = useState<{
    anchorEl: HTMLElement;
    label: string;
    text: string | null;
    ref: FootnoteRef;
  } | null>(null);

  // Jump to the full note at the back of the book (used from the popover and as
  // a fallback when there's no inline text). Remembers the marker so the note's
  // own back-link returns to exactly here.
  const jumpToNote = useCallback(
    (ref: FootnoteRef) => {
      const target = anchorIndex.get(ref.noteKey);
      if (target === undefined) {
        console.warn('Footnote target not found for key:', ref.noteKey);
        return;
      }
      const from = ref.refId ? anchorIndex.get(ref.refId) : undefined;
      footnoteReturnStack.current.push(
        from !== undefined ? from : currentSentenceIndex,
      );
      seekToWithChapter(target);
      flashSentence(target);
    },
    [anchorIndex, seekToWithChapter, flashSentence, currentSentenceIndex],
  );

  // Click a footnote reference: show the note inline in a popover anchored to
  // the marker. If we have no inline text (rare), fall back to jumping.
  const handleFootnoteClick = useCallback(
    (ref: FootnoteRef, el: HTMLElement) => {
      // Resolve the note body from the book-wide notes map. Try the fully
      // qualified target key first, then the bare fragment as a fallback.
      const byTarget = ref.targetKey ? notes[ref.targetKey] : undefined;
      const byFragment =
        byTarget ??
        Object.entries(notes).find(([k]) => k.endsWith(`#${ref.noteKey}`))?.[1];
      const text = byTarget ?? byFragment ?? null;

      if (!text) {
        // No inline text available — jump to the note in context instead.
        jumpToNote(ref);
        return;
      }
      setFootnotePopover({ anchorEl: el, label: ref.label, text, ref });
    },
    [notes, jumpToNote],
  );

  const startReadAlong = useCallback(() => {
    readAlong.start();
    setReadAlongActive(true);
  }, [readAlong]);

  const stopReadAlong = useCallback(() => {
    readAlong.stop();
    setReadAlongActive(false);
  }, [readAlong]);

  // Pause read-along when the reader begins a selection (Req 1.10 / 2.8).
  const pauseReadAlongForSelection = useCallback(() => {
    if (readAlongActive) {
      readAlong.stop();
      setReadAlongActive(false);
    }
  }, [readAlongActive, readAlong]);

  const annotationWorkspace = useAnnotationWorkspace({
    docId,
    docTitle,
    sentenceCount: sentences.length,
    sentences,
    onSelectionPauseReadAlong: pauseReadAlongForSelection,
  });

  // Scroll container shared by the text column and the comment margin.
  const readerScrollRef = useRef<HTMLDivElement>(null);

  // On a fresh article the reader scrolls to the top; "back" restores the spot
  // you were reading (handleGoBack sets pendingScroll before the new HTML loads).
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!articleHtml) return;
    const container = readerScrollRef.current;
    if (!container) return;
    const target = pendingScrollRef.current ?? 0;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => { container.scrollTop = target; });
  }, [articleHtml]);

  // Comments are scoped to the current chapter (EPUB only). Compute the current
  // chapter's global sentence-index range; articles have no chapters so all
  // comments show. Switching chapters swaps the visible comment set.
  const currentChapterRange = useMemo(() => {
    if (chapters.length === 0) return null;
    const ch = currentSession?.currentChapter ?? 0;
    let start = 0;
    for (let i = 0; i < ch && i < chapters.length; i++) start += chapters[i].sentences.length;
    const end = start + (chapters[ch]?.sentences.length ?? 0);
    return { start, end };
  }, [chapters, currentSession?.currentChapter]);

  const chapterAnnotations = useMemo(() => {
    if (!currentChapterRange) return annotationWorkspace.annotations;
    const { start, end } = currentChapterRange;
    return annotationWorkspace.annotations.filter(
      (a) => a.startSentenceIndex >= start && a.startSentenceIndex < end,
    );
  }, [annotationWorkspace.annotations, currentChapterRange]);

  /**
   * Load sessions from SessionManager on mount and auto-load most recent
   * Syncs with disk state first so localStorage reflects actual books on disk
   * Requirements: 7.4
   */
  useEffect(() => {
    const syncAndLoad = async () => {
      const lastOpen = loadLastOpen();

      try {
        const response = await fetch('/api/reader/books');
        if (response.ok) {
          const data = await response.json();
          if (data.books && data.books.length > 0) {
            const synced = sessionManager.syncFromDisk(data.books);
            setSessions(synced);
            // Only auto-load an EPUB if the last thing opened was an EPUB (or nothing yet).
            if (!lastOpen || lastOpen.type === 'epub') {
              if (synced.length > 0) {
                const target = lastOpen
                  ? (synced.find((s) => s.id === lastOpen.id) ?? [...synced].sort((a, b) => b.lastAccessed - a.lastAccessed)[0])
                  : [...synced].sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
                handleSessionSelect(target.id);
              }
            }
            return;
          }
        }
      } catch (error) {
        console.error('Failed to sync books from disk:', error);
      }

      const loadedSessions = sessionManager.getAllSessions();
      setSessions(loadedSessions);
      if (!lastOpen || lastOpen.type === 'epub') {
        if (loadedSessions.length > 0) {
          const target = lastOpen
            ? (loadedSessions.find((s) => s.id === lastOpen.id) ?? [...loadedSessions].sort((a, b) => b.lastAccessed - a.lastAccessed)[0])
            : [...loadedSessions].sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
          handleSessionSelect(target.id);
        }
      }
    };

    syncAndLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Restore last-open article or PDF once the library has loaded.
  const didRestoreArticleRef = useRef(false);
  useEffect(() => {
    if (didRestoreArticleRef.current || currentSession || articleMeta) return;
    const lastOpen = loadLastOpen();
    if (!lastOpen || lastOpen.type === 'epub') return;
    if (lastOpen.type === 'article') {
      const entry = articleLibrary.find((a) => a.id === lastOpen.id);
      if (entry) { didRestoreArticleRef.current = true; openArticle(entry); }
    } else if (lastOpen.type === 'pdf') {
      const entry = pdfLibrary.find((p) => p.id === lastOpen.id);
      if (entry) { didRestoreArticleRef.current = true; void openPdf(entry); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleLibrary, pdfLibrary]);

  /**
   * Handle ePub content ready
   * Requirements: 1.3, 1.4
   */
  const handleContentReady = useCallback((extractedSentences: string[], extractedChapters: Chapter[], extractedNotes?: Record<string, string>) => {
    console.log('handleContentReady called:', {
      sentencesCount: extractedSentences.length,
      chaptersCount: extractedChapters.length,
      notesCount: extractedNotes ? Object.keys(extractedNotes).length : 0,
      firstSentences: extractedSentences.slice(0, 3)
    });
    
    if (extractedSentences.length > 0) {
      setSentences(extractedSentences);
      setChapters(extractedChapters);
      setNotes(extractedNotes || {});
      console.log('State updated - sentences and chapters set');
    } else {
      console.warn('Received empty sentences array!');
    }
  }, []);
  
  /**
   * Restore saved position after chapters are loaded
   */
  useEffect(() => {
    if (currentSession && chapters.length > 0 && sentences.length > 0) {
      // Validate chapter index
      const validChapterIndex = Math.min(
        Math.max(0, currentSession.currentChapter),
        chapters.length - 1
      );
      
      // Calculate global sentence index from chapter and sentence position
      let globalSentenceIndex = 0;
      for (let i = 0; i < validChapterIndex && i < chapters.length; i++) {
        globalSentenceIndex += chapters[i].sentences.length;
      }
      
      // Validate sentence index within the chapter
      const chapterSentenceCount = chapters[validChapterIndex]?.sentences.length || 0;
      const validSentenceInChapter = Math.min(
        Math.max(0, currentSession.currentSentence),
        chapterSentenceCount - 1
      );
      
      globalSentenceIndex += validSentenceInChapter;
      
      setCurrentSentenceIndex(globalSentenceIndex);
      
      // Update session if we had to adjust the indices
      if (validChapterIndex !== currentSession.currentChapter || 
          validSentenceInChapter !== currentSession.currentSentence) {
        sessionManager.updatePosition(
          currentSession.id,
          validChapterIndex,
          validSentenceInChapter
        );
      }
    }
  }, [currentSession?.id, chapters.length, sentences.length]); // Only run when session ID or chapter/sentence counts change

  /**
   * Handle ePub upload completion
   * Requirements: 1.2, 7.1
   */
  const handleUploadComplete = useCallback(async (url: string, fileName: string) => {
    setUploadError(null);
    
    try {
      // Create new session
      const newSession = sessionManager.createSession(url, fileName);
      
      // Update sessions list
      const updatedSessions = sessionManager.getAllSessions();
      setSessions(updatedSessions);
      
      // Set as current session — EpubDisplay will load the book via epubUrl prop
      setCurrentSession(newSession);
      setSessionLoadError(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load ePub';
      setUploadError(errorMessage);
      console.error('Error after upload:', error);
    }
  }, []);

  /**
   * Handle session selection
   * Requirements: 7.5, 8.3
   */
  const handleSessionSelect = useCallback(async (sessionId: string) => {
    setSessionLoadError(null);
    setIsLoadingSession(true);
    // Leaving article mode: let the EPUB loader take over again.
    setArticleMeta(null);
    setArticleHtml(null);
    setHeadingIndices(new Set());
    setListItemIndices(new Set());
    setParagraphBreaks(new Set());

    try {
      // Get session with S3 URL validation
      const session = await sessionManager.getSession(sessionId);
      
      if (!session) {
        setSessionLoadError('Session not found');
        return;
      }
      
      // Update last accessed
      sessionManager.updateSession(sessionId, {});
      saveLastOpen('epub', sessionId);
      
      // Update sessions list
      const updatedSessions = sessionManager.getAllSessions();
      setSessions(updatedSessions);
      
      // Set as current session — EpubDisplay will load the book via epubUrl prop
      setCurrentSession(session);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load session';
      setSessionLoadError(errorMessage);
      console.error('Error loading session:', error);
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  /**
   * Handle session deletion
   * Requirements: 8.5
   */
  const handleSessionDelete = useCallback((sessionId: string) => {
    sessionManager.deleteSession(sessionId);
    
    // Update sessions list
    const updatedSessions = sessionManager.getAllSessions();
    setSessions(updatedSessions);
    
    // If deleted session was current, clear it
    if (currentSession?.id === sessionId) {
      setCurrentSession(null);
      setSentences([]);
      setChapters([]);
      setNotes({});
      setCurrentSentenceIndex(0);
    }
  }, [currentSession]);

  /**
   * Handle ePub display error
   * Requirements: 1.5
   */
  const handleEpubError = useCallback((error: string) => {
    setSessionLoadError(error);
  }, []);

  /**
   * Handle upload error
   * Requirements: 1.5
   */
  const handleUploadError = useCallback((error: string) => {
    setUploadError(error);
  }, []);

  // ── Unified Library: EPUB sessions + saved articles (Wikipedia/SEP) ──

  const formatAgo = (ts: number): string => {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  const libraryItems: RailLibraryItem[] = useMemo(() => {
    const epubItems: RailLibraryItem[] = [...sessions]
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .map((s) => ({
        id: s.id,
        type: 'epub' as const,
        title: s.title,
        subtitle: `Chapter ${s.currentChapter + 1} · ${formatAgo(s.lastAccessed)}`,
      }));
    const articleItems: RailLibraryItem[] = articleLibrary.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      subtitle: a.type === 'sep' ? 'Philosophy (SEP)' : a.type === 'iep' ? 'Philosophy (IEP)' : 'Wikipedia',
    }));
    const pdfItems: RailLibraryItem[] = pdfLibrary.map((p) => ({
      id: p.id,
      type: 'pdf' as const,
      title: p.title,
      subtitle: 'PDF',
    }));
    return [...epubItems, ...articleItems, ...pdfItems];
  }, [sessions, articleLibrary, pdfLibrary]);

  const currentItemId = articleMeta?.id ?? currentSession?.id ?? null;

  const openArticle = useCallback(
    (entry: ArticleLibraryEntry) => {
      readAlong.stop();
      setReadAlongActive(false);
      // Annotate the article's real HTML: sentence anchors injected, structure
      // (links, headings, lists, images) preserved. The matcher consumes the
      // parallel `sentences` so its indices line up with the DOM anchors.
      const { html, sentences: articleSentences } = annotateArticleHtml(entry.content);
      setCurrentSession(null);
      setArticleMeta({ id: entry.id, title: entry.title, type: entry.type });
      setArticleHtml(html);
      setSentences(articleSentences);
      setChapters([]);
      setNotes({});
      setHeadingIndices(new Set());
      setListItemIndices(new Set());
      setParagraphBreaks(new Set());
      setCurrentSentenceIndex(0);
      setSessionLoadError(null);
      saveLastOpen('article', entry.id);
    },
    [readAlong],
  );

  const openPdf = useCallback(
    async (entry: PdfLibraryEntry) => {
      readAlong.stop();
      setReadAlongActive(false);
      setSessionLoadError(null);
      try {
        const rawHtml = await loadPdfHtml(entry.filename);
        const { html, sentences: pdfSentences } = annotateArticleHtml(rawHtml);
        setCurrentSession(null);
        setArticleMeta({ id: entry.id, title: entry.title, type: 'pdf' });
        setArticleHtml(html);
        setSentences(pdfSentences);
        setChapters([]);
        setNotes({});
        setHeadingIndices(new Set());
        setListItemIndices(new Set());
        setParagraphBreaks(new Set());
        setCurrentSentenceIndex(0);
        saveLastOpen('pdf', entry.id);
      } catch (e) {
        setSessionLoadError(e instanceof Error ? e.message : 'Failed to load PDF');
      }
    },
    [readAlong],
  );

  const handleOpenItem = useCallback(
    (id: string) => {
      const pdf = pdfLibrary.find((p) => p.id === id);
      if (pdf) {
        void openPdf(pdf);
        return;
      }
      const article = articleLibrary.find((a) => a.id === id);
      if (article) {
        openArticle(article);
        return;
      }
      handleSessionSelect(id);
    },
    [pdfLibrary, articleLibrary, openPdf, openArticle, handleSessionSelect],
  );

  const handleDeleteItem = useCallback(
    (id: string) => {
      const pdf = pdfLibrary.find((p) => p.id === id);
      if (pdf) {
        removePdfFromLibrary(pdf.filename).then(() => readPdfLibrary().then(setPdfLibrary));
        if (articleMeta?.id === id) {
          setArticleMeta(null);
          setArticleHtml(null);
          setSentences([]);
          setChapters([]);
          setHeadingIndices(new Set());
          setListItemIndices(new Set());
          setParagraphBreaks(new Set());
          setCurrentSentenceIndex(0);
        }
        return;
      }
      if (articleLibrary.some((a) => a.id === id)) {
        removeArticleFromLibrary(id).then(() => readArticleLibrary().then(setArticleLibrary));
        if (articleMeta?.id === id) {
          setArticleMeta(null);
          setArticleHtml(null);
          setSentences([]);
          setChapters([]);
          setHeadingIndices(new Set());
          setListItemIndices(new Set());
          setParagraphBreaks(new Set());
          setCurrentSentenceIndex(0);
        }
        return;
      }
      // EPUB — delete the file from disk so syncFromDisk doesn't recreate it.
      const session = sessions.find((s) => s.id === id);
      if (session) {
        const filename = decodeURIComponent(session.epubUrl.split('/').pop() ?? '');
        if (filename) {
          fetch(`/api/reader/books?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
            .catch(() => { /* non-fatal; session is removed from localStorage below */ });
        }
        handleSessionDelete(id);
        if (currentSession?.id === id) {
          setCurrentSession(null);
          setSentences([]);
          setChapters([]);
          setCurrentSentenceIndex(0);
        }
        return;
      }
      handleSessionDelete(id);
    },
    [pdfLibrary, articleLibrary, articleMeta, sessions, currentSession, handleSessionDelete],
  );

  // Re-read the Library (articles + PDFs) so items added elsewhere appear
  // without a full reload. Cheap; runs when the rail is opened.
  const refreshLibrary = useCallback(() => {
    readArticleLibrary().then(setArticleLibrary);
    readPdfLibrary().then(setPdfLibrary);
  }, []);

  const openRail = useCallback(() => {
    refreshLibrary();
    setSessionsPaneOpen(true);
  }, [refreshLibrary]);

  const handleSearch = useCallback(
    async (q: string, type: 'wikipedia' | 'sep' | 'iep') => {
      setSessionLoadError(null);
      setIsLoadingArticle(true);
      try {
        const entry = await fetchAndSaveArticle(type, q);
        readArticleLibrary().then(setArticleLibrary);
        openArticle(entry);
      } catch (e) {
        setSessionLoadError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        setIsLoadingArticle(false);
      }
    },
    [openArticle],
  );

  const handleOpenWikiLink = useCallback(
    (wikiTitle: string) => {
      if (articleMeta) {
        const current = articleLibrary.find((a) => a.id === articleMeta.id);
        if (current) {
          const scroll = readerScrollRef.current?.scrollTop ?? 0;
          setArticleNavHistory((h) => [...h, { entry: current, scroll }]);
        }
      }
      void handleSearch(wikiTitle, 'wikipedia');
    },
    [articleMeta, articleLibrary, handleSearch],
  );

  const handleGoBack = useCallback(() => {
    const prev = articleNavHistory[articleNavHistory.length - 1];
    if (!prev) return;
    setArticleNavHistory((h) => h.slice(0, -1));
    pendingScrollRef.current = prev.scroll; // restore where you were reading
    openArticle(prev.entry);
  }, [articleNavHistory, openArticle]);

  // Link-mode capture with feedback: if the term was already linked earlier in
  // the article, don't stack a duplicate — surface it and jump to the existing
  // one instead of silently doing nothing.
  const handleAddWikiLink = useCallback(
    (range: Range, container: HTMLElement, wikiTitle: string) => {
      const res = annotationWorkspace.addWikiLink(range, container, wikiTitle);
      if (res.status === 'duplicate') {
        window.showToast?.(`Already linked: ${res.term}`, 'info');
        annotationWorkspace.setActiveThread(res.existingId);
      }
    },
    [annotationWorkspace],
  );

  const handleSaveArticleToVault = useCallback(async (annotationsOverride?: Annotation[]) => {
    if (!articleMeta) throw new Error('No article open');
    const sourceAnnotations = annotationsOverride ?? annotationWorkspace.annotations;
    const entry = articleLibrary.find((a) => a.id === articleMeta.id);
    const rawHtml = entry?.content ?? '';
    const extracted = extractArticleSentences(rawHtml, TTS_STRIP_SELECTORS);
    if (extracted.sentences.length === 0) throw new Error('No content to save');

    // Build link annotations for inline [[wikilink]] injection.
    // Supports both the new linkTarget field and old-style "link" comments.
    const linkAnnotations = sourceAnnotations
      .filter((a) => a.linkTarget !== undefined || isLinkAnnotation(a.comment ?? ''))
      .map((a) => ({
        selectedText: a.selectedText ?? '',
        wikilink: computeWikilink(a.selectedText ?? '', a.comment ?? '', a.linkTarget),
        startSentenceIndex: a.startSentenceIndex,
        endSentenceIndex: a.endSentenceIndex,
      }))
      .filter((l) => l.selectedText);

    // Render article body with inline links; headings use their real HTML levels (H2→##, H3→###, …)
    const body = buildArticleBodyWithLinks(
      extracted.sentences,
      extracted.paragraphBreaks,
      extracted.headingIndices,
      extracted.listItemIndices,
      extracted.headingLevels,
      linkAnnotations,
    );

    // Safety guard: if this doc HAS link annotations but none made it into the
    // body, something went wrong (annotations not loaded yet, or a matching
    // failure). Abort rather than overwrite a good note with a link-less one —
    // this is what silently wiped Human history's links before.
    if (linkAnnotations.length > 0 && !body.includes('[[')) {
      throw new Error('Links not ready to save (annotations may still be loading). Try again in a moment.');
    }

    // Lead the note with the reader's running summary, if any.
    const summary = loadSummary(articleMeta.id, 0).trim();
    const articleContent = summary ? `## Summary\n\n${summary}\n\n${body}` : body;

    const date = new Date().toISOString().slice(0, 10);
    const annotations = sourceAnnotations.map((a) => ({
      selectedText: a.selectedText ?? '',
      comment: a.comment ?? '',
      linkTarget: a.linkTarget,
      aiReplies: (a.aiReplies ?? []).map((r) => ({ content: r.content, prompt: r.prompt })),
    }));

    const res = await fetch('/api/obsidian/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: articleMeta.title,
        source: entry?.url ?? '',
        articleContent,
        date,
        annotations,
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return res.json() as Promise<{
      articlePath: string;
      articleCreated: boolean;
      linksInjected: number;
    }>;
  }, [articleMeta, articleLibrary, annotationWorkspace.annotations]);

  // Summary edits belong in both reader outputs: the generated Book_Note and,
  // for articles, the clean article note in the Autodidact vault. Previously
  // only blur/collapse updated Book_Note while Autodidact required a manual
  // "Save to Vault" click, which is why its Summary could lag silently.
  const handleSummaryCommit = useCallback(async (): Promise<boolean> => {
    const annotations = await annotationWorkspace.getLoadedAnnotations();
    if (!annotations) return false; // navigated while the document was loading

    const results = await Promise.allSettled([
      annotationWorkspace.resyncNote(),
      ...(articleMeta ? [handleSaveArticleToVault(annotations).then(() => true)] : []),
    ]);
    const ok = results.every((result) => result.status === 'fulfilled' && result.value !== false);
    if (!ok) {
      window.showToast?.(
        'Summary is safe in the browser, but one Obsidian vault did not update',
        'error',
      );
    }
    return ok;
  }, [annotationWorkspace, articleMeta, handleSaveArticleToVault]);

  // Empty state only when there's genuinely nothing in the library and nothing open.
  const showEmptyState = libraryItems.length === 0 && !currentSession && !articleMeta;

  return (
    <AppShell variant="full">
    <div className="reader-page">
      {/* Empty State UI */}
      {showEmptyState && (
        <div className="empty-state">
          <div className="empty-state-content">
            <div className="empty-state-header">
              <BookIcon size={64} />
              <h1>Reader</h1>
              <p>Upload an ePub, search Wikipedia or Philosophy, or open a PDF to get started</p>
            </div>

            <div className="upload-section">
              <UploadButton
                onUploadComplete={handleUploadComplete}
                onUploadError={handleUploadError}
                disabled={false}
              />
              
              {uploadError && (
                <div className="error-message" role="alert">
                  <ErrorIcon />
                  <span>{uploadError}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Reader UI */}
      {!showEmptyState && (
        <div
          ref={readerLayoutRef}
          className={`reader-layout ${sessionsPaneOpen ? '' : 'sessions-collapsed'} ${leftPanelCollapsed ? 'left-collapsed' : ''}`}
        >
          {/* Left Panel - Controls and Upload (collapsible; kept mounted so its state survives) */}
          <div className={`left-panel ${leftPanelCollapsed ? 'collapsed' : ''}`} id="reader-left-panel">
            <button
              className="left-panel-collapse"
              onClick={toggleLeftPanel}
              aria-label="Hide side panel"
              aria-expanded={!leftPanelCollapsed}
              aria-controls="reader-left-panel"
              title="Hide side panel ([)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="13 17 8 12 13 7" />
                <polyline points="20 17 15 12 20 7" />
              </svg>
            </button>
            <div className="controls-section">
              <ReadAlongControl
                active={readAlongActive}
                isSupported={readAlong.isSupported}
                onStart={startReadAlong}
                onStop={stopReadAlong}
                onSkip={() => seekToWithChapter(readAlong.pointer + 1)}
                onSkipBack={() => seekToWithChapter(readAlong.pointer - 1)}
                progressLabel={
                  sentences.length > 0
                    ? `${Math.min(readAlong.pointer + 1, sentences.length)} / ${sentences.length}`
                    : undefined
                }
              />

              <TranscriptReadout
                active={readAlongActive}
                transcript={readAlong.liveTranscript}
              />

              {/* Chapter navigation (EPUBs). The retired TTS/audiobook/voice-
                  command controls are gone — the panel keeps the reading column
                  centered and holds only what's still used. */}
              {chapters.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    padding: '0.4rem 0.5rem',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '0.5rem',
                    color: '#c8c4c0',
                    fontSize: '0.85rem',
                  }}
                >
                  <button
                    onClick={() => goToChapter((currentSession?.currentChapter ?? 0) - 1)}
                    disabled={(currentSession?.currentChapter ?? 0) <= 0}
                    aria-label="Previous chapter"
                    title="Previous chapter"
                    style={{
                      background: 'transparent', border: 'none', color: 'inherit',
                      cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.4rem', opacity:
                        (currentSession?.currentChapter ?? 0) <= 0 ? 0.35 : 1,
                    }}
                  >
                    ‹
                  </button>
                  <span>
                    Chapter {(currentSession?.currentChapter ?? 0) + 1} / {chapters.length}
                  </span>
                  <button
                    onClick={() => goToChapter((currentSession?.currentChapter ?? 0) + 1)}
                    disabled={(currentSession?.currentChapter ?? 0) + 1 >= chapters.length}
                    aria-label="Next chapter"
                    title="Next chapter"
                    style={{
                      background: 'transparent', border: 'none', color: 'inherit',
                      cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.4rem', opacity:
                        (currentSession?.currentChapter ?? 0) + 1 >= chapters.length ? 0.35 : 1,
                    }}
                  >
                    ›
                  </button>
                </div>
              )}

              {/* Reading-group schedule (recognized books only). Pins each
                  deadline to a Volume/Part boundary since EPUBs lack pages. */}
              {resolvedSchedule && (
                <ReadingSchedulePanel
                  scheduleTitle={resolvedSchedule.schedule.title}
                  items={resolvedSchedule.items}
                  currentIndex={scheduleCurrentIndex}
                  currentChapter={currentSession?.currentChapter ?? 0}
                  chapterProgress={currentChapterProgress}
                  onJumpToChapter={goToChapter}
                />
              )}

              {sentences.length === 0 && currentSession && (
                <div className="info-message" role="status">
                  <InfoIcon />
                  <span>Extracting text from ePub... This may take a moment.</span>
                </div>
              )}
            </div>

            <div className="upload-section">
              <UploadButton
                onUploadComplete={handleUploadComplete}
                onUploadError={handleUploadError}
                disabled={false}
              />

              <PdfUploadButton
                onUploaded={(filename, warning) => {
                  // Refresh the library so the new PDF appears.
                  readPdfLibrary().then((entries) => setPdfLibrary(entries));
                  setPdfUploadMsg({
                    text: warning
                      ? warning
                      : `${filename} uploaded — open it from the Library.`,
                    warn: !!warning,
                  });
                  setTimeout(() => setPdfUploadMsg(null), 6000);
                }}
                onError={(err) => {
                  setPdfUploadMsg({ text: err, warn: true });
                  setTimeout(() => setPdfUploadMsg(null), 6000);
                }}
              />

              {uploadError && (
                <div className="error-message" role="alert">
                  <ErrorIcon />
                  <span>{uploadError}</span>
                </div>
              )}
              {pdfUploadMsg && (
                <div className={pdfUploadMsg.warn ? 'error-message' : 'info-message'} role="status">
                  <InfoIcon />
                  <span>{pdfUploadMsg.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Center Panel - ePub Display */}
          <div className="center-panel" data-reader-light={getReaderTheme(readerThemeId).light ? 'true' : 'false'} style={readerThemeStyle}>
            {/* Reading-surface controls (theme + font), floats top-right of the reading column. */}
            {leftPanelCollapsed && (
              <button
                className="left-panel-reopen"
                onClick={toggleLeftPanel}
                aria-label="Show side panel"
                aria-expanded={false}
                aria-controls="reader-left-panel"
                title="Show side panel ([)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="13 17 18 12 13 7" />
                  <polyline points="6 17 11 12 6 7" />
                </svg>
              </button>
            )}
            <div className="reader-theme-float">
              <ReaderThemeSwitcher selected={readerThemeId} onSelect={selectReaderTheme} />
              <ReaderFontPicker selected={readerFontId} onSelect={selectReaderFont} />
              <button
                className="reader-fullscreen-btn"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                aria-pressed={isFullscreen}
                title={isFullscreen ? 'Exit fullscreen (f / Esc)' : 'Fullscreen (f)'}
              >
                {isFullscreen ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                )}
              </button>
            </div>
            {sessionLoadError && (
              <div className="session-error" role="alert">
                <ErrorIcon />
                <div>
                  <h3>Error Loading Session</h3>
                  <p>{sessionLoadError}</p>
                  {sessionLoadError.includes('no longer available') && currentSession && (
                    <button
                      onClick={() => handleSessionDelete(currentSession.id)}
                      className="delete-session-button"
                    >
                      Delete Invalid Session
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {/* Hidden EpubDisplay for content extraction (EPUB sources only;
                article sources populate sentences/chapters directly). */}
            {!articleMeta && (
              <div style={{ display: 'none' }}>
                <EpubDisplay
                  epubUrl={currentSession?.epubUrl || null}
                  currentChapter={currentSession?.currentChapter || 0}
                  currentSentenceIndex={currentSentenceIndex}
                  onContentReady={handleContentReady}
                  onError={handleEpubError}
                />
              </div>
            )}
            
            {/* Visible text display with highlighting + comment margin */}
            <div ref={readerScrollRef} className="epub-container reader-workspace-center" style={{ position: 'relative' }}>
              {/* Back button — only shown when there's navigation history */}
              {articleNavHistory.length > 0 && (
                <button
                  onClick={handleGoBack}
                  aria-label="Go back"
                  style={{
                    position: 'absolute',
                    top: '1.25rem',
                    left: '1.25rem',
                    zIndex: 10,
                    background: 'rgba(40,40,40,0.85)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px',
                    color: '#c8c4c0',
                    cursor: 'pointer',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  ← {articleNavHistory[articleNavHistory.length - 1].entry.title.slice(0, 30)}
                </button>
              )}
              {/* Link mode toggle — only meaningful in the article (wiki-link) view.
                  ON: single-click a wiki link to capture it; double-click navigates. */}
              {articleHtml && (
                <button
                  onClick={() => setLinkMode((v) => !v)}
                  aria-pressed={linkMode}
                  title={linkMode
                    ? 'Link mode ON — click a Wikipedia link to save it; double-click to open it. Click here to turn off.'
                    : 'Link mode OFF — turn on to capture Wikipedia links with a single click'}
                  style={{
                    position: 'absolute',
                    top: '1.25rem',
                    right: '1.25rem',
                    zIndex: 10,
                    background: linkMode ? 'rgba(140,40,180,0.85)' : 'rgba(40,40,40,0.85)',
                    border: `1px solid ${linkMode ? 'rgba(180,120,220,0.9)' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: '6px',
                    color: linkMode ? '#fff' : '#c8c4c0',
                    cursor: 'pointer',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                >
                  🔗 Link mode: {linkMode ? 'ON' : 'OFF'}
                </button>
              )}
              {/* Loading overlay while fetching an article */}
              {isLoadingArticle && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 20,
                  background: 'rgba(18,18,20,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(2px)',
                }}>
                  <div style={{ color: '#c8c4c0', fontSize: '0.9rem', opacity: 0.8 }}>Loading…</div>
                </div>
              )}
              <div ref={epubContainerRef} className="reader-text-col">
                {articleHtml ? (
                  <ArticleNativeView
                    html={articleHtml}
                    title={articleMeta?.title || ''}
                    currentSentenceIndex={currentSentenceIndex}
                    readAlongActive={readAlongActive}
                    annotations={annotationWorkspace.annotations}
                    activeThreadId={annotationWorkspace.activeThreadId}
                    onSelection={annotationWorkspace.beginSelection}
                    onSentenceClick={seekToWithChapter}
                    onAnnotationClick={annotationWorkspace.setActiveThread}
                    scrollRef={readerScrollRef}
                    inSentencePos={readAlong.inSentencePos}
                    currentSentenceTokens={readAlong.currentSentenceTokens}
                    onOpenWikiLink={handleOpenWikiLink}
                    linkMode={linkMode}
                    onAddWikiLink={handleAddWikiLink}
                  />
                ) : sentences.length > 0 && chapters.length > 0 ? (
                  <TextDisplay
                    chapters={chapters}
                    currentChapter={currentSession?.currentChapter || 0}
                    currentSentenceIndex={currentSentenceIndex}
                    readAlongActive={readAlongActive}
                    readAlongPointer={readAlong.pointer}
                    readAlongStates={readAlong.states}
                    annotations={annotationWorkspace.annotations}
                    activeThreadId={annotationWorkspace.activeThreadId}
                    onSelection={annotationWorkspace.beginSelection}
                    onSentenceClick={seekToWithChapter}
                    onAnnotationClick={annotationWorkspace.setActiveThread}
                    onFootnoteClick={handleFootnoteClick}
                    inSentencePos={readAlong.inSentencePos}
                    currentSentenceTokens={readAlong.currentSentenceTokens}
                    headingIndices={articleMeta ? headingIndices : undefined}
                    listItemIndices={articleMeta ? listItemIndices : undefined}
                    paragraphBreaks={articleMeta ? paragraphBreaks : undefined}
                  />
                ) : currentSession ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-red-500"></div>
                    <p>Extracting text from ePub...</p>
                    <p className="text-sm text-gray-500">This may take a moment for large books</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2 px-6 text-center">
                    <p>Open something from your Library to begin.</p>
                    <p className="text-sm text-gray-600">Books, Wikipedia &amp; Philosophy articles, and PDFs all live in the Library panel →</p>
                  </div>
                )}


                {/* Inline footnote / translation popover (EPUB). Anchored to the
                    clicked marker; "Go to note" still jumps to the back. */}
                {footnotePopover && (
                  <FootnotePopover
                    anchorEl={footnotePopover.anchorEl}
                    label={footnotePopover.label}
                    text={footnotePopover.text}
                    onClose={() => setFootnotePopover(null)}
                    onGoToNote={() => {
                      const ref = footnotePopover.ref;
                      setFootnotePopover(null);
                      jumpToNote(ref);
                    }}
                  />
                )}
              </div>
            </div>

            {/* Slide-notes-style summary strip, pinned under the reading panel */}
            {docId && (articleMeta || currentSession) && (
              <ReaderSummaryStrip
                docId={docId}
                chapter={articleMeta ? 0 : (currentSession?.currentChapter ?? 0)}
                label={chapters.length > 0 ? `Chapter ${(currentSession?.currentChapter ?? 0) + 1}` : undefined}
                onCommit={handleSummaryCommit}
              />
            )}
          </div>

          {/* Right Panel — unified rail: Library + Comments (collapsible) */}
          {sessionsPaneOpen ? (
            <div className="right-panel" style={readerThemeStyle}>
              <ReaderRail
                libraryItems={libraryItems}
                currentItemId={currentItemId}
                onOpenItem={handleOpenItem}
                onDeleteItem={handleDeleteItem}
                onSearch={handleSearch}
                isLoading={isLoadingSession}
                annotations={chapterAnnotations}
                activeThreadId={annotationWorkspace.activeThreadId}
                aiStatus={annotationWorkspace.aiStatus}
                syncStatus={annotationWorkspace.syncStatus}
                onSelectThread={annotationWorkspace.setActiveThread}
                onAddNote={docId ? (text) => annotationWorkspace.addNote(text, currentSentenceIndex) : undefined}
                onRequestAi={annotationWorkspace.requestAiReply}
                onEditAnnotation={annotationWorkspace.editAnnotation}
                onEditSelectedText={annotationWorkspace.editSelectedText}
                onEditLinkTarget={annotationWorkspace.editLinkTarget}
                onDeleteAnnotation={annotationWorkspace.deleteAnnotation}
                onRetrySync={annotationWorkspace.retrySync}
                sentences={sentences}
                onCollapse={() => setSessionsPaneOpen(false)}
                onSaveArticleToVault={articleMeta ? handleSaveArticleToVault : undefined}
              />
            </div>
          ) : (
            <button
              className="sessions-reopen"
              onClick={openRail}
              aria-label="Show sessions panel"
              title="Show sessions panel"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          )}

          {/* Comment popover for an active selection (reader-workspace) */}
          {annotationWorkspace.pendingPopover && (
            <CommentPopover
              pending={annotationWorkspace.pendingPopover}
              onChangeText={annotationWorkspace.setPendingText}
              onCommit={annotationWorkspace.commitPending}
              onToggleLink={() =>
                annotationWorkspace.setPendingLink(!annotationWorkspace.pendingPopover!.linkEnabled)
              }
              onChangeLinkTarget={annotationWorkspace.setPendingLinkTarget}
            />
          )}
        </div>
      )}

      <style jsx>{`
        .reader-page {
          width: 100%;
          height: 100%;
          background: #111827;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        /* Empty State Styles */
        .empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          flex: 1;
          padding: 2rem;
          overflow-y: auto;
        }

        .empty-state-content {
          max-width: 48rem;
          width: 100%;
          background: #1f2937;
          border-radius: 1rem;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          padding: 3rem;
          border: 1px solid #374151;
        }

        .empty-state-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          text-align: center;
          margin-bottom: 2rem;
        }

        .empty-state-header h1 {
          margin: 0;
          font-size: 2rem;
          font-weight: 700;
          color: #f9fafb;
        }

        .empty-state-header p {
          margin: 0;
          font-size: 1.125rem;
          color: #d1d5db;
        }

        .upload-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        /* Main Reader Layout */
        .reader-layout {
          display: grid;
          grid-template-columns: 320px 1fr 400px;
          flex: 1;
          gap: 0;
          overflow: hidden;
          position: relative;
        }

        /* Collapsed: the right sessions rail is hidden; a thin tab reopens it. */
        .reader-layout.sessions-collapsed {
          grid-template-columns: 320px 1fr;
        }

        /* Fullscreen: give the layout a solid ground (default is black). */
        .reader-layout:fullscreen {
          background: #111827;
          width: 100%;
          height: 100%;
        }

        /* Collapsed left panel: hidden (kept mounted); a thin tab reopens it. */
        .reader-layout.left-collapsed {
          grid-template-columns: 1fr 400px;
        }
        .reader-layout.left-collapsed.sessions-collapsed {
          grid-template-columns: 1fr;
        }
        .left-panel.collapsed {
          display: none;
        }

        .left-panel-collapse {
          align-self: flex-end;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: -0.75rem -0.75rem -0.75rem 0;
          padding: 0.3rem;
          background: transparent;
          color: #f06060;
          border: 1px solid transparent;
          border-radius: 0.4rem;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .left-panel-collapse:hover {
          background: #1a0505;
          border-color: #4a1010;
          color: #ff8080;
        }

        .left-panel-reopen {
          position: absolute;
          top: 1rem;
          left: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.6rem 0.45rem;
          background: #1a0505;
          color: #f06060;
          border: 1px solid #4a1010;
          border-left: none;
          border-radius: 0 0.5rem 0.5rem 0;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }
        .left-panel-reopen:hover {
          background: #2d0a0a;
          color: #ff8080;
        }

        .reader-fullscreen-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 9999px;
          padding: 0.25rem 0.4rem;
          cursor: pointer;
          transition: color 0.12s ease, background 0.12s ease;
          line-height: 1;
        }
        .reader-fullscreen-btn:hover,
        .reader-fullscreen-btn[aria-pressed='true'] {
          color: rgba(255, 255, 255, 0.95);
          background: rgba(0, 0, 0, 0.55);
        }

        .sessions-reopen {
          position: absolute;
          top: 1rem;
          right: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.6rem 0.45rem;
          background: #1a0505;
          color: #f06060;
          border: 1px solid #4a1010;
          border-right: none;
          border-radius: 0.5rem 0 0 0.5rem;
          cursor: pointer;
          transition: background 0.2s, color 0.2s;
        }

        .sessions-reopen:hover {
          background: #2d0a0a;
          color: #ff8080;
        }

        .left-panel {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          padding: 1.5rem;
          background: #2d0a0a;
          border-right: 1px solid #4a1010;
          overflow-y: auto;
        }

        .controls-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .center-panel {
          display: flex;
          flex-direction: column;
          position: relative;
          background: var(--reader-bg, #000000);
          overflow: hidden;
        }

        /* Wikipedia/IEP math-formula images are black SVGs meant to be inverted on
           dark backgrounds (their mw-invert class), but we strip the wiki styles
           that do it. Re-apply the inversion on dark reader themes so formulas are
           legible; light themes keep them black. */
        .center-panel:not([data-reader-light="true"]) .mwe-math-fallback-image-inline,
        .center-panel:not([data-reader-light="true"]) .mwe-math-fallback-image-display,
        .center-panel:not([data-reader-light="true"]) .mwe-math-element img {
          filter: invert(1);
        }

        .reader-theme-float {
          position: absolute;
          top: 0.75rem;
          right: 0.9rem;
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .epub-container {
          flex: 1;
          position: relative;
          overflow: auto;
          background: var(--reader-bg, #2d0a0a);
        }

        /* Reader-workspace: center becomes text column + comment margin. */
        .reader-workspace-center {
          display: flex;
          align-items: flex-start;
        }

        .reader-text-col {
          flex: 1;
          min-width: 0;
        }

        .session-error {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.5rem;
          margin: 1.5rem;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 0.5rem;
          color: #991b1b;
        }

        .session-error h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.125rem;
          font-weight: 600;
        }

        .session-error p {
          margin: 0 0 1rem 0;
          font-size: 0.9375rem;
        }

        .delete-session-button {
          padding: 0.5rem 1rem;
          background: #dc2626;
          color: white;
          border: none;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .delete-session-button:hover {
          background: #b91c1c;
        }

        .right-panel {
          background: #2d0a0a;
          overflow: hidden;
        }

        .sessions-section {
          height: 100%;
          overflow: hidden;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: 0.375rem;
          color: #991b1b;
          font-size: 0.875rem;
        }

        .info-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: #2d0a0a;
          border: 1px solid #6b1818;
          border-radius: 0.375rem;
          color: #f06060;
          font-size: 0.875rem;
        }

        /* Scrollbar styling */
        .left-panel::-webkit-scrollbar,
        .epub-container::-webkit-scrollbar {
          width: 0.5rem;
        }

        .left-panel::-webkit-scrollbar-track,
        .epub-container::-webkit-scrollbar-track {
          background: #1a0505;
        }

        .left-panel::-webkit-scrollbar-thumb,
        .epub-container::-webkit-scrollbar-thumb {
          background: #6b1818;
          border-radius: 0.25rem;
        }

        .left-panel::-webkit-scrollbar-thumb:hover,
        .epub-container::-webkit-scrollbar-thumb:hover {
          background: #8b2020;
        }

        /* Responsive design */
        @media (max-width: 1280px) {
          .reader-layout {
            grid-template-columns: 280px 1fr 350px;
          }
        }

        @media (max-width: 1024px) {
          .reader-layout {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr auto;
          }

          .left-panel,
          .right-panel {
            border-right: none;
            border-bottom: 1px solid #4a1010;
          }

          .right-panel {
            grid-template-rows: none;
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </div>
    </AppShell>
  );
}

// Icon components
function BookIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: '#b83030' }}
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
