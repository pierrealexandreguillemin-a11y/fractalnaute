/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - LoadingOverlay
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';

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
      zIndex: 50
    }}
  >
    <div
      style={{
        width: '48px',
        height: '48px',
        border: '3px solid var(--fractal-border-color)',
        borderTopColor: 'var(--fractal-accent-primary)',
        borderRadius: '50%',
        animation: 'fractal-spin 0.8s linear infinite'
      }}
    />
  </div>
);
