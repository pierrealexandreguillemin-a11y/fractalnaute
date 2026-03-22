/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - HelpTooltip
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { Kbd } from './Kbd';

export const HelpTooltip: React.FC = () => (
  <div
    className={[
      'absolute bottom-4 right-4 z-10 px-4 py-2',
      'backdrop-blur-xl bg-glass-bg border border-glass-border rounded-xl',
      'text-[11px] text-muted-foreground',
      'opacity-70 transition-opacity duration-150 hover:opacity-100'
    ].join(' ')}
  >
    <Kbd>Molette</Kbd> Zoom &nbsp;|&nbsp;
    <Kbd>Clic</Kbd> Centrer &nbsp;|&nbsp;
    <Kbd>Glisser</Kbd> Déplacer &nbsp;|&nbsp;
    <Kbd>R</Kbd> Reset
  </div>
);
