'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supportedLocales } from '@/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchAllSkillTracksAdmin,
  createSkillTrack,
  updateSkillTrack,
  type SkillTrackAdminInput,
} from '@/lib/supabase/admin';
import type { SkillTrack } from '@/lib/supabase/skill-tracks';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminSkillTracks');

const EMPTY_FORM: SkillTrackAdminInput = {
  title: '',
  description: '',
  category: '',
  locale: 'en-US',
  isPublished: false,
};

export default function AdminSkillTracksPage() {
  const [loading, setLoading] = useState(true);
  const [tracks, setTracks] = useState<SkillTrack[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SkillTrackAdminInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchAllSkillTracksAdmin()
      .then(setTracks)
      .catch((err) => log.error('Failed to load skill tracks:', err))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const startCreate = () => {
    setEditingId('new');
    setForm(EMPTY_FORM);
  };

  const startEdit = (track: SkillTrack) => {
    setEditingId(track.id);
    setForm({
      title: track.title,
      description: track.description ?? '',
      category: track.category ?? '',
      locale: track.locale,
      isPublished: track.is_published,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    setSaving(true);
    try {
      if (editingId === 'new') {
        await createSkillTrack(form);
      } else if (editingId) {
        await updateSkillTrack(editingId, form);
      }
      cancelEdit();
      load();
      toast.success('Saved.');
    } catch (err) {
      log.error('Failed to save skill track:', err);
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>

      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Skill Tracks</h1>
        {editingId === null && (
          <Button size="sm" onClick={startCreate}>
            New track
          </Button>
        )}
      </div>

      {editingId !== null && (
        <div className="mt-4 rounded-2xl border border-border/60 p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="track-title">Title</Label>
            <Input
              id="track-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="track-description">Description</Label>
            <Textarea
              id="track-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="track-category">Category</Label>
              <Input
                id="track-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Entrepreneurship"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="track-locale">Locale</Label>
              <Select
                value={form.locale}
                onValueChange={(v) => setForm({ ...form, locale: v })}
              >
                <SelectTrigger id="track-locale" className="w-full">
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
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="track-published"
              checked={form.isPublished}
              onCheckedChange={(v) => setForm({ ...form, isPublished: v })}
            />
            <Label htmlFor="track-published">Published</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && tracks.length === 0 && (
        <div className="mt-10 text-center text-sm text-muted-foreground">No skill tracks yet.</div>
      )}

      {!loading && tracks.length > 0 && (
        <div className="mt-6 flex flex-col divide-y divide-border/60 rounded-2xl border border-border/60">
          {tracks.map((track) => (
            <div key={track.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {track.title}
                  </span>
                  {track.category && <Badge variant="outline">{track.category}</Badge>}
                  <Badge variant={track.is_published ? 'default' : 'secondary'}>
                    {track.is_published ? 'Published' : 'Draft'}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {track.locale} · {track.slug}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => startEdit(track)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
