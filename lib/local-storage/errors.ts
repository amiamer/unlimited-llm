/**
 * Error classes for local storage services
 * 
 * This module provides custom error classes for:
 * - Configuration errors (missing environment variables)
 * - Storage errors (file operations)
 * - Vault not found errors
 * - File lock errors
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 9.3
 */

import { FileOperation } from './types';

/**
 * Base error class for storage operations
 * 
 * Provides context about the file path and operation that failed.
 * 
 * @example
 * throw new StorageError(
 *   'Failed to read file: permission denied',
 *   '/path/to/file.json',
 *   'read',
 *   originalError
 * );
 */
export class StorageError extends Error {
  public readonly path: string;
  public readonly operation: FileOperation;
  public readonly cause?: Error;

  constructor(
    message: string,
    path: string,
    operation: FileOperation,
    cause?: Error
  ) {
    super(message);
    this.name = 'StorageError';
    this.path = path;
    this.operation = operation;
    this.cause = cause;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError);
    }
  }
}

/**
 * Error thrown when a required environment variable is missing
 * 
 * Used during service initialization to fail fast with clear error messages.
 * 
 * @example
 * if (!process.env.CHAT_VAULT_PATH) {
 *   throw new ConfigurationError('CHAT_VAULT_PATH');
 * }
 * 
 * Requirements: 1.2, 4.2, 9.3
 */
export class ConfigurationError extends Error {
  public readonly variableName: string;

  constructor(variableName: string) {
    super(`Missing required environment variable: ${variableName}`);
    this.name = 'ConfigurationError';
    this.variableName = variableName;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigurationError);
    }
  }
}

/**
 * Error thrown when a vault directory does not exist
 * 
 * Used specifically for Obsidian vault validation where the vault
 * must already exist (unlike chat vault which can be created).
 * 
 * @example
 * if (!await directoryExists(vaultPath)) {
 *   throw new VaultNotFoundError(vaultPath);
 * }
 * 
 * Requirements: 4.3
 */
export class VaultNotFoundError extends StorageError {
  constructor(path: string) {
    super(`Vault directory not found: ${path}`, path, 'read');
    this.name = 'VaultNotFoundError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VaultNotFoundError);
    }
  }
}

/**
 * Error thrown when a file operation fails due to file locking
 * 
 * This occurs on Windows when another process (like Obsidian) has
 * the file open. The error is thrown after retry attempts are exhausted.
 * 
 * @example
 * throw new FileLockError(
 *   'File locked after 3 retries',
 *   '/path/to/file.md',
 *   originalError
 * );
 */
export class FileLockError extends StorageError {
  constructor(message: string, path: string, cause?: Error) {
    super(message, path, 'write', cause);
    this.name = 'FileLockError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileLockError);
    }
  }
}

/**
 * Error thrown when a file operation fails due to permission issues
 * 
 * Includes guidance about checking file permissions.
 * 
 * Requirements: 6.4
 */
export class PermissionError extends StorageError {
  constructor(path: string, operation: FileOperation, cause?: Error) {
    const guidance = 'Please check that you have the necessary permissions to access this file or directory.';
    super(
      `Permission denied for ${operation} operation on: ${path}. ${guidance}`,
      path,
      operation,
      cause
    );
    this.name = 'PermissionError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PermissionError);
    }
  }
}

/**
 * Error thrown when a file operation fails due to insufficient disk space
 * 
 * Includes guidance about checking available disk space.
 * 
 * Requirements: 6.5
 */
export class DiskSpaceError extends StorageError {
  constructor(path: string, operation: FileOperation, cause?: Error) {
    const guidance = 'Please check that you have sufficient disk space available.';
    super(
      `Insufficient disk space for ${operation} operation on: ${path}. ${guidance}`,
      path,
      operation,
      cause
    );
    this.name = 'DiskSpaceError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DiskSpaceError);
    }
  }
}

/**
 * Error thrown when a path exceeds the maximum allowed length
 * 
 * Windows has a 260 character MAX_PATH limit.
 */
export class PathTooLongError extends StorageError {
  constructor(path: string, operation: FileOperation, cause?: Error) {
    super(
      `Path exceeds maximum length: ${path}. Consider using a shorter path or filename.`,
      path,
      operation,
      cause
    );
    this.name = 'PathTooLongError';

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PathTooLongError);
    }
  }
}

/**
 * Error thrown when a security violation is detected
 * 
 * Used for path traversal attempts and other security-related issues.
 * 
 * Requirements: 10.8, 11.6, 15.1, 15.4
 * 
 * @example
 * if (path.includes('..')) {
 *   throw new SecurityError('Path traversal not allowed', path);
 * }
 */
export class SecurityError extends Error {
  public readonly inputPath: string;

  constructor(message: string, inputPath: string) {
    super(message);
    this.name = 'SecurityError';
    this.inputPath = inputPath;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SecurityError);
    }
  }
}
