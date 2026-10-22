/**
 * Local Storage Module - Barrel Export
 * 
 * This module provides a clean public API for the local storage services,
 * enabling fully offline operation for chat storage and Obsidian integration.
 * 
 * The exports are designed as drop-in replacements for the S3-based services:
 * - LocalStorageService replaces storage-service.ts and ChatHistoryService
 * - LocalObsidianService replaces obsidian-service.ts (webhook-based)
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

// ============================================================================
// LocalStorageService Exports
// ============================================================================

/**
 * LocalStorageService - Local file system storage for chat conversations
 * 
 * Export the class for testing/custom instances, and the singleton getter
 * for production use.
 */
export {
  LocalStorageService,
  getLocalStorageService,
  resetLocalStorageService,
  // Directory constants for external use
  CONVERSATIONS_DIR,
  CHAT_SESSIONS_DIR,
  CHAT_MESSAGES_DIR,
  METADATA_DIR,
} from './local-storage-service';

/**
 * Singleton export for drop-in replacement
 * 
 * Usage:
 * ```typescript
 * import { localStorageService } from './lib/local-storage';
 * 
 * // Store a conversation
 * await localStorageService.storeConversation(messages);
 * 
 * // Get all conversations
 * const conversations = await localStorageService.getAllConversations();
 * ```
 */
export { getLocalStorageService as localStorageService } from './local-storage-service';

// ============================================================================
// LocalObsidianService Exports
// ============================================================================

/**
 * LocalObsidianService - Local file system Obsidian vault integration
 * 
 * Export the class for testing/custom instances, and the singleton object
 * for production use with getInstance pattern.
 */
export {
  LocalObsidianService,
  localObsidianService,
  // Frontmatter utilities for external use
  parseFrontmatter,
  generateFrontmatter,
} from './local-obsidian-service';

export type { SearchResult } from './local-obsidian-service';

// ============================================================================
// Type Exports
// ============================================================================

/**
 * All types from the types module
 */
export type {
  // Configuration types
  LocalStorageConfig,
  LocalObsidianConfig,
  
  // Obsidian types
  ObsidianNoteFrontmatter,
  ParsedObsidianNote,
  
  // File format types
  ConversationFile,
  SessionFile,
  MetadataFile,
  ParsedMessage,
  ConversationFileHeader,
  
  // Cache types
  CacheMetadata,
  CachedData,
  FileInfo,
  
  // Error types
  FileOperation,
  RetryableErrorCode,
  FileSystemErrorCode,
  
  // Response types
  DeletionResult,
  StorageResult,
  
  // Re-exported from main types
  Message,
  ConversationSession,
  ObsidianNoteCall,
} from './types';

// ============================================================================
// Error Class Exports
// ============================================================================

/**
 * All error classes for handling storage-related errors
 */
export {
  StorageError,
  ConfigurationError,
  VaultNotFoundError,
  FileLockError,
  PermissionError,
  DiskSpaceError,
  PathTooLongError,
  SecurityError,
} from './errors';

// ============================================================================
// Utility Exports (for advanced use cases)
// ============================================================================

/**
 * File utilities - useful for custom implementations or testing
 */
export {
  atomicWrite,
  retryWithBackoff,
  ensureDirectory,
  computeContentHash,
  readFileWithRetry,
  writeFileWithRetry,
  deleteFileWithRetry,
  fileExists,
  directoryExists,
  getFileStats,
  listDirectory,
  getDirectoryFileInfo,
} from './file-utils';

/**
 * Path utilities - useful for filename sanitization and path handling
 */
export {
  sanitizeFilename,
  truncateFilename,
  sanitizeTimestamp,
  normalizePath,
  joinPath,
  isValidWindowsFilename,
  getExtension,
  removeExtension,
  validatePathSecurity,
  escapeShellArg,
  containsPathTraversal,
} from './path-utils';

/**
 * FileChangeCache - for custom caching implementations
 */
export { FileChangeCache } from './file-change-cache';
