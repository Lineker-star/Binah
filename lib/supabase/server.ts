import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Route Handlers and Server Components.
 *
 * Create a fresh instance per request — never share one across requests.
 * `setAll` can throw when called from a Server Component (cookies are
 * read-only there); that's expected and safe to swallow as long as
 * middleware is refreshing the session on every request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session on the request/response instead.
          }
        },
      },
    },
  );
}
