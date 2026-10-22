/**
 * Property-Based Tests for FileChangeCache
 * Feature: local-storage-migration
 * 
 * Tests Property 11: Cache Change Detection (Content Hash)
 * 
 * *For any* file addition, modification (size change), or deletion in the storage directory,
 * the cache SHALL detect the change via content hash comparison and return fresh data on
 * the next retrieval.
 * 
 * **Validates: Requirements 2.6, 2.7, 3.6**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { FileChangeCache } from '../file-change-cache';
import { FileInfo, CacheMetadata, ConversationSession } from '../types';

/**
 * Arbitrary for generating valid file paths
 * Uses alphanumeric characters with common path separators
 */
const validFilePath = fc.array(
  fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter(s => s.length > 0 && s.length <= 30),
  { minLength: 1, maxLength: 5 }
).map(segments => segments.join('/') + '.json');

/**
 * Arbitrary for generating valid file sizes (positive integers)
 */
const validFileSize = fc.integer({ min: 1, max: 10_000_000 });

/**
 * Arbitrary for generating a single FileInfo object
 */
const fileInfoArb: fc.Arbitrary<FileInfo> = fc.record({
  path: validFilePath,
  size: validFileSize
});

/**
 * Arbitrary for generating a non-empty array of FileInfo objects with unique paths
 */
const fileListArb = fc.array(fileInfoArb, { minLength: 1, maxLength: 20 })
  .map(files => {
    // Ensure unique paths by using a Map
    const uniqueFiles = new Map<string, FileInfo>();
    files.forEach(f => uniqueFiles.set(f.path, f));
    return Array.from(uniqueFiles.values());
  })
  .filter(files => files.length > 0);

/**
 * Helper to create mock conversations for testing
 */
const createMockConversations = (count: number): ConversationSession[] => {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, i) => ({
    sessionId: `session-${i}`,
    messages: [
      { role: 'user' as const, content: `Message ${i}`, timestamp: now }
    ],
    startTime: now,
    endTime: now,
    messageCount: 1,
    tags: [],
    preview: `Message ${i}`.slice(0, 50)
  }));
};

describe('FileChangeCache Property-Based Tests', () => {
  let cache: FileChangeCache;

  beforeEach(() => {
    // Use a very long cache duration to avoid expiration during tests
    cache = new FileChangeCache(60 * 60 * 1000); // 1 hour
  });

  describe('Property 11: Cache Change Detection (Content Hash)', () => {
    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Any file addition changes the content hash
     * 
     * *For any* file list and any new file added to it, the content hash SHALL change.
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('any file addition changes the content hash', () => {
      fc.assert(
        fc.property(
          fileListArb,
          fileInfoArb,
          (originalFiles: FileInfo[], newFile: FileInfo) => {
            // Ensure the new file has a unique path
            const existingPaths = new Set(originalFiles.map(f => f.path));
            fc.pre(!existingPaths.has(newFile.path));

            const originalHash = cache.computeContentHash(originalFiles);
            
            // Add the new file
            const filesWithAddition = [...originalFiles, newFile];
            const newHash = cache.computeContentHash(filesWithAddition);

            // Hash should change when a file is added
            expect(newHash).not.toBe(originalHash);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Any file size modification changes the content hash
     * 
     * *For any* file in the list, changing its size SHALL change the content hash.
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('any file size modification changes the content hash', () => {
      fc.assert(
        fc.property(
          fileListArb,
          fc.nat().filter(n => n >= 0), // Index to modify
          validFileSize,
          (files: FileInfo[], indexSeed: number, newSize: number) => {
            // Select a file to modify
            const indexToModify = indexSeed % files.length;
            const originalFile = files[indexToModify];
            
            // Ensure the new size is different
            fc.pre(newSize !== originalFile.size);

            const originalHash = cache.computeContentHash(files);

            // Modify the file size
            const modifiedFiles = files.map((f, i) => 
              i === indexToModify ? { ...f, size: newSize } : f
            );
            const newHash = cache.computeContentHash(modifiedFiles);

            // Hash should change when a file size is modified
            expect(newHash).not.toBe(originalHash);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Any file deletion changes the content hash
     * 
     * *For any* file in the list, removing it SHALL change the content hash.
     * 
     * **Validates: Requirements 2.6, 2.7, 3.6**
     */
    it('any file deletion changes the content hash', () => {
      fc.assert(
        fc.property(
          fileListArb.filter(files => files.length >= 2), // Need at least 2 files to delete one
          fc.nat(),
          (files: FileInfo[], indexSeed: number) => {
            const indexToDelete = indexSeed % files.length;

            const originalHash = cache.computeContentHash(files);

            // Delete the file
            const filesAfterDeletion = files.filter((_, i) => i !== indexToDelete);
            const newHash = cache.computeContentHash(filesAfterDeletion);

            // Hash should change when a file is deleted
            expect(newHash).not.toBe(originalHash);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Same file list (regardless of order) produces same hash
     * 
     * *For any* file list, shuffling the order SHALL produce the same content hash.
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('same file list regardless of order produces same hash', () => {
      fc.assert(
        fc.property(
          fileListArb.filter(files => files.length >= 2), // Need at least 2 files to shuffle
          (files: FileInfo[]) => {
            const originalHash = cache.computeContentHash(files);

            // Shuffle the files (reverse is a simple shuffle)
            const shuffledFiles = [...files].reverse();
            const shuffledHash = cache.computeContentHash(shuffledFiles);

            // Hash should be the same regardless of order
            expect(shuffledHash).toBe(originalHash);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Random permutations produce the same hash
     * 
     * *For any* file list and any permutation of it, the content hash SHALL be identical.
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('random permutations produce the same hash', () => {
      fc.assert(
        fc.property(
          fileListArb.filter(files => files.length >= 2),
          (files: FileInfo[]) => {
            const originalHash = cache.computeContentHash(files);

            // Create multiple permutations and verify they all produce the same hash
            const permutations = [
              [...files].reverse(),
              [...files].sort((a, b) => a.path.localeCompare(b.path)),
              [...files].sort((a, b) => b.path.localeCompare(a.path)),
              [...files].sort((a, b) => a.size - b.size),
              [...files].sort((a, b) => b.size - a.size),
            ];

            permutations.forEach(permutation => {
              const permutedHash = cache.computeContentHash(permutation);
              expect(permutedHash).toBe(originalHash);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Cache correctly detects changes via hasChanged() method
     * 
     * *For any* cached state and any file change (add/modify/delete), 
     * hasChanged() SHALL return true.
     * 
     * **Validates: Requirements 2.6, 2.7, 3.6**
     */
    it('hasChanged() detects file additions', () => {
      fc.assert(
        fc.property(
          fileListArb,
          fileInfoArb,
          (originalFiles: FileInfo[], newFile: FileInfo) => {
            // Ensure the new file has a unique path
            const existingPaths = new Set(originalFiles.map(f => f.path));
            fc.pre(!existingPaths.has(newFile.path));

            // Set up cache with original files
            const originalHash = cache.computeContentHash(originalFiles);
            const originalMetadata: CacheMetadata = {
              fileCount: originalFiles.length,
              contentHash: originalHash
            };
            cache.setCachedConversations(createMockConversations(1), originalMetadata);

            // Verify cache is valid with same metadata
            expect(cache.hasChanged(originalMetadata)).toBe(false);

            // Add a file and check hasChanged
            const filesWithAddition = [...originalFiles, newFile];
            const newHash = cache.computeContentHash(filesWithAddition);
            const newMetadata: CacheMetadata = {
              fileCount: filesWithAddition.length,
              contentHash: newHash
            };

            // hasChanged should return true for the new metadata
            expect(cache.hasChanged(newMetadata)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: hasChanged() detects file size modifications
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('hasChanged() detects file size modifications', () => {
      fc.assert(
        fc.property(
          fileListArb,
          fc.nat(),
          validFileSize,
          (files: FileInfo[], indexSeed: number, newSize: number) => {
            const indexToModify = indexSeed % files.length;
            const originalFile = files[indexToModify];
            
            // Ensure the new size is different
            fc.pre(newSize !== originalFile.size);

            // Set up cache with original files
            const originalHash = cache.computeContentHash(files);
            const originalMetadata: CacheMetadata = {
              fileCount: files.length,
              contentHash: originalHash
            };
            cache.setCachedConversations(createMockConversations(1), originalMetadata);

            // Verify cache is valid with same metadata
            expect(cache.hasChanged(originalMetadata)).toBe(false);

            // Modify file size and check hasChanged
            const modifiedFiles = files.map((f, i) => 
              i === indexToModify ? { ...f, size: newSize } : f
            );
            const newHash = cache.computeContentHash(modifiedFiles);
            const newMetadata: CacheMetadata = {
              fileCount: modifiedFiles.length,
              contentHash: newHash
            };

            // hasChanged should return true for the modified metadata
            expect(cache.hasChanged(newMetadata)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: hasChanged() detects file deletions
     * 
     * **Validates: Requirements 2.6, 2.7, 3.6**
     */
    it('hasChanged() detects file deletions', () => {
      fc.assert(
        fc.property(
          fileListArb.filter(files => files.length >= 2),
          fc.nat(),
          (files: FileInfo[], indexSeed: number) => {
            const indexToDelete = indexSeed % files.length;

            // Set up cache with original files
            const originalHash = cache.computeContentHash(files);
            const originalMetadata: CacheMetadata = {
              fileCount: files.length,
              contentHash: originalHash
            };
            cache.setCachedConversations(createMockConversations(1), originalMetadata);

            // Verify cache is valid with same metadata
            expect(cache.hasChanged(originalMetadata)).toBe(false);

            // Delete file and check hasChanged
            const filesAfterDeletion = files.filter((_, i) => i !== indexToDelete);
            const newHash = cache.computeContentHash(filesAfterDeletion);
            const newMetadata: CacheMetadata = {
              fileCount: filesAfterDeletion.length,
              contentHash: newHash
            };

            // hasChanged should return true for the deleted metadata
            expect(cache.hasChanged(newMetadata)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: hasChanged() returns false for unchanged file lists (order-independent)
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('hasChanged() returns false for unchanged file lists regardless of order', () => {
      fc.assert(
        fc.property(
          fileListArb.filter(files => files.length >= 2),
          (files: FileInfo[]) => {
            // Set up cache with original files
            const originalHash = cache.computeContentHash(files);
            const originalMetadata: CacheMetadata = {
              fileCount: files.length,
              contentHash: originalHash
            };
            cache.setCachedConversations(createMockConversations(1), originalMetadata);

            // Shuffle files and compute new metadata
            const shuffledFiles = [...files].reverse();
            const shuffledHash = cache.computeContentHash(shuffledFiles);
            const shuffledMetadata: CacheMetadata = {
              fileCount: shuffledFiles.length,
              contentHash: shuffledHash
            };

            // hasChanged should return false since content is the same
            expect(cache.hasChanged(shuffledMetadata)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Content hash is deterministic
     * 
     * *For any* file list, computing the hash multiple times SHALL produce identical results.
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('content hash computation is deterministic', () => {
      fc.assert(
        fc.property(
          fileListArb,
          (files: FileInfo[]) => {
            const hash1 = cache.computeContentHash(files);
            const hash2 = cache.computeContentHash(files);
            const hash3 = cache.computeContentHash(files);

            expect(hash1).toBe(hash2);
            expect(hash2).toBe(hash3);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Empty file list produces consistent hash
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('empty file list produces consistent hash', () => {
      const emptyHash1 = cache.computeContentHash([]);
      const emptyHash2 = cache.computeContentHash([]);

      expect(emptyHash1).toBe(emptyHash2);
      expect(typeof emptyHash1).toBe('string');
      expect(emptyHash1.length).toBe(64); // SHA-256 hex length
    });

    /**
     * Feature: local-storage-migration, Property 11: Cache Change Detection (Content Hash)
     * 
     * Property: Different file lists produce different hashes (collision resistance)
     * 
     * *For any* two different file lists, they SHALL produce different content hashes
     * (with very high probability).
     * 
     * **Validates: Requirements 2.6, 2.7**
     */
    it('different file lists produce different hashes', () => {
      fc.assert(
        fc.property(
          fileListArb,
          fileListArb,
          (files1: FileInfo[], files2: FileInfo[]) => {
            // Skip if the file lists are equivalent
            const sorted1 = [...files1].sort((a, b) => a.path.localeCompare(b.path));
            const sorted2 = [...files2].sort((a, b) => a.path.localeCompare(b.path));
            
            const areEquivalent = 
              sorted1.length === sorted2.length &&
              sorted1.every((f, i) => 
                f.path === sorted2[i].path && f.size === sorted2[i].size
              );
            
            fc.pre(!areEquivalent);

            const hash1 = cache.computeContentHash(files1);
            const hash2 = cache.computeContentHash(files2);

            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
