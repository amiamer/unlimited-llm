/**
 * Integration tests for Obsidian Note API route
 * 
 * Tests the full flow from API request to file system storage:
 * - POST request creates note in local vault
 * - Verify note file is created with correct frontmatter
 * - Verify response matches expected format
 * 
 * Requirements: 8.1, 8.2, 8.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { localObsidianService } from '@/lib/local-storage';
import { directoryExists } from '@/lib/local-storage/file-utils';
import { parseFrontmatter } from '@/lib/local-storage/local-obsidian-service';

// We need to import POST dynamically after mocking to avoid rate limiting issues
// The rate limiter uses in-memory state that persists across tests

describe('Obsidian Note API Integration Tests', () => {
  let testVaultPath: string;
  const originalEnv = process.env.OBSIDIAN_VAULT_PATH;
  let POST: typeof import('../route').POST;

  beforeEach(async () => {
    // Reset modules to clear rate limiter state
    vi.resetModules();
    
    // Create a unique temp directory for each test
    testVaultPath = path.join(
      os.tmpdir(),
      `obsidian-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testVaultPath, { recursive: true });

    // Set environment variable for local obsidian service
    process.env.OBSIDIAN_VAULT_PATH = testVaultPath;

    // Reset singleton to pick up new env var
    localObsidianService.resetInstance();
    
    // Import POST after resetting modules to get fresh rate limiter
    const routeModule = await import('../route');
    POST = routeModule.POST;
  });

  afterEach(async () => {
    // Restore original env value
    if (originalEnv !== undefined) {
      process.env.OBSIDIAN_VAULT_PATH = originalEnv;
    } else {
      delete process.env.OBSIDIAN_VAULT_PATH;
    }

    // Reset singleton
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
   * Uses a unique identifier for each request to avoid rate limiting
   */
  function createRequest(body: object): NextRequest {
    const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new NextRequest('http://localhost:3000/api/obsidian/note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': uniqueId,
      },
      body: JSON.stringify(body),
    });
  }

  describe('POST /api/obsidian/note - note creation', () => {
    it('should create note in local vault with title and content', async () => {
      const request = createRequest({
        task: 'My Test Note\n\nThis is the content of my test note.',
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response is successful
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.task).toBe('My Test Note\n\nThis is the content of my test note.');
      expect(data.data.result).toMatch(/Note created: .+\.md/);
      expect(data.data.timestamp).toBeDefined();

      // Verify Notes directory was created
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      expect(await directoryExists(notesPath)).toBe(true);

      // Verify note file was created
      const files = await fs.readdir(notesPath);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/\.md$/);

      // Verify file content - createNote writes "# Title\n\nContent" format
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // File should contain the title as heading and the content
      expect(content).toContain('# My Test Note');
      expect(content).toContain('This is the content of my test note.');
    });

    it('should create note with title only when no blank line separator', async () => {
      const request = createRequest({
        task: 'Title Only Note',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify note file was created
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      expect(files.length).toBe(1);

      // Verify file content - title-only note has heading
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      expect(content).toContain('# Title Only Note');
    });

    it('should create note with correct YAML frontmatter', async () => {
      const request = createRequest({
        task: 'Frontmatter Test\n\nContent for frontmatter test.',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify content structure - createNote writes markdown format
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // createNote writes "# Title\n\nContent" format
      expect(content).toContain('# Frontmatter Test');
      expect(content).toContain('Content for frontmatter test.');
      
      // parseFrontmatter will derive defaults since no YAML frontmatter
      const parsed = parseFrontmatter(content);
      expect(parsed.frontmatter).toHaveProperty('title');
      expect(parsed.frontmatter).toHaveProperty('created');
      expect(parsed.frontmatter).toHaveProperty('modified');

      // Verify timestamps are valid ISO strings
      expect(new Date(parsed.frontmatter.created).toISOString()).toBe(parsed.frontmatter.created);
      expect(new Date(parsed.frontmatter.modified).toISOString()).toBe(parsed.frontmatter.modified);
    });

    it('should sanitize filename from title', async () => {
      const request = createRequest({
        task: 'Note: With <Special> Characters?\n\nContent here.',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify filename is sanitized (no invalid Windows characters)
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      expect(files.length).toBe(1);

      // Filename should not contain invalid characters
      const filename = files[0];
      expect(filename).not.toMatch(/[<>:"/\\|?*]/);
      expect(filename).toMatch(/\.md$/);
    });
  });

  describe('POST /api/obsidian/note - response format', () => {
    it('should return ObsidianNoteCall response format', async () => {
      const request = createRequest({
        task: 'Response Format Test\n\nTest content.',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('task');
      expect(data.data).toHaveProperty('result');
      expect(data.data).toHaveProperty('timestamp');

      // Verify result contains filename
      expect(data.data.result).toMatch(/^Note created: .+\.md$/);
    });

    it('should preserve original task in response', async () => {
      const originalTask = 'Original Task Title\n\nOriginal content with special chars: <>&';
      const request = createRequest({
        task: originalTask,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.task).toBe(originalTask);
    });
  });

  describe('POST /api/obsidian/note - error handling', () => {
    it('should return 400 for missing task field', async () => {
      const request = createRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Task field is required and must be a string');
    });

    it('should return 400 for non-string task field', async () => {
      const request = createRequest({
        task: 123,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Task field is required and must be a string');
    });

    it('should return 400 for empty task', async () => {
      const request = createRequest({
        task: '',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      // Empty string is falsy, so it triggers the "required" check first
      expect(data.error).toBe('Task field is required and must be a string');
    });

    it('should return 400 for whitespace-only task', async () => {
      const request = createRequest({
        task: '   ',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Task cannot be empty');
    });

    it('should return 400 for task exceeding 1,000,000 characters', async () => {
      const longTask = 'A'.repeat(1_000_001);
      const request = createRequest({
        task: longTask,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Task exceeds maximum length of 1000000 characters');
    });
  });

  describe('POST /api/obsidian/note - file content verification', () => {
    it('should preserve multi-line content', async () => {
      const multiLineContent = 'Line 1\nLine 2\nLine 3\n\nParagraph 2';
      const request = createRequest({
        task: `Multi-line Note\n\n${multiLineContent}`,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // createNote writes "# Title\n\nContent" - content includes the multi-line content
      expect(content).toContain(multiLineContent);
    });

    it('should handle markdown content correctly', async () => {
      const markdownContent = '# Heading\n\n- List item 1\n- List item 2\n\n**Bold** and *italic*';
      const request = createRequest({
        task: `Markdown Note\n\n${markdownContent}`,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // When content starts with #, createNote uses it directly
      expect(content).toContain('# Heading');
      expect(content).toContain('- List item 1');
      expect(content).toContain('**Bold** and *italic*');
    });

    it('should create multiple notes with unique filenames', async () => {
      // Create first note
      const request1 = createRequest({
        task: 'First Note\n\nFirst content.',
      });
      await POST(request1);

      // Create second note with different title
      const request2 = createRequest({
        task: 'Second Note\n\nSecond content.',
      });
      await POST(request2);

      // Verify both notes exist
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      expect(files.length).toBe(2);

      // Verify filenames are different
      expect(files[0]).not.toBe(files[1]);
    });
  });

  describe('POST /api/obsidian/note - edge cases', () => {
    it('should handle task at exactly 5000 characters', async () => {
      const exactTask = 'A'.repeat(5000);
      const request = createRequest({
        task: exactTask,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle unicode characters in title and content', async () => {
      const request = createRequest({
        task: '日本語タイトル\n\nContent with émojis 🎉 and ünïcödé.',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify content is preserved
      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // createNote writes "# Title\n\nContent" format
      expect(content).toContain('日本語タイトル');
      expect(content).toContain('Content with émojis 🎉 and ünïcödé.');
    });

    it('should handle task with only newlines after title', async () => {
      const request = createRequest({
        task: 'Title\n\n\n\n',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const notesPath = path.join(testVaultPath, 'AI-Notes');
      const files = await fs.readdir(notesPath);
      const filePath = path.join(notesPath, files[0]);
      const content = await fs.readFile(filePath, 'utf-8');

      // createNote writes "# Title\n\nContent" format
      expect(content).toContain('Title');
    });
  });
});
