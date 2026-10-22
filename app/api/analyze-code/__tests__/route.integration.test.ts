/**
 * Integration tests for Code Analysis API route
 * 
 * Tests the full flow from API request to local file analysis:
 * - POST request triggers local code analysis
 * - Verify response matches expected format
 * - Verify file discovery and selection works
 * 
 * Requirements: 17.3, 17.4, 17.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

describe('Code Analysis API Integration Tests', () => {
  let testWorkspacePath: string;
  let originalCwd: string;
  let POST: typeof import('../route').POST;

  beforeEach(async () => {
    // Reset modules
    vi.resetModules();
    
    // Save original cwd
    originalCwd = process.cwd();
    
    // Create a unique temp directory for each test
    testWorkspacePath = path.join(
      os.tmpdir(),
      `code-analysis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testWorkspacePath, { recursive: true });

    // Create some test files
    await fs.writeFile(
      path.join(testWorkspacePath, 'README.md'),
      '# Test Project\n\nThis is a test project for code analysis.'
    );
    await fs.writeFile(
      path.join(testWorkspacePath, 'auth.ts'),
      'export function authenticate(user: string) { return true; }'
    );
    await fs.writeFile(
      path.join(testWorkspacePath, 'utils.ts'),
      'export function helper() { return "helper"; }'
    );

    // Change to test workspace
    process.chdir(testWorkspacePath);
    
    // Import POST after changing directory
    const routeModule = await import('../route');
    POST = routeModule.POST;
  });

  afterEach(async () => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up test directory
    try {
      await fs.rm(testWorkspacePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a NextRequest for testing
   */
  function createRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/analyze-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  describe('POST /api/analyze-code - basic functionality', () => {
    it('should return analysis result for valid question', async () => {
      const request = createRequest({
        question: 'How does authentication work?',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('question');
      expect(data).toHaveProperty('answer');
      expect(data.question).toBe('How does authentication work?');
      expect(typeof data.answer).toBe('string');
    });

    it('should include relevant files in answer', async () => {
      const request = createRequest({
        question: 'What is in the auth file?',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // The answer should contain file content with separator
      expect(data.answer).toContain('auth.ts');
    });

    it('should return formatted file content', async () => {
      const request = createRequest({
        question: 'Show me the utils',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should contain the separator format
      expect(data.answer).toMatch(/---.*---/);
    });
  });

  describe('POST /api/analyze-code - error handling', () => {
    it('should return 400 for missing question', async () => {
      const request = createRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('empty');
    });

    it('should return 400 for empty question', async () => {
      const request = createRequest({
        question: '',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('empty');
    });

    it('should return 400 for whitespace-only question', async () => {
      const request = createRequest({
        question: '   ',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('empty');
    });
  });

  describe('POST /api/analyze-code - response format', () => {
    it('should return CodeAnalysisResult format', async () => {
      const request = createRequest({
        question: 'What files are in this project?',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('question');
      expect(data).toHaveProperty('answer');
      expect(typeof data.question).toBe('string');
      expect(typeof data.answer).toBe('string');
    });

    it('should preserve original question in response', async () => {
      const originalQuestion = 'How does the helper function work?';
      const request = createRequest({
        question: originalQuestion,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.question).toBe(originalQuestion);
    });
  });

  describe('POST /api/analyze-code - file selection', () => {
    it('should select files based on keywords in question', async () => {
      const request = createRequest({
        question: 'What is in the auth file?',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should include auth.ts since "auth" is a keyword
      expect(data.answer).toContain('auth.ts');
    });

    it('should include README when available', async () => {
      const request = createRequest({
        question: 'What is this project about?',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should include README content
      expect(data.answer).toContain('README');
    });
  });
});
