/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coloring Accumulator
 * Stripe average + orbit trap tracking during fractal iteration.
 * Derivative is NOT here — it's fractal-specific, inlined in calculators.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { INTERIOR_COLORING_DEFAULTS } from './types';

/** Mutable state tracked during iteration */
export interface AccumulatorState {
  stripeSum: number;
  prevStripeSum: number;
  trapDistSq: number;
  count: number;
}

/**
 * Stripe frequency parameter — higher values create finer stripes.
 * Standard value from Harkonen stripe average coloring.
 * @see https://www.math.univ-toulouse.fr/~music/Research/stripeAverage.pdf
 */
export const STRIPE_DENSITY = 5;

export function initAccumulator(): AccumulatorState {
  return { stripeSum: 0, prevStripeSum: 0, trapDistSq: Infinity, count: 0 };
}

/**
 * Update per iteration — called inside the hot loop.
 * Only stripe average + orbit trap. No derivative (fractal-specific).
 */
export function updateAccumulator(
  state: AccumulatorState,
  zRe: number,
  zIm: number
): void {
  const arg = Math.atan2(zIm, zRe);
  state.prevStripeSum = state.stripeSum;
  state.stripeSum += 0.5 * Math.sin(STRIPE_DENSITY * arg) + 0.5;
  state.count++;

  const distSq = zRe * zRe + zIm * zIm;
  if (distSq < state.trapDistSq) {
    state.trapDistSq = distSq;
  }
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
  const frac = smoothValue - Math.floor(smoothValue);
  const rawLerped = state.prevStripeSum + frac * (state.stripeSum - state.prevStripeSum);
  const stripeValue = state.count > 0 ? rawLerped / state.count : 0;

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
