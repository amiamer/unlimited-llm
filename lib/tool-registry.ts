/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * Shared Tool Registry
 * 
 * Single source of truth for all tool definitions and execution logic.
 * Provider files import from here instead of defining tools inline.
 * 
 * To add a new tool:
 * 1. Add its definition to TOOL_DEFINITIONS
 * 2. Add its execution handler to executeTool()
 * 3. All three providers (Gemini, Claude, Kimi) get it automatically.
 */

import { CodeAnalysisCall, ObsidianNoteCall, GoogleCalendarCall, SchedulerCall } from './types';
import { codeAnalysisService } from './code-analysis';
import { localObsidianService } from './local-storage';
import { googleCalendarService } from './google-calendar-service';
import { gmailService } from './gmail-service';
import { getScheduler } from './discord-scheduler';
import { getToolContext } from './tool-context';
import { isProtectedAgentContextPath } from './agent-context';
import { tavilySearch, formatSearchResults } from './tavily-search';
import * as fs from 'fs/promises';
import * as path from 'path';

const PROJECT_ROOT = process.cwd();
const DEFAULT_CALENDAR_ID = process.env.DEFAULT_CALENDAR_ID || 'primary';

/**
 * True if `child` is `root` itself or a path contained within it.
 * Uses path.relative rather than string prefixing so a sibling directory
 * (e.g. "<root>-secrets") cannot pass a naive startsWith check.
 */
function isPathInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * True if the file holds local secrets that must never be read/written by tools:
 * .env in any form, OAuth client secrets, service-account keys, auth tokens.
 */
function isSecretFile(fullPath: string): boolean {
  const base = path.basename(fullPath).toLowerCase();
  return (
    base === '.env' ||
    base.startsWith('.env.') && base !== '.env.example' ||
    base === 'gmail-token.json' ||
    base.startsWith('client_secret') ||
    base.endsWith('-key.json') ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base === 'ngrok.yml'
  );
}

// ============================================================================
// Tool Execution Timeout
// ============================================================================

const TOOL_TIMEOUT_MS = 60_000; // 60 seconds per tool call

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within
 * the given ms, rejects with a timeout error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ============================================================================
// Tool Definition Types
// ============================================================================

export interface ToolParam {
  type: 'string' | 'number';
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
  required: string[];
  category: 'code' | 'obsidian' | 'calendar' | 'scheduler' | 'memory' | 'shell' | 'git' | 'self-edit' | 'search' | 'gmail';
}

// ============================================================================
// Tool Execution Result
// ============================================================================

export interface ToolExecutionResult {
  /** The response data to send back to the LLM */
  response: Record<string, string>;
  /** Tracking call for the UI tool panel */
  call?: CodeAnalysisCall | ObsidianNoteCall | GoogleCalendarCall | SchedulerCall | { task: string; result: string; timestamp: string } | { action: string; result: string; timestamp: string } | { query: string; result: string; timestamp: string };
  category: 'code' | 'obsidian' | 'calendar' | 'scheduler' | 'memory' | 'shell' | 'git' | 'self-edit' | 'search' | 'gmail';
}

// ============================================================================
// Tool Definitions — THE single source of truth
// ============================================================================

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // --- Code Analysis ---
  {
    name: 'analyze_code',
    description: 'Analyze the codebase by asking specific questions about code structure, patterns, dependencies, or implementation details. Use this when you need to understand how the code works, find specific implementations, or get insights about the codebase architecture.',
    parameters: {
      question: { type: 'string', description: "A specific question about the codebase (e.g., 'How is authentication implemented?', 'What are the main API endpoints?', 'Show me the database schema')" },
    },
    required: ['question'],
    category: 'code',
  },

  // --- Obsidian CRUD ---
  {
    name: 'read_obsidian_note',
    description: "Reads and returns the content of a note from the Obsidian vault. All paths are relative to the vault root. USE THIS TOOL when the user says: 'read', 'show', 'open', 'view', 'look at', 'display', 'get', or 'what does X say'. Examples: 'read main/readme.md', 'show me main/permanent/ideas.md', 'open AI-Notes/todo.md'. The filename should include the folder path relative to vault root. CURATION RULES: Do NOT re-read a note you already read in this conversation unless the user explicitly asks. If you already have the content, reference it from memory instead of calling this tool again.",
    parameters: {
      filename: { type: 'string', description: "The path of the note relative to vault root (e.g., 'main/readme.md', 'main/permanent/ideas.md', 'AI-Notes/todo.md')." },
    },
    required: ['filename'],
    category: 'obsidian',
  },
  {
    name: 'search_obsidian_vault',
    description: "Searches the ENTIRE Obsidian vault (both human notes and AI-generated notes) for notes containing specific text. USE THIS TOOL when the user says: 'search', 'find', 'look for', 'search for', 'find notes about', or 'where is'. Also use this proactively when the user asks about their past thoughts, ideas, or notes. Examples: 'search for photosynthesis', 'find notes about cell biology', 'what was that idea I had about X'. CURATION RULES: Do NOT show the same note twice in a conversation. Summarize search results before presenting them — don't just dump raw content. Prioritize the most relevant 2-3 results over showing everything. If a search returns many results, tell the user how many were found and highlight the best matches.",
    parameters: {
      query: { type: 'string', description: "The search query to find matching notes (e.g., 'photosynthesis', 'cell biology', 'project planning')" },
    },
    required: ['query'],
    category: 'obsidian',
  },
  {
    name: 'list_obsidian_notes',
    description: "Lists all notes in the Obsidian vault. Returns every .md file across the entire vault (all folders). Optionally filter by a search pattern. USE THIS TOOL when the user says: 'list', 'list notes', 'what notes', 'show all notes', or 'list files'. Use this to discover what's in the vault.",
    parameters: {
      pattern: { type: 'string', description: "Optional filter pattern to match note names (e.g., 'meeting', 'philosophy', 'main'). Leave empty to list all notes in the entire vault." },
    },
    required: [],
    category: 'obsidian',
  },
  {
    name: 'create_obsidian_note',
    description: "Creates a NEW note in the Obsidian vault. By default creates in AI-Notes folder. To create in a specific folder, include the folder path in the title (e.g. 'main/Meeting Notes', 'main/permanent/New Idea'). ONLY use this when the user EXPLICITLY wants to CREATE or WRITE a NEW note. Trigger words: 'create', 'write', 'save', 'add', 'make a note'. Do NOT use this tool for: reading, viewing, showing, searching, listing, updating, or opening notes.",
    parameters: {
      title: { type: 'string', description: "The title for the new note. Include folder path to create outside AI-Notes (e.g., 'main/Meeting Notes', 'main/permanent/Book Summary'). Without a path, creates in AI-Notes." },
      content: { type: 'string', description: 'The markdown content for the note body. Can include headers, lists, links, etc.' },
    },
    required: ['title', 'content'],
    category: 'obsidian',
  },
  {
    name: 'update_obsidian_note',
    description: "Updates the content of an EXISTING note in the Obsidian vault. Path is relative to vault root. USE THIS TOOL when the user wants to: 'update', 'modify', 'change', 'edit', 'revise', or 'replace content in' an existing note. Always confirm before modifying Amer's notes outside AI-Notes/.",
    parameters: {
      filename: { type: 'string', description: "The path of the note relative to vault root (e.g., 'main/readme.md', 'AI-Notes/todo.md')." },
      content: { type: 'string', description: 'The full new content for the note. This will replace the entire file content.' },
    },
    required: ['filename', 'content'],
    category: 'obsidian',
  },
  {
    name: 'append_obsidian_note',
    description: "Appends content to the END of an existing note without replacing anything. Much safer than update for adding items to lists, journals, or task files. USE THIS TOOL when the user wants to: 'add to', 'append', 'add a bullet', 'log', 'journal', or when YOU need to incrementally add to your own notes. Prefer this over update_obsidian_note when you only need to add content.",
    parameters: {
      filename: { type: 'string', description: "The path of the note relative to vault root (e.g., 'main/readme.md', 'AI-Notes/active-tasks.md')." },
      content: { type: 'string', description: 'The content to append to the end of the note. Will be added after a newline.' },
    },
    required: ['filename', 'content'],
    category: 'obsidian',
  },
  {
    name: 'delete_obsidian_note',
    description: "Deletes a note from the Obsidian vault. Path is relative to vault root. USE THIS TOOL when the user wants to: 'delete', 'remove', 'trash', or 'get rid of' a note. This permanently removes the file. Always confirm before deleting notes outside AI-Notes/.",
    parameters: {
      filename: { type: 'string', description: "The path of the note relative to vault root (e.g., 'main/old-note.md', 'AI-Notes/todo.md')." },
    },
    required: ['filename'],
    category: 'obsidian',
  },

  // --- Google Calendar CRUD ---
  {
    name: 'list_calendar_events',
    description: "Lists upcoming events from Google Calendar. USE THIS TOOL when the user wants to: 'show my calendar', 'what's on my schedule', 'list events', 'what meetings do I have', or 'show upcoming events'. You can filter by date range or search for specific events. IMPORTANT: Use ISO 8601 format for dates (YYYY-MM-DDTHH:MM:SSZ).",
    parameters: {
      calendarId: { type: 'string', description: "The calendar ID (default: 'primary' for main calendar)" },
      timeMin: { type: 'string', description: "Start time in ISO 8601 format (e.g., '2026-02-02T00:00:00Z'). Defaults to current time if not specified." },
      timeMax: { type: 'string', description: "End time in ISO 8601 format (e.g., '2026-02-09T23:59:59Z'). Optional." },
      maxResults: { type: 'number', description: 'Maximum number of events to return (default: 10)' },
      searchQuery: { type: 'string', description: 'Search query to filter events by text (optional)' },
    },
    required: [],
    category: 'calendar',
  },
  {
    name: 'get_calendar_event',
    description: 'Gets details of a specific calendar event by ID. USE THIS TOOL when the user wants details about a specific event they mentioned.',
    parameters: {
      eventId: { type: 'string', description: 'The event ID to retrieve' },
      calendarId: { type: 'string', description: "The calendar ID (default: 'primary')" },
    },
    required: ['eventId'],
    category: 'calendar',
  },
  {
    name: 'create_calendar_event',
    description: "Creates a new event in Google Calendar. USE THIS TOOL when the user wants to: 'create event', 'schedule meeting', 'add to calendar', 'book appointment', or 'set reminder'. IMPORTANT: Convert user's date/time to ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) using the current date/time context provided.",
    parameters: {
      summary: { type: 'string', description: "Event title/summary (e.g., 'Team Meeting', 'Doctor Appointment')" },
      description: { type: 'string', description: 'Event description/notes (optional)' },
      location: { type: 'string', description: "Event location (optional, e.g., 'Conference Room A', 'Zoom')" },
      startDateTime: { type: 'string', description: "Start date-time in ISO 8601 format (e.g., '2026-02-05T14:00:00Z'). Calculate from current date/time context." },
      endDateTime: { type: 'string', description: "End date-time in ISO 8601 format (e.g., '2026-02-05T15:00:00Z'). Calculate from current date/time context." },
      timeZone: { type: 'string', description: "Time zone (optional, e.g., 'America/Chicago'). Use the timezone from current context if not specified." },
      attendees: { type: 'string', description: "Comma-separated list of attendee emails (optional, e.g., 'john@example.com,jane@example.com')" },
      calendarId: { type: 'string', description: "The calendar ID (default: 'primary')" },
    },
    required: ['summary', 'startDateTime', 'endDateTime'],
    category: 'calendar',
  },
  {
    name: 'update_calendar_event',
    description: "Updates an existing calendar event. USE THIS TOOL when the user wants to: 'update event', 'change meeting time', 'reschedule', 'modify event', or 'edit calendar entry'. IMPORTANT: Convert user's date/time to ISO 8601 format using the current date/time context.",
    parameters: {
      eventId: { type: 'string', description: 'The event ID to update' },
      summary: { type: 'string', description: 'New event title (optional)' },
      description: { type: 'string', description: 'New event description (optional)' },
      location: { type: 'string', description: 'New event location (optional)' },
      startDateTime: { type: 'string', description: "New start date-time in ISO 8601 format (optional, e.g., '2026-02-05T14:00:00Z')" },
      endDateTime: { type: 'string', description: "New end date-time in ISO 8601 format (optional, e.g., '2026-02-05T15:00:00Z')" },
      timeZone: { type: 'string', description: 'Time zone (optional, use timezone from current context)' },
      calendarId: { type: 'string', description: "The calendar ID (default: 'primary')" },
    },
    required: ['eventId'],
    category: 'calendar',
  },
  {
    name: 'delete_calendar_event',
    description: "Deletes a calendar event. USE THIS TOOL when the user wants to: 'delete event', 'cancel meeting', 'remove from calendar', or 'cancel appointment'.",
    parameters: {
      eventId: { type: 'string', description: 'The event ID to delete' },
      calendarId: { type: 'string', description: "The calendar ID (default: 'primary')" },
    },
    required: ['eventId'],
    category: 'calendar',
  },

  // --- Discord Scheduler ---
  {
    name: 'schedule_discord_message',
    description: "Schedules a one-shot or recurring message on Discord. USE THIS TOOL when the user wants to: 'remind me', 'send me a message', 'notify me every day', 'remind me every weekday morning', or 'message me later'. Pass the user's time expression as natural language — do NOT convert to ISO. For recurring reminders, set recurrenceType. The message will be sent in the same Discord channel. You do NOT need to ask for userId or channelId - they are automatically provided.",
    parameters: {
      message: { type: 'string', description: "The message content to send (e.g., 'Time to go to the gym!', 'Don't forget your meeting')" },
      scheduledTime: { type: 'string', description: "When to send the message. Use natural language exactly as the user said it — e.g. 'tomorrow 10am', 'in 2 hours', 'next Monday at 3pm', 'every weekday at 9am'. Do NOT convert to ISO. Pass the user's words directly." },
      recurrenceType: { type: 'string', description: "Optional. 'daily' = every day, 'weekdays' = Mon-Fri, 'weekly' = same day each week. Omit for one-shot reminders." },
      recurrenceDays: { type: 'string', description: "Optional. For 'weekly' type: comma-separated day numbers (0=Sun,1=Mon,...6=Sat). E.g. '1,3,5' for Mon/Wed/Fri." },
    },
    required: ['message', 'scheduledTime'],
    category: 'scheduler',
  },
  {
    name: 'list_scheduled_messages',
    description: "Lists all scheduled Discord messages for the user. USE THIS TOOL when the user wants to: 'show my scheduled messages', 'what reminders do I have', 'list my scheduled notifications', or 'show upcoming messages'. User context is automatically provided.",
    parameters: {},
    required: [],
    category: 'scheduler',
  },
  {
    name: 'cancel_scheduled_message',
    description: "Cancels a scheduled Discord message. USE THIS TOOL when the user wants to: 'cancel reminder', 'delete scheduled message', 'remove notification', or 'cancel that message'.",
    parameters: {
      messageId: { type: 'string', description: 'The ID of the scheduled message to cancel' },
    },
    required: ['messageId'],
    category: 'scheduler',
  },

  // --- Shell Execution ---
  {
    name: 'execute_shell',
    description: "Executes a shell command on the local machine and returns stdout/stderr. Use for running scripts, checking builds, file operations, or other CLI tasks. Commands run from the project root. SECURITY: trusted-single-user capability, not a sandbox; commands can mutate the host. Keep the app behind the Clerk allowlist. Secret-bearing environment variables are stripped and known secret filenames are blocked. Timeout: 30 seconds.",
    parameters: {
      command: { type: 'string', description: "The shell command to execute (e.g., 'npm run build', 'ls -la', 'cat .env.example', 'git status')" },
      cwd: { type: 'string', description: "Optional working directory. Defaults to project root." },
    },
    required: ['command'],
    category: 'shell',
  },

  // --- Read Amer's past chat transcripts ---
  {
    name: 'read_chat_history',
    description: "Search and read Amer's OWN past chat transcripts — his Claude app chats, Discord chats, and web chats, all saved locally. Use this WHENEVER he asks you to recall, search, summarize, or reference anything from a past conversation ('what did I say about X', 'my Claude chats', 'that discord convo'). One call does it — DO NOT use the shell for this. Pass `query` to find matching conversations across all of them, or `sessionId` to read one full transcript. Returns clean role/content messages. Read-only.",
    parameters: {
      query: { type: 'string', description: "Keyword or phrase to search across all past chats (case-insensitive; matches message text and titles). Returns matching conversations with the relevant messages and their ids." },
      sessionId: { type: 'string', description: "Optional: read ONE full transcript by id (e.g. 'claude-<uuid>', 'discord-<id>', 'main'). Use ids returned by a query search." },
      source: { type: 'string', description: "Optional filter: 'claude', 'discord', 'web', or 'all' (default)." },
    },
    required: [],
    category: 'search',
  },

  // --- Git Operations ---
  {
    name: 'git_operation',
    description: "Performs git operations on the project repository. Supports: status, diff, log, branch, checkout, add, commit, push, create-pr. Use this for version control tasks, creating PRs for your own changes, or checking repo state. For create-pr: requires GitHub CLI (gh) to be installed and authenticated.",
    parameters: {
      operation: { type: 'string', description: "The git operation: 'status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'push', 'create-pr'" },
      args: { type: 'string', description: "Arguments for the operation. For commit: the commit message. For checkout: branch name. For create-pr: 'title|||body' format. For log: '--oneline -10'. For add: file paths or '.' for all." },
    },
    required: ['operation'],
    category: 'git',
  },

  // --- Self-Edit (read/write project files) ---
  {
    name: 'read_project_file',
    description: "Reads a file from the project codebase. Path is relative to project root. Use this to inspect source code, configs, or any project file before making changes. For code analysis questions, prefer analyze_code. Use this when you need the raw file content.",
    parameters: {
      filepath: { type: 'string', description: "Path relative to project root (e.g., 'lib/tool-registry.ts', 'package.json', 'app/api/chat/route.ts')" },
      startLine: { type: 'number', description: "Optional start line (1-indexed). Omit to read entire file." },
      endLine: { type: 'number', description: "Optional end line (1-indexed). Omit to read to end." },
    },
    required: ['filepath'],
    category: 'self-edit',
  },
  {
    name: 'write_project_file',
    description: "Writes or creates a file in the project codebase. Path is relative to project root. Use this to implement features, fix bugs, update configs, or modify any project file. Creates parent directories if needed. For targeted edits, read the file first, modify the content, then write back.",
    parameters: {
      filepath: { type: 'string', description: "Path relative to project root (e.g., 'lib/new-feature.ts', 'app/api/new-route/route.ts')" },
      content: { type: 'string', description: "The full file content to write." },
    },
    required: ['filepath', 'content'],
    category: 'self-edit',
  },
  {
    name: 'list_project_files',
    description: "Lists files in a project directory. Path is relative to project root. Use to explore the codebase structure. Returns file names, sizes, and modification dates.",
    parameters: {
      dirpath: { type: 'string', description: "Directory path relative to project root (e.g., 'lib/', 'app/api/', '.')" },
      pattern: { type: 'string', description: "Optional glob pattern to filter (e.g., '*.ts', '*.md')" },
    },
    required: ['dirpath'],
    category: 'self-edit',
  },

  // --- Web Search (Tavily) ---
  {
    name: 'web_search',
    description: "Searches the internet for real-time information using Tavily. Returns clean, relevant content with source URLs. USE THIS TOOL when the user asks about current events, recent news, facts you're unsure about, technical documentation, product comparisons, or anything that requires up-to-date information from the web. Also use proactively when your training data might be outdated. SEARCH STRATEGY: Craft specific, focused queries. If the first search doesn't give good results, refine your query and search again with different terms. For complex topics, break into multiple targeted searches rather than one broad query. Prefer 'advanced' depth for important questions.",
    parameters: {
      query: { type: 'string', description: "The search query. Be specific and focused — e.g., 'Next.js 15 app router breaking changes' rather than 'Next.js changes'. For news, include time context like '2026'." },
      search_depth: { type: 'string', description: "Search depth: 'basic' (faster, 1 credit) or 'advanced' (more relevant results, 2 credits). Default: 'advanced'." },
      topic: { type: 'string', description: "Search category: 'general' (default) or 'news' (for recent news articles)." },
      max_results: { type: 'string', description: "Number of results to return (1-20). Default: 5. Use more for research, fewer for quick facts." },
      time_range: { type: 'string', description: "Time filter: 'day', 'week', 'month', or 'year'. Only use when recency matters." },
      include_domains: { type: 'string', description: "Comma-separated domains to search within (e.g., 'github.com,stackoverflow.com'). Leave empty for broad search." },
      exclude_domains: { type: 'string', description: "Comma-separated domains to exclude (e.g., 'pinterest.com,quora.com')." },
    },
    required: ['query'],
    category: 'search',
  },

  // --- Gmail ---
  {
    name: 'send_email',
    description: "Send an email from the user's Gmail account. Use this when the user asks you to send an email, contact someone, or follow up with someone. Do NOT ask for confirmation — send directly.",
    parameters: {
      to: { type: 'string', description: "Recipient email address (e.g., 'john@example.com')" },
      subject: { type: 'string', description: "Email subject line" },
      body: { type: 'string', description: "Email body text (plain text)" },
      cc: { type: 'string', description: "Optional CC email address" },
      bcc: { type: 'string', description: "Optional BCC email address" },
    },
    required: ['to', 'subject', 'body'],
    category: 'gmail',
  },

  // --- Writing Pipeline ---
  {
    name: 'list_drafts',
    description: "Lists all essay drafts in the writing pipeline with their status, age, and next action. USE THIS when Amer asks about his writing, essays, drafts, or 'what should I work on'. Statuses: idea → draft → editing → ready → published.",
    parameters: {},
    required: [],
    category: 'writing' as any,
  },
  {
    name: 'add_draft',
    description: "Adds a new essay draft to the writing pipeline. Use when Amer starts a new piece or when you discover an untracked draft in the vault.",
    parameters: {
      title: { type: 'string', description: "Title of the essay (e.g., 'crisis of meaning', 'the double standard')" },
      vaultPath: { type: 'string', description: "Path in Obsidian vault (e.g., 'main/thinking/philosophy/crisis of meaning.md')" },
      status: { type: 'string', description: "Current status: 'idea', 'draft', 'editing', 'ready', or 'published'" },
      editorialNotes: { type: 'string', description: "What still needs work on this piece" },
      nextAction: { type: 'string', description: "The concrete next step for this piece" },
    },
    required: ['title', 'vaultPath', 'status', 'editorialNotes', 'nextAction'],
    category: 'writing' as any,
  },
  {
    name: 'update_draft',
    description: "Updates an existing draft in the writing pipeline. Use to change status, editorial notes, or next action when progress is made.",
    parameters: {
      title: { type: 'string', description: "Title of the essay to update" },
      status: { type: 'string', description: "New status (optional): 'idea', 'draft', 'editing', 'ready', or 'published'" },
      editorialNotes: { type: 'string', description: "Updated editorial notes (optional)" },
      nextAction: { type: 'string', description: "Updated next action (optional)" },
      wordCount: { type: 'number', description: "Current word count (optional)" },
    },
    required: ['title'],
    category: 'writing' as any,
  },
];


// ============================================================================
// Format Converters — transform definitions into provider-specific formats
// ============================================================================

/** Returns current date/time context string for calendar tool descriptions */
function currentDateContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const isoStr = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ` CURRENT DATE/TIME: ${dateStr}, ISO: ${isoStr}, Timezone: ${tz}.`;
}

/** Enrich calendar/scheduler tool descriptions with current date/time */
function enrichDescription(tool: ToolDefinition): string {
  if (tool.category === 'calendar' || tool.category === 'scheduler') {
    return tool.description + currentDateContext();
  }
  return tool.description;
}

/** OpenAI format (OpenRouter): Array of { type: "function", function: { name, description, parameters } } */
export function toOpenAITools() {
  return TOOL_DEFINITIONS.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: enrichDescription(tool),
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            { type: param.type, description: param.description }
          ])
        ),
        required: tool.required,
      },
    },
  }));
}

// ============================================================================
// Unified Tool Execution
// ============================================================================

/**
 * Execute any registered tool by name.
 * Returns the response to send back to the LLM plus a tracking call for the UI.
 * Each tool call is wrapped with a 30-second timeout to prevent hanging.
 */
export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<ToolExecutionResult> {
  try {
    return await withTimeout(executeToolInner(name, args), TOOL_TIMEOUT_MS, name);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Tool execution error (${name}):`, errorMsg);
    // Determine category from tool name for error response
    const def = TOOL_DEFINITIONS.find(t => t.name === name);
    const category = def?.category || 'code';
    return {
      response: { error: `Tool error: ${errorMsg}` },
      category,
    };
  }
}

/**
 * Inner tool execution logic (no timeout wrapper).
 */
async function executeToolInner(
  name: string,
  args: Record<string, any>
): Promise<ToolExecutionResult> {

  // --- Code Analysis ---
  if (name === 'analyze_code') {
    const question = args.question || '';
    const analysisResult = await codeAnalysisService.analyzeCode(question);
    return {
      response: { answer: analysisResult.answer },
      call: analysisResult,
      category: 'code',
    };
  }

  // --- Obsidian: Read ---
  if (name === 'read_obsidian_note') {
    const filename = args.filename || '';
    try {
      const note = await localObsidianService.readNote(filename);
      const content = `--- ${filename} ---\nTitle: ${note.frontmatter.title}\nCreated: ${note.frontmatter.created}\nModified: ${note.frontmatter.modified}${note.frontmatter.tags ? `\nTags: ${note.frontmatter.tags.join(', ')}` : ''}\n\n${note.content}`;
      return {
        response: { content },
        call: { task: `Read note: ${filename}`, result: content, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        response: { error: `Error reading note "${filename}": ${errorMsg}. The note may not exist or the path may be incorrect.` },
        category: 'obsidian',
      };
    }
  }

  // --- Obsidian: Search ---
  if (name === 'search_obsidian_vault') {
    const query = args.query || '';
    try {
      const results = await localObsidianService.search(query);
      let content: string;
      if (results.length === 0) {
        content = `No notes found matching "${query}".`;
      } else {
        const MAX_RESULTS = 10;
        const MAX_CONTEXT_CHARS = 500;
        const shown = results.slice(0, MAX_RESULTS);
        content = `Found ${results.length} note(s) matching "${query}"`;
        if (results.length > MAX_RESULTS) {
          content += ` (showing top ${MAX_RESULTS})`;
        }
        content += ':\n\n';
        for (const r of shown) {
          const ctx = r.context.length > MAX_CONTEXT_CHARS
            ? r.context.slice(0, MAX_CONTEXT_CHARS) + '\n... [truncated — use read_obsidian_note for full content]'
            : r.context;
          content += `--- ${r.file} ---\n${ctx}\n\n`;
        }
      }
      return {
        response: { results: content },
        call: { task: `Search vault: ${query}`, result: content, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error searching vault: ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Obsidian: List ---
  if (name === 'list_obsidian_notes') {
    const pattern = args.pattern || undefined;
    try {
      const notes = await localObsidianService.listNotes(pattern);
      let content: string;
      if (notes.length === 0) {
        content = pattern ? `No notes found matching "${pattern}".` : 'No notes found in the vault.';
      } else {
        content = pattern
          ? `Found ${notes.length} note(s) matching "${pattern}":\n`
          : `Found ${notes.length} note(s) in the vault:\n`;
        content += notes.map(n => `- ${n}`).join('\n');
      }
      return {
        response: { notes: content },
        call: { task: `List notes${pattern ? `: ${pattern}` : ''}`, result: content, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error listing notes: ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Obsidian: Create ---
  if (name === 'create_obsidian_note') {
    const title = args.title || '';
    const content = args.content || '';
    if (isProtectedAgentContextPath(title)) {
      return {
        response: { error: 'Protected agent-context files require Amer approval and cannot be changed through generic Obsidian tools. Submit a pending proposal instead.' },
        category: 'obsidian',
      };
    }
    try {
      const instance = await localObsidianService.getInstance();
      const filename = await instance.createNote(title, content);
      const result = `Note created: ${filename}`;
      return {
        response: { result },
        call: { task: `Create note: ${title}`, result, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error creating note: ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Obsidian: Update ---
  if (name === 'update_obsidian_note') {
    const filename = args.filename || '';
    const content = args.content || '';
    if (isProtectedAgentContextPath(filename)) {
      return {
        response: { error: 'Protected agent-context files require Amer approval and cannot be changed through generic Obsidian tools. Submit a pending proposal instead.' },
        category: 'obsidian',
      };
    }
    try {
      const instance = await localObsidianService.getInstance();
      await instance.updateNote(filename, content);
      const result = `Note updated: ${filename}`;
      return {
        response: { result },
        call: { task: `Update note: ${filename}`, result, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error updating note "${filename}": ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Obsidian: Append ---
  if (name === 'append_obsidian_note') {
    const filename = args.filename || '';
    const content = args.content || '';
    if (isProtectedAgentContextPath(filename)) {
      return {
        response: { error: 'Protected agent-context files require Amer approval and cannot be changed through generic Obsidian tools. Submit a pending proposal instead.' },
        category: 'obsidian',
      };
    }
    try {
      await localObsidianService.appendNote(filename, content);
      const result = `Content appended to: ${filename}`;
      return {
        response: { result },
        call: { task: `Append to note: ${filename}`, result, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error appending to note "${filename}": ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Obsidian: Delete ---
  if (name === 'delete_obsidian_note') {
    const filename = args.filename || '';
    if (isProtectedAgentContextPath(filename)) {
      return {
        response: { error: 'Protected agent-context files require Amer approval and cannot be deleted through generic Obsidian tools.' },
        category: 'obsidian',
      };
    }
    try {
      const instance = await localObsidianService.getInstance();
      await instance.deleteNote(filename);
      const result = `Note deleted: ${filename}`;
      return {
        response: { result },
        call: { task: `Delete note: ${filename}`, result, timestamp: new Date().toISOString() },
        category: 'obsidian',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error deleting note "${filename}": ${errorMsg}` }, category: 'obsidian' };
    }
  }

  // --- Calendar: List Events ---
  if (name === 'list_calendar_events') {
    const calendarId = args.calendarId || DEFAULT_CALENDAR_ID;
    const timeMin = args.timeMin;
    const timeMax = args.timeMax;
    const maxResults = args.maxResults || 10;
    const searchQuery = args.searchQuery;
    try {
      const events = await googleCalendarService.listEvents(calendarId, { timeMin, timeMax, maxResults, q: searchQuery });
      let result = '';
      if (events.length === 0) {
        result = 'No events found.';
      } else {
        result = `Found ${events.length} event(s):\n\n`;
        for (const event of events) {
          const start = event.start?.dateTime || event.start?.date || 'No start time';
          const end = event.end?.dateTime || event.end?.date || 'No end time';
          result += `- ${event.summary || 'Untitled'}\n`;
          result += `  ID: ${event.id}\n`;
          result += `  Start: ${start}\n`;
          result += `  End: ${end}\n`;
          if (event.location) result += `  Location: ${event.location}\n`;
          if (event.description) result += `  Description: ${event.description}\n`;
          result += '\n';
        }
      }
      return {
        response: { events: result },
        call: { action: 'List calendar events', result, timestamp: new Date().toISOString() },
        category: 'calendar',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error listing calendar events: ${errorMsg}` }, category: 'calendar' };
    }
  }

  // --- Calendar: Get Event ---
  if (name === 'get_calendar_event') {
    const eventId = args.eventId || '';
    const calendarId = args.calendarId || DEFAULT_CALENDAR_ID;
    try {
      const event = await googleCalendarService.getEvent(eventId, calendarId);
      const start = event.start?.dateTime || event.start?.date || 'No start time';
      const end = event.end?.dateTime || event.end?.date || 'No end time';
      let result = `Event: ${event.summary || 'Untitled'}\n`;
      result += `ID: ${event.id}\n`;
      result += `Start: ${start}\nEnd: ${end}\n`;
      if (event.location) result += `Location: ${event.location}\n`;
      if (event.description) result += `Description: ${event.description}\n`;
      if (event.attendees) {
        result += `Attendees: ${event.attendees.map((a: any) => a.email).join(', ')}\n`;
      }
      return {
        response: { event: result },
        call: { action: `Get event: ${eventId}`, result, timestamp: new Date().toISOString() },
        category: 'calendar',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error getting calendar event: ${errorMsg}` }, category: 'calendar' };
    }
  }

  // --- Calendar: Create Event ---
  if (name === 'create_calendar_event') {
    const summary = args.summary || '';
    const description = args.description;
    const location = args.location;
    const startDateTime = args.startDateTime || '';
    const endDateTime = args.endDateTime || '';
    const timeZone = args.timeZone;
    const attendeesStr = args.attendees;
    const calendarId = args.calendarId || DEFAULT_CALENDAR_ID;
    try {
      const attendees = attendeesStr
        ? attendeesStr.split(',').map((email: string) => ({ email: email.trim() }))
        : undefined;
      const event = await googleCalendarService.createEvent({
        summary, description, location,
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone },
        attendees,
      }, calendarId);
      const result = `Event created: ${event.summary}\nID: ${event.id}\nStart: ${event.start?.dateTime}\nEnd: ${event.end?.dateTime}`;
      return {
        response: { result },
        call: { action: `Create event: ${summary}`, result, timestamp: new Date().toISOString() },
        category: 'calendar',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error creating calendar event: ${errorMsg}` }, category: 'calendar' };
    }
  }

  // --- Calendar: Update Event ---
  if (name === 'update_calendar_event') {
    const eventId = args.eventId || '';
    const summary = args.summary;
    const description = args.description;
    const location = args.location;
    const startDateTime = args.startDateTime;
    const endDateTime = args.endDateTime;
    const timeZone = args.timeZone;
    const calendarId = args.calendarId || DEFAULT_CALENDAR_ID;
    try {
      const updateData: any = {};
      if (summary) updateData.summary = summary;
      if (description) updateData.description = description;
      if (location) updateData.location = location;
      if (startDateTime) updateData.start = { dateTime: startDateTime, timeZone };
      if (endDateTime) updateData.end = { dateTime: endDateTime, timeZone };
      const event = await googleCalendarService.updateEvent(eventId, updateData, calendarId);
      const result = `Event updated: ${event.summary}\nID: ${event.id}`;
      return {
        response: { result },
        call: { action: `Update event: ${eventId}`, result, timestamp: new Date().toISOString() },
        category: 'calendar',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error updating calendar event: ${errorMsg}` }, category: 'calendar' };
    }
  }

  // --- Calendar: Delete Event ---
  if (name === 'delete_calendar_event') {
    const eventId = args.eventId || '';
    const calendarId = args.calendarId || DEFAULT_CALENDAR_ID;
    try {
      await googleCalendarService.deleteEvent(eventId, calendarId);
      const result = `Event deleted: ${eventId}`;
      return {
        response: { result },
        call: { action: `Delete event: ${eventId}`, result, timestamp: new Date().toISOString() },
        category: 'calendar',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error deleting calendar event: ${errorMsg}` }, category: 'calendar' };
    }
  }

  // --- Scheduler: Schedule Message ---
  if (name === 'schedule_discord_message') {
    const message = args.message || '';
    const scheduledTimeInput = args.scheduledTime || '';
    const recurrenceType = args.recurrenceType;
    const recurrenceDays = args.recurrenceDays;
    const context = getToolContext();
    const userId = args.userId || context.discordUserId || '';
    const channelId = args.channelId || context.discordChannelId || '';

    if (!userId || !channelId) {
      return {
        response: { error: 'Discord context not available. This tool can only be used from Discord.' },
        category: 'scheduler',
      };
    }

    try {
      // Parse natural language time with chrono-node
      // Create a reference date in Chicago timezone so chrono interprets relative times correctly
      const chrono = await import('chrono-node');
      
      // Get current time as a Chicago-local string, then parse it as the reference
      const chicagoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const parsedDate = chrono.parseDate(scheduledTimeInput, chicagoNow);
      if (!parsedDate) {
        return { response: { error: `Could not parse time: "${scheduledTimeInput}". Try something like "tomorrow 10am" or "in 2 hours".` }, category: 'scheduler' };
      }

      // parsedDate is now in "fake local" Chicago time — convert to real UTC
      // chicagoNow was constructed by interpreting Chicago wall-clock as local, so the offset
      // between chicagoNow and real now tells us the shift we need to reverse.
      const realNow = new Date();
      const chicagoOffsetMs = chicagoNow.getTime() - realNow.getTime();
      const correctedDate = new Date(parsedDate.getTime() - chicagoOffsetMs);

      // Safety: don't schedule in the past (more than 2 min ago)
      if (correctedDate.getTime() < Date.now() - 120_000) {
        return { response: { error: `The parsed time (${correctedDate.toLocaleString('en-US', { timeZone: 'America/Chicago' })}) is in the past. Try a future time.` }, category: 'scheduler' };
      }

      let recurrence: import('./discord-scheduler').RecurrencePattern | undefined;
      if (recurrenceType && ['daily', 'weekdays', 'weekly', 'custom'].includes(recurrenceType)) {
        recurrence = { type: recurrenceType as any };
        if (recurrenceType === 'weekly' && recurrenceDays) {
          recurrence.daysOfWeek = recurrenceDays.split(',').map((d: string) => parseInt(d.trim(), 10)).filter((n: number) => !isNaN(n));
        }
      }

      const scheduler = getScheduler();
      const scheduled = scheduler.scheduleMessage(userId, channelId, message, correctedDate, recurrence);
      const label = recurrence ? ` (recurring: ${recurrence.type})` : '';
      const humanTime = correctedDate.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' });
      const result = `Message scheduled for ${humanTime}${label}. ID: ${scheduled.id}`;
      return {
        response: { result },
        call: { action: `Schedule message for ${scheduledTimeInput}${label}`, result, timestamp: new Date().toISOString() },
        category: 'scheduler',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error scheduling message: ${errorMsg}` }, category: 'scheduler' };
    }
  }

  // --- Scheduler: List Messages ---
  if (name === 'list_scheduled_messages') {
    // Get userId from context if not provided
    const context = getToolContext();
    const userId = args.userId || context.discordUserId || '';
    
    if (!userId) {
      return {
        response: { error: 'Discord context not available. This tool can only be used from Discord.' },
        category: 'scheduler',
      };
    }
    
    try {
      const scheduler = getScheduler();
      const messages = scheduler.listScheduledMessages(userId);
      let result = '';
      if (messages.length === 0) {
        result = 'No scheduled messages.';
      } else {
        result = `You have ${messages.length} scheduled message(s):\n\n`;
        for (const msg of messages) {
          result += `- ID: ${msg.id}\n`;
          result += `  Message: ${msg.message}\n`;
          result += `  Scheduled: ${new Date(msg.scheduledTime).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' })}\n\n`;
        }
      }
      return {
        response: { result },
        call: { action: 'List scheduled messages', result, timestamp: new Date().toISOString() },
        category: 'scheduler',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error listing scheduled messages: ${errorMsg}` }, category: 'scheduler' };
    }
  }

  // --- Scheduler: Cancel Message ---
  if (name === 'cancel_scheduled_message') {
    const messageId = args.messageId || '';
    try {
      const scheduler = getScheduler();
      const cancelled = scheduler.cancelMessage(messageId);
      const result = cancelled
        ? `Scheduled message ${messageId} cancelled.`
        : `Message ${messageId} not found.`;
      return {
        response: { result },
        call: { action: `Cancel message: ${messageId}`, result, timestamp: new Date().toISOString() },
        category: 'scheduler',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Error cancelling message: ${errorMsg}` }, category: 'scheduler' };
    }
  }

  // --- Shell Execution ---
  if (name === 'execute_shell') {
    const command = args.command || '';

    // --- Security: restrict allowed working directories ---
    const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT_PATH || '';
    const CHAT_VAULT = process.env.CHAT_VAULT_PATH || '';
    const allowedRoots = [path.resolve(PROJECT_ROOT)];
    if (OBSIDIAN_VAULT) allowedRoots.push(path.resolve(OBSIDIAN_VAULT));
    if (CHAT_VAULT) allowedRoots.push(path.resolve(CHAT_VAULT));

    const resolvedCwd = args.cwd ? path.resolve(PROJECT_ROOT, args.cwd) : PROJECT_ROOT;
    const cwdAllowed = allowedRoots.some(root => isPathInside(root, resolvedCwd));
    const cwd = cwdAllowed ? resolvedCwd : PROJECT_ROOT;

    // --- Security: block commands that reference local secret files ---
    // Note: this is a best-effort guard, not a sandbox. The shell can still run
    // arbitrary code; secret-bearing env vars are stripped below as the real defense.
    const SECRET_NAME = /(?:\.env(?![.]example)|gmail-token\.json|client_secret|-key\.json|ngrok\.yml|\.pem\b|\.key\b)/i;
    if (SECRET_NAME.test(command)) {
      return { response: { error: 'Blocked: command references a local secret file (.env, tokens, credentials)' }, category: 'shell' };
    }

    try {
      const { execSync } = require('child_process');
      // Strip secrets from the shell environment
      const safeEnv = { ...process.env };
      const sensitiveKeys = Object.keys(safeEnv).filter(k =>
        /KEY|SECRET|TOKEN|PASSWORD|ENCRYPTION|DATABASE_URL|PLAID/i.test(k)
      );
      for (const k of sensitiveKeys) delete safeEnv[k];

      const output = execSync(command, {
        cwd,
        timeout: TOOL_TIMEOUT_MS,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        shell: true,
        env: safeEnv,
      });
      const result = output.trim() || '(no output)';
      return {
        response: { result },
        call: { task: `Shell: ${command}`, result: result.substring(0, 500), timestamp: new Date().toISOString() },
        category: 'shell',
      };
    } catch (error: unknown) {
      const execError = error as { stderr?: Buffer | string; stdout?: Buffer | string; status?: number };
      const stderr = execError.stderr?.toString() || '';
      const stdout = execError.stdout?.toString() || '';
      const status = execError.status || 1;
      const result = `exit code ${status}\nstdout: ${stdout}\nstderr: ${stderr}`.trim();
      return {
        response: { error: result },
        category: 'shell',
      };
    }
  }

  // --- Git Operations ---
  if (name === 'git_operation') {
    const operation = args.operation || '';
    const gitArgs = args.args || '';
    const { execFileSync } = require('child_process');
    // Use execFileSync with array args to prevent command injection
    const git = (cmd: string, cmdArgs: string[]) =>
      execFileSync(cmd, cmdArgs, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: TOOL_TIMEOUT_MS }).trim();

    try {
      let result = '';
      switch (operation) {
        case 'status': result = git('git', ['status', '--short']); break;
        case 'diff': result = git('git', ['diff', ...(gitArgs ? gitArgs.split(' ') : [])]).substring(0, 4000) || '(no changes)'; break;
        case 'log': result = git('git', ['log', ...(gitArgs ? gitArgs.split(' ') : ['--oneline', '-10'])]); break;
        case 'branch': result = git('git', ['branch', ...(gitArgs ? gitArgs.split(' ') : [])]); break;
        case 'checkout': result = git('git', ['checkout', gitArgs]); break;
        case 'add': result = git('git', ['add', ...(gitArgs ? gitArgs.split(' ') : ['.'])]); result = result || 'staged'; break;
        case 'commit': result = git('git', ['commit', '-m', gitArgs]); break;
        case 'push': result = git('git', ['push', ...(gitArgs ? gitArgs.split(' ') : ['origin', 'HEAD'])]); break;
        case 'create-pr': {
          const [title, body] = (gitArgs || 'PR|||').split('|||');
          result = git('gh', ['pr', 'create', '--title', title, '--body', body || '']);
          break;
        }
        default: result = `Unknown git operation: ${operation}`;
      }
      return {
        response: { result: result || '(done)' },
        call: { action: `git ${operation} ${gitArgs}`.trim(), result: result.substring(0, 500), timestamp: new Date().toISOString() },
        category: 'git',
      };
    } catch (error: unknown) {
      const execError = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
      const msg = execError.stderr?.toString() || execError.stdout?.toString() || execError.message || 'git error';
      return { response: { error: msg.substring(0, 1000) }, category: 'git' };
    }
  }

  // --- Self-Edit: Read Project File ---
  if (name === 'read_project_file') {
    const filepath = args.filepath || '';
    const fullPath = path.resolve(PROJECT_ROOT, filepath);
    // Prevent directory traversal outside project root
    if (!isPathInside(path.resolve(PROJECT_ROOT), fullPath)) {
      return { response: { error: `Path escapes project root: ${filepath}` }, category: 'self-edit' };
    }
    // Block reading local secret files
    if (isSecretFile(fullPath)) {
      return { response: { error: 'Cannot read secret files (.env, tokens, credentials)' }, category: 'self-edit' };
    }
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const startLine = args.startLine ? Number(args.startLine) - 1 : 0;
      const endLine = args.endLine ? Number(args.endLine) : undefined;
      const lines = content.split('\n');
      const slice = lines.slice(startLine, endLine).join('\n');
      return {
        response: { content: slice },
        call: { task: `Read: ${filepath}`, result: `${lines.length} lines`, timestamp: new Date().toISOString() },
        category: 'self-edit',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Cannot read ${filepath}: ${msg}` }, category: 'self-edit' };
    }
  }

  // --- Self-Edit: Write Project File ---
  if (name === 'write_project_file') {
    const filepath = args.filepath || '';
    const content = args.content || '';
    const fullPath = path.resolve(PROJECT_ROOT, filepath);
    // Prevent directory traversal outside project root
    if (!isPathInside(path.resolve(PROJECT_ROOT), fullPath)) {
      return { response: { error: `Path escapes project root: ${filepath}` }, category: 'self-edit' };
    }
    // Block writing local secret files
    if (isSecretFile(fullPath)) {
      return { response: { error: 'Cannot write secret files (.env, tokens, credentials)' }, category: 'self-edit' };
    }
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const tmpPath = fullPath + '.tmp';
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, fullPath);
      const lineCount = content.split('\n').length;
      return {
        response: { result: `Wrote ${filepath} (${lineCount} lines)` },
        call: { task: `Write: ${filepath}`, result: `${lineCount} lines written`, timestamp: new Date().toISOString() },
        category: 'self-edit',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Cannot write ${filepath}: ${msg}` }, category: 'self-edit' };
    }
  }

  // --- Self-Edit: List Project Files ---
  if (name === 'list_project_files') {
    const dirpath = args.dirpath || '.';
    const pattern = args.pattern || '';
    const fullPath = path.resolve(PROJECT_ROOT, dirpath);
    // Prevent directory traversal outside project root
    if (!isPathInside(path.resolve(PROJECT_ROOT), fullPath)) {
      return { response: { error: `Path escapes project root: ${dirpath}` }, category: 'self-edit' };
    }
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (entry.name === 'node_modules') continue;
        if (pattern) {
          try {
            const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*'));
            if (!entry.name.match(re)) continue;
          } catch {
            // Invalid pattern — skip filtering
          }
        }
        const stat = await fs.stat(path.join(fullPath, entry.name));
        const size = entry.isDirectory() ? 'dir' : `${stat.size}B`;
        results.push(`${entry.name} (${size})`);
      }
      return {
        response: { result: results.join('\n') || '(empty directory)' },
        category: 'self-edit',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Cannot list ${dirpath}: ${msg}` }, category: 'self-edit' };
    }
  }

  // --- Read Amer's past chat transcripts ---
  if (name === 'read_chat_history') {
    const CHAT_VAULT = process.env.CHAT_VAULT_PATH || '';
    if (!CHAT_VAULT) {
      return { response: { error: 'CHAT_VAULT_PATH is not configured.' }, category: 'search' };
    }
    const dir = path.join(CHAT_VAULT, 'chat-sessions');
    const query = (args.query || '').toString().trim();
    const wantId = (args.sessionId || '').toString().trim();
    const source = (args.source || 'all').toString().toLowerCase();
    const now = () => new Date().toISOString();

    const labelOf = (id: string) =>
      id.startsWith('claude-') ? 'Claude' : id.startsWith('discord-') ? 'Discord' : id === 'main' ? 'Main' : 'Web';
    const inSource = (id: string) =>
      source === 'all' ? true
      : source === 'claude' ? id.startsWith('claude-')
      : source === 'discord' ? id.startsWith('discord-')
      : source === 'web' ? (id === 'main' || id.startsWith('session-'))
      : true;

    try {
      const readOne = async (file: string): Promise<{ title?: string; messages?: Array<{ role: string; content: string }>; lastActivity?: string } | null> => {
        try { return JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8')); } catch { return null; }
      };

      // Read one full transcript.
      if (wantId) {
        const file = wantId.endsWith('.json') ? wantId : `${wantId}.json`;
        if (!isPathInside(dir, path.join(dir, file))) {
          return { response: { error: 'Invalid session id.' }, category: 'search' };
        }
        const s = await readOne(file);
        if (!s) return { response: { error: `No transcript found for "${wantId}".` }, category: 'search' };
        const body = (s.messages ?? []).map((m) => `${m.role}: ${m.content}`).join('\n\n');
        const result = `# ${s.title || wantId} (${labelOf(wantId)})\n\n${body}`.slice(0, 14000);
        return {
          response: { result },
          call: { query: `read ${wantId}`, result: `${(s.messages ?? []).length} messages`, timestamp: now() },
          category: 'search',
        };
      }

      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));

      // Search across transcripts.
      if (query) {
        const q = query.toLowerCase();
        const hits: string[] = [];
        for (const file of files) {
          const id = file.replace(/\.json$/, '');
          if (!inSource(id)) continue;
          const s = await readOne(file);
          if (!s) continue;
          const titleHit = (s.title ?? '').toLowerCase().includes(q);
          const matched = (s.messages ?? []).filter((m) => (m.content ?? '').toLowerCase().includes(q));
          if (titleHit || matched.length) {
            const shown = (matched.length ? matched : (s.messages ?? []).slice(0, 2)).slice(0, 4)
              .map((m) => `  ${m.role}: ${(m.content ?? '').replace(/\s+/g, ' ').slice(0, 280)}`)
              .join('\n');
            hits.push(`[${labelOf(id)}] ${s.title || id}  (id: ${id}, ${(s.messages ?? []).length} msgs, ${matched.length} match${matched.length === 1 ? '' : 'es'})\n${shown}`);
          }
        }
        if (!hits.length) {
          return { response: { result: `No past chats mention "${query}".` }, category: 'search' };
        }
        const result = `Found ${hits.length} conversation(s) matching "${query}". Read one in full with read_chat_history({ sessionId }).\n\n${hits.slice(0, 20).join('\n\n')}`.slice(0, 14000);
        return {
          response: { result },
          call: { query: `search chats: ${query}`, result: `${hits.length} matches`, timestamp: now() },
          category: 'search',
        };
      }

      // No query/id → list all conversations.
      const list: Array<{ label: string; id: string; title: string; n: number; t: string }> = [];
      for (const file of files) {
        const id = file.replace(/\.json$/, '');
        if (!inSource(id)) continue;
        const s = await readOne(file);
        if (!s) continue;
        list.push({ label: labelOf(id), id, title: s.title || '(untitled)', n: (s.messages ?? []).length, t: s.lastActivity || '' });
      }
      list.sort((a, b) => (b.t || '').localeCompare(a.t || ''));
      const out = list.slice(0, 50).map((x) => `[${x.label}] ${x.title} — ${x.n} msgs (id: ${x.id})`).join('\n');
      return {
        response: { result: `${list.length} saved conversations:\n${out}` },
        call: { query: 'list chats', result: `${list.length} conversations`, timestamp: now() },
        category: 'search',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Cannot read chat history: ${msg}` }, category: 'search' };
    }
  }

  // --- Web Search (Tavily) ---
  if (name === 'web_search') {
    const query = args.query || '';
    const searchDepth = (args.search_depth === 'basic' ? 'basic' : 'advanced') as 'basic' | 'advanced';
    const topic = (args.topic === 'news' ? 'news' : 'general') as 'general' | 'news';
    const maxResults = args.max_results ? Math.min(Math.max(parseInt(args.max_results, 10) || 5, 1), 20) : 5;
    const timeRange = ['day', 'week', 'month', 'year'].includes(args.time_range) ? args.time_range as 'day' | 'week' | 'month' | 'year' : undefined;
    const includeDomains = args.include_domains ? args.include_domains.split(',').map((d: string) => d.trim()).filter(Boolean) : [];
    const excludeDomains = args.exclude_domains ? args.exclude_domains.split(',').map((d: string) => d.trim()).filter(Boolean) : [];

    try {
      const searchResponse = await tavilySearch(query, {
        searchDepth,
        topic,
        maxResults,
        includeAnswer: true,
        timeRange,
        includeDomains,
        excludeDomains,
      });
      const formatted = formatSearchResults(searchResponse);
      return {
        response: { results: formatted },
        call: { query, result: formatted.substring(0, 500), timestamp: new Date().toISOString() },
        category: 'search',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Web search failed: ${errorMsg}` }, category: 'search' };
    }
  }

  // --- Gmail: Send Email ---
  if (name === 'send_email') {
    const to = args.to || '';
    const subject = args.subject || '';
    const body = args.body || '';
    const cc = args.cc;
    const bcc = args.bcc;
    try {
      const result = await gmailService.sendEmail({ to, subject, body, cc, bcc });
      if (result.success) {
        const msg = `Email sent to ${to} (subject: "${subject}"). Message ID: ${result.messageId}`;
        return {
          response: { result: msg },
          call: { action: `Send email to ${to}`, result: msg, timestamp: new Date().toISOString() },
          category: 'gmail',
        };
      } else {
        return {
          response: { error: result.error || 'Failed to send email' },
          category: 'gmail',
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return { response: { error: `Gmail error: ${errorMsg}` }, category: 'gmail' };
    }
  }

  // --- Writing Pipeline ---
  if (name === 'list_drafts') {
    const { listDrafts } = await import('./writing-pipeline');
    const result = await listDrafts();
    return { response: { result }, category: 'writing' as any };
  }

  if (name === 'add_draft') {
    const { addDraft } = await import('./writing-pipeline');
    const result = await addDraft(args.title, args.vaultPath, args.status, args.editorialNotes, args.nextAction);
    return { response: { result }, category: 'writing' as any };
  }

  if (name === 'update_draft') {
    const { updateDraft } = await import('./writing-pipeline');
    const updates: any = {};
    if (args.status) updates.status = args.status;
    if (args.editorialNotes) updates.editorialNotes = args.editorialNotes;
    if (args.nextAction) updates.nextAction = args.nextAction;
    if (args.wordCount) updates.wordCount = args.wordCount;
    const result = await updateDraft(args.title, updates);
    return { response: { result }, category: 'writing' as any };
  }

  // Unknown tool
  throw new Error(`Unknown tool: ${name}`);
}
