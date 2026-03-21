/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Kbd
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { radius } from './styles';

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 6px',
      background: 'var(--fractal-bg-secondary)',
      border: '1px solid var(--fractal-border-color)',
      borderRadius: radius.sm,
      fontFamily: 'inherit',
      fontSize: '10px'
    }}
  >
    {children}
  </span>
);
