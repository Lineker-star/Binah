'use client';

/**
 * Admin-only action rendered inside each of the 6 provider settings panels
 * (LLM/image/video/TTS/ASR/PDF) — deliberately a separate, explicit control
 * from the panel's own "Save" button (per BB.1: an admin's routine
 * key-testing must not silently become the system-wide learner default
 * every time they save). POSTs the panel's currently-displayed config to
 * /api/admin/system-settings, which upserts system_settings and merges it
 * into the live server-side provider-config cache immediately.
 */
import { useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SystemDefaultSection } from '@/lib/server/provider-config';

export interface SetAsLearnerDefaultButtonProps {
  section: SystemDefaultSection;
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  extraConfig?: { accessKeyId?: string; accessKeySecret?: string };
  disabled?: boolean;
}

export function SetAsLearnerDefaultButton({
  section,
  providerId,
  apiKey,
  baseUrl,
  modelId,
  extraConfig,
  disabled,
}: SetAsLearnerDefaultButtonProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  const handleClick = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, providerId, modelId, apiKey, baseUrl, extraConfig }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('settings.learnerDefaultSaved'));
    } catch {
      toast.error(t('settings.learnerDefaultSaveFailed'));
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
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5" />
      )}
      {t('settings.setAsLearnerDefault')}
    </Button>
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
  const { t } = useI18n();
  const [clearing, setClearing] = useState(false);

  const handleClick = async () => {
    setClearing(true);
    try {
      const res = await fetch('/api/admin/system-settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(t('settings.learnerDefaultCleared'));
    } catch {
      toast.error(t('settings.learnerDefaultClearFailed'));
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
      {t('settings.clearLearnerDefault')}
    </Button>
  );
}
