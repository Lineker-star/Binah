'use client';

import { useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AVATAR_OPTIONS } from '@/lib/store/user-profile';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

export function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

interface AvatarPickerProps {
  /** Current avatar: one of `AVATAR_OPTIONS`, or a `data:` URL for a custom upload. */
  value: string;
  onChange: (value: string) => void;
  /** Swatch size as a Tailwind `size-*` class. Defaults to the homepage picker's size. */
  swatchSizeClassName?: string;
}

/**
 * Preset avatar grid + "upload your own" tile. Shared by the homepage
 * greeting bar (local `useUserProfileStore`) and the Supabase-backed profile
 * settings screen (`avatar_url` column) — both just pass a different
 * `value`/`onChange`.
 *
 * A custom upload is downscaled to 128×128 and encoded as a JPEG data URL
 * rather than uploaded to object storage — this mirrors the original
 * homepage picker's behavior exactly; swap for real file storage later if
 * the data-URL size becomes a problem.
 */
export function AvatarPicker({ value, onChange, swatchSizeClassName = 'size-7' }: AvatarPickerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        onChange(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
      {AVATAR_OPTIONS.map((url) => (
        <button
          key={url}
          type="button"
          onClick={() => onChange(url)}
          className={cn(
            swatchSizeClassName,
            'rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
            'hover:scale-110 active:scale-95',
            value === url
              ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0'
              : 'hover:ring-1 hover:ring-muted-foreground/30',
          )}
        >
          <img src={url} alt="" className="size-full" />
        </button>
      ))}
      <label
        className={cn(
          swatchSizeClassName,
          'rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
          'hover:scale-110 active:scale-95',
          isCustomAvatar(value)
            ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0 border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30'
            : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
        )}
        onClick={() => inputRef.current?.click()}
        title={t('profile.uploadAvatar')}
      >
        <ImagePlus className="size-3" />
      </label>
    </div>
  );
}
