'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface Place { label: string; command: string }
type Status = 'connecting' | 'connected' | 'closed' | 'error';

const STATUS_DOT: Record<Status, string> = {
  connecting: 'bg-yellow-400',
  connected: 'bg-emerald-400',
  closed: 'bg-gray-500',
  error: 'bg-red-500',
};

/**
 * A real shell on this computer (Git Bash by default, Ubuntu via WSL with
 * TERMINAL_SHELL=wsl), rendered with xterm.js. The session stays alive while
 * the panel is hidden; "new session" starts a fresh one.
 */
export default function TerminalPanel({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('');
  const [shell, setShell] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [generation, setGeneration] = useState(0);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    try { fitRef.current?.fit(); } catch { /* not visible yet */ }
    if (term && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      setStatus('connecting');
      setMessage('');
      const res = await fetch('/api/terminal/session', { cache: 'no-store' });
      const session = await res.json().catch(() => ({}));
      if (disposed) return;
      if (!res.ok) {
        setStatus('error');
        setMessage(session.error || `The terminal is unavailable (${res.status}).`);
        return;
      }
      setShell(session.shell === 'wsl' ? 'ubuntu (wsl)' : session.shell);
      setPlaces(Array.isArray(session.places) ? session.places : []);

      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: '"Cascadia Code", Consolas, Menlo, monospace',
        fontSize: 13,
        scrollback: 5000,
        theme: { background: '#0b0b0f', foreground: '#e5e7eb', cursor: '#d84848', selectionBackground: '#7f1d1d80' },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      try { fit.fit(); } catch { /* hidden */ }

      const ws = new WebSocket(`${session.url}/?token=${encodeURIComponent(session.token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        if (disposed) return;
        setStatus('connected');
        sendResize();
        term.focus();
      };
      ws.onmessage = (event) => {
        let msg: { type?: string; data?: string; code?: number };
        try { msg = JSON.parse(String(event.data)); } catch { return; }
        if (msg.type === 'output' && typeof msg.data === 'string') term.write(msg.data);
        else if (msg.type === 'exit') {
          term.write(`\r\n[session ended${typeof msg.code === 'number' ? ` with code ${msg.code}` : ''}. use "new session" to start another]\r\n`);
          setStatus('closed');
        }
      };
      ws.onerror = () => {
        if (disposed) return;
        setStatus('error');
        setMessage('Could not connect to the terminal on this computer.');
      };
      ws.onclose = () => {
        if (!disposed) setStatus((s) => (s === 'error' ? s : 'closed'));
      };

      const input = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
      });
      const observer = new ResizeObserver(() => sendResize());
      observer.observe(hostRef.current);

      cleanup = () => {
        observer.disconnect();
        input.dispose();
        ws.close();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
        wsRef.current = null;
      };
    })().catch((error) => {
      if (disposed) return;
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [generation, sendResize]);

  // Refit and focus whenever the panel becomes visible again.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      sendResize();
      termRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [active, sendResize]);

  const run = (command: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: `${command}\r` }));
    termRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#0b0b0f]">
      <div className="flex flex-wrap items-center gap-2 border-b border-navy-red-700 px-3 py-2 text-xs text-gray-300">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} title={status} />
        <span className="text-gray-400">{shell || 'terminal'}</span>
        {places.map((p) => (
          <button
            key={p.label}
            onClick={() => run(p.command)}
            disabled={status !== 'connected'}
            className="rounded border border-navy-red-700 px-2 py-0.5 text-gray-300 hover:border-[#b83030] hover:text-white disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setGeneration((g) => g + 1)}
          className="ml-auto rounded border border-navy-red-700 px-2 py-0.5 text-gray-300 hover:border-[#b83030] hover:text-white"
        >
          new session
        </button>
      </div>
      {status === 'error' && <div className="px-3 py-2 text-sm text-red-300">{message}</div>}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-1" />
    </div>
  );
}
