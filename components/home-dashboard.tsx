'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PipelineItem {
  id: string;
  title: string;
  status: string;
  lastEdited: string;
}

interface CalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface Book {
  id: string;
  title: string;
  fileName: string;
  servingUrl: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLUMNS = [
  { id: 'idea', label: 'Idea', emoji: '💡' },
  { id: 'draft', label: 'Draft', emoji: '✏️' },
  { id: 'editing', label: 'Editing', emoji: '🔧' },
  { id: 'ready', label: 'Ready', emoji: '✅' },
  { id: 'published', label: 'Published', emoji: '🚀' },
];

const QUICK_LINKS = [
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/reader', label: 'Reader', icon: '📖' },
];

function daysSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function formatEventTime(event: CalendarEvent): string {
  const dt = event.start?.dateTime;
  if (!dt) return 'All day';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getEventDay(event: CalendarEvent): string {
  const dt = event.start?.dateTime || event.start?.date;
  if (!dt) return '';
  const d = new Date(dt);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isToday(event: CalendarEvent): boolean {
  const dt = event.start?.dateTime || event.start?.date;
  if (!dt) return false;
  return new Date(dt).toDateString() === new Date().toDateString();
}

// ─── Pipeline Modal ──────────────────────────────────────────────────────────

function PipelineModal({
  item,
  column,
  onSave,
  onDelete,
  onClose,
}: {
  item: PipelineItem | null;
  column: string;
  onSave: (item: PipelineItem) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item?.title || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      id: item?.id || crypto.randomUUID(),
      title: title.trim(),
      status: item?.status || column,
      lastEdited: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-lg p-5 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">{item ? 'Edit Item' : 'New Item'}</h3>
          <Badge variant="outline" className="text-[10px]">
            {COLUMNS.find(c => c.id === (item?.status || column))?.emoji}{' '}
            {COLUMNS.find(c => c.id === (item?.status || column))?.label}
          </Badge>
        </div>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Title"
          className="w-full bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 mb-3"
          autoFocus
        />
        {item && (
          <p className="text-[10px] text-muted-foreground mb-4">
            Last edited: {new Date(item.lastEdited).toLocaleString()}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div>
            {item && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => onDelete(item.id)} className="text-xs text-red-400 hover:text-red-300">Confirm delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-xs text-muted-foreground hover:text-red-400">Delete</button>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={handleSave} disabled={!title.trim()} className="px-3 py-1.5 text-xs bg-primary/20 hover:bg-primary/30 rounded-md disabled:opacity-40">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Calendar Add Event Modal ────────────────────────────────────────────────

function AddEventModal({ onClose, onSave }: { onClose: () => void; onSave: (data: { summary: string; startDateTime: string; endDateTime?: string; description?: string }) => void }) {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!summary.trim() || !date || !startTime) return;
    const startDateTime = new Date(`${date}T${startTime}`).toISOString();
    const endDateTime = endTime ? new Date(`${date}T${endTime}`).toISOString() : undefined;
    onSave({ summary: summary.trim(), startDateTime, endDateTime, description: description.trim() || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border/40 rounded-lg p-5 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium mb-4">New Event</h3>
        <div className="space-y-3">
          <input type="text" value={summary} onChange={e => setSummary(e.target.value)} placeholder="Event title" className="w-full bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" autoFocus />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
          <div className="flex gap-2">
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="Start" className="flex-1 bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="End (optional)" className="flex-1 bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full bg-muted/30 border border-border/40 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSubmit} disabled={!summary.trim() || !date || !startTime} className="px-3 py-1.5 text-xs bg-primary/20 hover:bg-primary/30 rounded-md disabled:opacity-40">Add Event</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function HomeDashboard() {
  // Pipeline state
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalItem, setModalItem] = useState<PipelineItem | null>(null);
  const [modalColumn, setModalColumn] = useState<string>('');
  const [showModal, setShowModal] = useState(false);

  // Calendar state
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  const [calError, setCalError] = useState<string | null>(null);
  const [calLoaded, setCalLoaded] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);

  // Vault state
  const [activeTasks, setActiveTasks] = useState<string | null>(null);
  const [weeklyFocus, setWeeklyFocus] = useState<string | null>(null);
  const [vaultTab, setVaultTab] = useState<'tasks' | 'focus'>('tasks');

  // Books state
  const [books, setBooks] = useState<Book[]>([]);
  const [booksLoaded, setBooksLoaded] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    // Pipeline
    fetch('/api/writing-pipeline')
      .then(r => r.json())
      .then(data => { setItems(data.items || []); setLoaded(true); })
      .catch(() => setLoaded(true));

    // Calendar
    fetch('/api/calendar-widget')
      .then(r => r.json())
      .then(data => {
        if (data.error && !data.events?.length) setCalError(data.error);
        else setCalEvents(data.events || []);
        setCalLoaded(true);
      })
      .catch(() => { setCalError('Calendar not connected'); setCalLoaded(true); });

    // Vault files
    fetch('/api/vault-widget?file=Active tasks.md')
      .then(r => r.json())
      .then(data => setActiveTasks(data.content || null))
      .catch(() => setActiveTasks(null));

    fetch('/api/vault-widget?file=Weekly focus.md')
      .then(r => r.json())
      .then(data => setWeeklyFocus(data.content || null))
      .catch(() => setWeeklyFocus(null));

    // Books
    fetch('/api/reader/books')
      .then(r => r.json())
      .then(data => { setBooks((data.books || []).slice(0, 5)); setBooksLoaded(true); })
      .catch(() => setBooksLoaded(true));
  }, []);

  // ─── Pipeline handlers ─────────────────────────────────────────────────────

  const persist = useCallback((updated: PipelineItem[]) => {
    fetch('/api/writing-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: updated }),
    }).catch(console.error);
  }, []);

  const onDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId;
    const itemId = result.draggableId;
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === itemId ? { ...item, status: newStatus, lastEdited: new Date().toISOString() } : item
      );
      persist(updated);
      return updated;
    });
  }, [persist]);

  const handleSaveItem = useCallback((item: PipelineItem) => {
    setItems(prev => {
      const exists = prev.find(i => i.id === item.id);
      const updated = exists ? prev.map(i => i.id === item.id ? item : i) : [...prev, item];
      persist(updated);
      return updated;
    });
    setShowModal(false);
  }, [persist]);

  const handleDeleteItem = useCallback((id: string) => {
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      persist(updated);
      return updated;
    });
    setShowModal(false);
  }, [persist]);

  // ─── Calendar handlers ─────────────────────────────────────────────────────

  const handleAddEvent = useCallback(async (data: { summary: string; startDateTime: string; endDateTime?: string; description?: string }) => {
    try {
      await fetch('/api/calendar-widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      // Refresh events
      const res = await fetch('/api/calendar-widget');
      const json = await res.json();
      setCalEvents(json.events || []);
      setShowAddEvent(false);
    } catch {
      // silently fail
    }
  }, []);

  // ─── Group calendar events by day ──────────────────────────────────────────

  const eventsByDay: Record<string, CalendarEvent[]> = {};
  calEvents.forEach(ev => {
    const day = getEventDay(ev);
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(ev);
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    // Width + outer padding are owned by AppShell's `contained` main; this
    // wrapper only carries the section rhythm.
    <div className="space-y-6">
      {/* Quick Links */}
      <div className="flex gap-2 flex-wrap">
        {QUICK_LINKS.map(link => (
          <Link key={link.href} href={link.href} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border/40 hover:bg-muted transition-colors text-sm">
            <span>{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Writing Pipeline Kanban */}
      <Card className="bg-card border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">📝 Writing Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!loaded ? (
            <div className="flex gap-3">
              {COLUMNS.map(col => (
                <div key={col.id} className="flex-shrink-0 w-48 space-y-2">
                  <div className="h-5 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-16 rounded bg-muted/60 animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 min-w-max">
                {COLUMNS.map(col => {
                  const colItems = items.filter(i => i.status === col.id);
                  return (
                    <Droppable key={col.id} droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div ref={provided.innerRef} {...provided.droppableProps} className={cn('flex-shrink-0 w-48 rounded-lg p-2 min-h-[120px] transition-colors', snapshot.isDraggingOver ? 'bg-muted/60' : 'bg-muted/20')}>
                          <div className="flex items-center gap-1.5 mb-2 px-1">
                            <span className="text-sm">{col.emoji}</span>
                            <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-auto">{colItems.length}</Badge>
                          </div>
                          {colItems.map((item, idx) => (
                            <Draggable key={item.id} draggableId={item.id} index={idx}>
                              {(prov, snap) => (
                                <div
                                  ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                                  onClick={() => { setModalItem(item); setModalColumn(col.id); setShowModal(true); }}
                                  className={cn('rounded-md bg-card border border-border/40 p-2 mb-1.5 cursor-grab active:cursor-grabbing transition-shadow hover:border-primary/30', snap.isDragging && 'shadow-lg ring-1 ring-primary/30')}
                                >
                                  <div className="text-xs font-medium leading-snug">{item.title}</div>
                                  <div className="text-[10px] text-muted-foreground mt-1">
                                    {daysSince(item.lastEdited) === 0 ? 'today' : `${daysSince(item.lastEdited)}d ago`}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                          <button
                            onClick={() => { setModalItem(null); setModalColumn(col.id); setShowModal(true); }}
                            className="w-full mt-1 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded transition-colors"
                          >
                            + Add
                          </button>
                        </div>
                      )}
                    </Droppable>
                  );
                })}
              </div>
            </DragDropContext>
          )}
        </CardContent>
      </Card>

      {/* Calendar + Vault Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Calendar Widget */}
        <Card className="bg-card border-border/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">📅 Next 7 Days</CardTitle>
              <button onClick={() => setShowAddEvent(true)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors text-sm">+</button>
            </div>
          </CardHeader>
          <CardContent>
            {!calLoaded ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-4 rounded bg-muted animate-pulse" />)}
              </div>
            ) : calError ? (
              <p className="text-xs text-muted-foreground">{calError}</p>
            ) : calEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No upcoming events</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(eventsByDay).map(([day, events]) => (
                  <div key={day}>
                    <p className={cn('text-[10px] font-medium mb-1', day === 'Today' ? 'text-primary' : 'text-muted-foreground')}>{day}</p>
                    <div className="space-y-1">
                      {events.map((ev, i) => (
                        <div key={ev.id || i} className={cn('flex items-center gap-2 px-2 py-1 rounded text-xs', isToday(ev) ? 'bg-primary/10' : 'bg-muted/20')}>
                          <span className="text-muted-foreground w-16 flex-shrink-0">{formatEventTime(ev)}</span>
                          <span className="truncate">{ev.summary || 'Untitled'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vault Widget */}
        <Card className="bg-card border-border/40">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setVaultTab('tasks')} className={cn('text-xs px-2 py-1 rounded transition-colors', vaultTab === 'tasks' ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:text-foreground')}>Active Tasks</button>
              <button onClick={() => setVaultTab('focus')} className={cn('text-xs px-2 py-1 rounded transition-colors', vaultTab === 'focus' ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:text-foreground')}>Weekly Focus</button>
            </div>
          </CardHeader>
          <CardContent>
            {vaultTab === 'tasks' ? (
              activeTasks ? (
                <div className="prose prose-invert prose-sm max-w-none text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_ul]:my-1 [&_ol]:my-1">
                  <ReactMarkdown>{activeTasks}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No active tasks file found</p>
              )
            ) : (
              weeklyFocus ? (
                <div className="prose prose-invert prose-sm max-w-none text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_ul]:my-1 [&_ol]:my-1">
                  <ReactMarkdown>{weeklyFocus}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No weekly focus file found</p>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recently Read */}
      <Card className="bg-card border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">📚 Recently Read</CardTitle>
        </CardHeader>
        <CardContent>
          {!booksLoaded ? (
            <div className="flex gap-3">
              {[1, 2, 3].map(i => <div key={i} className="h-4 w-32 rounded bg-muted animate-pulse" />)}
            </div>
          ) : books.length === 0 ? (
            <p className="text-xs text-muted-foreground">No books yet</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {books.map(book => (
                <Link
                  key={book.id}
                  href={`/reader?book=${encodeURIComponent(book.fileName)}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/20 hover:bg-muted/40 transition-colors text-xs"
                >
                  <span>📖</span>
                  <span className="truncate max-w-[200px]">{book.title}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      {showModal && (
        <PipelineModal
          item={modalItem}
          column={modalColumn}
          onSave={handleSaveItem}
          onDelete={modalItem ? handleDeleteItem : undefined}
          onClose={() => setShowModal(false)}
        />
      )}
      {showAddEvent && (
        <AddEventModal onClose={() => setShowAddEvent(false)} onSave={handleAddEvent} />
      )}
    </div>
  );
}
