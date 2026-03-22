/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Shared Styles
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { CSSProperties } from 'react';

/** CSS custom property references — avoids string duplication across styles */
export const BG_SECONDARY = 'var(--fractal-bg-secondary)';
export const BORDER_COLOR = 'var(--fractal-border-color)';
export const BORDER_SOLID = `1px solid ${BORDER_COLOR}` as const;

/** Border radius scale */
export const radius = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  full: '50%',
} as const;

/** Z-index scale */
export const zIndex = {
  panel: 10,
  overlay: 50,
  controls: 100,
} as const;

/** Base glassmorphism styles shared by all overlay panels */
export const glassBaseStyle: CSSProperties = {
  background: 'var(--fractal-glass-bg)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid var(--fractal-glass-border)',
  borderRadius: radius.xl,
  zIndex: zIndex.panel
};

/** Horizontal divider between panel sections */
export const dividerStyle: CSSProperties = {
  height: '1px',
  background: BORDER_COLOR,
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
  background: BG_SECONDARY,
  border: BORDER_SOLID,
  borderRadius: radius.lg,
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
  background: BG_SECONDARY,
  border: BORDER_SOLID,
  borderRadius: radius.lg,
  color: 'var(--fractal-text-primary)',
  fontSize: '12px',
  cursor: 'pointer'
};

/** Info box style for descriptions and status text */
export const infoBoxStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--fractal-text-secondary)',
  padding: '8px',
  background: BG_SECONDARY,
  borderRadius: radius.md,
  lineHeight: 1.4
};
