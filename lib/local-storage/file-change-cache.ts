/**
 * File change cache for efficient conversation retrieval
 * 
 * This module provides caching with content-based change detection using
 * SHA-256 hash of file paths and sizes. This approach is more reliable than
 * mtime-based detection which can change due to NTP sync, backup software,
 * or git operations.
 * 
 * Requirements: 2.6, 2.7, 3.6
 */

import { CacheMetadata, CachedData, ConversationSession, FileInfo } from './types';
import { computeContentHash } from './file-utils';

/**
 * Default cache duration in milliseconds (5 minutes)
 */
const DEFAULT_CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * FileChangeCache handles caching of conversation data with content-based
 * change detection.
 * 
 * The cache uses SHA-256 hash of sorted file paths + sizes for change detection,
 * which is more reliable than mtime because:
 * - mtime can change due to NTP sync, backup software, or git operations
 * - Content hash only changes when actual files are added/removed/resized
 * - Hash computation is fast (only reads directory listing, not file contents)
 * 
 * @example
 * const cache = new FileChangeCache();
 * 
 * // Check if cache is valid
 * const currentMetadata = { fileCount: 10, contentHash: 'abc123...' };
 * if (!cache.hasChanged(currentMetadata)) {
 *   const conversations = cache.getCachedConversations();
 *   // Use cached data
 * } else {
 *   // Fetch fresh data and update cache
 *   const freshData = await fetchConversations();
 *   cache.setCachedConversations(freshData, currentMetadata);
 * }
 */
export class FileChangeCache {
  private cache: CachedData | null = null;
  private readonly cacheDurationMs: number;

  /**
   * Creates a new FileChangeCache instance
   * 
   * @param cacheDurationMs - Optional cache duration in milliseconds (default: 5 minutes)
   */
  constructor(cacheDurationMs?: number) {
    this.cacheDurationMs = cacheDurationMs ?? DEFAULT_CACHE_DURATION_MS;
  }

  /**
   * Computes a content hash from a list of files
   * 
   * This is a convenience method that delegates to the computeContentHash
   * function from file-utils.ts.
   * 
   * @param files - Array of file info objects with path and size
   * @returns A hex-encoded SHA-256 hash string
   */
  computeContentHash(files: FileInfo[]): string {
    return computeContentHash(files);
  }

  /**
   * Checks if the cache has changed based on current metadata
   * 
   * The cache is considered changed (invalid) if:
   * 1. No cache exists
   * 2. Cache has expired (exceeded cacheDurationMs)
   * 3. File count has changed
   * 4. Content hash has changed (files added/removed/resized)
   * 
   * @param currentMetadata - The current metadata to compare against cached metadata
   * @returns true if the cache has changed and needs refresh, false if cache is valid
   */
  hasChanged(currentMetadata: CacheMetadata): boolean {
    // No cache exists
    if (this.cache === null) {
      return true;
    }

    // Check if cache has expired
    const now = Date.now();
    if (now - this.cache.timestamp > this.cacheDurationMs) {
      return true;
    }

    // Check if file count has changed
    if (this.cache.metadata.fileCount !== currentMetadata.fileCount) {
      return true;
    }

    // Check if content hash has changed
    if (this.cache.metadata.contentHash !== currentMetadata.contentHash) {
      return true;
    }

    // Cache is still valid
    return false;
  }

  /**
   * Gets the cached conversations if available
   * 
   * Note: This method does NOT check if the cache is valid. Use hasChanged()
   * first to verify the cache is still valid before using this method.
   * 
   * @returns The cached conversations array, or null if no cache exists
   */
  getCachedConversations(): ConversationSession[] | null {
    if (this.cache === null) {
      return null;
    }
    return this.cache.conversations;
  }

  /**
   * Sets the cached conversations with metadata
   * 
   * @param conversations - The conversations to cache
   * @param metadata - The metadata for cache invalidation
   */
  setCachedConversations(
    conversations: ConversationSession[],
    metadata: CacheMetadata
  ): void {
    this.cache = {
      conversations,
      metadata,
      timestamp: Date.now()
    };
  }

  /**
   * Gets the current cache metadata if available
   * 
   * @returns The cached metadata, or null if no cache exists
   */
  getCacheMetadata(): CacheMetadata | null {
    if (this.cache === null) {
      return null;
    }
    return this.cache.metadata;
  }

  /**
   * Clears the cache, forcing a refresh on next access
   * 
   * This should be called after operations that modify the storage:
   * - Storing new conversations
   * - Deleting conversations
   * - Updating tags
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Gets the cache timestamp if available
   * 
   * @returns The cache creation timestamp in milliseconds, or null if no cache exists
   */
  getCacheTimestamp(): number | null {
    if (this.cache === null) {
      return null;
    }
    return this.cache.timestamp;
  }

  /**
   * Checks if the cache exists (regardless of validity)
   * 
   * @returns true if cache exists, false otherwise
   */
  hasCache(): boolean {
    return this.cache !== null;
  }

  /**
   * Gets the configured cache duration
   * 
   * @returns The cache duration in milliseconds
   */
  getCacheDuration(): number {
    return this.cacheDurationMs;
  }
}
