import { createServer } from 'net';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

vi.mock('server-only', () => ({}));

import { isLocalRequest } from '../access';
import { cdCommand, parseShellKind, shellCommand, toShellPath } from '../shell';

const headers = (h: Record<string, string>) => new Headers(h);

describe('shell selection', () => {
  it('defaults to bash and understands wsl/ubuntu and powershell', () => {
    expect(parseShellKind(undefined)).toBe('bash');
    expect(parseShellKind('Ubuntu')).toBe('wsl');
    expect(parseShellKind('wsl')).toBe('wsl');
    expect(parseShellKind('pwsh')).toBe('powershell');
    expect(parseShellKind('zsh')).toBe('bash');
  });

  it('launches Git Bash on Windows, WSL or PowerShell on request, and $SHELL elsewhere', () => {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    expect(shellCommand('bash', 'win32', {}, (p) => p === gitBash)).toEqual({ file: gitBash, args: ['--login', '-i'] });
    expect(shellCommand('bash', 'win32', { TERMINAL_BASH_PATH: 'D:\\git\\bash.exe' }, () => true).file).toBe('D:\\git\\bash.exe');
    expect(shellCommand('wsl', 'win32', {}, () => false)).toEqual({ file: 'wsl.exe', args: ['--cd', '~'] });
    expect(shellCommand('powershell', 'win32', {}, () => false).file).toBe('powershell.exe');
    expect(shellCommand('bash', 'linux', { SHELL: '/bin/zsh' })).toEqual({ file: '/bin/zsh', args: ['-l'] });
  });

  it('spells Windows paths the way each shell expects', () => {
    expect(toShellPath('C:\\Obsidian\\main', 'bash', 'win32')).toBe('/c/Obsidian/main');
    expect(toShellPath('C:\\Obsidian\\main', 'wsl', 'win32')).toBe('/mnt/c/Obsidian/main');
    expect(toShellPath('C:\\', 'bash', 'win32')).toBe('/c');
    expect(toShellPath('C:\\Obsidian\\main', 'powershell', 'win32')).toBe('C:\\Obsidian\\main');
    expect(toShellPath('/home/me/vault', 'bash', 'linux')).toBe('/home/me/vault');
  });

  it('quotes cd targets safely', () => {
    expect(cdCommand("/c/My Vault/it's", 'bash')).toBe("cd '/c/My Vault/it'\\''s'");
    expect(cdCommand("C:\\it's", 'powershell')).toBe("Set-Location -LiteralPath 'C:\\it''s'");
  });
});

describe('isLocalRequest', () => {
  it('accepts direct localhost requests', () => {
    expect(isLocalRequest(headers({ host: 'localhost:3000' }))).toBe(true);
    expect(isLocalRequest(headers({ host: '127.0.0.1:3000', 'x-forwarded-for': '::1' }))).toBe(true);
    expect(isLocalRequest(headers({ host: '[::1]:3000' }))).toBe(true);
  });

  it('refuses public hosts and anything that came through a tunnel or proxy', () => {
    expect(isLocalRequest(headers({ host: 'example.com' }))).toBe(false);
    expect(isLocalRequest(headers({ host: 'localhost:3000', 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(headers({ host: 'localhost:3000', 'cf-connecting-ip': '203.0.113.9' }))).toBe(false);
    expect(isLocalRequest(headers({ host: 'localhost:3000', 'ngrok-trace-id': 'abc' }))).toBe(false);
    expect(isLocalRequest(headers({ host: 'localhost:3000', 'x-forwarded-host': 'example.ngrok-free.dev' }))).toBe(false);
  });
});

describe('server helpers', async () => {
  const { allowedOrigins, shellEnv, tokenMatches } = await import('../server');

  it('allows only the app on localhost by default', () => {
    expect(allowedOrigins({ NEXT_DEV_PORT: '3000' })).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(allowedOrigins({ TERMINAL_ALLOWED_ORIGINS: 'http://a, http://b' })).toEqual(['http://a', 'http://b']);
  });

  it('compares tokens exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches(null, 'abc')).toBe(false);
  });

  it('keeps .env values out of the shell environment', () => {
    const env = shellEnv({ PATH: '/bin', OPENROUTER_API_KEY: 'secret', HOME: '/h' }, new Set(['OPENROUTER_API_KEY']));
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.TERM).toBe('xterm-256color');
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

let ptyAvailable = true;
try {
  await import('node-pty');
} catch {
  ptyAvailable = false;
}

describe.skipIf(!ptyAvailable)('terminal bridge (real shell)', async () => {
  process.env.TERMINAL_PORT = String(await freePort());
  process.env.TERMINAL_ALLOWED_ORIGINS = 'http://localhost:3000';
  delete process.env.TERMINAL_SHELL;
  const { ensureTerminalServer } = await import('../server');
  const server = await ensureTerminalServer();
  const url = `ws://127.0.0.1:${server.port}`;

  afterAll(() => {
    delete process.env.TERMINAL_PORT;
    delete process.env.TERMINAL_ALLOWED_ORIGINS;
  });

  it('refuses a wrong token or a foreign origin', async () => {
    const attempt = (target: string, origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(target, { origin });
        ws.on('open', () => { ws.close(); resolve('opened'); });
        ws.on('error', () => resolve('refused'));
      });
    expect(await attempt(`${url}/?token=wrong`, 'http://localhost:3000')).toBe('refused');
    expect(await attempt(`${url}/?token=${server.token}`, 'https://evil.example')).toBe('refused');
  });

  it('runs a command in a real shell and streams the output back', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${url}/?token=${server.token}`, { origin: 'http://localhost:3000' });
      let text = '';
      const timer = setTimeout(() => { ws.close(); reject(new Error(`no marker in output: ${text.slice(-300)}`)); }, 20_000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'input', data: 'echo "pty-$((40+2))-ok"\r' })));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'output') text += msg.data;
        if (text.includes('pty-42-ok')) {
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: 'input', data: 'exit\r' }));
          ws.close();
          resolve(text);
        }
      });
      ws.on('error', reject);
    });
    expect(output).toContain('pty-42-ok');
  }, 30_000);
});
