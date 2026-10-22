import { ReadingSession } from '@/lib/types/reader';

/**
 * SessionManager - Manages reading session persistence in local storage
 * Requirements: 7.1, 7.2, 7.3, 7.6, 8.5
 */

const STORAGE_KEY = 'epub-reader-sessions';

export class SessionManager {
  /**
   * Create a new reading session
   * Requirements: 7.1, 7.6
   * Uses sanitized title as ID to match audiobook folder structure
   */
  createSession(epubUrl: string, title: string): ReadingSession {
    // Use sanitized title as ID to match audiobook folder naming
    // Don't lowercase to preserve original casing
    const sanitizedId = title.replace(/[<>:"/\\|?*]/g, '_');
    
    const session: ReadingSession = {
      id: sanitizedId,
      epubUrl,
      title,
      currentChapter: 0,
      currentSentence: 0,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
    };

    const sessions = this.getAllSessions();
    
    // Check if session with this ID already exists
    const existingIndex = sessions.findIndex(s => s.id === sanitizedId);
    if (existingIndex !== -1) {
      // Update existing session instead of creating duplicate
      sessions[existingIndex] = {
        ...sessions[existingIndex],
        ...session,
        lastAccessed: Date.now(),
      };
    } else {
      sessions.push(session);
    }
    
    this.saveSessions(sessions);

    return session;
  }

  /**
   * Update an existing session
   * Requirements: 7.2
   */
  updateSession(sessionId: string, updates: Partial<ReadingSession>): void {
    const sessions = this.getAllSessions();
    const index = sessions.findIndex(s => s.id === sessionId);

    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    sessions[index] = {
      ...sessions[index],
      ...updates,
      lastAccessed: Date.now(),
    };

    this.saveSessions(sessions);
  }

  /**
   * Get a session by ID with URL validation
   * Requirements: 7.1, 7.5
   */
  async getSession(sessionId: string): Promise<ReadingSession | null> {
    const sessions = this.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      return null;
    }

    // Validate URL (works for both S3 URLs and local API paths)
    const isValid = await this.validateUrl(session.epubUrl);
    if (!isValid) {
      throw new Error('This book is no longer available. The file may have been deleted.');
    }

    return session;
  }

  /**
   * Get all sessions ordered by last accessed
   * Requirements: 7.4, 8.4
   */
  getAllSessions(): ReadingSession[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        return [];
      }

      const sessions = JSON.parse(data) as ReadingSession[];
      
      // Validate session data
      const validSessions = sessions.filter(this.isValidSession);
      
      // Log if any sessions were filtered out
      if (validSessions.length < sessions.length) {
        console.warn(`Filtered out ${sessions.length - validSessions.length} invalid sessions`);
      }

      // Sort by lastAccessed descending (most recent first)
      return validSessions.sort((a, b) => b.lastAccessed - a.lastAccessed);
    } catch (error) {
      console.error('Error loading sessions from local storage:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          timestamp: new Date().toISOString(),
        });
      }
      return [];
    }
  }

  /**
   * Sync sessions from disk-scanned books.
   * Creates localStorage sessions for any books found on disk that
   * don't already have a session. Preserves existing session state
   * (chapter/sentence position) for books that do have sessions.
   * Returns the updated session list.
   */
  syncFromDisk(diskBooks: { id: string; title: string; servingUrl: string }[]): ReadingSession[] {
    const existingSessions = this.getAllSessions();
    const existingIds = new Set(existingSessions.map(s => s.id));
    let added = 0;

    for (const book of diskBooks) {
      if (!existingIds.has(book.id)) {
        existingSessions.push({
          id: book.id,
          epubUrl: book.servingUrl,
          title: book.title,
          currentChapter: 0,
          currentSentence: 0,
          lastAccessed: Date.now() - added, // slight offset so ordering is stable
          createdAt: Date.now(),
        });
        added++;
      }
    }

    if (added > 0) {
      this.saveSessions(existingSessions);
      console.log(`Synced ${added} book(s) from disk into localStorage`);
    }

    return this.getAllSessions();
  }

  /**
   * Delete a session
   * Requirements: 8.5
   */
  deleteSession(sessionId: string): void {
    const sessions = this.getAllSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    this.saveSessions(filtered);
  }


  /**
   * Update reading position
   * Requirements: 7.2
   */
  updatePosition(sessionId: string, chapter: number, sentence: number): void {
    this.updateSession(sessionId, {
      currentChapter: chapter,
      currentSentence: sentence,
    });
  }

  /**
   * Validate URL by making a HEAD request
   * Handles both S3 URLs and local API paths
   * Requirements: 7.5
   */
  private async validateUrl(url: string): Promise<boolean> {
    try {
      let fullUrl: string;
      
      // Check if it's a relative path (local API)
      if (url.startsWith('/api/')) {
        // Convert to full URL for validation
        fullUrl = `${window.location.origin}${url}`;
      } else {
        // Assume it's already a full URL (S3 or other)
        fullUrl = url;
        // Validate URL format
        new URL(fullUrl);
      }

      // Make HEAD request to verify file exists
      const response = await fetch(fullUrl, { method: 'HEAD' });
      
      if (!response.ok) {
        console.error(`URL validation failed for ${url}: ${response.status} ${response.statusText}`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('URL validation error:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          url,
          timestamp: new Date().toISOString(),
        });
      }
      return false;
    }
  }

  /**
   * Validate session data structure
   */
  private isValidSession(session: unknown): session is ReadingSession {
    if (!session || typeof session !== 'object') return false;
    const s = session as Record<string, unknown>;
    return (
      typeof s.id === 'string' &&
      typeof s.epubUrl === 'string' &&
      typeof s.title === 'string' &&
      typeof s.currentChapter === 'number' &&
      typeof s.currentSentence === 'number' &&
      typeof s.lastAccessed === 'number' &&
      typeof s.createdAt === 'number'
    );
  }

  /**
   * Save sessions to local storage with quota error handling
   * Requirements: 7.3
   */
  private saveSessions(sessions: ReadingSession[]): void {
    try {
      const data = JSON.stringify(sessions);
      localStorage.setItem(STORAGE_KEY, data);
      console.log(`Successfully saved ${sessions.length} sessions to local storage`);
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.error('Local storage quota exceeded:', {
          sessionCount: sessions.length,
          dataSize: JSON.stringify(sessions).length,
          timestamp: new Date().toISOString(),
        });
        throw new Error('Storage quota exceeded. Please delete some old reading sessions to free up space.');
      }
      console.error('Error saving sessions to local storage:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
