'use client';

import React, { useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const MODELS = [
  { id: 'claude' as const, label: 'Claude' },
  { id: 'gemini' as const, label: 'Gemini' },
  { id: 'gemini-pro' as const, label: 'Gemini Pro' },
  { id: 'kimi' as const, label: 'Kimi' },
  { id: 'kimi-thinking' as const, label: 'Kimi Think' },
  { id: 'glm' as const, label: 'GLM' },
  { id: 'kiro' as const, label: 'Kiro' },
];

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (value: string) => void;
  isLoading: boolean;
  selectedModel: 'gemini' | 'gemini-pro' | 'claude' | 'kimi' | 'kimi-thinking' | 'glm' | 'kiro';
  setSelectedModel: (model: 'gemini' | 'gemini-pro' | 'claude' | 'kimi' | 'kimi-thinking' | 'glm' | 'kiro') => void;
  onSend: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function ChatInput({
  inputMessage,
  setInputMessage,
  isLoading,
  selectedModel,
  setSelectedModel,
  onSend,
  inputRef,
}: ChatInputProps) {
  const maxRows = 6;
  const lineHeight = 26;

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows)}px`;
  }, [inputRef]);

  useEffect(() => { autoResize(); }, [inputMessage, autoResize]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  const canSend = inputMessage.trim().length > 0 && !isLoading;

  return (
    <div className="flex-shrink-0 border-t border-border/50 bg-card/90 backdrop-blur-sm px-4 py-4 md:px-6">
      {/* Textarea + actions */}
      <div className="relative">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="what's on your mind?"
          rows={1}
          className={cn(
            'w-full resize-none rounded-2xl border border-border/50 bg-background px-5 py-4 pr-16',
            'text-[15px] text-foreground placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-all duration-200'
          )}
          style={{ lineHeight: `${lineHeight}px`, maxHeight: `${lineHeight * maxRows}px` }}
        />

        {/* Floating action buttons inside textarea */}
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
          <motion.button
            onClick={onSend}
            disabled={!canSend}
            whileTap={canSend ? { scale: 0.88 } : undefined}
            className={cn(
              'flex items-center justify-center rounded-xl p-2.5 min-h-[40px] min-w-[40px]',
              'transition-all duration-150',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/85 shadow-md shadow-primary/20'
                : 'bg-muted/60 text-muted-foreground/30 cursor-not-allowed'
            )}
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Model selector — below textarea, feels like a mode switch */}
      <div className="flex items-center gap-1 mt-2.5 px-1">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedModel(m.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
              selectedModel === m.id
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}