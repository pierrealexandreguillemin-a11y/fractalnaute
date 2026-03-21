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
    bgPrimary: 'oklch(0.147 0.0107 285.0)',
    bgSecondary: 'oklch(0.197 0.0220 284.2)',
    bgOverlay: 'oklch(0.147 0.0107 285.0 / 0.85)',
    textPrimary: 'oklch(0.933 0.0107 286.2)',
    textSecondary: 'oklch(0.639 0.0506 284.9)',
    accentPrimary: 'oklch(0.585 0.2041 277.1)',
    accentSecondary: 'oklch(0.627 0.2325 303.9)',
    accentGlow: 'oklch(0.585 0.2041 277.1 / 0.4)',
    borderColor: 'oklch(1.000 0.0000 89.9 / 0.1)',
    glassBg: 'oklch(0.199 0.0299 283.4 / 0.7)',
    glassBorder: 'oklch(1.000 0.0000 89.9 / 0.08)'
  },
  miami: {
    bgPrimary: 'oklch(0.193 0.0691 300.4)',
    bgSecondary: 'oklch(0.276 0.0901 296.3)',
    bgOverlay: 'oklch(0.193 0.0691 300.4 / 0.9)',
    textPrimary: 'oklch(0.968 0.0174 355.1)',
    textSecondary: 'oklch(0.811 0.1278 349.8)',
    accentPrimary: 'oklch(0.723 0.1854 1.8)',
    accentSecondary: 'oklch(0.804 0.1459 219.5)',
    accentGlow: 'oklch(0.723 0.1854 1.8 / 0.5)',
    borderColor: 'oklch(0.723 0.1854 1.8 / 0.2)',
    glassBg: 'oklch(0.276 0.0901 296.3 / 0.75)',
    glassBorder: 'oklch(0.723 0.1854 1.8 / 0.15)'
  },
  ocean: {
    bgPrimary: 'oklch(0.211 0.0369 254.4)',
    bgSecondary: 'oklch(0.300 0.0629 251.4)',
    bgOverlay: 'oklch(0.211 0.0369 254.4 / 0.9)',
    textPrimary: 'oklch(0.862 0.0696 253.2)',
    textSecondary: 'oklch(0.640 0.1209 251.2)',
    accentPrimary: 'oklch(0.734 0.1450 234.6)',
    accentSecondary: 'oklch(0.844 0.1457 209.3)',
    accentGlow: 'oklch(0.734 0.1450 234.6 / 0.4)',
    borderColor: 'oklch(0.734 0.1450 234.6 / 0.15)',
    glassBg: 'oklch(0.300 0.0629 251.4 / 0.75)',
    glassBorder: 'oklch(0.734 0.1450 234.6 / 0.1)'
  },
  light: {
    bgPrimary: 'oklch(0.971 0.0027 286.4)',
    bgSecondary: 'oklch(1.000 0.0000 89.9)',
    bgOverlay: 'oklch(0.971 0.0027 286.4 / 0.92)',
    textPrimary: 'oklch(0.232 0.0038 286.1)',
    textSecondary: 'oklch(0.540 0.0077 286.1)',
    accentPrimary: 'oklch(0.563 0.1933 256.2)',
    accentSecondary: 'oklch(0.730 0.1944 147.4)',
    accentGlow: 'oklch(0.563 0.1933 256.2 / 0.25)',
    borderColor: 'oklch(0.000 0.0000 0.0 / 0.1)',
    glassBg: 'oklch(1.000 0.0000 89.9 / 0.8)',
    glassBorder: 'oklch(0.000 0.0000 0.0 / 0.06)'
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
