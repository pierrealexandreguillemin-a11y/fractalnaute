/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - HelpTooltip
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { Kbd } from './Kbd';
import { glassBaseStyle } from './styles';

export const HelpTooltip: React.FC = () => (
  <div
    style={{
      ...glassBaseStyle,
      position: 'absolute',
      bottom: '16px',
      right: '16px',
      padding: '8px 16px',
      fontSize: '11px',
      color: 'var(--fractal-text-secondary)',
      opacity: 0.7,
      transition: 'opacity 150ms ease',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
  >
    <Kbd>Molette</Kbd> Zoom &nbsp;|&nbsp;
    <Kbd>Clic</Kbd> Centrer &nbsp;|&nbsp;
    <Kbd>Glisser</Kbd> Déplacer &nbsp;|&nbsp;
    <Kbd>R</Kbd> Reset
  </div>
);
