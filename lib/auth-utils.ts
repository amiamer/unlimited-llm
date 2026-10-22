import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Get the authenticated user's ID from Clerk session
 * Returns the user ID or an error response if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<{ userId: string } | { error: NextResponse }> {
  const { userId } = await auth();
  
  if (!userId) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized', message: 'You must be signed in to access this resource' },
        { status: 401 }
      ),
    };
  }
  
  return { userId };
}

/**
 * Check if the authenticated user's email is in the allowlist
 */
export async function checkEmailAllowlist(): Promise<{ allowed: boolean; email?: string }> {
  const { sessionClaims } = await auth();
  const userEmail = sessionClaims?.email as string | undefined;
  
  const allowedEmails = process.env.ALLOWED_EMAILS?.split(',').map(email => email.trim()) || [];
  
  if (!userEmail || !allowedEmails.includes(userEmail)) {
    return { allowed: false, email: userEmail };
  }
  
  return { allowed: true, email: userEmail };
}
