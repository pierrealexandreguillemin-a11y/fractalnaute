/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Shared Styles
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { CSSProperties } from 'react';

/** Base glassmorphism styles shared by all overlay panels */
export const glassBaseStyle: CSSProperties = {
  background: 'var(--fractal-glass-bg)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid var(--fractal-glass-border)',
  borderRadius: '12px',
  zIndex: 10
};

/** Horizontal divider between panel sections */
export const dividerStyle: CSSProperties = {
  height: '1px',
  background: 'var(--fractal-border-color)',
  margin: '12px 0'
};

/** Uppercase label style for form sections */
export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.3px',
  textTransform: 'uppercase',
  color: 'var(--fractal-text-secondary)',
  marginBottom: '4px'
};

/** Standard select input style */
export const selectStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--fractal-bg-secondary)',
  border: '1px solid var(--fractal-border-color)',
  borderRadius: '8px',
  color: 'var(--fractal-text-primary)',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer'
};

/** Monospace font family for code/coordinate display */
export const monoFontFamily = "'SF Mono', 'Fira Code', monospace";

/** Standard secondary button style */
export const buttonStyle: CSSProperties = {
  padding: '8px 12px',
  background: 'var(--fractal-bg-secondary)',
  border: '1px solid var(--fractal-border-color)',
  borderRadius: '8px',
  color: 'var(--fractal-text-primary)',
  fontSize: '12px',
  cursor: 'pointer'
};

/** Info box style for descriptions and status text */
export const infoBoxStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--fractal-text-secondary)',
  padding: '8px',
  background: 'var(--fractal-bg-secondary)',
  borderRadius: '6px',
  lineHeight: 1.4
};
