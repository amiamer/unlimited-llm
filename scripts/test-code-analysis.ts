/**
 * Test script for code analysis webhook
 * Run with: npx tsx scripts/test-code-analysis.ts
 */

import { codeAnalysisService } from '../lib/code-analysis';

async function testCodeAnalysis() {
  console.log('Testing Code Analysis Webhook...\n');

  const testQuestions = [
    'What are the main features of this application?',
    'How is authentication implemented?',
    'What are the main API endpoints?'
  ];

  for (const question of testQuestions) {
    console.log(`\nQuestion: ${question}`);
    console.log('Sending to webhook...');

    try {
      const result = await codeAnalysisService.analyzeCode(question);
      
      console.log('[OK] Success!');
      console.log(`Timestamp: ${result.timestamp}`);
      console.log(`Answer (first 200 chars):\n${result.answer.substring(0, 200)}...`);
      console.log('─'.repeat(80));
    } catch (error) {
      console.error('[ERROR] Error:', error instanceof Error ? error.message : 'Unknown error');
      console.log('─'.repeat(80));
    }
  }

  console.log('\nTest complete!');
}

// Run the test
testCodeAnalysis().catch(console.error);
