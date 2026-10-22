/**
 * Core data types for the application
 */

// Message interface with flat structure
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string format for easy serialization
}

// API types for chat functionality
export interface ChatRequest {
  message: string;
  sessionId?: string;
  sessionMessages?: Message[]; // Current session messages from frontend
  model?: 'gemini' | 'gemini-pro' | 'claude' | 'kimi' | 'kimi-thinking' | 'glm' | 'kiro'; // Model selection
  discordContext?: {
    userId: string;
    channelId: string;
  };
  /** Summary of older messages that were trimmed from sessionMessages */
  sessionSummary?: string;
  /**
   * 'reader' = a reading-companion reply to a highlighted passage. Uses a
   * focused system prompt with NO personal memory/vault context, so replies
   * engage the material instead of dragging in unrelated personal projects.
   */
  mode?: 'reader';
}

export interface ChatResponse {
  response: string;
  timestamp: string;
  sessionId: string;
}

// Session management types
export interface SessionData {
  sessionId: string;
  messages: Message[];
  lastActivity: string;
  createdAt: string;
}

// Chat History types for conversation management
export interface ConversationSession {
  sessionId: string;
  messages: Message[];
  startTime: string;
  endTime: string;
  messageCount: number;
  tags: string[];
  preview: string; // First 50 chars of first user message
  /** Summary of older messages that were compacted out */
  summary?: string;
}

export interface ChatHistoryResponse {
  conversations: ConversationSession[];
  total: number;
}

export interface UpdateConversationRequest {
  tags: string[];
}

// Code Analysis types
export interface CodeAnalysisCall {
  question: string;
  answer: string;
  timestamp: string;
}

// Obsidian Note types
export interface ObsidianNoteCall {
  task: string;
  result: string;
  timestamp: string;
}

// Google Calendar types
export interface GoogleCalendarCall {
  action: string;
  result: string;
  timestamp: string;
}

// Discord Scheduler types
export interface SchedulerCall {
  action: string;
  result: string;
  timestamp: string;
}

export interface ChatResponseWithTools extends ChatResponse {
  codeAnalysisCalls?: CodeAnalysisCall[];
  obsidianNoteCalls?: ObsidianNoteCall[];
  googleCalendarCalls?: GoogleCalendarCall[];
  schedulerCalls?: SchedulerCall[];
  shellCalls?: ShellCall[];
  gitCalls?: GitCall[];
  selfEditCalls?: SelfEditCall[];
  searchCalls?: SearchCall[];
  gmailCalls?: GmailCall[];
}

// Shell execution types
export interface ShellCall {
  task: string;
  result: string;
  timestamp: string;
}

// Git operation types
export interface GitCall {
  action: string;
  result: string;
  timestamp: string;
}

// Self-edit types
export interface SelfEditCall {
  task: string;
  result: string;
  timestamp: string;
}

// Web search types
export interface SearchCall {
  query: string;
  result: string;
  timestamp: string;
}

// Gmail types
export interface GmailCall {
  action: string;
  result: string;
  timestamp: string;
}


