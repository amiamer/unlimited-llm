'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SessionMetadata {
  sessionId: string;
  title: string;
  lastActivity: string;
  messageCount: number;
}

interface SessionSidebarProps {
  sessions: SessionMetadata[];
  currentSessionId: string | null;
  isLoadingSessions: boolean;
  isSidebarOpen: boolean;
  isMobileSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onToggleMobileSidebar: (open: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
}

function formatSessionDate(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function SkeletonCards() {
  return (
    <div className="space-y-2 p-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg p-3 space-y-2">
          <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-muted/60 animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-10 rounded bg-muted/40 animate-pulse" />
            <div className="h-4 w-6 rounded-full bg-muted/40 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionCard({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: SessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const preview = session.title.length > 60
    ? session.title.slice(0, 60) + '…'
    : session.title;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.15 }}
      onClick={onSelect}
      className={cn(
        'group relative rounded-lg px-3 py-2.5 cursor-pointer transition-all duration-150',
        isActive
          ? 'bg-primary/10 border-l-2 border-primary shadow-sm shadow-primary/5'
          : 'hover:bg-muted/50 border-l-2 border-transparent'
      )}
    >
      <div className="text-sm font-medium truncate text-foreground leading-snug">
        {preview}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-muted-foreground">
          {formatSessionDate(session.lastActivity)}
        </span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 leading-none">
          {session.messageCount}
        </Badge>
      </div>

      {/* Delete button on hover */}
      <button
        onClick={onDelete}
        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
        aria-label="Delete session"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}

function SidebarContent({
  sessions,
  currentSessionId,
  isLoadingSessions,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: Pick<SessionSidebarProps, 'sessions' | 'currentSessionId' | 'isLoadingSessions' | 'onSelectSession' | 'onCreateSession' | 'onDeleteSession'>) {
  return (
    <div className="flex flex-col h-full">
      {/* New Chat button */}
      <div className="flex-shrink-0 p-3 border-b border-border/40">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoadingSessions ? (
          <SkeletonCards />
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No sessions yet
          </div>
        ) : (
          <div className="space-y-1 p-2">
            <AnimatePresence initial={false}>
              {sessions.map((session) => (
                <SessionCard
                  key={session.sessionId}
                  session={session}
                  isActive={currentSessionId === session.sessionId}
                  onSelect={() => onSelectSession(session.sessionId)}
                  onDelete={(e) => onDeleteSession(e, session.sessionId)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionSidebar({
  sessions,
  currentSessionId,
  isLoadingSessions,
  isSidebarOpen,
  isMobileSidebarOpen,
  onToggleSidebar,
  onToggleMobileSidebar,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionSidebarProps) {
  const sharedProps = {
    sessions,
    currentSessionId,
    isLoadingSessions,
    onSelectSession,
    onCreateSession,
    onDeleteSession,
  };

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={cn(
          'hidden md:flex flex-col border-r border-border/40 bg-card transition-all duration-200 overflow-hidden',
          isSidebarOpen ? 'w-64' : 'w-0'
        )}
      >
        {isSidebarOpen && <SidebarContent {...sharedProps} />}
      </div>

      {/* Desktop toggle */}
      <button
        onClick={onToggleSidebar}
        className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 bg-card hover:bg-muted text-muted-foreground p-1.5 rounded-r-md transition-colors z-10 border border-l-0 border-border/40"
        title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isSidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          )}
        </svg>
      </button>

      {/* Mobile Sheet */}
      <Sheet open={isMobileSidebarOpen} onOpenChange={onToggleMobileSidebar}>
        <SheetContent side="left" className="w-72 p-0 bg-card border-border/40">
          <SheetTitle className="sr-only">Chat Sessions</SheetTitle>
          <SidebarContent {...sharedProps} />
        </SheetContent>
      </Sheet>
    </>
  );
}
