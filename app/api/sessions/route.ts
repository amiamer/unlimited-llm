import { NextResponse } from 'next/server';
import { localStorageService } from '@/lib/local-storage';

/**
 * Sessions API - List all chat sessions
 * GET /api/sessions - Retrieve all sessions from local storage
 */

interface SessionMetadata {
  sessionId: string;
  title: string;
  lastActivity: string;
  messageCount: number;
}

export async function GET() {
  try {
    const service = localStorageService();
    
    // Get all conversations from local storage
    const conversations = await service.getAllConversations();
    
    // Map to session metadata format
    const sessions: SessionMetadata[] = conversations.map(conv => ({
      sessionId: conv.sessionId,
      title: conv.preview || 'Untitled Session',
      lastActivity: conv.endTime,
      messageCount: conv.messageCount,
    }));

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('GET /api/sessions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to retrieve sessions: ${errorMessage}` },
      { status: 500 }
    );
  }
}
