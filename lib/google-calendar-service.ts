import { google, calendar_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';

// Default calendar to operate on. Configurable via env; 'primary' is the
// authenticated account's own calendar, so it works for any user without
// hardcoding a specific address.
const DEFAULT_CALENDAR_ID = process.env.DEFAULT_CALENDAR_ID || 'primary';

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{ email: string }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
}

export interface CalendarEventQuery {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  q?: string;
}

class GoogleCalendarService {
  private calendar: calendar_v3.Calendar | null = null;
  private auth: JWT | null = null;

  private async getAuth(): Promise<JWT> {
    if (this.auth) {
      return this.auth;
    }

    const keyPath = process.env.GCAL_SERVICE_ACCOUNT_KEY_PATH;
    if (!keyPath) {
      throw new Error('GCAL_SERVICE_ACCOUNT_KEY_PATH environment variable is required');
    }

    // Remove quotes if present
    const cleanPath = keyPath.replace(/^["']|["']$/g, '');

    if (!fs.existsSync(cleanPath)) {
      throw new Error(`Service account key file not found at: ${cleanPath}`);
    }

    const keyFile = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));

    this.auth = new google.auth.JWT({
      email: keyFile.client_email,
      key: keyFile.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    return this.auth;
  }

  private async getCalendar(): Promise<calendar_v3.Calendar> {
    if (this.calendar) {
      return this.calendar;
    }

    const auth = await this.getAuth();
    this.calendar = google.calendar({ version: 'v3', auth });
    return this.calendar;
  }

  /**
   * List events from the calendar
   */
  async listEvents(
    calendarId: string = DEFAULT_CALENDAR_ID,
    query?: CalendarEventQuery
  ): Promise<calendar_v3.Schema$Event[]> {
    try {
      const calendar = await this.getCalendar();
      
      const response = await calendar.events.list({
        calendarId,
        timeMin: query?.timeMin || new Date().toISOString(),
        timeMax: query?.timeMax,
        maxResults: query?.maxResults || 10,
        singleEvents: true,
        orderBy: 'startTime',
        q: query?.q,
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error listing calendar events:', error);
      throw new Error(`Failed to list events: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific event by ID
   */
  async getEvent(
    eventId: string,
    calendarId: string = DEFAULT_CALENDAR_ID
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const calendar = await this.getCalendar();
      
      const response = await calendar.events.get({
        calendarId,
        eventId,
      });

      return response.data;
    } catch (error) {
      console.error('Error getting calendar event:', error);
      throw new Error(`Failed to get event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a new calendar event
   */
  async createEvent(
    event: CalendarEvent,
    calendarId: string = DEFAULT_CALENDAR_ID
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const calendar = await this.getCalendar();
      
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event as calendar_v3.Schema$Event,
      });

      return response.data;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw new Error(`Failed to create event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update an existing calendar event
   */
  async updateEvent(
    eventId: string,
    event: Partial<CalendarEvent>,
    calendarId: string = DEFAULT_CALENDAR_ID
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const calendar = await this.getCalendar();
      
      const response = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: event as calendar_v3.Schema$Event,
      });

      return response.data;
    } catch (error) {
      console.error('Error updating calendar event:', error);
      throw new Error(`Failed to update event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(
    eventId: string,
    calendarId: string = DEFAULT_CALENDAR_ID
  ): Promise<void> {
    try {
      const calendar = await this.getCalendar();
      
      await calendar.events.delete({
        calendarId,
        eventId,
      });
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw new Error(`Failed to delete event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all calendars
   */
  async listCalendars(): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    try {
      const calendar = await this.getCalendar();
      
      const response = await calendar.calendarList.list();
      return response.data.items || [];
    } catch (error) {
      console.error('Error listing calendars:', error);
      throw new Error(`Failed to list calendars: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Test the connection to Google Calendar API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listCalendars();
      return true;
    } catch (error) {
      console.error('Google Calendar connection test failed:', error);
      return false;
    }
  }
}

// Singleton instance
let _calendarService: GoogleCalendarService | null = null;

export const googleCalendarService = {
  getInstance(): GoogleCalendarService {
    if (!_calendarService) {
      _calendarService = new GoogleCalendarService();
    }
    return _calendarService;
  },

  async listEvents(calendarId?: string, query?: CalendarEventQuery) {
    return this.getInstance().listEvents(calendarId, query);
  },

  async getEvent(eventId: string, calendarId?: string) {
    return this.getInstance().getEvent(eventId, calendarId);
  },

  async createEvent(event: CalendarEvent, calendarId?: string) {
    return this.getInstance().createEvent(event, calendarId);
  },

  async updateEvent(eventId: string, event: Partial<CalendarEvent>, calendarId?: string) {
    return this.getInstance().updateEvent(eventId, event, calendarId);
  },

  async deleteEvent(eventId: string, calendarId?: string) {
    return this.getInstance().deleteEvent(eventId, calendarId);
  },

  async listCalendars() {
    return this.getInstance().listCalendars();
  },

  async testConnection() {
    return this.getInstance().testConnection();
  }
};

export { GoogleCalendarService };
