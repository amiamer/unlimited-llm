'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { deriveWordStates } from '@/lib/reader-workspace/word-state';
import type { Annotation } from '@/lib/reader-workspace/types';

/**
 * ArticleNativeView — renders an article the way it looks in a browser.
 * Feature: unified-reader (native article view)
 */

interface ArticleNativeViewProps {
  html: string;
  title: string;
  currentSentenceIndex: number;
  readAlongActive: boolean;
  annotations: Annotation[];
  activeThreadId: string | null;
  onSelection?: (range: Range, container: HTMLElement) => void;
  onSentenceClick?: (index: number) => void;
  onAnnotationClick?: (annotationId: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  inSentencePos?: number;
  currentSentenceTokens?: string[];
  onOpenWikiLink?: (title: string) => void;
  /** When true, a single click on a wiki link captures it as a link annotation
   *  (no navigation); a double-click navigates instead. */
  linkMode?: boolean;
  /** Capture a wiki link straight from its anchor (used by link mode). */
  onAddWikiLink?: (range: Range, container: HTMLElement, wikiTitle: string) => void;
}

// Colors come from the reader theme's CSS variables (see
// lib/reader-sources/reader-themes.ts), so every highlight is tuned to the
// current surface. Same meanings as the EPUB view: amber = your notes, violet =
// linked concepts, the accent = where you're reading.
const ACCENT = 'var(--reader-accent, #b83030)';
const POSITION_TINT = `color-mix(in srgb, ${ACCENT} 9%, transparent)`;
const POSITION_UNDERLINE = `inset 0 -0.12em 0 ${ACCENT}`;
const NOTE_ACTIVE = 'var(--reader-hl-note-active, #57450C)';
const LINK_ACTIVE = 'var(--reader-hl-link-active, #453D6D)';
const WORD_READ = 'color-mix(in srgb, currentColor 6%, transparent)';
const WORD_CURRENT = `color-mix(in srgb, ${ACCENT} 28%, transparent)`;

/**
 * Extract a Wikipedia article title from any internal-link href format the
 * parsed HTML produces, or return null for external/non-article links.
 * Handles: "/wiki/Culture", "./Culture", "../wiki/Culture",
 * "https://en.wikipedia.org/wiki/Culture", with #fragments and ?queries
 * stripped. Skips special namespaces (File:, Help:, Category:, etc.) and
 * non-wiki links so citations/external URLs behave normally.
 */
export function parseWikiTitle(href: string): string | null {
  if (!href) return null;
  // Reject obvious externals that aren't wikipedia.
  if (/^(mailto:|tel:|#)/i.test(href)) return null;

  let path = href;

  // Absolute URL → keep only the path if it's a wikipedia host.
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      if (!/\bwikipedia\.org$/i.test(u.hostname)) return null; // external link
      path = u.pathname;
    } catch {
      return null;
    }
  }

  // Strip fragment and query.
  path = path.split('#')[0].split('?')[0];

  // Normalize to the part after /wiki/ or a leading ./ or ../
  let raw: string | null = null;
  const wikiIdx = path.indexOf('/wiki/');
  if (wikiIdx !== -1) {
    raw = path.slice(wikiIdx + '/wiki/'.length);
  } else if (path.startsWith('./')) {
    raw = path.slice(2);
  } else if (path.startsWith('../')) {
    raw = path.replace(/^(\.\.\/)+/, '');
  } else {
    return null; // not an internal article link
  }

  if (!raw) return null;

  // Skip non-article namespaces (File:, Image:, Help:, Category:, Special:, etc.)
  const decoded = decodeURIComponent(raw).replace(/_/g, ' ').trim();
  if (/^(File|Image|Help|Category|Special|Template|Wikipedia|Portal|Talk|User|Media):/i.test(decoded)) {
    return null;
  }
  return decoded || null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Find `searchText` inside `haystack`, tolerant of whitespace differences
// (the captured selection may collapse newlines/runs of spaces differently than
// the DOM text node content). Returns the [start, end) range in haystack
// coordinates, or null. Tries an exact match first, then a whitespace-flexible
// regex fallback.
function findTextRange(haystack: string, searchText: string): [number, number] | null {
  const exact = haystack.toLowerCase().indexOf(searchText.toLowerCase());
  if (exact >= 0) return [exact, exact + searchText.length];

  try {
    const pattern = searchText
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    const m = new RegExp(pattern, 'i').exec(haystack);
    if (m) return [m.index, m.index + m[0].length];
  } catch {
    /* unusual chars in selection — give up */
  }
  return null;
}

// annotationId is stored on the span so CSS can target the active one without
// re-parsing the entire HTML string on every activeThreadId change. Returns true
// if at least one highlight span was injected.
//
// The matched range is wrapped one text node at a time, so the highlight paints
// reliably even when the selection covers an <a> element (e.g. a Wikipedia link)
// — wrapping a multi-element range with surroundContents would otherwise throw
// and the old extract/re-insert fallback left linked text uncoloured. Text that
// already sits inside a .ra-link-hl span is skipped, so the same span is never
// highlighted twice.
function injectLinkHighlight(container: Element, searchText: string, annotationId: string, kind: 'link' | 'comment'): boolean {
  const haystack = container.textContent ?? '';
  const found = findTextRange(haystack, searchText);
  if (!found) return false;
  const [matchIdx, endIdx] = found;

  // Collect the text-node segments overlapping [matchIdx, endIdx) WITHOUT
  // mutating the DOM (mutating mid-walk would invalidate the walker).
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let charsSeen = 0;
  let cur: Node | null = walker.nextNode();
  while (cur) {
    const node = cur as Text;
    const len = node.length;
    const nodeStart = charsSeen;
    const nodeEnd = charsSeen + len;
    if (nodeEnd > matchIdx && nodeStart < endIdx) {
      // Skip text already wrapped in a highlight — no double-highlighting.
      if (!node.parentElement?.closest('.ra-link-hl')) {
        const s = Math.max(0, matchIdx - nodeStart);
        const e = Math.min(len, endIdx - nodeStart);
        if (e > s) segments.push({ node, start: s, end: e });
      }
    }
    if (nodeEnd >= endIdx) break;
    charsSeen = nodeEnd;
    cur = walker.nextNode();
  }
  if (segments.length === 0) return false;

  // Color is decided PER SEGMENT, not per annotation: within one highlight,
  // only the words actually inside a wiki link paint as a link — the rest of
  // the selection paints as a note. (Wiki anchors have had their href stripped
  // into data-wiki by the time highlights are injected, so match on data-wiki.)
  //   - segment inside a[data-wiki] on a link annotation → link
  //   - any other segment of a mixed link annotation, or a comment → note
  //   - a manual concept link with no wiki anchor anywhere → link
  const segInWiki = (seg: { node: Text }) =>
    !!seg.node.parentElement?.closest('a[data-wiki]');
  const hasWikiSegment = kind === 'link' && segments.some(segInWiki);

  let wrapped = false;
  for (const seg of segments) {
    const hue: 'link' | 'note' =
      kind === 'link' && (segInWiki(seg) || !hasWikiSegment) ? 'link' : 'note';
    const range = document.createRange();
    range.setStart(seg.node, seg.start);
    range.setEnd(seg.node, seg.end);
    const span = document.createElement('span');
    span.className = 'ra-link-hl';
    span.dataset.annotationId = annotationId;
    // The color comes from the theme via the .ra-link-hl[data-hue] rules below,
    // so a theme switch recolors existing highlights without re-parsing; the
    // active state is applied via highlightCss for the same reason.
    span.dataset.hue = hue;
    try {
      // Each range is within a single text node, so this never throws.
      range.surroundContents(span);
      wrapped = true;
    } catch {
      /* defensive: skip a segment that somehow can't be wrapped */
    }
  }
  return wrapped;
}

export function ArticleNativeView({
  html,
  title,
  currentSentenceIndex,
  readAlongActive,
  annotations,
  activeThreadId,
  onSelection,
  onSentenceClick,
  onAnnotationClick,
  scrollRef,
  inSentencePos = -1,
  currentSentenceTokens = [],
  onOpenWikiLink,
  linkMode = false,
  onAddWikiLink,
}: ArticleNativeViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const wordOverlayRef = useRef<{ el: Element; sentenceIdx: number; originalHtml: string } | null>(null);

  const wordLevelActive =
    readAlongActive && inSentencePos >= 0 && currentSentenceTokens.length > 0;

  // Bake link-highlight spans into the HTML string so React owns them and they
  // survive re-renders without DOM-mutation/cleanup races.
  const htmlWithHighlights = useMemo(() => {
    if (typeof document === 'undefined') return html;

    const div = document.createElement('div');
    div.innerHTML = html;

    // NEUTRALIZE internal wiki links: strip the href entirely and stash the
    // resolved title on data-wiki. With no href the browser cannot navigate to
    // the (non-existent) /wiki/* route even if a click handler misses — this is
    // the bulletproof fix for the intermittent 404-on-link-click. The click
    // handler reads data-wiki. External links keep their href and open normally.
    div.querySelectorAll('a[href]').forEach((el) => {
      const anchor = el as HTMLAnchorElement;
      const rawHref = anchor.getAttribute('href') ?? '';
      const title = parseWikiTitle(rawHref);
      if (title) {
        anchor.setAttribute('data-wiki', title);
        anchor.removeAttribute('href'); // no href → no navigation, ever
      } else {
        // External link (Wiktionary, citations, official sites, etc.). Open in
        // a new tab so clicking never navigates the reader away and loses your
        // place. Also normalize protocol-relative and wiki-relative hrefs to
        // absolute wikipedia URLs so they resolve correctly off-site.
        let absolute = rawHref;
        if (rawHref.startsWith('//')) absolute = `https:${rawHref}`;
        else if (rawHref.startsWith('/wiki/')) absolute = `https://en.wikipedia.org${rawHref}`;
        if (/^https?:\/\//i.test(absolute)) {
          anchor.setAttribute('href', absolute);
          anchor.setAttribute('target', '_blank');
          anchor.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });

    // Highlight the EXACT selected text for every annotation — comments included
    // — so only what you highlighted is colored, never the whole sentence.
    const highlightable = annotations.filter((a) => a.selectedText?.trim());
    for (const a of highlightable) {
      const search = a.selectedText!.trim();
      const kind: 'link' | 'comment' = a.linkTarget !== undefined ? 'link' : 'comment';
      // Prefer the anchored sentence (keeps the highlight where the user meant),
      // but fall back to the whole article body so cross-sentence selections and
      // whitespace-variant matches still get highlighted instead of silently
      // disappearing.
      const sentenceEl = div.querySelector(`[data-sentence-index="${a.startSentenceIndex}"]`);
      const injected = sentenceEl ? injectLinkHighlight(sentenceEl, search, a.id, kind) : false;
      if (!injected) injectLinkHighlight(div, search, a.id, kind);
    }
    return div.innerHTML;
  // Active state is handled by highlightCss CSS rules, not here, so activeThreadId
  // is intentionally excluded — avoids re-parsing the full HTML on every click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, annotations]);

  const highlightCss = useMemo(() => {
    const rules: string[] = [];
    // Your position (the read-along sentence, or the one you clicked) gets a
    // faint accent tint plus an accent underline, the same as the EPUB view.
    if (currentSentenceIndex >= 0) {
      rules.push(`.ra-article [data-sentence-index="${currentSentenceIndex}"]{background:${POSITION_TINT};box-shadow:${POSITION_UNDERLINE};}`);
    }
    // No whole-sentence background — only the exact highlighted text is colored
    // (via the .ra-link-hl spans baked into htmlWithHighlights). Here we just
    // deepen the active annotation's spans when its thread is selected.
    if (activeThreadId) {
      rules.push(`.ra-article .ra-link-hl[data-annotation-id="${activeThreadId}"][data-hue="note"]{background:${NOTE_ACTIVE};}`);
      rules.push(`.ra-article .ra-link-hl[data-annotation-id="${activeThreadId}"][data-hue="link"]{background:${LINK_ACTIVE};}`);
    }
    return rules.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSentenceIndex, annotations, activeThreadId]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;

    if (wordOverlayRef.current && wordOverlayRef.current.sentenceIdx !== currentSentenceIndex) {
      wordOverlayRef.current.el.innerHTML = wordOverlayRef.current.originalHtml;
      wordOverlayRef.current = null;
    }

    if (!wordLevelActive) {
      if (wordOverlayRef.current) {
        wordOverlayRef.current.el.innerHTML = wordOverlayRef.current.originalHtml;
        wordOverlayRef.current = null;
      }
      return;
    }

    const el = container.querySelector(`[data-sentence-index="${currentSentenceIndex}"]`);
    if (!el) return;

    if (!wordOverlayRef.current || wordOverlayRef.current.sentenceIdx !== currentSentenceIndex) {
      wordOverlayRef.current = { el, sentenceIdx: currentSentenceIndex, originalHtml: el.innerHTML };
    }

    const words = (el.textContent ?? '').split(/\s+/).filter(Boolean);
    if (!words.length) return;

    const wordStates = deriveWordStates(
      words,
      currentSentenceTokens.length || words.length,
      inSentencePos,
    );

    el.innerHTML = words
      .map((w, i) => {
        const st = wordStates?.[i];
        const bg = st === 'current' ? WORD_CURRENT : st === 'read' ? WORD_READ : 'transparent';
        return `<span style="background:${bg};border-radius:2px;transition:background-color 0.18s ease;">${escHtml(w)}</span>`;
      })
      .join(' ');
  }, [currentSentenceIndex, inSentencePos, currentSentenceTokens, wordLevelActive]);

  useEffect(() => {
    const container = scrollRef?.current;
    if (!container || currentSentenceIndex < 0) return;
    const el = container.querySelector(`[data-sentence-index="${currentSentenceIndex}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (rect.top < vh * 0.2 || rect.bottom > vh * 0.7) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSentenceIndex, scrollRef]);


  // -------------------------------------------------------------------------
  // Gesture disambiguation — one state machine for every pointer interaction.
  //
  //   drag (mousedown → moved ≥ DRAG_PX → mouseup)  → comment popover, always,
  //     no matter what elements the selection covers (links, highlights, both).
  //   double/triple-click word/paragraph-select on non-link text → popover.
  //   single click:  highlighted wiki link → open thread (deferred — see below)
  //                  plain wiki link       → navigate
  //                  non-link highlight    → open thread
  //                  external link         → browser default (new tab)
  //                  plain sentence        → sentence click
  //   double-click:  wiki link             → navigate
  //
  // A gesture is classified as a drag by pointer DISPLACEMENT, never by
  // inspecting the selection at mouseup — a double-click's auto word-selection
  // therefore can't masquerade as a drag, and a drag over a link can't be
  // mistaken for a click (the click event a drag produces is swallowed via
  // suppressClickRef). Selection state is never consulted in handleClick.
  // -------------------------------------------------------------------------
  const DRAG_PX = 5;
  const dragStateRef = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const detachDragListenersRef = useRef<(() => void) | null>(null);

  // The ONE unavoidable timer: single-click and double-click both carry an
  // action on a HIGHLIGHTED wiki link (open thread vs navigate). The browser
  // only reveals that a click was "single" by not sending a second one, so the
  // thread-open is deferred one double-click window. Every other target type
  // acts immediately.
  const highlightLinkTimer = useRef<number | null>(null);
  // Link mode: a single click captures the wiki link, but we defer one
  // double-click window so a double-click can navigate instead of capturing.
  const linkCaptureTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      detachDragListenersRef.current?.();
      if (highlightLinkTimer.current !== null) {
        window.clearTimeout(highlightLinkTimer.current);
      }
      if (linkCaptureTimer.current !== null) {
        window.clearTimeout(linkCaptureTimer.current);
      }
    };
  }, []);

  const openSelectionPopover = () => {
    if (!onSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (sel.toString().trim().length === 0) return;
    const body = bodyRef.current;
    if (!body) return;
    onSelection(sel.getRangeAt(0), body);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    detachDragListenersRef.current?.(); // stray listeners from an interrupted gesture
    suppressClickRef.current = false; // stale flag from a drag whose click never fired
    dragStateRef.current = { x: e.clientX, y: e.clientY, dragging: false };

    // Track the rest of the gesture on document so a drag that leaves the
    // article (or releases over the rail) still resolves correctly.
    const onMove = (ev: MouseEvent) => {
      const g = dragStateRef.current;
      if (!g || g.dragging) return;
      if (Math.abs(ev.clientX - g.x) >= DRAG_PX || Math.abs(ev.clientY - g.y) >= DRAG_PX) {
        g.dragging = true;
      }
    };
    const onUp = (ev: MouseEvent) => {
      detach();
      const g = dragStateRef.current;
      dragStateRef.current = null;
      if (g?.dragging) {
        // Drag → selection gesture. The click event the browser fires next is
        // a byproduct of the drag, not an intent — swallow it so it can't
        // navigate a link or open a thread underneath the popover.
        suppressClickRef.current = true;
        openSelectionPopover();
        return;
      }
      // Stationary multi-click (double/triple) selects a word/paragraph. On
      // non-link text that's a legitimate way to grab a comment target; on a
      // wiki link it's the navigate gesture, which handleClick owns.
      if (ev.detail >= 2) {
        const t = ev.target instanceof HTMLElement ? ev.target : null;
        if (!t?.closest('a[data-wiki]')) openSelectionPopover();
      }
    };
    const detach = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      detachDragListenersRef.current = null;
    };
    detachDragListenersRef.current = detach;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleClick = (e: React.MouseEvent) => {
    // A drag just ended — this click is its byproduct, not an intent.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const target = e.target as HTMLElement;
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    const wikiTitle = anchor?.getAttribute('data-wiki') ?? null;
    const hl = target.closest('.ra-link-hl') as HTMLElement | null;
    const annotationId = hl?.dataset.annotationId ?? null;

    const navigate = () => {
      if (!wikiTitle) return;
      if (onOpenWikiLink) {
        onOpenWikiLink(wikiTitle);
      } else {
        window.open(
          `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`,
          '_blank',
          'noopener,noreferrer',
        );
      }
    };

    // ---- LINK MODE: capture a plain wiki link on single click ----
    // Single click files the link (deferred one double-click window); a
    // double-click navigates to the article instead. Already-highlighted links
    // fall through to the normal thread/navigate handling below.
    if (linkMode && wikiTitle && !annotationId) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail >= 2) {
        if (linkCaptureTimer.current !== null) {
          window.clearTimeout(linkCaptureTimer.current);
          linkCaptureTimer.current = null;
        }
        window.getSelection()?.removeAllRanges(); // drop the double-click word-select
        navigate();
        return;
      }
      const body = bodyRef.current;
      if (!body || !onAddWikiLink || !anchor) return;
      // Snapshot the anchor's range now — the event target is still live here.
      const range = document.createRange();
      range.selectNodeContents(anchor);
      if (linkCaptureTimer.current !== null) window.clearTimeout(linkCaptureTimer.current);
      linkCaptureTimer.current = window.setTimeout(() => {
        linkCaptureTimer.current = null;
        onAddWikiLink(range, body, wikiTitle);
      }, 250);
      return;
    }

    // ---- double (or triple) click ----
    if (e.detail >= 2) {
      if (wikiTitle) {
        e.preventDefault();
        e.stopPropagation();
        // The auto word-selection is an artifact of the double-click; clear it
        // so it doesn't linger under the navigated-to article.
        window.getSelection()?.removeAllRanges();
        if (annotationId) {
          // Highlighted link: cancel the deferred thread-open and navigate.
          if (highlightLinkTimer.current !== null) {
            window.clearTimeout(highlightLinkTimer.current);
            highlightLinkTimer.current = null;
          }
          navigate();
        }
        // Plain link: the first click of this double-click already navigated.
      }
      // Non-link double-click: word-selection popover is handled at mouseup.
      return;
    }

    // ---- single click ----
    if (wikiTitle && annotationId) {
      // Highlighted wiki link: defer the thread-open one double-click window
      // in case this is the first half of a navigate double-click.
      e.preventDefault();
      e.stopPropagation();
      if (highlightLinkTimer.current !== null) window.clearTimeout(highlightLinkTimer.current);
      highlightLinkTimer.current = window.setTimeout(() => {
        highlightLinkTimer.current = null;
        onAnnotationClick?.(annotationId);
      }, 250);
      return;
    }

    // Plain (non-highlighted) wiki link → navigate immediately. No deferral:
    // a double-click would go to the same place, so acting on the first click
    // is harmless and feels instant.
    if (wikiTitle) {
      e.preventDefault();
      e.stopPropagation();
      navigate();
      return;
    }

    // A highlight that is NOT a wiki link → open its comment thread.
    if (annotationId) {
      e.preventDefault();
      onAnnotationClick?.(annotationId);
      return;
    }

    // Any other anchor (external link, citation) behaves normally — hrefs were
    // normalized to absolute URLs with target="_blank" at render time.
    if (anchor) return;

    const el = target.closest('[data-sentence-index]');
    if (!el) return;
    const index = Number.parseInt(el.getAttribute('data-sentence-index') || '', 10);
    if (!Number.isInteger(index)) return;
    const covering = annotations.find(
      (a) => index >= a.startSentenceIndex && index <= a.endSentenceIndex,
    );
    if (covering && onAnnotationClick) {
      onAnnotationClick(covering.id);
      return;
    }
    onSentenceClick?.(index);
  };

  return (
    <div className={`ra-article-root${linkMode ? ' ra-link-mode' : ''}`} onMouseDown={handleMouseDown}>
      <style>{highlightCss}</style>

      <article className="ra-article">
        <h1 className="ra-article-title">{title}</h1>
        <div
          ref={bodyRef}
          className="ra-article-body"
          onClick={handleClick}
          onDragStart={(e) => e.preventDefault()}
          dangerouslySetInnerHTML={{ __html: htmlWithHighlights }}
        />
      </article>

      <style>{`
        .ra-article {
          max-width: 760px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 5rem;
          color: var(--reader-text, #d7d3d0);
          font-family: var(--reader-font, Georgia, 'Iowan Old Style', 'Times New Roman', serif);
          font-size: 1.075rem;
          line-height: 1.75;
        }
        .ra-article-title {
          font-size: 2.3rem;
          font-weight: 700;
          line-height: 1.2;
          color: var(--reader-heading, #f5f3f2);
          margin: 0 0 1.5rem;
        }
        .ra-article-body h1,
        .ra-article-body h2 {
          font-size: 1.55rem;
          font-weight: 700;
          color: var(--reader-heading, #f0ece9);
          margin: 2rem 0 0.75rem;
          padding-bottom: 0.3rem;
          border-bottom: 1px solid var(--reader-muted, #2a2a2a);
          line-height: 1.3;
        }
        .ra-article-body h3 {
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--reader-heading, #ebe7e4);
          margin: 1.5rem 0 0.5rem;
        }
        .ra-article-body h4,
        .ra-article-body h5,
        .ra-article-body h6 {
          font-size: 1.08rem;
          font-weight: 600;
          color: var(--reader-heading, #e6e2df);
          margin: 1.2rem 0 0.4rem;
        }
        .ra-article-body p {
          margin: 0 0 1.1rem;
        }
        .ra-article-body a {
          color: var(--reader-link, #8EBCEC);
          text-decoration: none;
          cursor: pointer;
          -webkit-user-drag: none;
          user-select: text;
          -webkit-user-select: text;
        }
        .ra-article-body a:hover {
          text-decoration: underline;
        }
        /* Link mode: make wiki links read as one-click-capturable. */
        .ra-link-mode .ra-article-body a[data-wiki] {
          cursor: copy;
          text-decoration: underline dashed color-mix(in srgb, var(--reader-link, #8EBCEC) 70%, transparent);
          text-underline-offset: 3px;
        }
        .ra-link-mode .ra-article-body a[data-wiki]:hover {
          background: var(--reader-hl-link, #2D2A43);
          border-radius: 2px;
          text-decoration: underline solid var(--reader-link, #8EBCEC);
        }
        /* Highlights paint over links: the colored span sits inside the <a>,
           and the link text keeps its color. Colors come from the theme. */
        .ra-article-body .ra-link-hl {
          border-radius: 2px;
          -webkit-box-decoration-break: clone;
          box-decoration-break: clone;
        }
        .ra-article-body .ra-link-hl[data-hue="note"] {
          background: var(--reader-hl-note, #372C11);
        }
        .ra-article-body .ra-link-hl[data-hue="link"] {
          background: var(--reader-hl-link, #2D2A43);
        }
        .ra-article-body a .ra-link-hl {
          color: inherit;
        }
        .ra-article-body ul,
        .ra-article-body ol {
          margin: 0 0 1.1rem 1.6rem;
        }
        .ra-article-body li {
          margin-bottom: 0.4rem;
        }
        .ra-article-body blockquote {
          border-left: 3px solid var(--reader-accent, #4a1010);
          padding-left: 1rem;
          margin: 0 0 1.1rem;
          color: var(--reader-muted, #b9b3af);
          font-style: italic;
        }
        .ra-article-body img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          margin: 0.75rem 0;
        }
        .ra-article-body figure {
          margin: 1rem 0;
        }
        .ra-article-body figcaption {
          font-size: 0.85rem;
          color: var(--reader-muted, #9a938f);
          margin-top: 0.35rem;
        }
        .ra-article-body .thumb {
          display: inline-block;
          clear: both;
          margin: 0.75rem 1.25rem 0.75rem 0;
          max-width: 100%;
        }
        .ra-article-body .thumb.tright,
        .ra-article-body .floatright {
          float: right;
          margin: 0.5rem 0 0.75rem 1.25rem;
        }
        .ra-article-body .thumb.tleft,
        .ra-article-body .floatleft {
          float: left;
          margin: 0.5rem 1.25rem 0.75rem 0;
        }
        .ra-article-body .thumbinner {
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px;
          padding: 4px;
          background: rgba(255,255,255,0.04);
          font-size: 0.82rem;
        }
        .ra-article-body .thumbcaption {
          padding: 4px 4px 2px;
          color: var(--reader-muted, #9a938f);
          font-size: 0.8rem;
          line-height: 1.4;
        }
        .ra-article-body .magnify { display: none; }
        .ra-article-body p { overflow: hidden; }
        .ra-article-body .gallery {
          display: flex; flex-wrap: wrap; gap: 0.5rem;
          list-style: none; margin: 0.75rem 0; padding: 0;
        }
        .ra-article-body .gallerybox { display: inline-block; }
        .ra-article-body .gallerytextwrapper {
          font-size: 0.8rem;
          color: var(--reader-muted, #9a938f);
          text-align: center;
        }
        .ra-article [data-sentence-index] {
          border-radius: 2px;
          -webkit-box-decoration-break: clone;
          box-decoration-break: clone;
          transition: background-color 0.25s ease;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
