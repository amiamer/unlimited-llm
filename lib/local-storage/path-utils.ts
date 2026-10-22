/**
 * Path utilities for Windows compatibility
 * 
 * This module provides utilities for:
 * - Sanitizing filenames to remove Windows-invalid characters
 * - Truncating filenames to respect MAX_PATH limits
 * - Sanitizing timestamps for use in filenames
 * - Normalizing paths with mixed separators
 * - Cross-platform path joining
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Characters that are invalid in Windows filenames
 * Includes: < > : " | ? * \ /
 */
const WINDOWS_INVALID_CHARS = /[<>:"|?*\\/]/g;

/**
 * Reserved Windows filenames (case-insensitive)
 */
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
];

/**
 * Maximum filename length to stay safely under Windows MAX_PATH (260 chars)
 * Leaves room for directory path and extension
 */
const MAX_FILENAME_LENGTH = 200;

/**
 * Length of hash suffix used when truncating filenames
 */
const HASH_SUFFIX_LENGTH = 8;

/**
 * Sanitizes a string to create a valid Windows filename
 * 
 * - Replaces invalid characters (< > : " | ? * \ /) with underscores
 * - Handles reserved Windows filenames by prefixing with underscore
 * - Trims leading/trailing whitespace and dots
 * - Returns 'unnamed' for empty strings
 * 
 * @param name - The string to sanitize
 * @returns A valid Windows filename
 * 
 * @example
 * sanitizeFilename('My:File<Name>') // Returns 'My_File_Name_'
 * sanitizeFilename('CON') // Returns '_CON'
 * sanitizeFilename('  test  ') // Returns 'test'
 */
export function sanitizeFilename(name: string): string {
  if (!name || name.trim().length === 0) {
    return 'unnamed';
  }

  // Replace invalid characters with underscores
  let sanitized = name.replace(WINDOWS_INVALID_CHARS, '_');

  // Trim leading/trailing whitespace and dots (Windows doesn't allow trailing dots)
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');

  // Handle empty result after sanitization
  if (sanitized.length === 0) {
    return 'unnamed';
  }

  // Check for reserved Windows filenames (case-insensitive)
  const upperName = sanitized.toUpperCase();
  const baseName = upperName.split('.')[0]; // Check without extension
  if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
    sanitized = '_' + sanitized;
  }

  return sanitized;
}

/**
 * Truncates a filename to respect Windows MAX_PATH limits
 * 
 * If the filename exceeds maxLength, it is truncated and a hash suffix
 * is appended to preserve uniqueness.
 * 
 * @param name - The filename to potentially truncate
 * @param maxLength - Maximum allowed length (default: 200)
 * @returns The filename, truncated with hash suffix if necessary
 * 
 * @example
 * truncateFilename('short-name') // Returns 'short-name'
 * truncateFilename('very-long-name...', 20) // Returns 'very-long-na_a1b2c3d4'
 */
export function truncateFilename(name: string, maxLength: number = MAX_FILENAME_LENGTH): string {
  if (name.length <= maxLength) {
    return name;
  }

  // Generate hash of original name for uniqueness
  const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, HASH_SUFFIX_LENGTH);
  
  // Calculate truncation point: leave room for underscore + hash
  const truncateAt = maxLength - HASH_SUFFIX_LENGTH - 1;
  const truncated = name.slice(0, truncateAt);

  return `${truncated}_${hash}`;
}

/**
 * Sanitizes an ISO timestamp for use in filenames
 * 
 * Replaces colons (invalid in Windows filenames) with dashes
 * 
 * @param isoTimestamp - An ISO 8601 timestamp string
 * @returns A filename-safe version of the timestamp
 * 
 * @example
 * sanitizeTimestamp('2026-01-16T10:30:00.000Z') // Returns '2026-01-16T10-30-00.000Z'
 */
export function sanitizeTimestamp(isoTimestamp: string): string {
  // Replace colons with dashes (colons are invalid in Windows filenames)
  return isoTimestamp.replace(/:/g, '-');
}

/**
 * Normalizes a path to use consistent separators
 * 
 * - Converts all separators to the platform's native separator
 * - Removes redundant separators
 * - Resolves . and .. segments
 * 
 * @param inputPath - The path to normalize
 * @returns A normalized path with consistent separators
 * 
 * @example
 * normalizePath('C:/Users\\test//folder') // Returns 'C:\\Users\\test\\folder' on Windows
 */
export function normalizePath(inputPath: string): string {
  if (!inputPath) {
    return '';
  }

  // Use Node's path.normalize which handles:
  // - Mixed separators
  // - Redundant separators
  // - . and .. segments
  return path.normalize(inputPath);
}

/**
 * Joins path segments using the platform's native separator
 * 
 * Handles mixed separators in input segments and normalizes the result
 * 
 * @param segments - Path segments to join
 * @returns A joined and normalized path
 * 
 * @example
 * joinPath('C:/Users', 'test', 'file.txt') // Returns 'C:\\Users\\test\\file.txt' on Windows
 */
export function joinPath(...segments: string[]): string {
  if (segments.length === 0) {
    return '';
  }

  // Filter out empty segments
  const validSegments = segments.filter(s => s && s.length > 0);
  
  if (validSegments.length === 0) {
    return '';
  }

  // Use Node's path.join which handles cross-platform joining
  return path.join(...validSegments);
}

/**
 * Checks if a filename is valid for Windows
 * 
 * @param filename - The filename to check
 * @returns true if the filename is valid for Windows
 */
export function isValidWindowsFilename(filename: string): boolean {
  if (!filename || filename.length === 0) {
    return false;
  }

  // Check for invalid characters
  if (WINDOWS_INVALID_CHARS.test(filename)) {
    return false;
  }

  // Check length
  if (filename.length > MAX_FILENAME_LENGTH) {
    return false;
  }

  // Check for reserved names
  const upperName = filename.toUpperCase();
  const baseName = upperName.split('.')[0];
  if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
    return false;
  }

  // Check for trailing dots or spaces
  if (filename.endsWith('.') || filename.endsWith(' ')) {
    return false;
  }

  return true;
}

/**
 * Gets the file extension from a filename
 * 
 * @param filename - The filename to extract extension from
 * @returns The extension including the dot, or empty string if none
 */
export function getExtension(filename: string): string {
  return path.extname(filename);
}

/**
 * Removes the extension from a filename
 * 
 * @param filename - The filename to process
 * @returns The filename without its extension
 */
export function removeExtension(filename: string): string {
  const ext = path.extname(filename);
  if (ext) {
    return filename.slice(0, -ext.length);
  }
  return filename;
}


// ============================================================================
// Security Utilities (Requirements: 10.8, 11.6, 15.1, 15.4, 15.5)
// ============================================================================

import { SecurityError } from './errors';

/**
 * Validates that a path does not contain path traversal sequences
 * 
 * Rejects any path containing '..' to prevent directory traversal attacks.
 * Also validates that the resolved path stays within the allowed root.
 * 
 * @param inputPath - The path or query to validate
 * @param allowedRoot - Optional root directory to validate against
 * @throws SecurityError if path traversal is detected
 * 
 * Requirements: 10.8, 11.6, 15.1, 15.4, 15.5
 * 
 * @example
 * validatePathSecurity('notes/test.md'); // OK
 * validatePathSecurity('../etc/passwd'); // Throws SecurityError
 * validatePathSecurity('notes/../../../etc/passwd'); // Throws SecurityError
 */
export function validatePathSecurity(inputPath: string, allowedRoot?: string): void {
  // Check for path traversal sequences - only reject ".." when it's a path component
  // This means ".." preceded/followed by path separators or at start/end of string
  const pathTraversalPattern = /(^|[/\\])\.\.([/\\]|$)/;
  
  if (pathTraversalPattern.test(inputPath)) {
    throw new SecurityError(`Path traversal not allowed: ${inputPath}`, inputPath);
  }

  // Check for encoded traversal attempts
  try {
    const decoded = decodeURIComponent(inputPath);
    if (pathTraversalPattern.test(decoded)) {
      throw new SecurityError(`Encoded path traversal not allowed: ${inputPath}`, inputPath);
    }
  } catch (e) {
    // If decodeURIComponent fails (malformed URI), the path doesn't contain
    // valid URL-encoded traversal sequences, so we can safely continue
    if (!(e instanceof URIError)) {
      throw e;
    }
  }

  // If allowedRoot is provided, verify the resolved path stays within it
  if (allowedRoot) {
    const normalizedInput = path.normalize(inputPath);
    const resolvedPath = path.resolve(allowedRoot, normalizedInput);
    const resolvedRoot = path.resolve(allowedRoot);

    if (!resolvedPath.startsWith(resolvedRoot)) {
      throw new SecurityError(`Path escapes allowed root: ${inputPath}`, inputPath);
    }
  }
}

/**
 * Escapes special characters in a string for safe use in shell commands
 * 
 * This is a basic escape function for use with child_process.exec.
 * For production use, prefer execFile with argument arrays.
 * 
 * @param arg - The argument to escape
 * @returns The escaped argument safe for shell use
 * 
 * @example
 * escapeShellArg('hello world'); // Returns 'hello world'
 * escapeShellArg('test`whoami`'); // Returns 'test\\`whoami\\`'
 */
export function escapeShellArg(arg: string): string {
  // Escape backticks, dollar signs, backslashes, double quotes, and single quotes
  return arg
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

/**
 * Checks if a string contains path traversal sequences
 * 
 * @param input - The string to check
 * @returns true if path traversal is detected
 * 
 * @example
 * containsPathTraversal('normal/path'); // false
 * containsPathTraversal('../secret'); // true
 * containsPathTraversal('path/..%2F../etc'); // true (encoded)
 */
export function containsPathTraversal(input: string): boolean {
  if (input.includes('..')) {
    return true;
  }

  // Check for URL-encoded traversal
  try {
    const decoded = decodeURIComponent(input);
    if (decoded.includes('..')) {
      return true;
    }
  } catch {
    // If decoding fails, the input is malformed - treat as suspicious
    return true;
  }

  return false;
}
