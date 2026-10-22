/**
 * Test script to verify LLM receives correct date/time context for calendar operations
 * Run with: npx tsx scripts/test-calendar-with-dates.ts
 */

import * as dotenv from 'dotenv';
import { openRouterService } from '../lib/llm-providers';

dotenv.config();

async function testCalendarWithDates() {
  console.log('Testing Calendar Integration with Date/Time Context...\n');
  
  const now = new Date();
  console.log('Current Date/Time:', now.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  }));
  console.log('ISO Format:', now.toISOString());
  console.log('Timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('\n---\n');

  try {
    // Test 1: Ask about today's events
    console.log('=== Test 1: What events do I have today? ===');
    const response1 = await openRouterService.generateResponse({
      userMessage: 'What events do I have today?'
    });
    console.log('User: What events do I have today?');
    console.log('Assistant:', response1.content);
    if (response1.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response1.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
        console.log(`  Result preview: ${call.result.substring(0, 200)}...`);
      });
    }
    console.log('\n---\n');

    // Test 2: Ask about tomorrow's events
    console.log('=== Test 2: What do I have scheduled for tomorrow? ===');
    const response2 = await openRouterService.generateResponse({
      userMessage: 'What do I have scheduled for tomorrow?'
    });
    console.log('User: What do I have scheduled for tomorrow?');
    console.log('Assistant:', response2.content);
    if (response2.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response2.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
        console.log(`  Result preview: ${call.result.substring(0, 200)}...`);
      });
    }
    console.log('\n---\n');

    // Test 3: Schedule something for tomorrow
    console.log('=== Test 3: Schedule a test meeting tomorrow at 3pm ===');
    const response3 = await openRouterService.generateResponse({
      userMessage: 'Schedule a test meeting tomorrow at 3pm for 30 minutes'
    });
    console.log('User: Schedule a test meeting tomorrow at 3pm for 30 minutes');
    console.log('Assistant:', response3.content);
    if (response3.googleCalendarCalls) {
      console.log('\nCalendar API Calls:');
      response3.googleCalendarCalls.forEach(call => {
        console.log(`- ${call.action}`);
        console.log(`  Result: ${call.result}`);
      });
    }
    console.log('\n---\n');

    console.log('✓ Date/time context tests completed!');
    console.log('\nThe LLM now receives:');
    console.log('- Current date and time');
    console.log('- Timezone information');
    console.log('- Context for "today" and "tomorrow"');
    console.log('- ISO 8601 format examples');

  } catch (error) {
    console.error('Error during testing:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
  }
}

testCalendarWithDates();
