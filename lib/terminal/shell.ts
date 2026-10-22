/**
 * Shell selection and path helpers for the local terminal panel.
 * Pure functions (no I/O except an existsSync probe for Git Bash), so they are
 * easy to test.
 */

import { existsSync } from 'fs';

/** bash = Git Bash on Windows (the system shell elsewhere), wsl = Ubuntu via WSL. */
export type ShellKind = 'bash' | 'wsl' | 'powershell';

export function parseShellKind(value: string | undefined): ShellKind {
  const v = (value || '').trim().toLowerCase();
  if (v === 'wsl' || v === 'ubuntu') return 'wsl';
  if (v === 'powershell' || v === 'pwsh') return 'powershell';
  return 'bash';
}

/** The program and arguments to launch for a shell kind on this platform. */
export function shellCommand(
  kind: ShellKind,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (p: string) => boolean = existsSync,
): { file: string; args: string[] } {
  if (platform !== 'win32') return { file: env.SHELL || '/bin/bash', args: ['-l'] };
  if (kind === 'wsl') return { file: 'wsl.exe', args: ['--cd', '~'] };
  if (kind === 'powershell') return { file: 'powershell.exe', args: ['-NoLogo'] };
  const candidates = [
    env.TERMINAL_BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter((p): p is string => !!p);
  return { file: candidates.find((p) => exists(p)) ?? 'bash.exe', args: ['--login', '-i'] };
}

/** Spell a Windows path the way the chosen shell expects it (C:\x → /c/x or /mnt/c/x). */
export function toShellPath(winPath: string, kind: ShellKind, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || kind === 'powershell') return winPath;
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, '/');
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/').replace(/\/+$/, '');
  const base = kind === 'wsl' ? `/mnt/${drive}` : `/${drive}`;
  return rest ? `${base}/${rest}` : base;
}

/** A `cd` command for the shell, with the path safely quoted. */
export function cdCommand(shellPath: string, kind: ShellKind): string {
  if (kind === 'powershell') return `Set-Location -LiteralPath '${shellPath.replace(/'/g, "''")}'`;
  return `cd '${shellPath.replace(/'/g, `'\\''`)}'`;
}
