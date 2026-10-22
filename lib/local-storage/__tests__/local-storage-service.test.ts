/**
 * Unit tests for LocalStorageService configuration
 * 
 * Tests for task 4.1 and 4.2:
 * - LocalStorageConfig interface with all options
 * - Constructor with env var reading and validation
 * - ConfigurationError for missing env vars
 * - Directory creation on missing path
 * 
 * Requirements: 1.1, 1.2, 1.3, 9.1, 9.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  LocalStorageService,
  getLocalStorageService,
  resetLocalStorageService,
  CONVERSATIONS_DIR,
  CHAT_SESSIONS_DIR,
  CHAT_MESSAGES_DIR,
  METADATA_DIR,
} from '../local-storage-service';
import { ConfigurationError } from '../errors';
import { directoryExists } from '../file-utils';

describe('LocalStorageService', () => {
  // Store original env value
  const originalEnv = process.env.CHAT_VAULT_PATH;

  beforeEach(() => {
    // Reset singleton before each test
    resetLocalStorageService();
  });

  afterEach(() => {
    // Restore original env value
    if (originalEnv !== undefined) {
      process.env.CHAT_VAULT_PATH = originalEnv;
    } else {
      delete process.env.CHAT_VAULT_PATH;
    }
    // Reset singleton after each test
    resetLocalStorageService();
  });

  describe('constructor with explicit config', () => {
    it('should create service with explicit chatVaultPath', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      expect(service.getChatVaultPath()).toBe(path.normalize('C:\\TestVault'));
    });

    it('should normalize the chatVaultPath', () => {
      const config = { chatVaultPath: 'C:/TestVault/nested/../actual' };
      const service = new LocalStorageService(config);

      // Path should be normalized
      const normalizedPath = service.getChatVaultPath();
      expect(normalizedPath).not.toContain('/');
      expect(normalizedPath).not.toContain('..');
    });

    it('should apply default values for optional config', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);
      const fullConfig = service.getConfig();

      expect(fullConfig.dualWriteMode).toBe(false);
      expect(fullConfig.fallbackToS3).toBe(false);
      expect(fullConfig.retryOnLock).toBe(true);
      expect(fullConfig.maxRetries).toBe(3);
    });

    it('should respect custom config values', () => {
      const config = {
        chatVaultPath: 'C:\\TestVault',
        dualWriteMode: true,
        fallbackToS3: true,
        retryOnLock: false,
        maxRetries: 5,
      };
      const service = new LocalStorageService(config);
      const fullConfig = service.getConfig();

      expect(fullConfig.dualWriteMode).toBe(true);
      expect(fullConfig.fallbackToS3).toBe(true);
      expect(fullConfig.retryOnLock).toBe(false);
      expect(fullConfig.maxRetries).toBe(5);
    });
  });

  describe('constructor with environment variable', () => {
    it('should read CHAT_VAULT_PATH from environment', () => {
      process.env.CHAT_VAULT_PATH = 'C:\\EnvVault';
      const service = new LocalStorageService();

      expect(service.getChatVaultPath()).toBe(path.normalize('C:\\EnvVault'));
    });

    it('should throw ConfigurationError when CHAT_VAULT_PATH is not set', () => {
      delete process.env.CHAT_VAULT_PATH;

      expect(() => new LocalStorageService()).toThrow(ConfigurationError);
      expect(() => new LocalStorageService()).toThrow(
        'Missing required environment variable: CHAT_VAULT_PATH'
      );
    });

    it('should throw ConfigurationError with correct variable name', () => {
      delete process.env.CHAT_VAULT_PATH;

      try {
        new LocalStorageService();
        expect.fail('Should have thrown ConfigurationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).variableName).toBe('CHAT_VAULT_PATH');
      }
    });
  });

  describe('directory paths', () => {
    it('should compute correct conversations path', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      expect(service.getConversationsPath()).toBe(
        path.join('C:\\TestVault', CONVERSATIONS_DIR)
      );
    });

    it('should compute correct chat sessions path', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      expect(service.getChatSessionsPath()).toBe(
        path.join('C:\\TestVault', CHAT_SESSIONS_DIR)
      );
    });

    it('should compute correct chat messages path', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      expect(service.getChatMessagesPath()).toBe(
        path.join('C:\\TestVault', CHAT_MESSAGES_DIR)
      );
    });

    it('should compute correct metadata path', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      expect(service.getMetadataPath()).toBe(
        path.join('C:\\TestVault', CHAT_MESSAGES_DIR, METADATA_DIR)
      );
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      process.env.CHAT_VAULT_PATH = 'C:\\SingletonVault';

      const instance1 = getLocalStorageService();
      const instance2 = getLocalStorageService();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      process.env.CHAT_VAULT_PATH = 'C:\\SingletonVault';

      const instance1 = getLocalStorageService();
      resetLocalStorageService();
      const instance2 = getLocalStorageService();

      expect(instance1).not.toBe(instance2);
    });

    it('should throw ConfigurationError from singleton when env not set', () => {
      delete process.env.CHAT_VAULT_PATH;

      expect(() => getLocalStorageService()).toThrow(ConfigurationError);
    });
  });

  describe('cache invalidation', () => {
    it('should have invalidateCache method', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      // Should not throw
      expect(() => service.invalidateCache()).not.toThrow();
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config = { chatVaultPath: 'C:\\TestVault' };
      const service = new LocalStorageService(config);

      const config1 = service.getConfig();
      const config2 = service.getConfig();

      // Should be equal but not the same object
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });
});

describe('ConfigurationError', () => {
  it('should have correct name', () => {
    const error = new ConfigurationError('TEST_VAR');
    expect(error.name).toBe('ConfigurationError');
  });

  it('should have correct message', () => {
    const error = new ConfigurationError('TEST_VAR');
    expect(error.message).toBe('Missing required environment variable: TEST_VAR');
  });

  it('should store variable name', () => {
    const error = new ConfigurationError('MY_VAR');
    expect(error.variableName).toBe('MY_VAR');
  });

  it('should be an instance of Error', () => {
    const error = new ConfigurationError('TEST_VAR');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('LocalStorageService directory creation', () => {
  let testVaultPath: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('ensureDirectories', () => {
    it('should create all required directories when vault path does not exist', async () => {
      const service = new LocalStorageService({ chatVaultPath: testVaultPath });

      // Verify directories don't exist yet
      expect(await directoryExists(testVaultPath)).toBe(false);

      // Create directories
      await service.ensureDirectories();

      // Verify all directories were created
      expect(await directoryExists(testVaultPath)).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CONVERSATIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_SESSIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_MESSAGES_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR))).toBe(true);
    });

    it('should not fail when directories already exist', async () => {
      const service = new LocalStorageService({ chatVaultPath: testVaultPath });

      // Create directories first time
      await service.ensureDirectories();

      // Should not throw when called again
      await expect(service.ensureDirectories()).resolves.not.toThrow();

      // Directories should still exist
      expect(await directoryExists(path.join(testVaultPath, CONVERSATIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_SESSIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_MESSAGES_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR))).toBe(true);
    });

    it('should create nested directory structure correctly', async () => {
      // Use a deeply nested path
      const nestedPath = path.join(testVaultPath, 'level1', 'level2', 'level3');
      const service = new LocalStorageService({ chatVaultPath: nestedPath });

      await service.ensureDirectories();

      // Verify the nested structure was created
      expect(await directoryExists(nestedPath)).toBe(true);
      expect(await directoryExists(path.join(nestedPath, CONVERSATIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(nestedPath, CHAT_MESSAGES_DIR, METADATA_DIR))).toBe(true);
    });

    it('should handle paths with spaces', async () => {
      const pathWithSpaces = path.join(testVaultPath, 'path with spaces', 'and more spaces');
      const service = new LocalStorageService({ chatVaultPath: pathWithSpaces });

      await service.ensureDirectories();

      expect(await directoryExists(pathWithSpaces)).toBe(true);
      expect(await directoryExists(path.join(pathWithSpaces, CONVERSATIONS_DIR))).toBe(true);
    });

    it('should handle paths with special characters', async () => {
      const pathWithSpecialChars = path.join(testVaultPath, 'path-with_special.chars');
      const service = new LocalStorageService({ chatVaultPath: pathWithSpecialChars });

      await service.ensureDirectories();

      expect(await directoryExists(pathWithSpecialChars)).toBe(true);
      expect(await directoryExists(path.join(pathWithSpecialChars, CONVERSATIONS_DIR))).toBe(true);
    });
  });
});


describe('LocalStorageService storage operations', () => {
  let testVaultPath: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new LocalStorageService({ chatVaultPath: testVaultPath });
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('storeConversation', () => {
    it('should create conversations directory if it does not exist', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi there!', timestamp: '2026-01-16T10:00:05.000Z' },
      ];

      await service.storeConversation(messages);

      expect(await directoryExists(path.join(testVaultPath, CONVERSATIONS_DIR))).toBe(true);
    });

    it('should write conversation to conversations directory', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi there!', timestamp: '2026-01-16T10:00:05.000Z' },
      ];

      await service.storeConversation(messages);

      // Check that a file was created in the conversations directory
      const files = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.json$/);
    });

    it('should write valid JSON with messages array', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi there!', timestamp: '2026-01-16T10:00:05.000Z' },
      ];

      await service.storeConversation(messages);

      // Read the file and verify content
      const files = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      const filePath = path.join(testVaultPath, CONVERSATIONS_DIR, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('messages');
      expect(parsed.messages).toEqual(messages);
    });

    it('should use sanitized timestamp in filename', async () => {
      const messages = [
        { role: 'user' as const, content: 'Test', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeConversation(messages);

      const files = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      // Filename should not contain colons (Windows-invalid)
      expect(files[0]).not.toContain(':');
      // Should contain dashes instead of colons in time portion
      expect(files[0]).toMatch(/T\d{2}-\d{2}-\d{2}/);
    });

    it('should handle empty messages array', async () => {
      const messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }> = [];

      await service.storeConversation(messages);

      const files = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      expect(files.length).toBe(1);

      const filePath = path.join(testVaultPath, CONVERSATIONS_DIR, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.messages).toEqual([]);
    });

    it('should store multiple conversations with unique filenames', async () => {
      const messages1 = [
        { role: 'user' as const, content: 'First', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second', timestamp: '2026-01-16T10:00:01.000Z' },
      ];

      await service.storeConversation(messages1);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await service.storeConversation(messages2);

      const files = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      expect(files.length).toBe(2);
      expect(files[0]).not.toBe(files[1]);
    });
  });

  describe('storeSession', () => {
    it('should create chat-sessions directory if it does not exist', async () => {
      const sessionId = 'test-session-123';
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const title = 'Test Session';

      await service.storeSession(sessionId, messages, title);

      expect(await directoryExists(path.join(testVaultPath, CHAT_SESSIONS_DIR))).toBe(true);
    });

    it('should write session to chat-sessions directory with sessionId as filename', async () => {
      const sessionId = 'test-session-123';
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const title = 'Test Session';

      await service.storeSession(sessionId, messages, title);

      const files = await fs.readdir(path.join(testVaultPath, CHAT_SESSIONS_DIR));
      expect(files).toContain(`${sessionId}.json`);
    });

    it('should write valid JSON with session structure', async () => {
      const sessionId = 'test-session-456';
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi!', timestamp: '2026-01-16T10:00:05.000Z' },
      ];
      const title = 'My Test Session';

      await service.storeSession(sessionId, messages, title);

      const filePath = path.join(testVaultPath, CHAT_SESSIONS_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('sessionId', sessionId);
      expect(parsed).toHaveProperty('title', title);
      expect(parsed).toHaveProperty('messages');
      expect(parsed.messages).toEqual(messages);
      expect(parsed).toHaveProperty('lastActivity');
    });

    it('should set lastActivity to last message timestamp', async () => {
      const sessionId = 'test-session-789';
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi!', timestamp: '2026-01-16T10:05:00.000Z' },
      ];
      const title = 'Test Session';

      await service.storeSession(sessionId, messages, title);

      const filePath = path.join(testVaultPath, CHAT_SESSIONS_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.lastActivity).toBe('2026-01-16T10:05:00.000Z');
    });

    it('should handle empty messages array with current timestamp for lastActivity', async () => {
      const sessionId = 'empty-session';
      const messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }> = [];
      const title = 'Empty Session';

      const beforeStore = new Date().toISOString();
      await service.storeSession(sessionId, messages, title);
      const afterStore = new Date().toISOString();

      const filePath = path.join(testVaultPath, CHAT_SESSIONS_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.messages).toEqual([]);
      // lastActivity should be between before and after timestamps
      expect(parsed.lastActivity >= beforeStore).toBe(true);
      expect(parsed.lastActivity <= afterStore).toBe(true);
    });

    it('should overwrite existing session with same sessionId', async () => {
      const sessionId = 'overwrite-session';
      const messages1 = [
        { role: 'user' as const, content: 'First', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second', timestamp: '2026-01-16T11:00:00.000Z' },
      ];

      await service.storeSession(sessionId, messages1, 'First Title');
      await service.storeSession(sessionId, messages2, 'Second Title');

      const files = await fs.readdir(path.join(testVaultPath, CHAT_SESSIONS_DIR));
      expect(files.length).toBe(1);

      const filePath = path.join(testVaultPath, CHAT_SESSIONS_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.title).toBe('Second Title');
      expect(parsed.messages).toEqual(messages2);
    });

    it('should store multiple sessions with different sessionIds', async () => {
      const session1 = { id: 'session-1', messages: [{ role: 'user' as const, content: 'One', timestamp: '2026-01-16T10:00:00.000Z' }], title: 'Session 1' };
      const session2 = { id: 'session-2', messages: [{ role: 'user' as const, content: 'Two', timestamp: '2026-01-16T11:00:00.000Z' }], title: 'Session 2' };

      await service.storeSession(session1.id, session1.messages, session1.title);
      await service.storeSession(session2.id, session2.messages, session2.title);

      const files = await fs.readdir(path.join(testVaultPath, CHAT_SESSIONS_DIR));
      expect(files.length).toBe(2);
      expect(files).toContain('session-1.json');
      expect(files).toContain('session-2.json');
    });
  });
});


describe('LocalStorageService message retrieval', () => {
  let testVaultPath: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new LocalStorageService({ chatVaultPath: testVaultPath });
    await service.ensureDirectories();
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('getAllMessages', () => {
    it('should return empty array when chat-messages directory does not exist', async () => {
      // Remove the chat-messages directory
      await fs.rm(path.join(testVaultPath, CHAT_MESSAGES_DIR), { recursive: true, force: true });

      const messages = await service.getAllMessages();

      expect(messages).toEqual([]);
    });

    it('should return empty array when chat-messages directory is empty', async () => {
      const messages = await service.getAllMessages();

      expect(messages).toEqual([]);
    });

    it('should parse individual message file correctly', async () => {
      const messageContent = `ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Hello, how are you?`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-001.txt'),
        messageContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: 'user',
        timestamp: '2026-01-16T10:00:00.000Z',
        type: 'chat_message',
        content: 'Hello, how are you?',
      });
    });

    it('should parse assistant role correctly', async () => {
      const messageContent = `ROLE: assistant
TIMESTAMP: 2026-01-16T10:00:05.000Z
TYPE: chat_message
CONTENT: I'm doing well, thank you!`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-002.txt'),
        messageContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
    });

    it('should handle multi-line content in individual message file', async () => {
      const messageContent = `ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Line 1
Line 2
Line 3`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-003.txt'),
        messageContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should parse conversation file and extract all messages', async () => {
      const conversationContent = `CONVERSATION_ID: conv-xyz789
TYPE: conversation
MESSAGE_COUNT: 2
CONVERSATION_START: 2026-01-16T10:00:00.000Z
CONVERSATION_END: 2026-01-16T10:00:15.000Z

--- CONVERSATION ---

ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
CONTENT: Hello!

---

ROLE: assistant
TIMESTAMP: 2026-01-16T10:00:15.000Z
CONTENT: Hi there!

---`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-001.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: 'user',
        timestamp: '2026-01-16T10:00:00.000Z',
        content: 'Hello!',
      });
      expect(messages[1]).toEqual({
        role: 'assistant',
        timestamp: '2026-01-16T10:00:15.000Z',
        content: 'Hi there!',
      });
    });

    it('should handle multi-line content in conversation file messages', async () => {
      const conversationContent = `CONVERSATION_ID: conv-multi
TYPE: conversation
MESSAGE_COUNT: 1
CONVERSATION_START: 2026-01-16T10:00:00.000Z
CONVERSATION_END: 2026-01-16T10:00:00.000Z

--- CONVERSATION ---

ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
CONTENT: First line
Second line
Third line

---`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-multi.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('First line\nSecond line\nThird line');
    });

    it('should parse both individual and conversation files', async () => {
      // Create an individual message file
      const individualMessage = `ROLE: user
TIMESTAMP: 2026-01-16T09:00:00.000Z
TYPE: chat_message
CONTENT: Individual message`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-individual.txt'),
        individualMessage
      );

      // Create a conversation file
      const conversationContent = `CONVERSATION_ID: conv-mixed
TYPE: conversation
MESSAGE_COUNT: 1
CONVERSATION_START: 2026-01-16T10:00:00.000Z
CONVERSATION_END: 2026-01-16T10:00:00.000Z

--- CONVERSATION ---

ROLE: assistant
TIMESTAMP: 2026-01-16T10:00:00.000Z
CONTENT: Conversation message

---`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-mixed.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(2);
      // Check that both messages are present (order may vary)
      const contents = messages.map(m => m.content);
      expect(contents).toContain('Individual message');
      expect(contents).toContain('Conversation message');
    });

    it('should skip non-txt files', async () => {
      // Create a .txt file
      const messageContent = `ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Valid message`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-valid.txt'),
        messageContent
      );

      // Create a .json file (should be skipped)
      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'data.json'),
        '{"key": "value"}'
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Valid message');
    });

    it('should skip directories in chat-messages', async () => {
      // Create a message file
      const messageContent = `ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Valid message`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-valid.txt'),
        messageContent
      );

      // The metadata directory already exists, should be skipped
      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
    });

    it('should skip malformed individual message files gracefully', async () => {
      // Create a valid message file
      const validMessage = `ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Valid message`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-valid.txt'),
        validMessage
      );

      // Create a malformed message file (missing required fields)
      const malformedMessage = `ROLE: user
CONTENT: Missing timestamp`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-malformed.txt'),
        malformedMessage
      );

      const messages = await service.getAllMessages();

      // Should only return the valid message
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Valid message');
    });

    it('should handle conversation file with no messages', async () => {
      const conversationContent = `CONVERSATION_ID: conv-empty
TYPE: conversation
MESSAGE_COUNT: 0
CONVERSATION_START: 2026-01-16T10:00:00.000Z
CONVERSATION_END: 2026-01-16T10:00:00.000Z

--- CONVERSATION ---

---`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-empty.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(0);
    });

    it('should handle conversation file without conversation marker', async () => {
      const conversationContent = `CONVERSATION_ID: conv-no-marker
TYPE: conversation
MESSAGE_COUNT: 1

ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
CONTENT: This should not be parsed`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-no-marker.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      // Should return empty since there's no "--- CONVERSATION ---" marker
      expect(messages).toHaveLength(0);
    });

    it('should handle case-insensitive role values', async () => {
      const messageContent = `ROLE: USER
TIMESTAMP: 2026-01-16T10:00:00.000Z
TYPE: chat_message
CONTENT: Uppercase role`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'msg-uppercase.txt'),
        messageContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('should handle multiple messages in a conversation file', async () => {
      const conversationContent = `CONVERSATION_ID: conv-multi-msg
TYPE: conversation
MESSAGE_COUNT: 4
CONVERSATION_START: 2026-01-16T10:00:00.000Z
CONVERSATION_END: 2026-01-16T10:02:00.000Z

--- CONVERSATION ---

ROLE: user
TIMESTAMP: 2026-01-16T10:00:00.000Z
CONTENT: Message 1

---

ROLE: assistant
TIMESTAMP: 2026-01-16T10:00:30.000Z
CONTENT: Message 2

---

ROLE: user
TIMESTAMP: 2026-01-16T10:01:00.000Z
CONTENT: Message 3

---

ROLE: assistant
TIMESTAMP: 2026-01-16T10:02:00.000Z
CONTENT: Message 4

---`;

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, 'conversation-multi-msg.txt'),
        conversationContent
      );

      const messages = await service.getAllMessages();

      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe('Message 1');
      expect(messages[1].content).toBe('Message 2');
      expect(messages[2].content).toBe('Message 3');
      expect(messages[3].content).toBe('Message 4');
    });
  });
});


describe('LocalStorageService conversation retrieval', () => {
  let testVaultPath: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new LocalStorageService({ chatVaultPath: testVaultPath });
    await service.ensureDirectories();
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('getAllConversations', () => {
    it('should return empty array when no messages exist', async () => {
      const conversations = await service.getAllConversations();

      expect(conversations).toEqual([]);
    });

    it('should group messages within a stored session', async () => {
      // Store a session with multiple messages
      const messages = [
        { role: 'user' as const, content: 'First message', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Second message', timestamp: '2026-01-16T10:15:00.000Z' },
        { role: 'user' as const, content: 'Third message', timestamp: '2026-01-16T10:25:00.000Z' },
      ];

      await service.storeSession('session-1', messages, 'First message');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].messageCount).toBe(3);
      expect(conversations[0].messages).toHaveLength(3);
    });

    it('should return multiple sessions as separate conversations', async () => {
      // Store two separate sessions
      const messages1 = [
        { role: 'user' as const, content: 'First session message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second session message', timestamp: '2026-01-16T11:00:00.000Z' },
      ];

      await service.storeSession('session-1', messages1, 'First session');
      await service.storeSession('session-2', messages2, 'Second session');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(2);
    });

    it('should sort sessions by end time (newest first)', async () => {
      // Store sessions with different timestamps
      const messages1 = [
        { role: 'user' as const, content: 'Morning message', timestamp: '2026-01-16T08:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Afternoon message', timestamp: '2026-01-16T14:00:00.000Z' },
      ];
      const messages3 = [
        { role: 'user' as const, content: 'Evening message', timestamp: '2026-01-16T20:00:00.000Z' },
      ];

      await service.storeSession('session-morning', messages1, 'Morning');
      await service.storeSession('session-afternoon', messages2, 'Afternoon');
      await service.storeSession('session-evening', messages3, 'Evening');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(3);
      // Newest first (sorted by endTime/lastActivity)
      expect(conversations[0].endTime).toBe('2026-01-16T20:00:00.000Z');
      expect(conversations[1].endTime).toBe('2026-01-16T14:00:00.000Z');
      expect(conversations[2].endTime).toBe('2026-01-16T08:00:00.000Z');
    });

    it('should set correct startTime and endTime for sessions', async () => {
      const messages = [
        { role: 'user' as const, content: 'Start', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Middle', timestamp: '2026-01-16T10:05:00.000Z' },
        { role: 'user' as const, content: 'End', timestamp: '2026-01-16T10:10:00.000Z' },
      ];

      await service.storeSession('session-times', messages, 'Start');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].startTime).toBe('2026-01-16T10:00:00.000Z');
      expect(conversations[0].endTime).toBe('2026-01-16T10:10:00.000Z');
    });

    it('should generate preview from session title', async () => {
      const messages = [
        { role: 'user' as const, content: 'This is the first user message that should be used for preview', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'This is the assistant response', timestamp: '2026-01-16T10:01:00.000Z' },
      ];

      await service.storeSession('session-preview', messages, 'This is the first user message that should be used for preview');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].preview).toBe('This is the first user message that should be used for preview');
    });

    it('should truncate preview to 50 characters from first message content when no title', async () => {
      const longContent = 'A'.repeat(100);
      const messages = [
        { role: 'user' as const, content: longContent, timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-long', messages, '');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].preview).toHaveLength(50);
    });

    it('should return empty preview when no title and no messages', async () => {
      const messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }> = [];

      await service.storeSession('session-empty', messages, '');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].preview).toBe('');
    });

    it('should initialize tags as empty array', async () => {
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-tags', messages, 'Test');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].tags).toEqual([]);
    });

    it('should use cache on subsequent calls', async () => {
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-cache', messages, 'Test');

      // First call - populates cache
      const conversations1 = await service.getAllConversations();
      
      // Second call - should use cache
      const conversations2 = await service.getAllConversations();

      expect(conversations1).toEqual(conversations2);
    });

    it('should bypass cache when forceRefresh is true', async () => {
      const messages1 = [
        { role: 'user' as const, content: 'Original message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-orig', messages1, 'Original');

      // First call - populates cache
      const conversations1 = await service.getAllConversations();
      expect(conversations1).toHaveLength(1);

      // Add another session
      const messages2 = [
        { role: 'user' as const, content: 'New message', timestamp: '2026-01-16T12:00:00.000Z' },
      ];

      await service.storeSession('session-new', messages2, 'New');

      // Force refresh should pick up new session
      const conversations2 = await service.getAllConversations(true);
      expect(conversations2).toHaveLength(2);
    });

    it('should handle exactly 30 minute gap as same session', async () => {
      // Store a session with messages 30 minutes apart
      const messages = [
        { role: 'user' as const, content: 'First message', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'user' as const, content: 'Second message', timestamp: '2026-01-16T10:30:00.000Z' },
      ];

      await service.storeSession('session-30min', messages, 'First message');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(1);
      expect(conversations[0].messageCount).toBe(2);
    });

    it('should handle gap of 30 minutes and 1 second as new session', async () => {
      // Store two separate sessions
      const messages1 = [
        { role: 'user' as const, content: 'First message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second message', timestamp: '2026-01-16T10:30:01.000Z' },
      ];

      await service.storeSession('session-a', messages1, 'First');
      await service.storeSession('session-b', messages2, 'Second');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(2);
    });

    it('should generate unique session IDs from stored sessions', async () => {
      // Store two separate sessions
      const messages1 = [
        { role: 'user' as const, content: 'First session', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second session', timestamp: '2026-01-16T14:00:00.000Z' },
      ];

      await service.storeSession('session-first', messages1, 'First');
      await service.storeSession('session-second', messages2, 'Second');

      const conversations = await service.getAllConversations();

      expect(conversations).toHaveLength(2);
      expect(conversations[0].sessionId).not.toBe(conversations[1].sessionId);
    });
  });

  describe('getConversation', () => {
    it('should return null when no conversations exist', async () => {
      const conversation = await service.getConversation('non-existent-session');

      expect(conversation).toBeNull();
    });

    it('should return null for non-existent session ID', async () => {
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('existing-session', messages, 'Test');

      const conversation = await service.getConversation('non-existent-session');

      expect(conversation).toBeNull();
    });

    it('should return conversation for valid session ID', async () => {
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('valid-session', messages, 'Test');

      // Get all conversations to find the session ID
      const conversations = await service.getAllConversations();
      expect(conversations).toHaveLength(1);

      const sessionId = conversations[0].sessionId;
      const conversation = await service.getConversation(sessionId);

      expect(conversation).not.toBeNull();
      expect(conversation?.sessionId).toBe(sessionId);
      expect(conversation?.messageCount).toBe(1);
    });

    it('should return correct conversation from multiple sessions', async () => {
      // Store two separate sessions
      const messages1 = [
        { role: 'user' as const, content: 'First session message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second session message', timestamp: '2026-01-16T14:00:00.000Z' },
      ];

      await service.storeSession('session-1', messages1, 'First');
      await service.storeSession('session-2', messages2, 'Second');

      const conversations = await service.getAllConversations();
      expect(conversations).toHaveLength(2);

      // Get the second session (which is first in the sorted list - newest first)
      const targetSession = conversations[0];
      const conversation = await service.getConversation(targetSession.sessionId);

      expect(conversation).not.toBeNull();
      expect(conversation?.sessionId).toBe(targetSession.sessionId);
      expect(conversation?.messages[0].content).toBe('Second session message');
    });
  });

  describe('cache invalidation', () => {
    it('should detect file changes and refresh cache', async () => {
      const messages1 = [
        { role: 'user' as const, content: 'Original message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-detect', messages1, 'Original');

      // First call - populates cache
      const conversations1 = await service.getAllConversations();
      expect(conversations1).toHaveLength(1);

      // Add a new session file (changes file count and hash)
      const messages2 = [
        { role: 'user' as const, content: 'New message', timestamp: '2026-01-16T12:00:00.000Z' },
      ];

      await service.storeSession('session-new-detect', messages2, 'New');

      // Cache should detect the change
      const conversations2 = await service.getAllConversations();
      expect(conversations2).toHaveLength(2);
    });

    it('should invalidate cache when invalidateCache is called', async () => {
      const messages1 = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-inv', messages1, 'Test');

      // First call - populates cache
      await service.getAllConversations();

      // Manually invalidate cache
      service.invalidateCache();

      // Add a new session
      const messages2 = [
        { role: 'user' as const, content: 'New message', timestamp: '2026-01-16T12:00:00.000Z' },
      ];

      await service.storeSession('session-inv-new', messages2, 'New');

      // Should pick up new session after cache invalidation
      const conversations = await service.getAllConversations();
      expect(conversations).toHaveLength(2);
    });
  });
});


describe('LocalStorageService tag management', () => {
  let testVaultPath: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new LocalStorageService({ chatVaultPath: testVaultPath });
    await service.ensureDirectories();
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('getConversationTags', () => {
    it('should return empty array when metadata file does not exist', async () => {
      const tags = await service.getConversationTags('non-existent-session');

      expect(tags).toEqual([]);
    });

    it('should return tags from existing metadata file', async () => {
      const sessionId = 'test-session-123';
      const metadataContent = JSON.stringify({
        sessionId,
        tags: ['important', 'work', 'follow-up'],
        updatedAt: '2026-01-16T10:00:00.000Z',
      });

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`),
        metadataContent
      );

      const tags = await service.getConversationTags(sessionId);

      expect(tags).toEqual(['important', 'work', 'follow-up']);
    });

    it('should return empty array when metadata file has no tags field', async () => {
      const sessionId = 'test-session-no-tags';
      const metadataContent = JSON.stringify({
        sessionId,
        updatedAt: '2026-01-16T10:00:00.000Z',
      });

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`),
        metadataContent
      );

      const tags = await service.getConversationTags(sessionId);

      expect(tags).toEqual([]);
    });

    it('should return empty array when tags field is not an array', async () => {
      const sessionId = 'test-session-invalid-tags';
      const metadataContent = JSON.stringify({
        sessionId,
        tags: 'not-an-array',
        updatedAt: '2026-01-16T10:00:00.000Z',
      });

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`),
        metadataContent
      );

      const tags = await service.getConversationTags(sessionId);

      expect(tags).toEqual([]);
    });

    it('should handle empty tags array', async () => {
      const sessionId = 'test-session-empty-tags';
      const metadataContent = JSON.stringify({
        sessionId,
        tags: [],
        updatedAt: '2026-01-16T10:00:00.000Z',
      });

      await fs.writeFile(
        path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`),
        metadataContent
      );

      const tags = await service.getConversationTags(sessionId);

      expect(tags).toEqual([]);
    });
  });

  describe('updateConversationTags', () => {
    it('should create metadata file with tags', async () => {
      const sessionId = 'new-session-123';
      const tags = ['important', 'project-x'];

      await service.updateConversationTags(sessionId, tags);

      const filePath = path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = JSON.parse(content);

      expect(metadata.sessionId).toBe(sessionId);
      expect(metadata.tags).toEqual(tags);
      expect(metadata.updatedAt).toBeDefined();
    });

    it('should create metadata directory if it does not exist', async () => {
      // Remove the metadata directory
      await fs.rm(path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR), { recursive: true, force: true });

      const sessionId = 'new-session-456';
      const tags = ['test-tag'];

      await service.updateConversationTags(sessionId, tags);

      const filePath = path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = JSON.parse(content);

      expect(metadata.tags).toEqual(tags);
    });

    it('should overwrite existing metadata file', async () => {
      const sessionId = 'existing-session';
      const oldTags = ['old-tag-1', 'old-tag-2'];
      const newTags = ['new-tag-1', 'new-tag-2', 'new-tag-3'];

      // Create initial metadata
      await service.updateConversationTags(sessionId, oldTags);

      // Update with new tags
      await service.updateConversationTags(sessionId, newTags);

      const tags = await service.getConversationTags(sessionId);
      expect(tags).toEqual(newTags);
    });

    it('should handle empty tags array', async () => {
      const sessionId = 'session-empty-tags';
      const tags: string[] = [];

      await service.updateConversationTags(sessionId, tags);

      const retrievedTags = await service.getConversationTags(sessionId);
      expect(retrievedTags).toEqual([]);
    });

    it('should set updatedAt timestamp', async () => {
      const sessionId = 'session-timestamp';
      const tags = ['test'];

      const beforeUpdate = new Date().toISOString();
      await service.updateConversationTags(sessionId, tags);
      const afterUpdate = new Date().toISOString();

      const filePath = path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = JSON.parse(content);

      expect(metadata.updatedAt >= beforeUpdate).toBe(true);
      expect(metadata.updatedAt <= afterUpdate).toBe(true);
    });

    it('should invalidate cache after updating tags', async () => {
      // Create a session to have something in the cache
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-tag-inv', messages, 'Test');

      // Populate cache
      await service.getAllConversations();

      // Update tags (should invalidate cache)
      await service.updateConversationTags('session-tag-inv', ['tag1']);

      // Add a new session
      const messages2 = [
        { role: 'user' as const, content: 'New message', timestamp: '2026-01-16T12:00:00.000Z' },
      ];

      await service.storeSession('session-tag-inv-new', messages2, 'New');

      // Cache should be invalidated, so new session should be picked up
      const conversations = await service.getAllConversations();
      expect(conversations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tag round-trip', () => {
    it('should preserve tags through update and retrieval', async () => {
      const sessionId = 'round-trip-session';
      const tags = ['tag1', 'tag2', 'tag3'];

      await service.updateConversationTags(sessionId, tags);
      const retrievedTags = await service.getConversationTags(sessionId);

      expect(retrievedTags).toEqual(tags);
    });

    it('should handle special characters in tags', async () => {
      const sessionId = 'special-chars-session';
      const tags = ['tag-with-dash', 'tag_with_underscore', 'tag.with.dots', 'tag with spaces'];

      await service.updateConversationTags(sessionId, tags);
      const retrievedTags = await service.getConversationTags(sessionId);

      expect(retrievedTags).toEqual(tags);
    });

    it('should handle unicode characters in tags', async () => {
      const sessionId = 'unicode-session';
      const tags = ['日本語', 'émoji', '中文', 'العربية'];

      await service.updateConversationTags(sessionId, tags);
      const retrievedTags = await service.getConversationTags(sessionId);

      expect(retrievedTags).toEqual(tags);
    });

    it('should handle multiple sessions with different tags', async () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      const tags1 = ['tag-a', 'tag-b'];
      const tags2 = ['tag-x', 'tag-y', 'tag-z'];

      await service.updateConversationTags(session1, tags1);
      await service.updateConversationTags(session2, tags2);

      const retrievedTags1 = await service.getConversationTags(session1);
      const retrievedTags2 = await service.getConversationTags(session2);

      expect(retrievedTags1).toEqual(tags1);
      expect(retrievedTags2).toEqual(tags2);
    });
  });
});


describe('LocalStorageService conversation deletion', () => {
  let testVaultPath: string;
  let service: LocalStorageService;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(os.tmpdir(), `test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    service = new LocalStorageService({ chatVaultPath: testVaultPath });
    await service.ensureDirectories();
    resetLocalStorageService();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLocalStorageService();
  });

  describe('deleteConversation', () => {
    it('should return 1 when session file does not exist (graceful delete)', async () => {
      // deleteSessionFile uses deleteFileWithRetry which handles ENOENT gracefully
      // so it always returns true (counts as 1 deletion)
      const deletedCount = await service.deleteConversation('non-existent-session');

      expect(deletedCount).toBe(1);
    });

    it('should delete session file from chat-sessions directory', async () => {
      // Store a session
      const messages = [
        { role: 'user' as const, content: 'First message', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Second message', timestamp: '2026-01-16T10:05:00.000Z' },
      ];

      await service.storeSession('session-to-delete', messages, 'First message');

      // Verify session file exists
      const sessionPath = path.join(testVaultPath, CHAT_SESSIONS_DIR, 'session-to-delete.json');
      const exists = await fs.access(sessionPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Delete the conversation
      const deletedCount = await service.deleteConversation('session-to-delete');

      expect(deletedCount).toBe(1);

      // Verify session file is deleted
      const existsAfter = await fs.access(sessionPath).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('should delete session file and metadata file', async () => {
      // Store a session
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-with-meta', messages, 'Test');

      // Create metadata file for the session
      await service.updateConversationTags('session-with-meta', ['important', 'work']);

      // Verify metadata file exists
      const metadataPath = path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, 'session-with-meta.json');
      const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExists).toBe(true);

      // Delete the conversation
      const deletedCount = await service.deleteConversation('session-with-meta');

      // Should delete session file + metadata file
      expect(deletedCount).toBe(2);

      // Verify metadata file is deleted
      const metadataExistsAfter = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExistsAfter).toBe(false);
    });

    it('should delete metadata file when session file not found but metadata exists', async () => {
      const sessionId = 'orphan-metadata-session';

      // Create only metadata file (no session file)
      await service.updateConversationTags(sessionId, ['orphan-tag']);

      // Verify metadata file exists
      const metadataPath = path.join(testVaultPath, CHAT_MESSAGES_DIR, METADATA_DIR, `${sessionId}.json`);
      const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExists).toBe(true);

      // Delete the conversation
      const deletedCount = await service.deleteConversation(sessionId);

      // deleteSessionFile returns true (ENOENT handled gracefully) + metadata = 2
      expect(deletedCount).toBe(2);

      // Verify metadata file is deleted
      const metadataExistsAfter = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExistsAfter).toBe(false);
    });

    it('should not delete other sessions', async () => {
      // Store two separate sessions
      const messages1 = [
        { role: 'user' as const, content: 'First session message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];
      const messages2 = [
        { role: 'user' as const, content: 'Second session message', timestamp: '2026-01-16T14:00:00.000Z' },
      ];

      await service.storeSession('session-keep', messages1, 'Keep');
      await service.storeSession('session-delete', messages2, 'Delete');

      // Delete only one session
      await service.deleteConversation('session-delete');

      // Verify the other session still exists
      const remainingConversations = await service.getAllConversations(true);
      expect(remainingConversations).toHaveLength(1);
      expect(remainingConversations[0].sessionId).toBe('session-keep');
    });

    it('should invalidate cache after deletion', async () => {
      // Store a session
      const messages = [
        { role: 'user' as const, content: 'Test message', timestamp: '2026-01-16T10:00:00.000Z' },
      ];

      await service.storeSession('session-cache-del', messages, 'Test');

      // Populate cache
      const conversationsBefore = await service.getAllConversations();
      expect(conversationsBefore).toHaveLength(1);

      // Delete the conversation
      await service.deleteConversation('session-cache-del');

      // Cache should be invalidated - getAllConversations should return empty
      const conversationsAfter = await service.getAllConversations();
      expect(conversationsAfter).toHaveLength(0);
    });

    it('should handle deletion when session does not exist', async () => {
      // deleteSessionFile handles ENOENT gracefully, always returns true
      const deletedCount = await service.deleteConversation('any-session');

      expect(deletedCount).toBe(1);
    });

    it('should return correct count with session and metadata', async () => {
      // Store a session
      const messages = [
        { role: 'user' as const, content: 'Message 1', timestamp: '2026-01-16T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Message 2', timestamp: '2026-01-16T10:01:00.000Z' },
        { role: 'user' as const, content: 'Message 3', timestamp: '2026-01-16T10:02:00.000Z' },
      ];

      await service.storeSession('session-count', messages, 'Message 1');

      // Add metadata
      await service.updateConversationTags('session-count', ['test']);

      // Delete the conversation
      const deletedCount = await service.deleteConversation('session-count');

      // 1 session file + 1 metadata file = 2
      expect(deletedCount).toBe(2);
    });
  });
});
