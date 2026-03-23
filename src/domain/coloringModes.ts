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
  return result.decompAngle >= 0 ? 0.15 : 0.65;
}

function trapToParam(result: FractalResult): number {
  const d = Math.min(result.orbitTrapDist, 2) / 2;
  return d;
}

/**
 * Compute lightness modifier for normal map mode.
 * Uses the decomposition angle (arg(z) at escape) as surface normal direction,
 * combined with distance estimation for height.
 * @returns multiplier for lightness [0.3, 1.5]
 */
export function computeNormalLightness(
  result: FractalResult,
  lightAngleRad: number
): number {
  if (result.distanceEstimate <= 0) return 1;

  // Use decomposition angle as normal direction (angle of z at escape)
  // This approximates the surface normal of the iteration count field
  const dot = Math.cos(result.decompAngle - lightAngleRad);

  // Modulate with distance estimation for depth shading
  const depth = Math.min(result.distanceEstimate * 50, 1);

  // Combine: directional lighting + ambient + depth
  return (0.3 + 0.7 * (dot * 0.5 + 0.5)) * (0.5 + 0.5 * depth);
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
