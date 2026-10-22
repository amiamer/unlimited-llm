/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Chapter, Paragraph, FootnoteRef } from '@/lib/types/reader';

// epubjs types are re-exported defaults which TS can't resolve with bundler moduleResolution
type Book = any;
type Rendition = any;

/**
 * EpubDisplay - Renders ePub content using epub.js
 * Requirements: 1.3, 1.4, 1.5, 1.6
 */

interface EpubDisplayProps {
  epubUrl: string | null;
  currentChapter: number;
  currentSentenceIndex: number;
  onContentReady: (sentences: string[], chapters: Chapter[], notes?: Record<string, string>) => void;
  onError: (error: string) => void;
}

/**
 * A footnote reference or anchor located at a character offset inside a
 * paragraph's flattened text. Used to map markers/anchors onto the sentence
 * they land in after sentence segmentation.
 */
interface OffsetMarker {
  offset: number;      // character offset in the paragraph text
  label: string;       // visible marker label (footnote refs only)
  noteKey?: string;    // target note key = target fragment (footnote refs only)
  refId?: string;      // anchor id (both refs and plain anchors)
  targetHref?: string; // raw href of the reference (footnote refs only)
}

export function EpubDisplay({
  epubUrl,
  currentChapter,
  onContentReady,
  onError,
}: EpubDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const keyboardHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const contentExtractedRef = useRef<boolean>(false);
  const extractedChaptersRef = useRef<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load ePub when URL changes
  useEffect(() => {
    if (!epubUrl || !containerRef.current) {
      return;
    }

    setIsLoading(true);
    setError(null);

    let mounted = true;

    // Dynamic import of epub.js to avoid SSR issues
    import('epubjs').then(async (ePubModule) => {
      const ePub = ePubModule.default;
      const sbd = await import('sbd');

      try {
        // Initialize epub.js
        const book = ePub(epubUrl, {
          openAs: 'epub',
        });
        
        // Wait for book to be ready
        await book.ready;

        if (!mounted) return;

        // Store book reference
        bookRef.current = book;

        // Create rendition in container
        if (containerRef.current) {
          // Clear container first
          containerRef.current.innerHTML = '';
          
          const rendition = book.renderTo(containerRef.current, {
            width: '100%',
            height: '100%',
            spread: 'none',
            flow: 'paginated',
            allowScriptedContent: true,
          });

          renditionRef.current = rendition;
          
          // Add event listener for iframe creation to set sandbox attribute
          rendition.on('rendered', () => {
            const iframe = containerRef.current?.querySelector('iframe');
            if (iframe) {
              // Update sandbox attribute to allow scripts
              iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
            }
          });

          // Register custom CSS theme for highlighting
          (rendition.themes as any).register('custom', {
            'body': {
              'font-family': 'Georgia, serif',
              'font-size': '1.1em',
              'line-height': '1.6',
              'padding': '20px',
            },
            '.epub-highlight': {
              'background-color': '#ffeb3b !important',
              'transition': 'background-color 0.3s ease',
            },
          });
          (rendition.themes as any).select('custom');

          // Add keyboard navigation
          const handleKeyDown = (e: KeyboardEvent) => {
            if (!renditionRef.current) return;
            
            if (e.key === 'ArrowLeft') {
              renditionRef.current.prev();
            } else if (e.key === 'ArrowRight') {
              renditionRef.current.next();
            }
          };
          keyboardHandlerRef.current = handleKeyDown;
          document.addEventListener('keydown', handleKeyDown);

          // Add click navigation on the rendition
          rendition.on('rendered', () => {
            const iframe = containerRef.current?.querySelector('iframe');
            if (iframe && iframe.contentDocument) {
              iframe.contentDocument.addEventListener('click', (e: MouseEvent) => {
                if (!renditionRef.current) return;
                
                const clickX = e.clientX;
                const windowWidth = iframe.contentWindow?.innerWidth || 0;
                
                // Click on left third = previous page
                if (clickX < windowWidth / 3) {
                  renditionRef.current.prev();
                }
                // Click on right two-thirds = next page
                else {
                  renditionRef.current.next();
                }
              });
            }
          });

          // Display first chapter
          await rendition.display();

          // Extract chapter structure and sentences in background (only once)
          if (!contentExtractedRef.current) {
            contentExtractedRef.current = true;
            extractContentInBackground(book, sbd, (sentences, chapters, notes) => {
              extractedChaptersRef.current = chapters;
              onContentReady(sentences, chapters, notes);
            });
          }

          if (mounted) {
            setIsLoading(false);
          }
        }
      } catch (err) {
        if (!mounted) return;
        
        const errorMessage = err instanceof Error ? err.message : 'Failed to load ePub file';
        setError(errorMessage);
        onError(errorMessage);
        setIsLoading(false);
        console.error('Error loading ePub:', err);
      }
    }).catch((err) => {
      if (!mounted) return;
      
      const errorMessage = 'Failed to initialize ePub reader';
      setError(errorMessage);
      onError(errorMessage);
      setIsLoading(false);
      console.error('Error importing epub.js:', err);
    });

    return () => {
      mounted = false;
      
      // Reset content extracted flag when unmounting
      contentExtractedRef.current = false;
      extractedChaptersRef.current = [];
      
      // Remove keyboard event listener
      if (keyboardHandlerRef.current) {
        document.removeEventListener('keydown', keyboardHandlerRef.current);
        keyboardHandlerRef.current = null;
      }
      
      // Cleanup
      if (renditionRef.current && typeof renditionRef.current.destroy === 'function') {
        renditionRef.current.destroy();
        renditionRef.current = null;
      }
      if (bookRef.current && typeof bookRef.current.destroy === 'function') {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [epubUrl, onContentReady, onError]);

  // Navigate the hidden epub.js rendition when currentChapter changes.
  //
  // NOTE: EpubDisplay renders into a hidden container purely to extract text;
  // the visible reading surface is TextDisplay, which scrolls by sentence index
  // and doesn't depend on this rendition. So navigation here is best-effort.
  //
  // epub.js's Rendition.start reads `this.book.package`, which is undefined
  // until the book's package document has fully resolved. A chapter change that
  // fires before that (e.g. a schedule "jump to chapter" right as the book
  // loads) crashes with "Cannot read properties of undefined (reading
  // 'package')". Guard on package readiness and swallow errors so a jump can
  // never take down the reader.
  useEffect(() => {
    const book: any = bookRef.current;
    const rendition = renditionRef.current;
    if (!rendition || !book || currentChapter < 0) return;

    // Only navigate once the package/spine is actually ready.
    const packageReady = !!(book.packaging || book.package);
    const spineReady = !!(book.spine && (book.spine.spineItems?.length || typeof book.spine.get === 'function'));
    if (!packageReady || !spineReady) return;

    const chapters = extractedChaptersRef.current;
    const href =
      chapters.length > 0 && currentChapter < chapters.length
        ? chapters[currentChapter].href
        : book.spine.get(currentChapter)?.href;
    if (!href) return;

    try {
      const p = rendition.display(href);
      if (p && typeof p.catch === 'function') {
        p.catch((err: unknown) => console.error('Error navigating to chapter:', err));
      }
    } catch (err) {
      // Synchronous throw from Rendition.start (package not ready) — ignore;
      // TextDisplay already moved the visible view.
      console.warn('Skipped epub.js navigation (not ready):', err instanceof Error ? err.message : err);
    }
  }, [currentChapter]);

  return (
    <div className="relative w-full h-full bg-white">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-red-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading ePub...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
          <div className="max-w-md p-6 bg-red-50 border border-red-200 rounded-lg">
            <h3 className="text-lg font-semibold text-red-800 mb-2">Error Loading ePub</h3>
            <p className="text-red-600">{error}</p>
            <p className="text-sm text-red-500 mt-2">
              Please ensure the file is a valid ePub format and try again.
            </p>
          </div>
        </div>
      )}

      {/* Hidden epub.js container for content extraction only */}
      <div
        ref={containerRef}
        style={{ display: 'none' }}
      />
    </div>
  );
}

/**
 * Collect note bodies from a section document, keyed by "sectionFile#anchorId"
 * so a footnote reference's targetKey can look them up for inline display.
 *
 * Strategy (covers both conventions):
 *  - EPUB 3: <aside epub:type="footnote|endnote|rearnote" id="..."> — the aside
 *    text is the note.
 *  - Legacy/calibre: a block (<p>/<li>/<div>) that contains an anchor bearing an
 *    id (the note target). The note body is the block's text with the leading
 *    marker and any back-link stripped.
 * Also indexes any element carrying an id directly (belt and suspenders).
 */
export function collectNotesFromDoc(doc: Document | null | undefined, sectionFile: string): Record<string, string> {
  const notes: Record<string, string> = {};
  if (!doc) return notes;

  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Strip a leading marker like "[1]", "1.", "*", "1:" from a note body.
  const stripMarker = (s: string) =>
    clean(s).replace(/^\s*[[(]?[\d*†‡§¶]{1,4}[\])]?[.:)]?\s*/, '');

  // 1) EPUB 3 semantic notes. Match by scanning aside/section elements and
  // reading epub:type directly — attribute CSS selectors with a namespaced
  // colon are unreliable across DOM implementations.
  const NOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/i;
  const candidates = doc.querySelectorAll('aside, section, div, li');
  candidates.forEach((el) => {
    const type =
      el.getAttribute('epub:type') ||
      el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ||
      el.getAttribute('role') ||
      '';
    if (!NOTE_TYPES.test(type)) return;
    const id = el.getAttribute('id');
    if (!id) return;
    const body = stripMarker(el.textContent || '');
    if (body) notes[`${sectionFile}#${id}`] = body;
  });

  // 2) Legacy: blocks whose first anchor has an id (the note target).
  const blocks = doc.querySelectorAll('p, li, div');
  blocks.forEach((el) => {
    // Skip large containers (a whole chapter div) — notes are short blocks.
    if (el.querySelectorAll('p, li').length > 1) return;
    const anchor = el.querySelector('a[id], a[name]');
    if (!anchor) return;
    const id = anchor.getAttribute('id') || anchor.getAttribute('name');
    if (!id || notes[`${sectionFile}#${id}`]) return;
    const body = stripMarker(el.textContent || '');
    // Ignore back-link-only or empty blocks.
    if (body && body.length > 1) notes[`${sectionFile}#${id}`] = body;
  });

  return notes;
}

/**
 * Extract content in background without blocking rendering
 */
async function extractContentInBackground(
  book: Book,
  sbd: any,
  onContentReady: (sentences: string[], chapters: Chapter[], notes?: Record<string, string>) => void
) {
  try {
    const extractedChapters: Chapter[] = [];
    let allSentences: string[] = [];
    // Book-wide note bodies keyed by "file#fragment" for inline display.
    const notesMap: Record<string, string> = {};

    // Get navigation for chapter titles
    let toc: any[] = [];
    try {
      if (book.loaded && book.loaded.navigation) {
        const navigation = await book.loaded.navigation;
        toc = navigation?.toc || [];
      }
    } catch (navError) {
      console.warn('Could not load navigation, using default chapter titles:', navError);
    }
    // Flatten the (possibly nested) TOC once for fast title resolution.
    const tocFlat = flattenToc(toc);

    let chapterNumber = 0; // Track actual chapter number after filtering
    // The last real section heading seen (e.g. "Part One"), so a spine file
    // that only continues a part (its TOC entries are bare sub-chapter numerals
    // like "XIII") can be labeled as a continuation instead of a cryptic "XIII".
    let lastSectionTitle = '';

    // Get spine items - spine is an object with get() method, not an array
    const spineItems = book.spine.spineItems || [];
    
    for (let i = 0; i < spineItems.length; i++) {
      const spineItem = book.spine.get(i);
      if (!spineItem) continue;

      try {
        // Load section content - epub.js returns a Section object
        const section = await book.spine.get(i);
        if (!section) continue;
        
        // Load the actual content
        await section.load(book.load.bind(book));
        
        // Get the document from the section
        const doc = section.document;
        const sectionFile = baseFile(spineItem.href);

        // Collect note bodies from EVERY section (including ones we later skip
        // as fluff) so inline note lookup works no matter where notes live.
        Object.assign(notesMap, collectNotesFromDoc(doc, sectionFile));

        // Extract paragraphs with their sentences (+ footnote refs / anchors)
        const paragraphsData = extractParagraphsFromContents(doc, sbd, sectionFile);
        
        // Resolve the chapter title. Prefer the TOC's section title (no
        // fragment), then the document's own heading/<title>, and only then a
        // cleaned-up filename. This turns "War_and_Peace_split_006" into
        // "Part One".
        const tocTitle = titleFromToc(tocFlat, spineItem.href);
        const docTitle = tocTitle ? null : titleFromDocument(doc);
        let title = tocTitle || docTitle || spineItem.href || '';
        if (!tocTitle && !docTitle) {
          // Only scrub when we're stuck with a filename.
          title = String(title)
            .replace(/\.x?html?$/i, '')
            .replace(/^.*\//, '')
            .replace(/[_-]+/g, ' ')
            .trim();
        }
        
        // Skip common fluff pages based on title or content
        const titleLower = title.toLowerCase();
        const isFluffPage = 
          titleLower.includes('cover') ||
          titleLower.includes('title page') ||
          titleLower.includes('half title') ||
          titleLower.includes('half-title') ||
          titleLower.includes('copyright') ||
          titleLower.includes('dedication') ||
          titleLower.includes('table of contents') ||
          titleLower.includes('toc') ||
          titleLower.includes('frontmatter') ||
          titleLower.includes('front matter') ||
          titleLower.includes('also by') ||
          titleLower.includes('about the author') ||
          titleLower.includes('about the publisher') ||
          titleLower.includes('acknowledgment') ||
          titleLower.includes('acknowledgement') ||
          titleLower.includes('epigraph') ||
          titleLower.includes('foreword') ||
          titleLower.includes('colophon') ||
          titleLower.includes('praise for') ||
          titleLower.includes('endorsement') ||
          titleLower.includes('other books') ||
          titleLower.includes('books by') ||
          titleLower.includes('other works') ||
          titleLower === 'contents' ||
          titleLower === 'title' ||
          titleLower === 'cover image' ||
          titleLower === 'titlepage';
        
        // Calculate total content length
        const totalChars = paragraphsData.reduce((sum, p) => 
          sum + p.sentences.join(' ').length, 0
        );

        // Structural divider pages (e.g. "Volume II", "Part One", "Epilogue")
        // are often near-empty — just the label — so they'd trip the too-short
        // filter. Keep them: they're real navigation points and reading-schedule
        // boundaries key off them.
        const isStructuralDivider =
          /^(volume|book|part|epilogue|prologue)\b/i.test(titleLower) ||
          /^(volume|book|part)\s+([ivxlc]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(titleLower);

        // Skip if it's a fluff page or too short (but never drop a structural
        // divider just for being short).
        if (isFluffPage || (totalChars < 100 && !isStructuralDivider)) {
          console.log(`Skipping spine ${i} (${title || spineItem.href}): fluff page or too short (${totalChars} chars)`);
          section.unload();
          continue;
        }
        
        // Flatten sentences for TTS
        const chapterSentences = paragraphsData.flatMap(p => p.sentences);

        // Flatten footnote refs + anchors to chapter-local flat sentence
        // indices. `flatOffset` tracks the running sentence count so each
        // paragraph's per-sentence data maps to the right index in
        // `chapterSentences`.
        const chapterFootnotes: Record<number, FootnoteRef[]> = {};
        const chapterAnchors: Record<string, number> = {};
        {
          let flatOffset = 0;
          for (const p of paragraphsData) {
            if (p.footnotes) {
              for (const [localStr, refs] of Object.entries(p.footnotes)) {
                const flatIdx = flatOffset + Number(localStr);
                chapterFootnotes[flatIdx] = (chapterFootnotes[flatIdx] || []).concat(refs);
                // Every footnote ref anchor id is itself a return target.
                for (const r of refs) {
                  if (r.refId) chapterAnchors[r.refId] = flatIdx;
                }
              }
            }
            if (p.anchors) {
              for (const [id, localIdx] of Object.entries(p.anchors)) {
                chapterAnchors[id] = flatOffset + localIdx;
              }
            }
            flatOffset += p.sentences.length;
          }
        }
        
        // Use the actual chapter title from TOC if available
        // For sections without titles, just call them "Section X"
        // Fall back to a clean "Section N" when the title is really a filename
        // or internal id rather than a human chapter name. This catches Project
        // Gutenberg-style stubs (e.g. "3207-h-1.htm"), long numeric ids, and any
        // residual file extension — while leaving real titles (incl. Roman
        // numerals like "IV") untouched.
        let finalTitle = title;
        const isJunkTitle =
          !finalTitle ||
          /^[\d\-_\s]+$/.test(finalTitle) ||              // only digits/dashes/underscores
          /\.(x?html?|xml|txt|opf|ncx)\b/i.test(finalTitle) || // a filename extension
          /\b\d{5,}\b/.test(finalTitle) ||                // a long numeric id
          /\d+-h-?\d*/i.test(finalTitle) ||               // Gutenberg file stub "3207-h-1"
          /\bsplit[\s_-]?\d+/i.test(finalTitle);          // calibre "split_006" stub
        if (isJunkTitle) {
          // A notes/endnotes dump gets a clean "Notes" title; everything else
          // falls back to a sequential section label.
          finalTitle = detectNotesSection(doc, title)
            ? 'Notes'
            : `Section ${chapterNumber + 1}`;
        }

        // Track section headings and relabel continuations. A "Part One" /
        // "Volume II" / "Epilogue" title is a section heading. A title that is
        // just a chapter numeral ("XIII", "42") means this spine file continues
        // the previous section — show it as "<Section> (cont.)" so the chapter
        // list and schedule read clearly instead of a cryptic "XIII".
        const isSectionHeading = /\b(volume|book|part|epilogue|prologue)\b/i.test(finalTitle);
        const isBareChapterNumeral = /^(?:[ivxlcdm]+|\d{1,4})$/i.test(finalTitle.trim());
        if (isSectionHeading) {
          lastSectionTitle = finalTitle;
        } else if (isBareChapterNumeral && lastSectionTitle) {
          finalTitle = `${lastSectionTitle} (cont.)`;
        }

        extractedChapters.push({
          index: chapterNumber, // Use sequential chapter number, not spine index
          title: finalTitle,
          href: spineItem.href,
          sentences: chapterSentences,
          paragraphs: paragraphsData,
          footnotes: Object.keys(chapterFootnotes).length ? chapterFootnotes : undefined,
          anchors: Object.keys(chapterAnchors).length ? chapterAnchors : undefined,
        });

        allSentences = allSentences.concat(chapterSentences);

        console.log(`Chapter ${chapterNumber} extracted: "${finalTitle}" - ${chapterSentences.length} sentences in ${paragraphsData.length} paragraphs`);

        chapterNumber++; // Increment chapter counter

        // Unload to free memory
        section.unload();
      } catch (chapterError) {
        console.error(`Error loading spine item ${i}:`, chapterError);
        // Continue with other chapters
      }
    }

    if (extractedChapters.length > 0) {
      console.log('Content extraction complete:', {
        chapters: extractedChapters.length,
        totalSentences: allSentences.length,
        notes: Object.keys(notesMap).length,
        firstChapter: extractedChapters[0]?.title,
        firstSentences: allSentences.slice(0, 3)
      });
      onContentReady(allSentences, extractedChapters, notesMap);
    } else {
      console.warn('No chapters extracted from ePub');
    }
  } catch (err) {
    console.error('Error extracting content:', err);
  }
}

const ABBREVIATIONS = ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr', 'Ph.D', 'M.D', 'U.S', 'U.K'];

/** A flattened TOC entry: filename (no fragment), fragment, and label. */
interface TocEntry {
  file: string;      // href with the fragment stripped, path-normalized to a basename
  fragment: string;  // fragment after '#', or '' when none
  label: string;     // human-readable title
}

/** Normalize an href to a comparable basename (drop path + query). */
function baseFile(href: string): string {
  if (!href) return '';
  const noHash = href.split('#')[0];
  const noQuery = noHash.split('?')[0];
  const parts = noQuery.split('/');
  return (parts[parts.length - 1] || noQuery).toLowerCase();
}

/** Fragment portion of an href, e.g. "x.html#f5" -> "f5". */
function fragmentOf(href: string): string {
  const hash = href.indexOf('#');
  return hash >= 0 ? href.slice(hash + 1) : '';
}

/**
 * Flatten an epub.js navigation TOC (which nests via `subitems`) into a flat
 * list of {file, fragment, label} so we can resolve a spine file to its best
 * human title.
 */
export function flattenToc(toc: any[]): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (items: any[]) => {
    for (const item of items || []) {
      if (item?.href) {
        out.push({
          file: baseFile(item.href),
          fragment: fragmentOf(item.href),
          label: String(item.label || '').replace(/\s+/g, ' ').trim(),
        });
      }
      if (item?.subitems?.length) walk(item.subitems);
    }
  };
  walk(toc);
  return out;
}

/**
 * Resolve the best display title for a spine file. Preference order:
 *  1. A TOC entry pointing at the file with NO fragment (the section/part title,
 *     e.g. "Part One") — this is the chapter's real name.
 *  2. The first TOC entry for the file that has a fragment (e.g. "I"), used when
 *     the file only appears as sub-chapters.
 *  3. null (caller falls back to the document heading or "Section N").
 */
export function titleFromToc(tocFlat: TocEntry[], spineHref: string): string | null {
  const file = baseFile(spineHref);
  const matches = tocFlat.filter((t) => t.file === file && t.label);
  if (matches.length === 0) return null;
  const whole = matches.find((t) => !t.fragment);
  if (whole) return whole.label;
  return matches[0].label;
}

/**
 * Pull a title from the section document itself: the <title>, then the first
 * heading (h1–h3). Used when the TOC has nothing useful for this file.
 */
function titleFromDocument(doc: Document | null | undefined): string | null {
  if (!doc) return null;
  const clean = (s: string | null | undefined) =>
    (s || '').replace(/\s+/g, ' ').trim();
  const heading = doc.querySelector('h1, h2, h3');
  const h = clean(heading?.textContent);
  if (h && h.length <= 120) return h;
  const t = clean(doc.querySelector('title')?.textContent);
  // Ignore book-wide titles repeated on every page (heuristic: contains no
  // chapter-ish signal). Still better than a filename, so return it if short.
  if (t && t.length <= 80) return t;
  return null;
}

/**
 * Detect whether a section document is a notes/endnotes container. Uses the
 * EPUB 3 semantic signal first (epub:type on aside/section/body), then falls
 * back to a heading/anchor-density heuristic for legacy books (like calibre
 * output) that have no semantics.
 */
function detectNotesSection(doc: Document | null | undefined, title: string): boolean {
  if (!doc) return /\b(notes|endnotes|footnotes)\b/i.test(title);
  // EPUB 3 semantic markup — scan and read epub:type directly.
  const semantic = Array.from(doc.querySelectorAll('aside, section, div, body, [role]')).some((el) => {
    const type =
      el.getAttribute('epub:type') ||
      el.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ||
      el.getAttribute('role') ||
      '';
    return /\b(footnotes?|endnotes?|rearnotes?|doc-endnotes|doc-footnotes)\b/i.test(type);
  });
  if (semantic) return true;
  if (/\b(notes|endnotes|footnotes)\b/i.test(title)) return true;
  // Heuristic: a page that is mostly short paragraphs each starting with a
  // marker/back-link anchor is a notes dump.
  const paras = Array.from(doc.querySelectorAll('p'));
  if (paras.length >= 5) {
    const noteish = paras.filter((p) => {
      const a = p.querySelector('a');
      const txt = (p.textContent || '').trim();
      return a && /^[\s]*[[(]?[\d*†‡]{1,4}[\])]?/.test(txt);
    }).length;
    if (noteish / paras.length > 0.6) return true;
  }
  return false;
}

/** True when an <a>'s visible text looks like a footnote/endnote marker. */
function isFootnoteMarker(label: string): boolean {
  const t = label.trim();
  if (!t || t.length > 6) return false;
  // [1] / (1) / 1 / a / * / † style markers.
  return /^[[(]?[\d]{1,4}[\])]?$/.test(t) ||
    /^[[(]?[a-z]{1,2}[\])]?$/i.test(t) ||
    /^[*†‡§¶]{1,3}$/.test(t);
}

/** Fragment portion of an href, e.g. "../x.html#filepos5" -> "filepos5". */
function hrefFragment(href: string | null): string | null {
  if (!href) return null;
  const hash = href.indexOf('#');
  return hash >= 0 ? href.slice(hash + 1) : null;
}

/**
 * Walk a paragraph element and produce its plain text plus the character
 * offsets of any footnote-reference anchors and any id-bearing anchors. The
 * text is built exactly as textContent would (so downstream offsets line up),
 * while markers are collected as we cross the anchors that produce them.
 */
function collectParagraph(el: Element): {
  text: string;             // normalized (whitespace-collapsed, trimmed) text
  refs: OffsetMarker[];     // footnote references (become clickable markers)
  anchors: OffsetMarker[];  // id-bearing anchors (return targets)
} {
  // Build the normalized text incrementally so marker offsets are recorded in
  // the SAME coordinate space as the sentences produced downstream. We collapse
  // runs of whitespace to a single space as we append, matching the
  // `replace(/\s+/g, ' ').trim()` used elsewhere.
  let text = '';
  const refs: OffsetMarker[] = [];
  const anchors: OffsetMarker[] = [];

  const append = (raw: string) => {
    if (!raw) return;
    const chunk = raw.replace(/\s+/g, ' ');
    if (chunk === ' ' && (text === '' || text.endsWith(' '))) return;
    if (chunk.startsWith(' ') && (text === '' || text.endsWith(' '))) {
      text += chunk.slice(1);
    } else {
      text += chunk;
    }
  };

  // Numeric nodeType constants (TEXT_NODE=3, ELEMENT_NODE=1) so this runs in
  // any DOM implementation without depending on a global `Node`.
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      append(node.textContent || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const elem = node as Element;

    if (elem.tagName.toLowerCase() === 'a') {
      const id = elem.getAttribute('id') || elem.getAttribute('name');
      const href = elem.getAttribute('href') || '';
      const frag = hrefFragment(href);
      const label = (elem.textContent || '').replace(/\s+/g, ' ').trim();
      const offset = text.length; // normalized-space offset
      if (id) anchors.push({ offset, label, refId: id });
      // A footnote reference is either the EPUB 3 semantic noteref, or a legacy
      // marker-looking link into a fragment.
      const epubType = (elem.getAttribute('epub:type') || elem.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || '');
      const isNoteref = /\bnoteref\b/.test(epubType);
      if (frag && (isNoteref || isFootnoteMarker(label))) {
        refs.push({ offset, label, noteKey: frag, refId: id || frag, targetHref: href });
        // Do NOT append the marker's own text ("[2]") to the prose — it is
        // rendered separately as a clickable pill. Walking its children would
        // duplicate the marker inline. Skip the subtree entirely.
        return;
      }
    }

    for (const child of Array.from(node.childNodes)) walk(child);
  };

  walk(el);
  return { text: text.trim(), refs, anchors };
}

/**
 * Extract paragraphs with sentences (and footnote/anchor metadata) from
 * epub.js contents. Footnote reference markers ("[1]") and id-bearing anchors
 * are mapped onto the sentence they fall in so the reader can render clickable
 * links that jump to notes at the back of the book — and back again.
 *
 * Exported for unit testing of the footnote-extraction logic.
 */
export function extractParagraphsFromContents(contents: any, sbd: any, sectionFile = ''): Paragraph[] {
  try {
    let doc: Document | null = null;

    // Detect a Document without relying on a specific global `Document` (which
    // differs between the browser and a jsdom/test context). nodeType 9 is a
    // DOCUMENT_NODE; we also accept anything exposing querySelectorAll + body.
    const looksLikeDoc = (v: any) =>
      v && (v.nodeType === 9 || (typeof v.querySelectorAll === 'function' && 'body' in v));

    if (looksLikeDoc(contents)) {
      doc = contents as Document;
    } else if (contents?.document && looksLikeDoc(contents.document)) {
      doc = contents.document;
    } else if (contents?.ownerDocument) {
      doc = contents.ownerDocument;
    } else if (typeof contents === 'string' && typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      doc = parser.parseFromString(contents, 'text/html');
    }

    if (!doc) {
      console.warn('Could not extract document from contents');
      return [];
    }

    const clone = doc.cloneNode(true) as Document;

    const scripts = clone.querySelectorAll('script, style');
    scripts.forEach((el: Element) => el.remove());

    const body = clone.body || clone.documentElement;
    if (!body) {
      return [];
    }

    const paragraphElements = body.querySelectorAll('p');
    const paragraphs: Paragraph[] = [];

    const buildParagraph = (text: string, refs: OffsetMarker[], anchors: OffsetMarker[]): Paragraph | null => {
      // `text` arrives already normalized (whitespace-collapsed + trimmed) from
      // collectParagraph, so marker offsets are in the same coordinate space.
      if (text.length === 0) return null;
      const sentences: string[] = sbd.sentences(text, {
        preserve_whitespace: false,
        abbreviations: ABBREVIATIONS,
      });
      if (sentences.length === 0) return null;

      const para: Paragraph = { sentences };

      // Map each marker's normalized-text offset onto a sentence index by
      // matching sentences sequentially within the normalized text and
      // recording each sentence's end offset.
      if (refs.length || anchors.length) {
        const bounds: number[] = []; // end offset (exclusive) of each sentence
        let cursor = 0;
        for (const s of sentences) {
          const idx = text.indexOf(s, cursor);
          const start = idx >= 0 ? idx : cursor;
          cursor = start + s.length;
          bounds.push(cursor);
        }
        const sentenceForOffset = (offset: number): number => {
          const pos = Math.min(Math.max(0, offset), text.length);
          for (let i = 0; i < bounds.length; i++) {
            if (pos < bounds[i]) return i;
          }
          return sentences.length - 1;
        };

        if (refs.length) {
          const footnotes: Record<number, FootnoteRef[]> = {};
          for (const m of refs) {
            const si = sentenceForOffset(m.offset);
            // Resolve the note's global key: the target file (from the href, or
            // this section if the link is same-file) plus its fragment.
            const targetFile = m.targetHref && m.targetHref.includes('/')
              ? baseFile(m.targetHref)
              : (m.targetHref && m.targetHref.startsWith('#') ? sectionFile : baseFile(m.targetHref || ''));
            const file = targetFile || sectionFile;
            const ref: FootnoteRef = {
              label: m.label,
              noteKey: m.noteKey || '',
              refId: m.refId || m.noteKey || '',
              targetKey: `${file}#${m.noteKey || ''}`,
            };
            (footnotes[si] = footnotes[si] || []).push(ref);
          }
          para.footnotes = footnotes;
        }
        if (anchors.length) {
          const aMap: Record<string, number> = {};
          for (const a of anchors) {
            if (a.refId) aMap[a.refId] = sentenceForOffset(a.offset);
          }
          para.anchors = aMap;
        }
      }

      return para;
    };

    if (paragraphElements.length > 0) {
      paragraphElements.forEach((p: Element) => {
        const { text, refs, anchors } = collectParagraph(p);
        const para = buildParagraph(text, refs, anchors);
        if (para) paragraphs.push(para);
      });
    } else {
      const { text, refs, anchors } = collectParagraph(body);
      const para = buildParagraph(text, refs, anchors);
      if (para) paragraphs.push(para);
    }

    return paragraphs;
  } catch (err) {
    console.error('Error extracting paragraphs:', err);
    return [];
  }
}
