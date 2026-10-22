'use client';

import React from 'react';
import { ReadingSession } from '@/lib/types/reader';

/**
 * SessionSidebar - Displays list of reading sessions with resume capability
 * Requirements: 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 * 
 * This component displays all sessions in a right sidebar, shows book title
 * and current position, orders by last access, and handles session selection/deletion.
 */

interface SessionSidebarProps {
  sessions: ReadingSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  isLoadingSession?: boolean;
  /** When provided, renders a collapse control in the header. */
  onCollapse?: () => void;
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  isLoadingSession = false,
  onCollapse,
}: SessionSidebarProps) {
  // Sort sessions by lastAccessed timestamp (most recent first)
  const sortedSessions = [...sessions].sort((a, b) => b.lastAccessed - a.lastAccessed);

  const formatPosition = (session: ReadingSession) => {
    return `Chapter ${session.currentChapter + 1}`;
  };

  const formatLastAccessed = (timestamp: number) => {
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
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // Prevent session selection when clicking delete
    if (window.confirm('Are you sure you want to delete this reading session?')) {
      onSessionDelete(sessionId);
    }
  };

  return (
    <div className="session-sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="header-title">
          <BookIcon />
          <h3>Reading Sessions</h3>
        </div>
        <div className="header-actions">
          <div className="session-count">{sessions.length}</div>
          {onCollapse && (
            <button
              className="collapse-button"
              onClick={onCollapse}
              aria-label="Hide sessions panel"
              title="Hide sessions panel"
            >
              <CollapseIcon />
            </button>
          )}
        </div>
      </div>

      {/* Sessions list */}
      <div className="sessions-list">
        {isLoadingSession && (
          <div className="loading-overlay">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-red-400"></div>
            <p className="text-sm text-gray-400 mt-2">Loading session...</p>
          </div>
        )}
        {sortedSessions.length === 0 ? (
          <div className="empty-state">
            <EmptyBookIcon />
            <p>No reading sessions yet</p>
            <span className="empty-hint">Upload an ePub to get started</span>
          </div>
        ) : (
          sortedSessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => onSessionSelect(session.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSessionSelect(session.id);
                }
              }}
              aria-label={`Resume reading ${session.title}`}
            >
              <div className="session-content">
                <div className="session-title">{session.title}</div>
                <div className="session-position">{formatPosition(session)}</div>
                <div className="session-timestamp">{formatLastAccessed(session.lastAccessed)}</div>
              </div>
              
              <button
                className="delete-button"
                onClick={(e) => handleDelete(e, session.id)}
                aria-label={`Delete ${session.title}`}
                title="Delete session"
              >
                <DeleteIcon />
              </button>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .session-sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #2d0a0a;
          border-left: 1px solid #4a1010;
          overflow: hidden;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem;
          border-bottom: 1px solid #4a1010;
          background: #1a0505;
        }

        .header-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .header-title h3 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: #f9fafb;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .collapse-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 1.75rem;
          height: 1.75rem;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          color: #9ca3af;
          cursor: pointer;
          transition: all 0.2s;
        }

        .collapse-button:hover {
          background: #4a1010;
          color: #f3f4f6;
        }

        .session-count {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 1.75rem;
          height: 1.75rem;
          padding: 0 0.5rem;
          background: #b83030;
          color: white;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .sessions-list {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          padding: 3rem 1.5rem;
          text-align: center;
          color: #6b7280;
        }

        .empty-state p {
          margin: 0;
          font-size: 0.9375rem;
          font-weight: 500;
          color: #9ca3af;
        }

        .empty-hint {
          font-size: 0.8125rem;
          color: #6b7280;
        }

        .session-item {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.875rem;
          margin-bottom: 0.5rem;
          background: #1a0505;
          border: 1px solid #4a1010;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .session-item:hover {
          background: #2d0a0a;
          border-color: #6b1818;
          transform: translateX(-2px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        .session-item:focus {
          outline: 2px solid #b83030;
          outline-offset: 2px;
        }

        .session-item.active {
          background: #2d0a0a;
          border-color: #b83030;
          box-shadow: 0 0 0 1px #b83030;
        }

        .session-item.active:hover {
          background: #4a1010;
        }

        .session-content {
          flex: 1;
          min-width: 0;
        }

        .session-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: #f3f4f6;
          margin-bottom: 0.375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .session-item.active .session-title {
          color: #f06060;
        }

        .session-position {
          font-size: 0.8125rem;
          color: #9ca3af;
          margin-bottom: 0.25rem;
        }

        .session-timestamp {
          font-size: 0.75rem;
          color: #6b7280;
        }

        .delete-button {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 0.375rem;
          color: #6b7280;
          cursor: pointer;
          transition: all 0.2s;
        }

        .delete-button:hover {
          background: #7f1d1d;
          color: #fca5a5;
        }

        .delete-button:focus {
          outline: 2px solid #ef4444;
          outline-offset: 2px;
        }

        .delete-button:active {
          transform: scale(0.95);
        }

        /* Scrollbar styling */
        .sessions-list::-webkit-scrollbar {
          width: 0.5rem;
        }

        .sessions-list::-webkit-scrollbar-track {
          background: #1a0505;
        }

        .sessions-list::-webkit-scrollbar-thumb {
          background: #6b1818;
          border-radius: 0.25rem;
        }

        .sessions-list::-webkit-scrollbar-thumb:hover {
          background: #8b2020;
        }

        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(26, 5, 5, 0.9);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 10;
        }
      `}</style>
    </div>
  );
}

// Icon components
function BookIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: '#b83030' }}
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function EmptyBookIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ color: '#d1d5db' }}
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
