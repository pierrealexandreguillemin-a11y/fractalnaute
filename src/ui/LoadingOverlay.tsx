/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - LoadingOverlay
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { radius, zIndex, BORDER_COLOR } from './styles';

interface LoadingOverlayProps {
  isVisible: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'var(--fractal-bg-overlay)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: isVisible ? 1 : 0,
      pointerEvents: isVisible ? 'auto' : 'none',
      transition: 'opacity 300ms ease',
      zIndex: zIndex.overlay
    }}
  >
    <div
      style={{
        width: '48px',
        height: '48px',
        border: `3px solid ${BORDER_COLOR}`,
        borderTopColor: 'var(--fractal-accent-primary)',
        borderRadius: radius.full,
        animation: 'fractal-spin 0.8s linear infinite'
      }}
    />
  </div>
);
