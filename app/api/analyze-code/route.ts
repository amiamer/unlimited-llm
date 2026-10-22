import { NextRequest, NextResponse } from 'next/server';
import { codeAnalysisService } from '@/lib/code-analysis';

/**
 * Code Analysis API endpoint
 * POST /api/analyze-code
 * 
 * Analyzes the local codebase using file system operations
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.question || body.question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question cannot be empty' },
        { status: 400 }
      );
    }

    const result = await codeAnalysisService.analyzeCode(body.question);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Code analysis API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { error: `Code analysis failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
