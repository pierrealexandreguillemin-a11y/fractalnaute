/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Theme System
 * Theme colors are now defined in globals.css via data-theme selectors.
 * This file provides theme metadata utilities only.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ThemeName } from '../domain';

/** Ordered list of available theme names */
export const THEME_NAMES: ThemeName[] = ['default', 'miami', 'ocean', 'light'];

const THEME_LABELS: Record<ThemeName, string> = {
  default: 'Cosmos (Défaut)',
  miami: 'Miami Neon',
  ocean: 'Océan Profond',
  light: 'Lumière'
};

export function getThemeLabel(name: ThemeName): string {
  return THEME_LABELS[name] ?? name;
}

export function getThemeNames(): ThemeName[] {
  return THEME_NAMES;
}
