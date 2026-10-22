/**
 * LocalObsidianService - Local file system Obsidian vault integration
 * 
 * This service replaces the webhook-based obsidian-service.ts with direct
 * file system operations on the local Obsidian vault.
 * 
 * Features:
 * - Direct CRUD operations on Obsidian vault markdown files
 * - YAML frontmatter parsing and generation
 * - Windows-compatible path handling
 * - Retry logic for file locking (EBUSY/EPERM)
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LocalObsidianConfig, ObsidianNoteFrontmatter, ParsedObsidianNote, ObsidianNoteCall } from './types';
import { ConfigurationError, VaultNotFoundError } from './errors';
import { directoryExists, ensureDirectory, atomicWrite, readFileWithRetry, deleteFileWithRetry, retryWithBackoff } from './file-utils';
import { sanitizeFilename, truncateFilename, validatePathSecurity, escapeShellArg } from './path-utils';

const execAsync = promisify(exec);

/**
 * Search result structure for vault search
 * 
 * Requirements: 10.6
 */
export interface SearchResult {
  file: string;     // Filename relative to vault root
  context: string;  // Surrounding context from the match
}

// ============================================================================
// YAML Frontmatter Utilities (Task 6.3)
// ============================================================================

/**
 * Regex pattern to match YAML frontmatter block at the start of content
 * Matches: ---\n<yaml content>\n---
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Parses YAML frontmatter from markdown content
 * 
 * Extracts the YAML frontmatter block from the beginning of a markdown file
 * and parses it into an ObsidianNoteFrontmatter object.
 * If no frontmatter exists, returns default values derived from the content.
 * 
 * @param content - The full markdown content including frontmatter
 * @param filename - Optional filename to derive title from if not in frontmatter
 * @returns Object containing parsed frontmatter and remaining content
 * 
 * Requirements: 4.4, 4.6
 */
export function parseFrontmatter(content: string, filename?: string): ParsedObsidianNote {
  const match = content.match(FRONTMATTER_REGEX);
  
  // No frontmatter found - return content as-is with default frontmatter
  if (!match) {
    const now = new Date().toISOString();
    // Derive title from filename or first line of content
    let title = 'Untitled';
    if (filename) {
      title = filename.replace(/\.md$/i, '');
    } else {
      // Try to get title from first heading or first line
      const firstLineMatch = content.match(/^#\s+(.+)$/m) || content.match(/^(.+)$/m);
      if (firstLineMatch) {
        title = firstLineMatch[1].trim().substring(0, 100);
      }
    }
    
    return {
      frontmatter: {
        title,
        created: now,
        modified: now,
      },
      content: content,
    };
  }
  
  const yamlContent = match[1];
  // Don't trim the content - preserve whitespace exactly as stored
  // Only remove the leading newlines that separate frontmatter from content
  let remainingContent = content.slice(match[0].length);
  // Remove up to 2 leading newlines (the standard separator after frontmatter)
  if (remainingContent.startsWith('\r\n\r\n')) {
    remainingContent = remainingContent.slice(4);
  } else if (remainingContent.startsWith('\n\n')) {
    remainingContent = remainingContent.slice(2);
  } else if (remainingContent.startsWith('\r\n')) {
    remainingContent = remainingContent.slice(2);
  } else if (remainingContent.startsWith('\n')) {
    remainingContent = remainingContent.slice(1);
  }
  
  // Parse YAML content manually (simple key-value parsing)
  const frontmatter = parseYamlToFrontmatter(yamlContent, filename);
  
  return {
    frontmatter,
    content: remainingContent,
  };
}

/**
 * Generates YAML frontmatter string from an ObsidianNoteFrontmatter object.
 * 
 * @param frontmatter - The frontmatter object to serialize
 * @returns A string with YAML frontmatter delimiters (---\n...\n---)
 */
export function generateFrontmatter(frontmatter: ObsidianNoteFrontmatter): string {
  const lines: string[] = ['---'];

  // Helper to quote values that contain special YAML characters
  const quoteIfNeeded = (val: string): string => {
    if (/[:#"'\n\r{}[\],&*?|>!%@`]/.test(val)) {
      return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return val;
  };

  lines.push(`title: ${quoteIfNeeded(frontmatter.title)}`);
  lines.push(`created: ${frontmatter.created}`);
  lines.push(`modified: ${frontmatter.modified}`);

  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push('tags:');
    for (const tag of frontmatter.tags) {
      lines.push(`  - ${quoteIfNeeded(tag)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Parses simple YAML content into ObsidianNoteFrontmatter
 * 
 * This is a lightweight YAML parser that handles the specific format
 * used by Obsidian frontmatter. It supports:
 * - Simple key: value pairs
 * - Arrays in list format (- item)
 * 
 * If required fields are missing, defaults are provided.
 * 
 * @param yaml - The YAML content (without delimiters)
 * @param filename - Optional filename to derive title from
 * @returns Parsed frontmatter object
 */
function parseYamlToFrontmatter(yaml: string, filename?: string): ObsidianNoteFrontmatter {
  const lines = yaml.split(/\r?\n/);
  const result: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  
  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }
    
    // Check for array item (starts with whitespace and -)
    const arrayItemMatch = line.match(/^\s+-\s*(.*)$/);
    if (arrayItemMatch && currentKey && currentArray !== null) {
      // Remove quotes from array items if present
      currentArray.push(removeQuotes(arrayItemMatch[1].trim()));
      continue;
    }
    
    // Check for key: value pair
    const keyValueMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (keyValueMatch) {
      // Save previous array if exists
      if (currentKey && currentArray !== null) {
        result[currentKey] = currentArray;
      }
      
      currentKey = keyValueMatch[1];
      const value = keyValueMatch[2].trim();
      
      // Check if this is the start of an array (empty value or explicit array start)
      if (value === '' || value === '[]') {
        currentArray = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array format: [item1, item2]
        const items = value.slice(1, -1).split(',').map(s => s.trim()).filter(s => s !== '');
        result[currentKey] = items;
        currentKey = null;
        currentArray = null;
      } else {
        // Simple value - remove quotes if present
        result[currentKey] = removeQuotes(value);
        currentKey = null;
        currentArray = null;
      }
    }
  }
  
  // Save final array if exists
  if (currentKey && currentArray !== null) {
    result[currentKey] = currentArray;
  }
  
  // Provide defaults for missing required fields (lenient parsing)
  const now = new Date().toISOString();
  
  let title = result.title as string | undefined;
  if (!title || typeof title !== 'string') {
    // Derive title from filename if available
    title = filename ? filename.replace(/\.md$/i, '') : 'Untitled';
  }
  
  const created = (result.created as string) || now;
  const modified = (result.modified as string) || now;
  
  return {
    title,
    created,
    modified,
    tags: Array.isArray(result.tags) ? result.tags : undefined,
  };
}

/**
 * Removes surrounding quotes from a string value and unescapes escape sequences
 * 
 * @param value - The value that may have quotes
 * @returns The value without surrounding quotes, with escape sequences resolved
 */
function removeQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    // Double-quoted string - unescape escape sequences
    // Process character by character to handle escape sequences correctly
    const inner = value.slice(1, -1);
    let result = '';
    let i = 0;
    while (i < inner.length) {
      if (inner[i] === '\\' && i + 1 < inner.length) {
        const nextChar = inner[i + 1];
        switch (nextChar) {
          case 'n':
            result += '\n';
            i += 2;
            break;
          case 'r':
            result += '\r';
            i += 2;
            break;
          case '"':
            result += '"';
            i += 2;
            break;
          case '\\':
            result += '\\';
            i += 2;
            break;
          default:
            // Unknown escape sequence - keep as-is
            result += inner[i];
            i += 1;
            break;
        }
      } else {
        result += inner[i];
        i += 1;
      }
    }
    return result;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    // Single-quoted string - no escape sequences in YAML single quotes
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Default folder name for notes within the Obsidian vault
 * Empty string means notes are stored at the vault root level
 */
const DEFAULT_NOTES_FOLDER = 'AI-Notes';

/**
 * Default setting for retry on lock
 */
const DEFAULT_RETRY_ON_LOCK = true;

/**
 * Default maximum retries for locked files
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Environment variable name for Obsidian vault path
 */
const OBSIDIAN_VAULT_PATH_ENV = 'OBSIDIAN_VAULT_PATH';

/**
 * LocalObsidianService provides direct file system operations on the local Obsidian vault.
 * 
 * This is a drop-in replacement for the webhook-based obsidian-service.ts,
 * enabling fully offline operation while maintaining the same interface.
 * 
 * @example
 * // Using environment variable (recommended)
 * const service = await LocalObsidianService.create();
 * 
 * // Using explicit config
 * const service = await LocalObsidianService.create({
 *   vaultPath: 'C:\\ObsidianVault',
 *   notesFolder: 'Notes'
 * });
 * 
 * Requirements: 4.1, 4.2, 4.3
 */
export class LocalObsidianService {
  private readonly config: LocalObsidianConfig;

  /**
   * Private constructor - use LocalObsidianService.create() instead
   * 
   * @param config - Validated configuration object
   */
  private constructor(config: LocalObsidianConfig) {
    this.config = config;
  }

  /**
   * Creates a new LocalObsidianService instance with validation
   * 
   * This factory method:
   * 1. Reads OBSIDIAN_VAULT_PATH from environment if not provided
   * 2. Validates that the vault directory exists
   * 3. Applies default values for optional config properties
   * 
   * @param config - Optional configuration (uses env vars if not provided)
   * @returns A validated LocalObsidianService instance
   * @throws ConfigurationError if OBSIDIAN_VAULT_PATH env var is missing
   * @throws VaultNotFoundError if the vault directory doesn't exist
   * 
   * Requirements: 4.1, 4.2, 4.3
   */
  public static async create(config?: Partial<LocalObsidianConfig>): Promise<LocalObsidianService> {
    // Get vault path from config or environment variable
    const vaultPath = config?.vaultPath ?? process.env[OBSIDIAN_VAULT_PATH_ENV];

    // Requirement 4.2: Throw ConfigurationError if env var is missing
    if (!vaultPath) {
      throw new ConfigurationError(OBSIDIAN_VAULT_PATH_ENV);
    }

    // Requirement 4.3: Throw VaultNotFoundError if vault directory doesn't exist
    const vaultExists = await directoryExists(vaultPath);
    if (!vaultExists) {
      throw new VaultNotFoundError(vaultPath);
    }

    // Build complete config with defaults
    const fullConfig: LocalObsidianConfig = {
      vaultPath,
      notesFolder: config?.notesFolder ?? DEFAULT_NOTES_FOLDER,
      retryOnLock: config?.retryOnLock ?? DEFAULT_RETRY_ON_LOCK,
      maxRetries: config?.maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    return new LocalObsidianService(fullConfig);
  }

  /**
   * Gets the configured vault path
   * 
   * @returns The absolute path to the Obsidian vault
   */
  public getVaultPath(): string {
    return this.config.vaultPath;
  }

  /**
   * Gets the full path to the notes folder within the vault
   * If notesFolder is empty, returns the vault root path
   * 
   * @returns The absolute path to the notes folder
   */
  public getNotesPath(): string {
    const folder = this.config.notesFolder ?? DEFAULT_NOTES_FOLDER;
    if (!folder || folder === '') {
      return this.config.vaultPath;
    }
    return path.join(this.config.vaultPath, folder);
  }

  /**
   * Gets the current configuration
   * 
   * @returns A copy of the current configuration
   */
  public getConfig(): LocalObsidianConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Note Operations (Task 6.4)
  // ============================================================================

  /**
   * Processes a note task and saves it to the Obsidian vault
   * 
   * This method provides compatibility with the webhook-based obsidian-service.ts.
   * It parses the task string to extract title and content, validates the input,
   * creates a note using the existing createNote method, and returns an
   * ObsidianNoteCall response matching the webhook interface.
   * 
   * Task parsing logic:
   * - The task string format is typically: "Title\n\nContent" or just "Title"
   * - If no blank line separator, the entire task becomes the title with empty content
   * - Title is extracted from the first line
   * - Content is everything after the first blank line
   * 
   * @param task - The note task string to process
   * @returns ObsidianNoteCall response matching webhook interface
   * @throws Error if task is empty or exceeds 1,000,000 characters
   * 
   * Requirements: 5.1, 5.2, 5.3, 5.4
   * 
   * @example
   * // Task with title and content
   * const result = await service.sendNoteTask('My Note Title\n\nThis is the content.');
   * // result = { task: 'My Note Title\n\nThis is the content.', result: 'Note created: My-Note-Title.md', timestamp: '...' }
   * 
   * @example
   * // Task with title only
   * const result = await service.sendNoteTask('Just a Title');
   * // result = { task: 'Just a Title', result: 'Note created: Just-a-Title.md', timestamp: '...' }
   */
  public async sendNoteTask(task: string): Promise<ObsidianNoteCall> {
    const timestamp = new Date().toISOString();

    // Requirement 5.2: Validate task is non-empty
    if (!task || task.trim().length === 0) {
      throw new Error('Task cannot be empty');
    }

    // No webhook size cap — writing directly to filesystem.
    if (task.length > 1_000_000) {
      throw new Error('Task exceeds maximum length of 1000000 characters');
    }

    // Requirement 5.1: Parse task to extract title and content
    const { title, content } = this.parseNoteTask(task.trim());

    // Create the note using existing createNote method
    const filename = await this.createNote(title, content);

    // Requirement 5.3, 5.4: Return ObsidianNoteCall response matching webhook interface
    return {
      task: task.trim(),
      result: `Note created: ${filename}`,
      timestamp,
    };
  }

  /**
   * Parses a note task string to extract title and content
   * 
   * The task string format is typically: "Title\n\nContent" or just "Title"
   * - If no blank line separator, the entire task becomes the title with empty content
   * - Title is extracted from the first line
   * - Content is everything after the first blank line
   * 
   * @param task - The trimmed task string to parse
   * @returns Object containing extracted title and content
   * 
   * Requirements: 5.1
   */
  private parseNoteTask(task: string): { title: string; content: string } {
    // Look for a blank line separator (two consecutive newlines)
    // Handle both Unix (\n\n) and Windows (\r\n\r\n) line endings
    const blankLineMatch = task.match(/\r?\n\r?\n/);

    if (blankLineMatch && blankLineMatch.index !== undefined) {
      // Split at the first blank line
      const title = task.slice(0, blankLineMatch.index).trim();
      const content = task.slice(blankLineMatch.index + blankLineMatch[0].length);
      
      // If title is empty after trimming, use a default
      return {
        title: title || 'Untitled Note',
        content,
      };
    }

    // No blank line found - entire task is the title, content is empty
    // Handle single newline case - first line is title
    const firstNewline = task.indexOf('\n');
    if (firstNewline !== -1) {
      const firstLine = task.slice(0, firstNewline).trim();
      const rest = task.slice(firstNewline + 1).trim();
      
      // If there's content after the first line but no blank line,
      // treat the first line as title and rest as content
      return {
        title: firstLine || 'Untitled Note',
        content: rest,
      };
    }

    // No newlines at all - entire task is the title
    return {
      title: task || 'Untitled Note',
      content: '',
    };
  }

  /**
   * Creates a new note in the Obsidian vault
   * 
   * Generates a sanitized filename from the title and writes the note to
   * the vault as clean markdown without YAML frontmatter.
   * 
   * @param title - The note title
   * @param content - The note content (markdown)
   * @returns The filename of the created note (including .md extension)
   * 
   * @example
   * const filename = await service.createNote('My Note', 'Content here');
   * // Returns: 'My-Note.md'
   */
  public async createNote(title: string, content: string): Promise<string> {
    // Validate path security before any filesystem operations
    validatePathSecurity(title);

    // Check if title contains a folder path (e.g. "main/Meeting Notes")
    const hasFolder = title.includes('/') || title.includes('\\');
    
    let notesPath: string;
    let noteTitle: string;
    
    if (hasFolder) {
      // Extract folder and title parts
      const lastSep = Math.max(title.lastIndexOf('/'), title.lastIndexOf('\\'));
      const folderPart = title.slice(0, lastSep);
      noteTitle = title.slice(lastSep + 1);
      notesPath = path.join(this.config.vaultPath, folderPart);
    } else {
      notesPath = this.getNotesPath();
      noteTitle = title;
    }
    
    await ensureDirectory(notesPath);

    // Generate sanitized filename from title
    const sanitized = sanitizeFilename(noteTitle);
    const truncated = truncateFilename(sanitized);
    const filename = `${truncated}.md`;
    const filePath = path.join(notesPath, filename);

    // Just use the content directly, with title as heading if content doesn't start with one
    let fullContent: string;
    if (content.trim().startsWith('#')) {
      fullContent = content;
    } else {
      fullContent = `# ${noteTitle}\n\n${content}`;
    }

    // Write file atomically with retry logic
    if (this.config.retryOnLock) {
      await retryWithBackoff(
        () => atomicWrite(filePath, fullContent),
        this.config.maxRetries ?? DEFAULT_MAX_RETRIES
      );
    } else {
      await atomicWrite(filePath, fullContent);
    }

    // Return full relative path so the AI knows where it was created
    if (hasFolder) {
      const lastSep = Math.max(title.lastIndexOf('/'), title.lastIndexOf('\\'));
      const folderPart = title.slice(0, lastSep + 1);
      return `${folderPart}${filename}`;
    }
    return filename;
  }

  /**
   * Reads a note from the Obsidian vault
   * 
   * Reads the markdown file and parses the YAML frontmatter to extract
   * metadata and content separately. Supports reading from:
   * - Notes folder (default): "My-Note.md" or "My-Note"
   * - Arbitrary vault paths: "permanent/readme.md" or "folder/subfolder/note"
   * 
   * @param filename - The filename or path of the note to read (with or without .md extension)
   * @returns The parsed note with frontmatter and content
   * @throws Error if the file doesn't exist or frontmatter is invalid
   * @throws SecurityError if path contains traversal attempts
   * 
   * Requirements: 4.6
   * 
   * @example
   * // Read from Notes folder
   * const note = await service.readNote('My-Note.md');
   * 
   * @example
   * // Read from arbitrary vault path
   * const note = await service.readNote('permanent/readme.md');
   */
  public async readNote(filename: string): Promise<ParsedObsidianNote> {
    // Security: Validate path doesn't contain traversal
    validatePathSecurity(filename);
    
    // Ensure filename has .md extension
    const normalizedFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    
    // Always resolve from vault root
    const filePath = path.join(this.config.vaultPath, normalizedFilename);

    // Read file with retry logic
    let fileContent: string;
    if (this.config.retryOnLock) {
      fileContent = await readFileWithRetry(filePath, this.config.maxRetries ?? DEFAULT_MAX_RETRIES);
    } else {
      fileContent = await fs.readFile(filePath, 'utf-8');
    }

    // Parse frontmatter and content, passing filename for fallback title
    return parseFrontmatter(fileContent, normalizedFilename);
  }

  /**
   * Updates an existing note in the Obsidian vault
   * 
   * Reads the existing note to preserve the original creation date,
   * updates the modified timestamp, and writes the new content.
   * 
   * @param filename - The filename of the note to update (with or without .md extension)
   * @param content - The new content (markdown)
   * @throws Error if the file doesn't exist
   * 
   * @example
   * await service.updateNote('My-Note.md', 'Updated content here');
   */
  public async updateNote(filename: string, content: string): Promise<void> {
    // Validate path security before any filesystem operations
    validatePathSecurity(filename);

    // Ensure filename has .md extension
    const normalizedFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    
    // Always resolve from vault root
    const filePath = path.join(this.config.vaultPath, normalizedFilename);

    // Write file atomically with retry logic
    if (this.config.retryOnLock) {
      await retryWithBackoff(
        () => atomicWrite(filePath, content),
        this.config.maxRetries ?? DEFAULT_MAX_RETRIES
      );
    } else {
      await atomicWrite(filePath, content);
    }
  }

  /**
   * Append content to the end of an existing note without replacing anything.
   * Safer than updateNote for incremental additions (journals, task lists, etc.)
   */
  public async appendNote(filename: string, content: string): Promise<void> {
    // Validate path security before any filesystem operations
    validatePathSecurity(filename);

    const normalizedFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = path.join(this.config.vaultPath, normalizedFilename);

    // Read existing content first
    const existing = await fs.readFile(filePath, 'utf-8');
    const separator = existing.endsWith('\n') ? '' : '\n';
    const newContent = existing + separator + content;

    // Write atomically
    if (this.config.retryOnLock) {
      await retryWithBackoff(
        () => atomicWrite(filePath, newContent),
        this.config.maxRetries ?? DEFAULT_MAX_RETRIES
      );
    } else {
      await atomicWrite(filePath, newContent);
    }
  }


  /**
   * Deletes a note from the Obsidian vault
   *
   * Removes the markdown file from the notes folder.
   *
   * @param filename - The filename of the note to delete (with or without .md extension)
   * @throws Error if the file doesn't exist (unless already deleted)
   *
   * Requirements: 4.8
   *
   * @example
   * await service.deleteNote('My-Note.md');
   */
  public async deleteNote(filename: string): Promise<void> {
    // Validate path security before any filesystem operations
    validatePathSecurity(filename);

    // Ensure filename has .md extension
    const normalizedFilename = filename.endsWith('.md') ? filename : `${filename}.md`;

    // Always resolve from vault root
    const filePath = path.join(this.config.vaultPath, normalizedFilename);

    // Delete file with retry logic
    if (this.config.retryOnLock) {
      await deleteFileWithRetry(filePath, this.config.maxRetries ?? DEFAULT_MAX_RETRIES);
    } else {
      await fs.unlink(filePath);
    }
  }

  /**
   * Deletes a note identified by its display title (same derivation as createNote).
   * Silently succeeds if the file does not exist (ENOENT) — safe to call on
   * pages that may never have been written (e.g. defensive stale-page cleanup).
   */
  public async deleteNoteByTitle(title: string): Promise<void> {
    validatePathSecurity(title);

    // Honor a folder prefix in the title (e.g. "reading/annotations/Phronesis")
    // so cleanup deletes from the SAME folder createNote wrote to. Without this,
    // a folder-qualified page would be created under reading/annotations but the
    // stale-page sweep would look for it in the default AI-Notes folder and miss.
    const hasFolder = title.includes('/') || title.includes('\\');
    let dir: string;
    let noteTitle: string;
    if (hasFolder) {
      const lastSep = Math.max(title.lastIndexOf('/'), title.lastIndexOf('\\'));
      dir = path.join(this.config.vaultPath, title.slice(0, lastSep));
      noteTitle = title.slice(lastSep + 1);
    } else {
      dir = this.getNotesPath();
      noteTitle = title;
    }

    const sanitized = sanitizeFilename(noteTitle);
    const truncated = truncateFilename(sanitized);
    const filename = `${truncated}.md`;
    const filePath = path.join(dir, filename);
    try {
      if (this.config.retryOnLock) {
        await deleteFileWithRetry(filePath, this.config.maxRetries ?? DEFAULT_MAX_RETRIES);
      } else {
        await fs.unlink(filePath);
      }
    } catch (err: unknown) {
      // File already gone — treat as success.
      if (typeof err === 'object' && err !== null && 'code' in err &&
          (err as { code: string }).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Lists all notes in the notes folder
   * 
   * Scans the notes folder for .md files RECURSIVELY and returns their filenames.
   * Optionally filters results using fuzzy matching.
   * 
   * @param pattern - Optional pattern for fuzzy filtering
   * @returns Array of note filenames (including .md extension and relative path)
   * @throws SecurityError if pattern contains path traversal
   * 
   * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
   * 
   * @example
   * const notes = await service.listNotes();
   * // Returns: ['Note-1.md', 'engineering/Note-2.md', ...]
   * 
   * @example
   * const filtered = await service.listNotes('critical');
   * // Returns: ['Biology-Notes.md', 'thoughts/Critical-Analysis.md', ...]
   */
  public async listNotes(pattern?: string): Promise<string[]> {
    // Security: Reject path traversal in pattern
    if (pattern) {
      validatePathSecurity(pattern);
    }

    // Always list from vault root — the AI can see everything
    const basePath = this.config.vaultPath;

    // Check if vault exists
    const exists = await directoryExists(basePath);
    if (!exists) {
      return [];
    }

    // Recursively find all .md files
    const mdFiles = await this.findMarkdownFilesRecursive(basePath, basePath);

    // If no pattern, return all files
    if (!pattern) {
      return mdFiles;
    }

    // A pattern containing a path separator is a folder/path-scoped query
    // (e.g. "main/", "main/projects/"), NOT a fuzzy fragment. fzf would
    // fuzzy-match the slashes against unrelated files, so match by substring
    // directly and skip fzf for these.
    const isPathPattern = pattern.includes('/') || pattern.includes('\\');

    // Try fzf for fuzzy filtering first (only for non-path fragments).
    if (!isPathPattern) {
      try {
        const fileList = mdFiles.join('\n');
        // Use printf to avoid echo quoting issues on Windows
        const { stdout } = await execAsync(
          `printf '%s' "${escapeShellArg(fileList)}" | fzf --filter="${escapeShellArg(pattern)}"`,
          { timeout: 2000 }
        );
        const filtered = stdout.trim().split('\n').filter(Boolean);
        if (filtered.length > 0) {
          return filtered;
        }
      } catch {
        // fzf not available or no matches, fall back to simple filtering
      }
    }

    // Fallback: case-insensitive substring matching (paths use forward slashes).
    const lowerPattern = pattern.toLowerCase().replace(/\\/g, '/');
    return mdFiles.filter(file => file.toLowerCase().includes(lowerPattern));
  }

  /**
   * Recursively finds all markdown files in a directory
   * 
   * @param dirPath - The directory to search
   * @param basePath - The base path to make results relative to
   * @returns Array of relative file paths
   */
  private async findMarkdownFilesRecursive(dirPath: string, basePath: string): Promise<string[]> {
    const results: string[] = [];

    try {
      // Read directory contents
      let entries: string[];
      if (this.config.retryOnLock) {
        entries = await retryWithBackoff(
          () => fs.readdir(dirPath),
          this.config.maxRetries ?? DEFAULT_MAX_RETRIES
        );
      } else {
        entries = await fs.readdir(dirPath);
      }

      // Process each entry
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        
        try {
          const stat = await fs.stat(fullPath);
          
          if (stat.isDirectory()) {
            // Recursively search subdirectories
            const subResults = await this.findMarkdownFilesRecursive(fullPath, basePath);
            results.push(...subResults);
          } else if (stat.isFile() && entry.endsWith('.md')) {
            // Add markdown file with relative path
            const relativePath = path.relative(basePath, fullPath);
            // Normalize path separators to forward slashes for consistency
            const normalizedPath = relativePath.replace(/\\/g, '/');
            results.push(normalizedPath);
          }
        } catch (err) {
          // Skip files/directories we can't access
          console.warn(`Skipping ${fullPath}:`, err);
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${dirPath}:`, err);
    }

    return results;
  }

  /**
   * Searches the Obsidian vault for notes containing the query
   * 
   * Uses ripgrep (rg) if available, falls back to grep.
   * Returns matching files with surrounding context.
   * 
   * @param query - The search query string
   * @returns Array of search results with file and context
   * @throws SecurityError if query contains path traversal
   * 
   * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
   * 
   * @example
   * const results = await service.search('photosynthesis');
   * // Returns: [{ file: 'Biology-Notes.md', context: '...the light reactions...' }]
   */
  public async search(query: string): Promise<SearchResult[]> {
    // Security: Reject path traversal in query
    validatePathSecurity(query);

    if (!query || query.trim().length === 0) {
      return [];
    }

    const vaultPath = this.config.vaultPath;
    const trimmedQuery = query.trim();

    // Try ripgrep first (fastest)
    try {
      const results = await this.searchWithRipgrep(trimmedQuery, vaultPath);
      return results;
    } catch {
      // ripgrep not available, try grep
    }

    // Fallback to grep
    try {
      const results = await this.searchWithGrep(trimmedQuery, vaultPath);
      return results;
    } catch {
      // grep also failed, return empty results
      console.warn('Search tools (rg, grep) unavailable');
      return [];
    }
  }

  /**
   * Searches using ripgrep (rg)
   * 
   * @param query - The search query
   * @param vaultPath - The vault path to search
   * @returns Array of search results
   */
  private async searchWithRipgrep(query: string, vaultPath: string): Promise<SearchResult[]> {
    // Use -C 2 for 2 lines of context, --type md for markdown files
    // Use -i for case-insensitive, -n for line numbers
    const { stdout } = await execAsync(
      `rg -i -n -C 2 --type md "${escapeShellArg(query)}" "${escapeShellArg(vaultPath)}"`,
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );

    return this.parseSearchOutput(stdout, vaultPath);
  }

  /**
   * Searches using grep
   * 
   * @param query - The search query
   * @param vaultPath - The vault path to search
   * @returns Array of search results
   */
  private async searchWithGrep(query: string, vaultPath: string): Promise<SearchResult[]> {
    // Use -r for recursive, -i for case-insensitive, -n for line numbers
    // Use -C 2 for 2 lines of context, --include for markdown files
    const { stdout } = await execAsync(
      `grep -r -i -n -C 2 --include="*.md" "${escapeShellArg(query)}" "${escapeShellArg(vaultPath)}"`,
      { timeout: 10000, maxBuffer: 1024 * 1024 }
    );

    return this.parseSearchOutput(stdout, vaultPath);
  }

  /**
   * Parses search output from ripgrep or grep
   * 
   * @param output - The raw output from the search command
   * @param vaultPath - The vault path for making paths relative
   * @returns Array of search results
   */
  private parseSearchOutput(output: string, vaultPath: string): SearchResult[] {
    if (!output || output.trim().length === 0) {
      return [];
    }

    const results: SearchResult[] = [];
    const seenFiles = new Set<string>();

    // Split by file separator (-- in grep/rg output)
    const blocks = output.split(/^--$/m);

    for (const block of blocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;

      // Extract file path from the first line
      // Format: /path/to/file.md:linenum:content or /path/to/file.md-linenum-content
      const firstLine = trimmedBlock.split('\n')[0];
      const fileMatch = firstLine.match(/^(.+\.md)[:-]\d+[:-]/);
      
      if (fileMatch) {
        let filePath = fileMatch[1];
        
        // Make path relative to vault
        if (filePath.startsWith(vaultPath)) {
          filePath = filePath.slice(vaultPath.length);
          // Remove leading separator
          if (filePath.startsWith(path.sep) || filePath.startsWith('/')) {
            filePath = filePath.slice(1);
          }
        }

        // Only add each file once
        if (!seenFiles.has(filePath)) {
          seenFiles.add(filePath);
          results.push({
            file: filePath,
            context: trimmedBlock,
          });
        }
      }
    }

    // If no blocks were parsed, try line-by-line parsing
    if (results.length === 0) {
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const fileMatch = line.match(/^(.+\.md)[:-]\d+[:-]/);
        if (fileMatch) {
          let filePath = fileMatch[1];
          
          // Make path relative to vault
          if (filePath.startsWith(vaultPath)) {
            filePath = filePath.slice(vaultPath.length);
            if (filePath.startsWith(path.sep) || filePath.startsWith('/')) {
              filePath = filePath.slice(1);
            }
          }

          if (!seenFiles.has(filePath)) {
            seenFiles.add(filePath);
            // Collect all lines for this file
            const fileLines = lines.filter(l => l.startsWith(fileMatch[1]));
            results.push({
              file: filePath,
              context: fileLines.join('\n'),
            });
          }
        }
      }
    }

    return results;
  }
}

// ============================================================================
// Singleton Export (for drop-in replacement compatibility)
// ============================================================================

/**
 * Singleton instance holder
 */
let singletonInstance: LocalObsidianService | null = null;

/**
 * Singleton export for drop-in replacement of webhook-based service
 * 
 * Provides the same interface as the original obsidian-service.ts
 * 
 * Requirements: 8.3
 */
export const localObsidianService = {
  /**
   * Gets or creates the singleton instance
   * 
   * @returns The LocalObsidianService singleton
   * @throws ConfigurationError if OBSIDIAN_VAULT_PATH is not set
   * @throws VaultNotFoundError if vault directory doesn't exist
   */
  async getInstance(): Promise<LocalObsidianService> {
    if (!singletonInstance) {
      singletonInstance = await LocalObsidianService.create();
    }
    return singletonInstance;
  },

  /**
   * Processes a note task using the singleton instance
   * 
   * @param task - The note task string to process
   * @returns ObsidianNoteCall response
   */
  async sendNoteTask(task: string): Promise<ObsidianNoteCall> {
    const instance = await this.getInstance();
    return instance.sendNoteTask(task);
  },

  /**
   * Reads a note from the vault
   * 
   * @param filename - The filename or path of the note to read
   * @returns The parsed note with frontmatter and content
   */
  async readNote(filename: string): Promise<ParsedObsidianNote> {
    const instance = await this.getInstance();
    return instance.readNote(filename);
  },

  /**
   * Gets the vault path from the singleton instance
   * 
   * @returns The vault path
   */
  async getVaultPath(): Promise<string> {
    const instance = await this.getInstance();
    return instance.getVaultPath();
  },

  /**
   * Searches the vault for notes containing the query
   * 
   * @param query - The search query string
   * @returns Array of search results
   */
  async search(query: string): Promise<SearchResult[]> {
    const instance = await this.getInstance();
    return instance.search(query);
  },

  /**
   * Lists notes with optional fuzzy filtering
   * 
   * @param pattern - Optional pattern for fuzzy filtering
   * @returns Array of note filenames
   */
  async listNotes(pattern?: string): Promise<string[]> {
    const instance = await this.getInstance();
    return instance.listNotes(pattern);
  },

  /**
   * Appends content to the end of an existing note
   * 
   * @param filename - The filename or path of the note
   * @param content - Content to append
   */
  async appendNote(filename: string, content: string): Promise<void> {
    const instance = await this.getInstance();
    return instance.appendNote(filename, content);
  },

  /**
   * Deletes a note by its display title (same filename derivation as createNote).
   * Silently succeeds if the file does not exist.
   */
  async deleteNoteByTitle(title: string): Promise<void> {
    const instance = await this.getInstance();
    return instance.deleteNoteByTitle(title);
  },

  /**
   * Resets the singleton instance (useful for testing)
   */
  resetInstance(): void {
    singletonInstance = null;
  },
};

export type { LocalObsidianConfig, ObsidianNoteFrontmatter, ParsedObsidianNote } from './types';
