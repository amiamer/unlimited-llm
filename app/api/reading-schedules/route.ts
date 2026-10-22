import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { parseSchedules } from '@/lib/reader-workspace/reading-schedule';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reading-schedules
 *
 * Reading-group schedules are personal data, so they live in the vault rather
 * than in code: READING_SCHEDULES_FILE, else
 * <OBSIDIAN_VAULT_PATH>/excluded/reading-schedules.json. A missing or invalid
 * file yields no schedules, which simply hides the reader's schedule panel.
 */
function schedulesFile(): string | null {
  if (process.env.READING_SCHEDULES_FILE) return process.env.READING_SCHEDULES_FILE;
  const vault = process.env.OBSIDIAN_VAULT_PATH;
  return vault ? path.join(vault, 'excluded', 'reading-schedules.json') : null;
}

export async function GET() {
  const file = schedulesFile();
  if (!file) return NextResponse.json({ schedules: [] });
  try {
    const schedules = parseSchedules(JSON.parse(await readFile(file, 'utf-8')));
    return NextResponse.json({ schedules });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[reading-schedules] could not load schedules:', error);
    }
    return NextResponse.json({ schedules: [] });
  }
}
