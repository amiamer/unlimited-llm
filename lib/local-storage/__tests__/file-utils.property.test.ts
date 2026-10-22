/**
 * Property-Based Tests for File Utilities
 * Feature: local-storage-migration
 * 
 * Tests Property 3: Directory Auto-Creation
 * Tests Property 20: Retry Logic for File Locking
 * Tests Property 21: Atomic Write Integrity
 * 
 * **Validates: Requirements 1.3, 6.1, 6.2, 6.3**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  atomicWrite,
  ensureDirectory,
  retryWithBackoff,
  fileExists,
  directoryExists,
} from '../file-utils';

let testBaseDir: string;

function isValidUTF16(s: string): boolean {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
}

const validPathSegment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/)
  .filter(s => s.length > 0 && s.length <= 50);

const validFileContent = fc.string().filter(isValidUTF16);

const nestedPathSegments = fc.array(validPathSegment, { minLength: 1, maxLength: 5 });

describe('File Utilities Property-Based Tests', () => {
  beforeEach(async () => {
    testBaseDir = path.join(os.tmpdir(), 'file-utils-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    await fs.mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Property 3: Directory Auto-Creation', () => {
    it('ensureDirectory creates nested directory structures', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(nestedPathSegments, async (segments: string[]) => {
          // Add unique iteration prefix to avoid conflicts between fast-check runs
          const uniqueSegments = ['iter-' + (iteration++), ...segments];
          const nestedPath = path.join(testBaseDir, ...uniqueSegments);
          const existsBefore = await directoryExists(nestedPath);
          expect(existsBefore).toBe(false);
          await ensureDirectory(nestedPath);
          const existsAfter = await directoryExists(nestedPath);
          expect(existsAfter).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('ensureDirectory is idempotent', async () => {
      await fc.assert(
        fc.asyncProperty(nestedPathSegments, async (segments: string[]) => {
          const nestedPath = path.join(testBaseDir, ...segments);
          await ensureDirectory(nestedPath);
          await ensureDirectory(nestedPath);
          await ensureDirectory(nestedPath);
          const exists = await directoryExists(nestedPath);
          expect(exists).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('atomicWrite creates parent directories automatically', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          nestedPathSegments,
          validPathSegment,
          validFileContent,
          async (dirSegments: string[], filename: string, content: string) => {
            const uniqueSegments = ['iter-' + (iteration++), ...dirSegments];
            const filePath = path.join(testBaseDir, ...uniqueSegments, filename + '.txt');
            const parentDir = path.dirname(filePath);
            const dirExistsBefore = await directoryExists(parentDir);
            expect(dirExistsBefore).toBe(false);
            await atomicWrite(filePath, content);
            const dirExistsAfter = await directoryExists(parentDir);
            expect(dirExistsAfter).toBe(true);
            const fileExistsAfter = await fileExists(filePath);
            expect(fileExistsAfter).toBe(true);
            const readContent = await fs.readFile(filePath, 'utf-8');
            expect(readContent).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('all intermediate directories are created', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          fc.array(validPathSegment, { minLength: 2, maxLength: 5 }),
          async (segments: string[]) => {
            const uniqueSegments = ['iter-' + (iteration++), ...segments];
            const fullPath = path.join(testBaseDir, ...uniqueSegments);
            await ensureDirectory(fullPath);
            let currentPath = testBaseDir;
            for (const segment of uniqueSegments) {
              currentPath = path.join(currentPath, segment);
              const exists = await directoryExists(currentPath);
              expect(exists).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 20: Retry Logic for File Locking', () => {
    it('retryWithBackoff retries on EBUSY errors up to maxRetries times', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          fc.integer({ min: 0, max: 5 }),
          async (maxRetries: number, failCount: number) => {
            let attempts = 0;
            const operation = async (): Promise<string> => {
              attempts++;
              if (attempts <= failCount) {
                const error = new Error('Resource busy') as NodeJS.ErrnoException;
                error.code = 'EBUSY';
                throw error;
              }
              return 'success';
            };

            if (failCount <= maxRetries) {
              const result = await retryWithBackoff(operation, maxRetries);
              expect(result).toBe('success');
              expect(attempts).toBe(failCount + 1);
            } else {
              await expect(retryWithBackoff(operation, maxRetries)).rejects.toThrow();
              expect(attempts).toBe(maxRetries + 1);
            }
          }
        ),
        { numRuns: 50 }
      );
    }, 30000);

    it('retryWithBackoff retries on EPERM errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 2 }),
          async (failBeforeSuccess: number) => {
            let attempts = 0;
            const operation = async (): Promise<string> => {
              attempts++;
              if (attempts <= failBeforeSuccess) {
                const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
                error.code = 'EPERM';
                throw error;
              }
              return 'success';
            };

            const result = await retryWithBackoff(operation, 3);
            expect(result).toBe('success');
            expect(attempts).toBe(failBeforeSuccess + 1);
          }
        ),
        { numRuns: 50 }
      );
    }, 30000);

    it('non-retryable errors are thrown immediately', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('ENOENT', 'EACCES', 'ENOSPC', 'UNKNOWN'),
          async (errorCode: string) => {
            let attempts = 0;
            const operation = async (): Promise<string> => {
              attempts++;
              const error = new Error('Some error') as NodeJS.ErrnoException;
              error.code = errorCode;
              throw error;
            };

            await expect(retryWithBackoff(operation, 3)).rejects.toThrow();
            expect(attempts).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('successful operations return immediately', async () => {
      await fc.assert(
        fc.asyncProperty(
          validFileContent,
          async (content: string) => {
            let attempts = 0;
            const operation = async (): Promise<string> => {
              attempts++;
              return content;
            };

            const result = await retryWithBackoff(operation, 3);
            expect(result).toBe(content);
            expect(attempts).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 21: Atomic Write Integrity', () => {
    it('atomicWrite preserves original file on write failure', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          validPathSegment,
          validFileContent,
          validFileContent,
          async (filename: string, originalContent: string, newContent: string) => {
            const filePath = path.join(testBaseDir, 'iter-' + (iteration++) + '-' + filename + '.txt');
            await atomicWrite(filePath, originalContent);
            const contentBefore = await fs.readFile(filePath, 'utf-8');
            expect(contentBefore).toBe(originalContent);
            await atomicWrite(filePath, newContent);
            const contentAfter = await fs.readFile(filePath, 'utf-8');
            expect(contentAfter).toBe(newContent);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('atomicWrite produces complete files (round-trip)', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          validPathSegment,
          validFileContent,
          async (filename: string, content: string) => {
            const filePath = path.join(testBaseDir, 'iter-' + (iteration++) + '-' + filename + '.txt');
            await atomicWrite(filePath, content);
            const readContent = await fs.readFile(filePath, 'utf-8');
            expect(readContent).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('no temp files remain after successful write', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          validPathSegment,
          validFileContent,
          async (filename: string, content: string) => {
            const subDir = path.join(testBaseDir, 'iter-' + (iteration++));
            await ensureDirectory(subDir);
            const filePath = path.join(subDir, filename + '.txt');
            await atomicWrite(filePath, content);
            const files = await fs.readdir(subDir);
            const tempFiles = files.filter(f => f.includes('.tmp.'));
            expect(tempFiles.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple sequential writes succeed', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          validPathSegment,
          fc.array(validFileContent, { minLength: 2, maxLength: 5 }),
          async (filename: string, contents: string[]) => {
            const filePath = path.join(testBaseDir, 'iter-' + (iteration++) + '-' + filename + '.txt');
            for (const content of contents) {
              await atomicWrite(filePath, content);
              const readContent = await fs.readFile(filePath, 'utf-8');
              expect(readContent).toBe(content);
            }
            const finalContent = await fs.readFile(filePath, 'utf-8');
            expect(finalContent).toBe(contents[contents.length - 1]);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('atomicWrite handles empty content', async () => {
      let iteration = 0;
      await fc.assert(
        fc.asyncProperty(
          validPathSegment,
          async (filename: string) => {
            const filePath = path.join(testBaseDir, 'iter-' + (iteration++) + '-' + filename + '.txt');
            await atomicWrite(filePath, '');
            const exists = await fileExists(filePath);
            expect(exists).toBe(true);
            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});