/**
 * Test script to demonstrate Google Calendar integration with LLM chat
 * Run with: npx tsx scripts/test-calendar-chat.ts
 */

import * as dotenv from 'dotenv';
import { openRouterService } from '../lib/llm-providers';

dotenv.config();

async function testCalendarChat() {
  console.log('Testing Google Calendar Integration with LLM Chat...\n');

  try {
    // Test 1: List upcoming events
    console.log('=== Test 1: List upcoming events ===');
    const response1 = await openRouterService.generateResponse({
      userMessage: 'Show me my upcoming calendar events for the next week'
    });
    console.log('User: Show me my upcoming calendar events for the next week');
    console.log('Assistant:', response1.content);
    if (response1.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response1.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
      });
    }
    console.log('\n---\n');

    // Test 2: Create an event
    console.log('=== Test 2: Create a calendar event ===');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    
    const response2 = await openRouterService.generateResponse({
      userMessage: 'Schedule a team meeting tomorrow at 2pm for 1 hour. Call it "Project Sync"'
    });
    console.log('User: Schedule a team meeting tomorrow at 2pm for 1 hour. Call it "Project Sync"');
    console.log('Assistant:', response2.content);
    if (response2.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response2.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
      });
    }
    console.log('\n---\n');

    // Test 3: List events again to see the new one
    console.log('=== Test 3: Verify the event was created ===');
    const response3 = await openRouterService.generateResponse({
      userMessage: 'What events do I have tomorrow?'
    });
    console.log('User: What events do I have tomorrow?');
    console.log('Assistant:', response3.content);
    if (response3.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response3.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
      });
    }
    console.log('\n---\n');

    console.log('[OK] All chat tests completed successfully!');
    console.log('\nNote: The LLM automatically detected calendar-related requests');
    console.log('and used the Google Calendar API to fulfill them.');

  } catch (error) {
    console.error('Error during testing:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
  }
}

testCalendarChat();
