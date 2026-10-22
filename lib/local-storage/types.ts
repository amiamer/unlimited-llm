/**
 * Type definitions for local storage services
 * 
 * This module defines interfaces for:
 * - LocalStorageService configuration and data structures
 * - LocalObsidianService configuration and data structures
 * - File format interfaces for conversations, sessions, messages, and metadata
 * - Cache-related interfaces
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.5
 */

import type { Message, ConversationSession, ObsidianNoteCall } from '../types';

// Re-export commonly used types from main types module
export type { Message, ConversationSession, ObsidianNoteCall };

// ============================================================================
// LocalStorageService Configuration
// ============================================================================

/**
 * Configuration for LocalStorageService
 * 
 * @property chatVaultPath - Base path for chat storage (from CHAT_VAULT_PATH env var)
 * @property dualWriteMode - If true, write to both local and S3 (migration safety net)
 * @property fallbackToS3 - If true, read from S3 if local file missing
 * @property retryOnLock - If true, retry on EBUSY/EPERM errors (default: true)
 * @property maxRetries - Maximum retry attempts for locked files (default: 3)
 */
export interface LocalStorageConfig {
  chatVaultPath: string;
  dualWriteMode?: boolean;
  fallbackToS3?: boolean;
  retryOnLock?: boolean;
  maxRetries?: number;
}

// ============================================================================
// LocalObsidianService Configuration
// ============================================================================

/**
 * Configuration for LocalObsidianService
 * 
 * @property vaultPath - Base path for Obsidian vault (from OBSIDIAN_VAULT_PATH env var)
 * @property notesFolder - Subfolder for notes within vault (default: "Notes")
 * @property retryOnLock - If true, retry on EBUSY/EPERM errors (default: true)
 * @property maxRetries - Maximum retry attempts for locked files (default: 3)
 */
export interface LocalObsidianConfig {
  vaultPath: string;
  notesFolder?: string;
  retryOnLock?: boolean;
  maxRetries?: number;
}

/**
 * YAML frontmatter structure for Obsidian notes
 */
export interface ObsidianNoteFrontmatter {
  title: string;
  created: string;  // ISO timestamp
  modified: string; // ISO timestamp
  tags?: string[];
}

/**
 * Parsed Obsidian note with frontmatter and content separated
 */
export interface ParsedObsidianNote {
  frontmatter: ObsidianNoteFrontmatter;
  content: string;
}

// ============================================================================
// File Format Interfaces
// ============================================================================

/**
 * Conversation file format stored at {CHAT_VAULT_PATH}/conversations/{timestamp}.json
 * Maintains backward compatibility with existing S3 format
 */
export interface ConversationFile {
  messages: Message[];
}

/**
 * Session file format stored at {CHAT_VAULT_PATH}/chat-sessions/{sessionId}.json
 * Maintains backward compatibility with existing S3 format
 */
export interface SessionFile {
  sessionId: string;
  title: string;
  messages: Message[];
  lastActivity: string;
  /** Summary of older messages that were compacted out of the session */
  summary?: string;
}

/**
 * Metadata file format stored at {CHAT_VAULT_PATH}/chat-messages/metadata/{sessionId}.json
 * Used for storing tags and other session metadata
 */
export interface MetadataFile {
  sessionId: string;
  tags: string[];
  updatedAt: string;
}

/**
 * Parsed individual message from a message file
 */
export interface ParsedMessage {
  role: 'user' | 'assistant';
  timestamp: string;
  content: string;
  type?: string;
}

/**
 * Parsed conversation file header information
 */
export interface ConversationFileHeader {
  conversationId: string;
  type: string;
  messageCount: number;
  conversationStart: string;
  conversationEnd: string;
}

// ============================================================================
// Cache Interfaces
// ============================================================================

/**
 * Metadata used for cache invalidation
 * Uses content hash instead of mtime for reliability
 */
export interface CacheMetadata {
  fileCount: number;
  contentHash: string;  // SHA-256 hash of sorted file list with sizes
}

/**
 * Cached conversation data with metadata for invalidation
 */
export interface CachedData {
  conversations: ConversationSession[];
  metadata: CacheMetadata;
  timestamp: number;  // Cache creation time (ms since epoch)
}

/**
 * File info used for computing content hash
 */
export interface FileInfo {
  path: string;
  size: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * File operation types for error context
 */
export type FileOperation = 'read' | 'write' | 'delete' | 'mkdir';

/**
 * Error codes that trigger retry logic
 */
export type RetryableErrorCode = 'EBUSY' | 'EPERM';

/**
 * Common file system error codes
 */
export type FileSystemErrorCode = 
  | 'ENOENT'      // File not found
  | 'EACCES'      // Permission denied
  | 'ENOSPC'      // No space left on device
  | 'ENAMETOOLONG' // Filename too long
  | 'EBUSY'       // Resource busy
  | 'EPERM';      // Operation not permitted

// ============================================================================
// Service Response Types
// ============================================================================

/**
 * Result of a deletion operation
 */
export interface DeletionResult {
  deletedFiles: number;
  deletedMetadata: boolean;
}

/**
 * Result of a storage operation
 */
export interface StorageResult {
  success: boolean;
  path: string;
  timestamp: string;
}
