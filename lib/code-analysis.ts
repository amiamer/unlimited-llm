/**
 * Code Analysis Service
 * 
 * This module provides code analysis functionality using local file operations.
 * It replaces the previous n8n webhook-based implementation with direct
 * file system access for offline operation and faster response times.
 * 
 * The service discovers relevant source files, selects them based on
 * keyword matching from the user's question, and returns formatted
 * file contents for analysis.
 * 
 * Requirements: 12.1-12.6, 13.1-13.7, 14.1-14.5, 17.3, 17.4
 */

// Re-export everything from the local implementation
export {
  LocalCodeAnalysisService,
  localCodeAnalysisService,
  codeAnalysisService,
} from './local-code-analysis';

export type {
  CodeAnalysisConfig,
  CodeAnalysisResult,
} from './local-code-analysis';

// Legacy interface types for backward compatibility
export interface CodeAnalysisRequest {
  question: string;
}

export interface CodeAnalysisResponse {
  answer: string;
}
