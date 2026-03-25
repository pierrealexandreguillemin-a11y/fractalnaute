/**
 * ===============================================================================
 * DOMAIN LAYER - Coloring Modes
 * Maps FractalResult -> palette parameter t in [0,1] based on active mode.
 * Also owns mode dispatch + interior logic (SRP: palettes.ts only does lookup).
 * ===============================================================================
 */

import type { FractalResult, ColoringMode, ColorPalette, RGB } from './types';
import {
  lookupPaletteColor,
  lookupPaletteColorWithLightness,
  lookupPaletteColorAttenuated
} from './palettes';

// ---- Named constants --------------------------------------------------------

/** Iteration color cycle period — how many iterations before colors repeat */
export const COLOR_CYCLE_PERIOD = 256;

/** Tighter cycle for orbit trap mode — creates more color variation at close distances */
export const ORBIT_TRAP_CYCLE = 64;

/** Default light direction for normal map mode (~315 deg, upper-left) */
export const NORMAL_MAP_LIGHT_ANGLE = -0.7854;

/** Interior coloring lightness attenuation factor */
export const INTERIOR_ATTENUATION = 0.4;

// ---- Mode dispatch ----------------------------------------------------------

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
      return (result.smoothValue % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
    case 'stripe':
      return stripeToParam(result);
    case 'decomposition':
      return decompToParam(result);
    case 'orbitTrap':
      return trapToParam(result);
    case 'normalMap':
      return normalToParam(result);
    default:
      return (result.smoothValue % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  }
}

/**
 * @mirror deep-mandelbrot: stripe amplitude + iteration frequency.
 * stripeValue = Catmull-Rom interpolated Re(z)·Im(z)/|z|² average.
 * Cosine palette wraps via sin(), so unbounded t is fine.
 */
function stripeToParam(result: FractalResult): number {
  const amplitude = 0.7 + 2.5 * result.stripeValue;
  const frequency = 50.0 * result.smoothValue / COLOR_CYCLE_PERIOD;
  return amplitude + frequency;
}

function decompToParam(result: FractalResult): number {
  return result.decompAngle >= 0 ? 0.15 : 0.65;
}

function trapToParam(result: FractalResult): number {
  // Log scale spreads the range -- linear maps most points to a narrow band
  const d = Math.min(result.orbitTrapDist, 4);
  const logMapped = Math.log(1 + d) / Math.log(5); // [0, 1] with log spreading
  // Combine with smooth iteration for palette richness
  const base = (result.smoothValue % ORBIT_TRAP_CYCLE) / ORBIT_TRAP_CYCLE;
  return (logMapped * 0.6 + base * 0.4) % 1;
}

function normalToParam(result: FractalResult): number {
  // Combine smooth iteration with escape angle for richer color variation
  const base = (result.smoothValue % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  const angleNorm = (result.decompAngle + Math.PI) / (2 * Math.PI); // [0, 1]
  return (base * 0.7 + angleNorm * 0.3) % 1;
}

// ---- Normal map lighting ----------------------------------------------------

/**
 * Compute lightness modifier for normal map mode.
 * Uses escape angle as surface normal + distance estimation for height.
 * @returns multiplier for lightness [0.2, 1.4]
 */
export function computeNormalLightness(
  result: FractalResult,
  lightAngleRad: number
): number {
  if (result.distanceEstimate <= 0) return 0.5;

  // Directional lighting via escape angle
  const dot = Math.cos(result.decompAngle - lightAngleRad);

  // Distance-based height field -- log scale to avoid saturation
  const logDE = Math.log(1 + result.distanceEstimate * 10);
  const height = Math.min(logDE / 3, 1);

  // Strong directional component + subtle ambient
  return 0.2 + 1.2 * (dot * 0.5 + 0.5) * (0.3 + 0.7 * height);
}

// ---- Interior coloring ------------------------------------------------------

/**
 * Map interior point to palette parameter for interior coloring.
 * Uses orbit trap distance (most visually meaningful across all modes).
 */
export function mapInteriorToParam(result: FractalResult): number {
  if (result.orbitTrapDist === Infinity || result.orbitTrapDist === 0) return 0;
  return Math.min(result.orbitTrapDist, 2) / 2;
}

// ---- Top-level coloring entry point -----------------------------------------

/**
 * Get the final RGB color for a fractal result.
 * Handles all mode dispatch, interior logic, and palette lookup.
 * This is the single entry point used by the render loop.
 */
export function getColorForResult(
  result: FractalResult,
  palette: ColorPalette,
  coloringMode: ColoringMode = 'classic',
  interiorColoring: boolean = false
): RGB {
  if (!result.escaped) {
    if (!interiorColoring) return [0, 0, 0];
    const t = mapInteriorToParam(result);
    return lookupPaletteColorAttenuated(palette, t, INTERIOR_ATTENUATION);
  }

  const t = mapToColorParam(result, coloringMode);

  if (coloringMode === 'stripe') {
    return cosinePaletteColor(t);
  }

  if (coloringMode === 'normalMap') {
    const lightness = computeNormalLightness(result, NORMAL_MAP_LIGHT_ANGLE);
    return lookupPaletteColorWithLightness(palette, t, lightness);
  }

  return lookupPaletteColor(palette, t);
}

/**
 * Cosine palette — Inigo Quilez style, produces iridescent metallic colors.
 * Phase offsets (4.0, 4.6, 5.2) tuned for copper/bronze metallic.
 * @mirror infrastructure/gpu/shaders/index.ts:cosinePaletteLookupChunk
 * @see https://iquilezles.org/articles/palettes/
 */
function cosinePaletteColor(t: number): RGB {
  const tau = 6.28318;
  return [
    Math.round(255 * (0.5 + 0.5 * Math.sin(tau * t + 4.0))),
    Math.round(255 * (0.5 + 0.5 * Math.sin(tau * t + 4.6))),
    Math.round(255 * (0.5 + 0.5 * Math.sin(tau * t + 5.2))),
  ];
}

// ---- Labels & registry ------------------------------------------------------

/** Coloring mode labels (French) */
export const COLORING_MODE_LABELS: Record<ColoringMode, string> = {
  classic: 'Classique',
  stripe: 'Metal brosse',
  decomposition: 'Tessellation',
  orbitTrap: 'Orbit trap',
  normalMap: 'Eclairage 3D'
};

/** Ordered list of all coloring modes */
export const COLORING_MODES: ColoringMode[] = Object.keys(COLORING_MODE_LABELS) as ColoringMode[];
