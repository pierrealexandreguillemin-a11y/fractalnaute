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
    bgPrimary: '#0a0a0f',
    bgSecondary: '#14141f',
    bgOverlay: 'rgba(10, 10, 15, 0.85)',
    textPrimary: '#e8e8f0',
    textSecondary: '#8888aa',
    accentPrimary: '#6366f1',
    accentSecondary: '#a855f7',
    accentGlow: 'rgba(99, 102, 241, 0.4)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    glassBg: 'rgba(20, 20, 35, 0.7)',
    glassBorder: 'rgba(255, 255, 255, 0.08)'
  },
  miami: {
    bgPrimary: '#1a0a2e',
    bgSecondary: '#2d1b4e',
    bgOverlay: 'rgba(26, 10, 46, 0.9)',
    textPrimary: '#fff0f5',
    textSecondary: '#ff9ecd',
    accentPrimary: '#ff6b9d',
    accentSecondary: '#00d4ff',
    accentGlow: 'rgba(255, 107, 157, 0.5)',
    borderColor: 'rgba(255, 107, 157, 0.2)',
    glassBg: 'rgba(45, 27, 78, 0.75)',
    glassBorder: 'rgba(255, 107, 157, 0.15)'
  },
  ocean: {
    bgPrimary: '#0c1929',
    bgSecondary: '#132f4c',
    bgOverlay: 'rgba(12, 25, 41, 0.9)',
    textPrimary: '#b2d5ff',
    textSecondary: '#5090d3',
    accentPrimary: '#29b6f6',
    accentSecondary: '#00e5ff',
    accentGlow: 'rgba(41, 182, 246, 0.4)',
    borderColor: 'rgba(41, 182, 246, 0.15)',
    glassBg: 'rgba(19, 47, 76, 0.75)',
    glassBorder: 'rgba(41, 182, 246, 0.1)'
  },
  light: {
    bgPrimary: '#f5f5f7',
    bgSecondary: '#ffffff',
    bgOverlay: 'rgba(245, 245, 247, 0.92)',
    textPrimary: '#1d1d1f',
    textSecondary: '#6e6e73',
    accentPrimary: '#0071e3',
    accentSecondary: '#34c759',
    accentGlow: 'rgba(0, 113, 227, 0.25)',
    borderColor: 'rgba(0, 0, 0, 0.1)',
    glassBg: 'rgba(255, 255, 255, 0.8)',
    glassBorder: 'rgba(0, 0, 0, 0.06)'
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
