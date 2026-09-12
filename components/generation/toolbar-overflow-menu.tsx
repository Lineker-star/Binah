'use client';

import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/hooks/use-i18n';
import { MediaPopover } from '@/components/generation/media-popover';
import { InteractiveModeButton } from '@/components/generation/interactive-mode-button';
import { pillMuted, pillActive } from '@/components/generation/generation-toolbar';
import type { SettingsSection } from '@/lib/types/settings';

export interface ToolbarOverflowMenuProps {
  onSettingsOpen: (section?: SettingsSection) => void;
  interactiveModePressed: boolean;
  onInteractiveModeChange: (pressed: boolean) => void;
}

/**
 * Lower-frequency toolbar actions collapsed behind a single "More" pill.
 * Keeps the composer toolbar to one line at the composer's fixed 800px
 * width: Interactive Mode and Media/Voice settings are "set once" controls,
 * unlike Structured Course/Upload Textbook/Web Search which pick what gets
 * generated. MediaPopover renders unchanged inside this popover's content —
 * a nested Popover trigger is a normal Radix pattern, no internal changes
 * needed to the component itself.
 */
export function ToolbarOverflowMenu({
  onSettingsOpen,
  interactiveModePressed,
  onInteractiveModeChange,
}: ToolbarOverflowMenuProps) {
  const { t } = useI18n();

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={interactiveModePressed ? pillActive : pillMuted}
              aria-label={t('toolbar.moreOptions')}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t('toolbar.moreOptions')}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-3 space-y-3">
        {/* Interactive Mode — the same pill used to render directly in the
            toolbar row, unchanged, just relocated in here with its hint
            shown alongside instead of on hover. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-xs font-medium">{t('toolbar.interactiveModeLabel')}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              {t('toolbar.interactiveModeHint')}
            </p>
          </div>
          <InteractiveModeButton
            pressed={interactiveModePressed}
            label=""
            onPressedChange={onInteractiveModeChange}
            className="px-2"
          />
        </div>

        {/* Media/voice generation settings — MediaPopover is fully
            self-contained (its own Popover, own store subscriptions); only
            its trigger's position moves here. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t('toolbar.mediaSettingsLabel')}
          </span>
          <MediaPopover onSettingsOpen={onSettingsOpen} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
