/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coloring Accumulator
 * Stripe average + orbit trap tracking during fractal iteration.
 * Derivative is NOT here — it's fractal-specific, inlined in calculators.
 *
 * Stripe formula: Re(z)·Im(z)/|z|² (2-fold geometric, matches deep-mandelbrot)
 * History: 4 running-sum snapshots for Catmull-Rom C1 interpolation at escape.
 * @see https://github.com/munrocket/deep-fractal (reference implementation)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { INTERIOR_COLORING_DEFAULTS } from './types';

/** Mutable state tracked during iteration */
export interface AccumulatorState {
  stripeSum: number;
  stripePrev1: number;
  stripePrev2: number;
  stripePrev3: number;
  trapDistSq: number;
  count: number;
}

/**
 * High bailout for accumulation paths — smooth iteration converges better
 * and stripe average gets more data. Matches deep-mandelbrot's 3e5.
 * @tradeoff CPU accum paths use this for ALL modes (stripe, normalMap, orbitTrap, decomposition).
 * GPU uses this only for stripe; other GPU modes use bailout=4. CPU quality is higher but
 * diverges from GPU for non-stripe modes. Acceptable: CPU is the fallback renderer.
 * @see https://github.com/munrocket/deep-fractal
 */
export const STRIPE_BAILOUT_SQ = 300000.0;

export function initAccumulator(): AccumulatorState {
  return { stripeSum: 0, stripePrev1: 0, stripePrev2: 0, stripePrev3: 0, trapDistSq: Infinity, count: 0 };
}

/**
 * Update per iteration — called inside the hot loop.
 * Stripe: Re(z)·Im(z)/|z|² (geometric 2-fold symmetric, produces metallic look).
 * Orbit trap: tracks minimum |z|² for orbit trap coloring.
 */
export function updateAccumulator(
  state: AccumulatorState,
  zRe: number,
  zIm: number
): void {
  // Shift history for Catmull-Rom
  state.stripePrev3 = state.stripePrev2;
  state.stripePrev2 = state.stripePrev1;
  state.stripePrev1 = state.stripeSum;

  // Stripe: z.x * z.y / |z|² (deep-mandelbrot formula)
  const zz = zRe * zRe + zIm * zIm;
  if (zz > 0) {
    state.stripeSum += zRe * zIm / zz;
  }
  state.count++;

  if (zz < state.trapDistSq) {
    state.trapDistSq = zz;
  }
}

/**
 * Catmull-Rom cubic interpolation — C1 continuous across iteration boundaries.
 * Uses 4 points: s0 (oldest), s1, s2, s3 (newest), parameter d in [0,1].
 * @see deep-mandelbrot interpolate() function
 */
function catmullRom(s0: number, s1: number, s2: number, s3: number, d: number): number {
  const d2 = d * d;
  const d3 = d * d2;
  return 0.5 * (
    s0 * (-d + 2 * d2 - d3) +
    s1 * (2 - 5 * d2 + 3 * d3) +
    s2 * (d + 4 * d2 - 3 * d3) +
    s3 * (d3 - d2)
  );
}

/** Finalize for escaped points */
export function finalizeEscape(
  state: AccumulatorState,
  zRe: number,
  zIm: number,
  dzRe: number,
  dzIm: number,
  smoothValue: number
): {
  stripeValue: number;
  decompAngle: number;
  orbitTrapDist: number;
  distanceEstimate: number;
} {
  // Catmull-Rom interpolation of stripe history (C1 smooth)
  // Standard: catmullRom(P0, P1, P2, P3, d) → d=0→P1, d=1→P2.
  // P1=stripeSum (escape iter), P2=extrapolated (next), P0/P3=tangent neighbors.
  const frac = smoothValue - Math.floor(smoothValue);
  const ext = 2 * state.stripeSum - state.stripePrev1;
  const interpolated = state.count >= 3
    ? catmullRom(state.stripePrev1, state.stripeSum, ext, 2 * ext - state.stripeSum, frac)
    : state.stripeSum + frac * (ext - state.stripeSum);
  const stripeValue = state.count > 0 ? interpolated / state.count : 0;

  const decompAngle = Math.atan2(zIm, zRe);
  const orbitTrapDist = Math.sqrt(state.trapDistSq);

  const zMod = Math.sqrt(zRe * zRe + zIm * zIm);
  const dzMod = Math.sqrt(dzRe * dzRe + dzIm * dzIm);
  const distanceEstimate = dzMod > 0 ? zMod * Math.log(zMod) / dzMod : 0;

  return { stripeValue, decompAngle, orbitTrapDist, distanceEstimate };
}

/** Finalize for interior points (Brent's cycle or maxIter) */
export function finalizeInterior(
  state: AccumulatorState
): {
  stripeValue: number;
  decompAngle: number;
  orbitTrapDist: number;
  distanceEstimate: number;
} {
  return {
    stripeValue: state.count > 0
      ? state.stripeSum / state.count
      : INTERIOR_COLORING_DEFAULTS.stripeValue,
    decompAngle: INTERIOR_COLORING_DEFAULTS.decompAngle,
    orbitTrapDist: state.trapDistSq < Infinity
      ? Math.sqrt(state.trapDistSq)
      : INTERIOR_COLORING_DEFAULTS.orbitTrapDist,
    distanceEstimate: INTERIOR_COLORING_DEFAULTS.distanceEstimate
  };
}
