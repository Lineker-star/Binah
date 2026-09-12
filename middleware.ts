import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { apiError } from '@/lib/server/api-response';

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  // Constant-length comparison (not truly constant-time in JS, but sufficient here)
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// Deployment-wide access-code endpoints and the health probe — exempt from
// both gates below, not just the sign-in one, since they must work before
// any visitor identity (access-code or Supabase session) exists at all.
const ACCESS_CODE_EXEMPT_PATHS = ['/api/access-code/', '/api/health'];

/**
 * Paths that stay reachable by a signed-out visitor now that the rest of the
 * app requires sign-in for any feature access. Kept to an explicit,
 * enumerated list rather than a broad prefix so a new route defaults to
 * gated — the safer failure mode.
 */
function isPublicPath(pathname: string): boolean {
  if (ACCESS_CODE_EXEMPT_PATHS.some((p) => pathname.startsWith(p))) return true;
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

  // Deployment-wide access-code gate — orthogonal to per-user sign-in below.
  // Unlike the sign-in gate, a page request that fails this one is let
  // through unchanged (not redirected) so the existing AccessCodeGuard
  // client-side modal can prompt for the code; redirecting to /auth here
  // would just show that same modal on a different page for no benefit,
  // and would skip the code prompt entirely for a codeless deployment.
  const accessCode = process.env.ACCESS_CODE;
  const accessCodeExempt = ACCESS_CODE_EXEMPT_PATHS.some((p) => pathname.startsWith(p));
  if (accessCode && !accessCodeExempt) {
    const cookie = request.cookies.get('openmaic_access');
    const verified = !!cookie?.value && (await verifyToken(cookie.value, accessCode));
    if (!verified) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
          { status: 401 },
        );
      }
      return NextResponse.next();
    }
  }

  // Per-user sign-in gate — the whole app requires a signed-in learner now,
  // not just session creation. Runs after the access-code gate (if
  // configured) has already been satisfied for this request.
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
