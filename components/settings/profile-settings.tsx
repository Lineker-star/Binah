'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvatarPicker } from '@/components/avatar-picker';
import { AVATAR_OPTIONS } from '@/lib/store/user-profile';
import { useI18n } from '@/lib/hooks/use-i18n';
import { supportedLocales, type Locale } from '@/lib/i18n';
import {
  fetchOwnProfile,
  updateOwnProfile,
  USER_ROLES,
  type Profile,
  type UserRole,
} from '@/lib/supabase/profile';
import {
  fetchOwnRoleRequest,
  submitRoleRequest,
  type RoleRequest,
} from '@/lib/supabase/role-requests';
import { createLogger } from '@/lib/logger';

const log = createLogger('ProfileSettings');

/** `AVATAR_OPTIONS[0]` when the stored `avatar_url` isn't one the picker recognizes. */
function pickerValue(avatarUrl: string | null): string {
  if (avatarUrl && (AVATAR_OPTIONS as readonly string[]).includes(avatarUrl)) return avatarUrl;
  if (avatarUrl?.startsWith('data:')) return avatarUrl;
  return AVATAR_OPTIONS[0];
}

const ROLE_LABEL_KEY: Record<UserRole, string> = {
  learner: 'settings.profile.roleLearner',
  parent: 'settings.profile.roleParent',
  admin: 'settings.profile.roleAdmin',
};

export function ProfileSettings() {
  const { t, setLocale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  // Draft fields — only committed to Supabase on Save.
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string>(AVATAR_OPTIONS[0]);
  const [locale, setLocaleDraft] = useState<Locale>('en-US');
  const [role, setRoleDraft] = useState<UserRole>('learner');

  // A learner's own most recent role request (AA.2) — null once approved,
  // since profile.role itself then reads 'parent' and this branch of the UI
  // no longer renders at all.
  const [roleRequest, setRoleRequest] = useState<RoleRequest | null>(null);
  const [requestingRole, setRequestingRole] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchOwnProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        if (p) {
          setDisplayName(p.display_name ?? '');
          setAvatarUrl(pickerValue(p.avatar_url));
          setLocaleDraft(p.locale as Locale);
          setRoleDraft(p.role);
          if (p.role === 'learner') {
            fetchOwnRoleRequest()
              .then((r) => {
                if (!cancelled) setRoleRequest(r);
              })
              .catch((error) => log.warn('Failed to load role request status:', error));
          }
        }
      })
      .catch((error) => {
        log.error('Failed to load profile:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRequestRole = async () => {
    setRequestingRole(true);
    try {
      const request = await submitRoleRequest();
      setRoleRequest(request);
      toast.success(t('settings.profile.roleRequestSubmitted'));
    } catch (error) {
      log.error('Failed to submit role request:', error);
      toast.error(t('settings.profile.roleRequestFailed'));
    } finally {
      setRequestingRole(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const localeChanged = locale !== profile.locale;
      const updated = await updateOwnProfile(profile.id, {
        display_name: displayName.trim() || null,
        avatar_url: avatarUrl,
        locale,
        // Only an admin gets the role selector (see the read-only branch
        // below), so only admins include `role` in the patch at all — the
        // profiles_guard_role trigger would reject a real change from anyone
        // else, but there's no reason to rely on that here when the field
        // simply isn't editable for a non-admin in the first place.
        ...(profile.role === 'admin' ? { role } : {}),
      });
      setProfile(updated);
      // Keep the app's active UI locale and the stored profile locale as one
      // setting: changing it here must not leave the two able to drift.
      if (localeChanged) setLocale(locale);
      toast.success(t('settings.profile.saved'));
    } catch (error) {
      log.error('Failed to update profile:', error);
      toast.error(t('settings.profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('settings.profile.loading')}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
        <UserIcon className="h-6 w-6" />
        {t('settings.profile.notSignedIn')}
        <Link href="/auth" className="text-violet-600 dark:text-violet-400 hover:underline">
          {t('settings.signInLink')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-md">
      <div className="flex flex-col gap-2">
        <Label>{t('settings.profile.avatarLabel')}</Label>
        <AvatarPicker value={avatarUrl} onChange={setAvatarUrl} swatchSizeClassName="size-9" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-display-name">{t('settings.profile.displayNameLabel')}</Label>
        <Input
          id="profile-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('settings.profile.displayNamePlaceholder')}
          maxLength={80}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-locale">{t('settings.profile.localeLabel')}</Label>
        <Select value={locale} onValueChange={(v) => setLocaleDraft(v as Locale)}>
          <SelectTrigger id="profile-locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportedLocales.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-role">{t('settings.profile.roleLabel')}</Label>
        {profile.role === 'admin' ? (
          <Select value={role} onValueChange={(v) => setRoleDraft(v as UserRole)}>
            <SelectTrigger id="profile-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(ROLE_LABEL_KEY[r])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div id="profile-role" className="flex flex-col gap-2">
            <div className="text-sm text-muted-foreground py-1.5">
              {t(ROLE_LABEL_KEY[profile.role])}
            </div>
            {profile.role === 'learner' &&
              (roleRequest?.status === 'pending' ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.profile.roleRequestPending')}
                </p>
              ) : (
                <div className="flex flex-col items-start gap-1.5">
                  {roleRequest?.status === 'rejected' && (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.profile.roleRequestRejected')}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRequestRole}
                    disabled={requestingRole}
                  >
                    {requestingRole && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    {t('settings.profile.requestParentAccount')}
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void createClient()
              .auth.signOut()
              .then(() => setProfile(null));
          }}
        >
          {t('settings.signOut')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          {t('settings.save')}
        </Button>
      </div>
    </div>
  );
}
