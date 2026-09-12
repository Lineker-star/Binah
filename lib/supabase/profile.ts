import { createClient } from './client';

export const USER_ROLES = ['learner', 'parent', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Row shape of `public.profiles`. */
export interface Profile {
  id: string;
  role: UserRole;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  date_of_birth: string | null;
  /**
   * Soft-suspended, not deleted — none of the account's sessions/
   * assessments/certificates are touched. Display mirror only; the real
   * enforcement is Supabase Auth's own ban (auth.users.banned_until, set
   * via the Admin API in app/api/admin/suspend-account/route.ts), which the
   * existing global middleware auth gate already rejects on its next
   * getUser() call with zero extra code of its own.
   */
  suspended: boolean;
  created_at: string;
  updated_at: string;
}

/** Editable-by-self fields (everything but `id`/`role`/timestamps). */
export type ProfileUpdate = Partial<
  Pick<Profile, 'display_name' | 'avatar_url' | 'locale' | 'date_of_birth'>
>;

/** Fields an admin may additionally change on their own row. */
export type ProfileAdminUpdate = ProfileUpdate & Partial<Pick<Profile, 'role'>>;

/**
 * Fetch the signed-in user's own profile row. Returns `null` when there is
 * no session — callers render a "sign in" state rather than treating this
 * as an error.
 */
export async function fetchOwnProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data as Profile;
}

/**
 * Update the signed-in user's own profile row. RLS (`profiles_update_own`)
 * already restricts this to `auth.uid() = id`, and the `profiles_guard_role`
 * trigger blocks a non-admin from changing `role` even if a caller passes it
 * — this type-level split just keeps that boundary visible in the UI code.
 */
export async function updateOwnProfile(
  userId: string,
  patch: ProfileUpdate | ProfileAdminUpdate,
): Promise<Profile> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}
