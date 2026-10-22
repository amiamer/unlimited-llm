/**
 * Integration tests for Chat API route
 * 
 * Tests the full flow from API request to file system storage:
 * - POST request stores conversation to local storage
 * - POST request stores session when sessionId provided
 * - Verify files are created in correct directories
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { POST } from '../route';
import { resetLocalStorageService, CONVERSATIONS_DIR, CHAT_SESSIONS_DIR } from '@/lib/local-storage/local-storage-service';
import { localObsidianService } from '@/lib/local-storage';
import { openRouterService } from '@/lib/llm-providers';
import { directoryExists } from '@/lib/local-storage/file-utils';

// Mock the LLM providers to avoid external API calls
vi.mock('@/lib/llm-providers', () => ({
  isChatModelKey: (value: unknown) =>
    typeof value === 'string' && ['glm', 'claude', 'gemini', 'gemini-pro', 'kimi', 'kimi-thinking'].includes(value),
  openRouterService: {
    generateResponse: vi.fn().mockResolvedValue({
      content: 'This is a mocked assistant response.',
      timestamp: '2026-01-16T10:00:05.000Z',
      codeAnalysisCalls: [],
      obsidianNoteCalls: [],
    }),
  },
}));

describe('Chat API Integration Tests', () => {
  let testVaultPath: string;
  const originalEnv = process.env.CHAT_VAULT_PATH;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testVaultPath = path.join(
      os.tmpdir(),
      `chat-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testVaultPath, { recursive: true });

    // Set environment variable for local storage service
    process.env.CHAT_VAULT_PATH = testVaultPath;
    
    // Set OBSIDIAN_VAULT_PATH to avoid ConfigurationError in chat route
    process.env.OBSIDIAN_VAULT_PATH = testVaultPath;

    // Reset singletons to pick up new env vars
    resetLocalStorageService();
    localObsidianService.resetInstance();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore original env value
    if (originalEnv !== undefined) {
      process.env.CHAT_VAULT_PATH = originalEnv;
    } else {
      delete process.env.CHAT_VAULT_PATH;
    }
    
    // Clean up OBSIDIAN_VAULT_PATH
    delete process.env.OBSIDIAN_VAULT_PATH;

    // Reset singletons
    resetLocalStorageService();
    localObsidianService.resetInstance();

    // Clean up test directory
    try {
      await fs.rm(testVaultPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a NextRequest for testing
   */
  function createRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Helper to wait for async storage operations to complete
   */
  async function waitForStorage(ms: number = 100): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  describe('POST /api/chat - conversation storage', () => {
    it('should store conversation to local storage after successful chat', async () => {
      const request = createRequest({
        message: 'Hello, how are you?',
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response is successful
      expect(response.status).toBe(200);
      expect(data.response).toBe('This is a mocked assistant response.');

      // Wait for async storage operations
      await waitForStorage();

      // Verify conversations directory was created
      const conversationsPath = path.join(testVaultPath, CONVERSATIONS_DIR);
      expect(await directoryExists(conversationsPath)).toBe(true);

      // Verify a conversation file was created
      const files = await fs.readdir(conversationsPath);
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0]).toMatch(/\.json$/);

      // Verify file content
      const filePath = path.join(conversationsPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('messages');
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].role).toBe('user');
      expect(parsed.messages[0].content).toBe('Hello, how are you?');
      expect(parsed.messages[1].role).toBe('assistant');
      expect(parsed.messages[1].content).toBe('This is a mocked assistant response.');
    });

    it('should store session when sessionId is provided', async () => {
      const sessionId = 'test-session-123';
      const request = createRequest({
        message: 'What is the weather today?',
        sessionId: sessionId,
        sessionMessages: [
          { role: 'user', content: 'Previous message', timestamp: '2026-01-16T09:00:00.000Z' },
          { role: 'assistant', content: 'Previous response', timestamp: '2026-01-16T09:00:05.000Z' },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response is successful
      expect(response.status).toBe(200);
      expect(data.sessionId).toBe(sessionId);

      // Wait for async storage operations
      await waitForStorage();

      // Verify chat-sessions directory was created
      const sessionsPath = path.join(testVaultPath, CHAT_SESSIONS_DIR);
      expect(await directoryExists(sessionsPath)).toBe(true);

      // Verify session file was created with correct name
      const sessionFilePath = path.join(sessionsPath, `${sessionId}.json`);
      const sessionExists = await fs.access(sessionFilePath).then(() => true).catch(() => false);
      expect(sessionExists).toBe(true);

      // Verify session file content
      const content = await fs.readFile(sessionFilePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.sessionId).toBe(sessionId);
      expect(parsed.title).toBe('Previous message'); // First user message truncated to 50 chars
      expect(parsed.messages).toHaveLength(4); // 2 previous + 2 new
      expect(parsed).toHaveProperty('lastActivity');
    });

    it('should create files in correct directory structure', async () => {
      const request = createRequest({
        message: 'Test message for directory structure',
        sessionId: 'dir-test-session',
      });

      await POST(request);
      await waitForStorage();

      // Verify both directories exist
      expect(await directoryExists(path.join(testVaultPath, CONVERSATIONS_DIR))).toBe(true);
      expect(await directoryExists(path.join(testVaultPath, CHAT_SESSIONS_DIR))).toBe(true);

      // Verify files are in correct locations
      const conversationFiles = await fs.readdir(path.join(testVaultPath, CONVERSATIONS_DIR));
      const sessionFiles = await fs.readdir(path.join(testVaultPath, CHAT_SESSIONS_DIR));

      expect(conversationFiles.length).toBeGreaterThanOrEqual(1);
      expect(sessionFiles).toContain('dir-test-session.json');
    });
  });

  describe('POST /api/chat - error handling', () => {
    it('should return 400 for empty message', async () => {
      const request = createRequest({
        message: '',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message cannot be empty');
    });

    it('should return 400 for whitespace-only message', async () => {
      const request = createRequest({
        message: '   ',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message cannot be empty');
    });
  });

  describe('POST /api/chat - response format', () => {
    it('should return ChatResponseWithTools format', async () => {
      const request = createRequest({
        message: 'Test message',
        sessionId: 'response-test',
      });

      const response = await POST(request);
      const data = await response.json();
      await waitForStorage();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('response');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('sessionId');
      expect(data.sessionId).toBe('response-test');
    });

    it('should return "no-session" when sessionId not provided', async () => {
      const request = createRequest({
        message: 'Test without session',
      });

      const response = await POST(request);
      const data = await response.json();
      await waitForStorage();

      expect(response.status).toBe(200);
      expect(data.sessionId).toBe('no-session');
    });
  });

  describe('POST /api/chat - file content verification', () => {
    it('should store messages with correct timestamps', async () => {
      const request = createRequest({
        message: 'Timestamp test message',
      });

      await POST(request);
      await waitForStorage();

      const conversationsPath = path.join(testVaultPath, CONVERSATIONS_DIR);
      const files = await fs.readdir(conversationsPath);
      const filePath = path.join(conversationsPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // User message should have a timestamp
      expect(parsed.messages[0].timestamp).toBeDefined();
      expect(new Date(parsed.messages[0].timestamp).toISOString()).toBe(parsed.messages[0].timestamp);

      // Assistant message should have the mocked timestamp
      expect(parsed.messages[1].timestamp).toBe('2026-01-16T10:00:05.000Z');
    });

    it('should preserve message content exactly', async () => {
      const testContent = 'Special characters: <>&"\'`\nNewlines\tTabs';
      const request = createRequest({
        message: testContent,
      });

      await POST(request);
      await waitForStorage();

      const conversationsPath = path.join(testVaultPath, CONVERSATIONS_DIR);
      const files = await fs.readdir(conversationsPath);
      const filePath = path.join(conversationsPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.messages[0].content).toBe(testContent);
    });
  });

  describe('POST /api/chat - context isolation', () => {
    it('passes a bounded agent-context bundle instead of legacy vault content', async () => {
      await POST(createRequest({ message: 'Normal agent request', model: 'glm' }));
      await waitForStorage();

      const generateResponse = vi.mocked(openRouterService.generateResponse);
      expect(generateResponse).toHaveBeenCalledTimes(1);
      const request = generateResponse.mock.calls[0][0];
      expect(request.agentContext).toEqual(expect.objectContaining({
        sources: expect.any(Array),
        missing: expect.any(Array),
        matchedProjects: expect.any(Array),
      }));
      expect(request).not.toHaveProperty('vaultContent');
      expect(request).not.toHaveProperty('memory');
    });

    it('keeps reader mode free of personal agent context', async () => {
      await POST(createRequest({
        message: 'Explain this passage',
        model: 'glm',
        mode: 'reader',
      }));
      await waitForStorage();

      const request = vi.mocked(openRouterService.generateResponse).mock.calls[0][0];
      expect(request.agentContext).toBeUndefined();
      expect(request.systemPromptOverride).toContain('reading companion');
      expect(request.systemPromptOverride).toContain('do NOT bring up his personal projects');
    });
  });
});
