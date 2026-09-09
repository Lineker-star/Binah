'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client. Create a fresh instance per component/hook call
 * (matches @supabase/ssr guidance) rather than sharing one module-level
 * singleton across the app.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
