import { NextRequest, NextResponse } from 'next/server';
import { openRouterService } from '@/lib/llm-providers';
import { ChatRequest, ChatResponse } from '@/lib/types';

/**
 * Simple Chat API endpoint without Knowledge Base
 * POST /api/chat-simple
 * 
 * This bypasses the Knowledge Base and calls the default model directly
 */
export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    
    if (!body.message || body.message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    const userMessage = body.message.trim();

    // Call the default model without Knowledge Base context
    const llmResponse = await openRouterService.generateResponse({ userMessage });

    const response: ChatResponse = {
      response: llmResponse.content,
      timestamp: llmResponse.timestamp,
      sessionId: 'simple-chat', // Simple chat doesn't use sessions
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Simple chat API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { error: `Chat failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}