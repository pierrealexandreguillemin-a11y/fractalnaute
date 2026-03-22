/**
 * ===================================================================
 * UI LAYER - Kbd
 * ===================================================================
 */

import React from 'react';
import { radius, BG_SECONDARY, BORDER_SOLID } from './styles';

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 6px',
      background: BG_SECONDARY,
      border: BORDER_SOLID,
      borderRadius: radius.sm,
      fontFamily: 'inherit',
      fontSize: '10px'
    }}
  >
    {children}
  </span>
);
