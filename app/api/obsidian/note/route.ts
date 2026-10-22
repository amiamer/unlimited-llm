import { NextRequest, NextResponse } from 'next/server';
import { localObsidianService } from '@/lib/local-storage';

/**
 * Obsidian Note API endpoint
 * 
 * GET /api/obsidian/note - Read, list, or search notes
 *   Query params:
 *   - action: 'read' | 'list' | 'search' (required)
 *   - filename: note filename (required for 'read')
 *   - query: search query (required for 'search')
 *   - pattern: fuzzy filter pattern (optional for 'list')
 * 
 * POST /api/obsidian/note - Create a new note
 */

// Rate limiting map (in-memory, simple implementation)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120;
const RATE_LIMIT_MAX_ENTRIES = 10000; // Cap map size to prevent memory leak
let lastCleanup = Date.now();

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();

  // Periodically evict expired entries (every 5 minutes or when map is large)
  if (now - lastCleanup > 300_000 || rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    rateLimitMap.forEach((record, key) => {
      if (now > record.resetTime) rateLimitMap.delete(key);
    });
    lastCleanup = now;
  }

  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetTime) {
    // Create new record or reset expired one
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * GET handler for reading, listing, and searching notes
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limiting check
    const identifier = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(identifier)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 10 requests per minute.' },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (!action) {
      return NextResponse.json(
        { error: 'Action parameter is required (read, list, or search)' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'read': {
        const filename = searchParams.get('filename');
        if (!filename) {
          return NextResponse.json(
            { error: 'Filename parameter is required for read action' },
            { status: 400 }
          );
        }
        const note = await localObsidianService.readNote(filename);
        return NextResponse.json({
          success: true,
          data: note,
        });
      }

      case 'list': {
        const pattern = searchParams.get('pattern') || undefined;
        const notes = await localObsidianService.listNotes(pattern);
        return NextResponse.json({
          success: true,
          data: notes,
        });
      }

      case 'search': {
        const query = searchParams.get('query');
        if (!query) {
          return NextResponse.json(
            { error: 'Query parameter is required for search action' },
            { status: 400 }
          );
        }
        const results = await localObsidianService.search(query);
        return NextResponse.json({
          success: true,
          data: results,
        });
      }

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}. Use read, list, or search.` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Obsidian note API GET error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    // Determine appropriate status code
    let statusCode = 500;
    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      statusCode = 404;
    } else if (errorMessage.includes('Security') || errorMessage.includes('traversal')) {
      statusCode = 403;
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting check
    const identifier = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(identifier)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Maximum 10 requests per minute.' },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate task field
    if (!body.task || typeof body.task !== 'string') {
      return NextResponse.json(
        { error: 'Task field is required and must be a string' },
        { status: 400 }
      );
    }

    const task = body.task.trim();

    // Validate task is not empty
    if (task.length === 0) {
      return NextResponse.json(
        { error: 'Task cannot be empty' },
        { status: 400 }
      );
    }

    // Validate task length (LocalObsidianService writes directly to filesystem — no webhook cap)
    if (task.length > 1_000_000) {
      return NextResponse.json(
        { error: 'Task exceeds maximum length of 1000000 characters' },
        { status: 400 }
      );
    }

    // Send task to local Obsidian service
    const result = await localObsidianService.sendNoteTask(task);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Obsidian note API error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    // Determine appropriate status code
    let statusCode = 500;
    if (errorMessage.includes('timed out')) {
      statusCode = 504;
    } else if (errorMessage.includes('Webhook returned')) {
      statusCode = 502;
    }

    return NextResponse.json(
      {
        success: false,
        error: `Failed to create note: ${errorMessage}`,
      },
      { status: statusCode }
    );
  }
}

/** DELETE /api/obsidian/note?title=... — delete a note by its display title. */
export async function DELETE(request: NextRequest) {
  try {
    const identifier = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(identifier)) {
      return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title')?.trim();
    if (!title) {
      return NextResponse.json({ error: 'title query param is required' }, { status: 400 });
    }

    await localObsidianService.deleteNoteByTitle(title);
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
