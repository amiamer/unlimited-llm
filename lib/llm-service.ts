/**
 * Unified LLM service interface.
 */

import {
  Message,
  CodeAnalysisCall,
  ObsidianNoteCall,
  GoogleCalendarCall,
  SchedulerCall,
  ShellCall,
  GitCall,
  SelfEditCall,
  SearchCall,
  GmailCall,
} from './types';
import type { AgentContextBundle } from './agent-context';

export interface LLMRequest {
  userMessage: string;
  sessionMessages?: Message[];
  discordContext?: {
    userId: string;
    channelId: string;
  };
  /** Ordered, bounded, source-marked context shared by all agent surfaces. */
  agentContext?: AgentContextBundle;
  /** Summary of older messages that were trimmed from the session. */
  sessionSummary?: string;
  /**
   * Replace the full personal-assistant system prompt with this text verbatim.
   * Focused surfaces such as reader annotation replies use this to ensure the
   * personal agent context is not rendered.
   */
  systemPromptOverride?: string;
}

export interface LLMResponse {
  content: string;
  timestamp: string;
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

export interface LLMProvider {
  generateResponse(request: LLMRequest): Promise<LLMResponse>;
  testConnection(): Promise<boolean>;
  getModelId(): string;
}
