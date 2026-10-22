import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../session-manager';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as any;

describe('SessionManager Error Handling', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Local Storage Quota Exceeded', () => {
    it('should throw descriptive error when quota exceeded', () => {
      // Mock localStorage.setItem to throw QuotaExceededError
      const quotaError = new Error('QuotaExceededError');
      quotaError.name = 'QuotaExceededError';
      
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw quotaError;
      });

      expect(() => {
        sessionManager.createSession('https://example.com/book.epub', 'Test Book');
      }).toThrow('Storage quota exceeded');
      expect(() => {
        sessionManager.createSession('https://example.com/book.epub', 'Test Book');
      }).toThrow('delete some old reading sessions');
      
      // Restore original
      localStorage.setItem = originalSetItem;
    });

    it('should handle corrupted session data gracefully', () => {
      // Store invalid JSON
      localStorage.setItem('epub-reader-sessions', 'invalid json {');

      const sessions = sessionManager.getAllSessions();

      expect(sessions).toEqual([]);
    });

    it('should filter out invalid sessions', () => {
      const validSession = {
        id: '1',
        epubUrl: 'https://example.com/book.epub',
        title: 'Valid Book',
        currentChapter: 0,
        currentSentence: 0,
        lastAccessed: Date.now(),
        createdAt: Date.now(),
      };

      const invalidSession = {
        id: '2',
        // Missing required fields
        title: 'Invalid Book',
      };

      localStorage.setItem(
        'epub-reader-sessions',
        JSON.stringify([validSession, invalidSession])
      );

      const sessions = sessionManager.getAllSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('1');
    });
  });

  describe('S3 URL Validation', () => {
    it('should throw error for invalid S3 URL', async () => {
      const session = sessionManager.createSession(
        'https://example.com/deleted.epub',
        'Deleted Book'
      );

      // Mock fetch to return 404
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(sessionManager.getSession(session.id)).rejects.toThrow(
        'This book is no longer available'
      );
    });

    it('should throw error for malformed S3 URL', async () => {
      const session = sessionManager.createSession(
        'not-a-valid-url',
        'Invalid URL Book'
      );

      await expect(sessionManager.getSession(session.id)).rejects.toThrow(
        'This book is no longer available'
      );
    });

    it('should succeed for valid S3 URL', async () => {
      const session = sessionManager.createSession(
        'https://example.com/valid.epub',
        'Valid Book'
      );

      // Mock fetch to return 200
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const retrievedSession = await sessionManager.getSession(session.id);

      expect(retrievedSession).not.toBeNull();
      expect(retrievedSession?.id).toBe(session.id);
    });

    it('should handle network errors during validation', async () => {
      const session = sessionManager.createSession(
        'https://example.com/book.epub',
        'Test Book'
      );

      // Mock fetch to throw network error
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(sessionManager.getSession(session.id)).rejects.toThrow(
        'This book is no longer available'
      );
    });
  });

  describe('Session Not Found', () => {
    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('non-existent-id');

      expect(session).toBeNull();
    });

    it('should throw error when updating non-existent session', () => {
      expect(() => {
        sessionManager.updateSession('non-existent-id', { currentChapter: 1 });
      }).toThrow('Session not found');
    });
  });

  describe('Error Logging', () => {
    it('should log errors when loading sessions fails', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Store invalid JSON
      localStorage.setItem('epub-reader-sessions', 'invalid json');

      sessionManager.getAllSessions();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading sessions'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should log when sessions are filtered out', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const validSession = {
        id: '1',
        epubUrl: 'https://example.com/book.epub',
        title: 'Valid Book',
        currentChapter: 0,
        currentSentence: 0,
        lastAccessed: Date.now(),
        createdAt: Date.now(),
      };

      const invalidSession = {
        id: '2',
        title: 'Invalid Book',
      };

      localStorage.setItem(
        'epub-reader-sessions',
        JSON.stringify([validSession, invalidSession])
      );

      sessionManager.getAllSessions();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Filtered out 1 invalid sessions')
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
