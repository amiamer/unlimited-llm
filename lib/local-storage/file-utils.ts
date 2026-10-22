/**
 * File utilities for atomic writes and retry logic
 * 
 * This module provides utilities for:
 * - Atomic file writes using temp file + rename pattern
 * - Retry logic with exponential backoff for file locking (EBUSY/EPERM)
 * - Recursive directory creation
 * - Content hash computation for cache invalidation
 * 
 * Requirements: 1.3, 6.1, 6.2, 6.3
 */

import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
import { FileInfo } from './types';

/**
 * Default maximum retries for locked file operations
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Base delay in milliseconds for exponential backoff
 */
const BASE_RETRY_DELAY_MS = 100;

/**
 * Error codes that should trigger retry logic
 */
const RETRYABLE_ERROR_CODES = ['EBUSY', 'EPERM'];

/**
 * Type guard to check if an error has a code property
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Checks if an error is retryable (EBUSY or EPERM)
 */
function isRetryableError(error: unknown): boolean {
  if (!isNodeError(error)) {
    return false;
  }
  return RETRYABLE_ERROR_CODES.includes(error.code || '');
}

/**
 * Writes data to a file atomically using temp file + rename pattern
 * 
 * This prevents file corruption if the process crashes mid-write:
 * 1. Write to a temporary file in the same directory
 * 2. Rename temp file to target (atomic on same filesystem)
 * 3. Clean up temp file on failure
 * 
 * @param filePath - The target file path
 * @param data - The data to write
 * @throws Error if the write operation fails
 * 
 * @example
 * await atomicWrite('/path/to/file.json', JSON.stringify(data));
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  // Ensure the directory exists
  const dir = path.dirname(filePath);
  await ensureDirectory(dir);

  // Create temp file in SAME directory as target (required for atomic rename)
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    // Write to temp file
    await fs.writeFile(tempPath, data, 'utf-8');
    
    // Atomic rename to target
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure (ignore cleanup errors)
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

/**
 * Executes an operation with retry logic and exponential backoff
 * 
 * Retries on EBUSY and EPERM errors which indicate file locking on Windows.
 * Uses exponential backoff: 100ms, 200ms, 400ms, etc.
 * 
 * @param operation - The async operation to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns The result of the operation
 * @throws The last error if all retries fail
 * 
 * @example
 * const content = await retryWithBackoff(
 *   () => fs.readFile(path, 'utf-8'),
 *   3
 * );
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (isRetryableError(error) && attempt < maxRetries) {
        lastError = error as Error;
        // Exponential backoff: 100ms, 200ms, 400ms, ...
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Retry failed with unknown error');
}

/**
 * Ensures a directory exists, creating it recursively if necessary
 * 
 * @param dirPath - The directory path to ensure exists
 * @throws Error if directory creation fails (except EEXIST)
 * 
 * @example
 * await ensureDirectory('/path/to/nested/directory');
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore EEXIST errors (directory already exists)
    if (isNodeError(error) && error.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

/**
 * Computes a SHA-256 hash of file information for cache invalidation
 * 
 * The hash is computed from sorted file paths and sizes, making it
 * more reliable than mtime-based detection which can change due to
 * NTP sync, backup software, or git operations.
 * 
 * @param files - Array of file info objects with path and size
 * @returns A hex-encoded SHA-256 hash string
 * 
 * @example
 * const hash = computeContentHash([
 *   { path: '/path/to/file1.json', size: 1024 },
 *   { path: '/path/to/file2.json', size: 2048 }
 * ]);
 */
export function computeContentHash(files: FileInfo[]): string {
  // Sort files by path for consistent ordering
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  
  // Create a string representation of all files
  const content = sortedFiles
    .map(f => `${f.path}:${f.size}`)
    .join('\n');
  
  // Compute SHA-256 hash
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Reads a file with retry logic for handling file locks
 * 
 * @param filePath - The file path to read
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns The file contents as a string
 * @throws Error if read fails after all retries
 */
export async function readFileWithRetry(
  filePath: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<string> {
  return retryWithBackoff(
    () => fs.readFile(filePath, 'utf-8'),
    maxRetries
  );
}

/**
 * Writes a file atomically with retry logic for handling file locks
 * 
 * @param filePath - The target file path
 * @param data - The data to write
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @throws Error if write fails after all retries
 */
export async function writeFileWithRetry(
  filePath: string,
  data: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<void> {
  return retryWithBackoff(
    () => atomicWrite(filePath, data),
    maxRetries
  );
}

/**
 * Deletes a file with retry logic for handling file locks
 * 
 * @param filePath - The file path to delete
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @throws Error if delete fails after all retries (except ENOENT)
 */
export async function deleteFileWithRetry(
  filePath: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<void> {
  return retryWithBackoff(
    async () => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // Ignore ENOENT errors (file already deleted)
        if (isNodeError(error) && error.code === 'ENOENT') {
          return;
        }
        throw error;
      }
    },
    maxRetries
  );
}

/**
 * Checks if a file exists
 * 
 * @param filePath - The file path to check
 * @returns true if the file exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a directory exists
 * 
 * @param dirPath - The directory path to check
 * @returns true if the directory exists, false otherwise
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Gets file stats with retry logic
 * 
 * @param filePath - The file path to stat
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns The file stats
 * @throws Error if stat fails after all retries
 */
export async function getFileStats(
  filePath: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  return retryWithBackoff(
    () => fs.stat(filePath),
    maxRetries
  );
}

/**
 * Lists files in a directory with retry logic
 * 
 * @param dirPath - The directory path to list
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Array of filenames in the directory
 * @throws Error if listing fails after all retries
 */
export async function listDirectory(
  dirPath: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<string[]> {
  return retryWithBackoff(
    () => fs.readdir(dirPath),
    maxRetries
  );
}

/**
 * Gets file info (path and size) for all files in a directory
 * 
 * @param dirPath - The directory path to scan
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @returns Array of FileInfo objects
 */
export async function getDirectoryFileInfo(
  dirPath: string,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<FileInfo[]> {
  const files = await listDirectory(dirPath, maxRetries);
  const fileInfos: FileInfo[] = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const stats = await getFileStats(filePath, maxRetries);
      if (stats.isFile()) {
        fileInfos.push({
          path: filePath,
          size: Number(stats.size)
        });
      }
    } catch {
      // Skip files that can't be stat'd
      continue;
    }
  }

  return fileInfos;
}

/**
 * Helper function to sleep for a specified duration
 * 
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
