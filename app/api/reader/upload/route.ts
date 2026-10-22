import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Local File Upload API endpoint for ePub files
 * POST /api/reader/upload
 * 
 * Validates ePub file format, saves to local BOOKS_PATH directory, and returns file path
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file extension is .epub
    if (!file.name.toLowerCase().endsWith('.epub')) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid file format. Only .epub files are supported.' 
        },
        { status: 400 }
      );
    }

    // Check file size before loading into memory (50MB limit)
    const MAX_EPUB_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_EPUB_SIZE) {
      return NextResponse.json(
        { success: false, error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 50MB.` },
        { status: 400 }
      );
    }

    // Ensure books directory exists
    if (!existsSync(BOOKS_PATH)) {
      await mkdir(BOOKS_PATH, { recursive: true });
    }

    // Use original filename (sanitized) to maintain consistency with audiobook folders
    // Remove .epub extension and sanitize for filesystem
    const bookTitle = file.name.replace(/\.epub$/i, '');
    const sanitizedTitle = bookTitle.replace(/[<>:"/\\|?*]/g, '_');
    const fileName = `${sanitizedTitle}.epub`;
    const filePath = join(BOOKS_PATH, fileName);

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save file to local storage
    await writeFile(filePath, buffer);

    console.log(`Successfully uploaded ePub file: ${file.name} to ${filePath}`);

    // Create serving URL (encode for filenames with spaces/special chars)
    const servingUrl = `/api/reader/serve/${encodeURIComponent(fileName)}`;

    return NextResponse.json({
      success: true,
      filePath,
      fileName: bookTitle, // Return title without .epub extension to match session ID
      localPath: filePath,
      url: servingUrl, // URL for epub.js to load from
    });

  } catch (error) {
    console.error('Error uploading ePub file:', error);
    
    let errorMessage = 'Failed to upload file';
    let statusCode = 500;
    
    if (error instanceof Error) {
      if (error.message.includes('ENOSPC')) {
        errorMessage = 'Disk space error: Not enough space to save the file.';
        statusCode = 507;
      } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
        errorMessage = 'Permission error: Unable to write to the books directory.';
        statusCode = 403;
      } else if (error.message.includes('ENOENT')) {
        errorMessage = 'Directory error: Books directory path is invalid.';
        statusCode = 500;
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage
      },
      { status: statusCode }
    );
  }
}
