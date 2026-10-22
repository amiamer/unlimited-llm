import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/discord(.*)',
]);

// Email allowlist - only these emails can access the application
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS?.split(',').map(email => email.trim()) || [];

// In-memory cache: userId -> { email, expiresAt }
const emailCache = new Map<string, { email: string; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default clerkMiddleware(async (auth, request) => {
  // Allow public routes
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // The Discord bot runs as a headless process and can't do Clerk browser auth,
  // so it authenticates to the shared session store with the bot API key. Scoped
  // strictly to /api/sessions (same shared-secret trust level as /api/discord/*).
  const botKey = request.headers.get('x-discord-bot-key');
  const expectedBotKey = process.env.DISCORD_BOT_API_KEY;
  if (botKey && expectedBotKey && botKey === expectedBotKey) {
    const p = request.nextUrl.pathname;
    if (p === '/api/sessions' || p.startsWith('/api/sessions/')) {
      return NextResponse.next();
    }
  }

  // Get the user's session
  const { userId, sessionClaims } = await auth();

  // If not authenticated, redirect to sign-in
  if (!userId) {
    // Behind a proxy or tunnel, request.url carries the server's bind address
    // (localhost:3000); rebuild the public origin from the forwarded headers.
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    // The server's nginx sets x-forwarded-proto to http (Next 14 proxies internal
    // rewrites to that scheme) and passes the browser's real scheme as x-original-proto.
    const proto = request.headers.get('x-original-proto') || request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    const origin = host ? `${proto}://${host}` : request.nextUrl.origin;
    const signInUrl = new URL('/sign-in', origin);
    signInUrl.searchParams.set('redirect_url', `${origin}${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  // Try to get email from session claims first (zero-cost)
  let userEmail = (sessionClaims?.email as string | undefined)
    || (sessionClaims?.primaryEmail as string | undefined)
    || (sessionClaims?.primary_email_address as string | undefined);

  // If not in claims, check in-memory cache
  if (!userEmail) {
    const cached = emailCache.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      userEmail = cached.email;
    }
  }

  // If still no email, fetch from Clerk API (once per hour per user)
  if (!userEmail) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      userEmail = user.emailAddresses.find(
        email => email.id === user.primaryEmailAddressId
      )?.emailAddress;

      // Cache the result
      if (userEmail) {
        emailCache.set(userId, { email: userEmail, expiresAt: Date.now() + CACHE_TTL_MS });
      }
    } catch (error) {
      console.error('Error fetching user from Clerk:', error);
      return new NextResponse(
        JSON.stringify({
          error: 'Authentication Error',
          message: 'Failed to verify user email.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  if (!userEmail || !ALLOWED_EMAILS.includes(userEmail)) {
    return new NextResponse(
      JSON.stringify({
        error: 'Access Denied',
        message: 'Your email is not authorized to access this application.',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // User is authenticated and authorized
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
