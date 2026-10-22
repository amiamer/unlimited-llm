/**
 * Test script to verify full conversation context is working
 * Simulates the frontend sending session messages to the API
 */

import { ChatRequest, Message } from '../lib/types';

async function testConversationContext() {
  console.log('Testing Full Conversation Context...\n');

  try {
    // Simulate a conversation flow
    const baseUrl = 'http://localhost:3000'; // Adjust if needed
    
    // First message: "I have 17 bananas"
    console.log('1. Sending first message: "I have 17 bananas in my pocket"');
    const firstRequest: ChatRequest = {
      message: 'I have 17 bananas in my pocket',
      sessionMessages: [] // Empty for first message
    };

    const firstResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firstRequest)
    });

    if (!firstResponse.ok) {
      throw new Error(`First request failed: ${firstResponse.statusText}`);
    }

    const firstResult = await firstResponse.json();
    console.log('[OK] First response received');

    // Simulate the messages that would be in localStorage after first exchange
    const sessionMessages: Message[] = [
      {
        role: 'user',
        content: 'I have 17 bananas in my pocket',
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: firstResult.response,
        timestamp: firstResult.timestamp
      }
    ];

    // Second message: "How many bananas do I have?"
    console.log('\n2. Sending follow-up: "How many bananas do I have?"');
    console.log(`   Including ${sessionMessages.length} previous messages in context`);
    
    const secondRequest: ChatRequest = {
      message: 'How many bananas do I have?',
      sessionMessages: sessionMessages // Include full conversation history
    };

    const secondResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secondRequest)
    });

    if (!secondResponse.ok) {
      throw new Error(`Second request failed: ${secondResponse.statusText}`);
    }

    const secondResult = await secondResponse.json();
    console.log('[OK] Second response received');
    console.log(`Claude's response: "${secondResult.response}"`);

    // Check if Claude mentions the number 17 (indicating it has context)
    const mentionsBananas = secondResult.response.toLowerCase().includes('17') || 
                           secondResult.response.toLowerCase().includes('seventeen');
    
    if (mentionsBananas) {
      console.log('SUCCESS: Claude has access to full conversation context!');
      console.log('   Claude correctly referenced the 17 bananas from earlier in the conversation.');
    } else {
      console.log('[WARN] WARNING: Claude may not have full context access.');
      console.log('   Response doesn\'t mention the specific number of bananas.');
    }

    console.log('\nTest Summary:');
    console.log(`   First message: "${firstRequest.message}"`);
    console.log(`   First response: "${firstResult.response}"`);
    console.log(`   Second message: "${secondRequest.message}"`);
    console.log(`   Second response: "${secondResult.response}"`);
    console.log(`   Context messages sent: ${sessionMessages.length}`);

  } catch (error) {
    console.error('[ERROR] Conversation context test failed:', error);
    console.log('\nMake sure your development server is running on localhost:3000');
    console.log('   Run: npm run dev');
  }
}

// Export for potential use in other tests
export { testConversationContext };

// Run if called directly
if (require.main === module) {
  testConversationContext();
}