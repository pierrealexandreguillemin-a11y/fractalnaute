/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Adaptive Iteration
 * Cardioid/bulb detection (Mandelbrot) + Brent's cycle detection (all)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Epsilon for periodicity comparison.
 * 1e-15 is conservative (near double-precision limit), avoiding false
 * positives at boundary regions while still catching cycles effectively.
 */
export const PERIOD_EPSILON = 1e-15;

/**
 * Brent's cycle detection — check if z matches reference point.
 * V8 inlines this trivially in the hot loop.
 */
export function isPeriodic(
  zRe: number, zIm: number,
  refRe: number, refIm: number
): boolean {
  return Math.abs(zRe - refRe) < PERIOD_EPSILON
      && Math.abs(zIm - refIm) < PERIOD_EPSILON;
}

/**
 * Mandelbrot cardioid test.
 * The main cardioid contains all c where the iteration converges
 * to a fixed point. These points never escape.
 *
 * Derivation: the cardioid boundary is r = (1/2)(1 - cos(θ))
 * centered at (1/4, 0). The algebraic test avoids trigonometry.
 */
export function isInCardioid(cRe: number, cIm: number): boolean {
  const q = (cRe - 0.25) * (cRe - 0.25) + cIm * cIm;
  return q * (q + (cRe - 0.25)) <= 0.25 * cIm * cIm;
}

/**
 * Mandelbrot period-2 bulb test.
 * The circular bulb to the left of the cardioid contains all c
 * where the iteration converges to a 2-cycle. Center (-1, 0), radius 1/4.
 */
export function isInBulb(cRe: number, cIm: number): boolean {
  return (cRe + 1) * (cRe + 1) + cIm * cIm <= 0.0625;
}
