import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../session-manager';

/**
 * Unit Tests for SessionManager
 * Requirements: 7.1, 7.2, 7.3, 7.6, 8.5
 */

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

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock fetch for S3 URL validation
global.fetch = vi.fn();

describe('SessionManager - Unit Tests', () => {
  let manager: SessionManager;

  beforeEach(() => {
    localStorageMock.clear();
    manager = new SessionManager();
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({ ok: true });
  });

  describe('createSession', () => {
    it('should create a new session with all required fields', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');

      expect(session.id).toBeDefined();
      expect(session.epubUrl).toBe('https://example.com/book.epub');
      expect(session.title).toBe('My Book');
      expect(session.currentChapter).toBe(0);
      expect(session.currentSentence).toBe(0);
      expect(session.lastAccessed).toBeDefined();
      expect(session.createdAt).toBeDefined();
    });

    it('should persist session to localStorage', () => {
      manager.createSession('https://example.com/book.epub', 'My Book');

      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].title).toBe('My Book');
    });
  });

  describe('updateSession', () => {
    it('should update session fields', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');
      
      manager.updateSession(session.id, {
        currentChapter: 5,
        currentSentence: 10,
      });

      const updated = manager.getAllSessions()[0];
      expect(updated.currentChapter).toBe(5);
      expect(updated.currentSentence).toBe(10);
    });

    it('should update lastAccessed timestamp', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');
      const originalTimestamp = session.lastAccessed;

      // Wait a bit
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      manager.updateSession(session.id, { currentChapter: 1 });

      vi.useRealTimers();

      const updated = manager.getAllSessions()[0];
      expect(updated.lastAccessed).toBeGreaterThan(originalTimestamp);
    });

    it('should throw error for non-existent session', () => {
      expect(() => {
        manager.updateSession('non-existent-id', { currentChapter: 1 });
      }).toThrow('Session not found');
    });
  });

  describe('getSession', () => {
    it('should return session by ID', async () => {
      const created = manager.createSession('https://example.com/book.epub', 'My Book');
      
      const session = await manager.getSession(created.id);
      
      expect(session).toBeDefined();
      expect(session?.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const session = await manager.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should validate S3 URL before returning session', async () => {
      const created = manager.createSession('https://example.com/book.epub', 'My Book');
      
      await manager.getSession(created.id);
      
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/book.epub', { method: 'HEAD' });
    });

    it('should throw error if S3 URL is invalid', async () => {
      (global.fetch as any).mockResolvedValue({ ok: false });
      
      const created = manager.createSession('https://example.com/book.epub', 'My Book');
      
      await expect(manager.getSession(created.id)).rejects.toThrow(
        'This book is no longer available'
      );
    });
  });

  describe('getAllSessions', () => {
    it('should return empty array when no sessions exist', () => {
      const sessions = manager.getAllSessions();
      expect(sessions).toEqual([]);
    });

    it('should return all sessions', () => {
      manager.createSession('https://example.com/book1.epub', 'Book 1');
      manager.createSession('https://example.com/book2.epub', 'Book 2');
      manager.createSession('https://example.com/book3.epub', 'Book 3');

      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(3);
    });

    it('should order sessions by lastAccessed descending', () => {
      vi.useFakeTimers();
      
      const session1 = manager.createSession('https://example.com/book1.epub', 'Book 1');
      vi.advanceTimersByTime(1000);
      
      const session2 = manager.createSession('https://example.com/book2.epub', 'Book 2');
      vi.advanceTimersByTime(1000);
      
      const session3 = manager.createSession('https://example.com/book3.epub', 'Book 3');
      
      vi.useRealTimers();

      const sessions = manager.getAllSessions();
      expect(sessions[0].id).toBe(session3.id); // Most recent
      expect(sessions[1].id).toBe(session2.id);
      expect(sessions[2].id).toBe(session1.id); // Oldest
    });

    it('should filter out invalid session data', () => {
      // Create valid session
      manager.createSession('https://example.com/book.epub', 'Valid Book');

      // Manually corrupt localStorage
      const sessions = JSON.parse(localStorage.getItem('epub-reader-sessions') || '[]');
      sessions.push({ invalid: 'data' });
      localStorage.setItem('epub-reader-sessions', JSON.stringify(sessions));

      // Should only return valid session
      const validSessions = manager.getAllSessions();
      expect(validSessions.length).toBe(1);
      expect(validSessions[0].title).toBe('Valid Book');
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('epub-reader-sessions', 'invalid json');

      const sessions = manager.getAllSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    it('should remove session from storage', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');
      
      manager.deleteSession(session.id);
      
      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(0);
    });

    it('should only delete specified session', () => {
      const session1 = manager.createSession('https://example.com/book1.epub', 'Book 1');
      const session2 = manager.createSession('https://example.com/book2.epub', 'Book 2');
      
      manager.deleteSession(session1.id);
      
      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe(session2.id);
    });

    it('should handle deleting non-existent session gracefully', () => {
      manager.createSession('https://example.com/book.epub', 'My Book');
      
      expect(() => {
        manager.deleteSession('non-existent-id');
      }).not.toThrow();
      
      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(1);
    });
  });

  describe('updatePosition', () => {
    it('should update chapter and sentence position', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');
      
      manager.updatePosition(session.id, 3, 15);
      
      const updated = manager.getAllSessions()[0];
      expect(updated.currentChapter).toBe(3);
      expect(updated.currentSentence).toBe(15);
    });

    it('should update lastAccessed timestamp', () => {
      const session = manager.createSession('https://example.com/book.epub', 'My Book');
      const originalTimestamp = session.lastAccessed;

      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      manager.updatePosition(session.id, 1, 5);

      vi.useRealTimers();

      const updated = manager.getAllSessions()[0];
      expect(updated.lastAccessed).toBeGreaterThan(originalTimestamp);
    });
  });

  describe('storage quota handling', () => {
    it('should throw descriptive error when quota exceeded', () => {
      // Mock localStorage.setItem to throw QuotaExceededError
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn().mockImplementation(() => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      });

      expect(() => {
        manager.createSession('https://example.com/book.epub', 'My Book');
      }).toThrow('Storage quota exceeded');

      // Restore
      localStorage.setItem = originalSetItem;
    });
  });
});
