import { NextRequest, NextResponse } from 'next/server';
import { googleCalendarService, type CalendarEvent } from '@/lib/google-calendar-service';

export async function GET() {
  try {
    const now = new Date();
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await googleCalendarService.listEvents(undefined, {
      timeMin: now.toISOString(),
      timeMax: sevenDaysLater.toISOString(),
      maxResults: 50,
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Calendar widget error:', error);
    return NextResponse.json(
      { error: 'Calendar not connected', events: [] },
      { status: 200 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { summary, startDateTime, endDateTime, description } = body;

    if (!summary || !startDateTime) {
      return NextResponse.json({ error: 'Title and start time are required' }, { status: 400 });
    }

    const event: CalendarEvent = {
      summary,
      description: description || undefined,
      start: { dateTime: startDateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: {
        dateTime: endDateTime || new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    const created = await googleCalendarService.createEvent(event);
    return NextResponse.json({ event: created });
  } catch (error) {
    console.error('Calendar create error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
