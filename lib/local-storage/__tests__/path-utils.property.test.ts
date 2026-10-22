/**
 * Property-Based Tests for Path Utilities
 * Feature: local-storage-migration
 * 
 * Tests Property 13: Filename Sanitization and Length
 * Tests Property 14: Path Normalization
 * 
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  sanitizeFilename,
  truncateFilename,
  normalizePath,
  isValidWindowsFilename,
} from '../path-utils';

/**
 * Characters that are invalid in Windows filenames
 */
const WINDOWS_INVALID_CHARS_REGEX = /[<>:"|?*\\/]/;

/**
 * Maximum filename length as defined in path-utils
 */
const MAX_FILENAME_LENGTH = 200;

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

/**
 * Arbitrary for generating valid UTF-16 strings
 * Filters out invalid surrogate pairs
 */
const validUTF16String = fc.string().filter(isValidUTF16);

/**
 * Arbitrary for generating non-empty valid UTF-16 strings
 */
const nonEmptyValidUTF16String = fc.string({ minLength: 1 }).filter(isValidUTF16);

describe('Path Utilities Property-Based Tests', () => {
  describe('Property 13: Filename Sanitization and Length', () => {
    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * *For any* valid UTF-16 string, sanitizing it SHALL produce a valid Windows filename that:
     * 1. Contains no invalid characters (`:`, `<`, `>`, `"`, `|`, `?`, `*`, `\`, `/`)
     * 2. Has length ≤ 200 characters (with hash suffix if truncated)
     * 3. Can be created and read on Windows filesystem
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('sanitized filenames contain no invalid Windows characters', () => {
      fc.assert(
        fc.property(validUTF16String, (input: string) => {
          const sanitized = sanitizeFilename(input);
          
          // Result should not contain any invalid Windows filename characters
          const hasNoInvalidChars = !WINDOWS_INVALID_CHARS_REGEX.test(sanitized);
          
          expect(hasNoInvalidChars).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Sanitized filenames should always be non-empty (returns 'unnamed' for empty/whitespace input)
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('sanitized filenames are never empty', () => {
      fc.assert(
        fc.property(validUTF16String, (input: string) => {
          const sanitized = sanitizeFilename(input);
          
          // Result should never be empty
          expect(sanitized.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Truncated filenames should respect the maximum length limit
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('truncated filenames respect maximum length limit', () => {
      fc.assert(
        fc.property(
          nonEmptyValidUTF16String,
          fc.integer({ min: 10, max: 300 }), // Test various max lengths
          (input: string, maxLength: number) => {
            const truncated = truncateFilename(input, maxLength);
            
            // Result should not exceed the specified max length
            expect(truncated.length).toBeLessThanOrEqual(maxLength);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Combined sanitization and truncation produces valid Windows filenames
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('sanitize + truncate produces valid Windows filenames within length limit', () => {
      fc.assert(
        fc.property(validUTF16String, (input: string) => {
          const sanitized = sanitizeFilename(input);
          const truncated = truncateFilename(sanitized, MAX_FILENAME_LENGTH);
          
          // Result should be a valid Windows filename
          const hasNoInvalidChars = !WINDOWS_INVALID_CHARS_REGEX.test(truncated);
          const hasValidLength = truncated.length <= MAX_FILENAME_LENGTH;
          const isNonEmpty = truncated.length > 0;
          
          expect(hasNoInvalidChars).toBe(true);
          expect(hasValidLength).toBe(true);
          expect(isNonEmpty).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Short filenames are not modified by truncation
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('short filenames are preserved without modification', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(isValidUTF16),
          (input: string) => {
            // Only test strings that are already valid filenames (no invalid chars)
            const sanitized = sanitizeFilename(input);
            
            if (sanitized.length <= MAX_FILENAME_LENGTH) {
              const truncated = truncateFilename(sanitized, MAX_FILENAME_LENGTH);
              
              // Short filenames should not be modified
              expect(truncated).toBe(sanitized);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Truncation preserves uniqueness via hash suffix
     * Different long inputs should produce different truncated outputs
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('truncation preserves uniqueness for different long inputs', () => {
      fc.assert(
        fc.property(
          // Generate two different long strings
          fc.string({ minLength: 250, maxLength: 300 }).filter(isValidUTF16),
          fc.string({ minLength: 250, maxLength: 300 }).filter(isValidUTF16),
          (input1: string, input2: string) => {
            // Skip if inputs are the same
            fc.pre(input1 !== input2);
            
            const truncated1 = truncateFilename(input1, MAX_FILENAME_LENGTH);
            const truncated2 = truncateFilename(input2, MAX_FILENAME_LENGTH);
            
            // Different inputs should produce different outputs (due to hash suffix)
            expect(truncated1).not.toBe(truncated2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 13: Filename Sanitization and Length
     * 
     * Sanitized filenames should not have trailing dots or spaces
     * (Windows doesn't allow these)
     * 
     * **Validates: Requirements 7.3, 7.4**
     */
    it('sanitized filenames have no trailing dots or spaces', () => {
      fc.assert(
        fc.property(validUTF16String, (input: string) => {
          const sanitized = sanitizeFilename(input);
          
          // Result should not end with dot or space
          const noTrailingDot = !sanitized.endsWith('.');
          const noTrailingSpace = !sanitized.endsWith(' ');
          
          expect(noTrailingDot).toBe(true);
          expect(noTrailingSpace).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 14: Path Normalization', () => {
    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * *For any* path string with mixed forward slashes, backslashes, or redundant separators,
     * normalizing it SHALL produce a consistent path that resolves to the same location.
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('normalization produces consistent separators', () => {
      fc.assert(
        fc.property(
          // Generate path-like strings with mixed separators
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => isValidUTF16(s) && s.length > 0),
            { minLength: 1, maxLength: 5 }
          ),
          fc.constantFrom('/', '\\', '//', '\\\\'),
          (segments: string[], separator: string) => {
            // Create a path with the given separator
            const inputPath = segments.join(separator);
            const normalized = normalizePath(inputPath);

            // A leading UNC prefix (\\server\share) legitimately begins with two
            // separators on Windows — path.normalize preserves it by design, and
            // collapsing it would break network paths. Strip one leading
            // separator run before asserting there are no *redundant* interior
            // separators.
            const body = normalized.replace(/^[\\/]{2}/, '');
            const hasNoDoubleForwardSlash = !body.includes('//');
            const hasNoDoubleBackslash = !body.includes('\\\\');

            expect(hasNoDoubleForwardSlash).toBe(true);
            expect(hasNoDoubleBackslash).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * Normalizing the same logical path with different separator styles
     * should produce equivalent results
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('different separator styles normalize to same result', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter(s => s.length > 0 && s.length <= 20),
            { minLength: 1, maxLength: 5 }
          ),
          (segments: string[]) => {
            // Create paths with different separators
            const forwardSlashPath = segments.join('/');
            const backslashPath = segments.join('\\');
            const mixedPath = segments.join('/\\');
            
            const normalizedForward = normalizePath(forwardSlashPath);
            const normalizedBackslash = normalizePath(backslashPath);
            const normalizedMixed = normalizePath(mixedPath);
            
            // All should normalize to the same result
            expect(normalizedForward).toBe(normalizedBackslash);
            expect(normalizedBackslash).toBe(normalizedMixed);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * Normalization is idempotent - normalizing an already normalized path
     * should produce the same result
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('normalization is idempotent', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter(s => s.length > 0 && s.length <= 20),
            { minLength: 1, maxLength: 5 }
          ),
          fc.constantFrom('/', '\\', '//', '\\\\', '/\\', '\\/'),
          (segments: string[], separator: string) => {
            const inputPath = segments.join(separator);
            
            const normalizedOnce = normalizePath(inputPath);
            const normalizedTwice = normalizePath(normalizedOnce);
            
            // Normalizing twice should give the same result as normalizing once
            expect(normalizedTwice).toBe(normalizedOnce);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * Empty paths normalize to empty strings
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('empty paths normalize to empty strings', () => {
      const normalized = normalizePath('');
      expect(normalized).toBe('');
    });

    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * Paths with redundant separators are cleaned up
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('redundant separators are removed', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter(s => s.length > 0 && s.length <= 20),
            { minLength: 2, maxLength: 5 }
          ),
          fc.integer({ min: 2, max: 5 }),
          (segments: string[], numSeparators: number) => {
            // Create path with redundant separators
            const redundantSep = '/'.repeat(numSeparators);
            const inputPath = segments.join(redundantSep);
            
            const normalized = normalizePath(inputPath);
            
            // Count consecutive separators in normalized path
            const consecutiveSeps = normalized.match(/[/\\]{2,}/g);
            
            // Should have no consecutive separators (except for UNC paths on Windows)
            // On Windows, UNC paths start with \\ which is valid
            if (consecutiveSeps) {
              // Only allow \\ at the start for UNC paths
              consecutiveSeps.forEach((match, index) => {
                if (index === 0 && normalized.startsWith('\\\\')) {
                  // UNC path prefix is allowed
                  return;
                }
                // No other consecutive separators should exist
                expect(match).toBeUndefined();
              });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 14: Path Normalization
     * 
     * Path segments are preserved after normalization
     * 
     * **Validates: Requirements 7.1, 7.2, 7.5**
     */
    it('path segments are preserved after normalization', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter(s => s.length > 0 && s.length <= 20),
            { minLength: 1, maxLength: 5 }
          ),
          (segments: string[]) => {
            const inputPath = segments.join('/');
            const normalized = normalizePath(inputPath);
            
            // Each segment should still be present in the normalized path
            segments.forEach(segment => {
              expect(normalized).toContain(segment);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
