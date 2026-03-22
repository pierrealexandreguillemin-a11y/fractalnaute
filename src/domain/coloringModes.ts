/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coloring Modes
 * Maps FractalResult → palette parameter t ∈ [0,1] based on active mode.
 * SRP: mode-specific logic isolated from palette lookup.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalResult, ColoringMode } from './types';

/**
 * Map a fractal result to a palette parameter based on coloring mode.
 * Only called for escaped points (caller checks result.escaped).
 */
export function mapToColorParam(
  result: FractalResult,
  mode: ColoringMode
): number {
  switch (mode) {
    case 'classic':
      return (result.smoothValue % 256) / 256;
    case 'stripe':
      return stripeToParam(result);
    case 'decomposition':
      return decompToParam(result);
    case 'orbitTrap':
      return trapToParam(result);
    case 'normalMap':
      return (result.smoothValue % 256) / 256;
    default:
      return (result.smoothValue % 256) / 256;
  }
}

function stripeToParam(result: FractalResult): number {
  const base = (result.smoothValue % 256) / 256;
  return (base + result.stripeValue * 0.5) % 1;
}

function decompToParam(result: FractalResult): number {
  const base = (result.smoothValue % 256) / 256;
  const band = result.decompAngle >= 0 ? 0.0 : 0.5;
  return (base * 0.5 + band) % 1;
}

function trapToParam(result: FractalResult): number {
  const d = Math.min(result.orbitTrapDist, 2) / 2;
  return d;
}

/**
 * Compute lightness modifier for normal map mode.
 * Simulates directional lighting based on distance estimation gradient.
 * @returns multiplier for lightness [0.3, 1.5]
 */
export function computeNormalLightness(
  result: FractalResult,
  lightAngleRad: number
): number {
  if (result.distanceEstimate <= 0) return 1;
  const angle = Math.atan2(
    result.smoothValue - Math.floor(result.smoothValue),
    result.distanceEstimate
  );
  const dot = Math.cos(angle - lightAngleRad);
  return 0.3 + 1.2 * (dot * 0.5 + 0.5);
}

/**
 * Map interior point to palette parameter for interior coloring.
 * Uses orbit trap distance (most visually meaningful across all modes).
 */
export function mapInteriorToParam(result: FractalResult): number {
  if (result.orbitTrapDist === Infinity || result.orbitTrapDist === 0) return 0;
  return Math.min(result.orbitTrapDist, 2) / 2;
}

/** Coloring mode labels (French) */
export const COLORING_MODE_LABELS: Record<ColoringMode, string> = {
  classic: 'Classique',
  stripe: 'Métal brossé',
  decomposition: 'Tessellation',
  orbitTrap: 'Orbit trap',
  normalMap: 'Éclairage 3D'
};
