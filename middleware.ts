import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { apiError } from '@/lib/server/api-response';

/**
 * Paths that stay reachable by a signed-out visitor even though the rest of
 * the app requires sign-in for any feature access. Kept to an explicit,
 * enumerated list rather than a broad prefix so a new route defaults to
 * gated — the safer failure mode.
 */
function isPublicPath(pathname: string): boolean {
  // The public marketing landing page — exact match only, so the
  // authenticated app entry point at /app stays gated by the default below.
  if (pathname === '/') return true;
  // The health probe must work before any visitor identity exists at all.
  if (pathname === '/api/health') return true;
  // The sign-in surface itself, and the two thin redirect-to-/auth stubs.
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
  if (pathname === '/login' || pathname === '/signup') return true;
  // Public certificate verification — explicitly meant to work signed-out,
  // calls a security-definer RPC directly rather than an API route.
  if (pathname.startsWith('/verify/')) return true;
  // /apple-icon.png isn't covered by the matcher's static-asset exclusions
  // (only favicon.ico is) and isn't API-shaped, so the redirect below would
  // otherwise break it for signed-out visitors.
  if (pathname === '/apple-icon.png') return true;
  // The brand mark, rendered directly on the landing page's own header and
  // footer — the one `public/` image a signed-out visitor's browser now
  // requests before any session exists.
  if (pathname === '/binah-mark.png') return true;
  // Fetched unconditionally by a root-layout-mounted component on every
  // page, including /auth itself — must stay public or the sign-in page's
  // own background fetch 401s.
  if (pathname === '/api/server-providers') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Return an actual server-side 404 when either half of the workbench is off.
  // Edge middleware cannot reliably inspect server-only deployment variables,
  // so it enforces the public gate and leaves the complete runtime/database
  // check to Node. A Node-hosted middleware uses the same gate as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Per-user sign-in gate — the whole app requires a signed-in learner now,
  // not just session creation.
  if (!isPublicPath(pathname)) {
    let response = NextResponse.next({ request });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (pathname.startsWith('/api/')) {
        return apiError('UNAUTHENTICATED', 401, 'Sign-in required');
      }
      const redirectUrl = new URL('/auth', request.url);
      redirectUrl.searchParams.set('returnTo', pathname + request.nextUrl.search);
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
