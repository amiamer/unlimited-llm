'use client';

import React, { useRef, useState, useEffect } from 'react';

type Stage = 'idle' | 'saving' | 'saved' | 'extracting' | 'done' | 'warn' | 'error';

interface UploadState {
  stage: Stage;
  message: string;
  filename?: string;
  pageCount?: number;
  startedAt?: number; // ms timestamp when extraction started
}

interface PdfUploadButtonProps {
  onUploaded: (filename: string, warning?: string) => void;
  onError: (error: string) => void;
}

/**
 * PDF upload button with a live SSE-powered extraction progress bar.
 *
 * Stages: idle → saving → extracting → done | warn | error
 * The extraction phase shows an indeterminate animated bar + elapsed time
 * counter because Surya processes the whole file and we can't get per-page
 * progress from it.
 */
export function PdfUploadButton({ onUploaded, onError }: PdfUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ stage: 'idle', message: '' });
  const [elapsed, setElapsed] = useState(0);

  // Elapsed-time counter during extraction.
  useEffect(() => {
    if (state.stage !== 'extracting' || !state.startedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state.stage, state.startedAt]);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (inputRef.current) inputRef.current.value = '';

    setState({ stage: 'saving', message: 'Uploading…' });

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/pdf-reader/upload', { method: 'POST', body: fd });

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              stage: string;
              message: string;
              filename?: string;
              pageCount?: number;
            };
            const incoming = ev.stage as Stage;
            // 'saved' means the file is on disk and OCR is starting — show as 'extracting'.
            const display: Stage = incoming === 'saved' ? 'extracting' : incoming;
            setState((prev) => ({
              stage: display,
              message: ev.message,
              filename: ev.filename ?? prev.filename,
              pageCount: ev.pageCount ?? prev.pageCount,
              startedAt: display === 'extracting' && prev.stage !== 'extracting'
                ? Date.now()
                : prev.startedAt,
            }));

            if (incoming === 'done') {
              onUploaded(ev.filename ?? '', undefined);
            } else if (incoming === 'warn') {
              onUploaded(ev.filename ?? '', ev.message);
            } else if (incoming === 'error') {
              onError(ev.message);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setState({ stage: 'error', message: msg });
      onError(msg);
    }
  };

  const isActive = state.stage !== 'idle';
  const isDone = state.stage === 'done' || state.stage === 'warn' || state.stage === 'error';

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const progressPct =
    state.stage === 'saving' ? 15
    : state.stage === 'extracting' ? null   // indeterminate
    : state.stage === 'done' ? 100
    : state.stage === 'warn' ? 100
    : state.stage === 'error' ? 100
    : 0;

  return (
    <div className="pdf-upload">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-label="Select PDF file"
      />

      <button
        type="button"
        disabled={isActive && !isDone}
        className={`pdf-btn ${isActive ? 'active' : ''} ${state.stage === 'error' ? 'err' : ''}`}
        onClick={() => {
          if (isDone) {
            setState({ stage: 'idle', message: '' });
            setElapsed(0);
          } else if (!isActive) {
            inputRef.current?.click();
          }
        }}
        aria-label="Upload PDF"
      >
        {!isActive && (
          <>
            <UploadIcon />
            Upload PDF
          </>
        )}
        {state.stage === 'saving' && (
          <>
            <Spinner />
            Saving…
          </>
        )}
        {state.stage === 'extracting' && (
          <>
            <Spinner />
            {elapsed > 0 ? `Extracting… (${formatElapsed(elapsed)})` : 'Extracting…'}
          </>
        )}
        {state.stage === 'done' && <>✓ Done — {state.pageCount} pages · click to dismiss</>}
        {state.stage === 'warn' && <>⚠ Saved (no OCR) · click to dismiss</>}
        {state.stage === 'error' && <>✕ {state.message.slice(0, 40)} · click to dismiss</>}
      </button>

      {isActive && (
        <div className="progress-track" role="progressbar" aria-valuenow={progressPct ?? 50}>
          {progressPct !== null ? (
            <div
              className={`progress-fill ${state.stage === 'done' ? 'done' : state.stage === 'error' ? 'err' : ''}`}
              style={{ width: `${progressPct}%` }}
            />
          ) : (
            <div className="progress-indeterminate" />
          )}
        </div>
      )}

      {state.stage === 'extracting' && (
        <p className="pdf-hint">OCR can take a few minutes for long documents.</p>
      )}
      {state.stage === 'warn' && (
        <p className="pdf-hint warn">{state.message}</p>
      )}

      <style jsx>{`
        .pdf-upload { display: flex; flex-direction: column; gap: 0.35rem; }

        .pdf-btn {
          display: flex; align-items: center; justify-content: center; gap: 0.4rem;
          padding: 0.45rem 0.85rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 0.375rem;
          color: rgba(255,255,255,0.72);
          font-size: 0.82rem; font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          width: 100%;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pdf-btn:hover:not(:disabled):not(.active) {
          background: rgba(255,255,255,0.1); color: #fff;
        }
        .pdf-btn.active { color: rgba(255,255,255,0.85); cursor: default; }
        .pdf-btn.err { border-color: rgba(220,80,80,0.4); color: rgba(220,130,130,0.9); cursor: pointer; }
        .pdf-btn:disabled { opacity: 0.7; }

        .progress-track {
          width: 100%; height: 3px;
          background: rgba(255,255,255,0.08);
          border-radius: 2px; overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--reader-accent, #c5402f);
          border-radius: 2px;
          transition: width 0.4s ease;
        }
        .progress-fill.done { background: #3a9e6a; }
        .progress-fill.err  { background: #c54040; }

        .progress-indeterminate {
          height: 100%; width: 45%;
          background: var(--reader-accent, #c5402f);
          border-radius: 2px;
          animation: slide 1.4s ease-in-out infinite;
        }
        @keyframes slide {
          0%   { transform: translateX(-120%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(280%); }
        }

        .pdf-hint {
          font-size: 0.72rem; color: rgba(255,255,255,0.4);
          margin: 0; line-height: 1.4;
        }
        .pdf-hint.warn { color: rgba(230,180,100,0.8); }
      `}</style>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.9s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
      <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
