'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createClient } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger';

const log = createLogger('Auth');

type Mode = 'sign-in' | 'sign-up';
type SignupRole = 'learner' | 'parent';

export default function AuthPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<SignupRole>('learner');
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const routeByRole = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('profiles').select('role').single();
    router.push(data?.role === 'parent' ? '/parent' : '/');
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
          options: { data: { display_name: displayName.trim() || undefined, role } },
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

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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

          {mode === 'sign-up' && (
            <div className="flex flex-col gap-2">
              <Label>{t('auth.roleLabel')}</Label>
              <div className="flex gap-2">
                {(['learner', 'parent'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2 text-sm transition-colors',
                      role === r
                        ? 'border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-foreground'
                        : 'border-border/60 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {r === 'learner' ? t('auth.roleLearner') : t('auth.roleParent')}
                  </button>
                ))}
              </div>
            </div>
          )}

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
