'use client';

import React, { useCallback } from 'react';
import { useState, useRef, useEffect } from 'react';
import { Message, ChatRequest, ChatResponseWithTools, CodeAnalysisCall, ObsidianNoteCall, GoogleCalendarCall } from '@/lib/types';
import AppShell from '@/components/app-shell';
import ErrorDisplay from '@/components/error-display';
import { MarkdownMessage } from '@/components/markdown-message';
import { ToolCallGroup } from '@/components/tool-call-chip';
import ChatInput from '@/components/chat-input';
import { useServerHealth } from '@/lib/hooks/useServerHealth';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

// xterm.js needs the browser; load the terminal panel on the client only.
const TerminalPanel = dynamic(() => import('@/components/terminal/TerminalPanel'), { ssr: false });

// Single fixed chat session — multi-session management was removed.
const SINGLE_SESSION_ID = 'main';

// ── Tool activity feed ───────────────────────────────────────────────────────
// One normalized shape for every tool category so the tools pane can show a
// steady chronological flow of what the assistant actually did.
interface ToolActivityEntry {
  id: string;
  category: string;
  label: string;
  title: string;
  detail: string;
  timestamp: string;
}

// category → display label + tailwind color classes for the badge.
const TOOL_META: Record<string, { label: string; badge: string }> = {
  shell: { label: 'Shell', badge: 'bg-slate-700 text-slate-200' },
  git: { label: 'Git', badge: 'bg-orange-900 text-orange-200' },
  'self-edit': { label: 'File', badge: 'bg-cyan-900 text-cyan-200' },
  search: { label: 'Search', badge: 'bg-emerald-900 text-emerald-200' },
  code: { label: 'Code', badge: 'bg-blue-900 text-blue-200' },
  obsidian: { label: 'Obsidian', badge: 'bg-purple-900 text-purple-200' },
  calendar: { label: 'Calendar', badge: 'bg-teal-900 text-teal-200' },
  scheduler: { label: 'Scheduler', badge: 'bg-indigo-900 text-indigo-200' },
  gmail: { label: 'Gmail', badge: 'bg-red-900 text-red-200' },
};

// Available tools, grouped — shown as a reference so you can see what it CAN do.
const AVAILABLE_TOOLS: Array<{ group: string; items: string[] }> = [
  { group: 'Shell & code', items: ['execute_shell', 'git_operation', 'read/write/list project files', 'analyze_code'] },
  { group: 'Memory & chats', items: ['read_chat_history', 'AI memory (read/update)'] },
  { group: 'Obsidian vault', items: ['read/create/update/append/search/delete notes'] },
  { group: 'Google', items: ['calendar (list/create/update/delete)', 'send_email'] },
  { group: 'Web & Discord', items: ['web_search (Tavily)', 'schedule/cancel Discord messages'] },
];

/** Flatten a chat response's per-category call arrays into one normalized feed. */
function collectToolActivity(resp: Partial<ChatResponseWithTools>): ToolActivityEntry[] {
  const out: ToolActivityEntry[] = [];
  const push = (category: string, calls: Array<Record<string, unknown>> | undefined) => {
    for (const c of calls ?? []) {
      const title = String(c.task ?? c.action ?? c.query ?? c.question ?? '(call)');
      const detail = String(c.result ?? c.answer ?? '');
      const timestamp = String(c.timestamp ?? new Date().toISOString());
      out.push({ id: `${category}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`, category, label: TOOL_META[category]?.label ?? category, title, detail, timestamp });
    }
  };
  push('code', resp.codeAnalysisCalls as never);
  push('obsidian', resp.obsidianNoteCalls as never);
  push('calendar', resp.googleCalendarCalls as never);
  push('scheduler', resp.schedulerCalls as never);
  push('shell', resp.shellCalls as never);
  push('git', resp.gitCalls as never);
  push('self-edit', resp.selfEditCalls as never);
  push('search', resp.searchCalls as never);
  push('gmail', resp.gmailCalls as never);
  return out;
}

type ChatModel = 'gemini' | 'gemini-pro' | 'claude' | 'kimi' | 'kimi-thinking' | 'glm' | 'kiro';
const CHAT_MODELS: ChatModel[] = ['gemini', 'gemini-pro', 'claude', 'kimi', 'kimi-thinking', 'glm', 'kiro'];
const MODEL_STORAGE_KEY = 'chat-model';

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Memoized message row — only re-renders when its own props change
const ChatMessageItem = React.memo(function ChatMessageItem({
  message,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  index: _index,
  codeAnalysisCalls,
  obsidianNoteCalls,
  googleCalendarCalls,
}: {
  message: Message;
  index: number;
  codeAnalysisCalls?: CodeAnalysisCall[];
  obsidianNoteCalls?: ObsidianNoteCall[];
  googleCalendarCalls?: GoogleCalendarCall[];
}) {
  return (
    <div>
      <div
        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className={`max-w-[85%] md:max-w-[70%] rounded-lg p-4 ${
            message.role === 'user'
              ? 'bg-navy-red-600 text-white'
              : 'bg-navy-red-800 text-gray-100 border border-navy-red-700'
          }`}
        >
          <div className="break-words">
            {message.role === 'user' ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <MarkdownMessage content={message.content} />
            )}
          </div>
          {/* Inline tool call chips — inside the message bubble */}
          {message.role === 'assistant' && (
            <ToolCallGroup
              codeAnalysisCalls={codeAnalysisCalls}
              obsidianNoteCalls={obsidianNoteCalls}
              googleCalendarCalls={googleCalendarCalls}
            />
          )}
          <div className="flex items-center justify-between mt-2 gap-3">
            <div className={`text-xs ${
              message.role === 'user' ? 'text-navy-red-200' : 'text-gray-400'
            }`}>
              {formatTimestamp(message.timestamp)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverStatus = useServerHealth();
  const [codeAnalysisCalls, setCodeAnalysisCalls] = useState<Map<number, CodeAnalysisCall[]>>(new Map());
  const [obsidianNoteCalls, setObsidianNoteCalls] = useState<Map<number, ObsidianNoteCall[]>>(new Map());
  const [googleCalendarCalls, setGoogleCalendarCalls] = useState<Map<number, GoogleCalendarCall[]>>(new Map());
  // Persistent, chronological feed of EVERY tool the assistant used this session
  // (all categories — shell, search, self-edit, git, gmail, code, obsidian, etc.).
  const [toolActivity, setToolActivity] = useState<ToolActivityEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isMobileToolPanelOpen, setIsMobileToolPanelOpen] = useState(false);
  // Restored from localStorage so your model choice sticks until you change it.
  const [selectedModel, setSelectedModel] = useState<ChatModel>(() => {
    if (typeof window === 'undefined') return 'glm';
    const saved = window.localStorage.getItem(MODEL_STORAGE_KEY) as ChatModel | null;
    return saved && CHAT_MODELS.includes(saved) ? saved : 'glm';
  });
  useEffect(() => {
    try { window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel); } catch { /* ignore */ }
  }, [selectedModel]);
  const [contextTab, setContextTab] = useState<'tools' | 'prompt' | 'memory' | 'history' | 'terminal'>('tools');
  // The terminal mounts the first time its tab opens and then stays alive,
  // so a running session (e.g. Claude Code) survives switching tabs.
  const [terminalOpened, setTerminalOpened] = useState(false);
  useEffect(() => {
    if (contextTab === 'terminal') setTerminalOpened(true);
  }, [contextTab]);
  // History browser: all locally-stored transcripts (web + Discord), read-only.
  const [sessionList, setSessionList] = useState<Array<{ sessionId: string; title: string; lastActivity: string; messageCount: number }>>([]);
  const [historyMessages, setHistoryMessages] = useState<Message[] | null>(null);
  const [historyTitle, setHistoryTitle] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [contextData, setContextData] = useState<{
    systemPrompt?: string;
    systemPromptLength?: number;
    systemPromptTokenEstimate?: number;
    agentContext?: {
      totalChars: number;
      tokenEstimate: number;
      matchedProjects: string[];
      missing: string[];
      warnings: string[];
      sources: Array<{ path: string; kind: string; chars: number; truncated: boolean }>;
    };
  } | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mirror the latest messages/session into refs so the visibility listener
  // (registered once) can read current values without stale closures.
  const messagesRef = useRef<Message[]>(messages);
  const sessionIdRef = useRef<string | null>(currentSessionId);
  const isLoadingRef = useRef<boolean>(isLoading);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // ── Token estimation & context compaction ──────────────────────────────────
  // Rough estimate: 1 token ≈ 4 characters
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const estimateSessionTokens = (msgs: Message[]) =>
    msgs.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  // Context window sizes per model (input tokens)
  const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    'kimi': 256_000,
    'kimi-thinking': 256_000,
    'gemini': 1_000_000,
    'gemini-pro': 1_000_000,
    'claude': 200_000,
    'glm': 1_000_000,
    'kiro': 200_000,
  };

  // Compact at 75% of the model's context window
  const COMPACT_THRESHOLD_RATIO = 0.75;
  // Keep roughly 25% of context window worth of recent messages after compaction
  const KEEP_RATIO = 0.25;

  const getCompactThreshold = () => {
    const window = MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000;
    return Math.floor(window * COMPACT_THRESHOLD_RATIO);
  };

  const getKeepBudget = () => {
    const window = MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000;
    return Math.floor(window * KEEP_RATIO);
  };

  /** Count recent messages that fit within a token budget (newest first) */
  const countMessagesToKeep = (msgs: Message[], tokenBudget: number): number => {
    let tokensUsed = 0;
    let count = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(msgs[i].content) + 4;
      if (tokensUsed + msgTokens > tokenBudget) break;
      tokensUsed += msgTokens;
      count++;
    }
    return Math.max(count, 4); // Always keep at least 4 messages
  };

  /** Trigger compaction: summarize older messages, save to Obsidian, trim session */
  const compactSession = async (currentMessages: Message[]): Promise<{ summary: string; messages: Message[] } | null> => {
    if (isCompacting || !currentSessionId) return null;
    setIsCompacting(true);

    try {
      const keepCount = countMessagesToKeep(currentMessages, getKeepBudget());
      const sessionTitle = currentMessages.find(m => m.role === 'user')?.content.substring(0, 50)
        || 'Untitled';

      const response = await fetch('/api/chat/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSessionId,
          messages: currentMessages,
          keepCount,
          model: selectedModel,
          existingSummary: sessionSummary,
          sessionTitle,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        console.error('[compact] Failed:', err.error);
        return null;
      }

      const result = await response.json();
      if (result.compacted) {
        console.log(`[compact] ${result.summarizedCount} msgs → summary (${result.summary.length} chars), ${result.keptCount} msgs kept`);
        return { summary: result.summary, messages: result.messages };
      }
      return null;
    } catch (error) {
      console.error('[compact] Error:', error);
      return null;
    } finally {
      setIsCompacting(false);
    }
  };

  // Load current session from localStorage on mount
  useEffect(() => {
    // One fixed session — always load it.
    setCurrentSessionId(SINGLE_SESSION_ID);
    loadSession(SINGLE_SESSION_ID);

    // Check for context from reader (e.g. "Ask AI about this article")
    const params = new URLSearchParams(window.location.search);
    const readerContext = params.get('context');
    if (readerContext) {
      setInputMessage(readerContext);
      // Clean the URL so refreshing doesn't re-inject
      window.history.replaceState({}, '', '/chat');
    }
  }, []);

  // Save current session ID to localStorage
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('currentSessionId', currentSessionId);
    }
  }, [currentSessionId]);

  // Persist the conversation to the shared 'main' session so the Discord bot and
  // the web chat stay on ONE stream / context window. Debounced; the empty-guard
  // prevents the initial empty render from clobbering messages written elsewhere
  // (e.g. from Discord) before loadSession() has populated them.
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;
    // Don't autosave while a request is in flight: the /api/chat route is the
    // authority for the current turn and saves the full reply itself. Saving
    // our optimistic state here (which includes an empty "thinking" placeholder)
    // would clobber the server's saved reply if the tab was backgrounded.
    if (isLoading) return;
    // Never persist the empty placeholder assistant bubble.
    const toSave = messages.filter(m => !(m.role === 'assistant' && m.content === ''));
    if (toSave.length === 0) return;
    const t = setTimeout(() => {
      fetch(`/api/sessions/${currentSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toSave, title: 'main', summary: sessionSummary || undefined }),
      }).catch((err) => console.error('[session] autosave failed:', err));
    }, 600);
    return () => clearTimeout(t);
  }, [messages, currentSessionId, sessionSummary, isLoading]);

  // Live-sync the shared 'main' session: poll the backend so messages appended
  // elsewhere (the Discord bot, or another tab) show up here without a manual
  // refresh. We ADOPT the server's list only when it is strictly longer than
  // ours and no request is in flight — so a Discord reply appears here, while a
  // message we just sent locally is never overwritten by a stale server copy.
  useEffect(() => {
    if (!currentSessionId) return;
    let cancelled = false;
    const poll = async () => {
      if (isLoading) return; // don't fight an in-flight send
      try {
        const res = await fetch(`/api/sessions/${currentSessionId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const serverMsgs = Array.isArray(data.messages) ? data.messages : [];
        setMessages((local) => {
          // SAFETY: only ever ADOPT the server list when it is a strict EXTENSION
          // of what we already have — i.e. our messages are an exact prefix of the
          // server's and it has more on the end (an appended Discord/other-tab
          // turn). This can add messages but can NEVER replace, reorder, or drop
          // anything already in the local history. Any divergence → keep local.
          if (serverMsgs.length <= local.length) return local;
          const localIsPrefix = local.every(
            (m, i) => serverMsgs[i] && serverMsgs[i].role === m.role && serverMsgs[i].content === m.content,
          );
          return localIsPrefix ? serverMsgs : local;
        });
      } catch {
        /* transient — try again next tick */
      }
    };
    const iv = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [currentSessionId, isLoading]);

  // Close mobile overlays when viewport resizes to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileToolPanelOpen(false);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-scroll to bottom when new messages are added
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load context data for the context engineering panel
  const loadContextData = async () => {
    setIsLoadingContext(true);
    try {
      const res = await fetch('/api/chat-context');
      if (res.ok) setContextData(await res.json());
    } catch (err) {
      console.error('Failed to load context:', err);
    } finally {
      setIsLoadingContext(false);
    }
  };

  useEffect(() => {
    if (contextTab === 'prompt' || contextTab === 'memory') {
      if (!contextData) loadContextData();
    }
  }, [contextTab]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
        setCurrentSessionId(sessionId);
        setSessionSummary(data.summary || null);
      } else {
        console.error('Failed to load session');
      }
    } catch (err) {
      console.error('Error loading session:', err);
    }
  };

  // History browser — list every locally-stored transcript (web + Discord).
  const loadSessionList = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        // Most-recent first.
        list.sort((a: { lastActivity: string }, b: { lastActivity: string }) =>
          new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
        setSessionList(list);
      }
    } catch (err) {
      console.error('Failed to load session list:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Open one transcript read-only (does not touch the live chat / autosave).
  const openHistory = useCallback(async (sessionId: string, title: string) => {
    setLoadingHistory(true);
    setHistoryTitle(title);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setHistoryMessages(Array.isArray(data.messages) ? data.messages : []);
      } else {
        setHistoryMessages([]);
      }
    } catch {
      setHistoryMessages([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Load the session list whenever the History tab opens.
  useEffect(() => {
    if (contextTab === 'history') {
      setHistoryMessages(null);
      void loadSessionList();
    }
  }, [contextTab, loadSessionList]);

  /**
   * Pull the server-saved session and adopt it if the server knows about a turn
   * the client missed. The /api/chat route always finishes the LLM call and
   * saves the reply server-side, even if this browser's fetch was killed by the
   * tab being backgrounded on mobile. This recovers that reply instead of
   * showing a network error. Returns true if a newer assistant reply was found.
   */
  const reconcileSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { cache: 'no-store' });
      if (!res.ok) return false;
      const data = await res.json();
      const serverMessages: Message[] = data.messages || [];
      if (serverMessages.length === 0) return false;

      // Count local messages that actually count (ignore the empty placeholder).
      const localReal = messagesRef.current.filter(
        m => !(m.role === 'assistant' && m.content === '')
      ).length;

      const serverLast = serverMessages[serverMessages.length - 1];
      const serverHasNewReply =
        serverLast?.role === 'assistant' && serverLast.content.trim().length > 0;

      // Only adopt when the server genuinely has more than we do, so we never
      // clobber good local state (e.g. a live stream still finishing).
      if (serverMessages.length > localReal) {
        setMessages(serverMessages);
        setSessionSummary(data.summary || null);
        setError(null);
        // Message indices shifted, so the index-keyed tool-call chips no longer
        // line up. Clear them rather than mislabel; the reply text is what
        // matters for recovery.
        setCodeAnalysisCalls(new Map());
        setObsidianNoteCalls(new Map());
        setGoogleCalendarCalls(new Map());
        return serverHasNewReply;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // When the tab regains focus (returning from another app/screen), re-sync from
  // the server. On mobile the in-flight request is often suspended/killed while
  // backgrounded, so this is how the reply shows up when you come back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const sid = sessionIdRef.current;
      if (!sid) return;
      reconcileSession(sid).then(recovered => {
        if (recovered && isLoadingRef.current) setIsLoading(false);
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reconcileSession]);


  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    // Create new session if none exists
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      setCurrentSessionId(sessionId);
    }

    const userMessage: Message = {
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date().toISOString()
    };

    // Save the message text before clearing — we'll restore it on error
    const savedInput = inputMessage.trim();

    // Add user message to UI immediately (optimistic update)
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputMessage('');
    setIsLoading(true);
    setError(null);

    // Add a temporary "thinking" message
    const thinkingMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    };
    setMessages([...updatedMessages, thinkingMessage]);

    try {
      const request: ChatRequest = {
        message: userMessage.content,
        sessionId: sessionId,
        sessionMessages: messages,
        model: selectedModel,
        sessionSummary: sessionSummary || undefined,
      };

      const useStreaming = selectedModel === 'kimi' || selectedModel === 'kimi-thinking';

      if (useStreaming) {
        // ── Streaming path (SSE) for Kimi models ──
        const response = await fetch('/api/chat-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamedContent = '';
        let toolResults: Partial<ChatResponseWithTools> = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === 'tool_results') {
                toolResults = data;
              } else if (currentEvent === 'text_delta') {
                streamedContent += data.content;
                // Update the thinking message in-place with streamed content
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: streamedContent,
                    timestamp: new Date().toISOString(),
                  };
                  return updated;
                });
              } else if (currentEvent === 'done') {
                // Finalize: store tool calls
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: streamedContent,
                    timestamp: data.timestamp,
                  };
                  const msgIdx = newMessages.length - 1;

                  if (toolResults.codeAnalysisCalls && toolResults.codeAnalysisCalls.length > 0) {
                    setCodeAnalysisCalls(prevCalls => {
                      const m = new Map(prevCalls);
                      m.set(msgIdx, toolResults.codeAnalysisCalls!);
                      return m;
                    });
                  }
                  if (toolResults.obsidianNoteCalls && toolResults.obsidianNoteCalls.length > 0) {
                    setObsidianNoteCalls(prevCalls => {
                      const m = new Map(prevCalls);
                      m.set(msgIdx, toolResults.obsidianNoteCalls!);
                      return m;
                    });
                  }
                  if (toolResults.googleCalendarCalls && toolResults.googleCalendarCalls.length > 0) {
                    setGoogleCalendarCalls(prevCalls => {
                      const m = new Map(prevCalls);
                      m.set(msgIdx, toolResults.googleCalendarCalls!);
                      return m;
                    });
                  }
                  const activity = collectToolActivity(toolResults);
                  if (activity.length) setToolActivity(prev => [...prev, ...activity]);
                  return newMessages;
                });
              } else if (currentEvent === 'error') {
                throw new Error(data.error || 'Streaming error');
              }
              currentEvent = '';
            }
          }
        }
      } else {
        // ── Non-streaming path (Gemini / Claude) ──
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const chatResponse: ChatResponseWithTools = await response.json();

        const assistantMessage: Message = {
          role: 'assistant',
          content: chatResponse.response,
          timestamp: chatResponse.timestamp
        };

        setMessages(prevMessages => {
          const withoutThinking = prevMessages.slice(0, -1);
          const newMessages = [...withoutThinking, assistantMessage];
          
          if (chatResponse.codeAnalysisCalls && chatResponse.codeAnalysisCalls.length > 0) {
            setCodeAnalysisCalls(prevCalls => {
              const newMap = new Map(prevCalls);
              newMap.set(newMessages.length - 1, chatResponse.codeAnalysisCalls!);
              return newMap;
            });
          }
          
          if (chatResponse.obsidianNoteCalls && chatResponse.obsidianNoteCalls.length > 0) {
            setObsidianNoteCalls(prevCalls => {
              const newMap = new Map(prevCalls);
              newMap.set(newMessages.length - 1, chatResponse.obsidianNoteCalls!);
              return newMap;
            });
          }
          
          if (chatResponse.googleCalendarCalls && chatResponse.googleCalendarCalls.length > 0) {
            setGoogleCalendarCalls(prevCalls => {
              const newMap = new Map(prevCalls);
              newMap.set(newMessages.length - 1, chatResponse.googleCalendarCalls!);
              return newMap;
            });
          }

          // Feed EVERY tool call (all categories) into the persistent activity log.
          const activity = collectToolActivity(chatResponse);
          if (activity.length) setToolActivity(prev => [...prev, ...activity]);

          return newMessages;
        });
      }


      // Check if we need to compact the session
      // Use a callback to get the latest messages
      setMessages(prev => {
        const currentTokens = estimateSessionTokens(prev);
        const threshold = getCompactThreshold();
        if (currentTokens > threshold) {
          console.log(`[compact] Session tokens (~${currentTokens}) exceed threshold (~${threshold}), triggering compaction...`);
          // Run compaction async — don't block the UI
          compactSession(prev).then(result => {
            if (result) {
              setSessionSummary(result.summary);
              setMessages(result.messages);
              // Reset tool call maps since message indices changed
              setCodeAnalysisCalls(new Map());
              setObsidianNoteCalls(new Map());
              setGoogleCalendarCalls(new Map());
            }
          });
        }
        return prev;
      });

    } catch (err) {
      console.error('Chat error:', err);
      // The fetch may have died because the tab was backgrounded (common on
      // mobile) while the server still finished and saved the reply. Try to
      // recover it from the session before treating this as a hard error.
      const recovered = sessionId ? await reconcileSession(sessionId) : false;
      if (!recovered) {
        // Remove both the thinking message AND the optimistic user message,
        // then restore the input so the user doesn't lose their text.
        setMessages(prevMessages => prevMessages.slice(0, -2));
        setInputMessage(savedInput);
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <AppShell variant="full">
      <div className="flex h-full min-h-0 flex-col text-foreground">
      {/* Server status indicator */}
      {serverStatus !== 'online' && (
        <div className={`flex-shrink-0 px-4 py-1.5 text-xs text-center font-medium ${
          serverStatus === 'offline'
            ? 'bg-red-900/60 text-red-300'
            : 'bg-yellow-900/40 text-yellow-300'
        }`}>
          {serverStatus === 'offline' ? 'Server offline — messages will fail' : 'Checking server...'}
        </div>
      )}

      {/* Mobile toggle buttons - only visible on mobile */}
      <div className="flex md:hidden gap-2 p-2 border-b border-navy-red-700">
        <button
          onClick={() => setIsMobileToolPanelOpen(!isMobileToolPanelOpen)}
          className="flex items-center gap-2 bg-navy-red-800 hover:bg-navy-red-700 px-4 py-2 rounded-lg min-h-[44px] min-w-[44px] transition-colors"
          aria-label="Toggle tools panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Tools</span>
        </button>
      </div>

      {/* Main content area - takes remaining height */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        {/* Backdrop for mobile tool panel */}
        {isMobileToolPanelOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={() => setIsMobileToolPanelOpen(false)}
            aria-label="Close overlay"
          />
        )}

        {/* Main Chat Area */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Left Panel - Chat Messages */}
          <div className="flex-1 overflow-hidden flex flex-col border-r border-navy-red-700 min-h-0">
            {/* Scrollable Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-8">
                  <p className="text-lg mb-2">welcum to natural e-stupidity!</p>
                  <p>start a dump and i&apos;ll remember stuff prolly idk</p>
                  <p className="text-sm mt-4 text-gray-500">i can see ur obsidiyan nots, googl calender, codebaise hehe</p>
                </div>
              ) : (
              messages.map((message, index) => (
                  <ChatMessageItem
                    key={index}
                    message={message}
                    index={index}
                    codeAnalysisCalls={codeAnalysisCalls.get(index)}
                    obsidianNoteCalls={obsidianNoteCalls.get(index)}
                    googleCalendarCalls={googleCalendarCalls.get(index)}
                  />
                ))
              )}
              
              {/* Typing indicator */}
              <AnimatePresence>
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex justify-start"
                  >
                    <div className="bg-navy-red-800 border border-navy-red-700 rounded-lg p-4 max-w-[85%] md:max-w-[70%]">
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-1">
                          {[0, 1, 2].map((i) => (
                            <motion.div
                              key={i}
                              className="w-2 h-2 bg-gray-400 rounded-full"
                              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.15, 0.85] }}
                              transition={{
                                duration: 1,
                                repeat: Infinity,
                                delay: i * 0.2,
                                ease: 'easeInOut',
                              }}
                            />
                          ))}
                        </div>
                        <span className="text-gray-400 text-sm">
                          {selectedModel === 'claude' ? 'Claude' :
                           selectedModel === 'kimi' ? 'Kimi' :
                           selectedModel === 'kimi-thinking' ? 'Kimi' :
                           selectedModel === 'glm' ? 'GLM' :
                           selectedModel === 'kiro' ? 'Kiro' :
                           selectedModel === 'gemini-pro' ? 'Gemini Pro' :
                           'Gemini'} is thinking...
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div ref={messagesEndRef} />
            </div>

            {/* Sticky Error Display */}
            <div className="flex-shrink-0 mx-4 mb-2">
              <ErrorDisplay error={error} />
            </div>

            {/* Sticky Input Area */}
            <ChatInput
              inputMessage={inputMessage}
              setInputMessage={setInputMessage}
              isLoading={isLoading}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              onSend={sendMessage}
              inputRef={inputRef}
            />
          </div>

          {/* Right Panel - Code Analysis & YouTube Transcripts */}
          <div className={`
            hidden md:flex ${contextTab === 'terminal' ? 'md:w-[min(60vw,1100px)]' : 'md:w-[500px]'}
            ${isMobileToolPanelOpen ? 'fixed inset-y-0 right-0 z-50 w-full sm:w-96 flex' : ''}
            overflow-hidden flex-col bg-navy-red-850 min-h-0
          `}>
            {/* Sticky Header with Tabs */}
            <div className="flex-shrink-0 border-b border-navy-red-700 bg-navy-red-800">
              <div className="flex items-center justify-between p-4 pb-0">
                <h2 className="text-lg font-semibold">contecs inginiring</h2>
                {(contextTab === 'prompt' || contextTab === 'memory') && (
                  <button
                    onClick={loadContextData}
                    disabled={isLoadingContext}
                    className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {isLoadingContext ? '...' : '↻ refresh'}
                  </button>
                )}
              </div>
              <div className="flex gap-1 px-4 pt-3 pb-0">
                {(['tools', 'prompt', 'memory', 'history', 'terminal'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setContextTab(tab)}
                    className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-all duration-150 ${
                      contextTab === tab
                        ? 'bg-navy-red-850 text-white border border-navy-red-700 border-b-transparent'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {tab === 'tools' ? 'tools' : tab === 'prompt' ? 'system prompt' : tab === 'memory' ? 'memory' : tab === 'history' ? 'history' : 'terminal'}
                  </button>
                ))}
              </div>
            </div>
            {terminalOpened && (
              <div className={contextTab === 'terminal' ? 'flex flex-1 min-h-0' : 'hidden'}>
                <TerminalPanel active={contextTab === 'terminal'} />
              </div>
            )}
            {/* Scrollable Content */}
            <div className={contextTab === 'terminal' ? 'hidden' : 'flex-1 overflow-y-auto p-4 min-h-0'}>
              {contextTab === 'tools' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                      {toolActivity.length} tool call{toolActivity.length === 1 ? '' : 's'} this session
                    </div>
                    {toolActivity.length > 0 && (
                      <button onClick={() => setToolActivity([])} className="text-xs text-gray-400 hover:text-white transition-colors">clear</button>
                    )}
                  </div>

                  {toolActivity.length === 0 ? (
                    <div className="text-center text-gray-500 mt-6 mb-2 text-sm">
                      No tools used yet this session. When the assistant runs a tool
                      (shell, search, files, chat history, git, …) it&apos;ll stream in here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[...toolActivity].reverse().map((e) => {
                        const isErr = /error|failed|cannot|exit code [^0]/i.test(e.detail.slice(0, 40));
                        return (
                          <div key={e.id} className="border border-navy-red-700 rounded-lg p-2 bg-navy-red-800">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TOOL_META[e.category]?.badge || 'bg-navy-red-700 text-gray-300'}`}>{e.label}</span>
                              {isErr && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900 text-red-200">error</span>}
                              <span className="text-[11px] text-gray-500 ml-auto">{formatTimestamp(e.timestamp)}</span>
                            </div>
                            <div className="text-xs text-gray-200 font-mono break-words">{e.title}</div>
                            {e.detail && (
                              <div className="text-[11px] text-gray-400 mt-1 whitespace-pre-wrap break-words">
                                {e.detail.length > 500 ? e.detail.slice(0, 500) + '…' : e.detail}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reference: everything the assistant can do */}
                  <details className="mt-2 border border-navy-red-700 rounded-lg bg-navy-red-800">
                    <summary className="cursor-pointer text-xs text-gray-300 p-2 select-none">available tools</summary>
                    <div className="p-2 pt-0 space-y-2">
                      {AVAILABLE_TOOLS.map((g) => (
                        <div key={g.group}>
                          <div className="text-[10px] text-gray-500 uppercase tracking-wide">{g.group}</div>
                          <div className="text-xs text-gray-300">{g.items.join(' · ')}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {contextTab === 'prompt' && (
                <div className="space-y-4">
                  {isLoadingContext ? (
                    <div className="text-center text-gray-400 mt-8">loading system prompt...</div>
                  ) : contextData?.systemPrompt ? (
                    <>
                      <div className="flex gap-3 text-xs text-gray-400 mb-3">
                        <span>{contextData.systemPromptLength?.toLocaleString()} chars</span>
                        <span>~{contextData.systemPromptTokenEstimate?.toLocaleString()} tokens</span>
                      </div>
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-navy-red-900 border border-navy-red-700 rounded-lg p-3 leading-relaxed max-h-none overflow-visible">
                        {contextData.systemPrompt}
                      </pre>
                    </>
                  ) : (
                    <div className="text-center text-gray-400 mt-8">
                      <p className="text-sm">couldn&apos;t load system prompt</p>
                    </div>
                  )}
                </div>
              )}

              {contextTab === 'memory' && (
                <div className="space-y-4">
                  {isLoadingContext ? (
                    <div className="text-center text-gray-400 mt-8">loading memory...</div>
                  ) : contextData ? (
                    <>
                      {/* Session stats */}
                      <div className="border border-navy-red-700 rounded-lg p-3 bg-navy-red-800">
                        <div className="text-xs text-gray-400 mb-2">session context</div>
                        <div className="space-y-1 text-sm text-gray-300">
                          <div>messages in session: {messages.length}</div>
                          <div>session chars: ~{messages.reduce((a, m) => a + m.content.length, 0).toLocaleString()}</div>
                          <div>est. tokens: ~{estimateSessionTokens(messages).toLocaleString()}</div>
                          <div>context window: {((MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000) / 1000).toFixed(0)}K</div>
                          <div>compact at: ~{(getCompactThreshold() / 1000).toFixed(0)}K tokens (75%)</div>
                          <div className={`${
                            estimateSessionTokens(messages) > getCompactThreshold()
                              ? 'text-red-400'
                              : estimateSessionTokens(messages) > getCompactThreshold() * 0.8
                              ? 'text-yellow-400'
                              : 'text-green-400'
                          }`}>
                            usage: {((estimateSessionTokens(messages) / (MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000)) * 100).toFixed(1)}%
                          </div>
                          {sessionSummary && (
                            <div className="text-blue-400">✓ has compacted summary ({sessionSummary.length} chars)</div>
                          )}
                          {isCompacting && (
                            <div className="text-yellow-400 animate-pulse">⏳ compacting session...</div>
                          )}
                          <div>selected model: {selectedModel}</div>
                          <div>session id: {currentSessionId || 'none'}</div>
                        </div>
                      </div>

                      {/* Curated agent context */}
                      <div className="border border-navy-red-700 rounded-lg p-3 bg-navy-red-800">
                        <div className="text-xs text-gray-400 mb-2">curated agent context</div>
                        <div className="space-y-2 text-sm text-gray-300">
                          <div>{contextData.agentContext?.sources.length || 0} source files</div>
                          <div>{(contextData.agentContext?.totalChars || 0).toLocaleString()} chars</div>
                          <div>~{(contextData.agentContext?.tokenEstimate || 0).toLocaleString()} tokens</div>
                          {(contextData.agentContext?.matchedProjects.length || 0) > 0 && (
                            <div className="text-blue-400">
                              projects: {contextData.agentContext?.matchedProjects.join(', ')}
                            </div>
                          )}
                          <div className="mt-2 space-y-1 font-mono text-xs">
                            {contextData.agentContext?.sources.map((source) => (
                              <div key={source.path} className={source.truncated ? 'text-yellow-400' : 'text-gray-400'}>
                                {source.path} ({source.chars.toLocaleString()} chars{source.truncated ? ', truncated' : ''})
                              </div>
                            ))}
                          </div>
                          {(contextData.agentContext?.missing.length || 0) > 0 && (
                            <div className="text-yellow-400 text-xs">
                              missing: {contextData.agentContext?.missing.join(', ')}
                            </div>
                          )}
                          {(contextData.agentContext?.warnings.length || 0) > 0 && (
                            <div className="text-red-400 text-xs">
                              warnings: {contextData.agentContext?.warnings.join('; ')}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Total context budget */}
                      <div className="border border-navy-red-700 rounded-lg p-3 bg-navy-red-800">
                        <div className="text-xs text-gray-400 mb-2">total context estimate</div>
                        <div className="text-sm text-gray-300">
                          ~{(
                            (contextData.systemPromptTokenEstimate || 0) +
                            Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 4)
                          ).toLocaleString()} tokens
                        </div>
                        <div className="mt-2 w-full bg-navy-red-900 rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(100, (
                                ((contextData.systemPromptTokenEstimate || 0) +
                                Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 4))
                                / (MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000)
                              ) * 100)}%`
                            }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">of ~{((MODEL_CONTEXT_WINDOWS[selectedModel] || 128_000) / 1000).toFixed(0)}k context window ({selectedModel})</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-gray-400 mt-8">
                      <p className="text-sm">couldn&apos;t load memory info</p>
                    </div>
                  )}
                </div>
              )}

              {contextTab === 'history' && (
                <div className="space-y-3">
                  {historyMessages !== null ? (
                    /* Read-only transcript view */
                    <>
                      <button
                        onClick={() => setHistoryMessages(null)}
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                      >
                        ← all transcripts
                      </button>
                      <div className="text-sm text-white font-medium truncate">{historyTitle}</div>
                      {loadingHistory ? (
                        <div className="text-center text-gray-400 mt-8">loading…</div>
                      ) : historyMessages.length === 0 ? (
                        <div className="text-center text-gray-400 mt-8 text-sm">empty transcript</div>
                      ) : (
                        <div className="space-y-2">
                          {historyMessages.map((m, i) => (
                            <div key={i} className="border border-navy-red-700 rounded-lg p-2 bg-navy-red-800">
                              <div className={`text-xs mb-1 ${m.role === 'user' ? 'text-blue-300' : 'text-green-300'}`}>
                                {m.role === 'user' ? 'you' : 'assistant'}
                                {m.timestamp ? ` · ${formatTimestamp(m.timestamp)}` : ''}
                              </div>
                              <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">{m.content}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : loadingHistory ? (
                    <div className="text-center text-gray-400 mt-8">loading transcripts…</div>
                  ) : sessionList.length === 0 ? (
                    <div className="text-center text-gray-400 mt-8 text-sm">no saved transcripts</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-400">{sessionList.length} transcripts (web + Discord)</div>
                        <button onClick={loadSessionList} className="text-xs text-gray-400 hover:text-white transition-colors">↻ refresh</button>
                      </div>
                      {sessionList.map((s) => {
                        const isDiscord = s.sessionId.startsWith('discord-');
                        const isClaude = s.sessionId.startsWith('claude-');
                        const label = s.sessionId === 'main' ? 'Main (web + Discord)'
                          : isDiscord ? 'Discord'
                          : isClaude ? 'Claude'
                          : 'Web session';
                        return (
                          <button
                            key={s.sessionId}
                            onClick={() => openHistory(s.sessionId, s.title || label)}
                            className="w-full text-left border border-navy-red-700 rounded-lg p-2 bg-navy-red-800 hover:border-navy-red-500 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDiscord ? 'bg-indigo-900 text-indigo-200' : isClaude ? 'bg-orange-900 text-orange-200' : s.sessionId === 'main' ? 'bg-primary/25 text-primary' : 'bg-navy-red-700 text-gray-300'}`}>{label}</span>
                              <span className="text-xs text-gray-500">{s.messageCount} msgs</span>
                            </div>
                            <div className="text-sm text-gray-200 truncate mt-1">{s.title || '(untitled)'}</div>
                            {s.lastActivity && <div className="text-[11px] text-gray-500">{formatTimestamp(s.lastActivity)}</div>}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </AppShell>
  );
}
