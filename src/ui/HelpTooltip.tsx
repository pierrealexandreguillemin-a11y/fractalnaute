/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - HelpTooltip
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { GLASS_PANEL } from './shared';
import { Kbd } from './Kbd';

export const HelpTooltip: React.FC = () => (
  <div
    className={cn(
      'absolute bottom-4 right-4 z-10 px-4 py-2',
      GLASS_PANEL,
      'text-[11px] text-muted-foreground',
      'opacity-70 transition-opacity duration-150 hover:opacity-100'
    )}
  >
    <Kbd>Molette</Kbd> Zoom &nbsp;|&nbsp;
    <Kbd>Clic</Kbd> Centrer &nbsp;|&nbsp;
    <Kbd>Glisser</Kbd> Déplacer &nbsp;|&nbsp;
    <Kbd>R</Kbd> Reset
  </div>
);
