import { NextResponse } from 'next/server';

/**
 * Auth route - DEPRECATED
 * Authentication is now handled entirely by Clerk middleware.
 * This route exists only to return a helpful message if something hits it.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This auth endpoint is deprecated. Authentication is handled by Clerk.' },
    { status: 410 }
  );
}
