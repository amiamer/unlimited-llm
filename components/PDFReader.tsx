'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ArticleReader, ArticleReaderConfig, ArticleSession } from './ArticleReader';

/**
 * PDFReader — wraps ArticleReader for PDF documents.
 *
 * Flow:
 * 1. User uploads a PDF or selects one from the list
 * 2. Extracted text is fetched from /api/pdf-reader/text/[filename]
 * 3. Text is converted to HTML and fed into ArticleReader
 */

interface PDFBook {
  filename: string;
  title: string;
  extracted: boolean;
  extractedAt: string | null;
}

interface PDFExtractedPage {
  page: number;
  text: string;
  lines: { text: string; confidence: number }[];
}

const PDF_STYLES = `
  .pdf-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 22px;
    line-height: 1.8;
    color: #e5e7eb;
  }
  .pdf-content * { background-color: transparent !important; }
  .pdf-content p { margin-bottom: 1em; color: #e5e7eb; }
  .pdf-content h2 {
    font-size: 1.4em; font-weight: 600; color: #f9fafb;
    margin-top: 2em; margin-bottom: 0.8em;
    border-bottom: 1px solid #2a2a2a; padding-bottom: 0.3em;
  }
  .pdf-content .page-break {
    border-top: 1px dashed #333;
    margin: 2em 0;
    padding-top: 0.5em;
  }
  .pdf-content .page-label {
    font-size: 0.7em; color: #666; font-style: italic;
    margin-bottom: 0.5em;
  }
`;

function pagesToHtml(pages: PDFExtractedPage[]): string {
  return pages
    .filter(p => p.text.trim())
    .map((p, i) => {
      const paragraphs = p.text
        .split(/\n\n+/)
        .map(para => para.trim())
        .filter(Boolean)
        .map(para => `<p>${para.replace(/\n/g, ' ')}</p>`)
        .join('\n');

      const divider = i > 0 ? '<div class="page-break"></div>' : '';
      const label = `<div class="page-label">Page ${p.page + 1}</div>`;
      return `${divider}${label}${paragraphs}`;
    })
    .join('\n');
}

const pdfConfig: ArticleReaderConfig = {
  title: 'PDF Reader',
  storageKey: 'pdf-reader-sessions',
  currentSessionKey: 'pdf-reader-current-session',
  searchPlaceholder: 'Enter PDF filename to load...',
  emptyStateMessage: 'Upload a PDF or select one from the sidebar to start reading',
  contentClassName: 'pdf-content',
  apiEndpoint: '/api/pdf-reader/text',
  unwantedSelectors: ['.page-label'],
  parseLinkClick: () => null,
  contentStyles: PDF_STYLES,
  hideHeader: true,
};

export function PDFReader() {
  const [books, setBooks] = useState<PDFBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // We'll inject sessions into ArticleReader by pre-loading them
  const [preloadedSession, setPreloadedSession] = useState<ArticleSession | null>(null);
  const [showBookList, setShowBookList] = useState(true);

  const fetchBooks = useCallback(async () => {
    try {
      const res = await fetch('/api/pdf-reader/books');
      const data = await res.json();
      setBooks(data.books || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/pdf-reader/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Upload failed');
        return;
      }

      if (data.warning) {
        setError(data.warning);
      }

      await fetchBooks();

      // If extraction succeeded, load it
      if (data.extracted && data.filename) {
        await loadPDF(data.filename);
      }
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReExtract = async (filename: string) => {
    setExtracting(filename);
    setError(null);

    try {
      const res = await fetch('/api/pdf-reader/re-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Re-extraction failed');
        return;
      }

      await fetchBooks();
    } catch {
      setError('Re-extraction failed. Is the Surya OCR service running?');
    } finally {
      setExtracting(null);
    }
  };

  const loadPDF = async (filename: string) => {
    try {
      const res = await fetch(`/api/pdf-reader/text/${encodeURIComponent(filename)}`);
      if (!res.ok) {
        setError('Text not extracted yet');
        return;
      }

      const data = await res.json();
      const html = pagesToHtml(data.pages || []);
      const title = filename.replace(/\.pdf$/i, '');
      const sanitizedId = title.replace(/[<>:"/\\|?*]/g, '_');

      // Inject into localStorage so ArticleReader picks it up
      const storageKey = pdfConfig.storageKey;
      const currentKey = pdfConfig.currentSessionKey;

      let sessions: ArticleSession[] = [];
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) sessions = JSON.parse(saved);
      } catch {}

      const existing = sessions.find(s => s.id === sanitizedId);
      if (existing) {
        // Update content
        existing.content = html;
      } else {
        sessions.push({ id: sanitizedId, title, content: html });
      }

      localStorage.setItem(storageKey, JSON.stringify(sessions));
      localStorage.setItem(currentKey, sanitizedId);

      setShowBookList(false);
      // Force re-render by updating state
      setPreloadedSession({ id: sanitizedId, title, content: html });
    } catch {
      setError('Failed to load PDF text');
    }
  };

  // If we're showing the book list (no PDF loaded yet), render the picker
  if (showBookList && !preloadedSession) {
    return (
      <div className="flex h-full flex-col bg-black">
        <div className="bg-navy-red-800 border-b border-navy-red-700 p-4">
          <div className="max-w-4xl mx-auto flex items-center justify-end">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-[#b83030] hover:bg-[#d84848] text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload PDF'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            {error && (
              <div className="mb-6 p-4 bg-[#1a0000] border border-[#4a0000] rounded-lg text-[#ff6b6b] text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-gray-500 text-center py-20">Loading PDFs...</div>
            ) : books.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p className="text-base">No PDFs yet. Upload one to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {books.map((book) => (
                  <div
                    key={book.filename}
                    className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-4 hover:border-[#2a2a2a] transition-colors"
                  >
                    <h3 className="text-white font-medium text-sm truncate mb-2">{book.title}</h3>
                    <div className="flex items-center gap-2 mb-3">
                      {book.extracted ? (
                        <span className="text-xs text-green-400">✓ Extracted</span>
                      ) : (
                        <span className="text-xs text-yellow-400">Not extracted</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {book.extracted ? (
                        <button
                          onClick={() => loadPDF(book.filename)}
                          className="flex-1 px-3 py-1.5 bg-[#b83030] hover:bg-[#d84848] text-white text-xs rounded transition-colors"
                        >
                          Read
                        </button>
                      ) : null}
                      <button
                        onClick={() => handleReExtract(book.filename)}
                        disabled={extracting === book.filename}
                        className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-gray-300 text-xs rounded transition-colors disabled:opacity-50"
                      >
                        {extracting === book.filename ? 'Extracting...' : book.extracted ? 'Re-extract' : 'Extract'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Once a PDF is loaded, render ArticleReader
  return (
    <div className="relative">
      <button
        onClick={() => { setShowBookList(true); setPreloadedSession(null); }}
        className="absolute top-4 right-96 z-10 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-gray-300 text-xs rounded transition-colors border border-[#2a2a2a]"
      >
        ← All PDFs
      </button>
      <ArticleReader config={pdfConfig} />
    </div>
  );
}
