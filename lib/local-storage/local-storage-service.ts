/**
 * LocalStorageService - Local file system storage for chat conversations
 * 
 * This service replaces the S3-based storage-service.ts and ChatHistoryService
 * with local file system operations. It provides:
 * - Storage operations for conversations and sessions
 * - History retrieval with caching
 * - Tag management
 * - Conversation deletion
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1-2.7, 3.1-3.6, 8.1, 8.2, 9.1, 9.3
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { FileChangeCache } from './file-change-cache';
import { ensureDirectory, atomicWrite, directoryExists, readFileWithRetry, getDirectoryFileInfo, deleteFileWithRetry } from './file-utils';
import { sanitizeTimestamp } from './path-utils';
import { ConfigurationError } from './errors';
import type {
  LocalStorageConfig,
  Message,
  ConversationSession,
  ConversationFile,
  SessionFile,
  ParsedMessage,
  CacheMetadata,
  MetadataFile,
} from './types';

/**
 * Type guard to check if an error has a code property (Node.js error)
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Default configuration values
 */
const DEFAULT_RETRY_ON_LOCK = true;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Session grouping threshold in milliseconds (30 minutes)
 * Messages within this threshold belong to the same session.
 * A gap > 30 minutes starts a new session.
 * 
 * Requirements: 2.4
 */
const SESSION_GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Environment variable name for chat vault path
 */
const CHAT_VAULT_PATH_ENV = 'CHAT_VAULT_PATH';

/**
 * Subdirectory names within the chat vault
 */
export const CONVERSATIONS_DIR = 'conversations';
export const CHAT_SESSIONS_DIR = 'chat-sessions';
export const CHAT_MESSAGES_DIR = 'chat-messages';
export const METADATA_DIR = 'metadata';

/**
 * LocalStorageService provides local file system storage for chat data
 * 
 * This service is a drop-in replacement for the S3-based storage services,
 * providing the same interfaces while operating entirely on the local file system.
 * 
 * @example
 * // Using environment variable (recommended)
 * const service = new LocalStorageService();
 * 
 * // Using explicit configuration
 * const service = new LocalStorageService({
 *   chatVaultPath: 'C:\\Chats',
 *   retryOnLock: true,
 *   maxRetries: 3
 * });
 * 
 * // Store a conversation
 * await service.storeConversation(messages);
 * 
 * // Retrieve all conversations
 * const conversations = await service.getAllConversations();
 */
export class LocalStorageService {
  private readonly config: LocalStorageConfig;
  private readonly cache: FileChangeCache;

  /**
   * Directory paths derived from config
   */
  private readonly conversationsPath: string;
  private readonly chatSessionsPath: string;
  private readonly chatMessagesPath: string;
  private readonly metadataPath: string;

  /**
   * Creates a new LocalStorageService instance
   * 
   * If no config is provided, reads from CHAT_VAULT_PATH environment variable.
   * Throws ConfigurationError if the environment variable is not set.
   * 
   * @param config - Optional configuration object
   * @throws ConfigurationError if CHAT_VAULT_PATH is not set and no config provided
   * 
   * Requirements: 1.1, 1.2, 9.1, 9.3
   */
  constructor(config?: LocalStorageConfig) {
    // Load configuration from env var if not provided
    if (config) {
      this.config = this.normalizeConfig(config);
    } else {
      const chatVaultPath = process.env[CHAT_VAULT_PATH_ENV];
      
      if (!chatVaultPath) {
        throw new ConfigurationError(CHAT_VAULT_PATH_ENV);
      }
      
      this.config = this.normalizeConfig({ chatVaultPath });
    }

    // Initialize cache
    this.cache = new FileChangeCache();

    // Compute directory paths
    this.conversationsPath = path.join(this.config.chatVaultPath, CONVERSATIONS_DIR);
    this.chatSessionsPath = path.join(this.config.chatVaultPath, CHAT_SESSIONS_DIR);
    this.chatMessagesPath = path.join(this.config.chatVaultPath, CHAT_MESSAGES_DIR);
    this.metadataPath = path.join(this.chatMessagesPath, METADATA_DIR);
  }

  /**
   * Normalizes configuration with default values
   * 
   * @param config - The configuration to normalize
   * @returns Normalized configuration with defaults applied
   */
  private normalizeConfig(config: LocalStorageConfig): LocalStorageConfig {
    return {
      chatVaultPath: path.normalize(config.chatVaultPath),
      dualWriteMode: config.dualWriteMode ?? false,
      fallbackToS3: config.fallbackToS3 ?? false,
      retryOnLock: config.retryOnLock ?? DEFAULT_RETRY_ON_LOCK,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
  }

  /**
   * Ensures all required directories exist
   * 
   * Creates the directory structure if it doesn't exist:
   * - {chatVaultPath}/conversations/
   * - {chatVaultPath}/chat-sessions/
   * - {chatVaultPath}/chat-messages/
   * - {chatVaultPath}/chat-messages/metadata/
   * 
   * @throws StorageError if directory creation fails
   * 
   * Requirements: 1.3
   */
  async ensureDirectories(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.conversationsPath),
      ensureDirectory(this.chatSessionsPath),
      ensureDirectory(this.chatMessagesPath),
      ensureDirectory(this.metadataPath),
    ]);
  }

  /**
   * Gets the configured chat vault path
   * 
   * @returns The chat vault path
   */
  getChatVaultPath(): string {
    return this.config.chatVaultPath;
  }

  /**
   * Gets the full configuration
   * 
   * @returns A copy of the configuration object
   */
  getConfig(): LocalStorageConfig {
    return { ...this.config };
  }

  /**
   * Gets the path to the conversations directory
   * 
   * @returns The conversations directory path
   */
  getConversationsPath(): string {
    return this.conversationsPath;
  }

  /**
   * Gets the path to the chat sessions directory
   * 
   * @returns The chat sessions directory path
   */
  getChatSessionsPath(): string {
    return this.chatSessionsPath;
  }

  /**
   * Gets the path to the chat messages directory
   * 
   * @returns The chat messages directory path
   */
  getChatMessagesPath(): string {
    return this.chatMessagesPath;
  }

  /**
   * Gets the path to the metadata directory
   * 
   * @returns The metadata directory path
   */
  getMetadataPath(): string {
    return this.metadataPath;
  }

  /**
   * Invalidates the cache, forcing a refresh on next retrieval
   * 
   * Should be called after operations that modify storage:
   * - Storing new conversations
   * - Deleting conversations
   * - Updating tags
   * 
   * Requirements: 2.7, 3.6
   */
  invalidateCache(): void {
    this.cache.clearCache();
  }

  // ============================================================================
  // Storage Operations (to be implemented in task 4.3)
  // ============================================================================

  /**
   * Stores a conversation to the local file system
   * 
   * Writes to {CHAT_VAULT_PATH}/conversations/{timestamp}.json
   * Uses atomic write to prevent corruption on crash.
   * 
   * @param messages - The messages to store
   * @throws StorageError if the write operation fails
   * 
   * Requirements: 1.4, 1.6
   */
  async storeConversation(messages: Message[]): Promise<void> {
    // Ensure the conversations directory exists
    await ensureDirectory(this.conversationsPath);

    // Generate filename from current timestamp
    const timestamp = new Date().toISOString();
    const sanitizedTimestamp = sanitizeTimestamp(timestamp);
    const filename = `${sanitizedTimestamp}.json`;
    const filePath = path.join(this.conversationsPath, filename);

    // Create conversation file structure (maintains backward compatibility)
    const conversationFile: ConversationFile = {
      messages,
    };

    // Write atomically to prevent corruption
    const data = JSON.stringify(conversationFile, null, 2);
    await atomicWrite(filePath, data);

    // Invalidate cache since storage has changed
    this.invalidateCache();
  }

  /**
   * Stores a session to the local file system
   * 
   * Writes to {CHAT_VAULT_PATH}/chat-sessions/{sessionId}.json
   * Uses atomic write to prevent corruption on crash.
   * 
   * @param sessionId - The session identifier
   * @param messages - The messages in the session
   * @param title - The session title
   * @throws StorageError if the write operation fails
   * 
   * Requirements: 1.5, 1.6
   */
  async storeSession(sessionId: string, messages: Message[], title: string, summary?: string): Promise<void> {
    // Ensure the chat-sessions directory exists
    await ensureDirectory(this.chatSessionsPath);

    // Generate filename from session ID
    const filename = `${sessionId}.json`;
    const filePath = path.join(this.chatSessionsPath, filename);

    // Determine last activity from messages or use current time
    const lastActivity = messages.length > 0
      ? messages[messages.length - 1].timestamp
      : new Date().toISOString();

    // Create session file structure (maintains backward compatibility)
    const sessionFile: SessionFile = {
      sessionId,
      title,
      messages,
      lastActivity,
      ...(summary ? { summary } : {}),
    };

    // Write atomically to prevent corruption
    const data = JSON.stringify(sessionFile, null, 2);
    await atomicWrite(filePath, data);

    // Invalidate cache since storage has changed
    this.invalidateCache();
  }

  // ============================================================================
  // History Operations (to be implemented in tasks 4.5, 4.7)
  // ============================================================================

  /**
   * Retrieves all messages from the chat messages directory
   * 
   * Scans the chat-messages/ directory and parses both:
   * - Individual message files ({messageId}.txt)
   * - Conversation files (conversation-{id}.txt)
   * 
   * @returns Array of parsed messages with role, timestamp, and content
   * @throws StorageError if the read operation fails
   * 
   * Requirements: 2.1, 2.2, 2.3
   */
  async getAllMessages(): Promise<ParsedMessage[]> {
    // Check if the chat-messages directory exists
    if (!(await directoryExists(this.chatMessagesPath))) {
      return [];
    }

    const messages: ParsedMessage[] = [];

    // Read all files in the chat-messages directory
    const entries = await fs.readdir(this.chatMessagesPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip directories (like metadata/)
      if (entry.isDirectory()) {
        continue;
      }

      // Only process .txt files
      if (!entry.name.endsWith('.txt')) {
        continue;
      }

      const filePath = path.join(this.chatMessagesPath, entry.name);

      try {
        const content = await readFileWithRetry(filePath);

        // Check if this is a conversation file or individual message file
        if (entry.name.startsWith('conversation-')) {
          // Parse conversation file and extract all messages
          const conversationMessages = this.parseConversationFile(content);
          messages.push(...conversationMessages);
        } else {
          // Parse individual message file
          const message = this.parseIndividualMessageFile(content);
          if (message) {
            messages.push(message);
          }
        }
      } catch (error) {
        // Log warning and skip corrupted/unreadable files (graceful degradation)
        console.warn(`Failed to parse message file ${filePath}:`, error);
        continue;
      }
    }

    return messages;
  }

  /**
   * Parses an individual message file
   * 
   * Format:
   * ```
   * ROLE: user
   * TIMESTAMP: 2026-01-16T10:00:00.000Z
   * TYPE: chat_message
   * CONTENT: message content here
   * ```
   * 
   * @param content - The file content to parse
   * @returns The parsed message, or null if parsing fails
   */
  private parseIndividualMessageFile(content: string): ParsedMessage | null {
    const lines = content.split('\n');
    
    let role: 'user' | 'assistant' | null = null;
    let timestamp: string | null = null;
    let type: string | undefined;
    let messageContent: string | null = null;
    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines) {
      if (inContent) {
        // Once we're in content mode, everything is content
        contentLines.push(line);
        continue;
      }

      if (line.startsWith('ROLE: ')) {
        const roleValue = line.substring(6).trim().toLowerCase();
        if (roleValue === 'user' || roleValue === 'assistant') {
          role = roleValue;
        }
      } else if (line.startsWith('TIMESTAMP: ')) {
        timestamp = line.substring(11).trim();
      } else if (line.startsWith('TYPE: ')) {
        type = line.substring(6).trim();
      } else if (line.startsWith('CONTENT: ')) {
        // Content starts after "CONTENT: " and continues to end of file
        contentLines.push(line.substring(9));
        inContent = true;
      }
    }

    messageContent = contentLines.join('\n');

    // Validate required fields
    if (!role || !timestamp || messageContent === null) {
      return null;
    }

    return {
      role,
      timestamp,
      content: messageContent,
      type,
    };
  }

  /**
   * Parses a conversation file and extracts all messages
   * 
   * Format:
   * ```
   * CONVERSATION_ID: conv-xyz789
   * TYPE: conversation
   * MESSAGE_COUNT: 8
   * CONVERSATION_START: 2026-01-16T10:00:00.000Z
   * CONVERSATION_END: 2026-01-16T10:15:00.000Z
   * 
   * --- CONVERSATION ---
   * 
   * ROLE: user
   * TIMESTAMP: 2026-01-16T10:00:00.000Z
   * CONTENT: message content
   * 
   * ---
   * 
   * ROLE: assistant
   * TIMESTAMP: 2026-01-16T10:00:15.000Z
   * CONTENT: response content
   * 
   * ---
   * ```
   * 
   * @param content - The file content to parse
   * @returns Array of parsed messages from the conversation
   */
  private parseConversationFile(content: string): ParsedMessage[] {
    const messages: ParsedMessage[] = [];

    // Find the start of the conversation section
    const conversationMarker = '--- CONVERSATION ---';
    const conversationStartIndex = content.indexOf(conversationMarker);
    
    if (conversationStartIndex === -1) {
      return messages;
    }

    // Get the content after the conversation marker
    let conversationContent = content.substring(
      conversationStartIndex + conversationMarker.length
    );

    // Remove trailing "---" at the end of the file (with optional whitespace)
    conversationContent = conversationContent.replace(/\n\s*---\s*$/, '');

    // Split by message separator "---" on its own line
    // The regex matches a line that is exactly "---" (with optional whitespace)
    const messageSections = conversationContent.split(/\n\s*---\s*\n/);

    for (const section of messageSections) {
      // Skip empty sections or sections that are just whitespace/separators
      // But don't trim the section itself as it may contain whitespace-only content
      const trimmedForCheck = section.trim();
      if (!trimmedForCheck || trimmedForCheck === '---') {
        continue;
      }

      // Parse each message section (pass original section, not trimmed)
      // Remove only leading newlines, preserve other whitespace
      const sectionToProcess = section.replace(/^\n+/, '');
      const message = this.parseMessageSection(sectionToProcess);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Parses a single message section from a conversation file
   * 
   * Format:
   * ```
   * ROLE: user
   * TIMESTAMP: 2026-01-16T10:00:00.000Z
   * CONTENT: message content
   * ```
   * 
   * @param section - The message section content
   * @returns The parsed message, or null if parsing fails
   */
  private parseMessageSection(section: string): ParsedMessage | null {
    const lines = section.split('\n');
    
    let role: 'user' | 'assistant' | null = null;
    let timestamp: string | null = null;
    let inContent = false;
    const contentLines: string[] = [];

    for (const line of lines) {
      if (inContent) {
        // Once we're in content mode, everything is content
        contentLines.push(line);
        continue;
      }

      if (line.startsWith('ROLE: ')) {
        const roleValue = line.substring(6).trim().toLowerCase();
        if (roleValue === 'user' || roleValue === 'assistant') {
          role = roleValue;
        }
      } else if (line.startsWith('TIMESTAMP: ')) {
        timestamp = line.substring(11).trim();
      } else if (line.startsWith('CONTENT: ')) {
        // Content starts after "CONTENT: " and continues to end of section
        contentLines.push(line.substring(9));
        inContent = true;
      }
    }

    const messageContent = contentLines.join('\n');

    // Validate required fields
    if (!role || !timestamp) {
      return null;
    }

    return {
      role,
      timestamp,
      content: messageContent,
    };
  }

  /**
   * Retrieves all conversations with caching
   * 
   * Reads sessions from the chat-sessions/ directory (JSON files) and
   * returns them sorted by last activity (newest first).
   * 
   * @param forceRefresh - If true, bypasses cache and fetches fresh data
   * @returns Array of conversation sessions sorted by last activity (newest first)
   * @throws StorageError if the read operation fails
   * 
   * Requirements: 2.4, 2.5, 2.6, 2.7
   */
  async getAllConversations(forceRefresh?: boolean): Promise<ConversationSession[]> {
    // Get current file metadata for cache validation
    const currentMetadata = await this.computeSessionsCacheMetadata();

    // Check if we can use cached data (unless force refresh is requested)
    if (!forceRefresh && !this.cache.hasChanged(currentMetadata)) {
      const cachedConversations = this.cache.getCachedConversations();
      if (cachedConversations !== null) {
        return cachedConversations;
      }
    }

    // Fetch sessions from chat-sessions directory
    const sessions = await this.getAllSessions();

    // Sort by last activity (newest first)
    sessions.sort((a, b) => {
      const timeA = new Date(a.endTime).getTime();
      const timeB = new Date(b.endTime).getTime();
      return timeB - timeA; // Descending order (newest first)
    });

    // Update cache
    this.cache.setCachedConversations(sessions, currentMetadata);

    return sessions;
  }

  /**
   * Retrieves all sessions from the chat-sessions directory
   * 
   * Reads JSON files from chat-sessions/ and converts them to ConversationSession format.
   * 
   * @returns Array of conversation sessions
   */
  private async getAllSessions(): Promise<ConversationSession[]> {
    // Check if the chat-sessions directory exists
    if (!(await directoryExists(this.chatSessionsPath))) {
      return [];
    }

    const sessions: ConversationSession[] = [];

    // Read all files in the chat-sessions directory
    const entries = await fs.readdir(this.chatSessionsPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory()) {
        continue;
      }

      // Only process .json files
      if (!entry.name.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(this.chatSessionsPath, entry.name);

      try {
        const content = await readFileWithRetry(filePath);
        const sessionData: SessionFile = JSON.parse(content);

        // Convert to ConversationSession format
        const session: ConversationSession = {
          sessionId: sessionData.sessionId,
          messages: sessionData.messages,
          startTime: sessionData.messages.length > 0 
            ? sessionData.messages[0].timestamp 
            : sessionData.lastActivity,
          endTime: sessionData.lastActivity,
          messageCount: sessionData.messages.length,
          tags: [],
          preview: sessionData.title || (sessionData.messages.length > 0 
            ? sessionData.messages[0].content.substring(0, 50) 
            : ''),
          ...(sessionData.summary ? { summary: sessionData.summary } : {}),
        };

        sessions.push(session);
      } catch (error) {
        // Log warning and skip corrupted/unreadable files (graceful degradation)
        console.warn(`Failed to parse session file ${filePath}:`, error);
        continue;
      }
    }

    return sessions;
  }

  /**
   * Computes cache metadata from the current state of the chat-sessions directory
   * 
   * @returns Cache metadata with file count and content hash
   */
  private async computeSessionsCacheMetadata(): Promise<CacheMetadata> {
    // Check if directory exists
    if (!(await directoryExists(this.chatSessionsPath))) {
      return {
        fileCount: 0,
        contentHash: this.cache.computeContentHash([]),
      };
    }

    // Get file info for all files in the directory
    const fileInfos = await getDirectoryFileInfo(this.chatSessionsPath);

    return {
      fileCount: fileInfos.length,
      contentHash: this.cache.computeContentHash(fileInfos),
    };
  }

  /**
   * Retrieves a single conversation by session ID
   * 
   * @param sessionId - The session identifier
   * @returns The conversation session, or null if not found
   * @throws StorageError if the read operation fails
   * 
   * Requirements: 2.4
   */
  async getConversation(sessionId: string): Promise<ConversationSession | null> {
    // Get all conversations (uses cache if available)
    const conversations = await this.getAllConversations();

    // Find the conversation with matching sessionId
    const conversation = conversations.find(c => c.sessionId === sessionId);

    return conversation || null;
  }

  /**
   * Computes cache metadata from the current state of the chat-messages directory
   * 
   * @returns Cache metadata with file count and content hash
   */
  private async computeCacheMetadata(): Promise<CacheMetadata> {
    // Check if directory exists
    if (!(await directoryExists(this.chatMessagesPath))) {
      return {
        fileCount: 0,
        contentHash: this.cache.computeContentHash([]),
      };
    }

    // Get file info for all files in the directory
    const fileInfos = await getDirectoryFileInfo(this.chatMessagesPath);

    return {
      fileCount: fileInfos.length,
      contentHash: this.cache.computeContentHash(fileInfos),
    };
  }

  /**
   * Groups messages into sessions based on temporal proximity
   * 
   * Messages within 30 minutes of each other belong to the same session.
   * A gap > 30 minutes starts a new session.
   * 
   * @param messages - Array of parsed messages to group
   * @returns Array of conversation sessions
   * 
   * Requirements: 2.4
   */
  private groupMessagesIntoSessions(messages: ParsedMessage[]): ConversationSession[] {
    if (messages.length === 0) {
      return [];
    }

    // Sort messages by timestamp (oldest first for grouping)
    const sortedMessages = [...messages].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });

    const sessions: ConversationSession[] = [];
    let currentSessionMessages: ParsedMessage[] = [];
    let lastMessageTime: number | null = null;

    for (const message of sortedMessages) {
      const messageTime = new Date(message.timestamp).getTime();

      // Check if this message starts a new session
      if (lastMessageTime !== null && 
          (messageTime - lastMessageTime) > SESSION_GAP_THRESHOLD_MS) {
        // Save current session and start a new one
        if (currentSessionMessages.length > 0) {
          sessions.push(this.createSessionFromMessages(currentSessionMessages));
        }
        currentSessionMessages = [];
      }

      currentSessionMessages.push(message);
      lastMessageTime = messageTime;
    }

    // Don't forget the last session
    if (currentSessionMessages.length > 0) {
      sessions.push(this.createSessionFromMessages(currentSessionMessages));
    }

    return sessions;
  }

  /**
   * Creates a ConversationSession from a group of messages
   * 
   * @param messages - Array of messages belonging to the session
   * @returns A ConversationSession object
   */
  private createSessionFromMessages(messages: ParsedMessage[]): ConversationSession {
    // Messages should already be sorted by timestamp
    const startTime = messages[0].timestamp;
    const endTime = messages[messages.length - 1].timestamp;

    // Generate session ID from start time
    const sessionId = `session-${sanitizeTimestamp(startTime)}`;

    // Get preview from first user message (first 50 chars)
    const firstUserMessage = messages.find(m => m.role === 'user');
    const preview = firstUserMessage 
      ? firstUserMessage.content.substring(0, 50)
      : '';

    // Convert ParsedMessage to Message format
    const sessionMessages: Message[] = messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }));

    return {
      sessionId,
      messages: sessionMessages,
      startTime,
      endTime,
      messageCount: messages.length,
      tags: [], // Tags are stored separately in metadata files
      preview,
    };
  }

  // ============================================================================
  // Tag Management
  // ============================================================================

  /**
   * Retrieves tags for a conversation
   * 
   * Reads from {CHAT_VAULT_PATH}/chat-messages/metadata/{sessionId}.json
   * Returns an empty array if the metadata file does not exist.
   * 
   * @param sessionId - The session identifier
   * @returns Array of tags, or empty array if no metadata exists
   * @throws StorageError if the read operation fails (except for missing file)
   * 
   * Requirements: 3.2, 3.3
   */
  async getConversationTags(sessionId: string): Promise<string[]> {
    const metadataFilePath = path.join(this.metadataPath, `${sessionId}.json`);

    try {
      const content = await readFileWithRetry(metadataFilePath);
      const metadata: MetadataFile = JSON.parse(content);
      
      // Return tags array, or empty array if tags field is missing
      return Array.isArray(metadata.tags) ? metadata.tags : [];
    } catch (error) {
      // Return empty array for missing metadata files (graceful degradation)
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      // Re-throw other errors (permission issues, corrupted JSON, etc.)
      throw error;
    }
  }

  /**
   * Updates tags for a conversation
   * 
   * Writes to {CHAT_VAULT_PATH}/chat-messages/metadata/{sessionId}.json
   * Uses atomic write to prevent corruption on crash.
   * Invalidates cache after successful write.
   * 
   * @param sessionId - The session identifier
   * @param tags - The tags to set
   * @throws StorageError if the write operation fails
   * 
   * Requirements: 3.1
   */
  async updateConversationTags(sessionId: string, tags: string[]): Promise<void> {
    // Ensure the metadata directory exists
    await ensureDirectory(this.metadataPath);

    const metadataFilePath = path.join(this.metadataPath, `${sessionId}.json`);

    // Create metadata file structure
    const metadataFile: MetadataFile = {
      sessionId,
      tags,
      updatedAt: new Date().toISOString(),
    };

    // Write atomically to prevent corruption
    const data = JSON.stringify(metadataFile, null, 2);
    await atomicWrite(metadataFilePath, data);

    // Invalidate cache since metadata has changed
    this.invalidateCache();
  }

  // ============================================================================
  // Deletion
  // ============================================================================

  /**
   * Deletes a conversation and all associated files
   * 
   * This method:
   * 1. Deletes the session file from chat-sessions/
   * 2. Deletes the associated metadata file if it exists
   * 3. Invalidates the cache
   * 4. Returns the number of files deleted
   * 
   * @param sessionId - The session identifier
   * @returns The number of files deleted
   * @throws StorageError if the delete operation fails
   * 
   * Requirements: 3.4, 3.5, 3.6
   */
  async deleteConversation(sessionId: string): Promise<number> {
    let deletedCount = 0;

    // Delete the session file from chat-sessions/
    const sessionDeleted = await this.deleteSessionFile(sessionId);
    if (sessionDeleted) {
      deletedCount++;
    }

    // Delete the associated metadata file
    const metadataDeleted = await this.deleteMetadataFile(sessionId);
    if (metadataDeleted) {
      deletedCount++;
    }

    // Invalidate cache after deletion
    this.invalidateCache();

    return deletedCount;
  }

  /**
   * Deletes a session file from the chat-sessions directory
   * 
   * @param sessionId - The session identifier
   * @returns True if the file was deleted, false if it didn't exist
   */
  private async deleteSessionFile(sessionId: string): Promise<boolean> {
    const sessionFilePath = path.join(this.chatSessionsPath, `${sessionId}.json`);

    try {
      await deleteFileWithRetry(sessionFilePath);
      return true;
    } catch (error) {
      // Return false for missing files (graceful degradation)
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Deletes message files that match the given timestamps
   * 
   * Scans the chat-messages directory and deletes files containing
   * messages with matching timestamps.
   * 
   * @param timestamps - Set of timestamps to match
   * @returns The number of files deleted
   */
  private async deleteMessageFilesByTimestamps(timestamps: Set<string>): Promise<number> {
    // Check if the chat-messages directory exists
    if (!(await directoryExists(this.chatMessagesPath))) {
      return 0;
    }

    let deletedCount = 0;

    // Read all files in the chat-messages directory
    const entries = await fs.readdir(this.chatMessagesPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip directories (like metadata/)
      if (entry.isDirectory()) {
        continue;
      }

      // Only process .txt files
      if (!entry.name.endsWith('.txt')) {
        continue;
      }

      const filePath = path.join(this.chatMessagesPath, entry.name);

      try {
        const content = await readFileWithRetry(filePath);

        // Check if this file contains messages from our session
        let shouldDelete = false;

        if (entry.name.startsWith('conversation-')) {
          // For conversation files, check if any message timestamp matches
          shouldDelete = this.conversationFileContainsTimestamps(content, timestamps);
        } else {
          // For individual message files, check if the timestamp matches
          shouldDelete = this.individualFileContainsTimestamp(content, timestamps);
        }

        if (shouldDelete) {
          await deleteFileWithRetry(filePath);
          deletedCount++;
        }
      } catch (error) {
        // Log warning and continue with other files (graceful degradation)
        console.warn(`Failed to process message file ${filePath} for deletion:`, error);
        continue;
      }
    }

    return deletedCount;
  }

  /**
   * Checks if a conversation file contains any messages with matching timestamps
   * 
   * @param content - The file content
   * @param timestamps - Set of timestamps to match
   * @returns true if any message timestamp matches
   */
  private conversationFileContainsTimestamps(content: string, timestamps: Set<string>): boolean {
    // Parse the conversation file to extract message timestamps
    const messages = this.parseConversationFile(content);
    
    // Check if any message timestamp matches
    return messages.some(m => timestamps.has(m.timestamp));
  }

  /**
   * Checks if an individual message file has a matching timestamp
   * 
   * @param content - The file content
   * @param timestamps - Set of timestamps to match
   * @returns true if the message timestamp matches
   */
  private individualFileContainsTimestamp(content: string, timestamps: Set<string>): boolean {
    // Parse the individual message file
    const message = this.parseIndividualMessageFile(content);
    
    if (!message) {
      return false;
    }

    return timestamps.has(message.timestamp);
  }

  /**
   * Deletes the metadata file for a session if it exists
   * 
   * @param sessionId - The session identifier
   * @returns true if a file was deleted, false otherwise
   */
  private async deleteMetadataFile(sessionId: string): Promise<boolean> {
    const metadataFilePath = path.join(this.metadataPath, `${sessionId}.json`);

    try {
      // Check if file exists first
      await fs.access(metadataFilePath);
      // File exists, delete it
      await deleteFileWithRetry(metadataFilePath);
      return true;
    } catch (error) {
      // File doesn't exist or other error
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      // Log warning for other errors but don't fail the whole operation
      console.warn(`Failed to delete metadata file ${metadataFilePath}:`, error);
      return false;
    }
  }
}

/**
 * Singleton instance of LocalStorageService
 * 
 * This provides a drop-in replacement for the S3-based storage service.
 * The instance is created lazily on first access.
 * 
 * Requirements: 8.1, 8.2
 */
let localStorageServiceInstance: LocalStorageService | null = null;

/**
 * Gets the singleton LocalStorageService instance
 * 
 * Creates the instance on first call, reading configuration from
 * the CHAT_VAULT_PATH environment variable.
 * 
 * @returns The LocalStorageService singleton
 * @throws ConfigurationError if CHAT_VAULT_PATH is not set
 */
export function getLocalStorageService(): LocalStorageService {
  if (!localStorageServiceInstance) {
    localStorageServiceInstance = new LocalStorageService();
  }
  return localStorageServiceInstance;
}

/**
 * Resets the singleton instance (primarily for testing)
 * 
 * @internal
 */
export function resetLocalStorageService(): void {
  localStorageServiceInstance = null;
}
