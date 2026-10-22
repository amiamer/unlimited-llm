/**
 * Local Code Analysis Service
 * 
 * Replaces the n8n webhook-based code analysis with local file operations.
 * Provides the same interface as the original codeAnalysisService while
 * operating entirely on the local file system.
 * 
 * Features:
 * - File discovery using git ls-files or find
 * - Heuristic file selection based on keyword matching
 * - Fast content retrieval using fs.readFile
 * - 30-second file listing cache for performance
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.1-13.7, 14.1-14.5, 15.3, 16.4, 16.5
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SecurityError } from './local-storage/errors';
import { validatePathSecurity } from './local-storage/path-utils';

const execAsync = promisify(exec);

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Configuration for LocalCodeAnalysisService
 */
export interface CodeAnalysisConfig {
  workspaceRoot?: string;          // Auto-detected if not provided
  maxFiles?: number;               // Default: 5
  fileExtensions?: string[];       // Default: ['.ts', '.tsx', '.js', '.jsx', '.md', '.py']
}

/**
 * Result of code analysis (matches webhook interface)
 */
export interface CodeAnalysisResult {
  question: string;
  answer: string;                  // Formatted file contents
  timestamp: string;
  selectedFiles?: string[];        // Files that were selected for analysis
}

/**
 * Internal cache structure for file listings
 */
interface FileListCache {
  files: string[];
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default file extensions to include in discovery
 */
const DEFAULT_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.py'];

/**
 * Default maximum number of files to select
 */
const DEFAULT_MAX_FILES = 5;

/**
 * Cache TTL in milliseconds (30 seconds)
 * 
 * Requirements: 16.4, 16.5
 */
const CACHE_TTL_MS = 30000;

/**
 * Common stop words to remove from questions during keyword extraction
 * 
 * Requirements: 13.2
 */
const STOP_WORDS = new Set([
  'how', 'does', 'the', 'work', 'is', 'are', 'what', 'where', 'why',
  'can', 'could', 'should', 'would', 'a', 'an', 'in', 'on', 'at',
  'to', 'for', 'of', 'with', 'this', 'that', 'it', 'be', 'do',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'which', 'who',
  'my', 'your', 'our', 'their', 'its', 'i', 'you', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'about', 'from', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'again', 'further', 'once', 'here', 'there', 'all', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
  'tell', 'show', 'explain', 'describe', 'find', 'get', 'make', 'use'
]);

// ============================================================================
// LocalCodeAnalysisService Class
// ============================================================================

/**
 * LocalCodeAnalysisService provides local file-based code analysis
 * 
 * This is a drop-in replacement for the webhook-based code-analysis.ts,
 * enabling fully offline operation while maintaining the same interface.
 * 
 * @example
 * const service = new LocalCodeAnalysisService();
 * const result = await service.analyzeCode('How does authentication work?');
 * console.log(result.answer); // Formatted file contents
 * 
 * Requirements: 12.1, 12.2, 12.6
 */
export class LocalCodeAnalysisService {
  private config: CodeAnalysisConfig;
  private workspaceRoot: string | null = null;
  private fileListCache: FileListCache | null = null;

  /**
   * Creates a new LocalCodeAnalysisService instance
   * 
   * @param config - Optional configuration
   */
  constructor(config?: CodeAnalysisConfig) {
    this.config = {
      maxFiles: config?.maxFiles ?? DEFAULT_MAX_FILES,
      fileExtensions: config?.fileExtensions ?? DEFAULT_FILE_EXTENSIONS,
      workspaceRoot: config?.workspaceRoot,
    };
  }


  /**
   * Gets the workspace root directory
   * 
   * Uses git rev-parse --show-toplevel if in a git repo,
   * otherwise falls back to process.cwd()
   * 
   * @returns The workspace root path
   * 
   * Requirements: 12.2
   */
  private async getWorkspaceRoot(): Promise<string> {
    if (this.workspaceRoot) {
      return this.workspaceRoot;
    }

    if (this.config.workspaceRoot) {
      this.workspaceRoot = this.config.workspaceRoot;
      return this.workspaceRoot;
    }

    // Try git rev-parse first
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', {
        timeout: 5000,
      });
      this.workspaceRoot = stdout.trim();
      return this.workspaceRoot;
    } catch {
      // Not in a git repo, use cwd
      this.workspaceRoot = process.cwd();
      return this.workspaceRoot;
    }
  }

  /**
   * Discovers all relevant source files in the workspace
   * 
   * Uses git ls-files if in a git repo, otherwise uses find.
   * Results are cached for 30 seconds.
   * 
   * @returns Array of file paths relative to workspace root
   * 
   * Requirements: 12.3, 12.4, 12.5, 16.4, 16.5
   */
  private async discoverFiles(): Promise<string[]> {
    // Check cache first
    if (this.fileListCache && Date.now() - this.fileListCache.timestamp < CACHE_TTL_MS) {
      return this.fileListCache.files;
    }

    const root = await this.getWorkspaceRoot();
    let files: string[];

    // Try git ls-files first (respects .gitignore)
    try {
      files = await this.discoverFilesWithGit(root);
    } catch {
      // Fallback to find
      files = await this.discoverFilesWithFind(root);
    }

    // Update cache
    this.fileListCache = { files, timestamp: Date.now() };
    return files;
  }

  /**
   * Discovers files using git ls-files
   * 
   * @param root - The workspace root
   * @returns Array of file paths
   */
  private async discoverFilesWithGit(root: string): Promise<string[]> {
    const extensions = this.config.fileExtensions ?? DEFAULT_FILE_EXTENSIONS;
    const patterns = extensions.map(ext => `"*${ext}"`).join(' ');
    
    const { stdout } = await execAsync(
      `git ls-files ${patterns}`,
      { cwd: root, timeout: 5000, maxBuffer: 1024 * 1024 }
    );

    return stdout.trim().split('\n').filter(Boolean);
  }

  /**
   * Discovers files using find command (Unix) or Node.js fs (Windows)
   * 
   * @param root - The workspace root
   * @returns Array of file paths
   */
  private async discoverFilesWithFind(root: string): Promise<string[]> {
    const extensions = this.config.fileExtensions ?? DEFAULT_FILE_EXTENSIONS;
    
    // On Windows, use Node.js fs module instead of find command
    if (process.platform === 'win32') {
      return this.discoverFilesWithFs(root, extensions);
    }
    
    // Build find command with extension filters (Unix)
    const nameFilters = extensions.map(ext => `-name "*${ext}"`).join(' -o ');
    
    const { stdout } = await execAsync(
      `find . -type f \\( ${nameFilters} \\) ! -path "./node_modules/*" ! -path "./.git/*" ! -path "./dist/*" ! -path "./build/*" ! -path "./.next/*"`,
      { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 }
    );

    return stdout.trim().split('\n')
      .filter(Boolean)
      .map(f => f.replace(/^\.\//, '')); // Remove leading ./
  }

  /**
   * Discovers files using Node.js fs module (Windows-compatible)
   * 
   * @param root - The workspace root
   * @param extensions - File extensions to include
   * @returns Array of file paths relative to root
   */
  private async discoverFilesWithFs(root: string, extensions: string[]): Promise<string[]> {
    const excludeDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
    const files: string[] = [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          
          if (entry.isDirectory()) {
            // Skip excluded directories
            if (!excludeDirs.has(entry.name)) {
              await walk(path.join(dir, entry.name), entryRelPath);
            }
          } else if (entry.isFile()) {
            // Check if file has a matching extension
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              files.push(entryRelPath);
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    await walk(root);
    return files;
  }

  /**
   * Extracts keywords from a question
   * 
   * Removes stop words and returns meaningful terms for file matching.
   * 
   * @param question - The user's question
   * @returns Array of keywords
   * 
   * Requirements: 13.1, 13.2
   */
  private extractKeywords(question: string): string[] {
    return question
      .toLowerCase()
      .replace(/[^a-z0-9\s\-_]/g, ' ')  // Remove special chars
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word));
  }

  /**
   * Selects relevant files based on keyword matching
   * 
   * Uses pure heuristic matching - no AI calls.
   * 
   * @param question - The user's question
   * @param allFiles - All discovered files
   * @returns Array of selected file paths (max 5)
   * 
   * Requirements: 13.3, 13.4, 13.5, 13.6, 13.7
   */
  private selectRelevantFiles(question: string, allFiles: string[]): string[] {
    const keywords = this.extractKeywords(question);
    const maxFiles = this.config.maxFiles ?? DEFAULT_MAX_FILES;

    if (keywords.length === 0) {
      // No keywords - return README if exists
      const readme = allFiles.find(f => f.toLowerCase() === 'readme.md');
      return readme ? [readme] : [];
    }

    // Score files by keyword matches
    const scored = allFiles.map(file => {
      const filename = file.toLowerCase();
      const score = keywords.filter(kw => filename.includes(kw)).length;
      return { file, score };
    });

    // Sort by score descending, take top N
    const selected = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles)
      .map(s => s.file);

    // If no matches, try README
    if (selected.length === 0) {
      const readme = allFiles.find(f => f.toLowerCase() === 'readme.md');
      return readme ? [readme] : [];
    }

    return selected;
  }

  /**
   * Validates a file path for security
   * 
   * @param filePath - The file path to validate
   * @throws SecurityError if path traversal is detected
   * 
   * Requirements: 15.3
   */
  private validatePath(filePath: string): void {
    validatePathSecurity(filePath);
  }

  /**
   * Formats file content with a separator
   * 
   * @param filename - The filename
   * @param content - The file content
   * @returns Formatted content with separator
   * 
   * Requirements: 14.2, 14.3
   */
  private formatFileContent(filename: string, content: string): string {
    return `--- ${filename} ---\n${content}\n`;
  }

  /**
   * Reads and formats contents of selected files
   * 
   * @param files - Array of file paths to read
   * @returns Combined formatted content
   * 
   * Requirements: 14.1, 14.4
   */
  private async readFileContents(files: string[]): Promise<string> {
    const root = await this.getWorkspaceRoot();
    const contents: string[] = [];

    for (const file of files) {
      try {
        this.validatePath(file);  // Security check
        const filePath = path.join(root, file);
        const content = await fs.readFile(filePath, 'utf-8');
        contents.push(this.formatFileContent(file, content));
      } catch (error) {
        // Skip unreadable files, continue with others
        if (error instanceof SecurityError) {
          console.warn(`Security violation for ${file}:`, error.message);
        } else {
          console.warn(`Failed to read ${file}:`, error);
        }
      }
    }

    return contents.join('\n');
  }

  /**
   * Analyzes code by selecting and reading relevant files
   * 
   * This is the main entry point, matching the webhook interface.
   * 
   * @param question - The user's question about the code
   * @returns CodeAnalysisResult with formatted file contents
   * @throws Error if question is empty
   * 
   * Requirements: 12.6, 14.5
   */
  async analyzeCode(question: string): Promise<CodeAnalysisResult> {
    if (!question || question.trim().length === 0) {
      throw new Error('Question cannot be empty');
    }

    const trimmedQuestion = question.trim();
    const timestamp = new Date().toISOString();

    // Discover all files
    const allFiles = await this.discoverFiles();

    // Select relevant files based on keywords
    const selectedFiles = this.selectRelevantFiles(trimmedQuestion, allFiles);

    // Read and format file contents
    const formattedContent = await this.readFileContents(selectedFiles);

    // Return result matching webhook interface
    return {
      question: trimmedQuestion,
      answer: formattedContent || 'No relevant files found for the given question.',
      timestamp,
      selectedFiles,
    };
  }

  /**
   * Tests if the service can discover files
   * 
   * @returns true if file discovery works
   */
  async testConnection(): Promise<boolean> {
    try {
      const files = await this.discoverFiles();
      return files.length > 0;
    } catch (error) {
      console.error('Code analysis test failed:', error);
      return false;
    }
  }

  /**
   * Clears the file list cache
   * 
   * Useful for testing or when files have changed
   */
  clearCache(): void {
    this.fileListCache = null;
  }
}

// ============================================================================
// Singleton Export (for drop-in replacement)
// ============================================================================

/**
 * Singleton instance
 */
let singletonInstance: LocalCodeAnalysisService | null = null;

/**
 * Gets or creates the singleton instance
 */
function getLocalCodeAnalysisService(): LocalCodeAnalysisService {
  if (!singletonInstance) {
    singletonInstance = new LocalCodeAnalysisService();
  }
  return singletonInstance;
}

/**
 * Singleton export for drop-in replacement of webhook-based service
 * 
 * Provides the same interface as the original codeAnalysisService
 */
export const localCodeAnalysisService = {
  /**
   * Analyzes code by selecting and reading relevant files
   * 
   * @param question - The user's question about the code
   * @returns CodeAnalysisResult with formatted file contents
   */
  async analyzeCode(question: string): Promise<CodeAnalysisResult> {
    return getLocalCodeAnalysisService().analyzeCode(question);
  },

  /**
   * Tests if the service can discover files
   * 
   * @returns true if file discovery works
   */
  async testConnection(): Promise<boolean> {
    return getLocalCodeAnalysisService().testConnection();
  },

  /**
   * Clears the file list cache
   */
  clearCache(): void {
    getLocalCodeAnalysisService().clearCache();
  },

  /**
   * Resets the singleton instance (useful for testing)
   */
  resetInstance(): void {
    singletonInstance = null;
  },
};

// Also export as codeAnalysisService for drop-in replacement
export const codeAnalysisService = localCodeAnalysisService;
