'use client';

import React from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { CodeAnalysisCall, ObsidianNoteCall, GoogleCalendarCall } from '@/lib/types';

// Tool type config for consistent styling
const TOOL_STYLES = {
  code: {
    icon: '>',
    label: 'Code Analysis',
    accent: 'text-blue-400',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/5',
    dot: 'bg-blue-400',
  },
  note: {
    icon: '#',
    label: 'Obsidian',
    accent: 'text-violet-400',
    border: 'border-violet-500/20',
    bg: 'bg-violet-500/5',
    dot: 'bg-violet-400',
  },
  calendar: {
    icon: '@',
    label: 'Calendar',
    accent: 'text-emerald-400',
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/5',
    dot: 'bg-emerald-400',
  },
} as const;

type ToolType = keyof typeof TOOL_STYLES;

interface ToolCallChipProps {
  type: ToolType;
  summary: string;
  detail?: string;
  result?: string;
  timestamp?: string;
}

/**
 * Compact inline chip for tool calls shown beneath assistant messages.
 * Expands to show detail + result on click.
 */
export const ToolCallChip = React.memo(function ToolCallChip({
  type,
  summary,
  detail,
  result,
  timestamp,
}: ToolCallChipProps) {
  const [open, setOpen] = React.useState(false);
  const style = TOOL_STYLES[type];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
        ${style.bg} ${style.border} border
        text-gray-300 hover:text-gray-100 transition-colors cursor-pointer
        max-w-full
      `}>
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot} shrink-0`} />
        <span className={`${style.accent} font-medium shrink-0`}>{style.label}</span>
        <span className="truncate opacity-70">{summary}</span>
        <svg
          className={`w-3 h-3 shrink-0 transition-transform duration-150 opacity-40 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className={`mt-1.5 rounded-md ${style.border} border ${style.bg} p-3 text-xs space-y-2`}>
          {detail && (
            <div>
              <div className={`${style.accent} font-medium mb-0.5 uppercase tracking-wide text-[10px]`}>Query</div>
              <div className="text-gray-300 whitespace-pre-wrap leading-relaxed">{detail}</div>
            </div>
          )}
          {result && (
            <div>
              <div className={`${style.accent} font-medium mb-0.5 uppercase tracking-wide text-[10px]`}>Result</div>
              <div className="text-gray-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{result}</div>
            </div>
          )}
          {timestamp && (
            <div className="text-gray-500 text-[10px] pt-1">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

interface ToolCallGroupProps {
  codeAnalysisCalls?: CodeAnalysisCall[];
  obsidianNoteCalls?: ObsidianNoteCall[];
  googleCalendarCalls?: GoogleCalendarCall[];
}

/**
 * Renders a compact row of tool call chips for a single message.
 */
export const ToolCallGroup = React.memo(function ToolCallGroup({
  codeAnalysisCalls,
  obsidianNoteCalls,
  googleCalendarCalls,
}: ToolCallGroupProps) {
  const hasAny =
    (codeAnalysisCalls && codeAnalysisCalls.length > 0) ||
    (obsidianNoteCalls && obsidianNoteCalls.length > 0) ||
    (googleCalendarCalls && googleCalendarCalls.length > 0);

  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {codeAnalysisCalls?.map((call, i) => (
        <ToolCallChip
          key={`code-${i}`}
          type="code"
          summary={call.question.length > 50 ? call.question.slice(0, 50) + '…' : call.question}
          detail={call.question}
          result={call.answer}
          timestamp={call.timestamp}
        />
      ))}
      {obsidianNoteCalls?.map((call, i) => (
        <ToolCallChip
          key={`note-${i}`}
          type="note"
          summary={call.task.length > 50 ? call.task.slice(0, 50) + '…' : call.task}
          detail={call.task}
          result={call.result}
          timestamp={call.timestamp}
        />
      ))}
      {googleCalendarCalls?.map((call, i) => (
        <ToolCallChip
          key={`cal-${i}`}
          type="calendar"
          summary={call.action.length > 50 ? call.action.slice(0, 50) + '…' : call.action}
          detail={call.action}
          result={call.result}
          timestamp={call.timestamp}
        />
      ))}
    </div>
  );
});
