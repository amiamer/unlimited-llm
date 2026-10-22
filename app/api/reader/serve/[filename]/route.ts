import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * File serving API endpoint for ePub files
 * GET /api/reader/serve/[filename]
 * 
 * Serves ePub files from the local BOOKS_PATH directory
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const { filename } = params;

    // Validate filename (security check)
    if (!filename || !filename.endsWith('.epub') || filename.includes('..') || filename.includes('/')) {
      return NextResponse.json(
        { error: 'Invalid filename' },
        { status: 400 }
      );
    }

    const filePath = join(BOOKS_PATH, filename);

    // Check if file exists
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    // Read file
    const fileBuffer = await readFile(filePath);

    // Return file with appropriate headers
    return new NextResponse(fileBuffer as BodyInit, {
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });

  } catch (error) {
    console.error('Error serving ePub file:', error);
    
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
}

/**
 * HEAD handler for file existence checks
 * Used by SessionManager.validateUrl() to verify books still exist on disk
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const { filename } = params;

    if (!filename || !filename.endsWith('.epub') || filename.includes('..') || filename.includes('/')) {
      return new NextResponse(null, { status: 400 });
    }

    const filePath = join(BOOKS_PATH, filename);

    if (!existsSync(filePath)) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/epub+zip',
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
