import { NextRequest, NextResponse } from 'next/server';
import { isLocalRequest } from '@/lib/terminal/access';
import { cdCommand, toShellPath, type ShellKind } from '@/lib/terminal/shell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Quick "go to" buttons for the panel: the vault, the books folder, this app's code. */
function places(shell: ShellKind): { label: string; command: string }[] {
  const entries: [string, string | undefined][] = [
    ['vault', process.env.OBSIDIAN_VAULT_PATH],
    ['books', process.env.BOOKS_PATH],
    ['app code', process.cwd()],
  ];
  return entries
    .filter((e): e is [string, string] => !!e[1])
    .map(([label, dir]) => ({ label, command: cdCommand(toShellPath(dir, shell), shell) }));
}

/**
 * GET /api/terminal/session
 *
 * Hands the browser what it needs to open a local terminal: the WebSocket
 * address (127.0.0.1 only) and this run's token. Signed-in users only (Clerk
 * middleware), and only when the app is used on this computer: requests that
 * came through a tunnel or proxy are refused.
 */
export async function GET(request: NextRequest) {
  if (process.env.ENABLE_LOCAL_TERMINAL !== 'true') {
    return NextResponse.json(
      { error: 'The terminal is turned off. Set ENABLE_LOCAL_TERMINAL=true in .env to use it.' },
      { status: 404 },
    );
  }
  if (!isLocalRequest(request.headers)) {
    return NextResponse.json(
      { error: 'The terminal only works when you use the app on this computer (localhost).' },
      { status: 403 },
    );
  }
  try {
    const { ensureTerminalServer } = await import('@/lib/terminal/server');
    const server = await ensureTerminalServer();
    return NextResponse.json({
      url: `ws://127.0.0.1:${server.port}`,
      token: server.token,
      shell: server.shell,
      places: places(server.shell),
    });
  } catch (error) {
    console.error('[terminal] could not start:', error);
    return NextResponse.json(
      { error: `Could not start the terminal: ${error instanceof Error ? error.message : 'unknown error'}` },
      { status: 500 },
    );
  }
}
