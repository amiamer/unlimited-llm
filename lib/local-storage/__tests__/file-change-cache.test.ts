/**
 * Unit tests for FileChangeCache
 * 
 * Tests the caching functionality including:
 * - Cache creation and retrieval
 * - Change detection via content hash comparison
 * - Cache expiration
 * - Cache clearing
 * 
 * Requirements: 2.6, 2.7, 3.6
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileChangeCache } from '../file-change-cache';
import { CacheMetadata, ConversationSession } from '../types';

describe('FileChangeCache', () => {
  let cache: FileChangeCache;

  beforeEach(() => {
    cache = new FileChangeCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create mock conversations
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

  // Helper to create mock metadata
  const createMockMetadata = (fileCount: number, hash: string): CacheMetadata => ({
    fileCount,
    contentHash: hash
  });

  describe('constructor', () => {
    it('should create cache with default duration', () => {
      const defaultCache = new FileChangeCache();
      expect(defaultCache.getCacheDuration()).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should create cache with custom duration', () => {
      const customCache = new FileChangeCache(10000);
      expect(customCache.getCacheDuration()).toBe(10000);
    });
  });

  describe('hasCache', () => {
    it('should return false when no cache exists', () => {
      expect(cache.hasCache()).toBe(false);
    });

    it('should return true after setting cache', () => {
      const conversations = createMockConversations(1);
      const metadata = createMockMetadata(1, 'hash123');
      cache.setCachedConversations(conversations, metadata);
      expect(cache.hasCache()).toBe(true);
    });
  });

  describe('setCachedConversations / getCachedConversations', () => {
    it('should store and retrieve conversations', () => {
      const conversations = createMockConversations(3);
      const metadata = createMockMetadata(3, 'hash123');
      
      cache.setCachedConversations(conversations, metadata);
      
      const retrieved = cache.getCachedConversations();
      expect(retrieved).toEqual(conversations);
    });

    it('should return null when no cache exists', () => {
      expect(cache.getCachedConversations()).toBeNull();
    });

    it('should store timestamp when setting cache', () => {
      const now = Date.now();
      vi.setSystemTime(now);
      
      const conversations = createMockConversations(1);
      const metadata = createMockMetadata(1, 'hash123');
      cache.setCachedConversations(conversations, metadata);
      
      expect(cache.getCacheTimestamp()).toBe(now);
    });
  });

  describe('getCacheMetadata', () => {
    it('should return null when no cache exists', () => {
      expect(cache.getCacheMetadata()).toBeNull();
    });

    it('should return metadata after setting cache', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash456');
      
      cache.setCachedConversations(conversations, metadata);
      
      expect(cache.getCacheMetadata()).toEqual(metadata);
    });
  });

  describe('hasChanged', () => {
    it('should return true when no cache exists', () => {
      const metadata = createMockMetadata(1, 'hash123');
      expect(cache.hasChanged(metadata)).toBe(true);
    });

    it('should return false when metadata matches', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash123');
      
      cache.setCachedConversations(conversations, metadata);
      
      expect(cache.hasChanged(metadata)).toBe(false);
    });

    it('should return true when file count changes', () => {
      const conversations = createMockConversations(2);
      const originalMetadata = createMockMetadata(2, 'hash123');
      
      cache.setCachedConversations(conversations, originalMetadata);
      
      const newMetadata = createMockMetadata(3, 'hash123'); // Different file count
      expect(cache.hasChanged(newMetadata)).toBe(true);
    });

    it('should return true when content hash changes', () => {
      const conversations = createMockConversations(2);
      const originalMetadata = createMockMetadata(2, 'hash123');
      
      cache.setCachedConversations(conversations, originalMetadata);
      
      const newMetadata = createMockMetadata(2, 'hash456'); // Different hash
      expect(cache.hasChanged(newMetadata)).toBe(true);
    });

    it('should return true when cache has expired', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash123');
      
      const now = Date.now();
      vi.setSystemTime(now);
      cache.setCachedConversations(conversations, metadata);
      
      // Advance time past cache duration (default 5 minutes)
      vi.setSystemTime(now + 6 * 60 * 1000);
      
      expect(cache.hasChanged(metadata)).toBe(true);
    });

    it('should return false when cache has not expired', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash123');
      
      const now = Date.now();
      vi.setSystemTime(now);
      cache.setCachedConversations(conversations, metadata);
      
      // Advance time but stay within cache duration
      vi.setSystemTime(now + 4 * 60 * 1000);
      
      expect(cache.hasChanged(metadata)).toBe(false);
    });

    it('should respect custom cache duration', () => {
      const customCache = new FileChangeCache(1000); // 1 second
      const conversations = createMockConversations(1);
      const metadata = createMockMetadata(1, 'hash123');
      
      const now = Date.now();
      vi.setSystemTime(now);
      customCache.setCachedConversations(conversations, metadata);
      
      // Still valid at 500ms
      vi.setSystemTime(now + 500);
      expect(customCache.hasChanged(metadata)).toBe(false);
      
      // Expired at 1500ms
      vi.setSystemTime(now + 1500);
      expect(customCache.hasChanged(metadata)).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash123');
      
      cache.setCachedConversations(conversations, metadata);
      expect(cache.hasCache()).toBe(true);
      
      cache.clearCache();
      
      expect(cache.hasCache()).toBe(false);
      expect(cache.getCachedConversations()).toBeNull();
      expect(cache.getCacheMetadata()).toBeNull();
      expect(cache.getCacheTimestamp()).toBeNull();
    });

    it('should cause hasChanged to return true after clearing', () => {
      const conversations = createMockConversations(2);
      const metadata = createMockMetadata(2, 'hash123');
      
      cache.setCachedConversations(conversations, metadata);
      expect(cache.hasChanged(metadata)).toBe(false);
      
      cache.clearCache();
      
      expect(cache.hasChanged(metadata)).toBe(true);
    });
  });

  describe('computeContentHash', () => {
    it('should compute hash from file list', () => {
      const files = [
        { path: '/path/to/file1.json', size: 1024 },
        { path: '/path/to/file2.json', size: 2048 }
      ];
      
      const hash = cache.computeContentHash(files);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex string length
    });

    it('should produce consistent hash for same input', () => {
      const files = [
        { path: '/path/to/file1.json', size: 1024 },
        { path: '/path/to/file2.json', size: 2048 }
      ];
      
      const hash1 = cache.computeContentHash(files);
      const hash2 = cache.computeContentHash(files);
      
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of input order', () => {
      const files1 = [
        { path: '/path/to/file1.json', size: 1024 },
        { path: '/path/to/file2.json', size: 2048 }
      ];
      
      const files2 = [
        { path: '/path/to/file2.json', size: 2048 },
        { path: '/path/to/file1.json', size: 1024 }
      ];
      
      const hash1 = cache.computeContentHash(files1);
      const hash2 = cache.computeContentHash(files2);
      
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash when file size changes', () => {
      const files1 = [
        { path: '/path/to/file1.json', size: 1024 }
      ];
      
      const files2 = [
        { path: '/path/to/file1.json', size: 2048 }
      ];
      
      const hash1 = cache.computeContentHash(files1);
      const hash2 = cache.computeContentHash(files2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when file is added', () => {
      const files1 = [
        { path: '/path/to/file1.json', size: 1024 }
      ];
      
      const files2 = [
        { path: '/path/to/file1.json', size: 1024 },
        { path: '/path/to/file2.json', size: 2048 }
      ];
      
      const hash1 = cache.computeContentHash(files1);
      const hash2 = cache.computeContentHash(files2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty file list', () => {
      const hash = cache.computeContentHash([]);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });
  });

  describe('getCacheTimestamp', () => {
    it('should return null when no cache exists', () => {
      expect(cache.getCacheTimestamp()).toBeNull();
    });

    it('should return timestamp after setting cache', () => {
      const now = 1234567890000;
      vi.setSystemTime(now);
      
      const conversations = createMockConversations(1);
      const metadata = createMockMetadata(1, 'hash123');
      cache.setCachedConversations(conversations, metadata);
      
      expect(cache.getCacheTimestamp()).toBe(now);
    });
  });
});
