import 'server-only';

import { randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IPty } from 'node-pty';
import type { WebSocket, WebSocketServer } from 'ws';
import { parseShellKind, shellCommand, type ShellKind } from './shell';

/**
 * Local terminal server: a WebSocket bridge to real shell sessions (node-pty),
 * started inside the Next.js server process on first use.
 *
 * Safety:
 *  - binds to 127.0.0.1 only, so nothing outside this computer can reach it;
 *  - every connection needs the per-start random token (handed out only by the
 *    signed-in, local-only /api/terminal/session route) and the app's Origin;
 *  - the shell gets the OS environment minus the values loaded from .env, so
 *    the app's keys don't leak into the terminal.
 */

export interface TerminalServer {
  port: number;
  token: string;
  shell: ShellKind;
}

interface Internal extends TerminalServer {
  wss: WebSocketServer;
  sessions: Set<IPty>;
}

const MAX_SESSIONS = 4;
const holder = globalThis as unknown as { __unlimitedTerminal?: Promise<Internal> };

export function terminalPort(): number {
  const p = parseInt(process.env.TERMINAL_PORT || '', 10);
  return Number.isFinite(p) && p > 0 ? p : 3010;
}

/** Browser origins allowed to open a terminal (the app itself, on localhost). */
export function allowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  if (env.TERMINAL_ALLOWED_ORIGINS) {
    return env.TERMINAL_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const appPort = env.PORT || env.NEXT_DEV_PORT || '3000';
  return [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`];
}

export function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Names of variables defined in the app's .env files (kept out of the shell). */
function dotenvKeys(cwd = process.cwd()): Set<string> {
  const keys = new Set<string>();
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const file = path.join(cwd, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m) keys.add(m[1]);
    }
  }
  return keys;
}

export function shellEnv(env: Record<string, string | undefined> = process.env, hidden: Set<string> = dotenvKeys()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !hidden.has(k) && !k.startsWith('__NEXT') && k !== 'NODE_OPTIONS') out[k] = v;
  }
  out.TERM = 'xterm-256color';
  out.COLORTERM = 'truecolor';
  return out;
}

export function ensureTerminalServer(): Promise<TerminalServer> {
  if (!holder.__unlimitedTerminal) {
    holder.__unlimitedTerminal = start().catch((error) => {
      holder.__unlimitedTerminal = undefined;
      throw error;
    });
  }
  return holder.__unlimitedTerminal.then(({ port, token, shell }) => ({ port, token, shell }));
}

async function start(): Promise<Internal> {
  const pty = await import('node-pty');
  const { WebSocketServer } = await import('ws');
  const token = randomBytes(32).toString('hex');
  const port = terminalPort();
  const shell = parseShellKind(process.env.TERMINAL_SHELL);
  const origins = allowedOrigins();
  const sessions = new Set<IPty>();

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    maxPayload: 1024 * 1024,
    verifyClient: ({ origin, req }, done) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const ok = origins.includes(origin) && tokenMatches(url.searchParams.get('token'), token) && sessions.size < MAX_SESSIONS;
      done(ok, ok ? undefined : 403);
    },
  });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  wss.on('connection', (ws) => attach(ws, pty, shell, sessions));
  return { port, token, shell, wss, sessions };
}

function send(ws: WebSocket, message: object): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function attach(ws: WebSocket, pty: typeof import('node-pty'), shell: ShellKind, sessions: Set<IPty>): void {
  const { file, args } = shellCommand(shell);
  let term: IPty;
  try {
    term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: process.env.TERMINAL_CWD || os.homedir(),
      env: shellEnv(),
    });
  } catch (error) {
    send(ws, { type: 'output', data: `\r\nCould not start ${file}: ${error instanceof Error ? error.message : String(error)}\r\n` });
    ws.close();
    return;
  }
  sessions.add(term);

  term.onData((data) => send(ws, { type: 'output', data }));
  term.onExit(({ exitCode }) => {
    sessions.delete(term);
    send(ws, { type: 'exit', code: exitCode });
    ws.close();
  });

  ws.on('message', (raw) => {
    let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      term.write(msg.data);
    } else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
      const cols = Math.min(Math.max(msg.cols as number, 2), 500);
      const rows = Math.min(Math.max(msg.rows as number, 2), 200);
      try { term.resize(cols, rows); } catch { /* process already gone */ }
    }
  });

  ws.on('close', () => {
    if (!sessions.has(term)) return;
    sessions.delete(term);
    try { term.kill(); } catch { /* already exited */ }
  });
}
