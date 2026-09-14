'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createClient } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('Auth');

type Mode = 'sign-in' | 'sign-up';

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.64v3h3.89c2.28-2.1 3.55-5.2 3.55-8.83Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.89-3c-1.08.73-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.31A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.38-2.31v-3.1H1.27a12 12 0 0 0 0 10.82l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.59l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}

function AuthPageContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const routeByRole = async () => {
    // A returnTo takes priority over the default role-based landing spot —
    // it captures the specific action the visitor was blocked on (e.g. the
    // homepage's "Enter Classroom" gate), which is more correct than always
    // bouncing a parent account to /parent regardless of what they came here
    // to do. Only accept a same-origin relative path — never an absolute or
    // protocol-relative URL — since this value is fully client-controlled.
    const returnTo = searchParams.get('returnTo');
    if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase.from('profiles').select('role').single();
    router.push(data?.role === 'parent' ? '/parent' : '/');
  };

  useEffect(() => {
    if (searchParams.get('error') === 'oauth') {
      toast.error(t('auth.oauthFailed'));
    }
    // Only ever read once on mount — searchParams intentionally omitted so a
    // later mode switch or navigation doesn't re-fire this toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const supabase = createClient();
      // Same-origin-relative guard as routeByRole — this value is
      // client-controlled and round-trips through Google before coming back.
      const returnTo = searchParams.get('returnTo');
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
        callbackUrl.searchParams.set('returnTo', returnTo);
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl.toString() },
      });
      // On success the browser is already navigating to Google; this only
      // returns for a pre-redirect failure (e.g. the provider isn't
      // configured), so this component is still mounted to show it.
      if (error) throw error;
    } catch (err) {
      log.warn('Google sign-in failed:', err);
      toast.error(t('auth.oauthFailed'));
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setCheckEmail(false);
    const supabase = createClient();
    try {
      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Every self-signup is a learner account — parent accounts are no
          // longer self-selectable here (see handle_new_user, which still
          // honors a 'parent' role for any account created some other way).
          options: { data: { display_name: displayName.trim() || undefined, role: 'learner' } },
        });
        if (error) throw error;
        if (data.session) {
          await routeByRole();
        } else {
          // Email confirmation is required before a session exists — the
          // handle_new_user trigger has already created the profile row
          // (it fires on the auth.users insert itself), so once confirmed
          // this account is ready to sign in.
          setCheckEmail(true);
          setMode('sign-in');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await routeByRole();
      }
    } catch (err) {
      log.warn(`${mode} failed:`, err);
      toast.error(mode === 'sign-up' ? t('auth.signUpFailed') : t('auth.signInFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('auth.backToHome')}
        </Link>

        <h1 className="text-lg font-semibold text-foreground">
          {mode === 'sign-up' ? t('auth.signUpTitle') : t('auth.signInTitle')}
        </h1>

        {checkEmail && (
          <p className="mt-3 text-sm text-muted-foreground rounded-xl border border-border/60 p-3">
            {t('auth.checkEmail')}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleSignIn}
          disabled={googleLoading || submitting}
          className="mt-6 gap-2"
        >
          {googleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleLogo className="h-4 w-4" />
          )}
          {t('auth.continueWithGoogle')}
        </Button>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border/60" />
          {t('auth.orDivider')}
          <div className="h-px flex-1 bg-border/60" />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          {mode === 'sign-up' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-display-name">{t('auth.displayNameLabel')}</Label>
              <Input
                id="auth-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.displayNamePlaceholder')}
                maxLength={80}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-email">{t('auth.emailLabel')}</Label>
            <Input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-password">{t('auth.passwordLabel')}</Label>
            <Input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            />
          </div>

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {mode === 'sign-up' ? t('auth.signUpAction') : t('auth.signInAction')}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up');
            setCheckEmail(false);
          }}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {mode === 'sign-up' ? t('auth.switchToSignIn') : t('auth.switchToSignUp')}
        </button>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageContent />
    </Suspense>
  );
}
