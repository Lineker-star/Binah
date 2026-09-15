/**
 * GET /auth/callback — the PKCE redirect target for OAuth sign-in
 * (`supabase.auth.signInWithOAuth`). Google redirects here with a `code`
 * query param after the user approves; this route exchanges it for a
 * session (setting the auth cookies) and sends the browser on into the app.
 *
 * Public by construction — middleware.ts's isPublicPath already exempts
 * every `/auth/*` path from the sign-in gate, which this route needs since
 * no session exists yet when it runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthCallback');

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Only a same-origin relative path — never an absolute or protocol-
  // relative URL — since this value round-trips through Google and is
  // fully client-controlled up to that point. Mirrors the same guard on
  // the /auth page's own `returnTo` handling.
  const returnToParam = searchParams.get('returnTo');
  const returnTo =
    returnToParam && returnToParam.startsWith('/') && !returnToParam.startsWith('//')
      ? returnToParam
      : null;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (returnTo) return NextResponse.redirect(`${origin}${returnTo}`);

      // No returnTo — land a parent on their dashboard, everyone else in
      // the app, matching the password sign-in path's routeByRole.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('role').single();
        return NextResponse.redirect(`${origin}${profile?.role === 'parent' ? '/parent' : '/app'}`);
      }
      return NextResponse.redirect(`${origin}/app`);
    }
    log.warn('Failed to exchange OAuth code for a session:', error);
  }

  return NextResponse.redirect(`${origin}/auth?error=oauth`);
}
