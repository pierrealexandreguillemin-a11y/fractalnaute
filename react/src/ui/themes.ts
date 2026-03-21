/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Theme System
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ThemeName } from '../domain';

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgOverlay: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentSecondary: string;
  accentGlow: string;
  borderColor: string;
  glassBg: string;
  glassBorder: string;
}

export const themes: Record<ThemeName, ThemeColors> = {
  default: {
    bgPrimary: 'oklch(0.107 0.017 284.5)',
    bgSecondary: 'oklch(0.151 0.019 284.5)',
    bgOverlay: 'oklch(0.107 0.017 284.5 / 0.85)',
    textPrimary: 'oklch(0.931 0.008 286.0)',
    textSecondary: 'oklch(0.615 0.035 286.0)',
    accentPrimary: 'oklch(0.541 0.215 264.1)',
    accentSecondary: 'oklch(0.541 0.213 303.5)',
    accentGlow: 'oklch(0.541 0.215 264.1 / 0.4)',
    borderColor: 'oklch(1.000 0.000 0.0 / 0.1)',
    glassBg: 'oklch(0.170 0.020 284.5 / 0.7)',
    glassBorder: 'oklch(1.000 0.000 0.0 / 0.08)'
  },
  miami: {
    bgPrimary: 'oklch(0.177 0.087 308.0)',
    bgSecondary: 'oklch(0.270 0.095 308.0)',
    bgOverlay: 'oklch(0.177 0.087 308.0 / 0.9)',
    textPrimary: 'oklch(0.964 0.015 350.0)',
    textSecondary: 'oklch(0.765 0.106 350.0)',
    accentPrimary: 'oklch(0.655 0.196 12.0)',
    accentSecondary: 'oklch(0.810 0.155 200.0)',
    accentGlow: 'oklch(0.655 0.196 12.0 / 0.5)',
    borderColor: 'oklch(0.655 0.196 12.0 / 0.2)',
    glassBg: 'oklch(0.270 0.095 308.0 / 0.75)',
    glassBorder: 'oklch(0.655 0.196 12.0 / 0.15)'
  },
  ocean: {
    bgPrimary: 'oklch(0.185 0.040 245.0)',
    bgSecondary: 'oklch(0.265 0.050 245.0)',
    bgOverlay: 'oklch(0.185 0.040 245.0 / 0.9)',
    textPrimary: 'oklch(0.850 0.060 240.0)',
    textSecondary: 'oklch(0.600 0.090 240.0)',
    accentPrimary: 'oklch(0.720 0.130 225.0)',
    accentSecondary: 'oklch(0.825 0.145 195.0)',
    accentGlow: 'oklch(0.720 0.130 225.0 / 0.4)',
    borderColor: 'oklch(0.720 0.130 225.0 / 0.15)',
    glassBg: 'oklch(0.265 0.050 245.0 / 0.75)',
    glassBorder: 'oklch(0.720 0.130 225.0 / 0.1)'
  },
  light: {
    bgPrimary: 'oklch(0.970 0.002 286.0)',
    bgSecondary: 'oklch(1.000 0.000 0.0)',
    bgOverlay: 'oklch(0.970 0.002 286.0 / 0.92)',
    textPrimary: 'oklch(0.210 0.005 286.0)',
    textSecondary: 'oklch(0.510 0.005 286.0)',
    accentPrimary: 'oklch(0.510 0.180 255.0)',
    accentSecondary: 'oklch(0.680 0.160 145.0)',
    accentGlow: 'oklch(0.510 0.180 255.0 / 0.25)',
    borderColor: 'oklch(0.000 0.000 0.0 / 0.1)',
    glassBg: 'oklch(1.000 0.000 0.0 / 0.8)',
    glassBorder: 'oklch(0.000 0.000 0.0 / 0.06)'
  }
};

export function getThemeCSSVariables(themeName: ThemeName): Record<string, string> {
  const theme = themes[themeName];
  return {
    '--fractal-bg-primary': theme.bgPrimary,
    '--fractal-bg-secondary': theme.bgSecondary,
    '--fractal-bg-overlay': theme.bgOverlay,
    '--fractal-text-primary': theme.textPrimary,
    '--fractal-text-secondary': theme.textSecondary,
    '--fractal-accent-primary': theme.accentPrimary,
    '--fractal-accent-secondary': theme.accentSecondary,
    '--fractal-accent-glow': theme.accentGlow,
    '--fractal-border-color': theme.borderColor,
    '--fractal-glass-bg': theme.glassBg,
    '--fractal-glass-border': theme.glassBorder
  };
}

export function getThemeLabel(name: ThemeName): string {
  const labels: Record<ThemeName, string> = {
    default: 'Cosmos (Défaut)',
    miami: 'Miami Neon',
    ocean: 'Océan Profond',
    light: 'Lumière'
  };
  return labels[name] ?? name;
}

export function getThemeNames(): ThemeName[] {
  return Object.keys(themes) as ThemeName[];
}

export const keyframesCSS = `
@keyframes fractal-spin {
  to { transform: rotate(360deg); }
}
@keyframes fractal-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
`;
