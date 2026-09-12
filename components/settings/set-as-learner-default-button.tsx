'use client';

/**
 * Admin/parent actions rendered inside each of the 6 provider settings
 * panels (LLM/image/video/TTS/ASR/PDF) — deliberately separate from the
 * panel's own "Save" button (per BB.1/BB.3: routine key-testing must not
 * silently become the system-wide learner default, or overwrite a
 * cross-device personal choice, every time someone saves).
 *
 * Two independent targets, both stored in system_settings but scoped
 * disjointly by owner_id (see migration 022):
 *  - "Learner default" (BB.2, admin-only): the single owner_id IS NULL row
 *    every learner falls back to. POSTs to /api/admin/system-settings,
 *    which also merges it into the live server-side provider-config cache.
 *  - "My default" (BB.3, any non-learner — parent or admin): the caller's
 *    own owner_id = auth.uid() row, rehydrated into their local settings
 *    store on load so it follows them across devices. POSTs to
 *    /api/settings/provider-defaults — never touches the shared cache,
 *    since a personal choice is per-caller, not process-wide.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SystemDefaultSection } from '@/lib/server/provider-config';

interface SaveButtonProps {
  section: SystemDefaultSection;
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  extraConfig?: { accessKeyId?: string; accessKeySecret?: string };
  disabled?: boolean;
}

function SaveDefaultButton({
  endpoint,
  icon,
  labelKey,
  successKey,
  failureKey,
  section,
  providerId,
  apiKey,
  baseUrl,
  modelId,
  extraConfig,
  disabled,
}: SaveButtonProps & {
  endpoint: string;
  icon: React.ReactNode;
  labelKey: string;
  successKey: string;
  failureKey: string;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, providerId, modelId, apiKey, baseUrl, extraConfig }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t(successKey));
    } catch {
      toast.error(t(failureKey));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={handleClick}
      disabled={saving || disabled}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {t(labelKey)}
    </Button>
  );
}

function ClearDefaultButton({
  endpoint,
  labelKey,
  successKey,
  failureKey,
  section,
}: {
  endpoint: string;
  labelKey: string;
  successKey: string;
  failureKey: string;
  section: SystemDefaultSection;
}) {
  const { t } = useI18n();
  const [clearing, setClearing] = useState(false);

  const handleClick = async () => {
    setClearing(true);
    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t(successKey));
    } catch {
      toast.error(t(failureKey));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground hover:text-destructive"
      onClick={handleClick}
      disabled={clearing}
    >
      {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      {t(labelKey)}
    </Button>
  );
}

/** BB.2 — admin-only, the single global row every learner falls back to. */
export function SetAsLearnerDefaultButton(props: SaveButtonProps) {
  return (
    <SaveDefaultButton
      {...props}
      endpoint="/api/admin/system-settings"
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
      labelKey="settings.setAsLearnerDefault"
      successKey="settings.learnerDefaultSaved"
      failureKey="settings.learnerDefaultSaveFailed"
    />
  );
}

/**
 * Rendered instead of the (hidden, server-owned) editing inputs once a
 * provider is server-configured — including via a prior
 * SetAsLearnerDefaultButton save, which itself makes that provider read as
 * server-configured on the admin's own next load. Without this, an admin
 * could set a learner default once and then have no way back into the
 * editable state to change or remove it.
 */
export function ClearLearnerDefaultButton({ section }: { section: SystemDefaultSection }) {
  return (
    <ClearDefaultButton
      endpoint="/api/admin/system-settings"
      section={section}
      labelKey="settings.clearLearnerDefault"
      successKey="settings.learnerDefaultCleared"
      failureKey="settings.learnerDefaultClearFailed"
    />
  );
}

/**
 * BB.3 — any non-learner (parent or admin): saves the caller's OWN choice,
 * cross-device-synced but never affecting anyone else or the BB.2 global
 * default. Unlike SetAsLearnerDefaultButton, this never marks the provider
 * server-configured, so it never hides its own editing inputs on next load —
 * ClearMyDefaultButton exists for symmetry and discoverability (explicitly
 * reverting to "follow the global default"), not to work around a hidden-
 * input bug the way ClearLearnerDefaultButton does.
 */
export function SaveAsMyDefaultButton(props: SaveButtonProps) {
  return (
    <SaveDefaultButton
      {...props}
      endpoint="/api/settings/provider-defaults"
      icon={<User className="h-3.5 w-3.5" />}
      labelKey="settings.saveAsMyDefault"
      successKey="settings.myDefaultSaved"
      failureKey="settings.myDefaultSaveFailed"
    />
  );
}

export function ClearMyDefaultButton({ section }: { section: SystemDefaultSection }) {
  return (
    <ClearDefaultButton
      endpoint="/api/settings/provider-defaults"
      section={section}
      labelKey="settings.clearMyDefault"
      successKey="settings.myDefaultCleared"
      failureKey="settings.myDefaultClearFailed"
    />
  );
}
