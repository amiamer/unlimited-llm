import { Client, TextChannel } from 'discord.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface ScheduledMessage {
  id: string;
  userId: string;
  channelId: string;
  message: string;
  scheduledTime: string; // ISO timestamp
  created: string;
  executed: boolean;
  /** Recurrence pattern. If set, message repeats instead of being marked executed. */
  recurrence?: RecurrencePattern;
  /** Consecutive send failures — auto-cancelled after 3 */
  failCount?: number;
}

export interface RecurrencePattern {
  /** Type of recurrence */
  type: 'daily' | 'weekly' | 'weekdays' | 'custom';
  /** For 'weekly': which days (0=Sun, 1=Mon, ..., 6=Sat) */
  daysOfWeek?: number[];
  /** For 'custom': interval in milliseconds */
  intervalMs?: number;
}

/**
 * Discord Message Scheduler
 * Manages scheduled and recurring messages sent via Discord bot.
 * Uses async fs with atomic writes (temp file + rename) for Windows compatibility.
 */
export class DiscordScheduler {
  private scheduledMessages: Map<string, ScheduledMessage> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private discordClient: Client | null = null;
  private storageFile: string;
  private saving = false; // Prevent concurrent saves

  constructor(storageDir: string = './data') {
    this.storageFile = path.join(storageDir, 'scheduled-messages.json');
    this.loadScheduledMessagesSync(); // Sync on startup only
  }

  setDiscordClient(client: Client) {
    this.discordClient = client;
  }

  start() {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      this.checkAndSendMessages();
    }, 30000);
    console.log('[SCHEDULER] Started checking for scheduled messages');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[SCHEDULER] Stopped');
    }
  }

  /**
   * Schedule a one-shot or recurring message
   */
  scheduleMessage(
    userId: string,
    channelId: string,
    message: string,
    scheduledTime: Date,
    recurrence?: RecurrencePattern
  ): ScheduledMessage {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const scheduled: ScheduledMessage = {
      id,
      userId,
      channelId,
      message,
      scheduledTime: scheduledTime.toISOString(),
      created: new Date().toISOString(),
      executed: false,
      recurrence,
    };

    this.scheduledMessages.set(id, scheduled);
    this.saveScheduledMessages();

    const label = recurrence ? ` (recurring: ${recurrence.type})` : '';
    console.log(`[SCHEDULER] Scheduled message ${id} for ${scheduledTime.toISOString()}${label}`);
    return scheduled;
  }

  cancelMessage(id: string): boolean {
    const deleted = this.scheduledMessages.delete(id);
    if (deleted) {
      this.saveScheduledMessages();
      console.log(`[SCHEDULER] Cancelled message ${id}`);
    }
    return deleted;
  }

  listScheduledMessages(userId: string): ScheduledMessage[] {
    return Array.from(this.scheduledMessages.values())
      .filter(msg => msg.userId === userId && !msg.executed)
      .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
  }

  /**
   * Check for due messages and send them. Recurring messages get rescheduled.
   */
  private async checkAndSendMessages() {
    if (!this.discordClient) return;

    const now = new Date();
    const messagesToSend: ScheduledMessage[] = [];

    for (const msg of Array.from(this.scheduledMessages.values())) {
      if (msg.executed) continue;
      if (new Date(msg.scheduledTime) <= now) {
        messagesToSend.push(msg);
      }
    }

    for (const msg of messagesToSend) {
      try {
        await this.sendScheduledMessage(msg);

        if (msg.recurrence) {
          // Recurring: compute next occurrence and update scheduledTime
          const nextTime = this.computeNextOccurrence(new Date(msg.scheduledTime), msg.recurrence);
          if (nextTime) {
            msg.scheduledTime = nextTime.toISOString();
            // Don't mark as executed — it'll fire again
            this.scheduledMessages.set(msg.id, msg);
            console.log(`[SCHEDULER] Recurring message ${msg.id} rescheduled for ${nextTime.toISOString()}`);
          } else {
            msg.executed = true;
            this.scheduledMessages.set(msg.id, msg);
          }
        } else {
          // One-shot: mark as executed
          msg.executed = true;
          this.scheduledMessages.set(msg.id, msg);
        }

        console.log(`[SCHEDULER] Sent scheduled message ${msg.id}`);
      } catch (error) {
        const fails = (msg.failCount || 0) + 1;
        msg.failCount = fails;
        if (fails >= 3) {
          msg.executed = true;
          console.error(`[SCHEDULER] Message ${msg.id} failed ${fails} times, auto-cancelling (channel may be deleted)`);
        } else {
          console.error(`[SCHEDULER] Failed to send message ${msg.id} (attempt ${fails}/3):`, error);
        }
        this.scheduledMessages.set(msg.id, msg);
      }
    }

    if (messagesToSend.length > 0) {
      this.saveScheduledMessages();
      this.cleanupOldMessages();
    }
  }

  /**
   * Compute the next occurrence for a recurring message.
   * All date math is done in Chicago timezone to avoid off-by-one day issues.
   */
  private computeNextOccurrence(lastTime: Date, recurrence: RecurrencePattern): Date | null {
    // Convert to Chicago wall-clock, do the math there, convert back
    const toChicago = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const chicagoOffset = (d: Date) => toChicago(d).getTime() - d.getTime();

    const offset = chicagoOffset(lastTime);
    // chicagoLocal is a Date whose .getHours()/.getDay() etc reflect Chicago wall-clock
    const chicagoLocal = new Date(lastTime.getTime() + offset);

    switch (recurrence.type) {
      case 'daily':
        chicagoLocal.setDate(chicagoLocal.getDate() + 1);
        return new Date(chicagoLocal.getTime() - offset);

      case 'weekdays': {
        do {
          chicagoLocal.setDate(chicagoLocal.getDate() + 1);
        } while (chicagoLocal.getDay() === 0 || chicagoLocal.getDay() === 6);
        return new Date(chicagoLocal.getTime() - offset);
      }

      case 'weekly': {
        if (!recurrence.daysOfWeek || recurrence.daysOfWeek.length === 0) {
          chicagoLocal.setDate(chicagoLocal.getDate() + 7);
          return new Date(chicagoLocal.getTime() - offset);
        }
        const sortedDays = [...recurrence.daysOfWeek].sort((a, b) => a - b);
        const currentDay = chicagoLocal.getDay();
        const laterThisWeek = sortedDays.find(d => d > currentDay);
        if (laterThisWeek !== undefined) {
          chicagoLocal.setDate(chicagoLocal.getDate() + (laterThisWeek - currentDay));
        } else {
          const daysUntilNext = 7 - currentDay + sortedDays[0];
          chicagoLocal.setDate(chicagoLocal.getDate() + daysUntilNext);
        }
        return new Date(chicagoLocal.getTime() - offset);
      }

      case 'custom': {
        if (!recurrence.intervalMs || recurrence.intervalMs <= 0) return null;
        return new Date(lastTime.getTime() + recurrence.intervalMs);
      }

      default:
        return null;
    }
  }

  private async sendScheduledMessage(msg: ScheduledMessage) {
    if (!this.discordClient) throw new Error('Discord client not set');

    const channel = await this.discordClient.channels.fetch(msg.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not text-based');
    }
    await (channel as TextChannel).send(msg.message);
  }

  private cleanupOldMessages() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, msg] of Array.from(this.scheduledMessages.entries())) {
      if (msg.executed && new Date(msg.created) < sevenDaysAgo) {
        this.scheduledMessages.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[SCHEDULER] Cleaned up ${cleaned} old messages`);
      this.saveScheduledMessages();
    }
  }

  /**
   * Sync load on startup only — before the event loop is running.
   */
  private loadScheduledMessagesSync() {
    try {
      if (fsSync.existsSync(this.storageFile)) {
        const data = fsSync.readFileSync(this.storageFile, 'utf-8');
        const messages: ScheduledMessage[] = JSON.parse(data);
        this.scheduledMessages = new Map(messages.map(msg => [msg.id, msg]));
        console.log(`[SCHEDULER] Loaded ${messages.length} scheduled messages`);
      }
    } catch (error) {
      console.error('[SCHEDULER] Error loading scheduled messages:', error);
    }
  }

  /**
   * Async save with atomic write (temp file + rename) and retry for Windows file locking.
   */
  private async saveScheduledMessages() {
    if (this.saving) return; // Skip if already saving
    this.saving = true;

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const dir = path.dirname(this.storageFile);
        await fs.mkdir(dir, { recursive: true });

        const messages = Array.from(this.scheduledMessages.values());
        const tmpFile = this.storageFile + '.tmp';
        await fs.writeFile(tmpFile, JSON.stringify(messages, null, 2), 'utf-8');
        await fs.rename(tmpFile, this.storageFile);
        this.saving = false;
        return;
      } catch (error: unknown) {
        // Retry on EBUSY/EPERM (Windows file locking)
        const nodeErr = error as NodeJS.ErrnoException;
        if (attempt < maxRetries - 1 && (nodeErr.code === 'EBUSY' || nodeErr.code === 'EPERM')) {
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }
        console.error('[SCHEDULER] Error saving scheduled messages:', error);
      }
    }
    this.saving = false;
  }
}

// Singleton instance
let schedulerInstance: DiscordScheduler | null = null;

export function getScheduler(): DiscordScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new DiscordScheduler();
  }
  return schedulerInstance;
}
