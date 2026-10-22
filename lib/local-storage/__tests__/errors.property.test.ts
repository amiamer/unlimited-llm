/**
 * Property-Based Tests for Error Classes
 * Feature: local-storage-migration
 * 
 * Tests Property 19: Error Messages Include Context
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  StorageError,
  ConfigurationError,
  VaultNotFoundError,
  FileLockError,
  PermissionError,
  DiskSpaceError,
  PathTooLongError,
} from '../errors';
import type { FileOperation } from '../types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to check if a string contains valid UTF-16 (no unpaired surrogates)
 */
function isValidUTF16(s: string): boolean {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Arbitraries (Generators)
// ============================================================================

/**
 * Arbitrary for generating valid file paths
 * Creates paths that are valid UTF-16 and non-empty
 */
const validFilePath = fc.string({ minLength: 1, maxLength: 200 })
  .filter(s => isValidUTF16(s) && s.trim().length > 0)
  .map(s => s.trim());

/**
 * Arbitrary for generating valid error messages
 * Creates messages that are valid UTF-16 and non-empty
 */
const validErrorMessage = fc.string({ minLength: 1, maxLength: 500 })
  .filter(s => isValidUTF16(s) && s.trim().length > 0)
  .map(s => s.trim());

/**
 * Arbitrary for generating valid environment variable names
 * Creates names that are valid UTF-16 and non-empty
 */
const validEnvVarName = fc.stringMatching(/^[A-Z][A-Z0-9_]*$/)
  .filter(s => s.length >= 1 && s.length <= 50);

/**
 * Arbitrary for generating file operations
 */
const fileOperation: fc.Arbitrary<FileOperation> = fc.constantFrom('read', 'write', 'delete', 'mkdir');

/**
 * Arbitrary for generating cause errors
 */
const causeError = fc.option(
  validErrorMessage.map(msg => new Error(msg)),
  { nil: undefined }
);

// ============================================================================
// Property Tests
// ============================================================================

describe('Error Classes Property-Based Tests', () => {
  describe('Property 19: Error Messages Include Context', () => {
    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * *For any* file operation failure (read, write, or directory creation),
     * the error message SHALL include the file path and a description of the failure reason.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('StorageError', () => {
      it('includes file path in error message for any valid path', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Error should have the path property set correctly
              expect(error.path).toBe(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes operation type for any file operation', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Error should have the operation property set correctly
              expect(error.operation).toBe(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes failure description in message for any valid message', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Error message should contain the provided message
              expect(error.message).toBe(message);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('preserves cause error when provided', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            validErrorMessage.map(msg => new Error(msg)),
            (message: string, path: string, operation: FileOperation, cause: Error) => {
              const error = new StorageError(message, path, operation, cause);

              // Cause should be preserved
              expect(error.cause).toBe(cause);
              expect(error.cause?.message).toBe(cause.message);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Error name should be 'StorageError'
              expect(error.name).toBe('StorageError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of Error', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            fileOperation,
            causeError,
            (message: string, path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new StorageError(message, path, operation, cause);

              // Should be an instance of Error
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * ConfigurationError should include the variable name in the error message.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('ConfigurationError', () => {
      it('includes variable name in error message', () => {
        fc.assert(
          fc.property(
            validEnvVarName,
            (variableName: string) => {
              const error = new ConfigurationError(variableName);

              // Error message should include the variable name
              expect(error.message).toContain(variableName);
              expect(error.message).toContain('Missing required environment variable');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('stores variable name property', () => {
        fc.assert(
          fc.property(
            validEnvVarName,
            (variableName: string) => {
              const error = new ConfigurationError(variableName);

              // Variable name should be stored
              expect(error.variableName).toBe(variableName);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validEnvVarName,
            (variableName: string) => {
              const error = new ConfigurationError(variableName);

              // Error name should be 'ConfigurationError'
              expect(error.name).toBe('ConfigurationError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validEnvVarName,
            (variableName: string) => {
              const error = new ConfigurationError(variableName);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of Error', () => {
        fc.assert(
          fc.property(
            validEnvVarName,
            (variableName: string) => {
              const error = new ConfigurationError(variableName);

              // Should be an instance of Error
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(ConfigurationError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * VaultNotFoundError should include the path in the error message.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('VaultNotFoundError', () => {
      it('includes path in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Error message should include the path
              expect(error.message).toContain(path);
              expect(error.message).toContain('Vault directory not found');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('stores path property', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Path should be stored
              expect(error.path).toBe(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has operation set to read', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Operation should be 'read'
              expect(error.operation).toBe('read');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Error name should be 'VaultNotFoundError'
              expect(error.name).toBe('VaultNotFoundError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of StorageError', () => {
        fc.assert(
          fc.property(
            validFilePath,
            (path: string) => {
              const error = new VaultNotFoundError(path);

              // Should be an instance of StorageError
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
              expect(error).toBeInstanceOf(VaultNotFoundError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * FileLockError should include the path and message in the error.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('FileLockError', () => {
      it('includes path in error', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Path should be stored
              expect(error.path).toBe(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes message in error', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Message should be stored
              expect(error.message).toBe(message);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has operation set to write', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Operation should be 'write'
              expect(error.operation).toBe('write');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('preserves cause error when provided', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            validErrorMessage.map(msg => new Error(msg)),
            (message: string, path: string, cause: Error) => {
              const error = new FileLockError(message, path, cause);

              // Cause should be preserved
              expect(error.cause).toBe(cause);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Error name should be 'FileLockError'
              expect(error.name).toBe('FileLockError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of StorageError', () => {
        fc.assert(
          fc.property(
            validErrorMessage,
            validFilePath,
            causeError,
            (message: string, path: string, cause: Error | undefined) => {
              const error = new FileLockError(message, path, cause);

              // Should be an instance of StorageError
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
              expect(error).toBeInstanceOf(FileLockError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * PermissionError should include the path, operation, and guidance in the error message.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('PermissionError', () => {
      it('includes path in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Error message should include the path
              expect(error.message).toContain(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes operation in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Error message should include the operation
              expect(error.message).toContain(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes permission guidance in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Error message should include guidance about permissions
              expect(error.message).toContain('permission');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('stores path and operation properties', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Properties should be stored
              expect(error.path).toBe(path);
              expect(error.operation).toBe(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('preserves cause error when provided', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            validErrorMessage.map(msg => new Error(msg)),
            (path: string, operation: FileOperation, cause: Error) => {
              const error = new PermissionError(path, operation, cause);

              // Cause should be preserved
              expect(error.cause).toBe(cause);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Error name should be 'PermissionError'
              expect(error.name).toBe('PermissionError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of StorageError', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PermissionError(path, operation, cause);

              // Should be an instance of StorageError
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
              expect(error).toBeInstanceOf(PermissionError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * DiskSpaceError should include the path, operation, and guidance in the error message.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('DiskSpaceError', () => {
      it('includes path in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Error message should include the path
              expect(error.message).toContain(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes operation in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Error message should include the operation
              expect(error.message).toContain(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes disk space guidance in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Error message should include guidance about disk space
              expect(error.message).toContain('disk space');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('stores path and operation properties', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Properties should be stored
              expect(error.path).toBe(path);
              expect(error.operation).toBe(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('preserves cause error when provided', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            validErrorMessage.map(msg => new Error(msg)),
            (path: string, operation: FileOperation, cause: Error) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Cause should be preserved
              expect(error.cause).toBe(cause);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Error name should be 'DiskSpaceError'
              expect(error.name).toBe('DiskSpaceError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of StorageError', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new DiskSpaceError(path, operation, cause);

              // Should be an instance of StorageError
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
              expect(error).toBeInstanceOf(DiskSpaceError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * Feature: local-storage-migration, Property 19: Error Messages Include Context
     * 
     * PathTooLongError should include the path, operation, and guidance in the error message.
     * 
     * **Validates: Requirements 6.1, 6.2, 6.3**
     */
    describe('PathTooLongError', () => {
      it('includes path in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Error message should include the path
              expect(error.message).toContain(path);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('includes path length guidance in error message', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Error message should include guidance about path length
              expect(error.message).toContain('maximum length');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('stores path and operation properties', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Properties should be stored
              expect(error.path).toBe(path);
              expect(error.operation).toBe(operation);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('preserves cause error when provided', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            validErrorMessage.map(msg => new Error(msg)),
            (path: string, operation: FileOperation, cause: Error) => {
              const error = new PathTooLongError(path, operation, cause);

              // Cause should be preserved
              expect(error.cause).toBe(cause);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('has correct error name', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Error name should be 'PathTooLongError'
              expect(error.name).toBe('PathTooLongError');
            }
          ),
          { numRuns: 100 }
        );
      });

      it('captures stack trace', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Stack trace should be captured
              expect(error.stack).toBeDefined();
              expect(typeof error.stack).toBe('string');
              expect(error.stack!.length).toBeGreaterThan(0);
            }
          ),
          { numRuns: 100 }
        );
      });

      it('is an instance of StorageError', () => {
        fc.assert(
          fc.property(
            validFilePath,
            fileOperation,
            causeError,
            (path: string, operation: FileOperation, cause: Error | undefined) => {
              const error = new PathTooLongError(path, operation, cause);

              // Should be an instance of StorageError
              expect(error).toBeInstanceOf(Error);
              expect(error).toBeInstanceOf(StorageError);
              expect(error).toBeInstanceOf(PathTooLongError);
            }
          ),
          { numRuns: 100 }
        );
      });
    });
  });
});
