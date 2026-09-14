'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PROVIDERS } from '@/lib/ai/providers';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminLLMRouting');

const LLM_FEATURE_GROUPS = [
  'llm_chat',
  'llm_content_generation',
  'llm_assessment_grading',
  'llm_support',
] as const;
type LLMFeatureGroup = (typeof LLM_FEATURE_GROUPS)[number];

const GROUP_LABELS: Record<LLMFeatureGroup, { title: string; description: string }> = {
  llm_chat: {
    title: 'Chat',
    description: 'The live conversational surface — chat, the PBL tutor, and the agent driver.',
  },
  llm_content_generation: {
    title: 'Content Generation',
    description: 'Producing learning material — scene content, agent profiles, textbook processing.',
  },
  llm_assessment_grading: {
    title: 'Assessment & Grading',
    description: 'Evaluating the learner — exams, quizzes, continuous assessment, recommendations.',
  },
  llm_support: {
    title: 'Support / Utility',
    description: 'Small utility calls — conversation titles, search query rewriting.',
  },
};

interface Candidate {
  providerId: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
}

const EMPTY_CANDIDATE: Candidate = { providerId: '', modelId: '', apiKey: '', baseUrl: '' };

interface GroupForm {
  primary: Candidate;
  fallbacks: Candidate[];
}

function emptyGroupForm(): GroupForm {
  return { primary: { ...EMPTY_CANDIDATE }, fallbacks: [] };
}

export default function AdminLLMRoutingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<LLMFeatureGroup, GroupForm>>(() => ({
    llm_chat: emptyGroupForm(),
    llm_content_generation: emptyGroupForm(),
    llm_assessment_grading: emptyGroupForm(),
    llm_support: emptyGroupForm(),
  }));
  const [configuredGroups, setConfiguredGroups] = useState<Set<LLMFeatureGroup>>(new Set());
  const [saving, setSaving] = useState<LLMFeatureGroup | null>(null);
  const [clearing, setClearing] = useState<LLMFeatureGroup | null>(null);

  useEffect(() => {
    fetch('/api/admin/llm-feature-groups')
      .then((res) => res.json())
      .then((data: { groups?: Array<{ section: string; provider_id: string; model_id: string | null; base_url: string | null; extra_config: { fallbacks?: Candidate[] } | null }> }) => {
        const rows = data.groups ?? [];
        setForms((prev) => {
          const next = { ...prev };
          const configured = new Set<LLMFeatureGroup>();
          for (const row of rows) {
            const group = row.section as LLMFeatureGroup;
            if (!LLM_FEATURE_GROUPS.includes(group)) continue;
            configured.add(group);
            next[group] = {
              primary: {
                providerId: row.provider_id,
                modelId: row.model_id || '',
                apiKey: '',
                baseUrl: row.base_url || '',
              },
              fallbacks: row.extra_config?.fallbacks ?? [],
            };
          }
          setConfiguredGroups(configured);
          return next;
        });
      })
      .catch((err) => {
        log.error('Failed to load LLM routing config:', err);
        setError('Failed to load current routing configuration.');
      })
      .finally(() => setLoading(false));
  }, []);

  const updateForm = (group: LLMFeatureGroup, updater: (form: GroupForm) => GroupForm) => {
    setForms((prev) => ({ ...prev, [group]: updater(prev[group]) }));
  };

  const handleSave = async (group: LLMFeatureGroup) => {
    const form = forms[group];
    if (!form.primary.providerId || !form.primary.modelId) {
      toast.error('Pick a provider and a model before saving.');
      return;
    }
    setSaving(group);
    try {
      const res = await fetch('/api/admin/llm-feature-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group,
          providerId: form.primary.providerId,
          modelId: form.primary.modelId,
          apiKey: form.primary.apiKey || undefined,
          baseUrl: form.primary.baseUrl || undefined,
          fallbacks: form.fallbacks
            .filter((f) => f.providerId && f.modelId)
            .map((f) => ({
              providerId: f.providerId,
              modelId: f.modelId,
              apiKey: f.apiKey || undefined,
              baseUrl: f.baseUrl || undefined,
            })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfiguredGroups((prev) => new Set(prev).add(group));
      toast.success(`${GROUP_LABELS[group].title} routing saved.`);
    } catch (err) {
      log.error('Failed to save LLM routing:', err);
      toast.error('Failed to save routing.');
    } finally {
      setSaving(null);
    }
  };

  const handleClear = async (group: LLMFeatureGroup) => {
    setClearing(group);
    try {
      const res = await fetch('/api/admin/llm-feature-groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      updateForm(group, () => emptyGroupForm());
      setConfiguredGroups((prev) => {
        const next = new Set(prev);
        next.delete(group);
        return next;
      });
      toast.success(`${GROUP_LABELS[group].title} routing cleared.`);
    } catch (err) {
      log.error('Failed to clear LLM routing:', err);
      toast.error('Failed to clear routing.');
    } finally {
      setClearing(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>

      <div className="mt-6">
        <h1 className="text-lg font-semibold text-foreground">LLM Routing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Point each area of the app at its own provider, model, API key, and base URL — with an
          ordered fallback chain per feature, tried in sequence if the primary provider fails, so
          a single faulty provider doesn&apos;t interrupt that feature for anyone. Leave a group
          unconfigured to keep using the account&apos;s regular model selection for it.
        </p>
      </div>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldAlert className="h-6 w-6" />
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="mt-6 flex flex-col gap-6">
          {LLM_FEATURE_GROUPS.map((group) => (
            <GroupCard
              key={group}
              group={group}
              form={forms[group]}
              configured={configuredGroups.has(group)}
              saving={saving === group}
              clearing={clearing === group}
              onChange={(updater) => updateForm(group, updater)}
              onSave={() => handleSave(group)}
              onClear={() => handleClear(group)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  form,
  configured,
  saving,
  clearing,
  onChange,
  onSave,
  onClear,
}: {
  group: LLMFeatureGroup;
  form: GroupForm;
  configured: boolean;
  saving: boolean;
  clearing: boolean;
  onChange: (updater: (form: GroupForm) => GroupForm) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const label = GROUP_LABELS[group];

  const setPrimary = (patch: Partial<Candidate>) =>
    onChange((f) => ({ ...f, primary: { ...f.primary, ...patch } }));

  const setFallback = (index: number, patch: Partial<Candidate>) =>
    onChange((f) => ({
      ...f,
      fallbacks: f.fallbacks.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));

  const addFallback = () =>
    onChange((f) => ({ ...f, fallbacks: [...f.fallbacks, { ...EMPTY_CANDIDATE }] }));

  const removeFallback = (index: number) =>
    onChange((f) => ({ ...f, fallbacks: f.fallbacks.filter((_, i) => i !== index) }));

  return (
    <section className="rounded-2xl border border-border/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{label.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{label.description}</p>
        </div>
        {configured && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
            onClick={onClear}
            disabled={clearing}
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Clear
          </Button>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">Primary</div>
        <CandidateRow candidate={form.primary} onChange={setPrimary} />
      </div>

      {form.fallbacks.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {form.fallbacks.map((fallback, i) => (
            <div key={i}>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Fallback {i + 1}
              </div>
              <CandidateRow
                candidate={fallback}
                onChange={(patch) => setFallback(i, patch)}
                onRemove={() => removeFallback(i)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addFallback}>
          <Plus className="h-3.5 w-3.5" />
          Add fallback
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" className="gap-1.5" onClick={onSave} disabled={saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </section>
  );
}

function CandidateRow({
  candidate,
  onChange,
  onRemove,
}: {
  candidate: Candidate;
  onChange: (patch: Partial<Candidate>) => void;
  onRemove?: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const provider = candidate.providerId
    ? PROVIDERS[candidate.providerId as keyof typeof PROVIDERS]
    : undefined;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
      <div className="space-y-1">
        <Label className="text-[11px]">Provider</Label>
        <Select value={candidate.providerId} onValueChange={(v) => onChange({ providerId: v, modelId: '' })}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(PROVIDERS).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Model</Label>
        {provider?.models?.length ? (
          <Select value={candidate.modelId} onValueChange={(v) => onChange({ modelId: v })}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-8 font-mono text-xs"
            placeholder="model-id"
            value={candidate.modelId}
            onChange={(e) => onChange({ modelId: e.target.value })}
          />
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">API key</Label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            autoComplete="new-password"
            className="h-8 pr-8 font-mono text-xs"
            placeholder="Optional if shared"
            value={candidate.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Base URL</Label>
        <Input
          className="h-8 text-xs"
          placeholder="Optional"
          value={candidate.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
        />
      </div>

      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
