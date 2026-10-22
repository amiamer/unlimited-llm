/**
 * Tests for barrel export (index.ts)
 * 
 * Verifies that all exports from the barrel file are accessible and correctly typed.
 */

import { describe, it, expect } from 'vitest';

// Import everything from the barrel export
import {
  // LocalStorageService exports
  LocalStorageService,
  getLocalStorageService,
  resetLocalStorageService,
  CONVERSATIONS_DIR,
  CHAT_SESSIONS_DIR,
  CHAT_MESSAGES_DIR,
  METADATA_DIR,
  localStorageService,
  
  // LocalObsidianService exports
  LocalObsidianService,
  localObsidianService,
  parseFrontmatter,
  generateFrontmatter,
  
  // Error classes
  StorageError,
  ConfigurationError,
  VaultNotFoundError,
  FileLockError,
  PermissionError,
  DiskSpaceError,
  PathTooLongError,
  
  // File utilities
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
  
  // Path utilities
  sanitizeFilename,
  truncateFilename,
  sanitizeTimestamp,
  normalizePath,
  joinPath,
  isValidWindowsFilename,
  getExtension,
  removeExtension,
  
  // FileChangeCache
  FileChangeCache,
} from '../index';

// Import types to verify they're exported
import type {
  LocalStorageConfig,
  LocalObsidianConfig,
  ObsidianNoteFrontmatter,
  ParsedObsidianNote,
  ConversationFile,
  SessionFile,
  MetadataFile,
  ParsedMessage,
  ConversationFileHeader,
  CacheMetadata,
  CachedData,
  FileInfo,
  FileOperation,
  RetryableErrorCode,
  FileSystemErrorCode,
  DeletionResult,
  StorageResult,
  Message,
  ConversationSession,
  ObsidianNoteCall,
} from '../index';

describe('Barrel Export (index.ts)', () => {
  describe('LocalStorageService exports', () => {
    it('exports LocalStorageService class', () => {
      expect(LocalStorageService).toBeDefined();
      expect(typeof LocalStorageService).toBe('function');
    });

    it('exports getLocalStorageService function', () => {
      expect(getLocalStorageService).toBeDefined();
      expect(typeof getLocalStorageService).toBe('function');
    });

    it('exports resetLocalStorageService function', () => {
      expect(resetLocalStorageService).toBeDefined();
      expect(typeof resetLocalStorageService).toBe('function');
    });

    it('exports localStorageService as alias for getLocalStorageService', () => {
      expect(localStorageService).toBeDefined();
      expect(typeof localStorageService).toBe('function');
      expect(localStorageService).toBe(getLocalStorageService);
    });

    it('exports directory constants', () => {
      expect(CONVERSATIONS_DIR).toBe('conversations');
      expect(CHAT_SESSIONS_DIR).toBe('chat-sessions');
      expect(CHAT_MESSAGES_DIR).toBe('chat-messages');
      expect(METADATA_DIR).toBe('metadata');
    });
  });

  describe('LocalObsidianService exports', () => {
    it('exports LocalObsidianService class', () => {
      expect(LocalObsidianService).toBeDefined();
      expect(typeof LocalObsidianService).toBe('function');
    });

    it('exports localObsidianService singleton object', () => {
      expect(localObsidianService).toBeDefined();
      expect(typeof localObsidianService).toBe('object');
      expect(typeof localObsidianService.getInstance).toBe('function');
      expect(typeof localObsidianService.sendNoteTask).toBe('function');
      expect(typeof localObsidianService.getVaultPath).toBe('function');
      expect(typeof localObsidianService.resetInstance).toBe('function');
    });

    it('exports parseFrontmatter function', () => {
      expect(parseFrontmatter).toBeDefined();
      expect(typeof parseFrontmatter).toBe('function');
    });

    it('exports generateFrontmatter function', () => {
      expect(generateFrontmatter).toBeDefined();
      expect(typeof generateFrontmatter).toBe('function');
    });
  });

  describe('Error class exports', () => {
    it('exports StorageError class', () => {
      expect(StorageError).toBeDefined();
      const error = new StorageError('test', '/path', 'read');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('StorageError');
    });

    it('exports ConfigurationError class', () => {
      expect(ConfigurationError).toBeDefined();
      const error = new ConfigurationError('TEST_VAR');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ConfigurationError');
      expect(error.variableName).toBe('TEST_VAR');
    });

    it('exports VaultNotFoundError class', () => {
      expect(VaultNotFoundError).toBeDefined();
      const error = new VaultNotFoundError('/path/to/vault');
      expect(error).toBeInstanceOf(StorageError);
      expect(error.name).toBe('VaultNotFoundError');
    });

    it('exports FileLockError class', () => {
      expect(FileLockError).toBeDefined();
      const error = new FileLockError('locked', '/path');
      expect(error).toBeInstanceOf(StorageError);
      expect(error.name).toBe('FileLockError');
    });

    it('exports PermissionError class', () => {
      expect(PermissionError).toBeDefined();
      const error = new PermissionError('/path', 'read');
      expect(error).toBeInstanceOf(StorageError);
      expect(error.name).toBe('PermissionError');
    });

    it('exports DiskSpaceError class', () => {
      expect(DiskSpaceError).toBeDefined();
      const error = new DiskSpaceError('/path', 'write');
      expect(error).toBeInstanceOf(StorageError);
      expect(error.name).toBe('DiskSpaceError');
    });

    it('exports PathTooLongError class', () => {
      expect(PathTooLongError).toBeDefined();
      const error = new PathTooLongError('/very/long/path', 'write');
      expect(error).toBeInstanceOf(StorageError);
      expect(error.name).toBe('PathTooLongError');
    });
  });

  describe('File utility exports', () => {
    it('exports atomicWrite function', () => {
      expect(atomicWrite).toBeDefined();
      expect(typeof atomicWrite).toBe('function');
    });

    it('exports retryWithBackoff function', () => {
      expect(retryWithBackoff).toBeDefined();
      expect(typeof retryWithBackoff).toBe('function');
    });

    it('exports ensureDirectory function', () => {
      expect(ensureDirectory).toBeDefined();
      expect(typeof ensureDirectory).toBe('function');
    });

    it('exports computeContentHash function', () => {
      expect(computeContentHash).toBeDefined();
      expect(typeof computeContentHash).toBe('function');
    });

    it('exports readFileWithRetry function', () => {
      expect(readFileWithRetry).toBeDefined();
      expect(typeof readFileWithRetry).toBe('function');
    });

    it('exports writeFileWithRetry function', () => {
      expect(writeFileWithRetry).toBeDefined();
      expect(typeof writeFileWithRetry).toBe('function');
    });

    it('exports deleteFileWithRetry function', () => {
      expect(deleteFileWithRetry).toBeDefined();
      expect(typeof deleteFileWithRetry).toBe('function');
    });

    it('exports fileExists function', () => {
      expect(fileExists).toBeDefined();
      expect(typeof fileExists).toBe('function');
    });

    it('exports directoryExists function', () => {
      expect(directoryExists).toBeDefined();
      expect(typeof directoryExists).toBe('function');
    });

    it('exports getFileStats function', () => {
      expect(getFileStats).toBeDefined();
      expect(typeof getFileStats).toBe('function');
    });

    it('exports listDirectory function', () => {
      expect(listDirectory).toBeDefined();
      expect(typeof listDirectory).toBe('function');
    });

    it('exports getDirectoryFileInfo function', () => {
      expect(getDirectoryFileInfo).toBeDefined();
      expect(typeof getDirectoryFileInfo).toBe('function');
    });
  });

  describe('Path utility exports', () => {
    it('exports sanitizeFilename function', () => {
      expect(sanitizeFilename).toBeDefined();
      expect(typeof sanitizeFilename).toBe('function');
      expect(sanitizeFilename('test:file')).toBe('test_file');
    });

    it('exports truncateFilename function', () => {
      expect(truncateFilename).toBeDefined();
      expect(typeof truncateFilename).toBe('function');
      expect(truncateFilename('short')).toBe('short');
    });

    it('exports sanitizeTimestamp function', () => {
      expect(sanitizeTimestamp).toBeDefined();
      expect(typeof sanitizeTimestamp).toBe('function');
      expect(sanitizeTimestamp('2026-01-16T10:30:00.000Z')).toBe('2026-01-16T10-30-00.000Z');
    });

    it('exports normalizePath function', () => {
      expect(normalizePath).toBeDefined();
      expect(typeof normalizePath).toBe('function');
    });

    it('exports joinPath function', () => {
      expect(joinPath).toBeDefined();
      expect(typeof joinPath).toBe('function');
    });

    it('exports isValidWindowsFilename function', () => {
      expect(isValidWindowsFilename).toBeDefined();
      expect(typeof isValidWindowsFilename).toBe('function');
      expect(isValidWindowsFilename('valid-file.txt')).toBe(true);
      expect(isValidWindowsFilename('invalid:file.txt')).toBe(false);
    });

    it('exports getExtension function', () => {
      expect(getExtension).toBeDefined();
      expect(typeof getExtension).toBe('function');
      expect(getExtension('file.txt')).toBe('.txt');
    });

    it('exports removeExtension function', () => {
      expect(removeExtension).toBeDefined();
      expect(typeof removeExtension).toBe('function');
      expect(removeExtension('file.txt')).toBe('file');
    });
  });

  describe('FileChangeCache export', () => {
    it('exports FileChangeCache class', () => {
      expect(FileChangeCache).toBeDefined();
      expect(typeof FileChangeCache).toBe('function');
      
      const cache = new FileChangeCache();
      expect(cache).toBeInstanceOf(FileChangeCache);
      expect(typeof cache.hasChanged).toBe('function');
      expect(typeof cache.getCachedConversations).toBe('function');
      expect(typeof cache.setCachedConversations).toBe('function');
      expect(typeof cache.clearCache).toBe('function');
    });
  });

  describe('Type exports (compile-time verification)', () => {
    it('types are correctly exported and usable', () => {
      // These type assertions verify that the types are correctly exported
      // They don't do anything at runtime, but TypeScript will fail to compile
      // if the types are not properly exported
      
      const config: LocalStorageConfig = {
        chatVaultPath: '/path/to/vault',
      };
      expect(config.chatVaultPath).toBe('/path/to/vault');

      const obsidianConfig: LocalObsidianConfig = {
        vaultPath: '/path/to/obsidian',
      };
      expect(obsidianConfig.vaultPath).toBe('/path/to/obsidian');

      const frontmatter: ObsidianNoteFrontmatter = {
        title: 'Test',
        created: '2026-01-16T10:00:00.000Z',
        modified: '2026-01-16T10:00:00.000Z',
      };
      expect(frontmatter.title).toBe('Test');

      const message: Message = {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-16T10:00:00.000Z',
      };
      expect(message.role).toBe('user');

      const fileInfo: FileInfo = {
        path: '/path/to/file',
        size: 1024,
      };
      expect(fileInfo.size).toBe(1024);

      const cacheMetadata: CacheMetadata = {
        fileCount: 10,
        contentHash: 'abc123',
      };
      expect(cacheMetadata.fileCount).toBe(10);
    });
  });
});
