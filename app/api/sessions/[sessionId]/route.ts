import { NextRequest, NextResponse } from 'next/server';
import { localStorageService } from '@/lib/local-storage';

/**
 * Session-specific API endpoints
 * GET /api/sessions/[sessionId] - Get session messages
 * PUT /api/sessions/[sessionId] - Save/update session
 * DELETE /api/sessions/[sessionId] - Delete session
 */

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const service = localStorageService();
    const conversation = await service.getConversation(sessionId);

    if (!conversation) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      sessionId: conversation.sessionId,
      messages: conversation.messages || [],
      title: conversation.preview || 'Untitled Session',
      lastActivity: conversation.endTime,
      summary: conversation.summary || null,
    });
  } catch (error: unknown) {
    console.error('GET /api/sessions/[sessionId] error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to retrieve session: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const messages = body.messages;
    const title = body.title || 'Untitled Session';
    const summary = typeof body.summary === 'string' ? body.summary : undefined;

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'messages must be an array' },
        { status: 400 }
      );
    }

    const service = localStorageService();
    await service.storeSession(sessionId, messages, title, summary);

    return NextResponse.json({
      message: 'Session saved successfully',
      sessionId,
      messageCount: messages.length,
    });
  } catch (error) {
    console.error('PUT /api/sessions/[sessionId] error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to save session: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const service = localStorageService();
    const deletedCount = await service.deleteConversation(sessionId);

    return NextResponse.json({
      message: 'Session deleted successfully',
      sessionId,
      filesDeleted: deletedCount,
    });
  } catch (error) {
    console.error('DELETE /api/sessions/[sessionId] error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to delete session: ${errorMessage}` },
      { status: 500 }
    );
  }
}
