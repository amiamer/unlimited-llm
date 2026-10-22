/**
 * Test script for Google Calendar integration
 * Run with: npx tsx scripts/test-google-calendar.ts
 */

import * as dotenv from 'dotenv';
import { googleCalendarService } from '../lib/google-calendar-service';

dotenv.config();

async function testGoogleCalendar() {
  console.log('Testing Google Calendar Integration...\n');

  try {
    // Test 1: Connection test
    console.log('1. Testing connection...');
    const connected = await googleCalendarService.testConnection();
    if (connected) {
      console.log('[OK] Successfully connected to Google Calendar API\n');
    } else {
      console.log('[FAIL] Failed to connect to Google Calendar API\n');
      return;
    }

    // Test 2: List calendars
    console.log('2. Listing available calendars...');
    const calendars = await googleCalendarService.listCalendars();
    console.log(`Found ${calendars.length} calendar(s):`);
    calendars.forEach(cal => {
      console.log(`  - ${cal.summary} (${cal.id})`);
    });
    console.log();

    // Test 3: List upcoming events
    console.log('3. Listing upcoming events...');
    const events = await googleCalendarService.listEvents('you@example.com', {
      maxResults: 5
    });
    console.log(`Found ${events.length} upcoming event(s):`);
    events.forEach(event => {
      const start = event.start?.dateTime || event.start?.date;
      console.log(`  - ${event.summary} (${start})`);
    });
    console.log();

    // Test 4: Create a test event
    console.log('4. Creating a test event...');
    const now = new Date();
    const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later

    const newEvent = await googleCalendarService.createEvent({
      summary: 'Test Event from LLM Integration',
      description: 'This is a test event created by the Google Calendar integration',
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/New_York'
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/New_York'
      }
    }, 'you@example.com');
    console.log(`[OK] Created event: ${newEvent.summary} (ID: ${newEvent.id})\n`);

    // Test 5: Get the event details
    console.log('5. Getting event details...');
    const eventDetails = await googleCalendarService.getEvent(newEvent.id!, 'you@example.com');
    console.log(`Event: ${eventDetails.summary}`);
    console.log(`Start: ${eventDetails.start?.dateTime}`);
    console.log(`End: ${eventDetails.end?.dateTime}\n`);

    // Test 6: Update the event
    console.log('6. Updating the event...');
    const updatedEvent = await googleCalendarService.updateEvent(newEvent.id!, {
      summary: 'Updated Test Event',
      description: 'This event has been updated'
    }, 'you@example.com');
    console.log(`[OK] Updated event: ${updatedEvent.summary}\n`);

    // Test 7: Delete the event
    console.log('7. Deleting the test event...');
    await googleCalendarService.deleteEvent(newEvent.id!, 'you@example.com');
    console.log(`[OK] Deleted event: ${newEvent.id}\n`);

    console.log('All tests completed successfully! [OK]');

  } catch (error) {
    console.error('Error during testing:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
}

testGoogleCalendar();
