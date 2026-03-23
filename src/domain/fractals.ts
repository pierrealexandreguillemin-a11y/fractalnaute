/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Fractal Calculators
 * Pure functions for different fractal set calculations
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalCalculator, FractalResult, FractalParams } from './types';
import { DEFAULT_JULIA_PARAMS, INTERIOR_COLORING_DEFAULTS } from './types';
import { isPeriodic, isInCardioid, isInBulb } from './periodicity';
import type { AccumulatorState } from './coloringAccumulator';
import {
  initAccumulator,
  updateAccumulator,
  finalizeEscape,
  finalizeInterior
} from './coloringAccumulator';

/** Build standard interior result — DRY: used by all calculators for cardioid/bulb/cycle/maxIter exits */
function interiorResult(maxIter: number): FractalResult {
  return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
}

/** Build interior result with accumulator data for accumulation paths */
function interiorResultWithAccum(maxIter: number, acc: AccumulatorState): FractalResult {
  return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...finalizeInterior(acc) };
}

/**
 * Smooth coloring helper
 */
/** Pre-computed ln(2) for the default logBase */
const LN2 = Math.LN2;

function smoothEscape(iter: number, zRe2: number, zIm2: number, logBase: number = 2): number {
  const logZn = Math.log(zRe2 + zIm2) / 2;
  const logLogBase = logBase === 2 ? LN2 : Math.log(logBase);
  return iter + 1 - Math.log(logZn / logLogBase) / logLogBase;
}

/**
 * Mandelbrot fast path — no accumulation, bailout = 4
 */
function mandelbrotFastPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  if (isInCardioid(cRe, cIm) || isInBulb(cRe, cIm)) {
    return interiorResult(maxIter);
  }

  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResult(maxIter);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResult(maxIter);
  }

  return {
    iterations: iter, escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2),
    ...INTERIOR_COLORING_DEFAULTS
  };
}

/**
 * Mandelbrot accumulation path — derivative + coloring data, bailout = 1e12
 */
function mandelbrotAccumPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  if (isInCardioid(cRe, cIm) || isInBulb(cRe, cIm)) {
    return interiorResult(maxIter);
  }

  const acc = initAccumulator();
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let dzRe = 0, dzIm = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 1e12 && iter < maxIter) {
    // dz = 2*z*dz + 1
    const newDzRe = 2 * (zRe * dzRe - zIm * dzIm) + 1;
    const newDzIm = 2 * (zRe * dzIm + zIm * dzRe);
    dzRe = newDzRe;
    dzIm = newDzIm;

    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    updateAccumulator(acc, zRe, zIm);

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResultWithAccum(maxIter, acc);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResultWithAccum(maxIter, acc);
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Classic Mandelbrot: z → z² + c
 */
export const calculateMandelbrot: FractalCalculator = (cRe, cIm, maxIter, _params, accumulate) => {
  if (accumulate) return mandelbrotAccumPath(cRe, cIm, maxIter);
  return mandelbrotFastPath(cRe, cIm, maxIter);
};

/**
 * Julia fast path — no accumulation, bailout = 4
 */
function juliaFastPath(
  z0Re: number, z0Im: number, maxIter: number, params: FractalParams
): FractalResult {
  const cRe = params.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!;
  const cIm = params.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!;

  let zRe = z0Re, zIm = z0Im;
  let zRe2 = zRe * zRe, zIm2 = zIm * zIm;
  let iter = 0;
  let refRe = z0Re, refIm = z0Im, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResult(maxIter);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResult(maxIter);
  }

  return {
    iterations: iter, escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2),
    ...INTERIOR_COLORING_DEFAULTS
  };
}

/**
 * Julia accumulation path — derivative + coloring data, bailout = 1e12
 */
function juliaAccumPath(
  z0Re: number, z0Im: number, maxIter: number, params: FractalParams
): FractalResult {
  const cRe = params.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!;
  const cIm = params.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!;

  const acc = initAccumulator();
  // Include z₀ in orbit trap — Julia starts at z₀ = pixel position, not origin
  updateAccumulator(acc, z0Re, z0Im);
  let zRe = z0Re, zIm = z0Im;
  let zRe2 = zRe * zRe, zIm2 = zIm * zIm;
  let iter = 0;
  // dz₀/dz₀ = 1
  let dzRe = 1, dzIm = 0;
  let refRe = z0Re, refIm = z0Im, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 1e12 && iter < maxIter) {
    // dz = 2*z*dz (no +1 — c is constant in Julia)
    const newDzRe = 2 * (zRe * dzRe - zIm * dzIm);
    const newDzIm = 2 * (zRe * dzIm + zIm * dzRe);
    dzRe = newDzRe;
    dzIm = newDzIm;

    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    updateAccumulator(acc, zRe, zIm);

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResultWithAccum(maxIter, acc);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResultWithAccum(maxIter, acc);
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Julia set: z → z² + c (c is fixed, z₀ varies)
 * The magic: each point c on Mandelbrot generates a unique Julia set
 */
export const calculateJulia: FractalCalculator = (z0Re, z0Im, maxIter, params, accumulate) => {
  if (accumulate) return juliaAccumPath(z0Re, z0Im, maxIter, params);
  return juliaFastPath(z0Re, z0Im, maxIter, params);
};

/**
 * Burning Ship fast path — no accumulation, bailout = 4
 */
function burningShipFastPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    const absRe = Math.abs(zRe);
    const absIm = Math.abs(zIm);
    const newRe = absRe * absRe - absIm * absIm + cRe;
    zIm = 2 * absRe * absIm + cIm;
    zRe = newRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResult(maxIter);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResult(maxIter);
  }

  return {
    iterations: iter, escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2),
    ...INTERIOR_COLORING_DEFAULTS
  };
}

/**
 * Burning Ship accumulation path — derivative + coloring data, bailout = 1e12
 */
function burningShipAccumPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  const acc = initAccumulator();
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let dzRe = 0, dzIm = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 1e12 && iter < maxIter) {
    const absRe = Math.abs(zRe);
    const absIm = Math.abs(zIm);

    // Derivative uses folded z components (absolute values)
    const newDzRe = 2 * (absRe * dzRe - absIm * dzIm) + 1;
    const newDzIm = 2 * (absRe * dzIm + absIm * dzRe);
    dzRe = newDzRe;
    dzIm = newDzIm;

    const newRe = absRe * absRe - absIm * absIm + cRe;
    zIm = 2 * absRe * absIm + cIm;
    zRe = newRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    updateAccumulator(acc, zRe, zIm);

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResultWithAccum(maxIter, acc);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResultWithAccum(maxIter, acc);
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Burning Ship: z → (|Re(z)| + i|Im(z)|)² + c
 * Discovered by Michael Michelitsch and Otto E. Rössler in 1992
 */
export const calculateBurningShip: FractalCalculator = (cRe, cIm, maxIter, _params, accumulate) => {
  if (accumulate) return burningShipAccumPath(cRe, cIm, maxIter);
  return burningShipFastPath(cRe, cIm, maxIter);
};

/**
 * Tricorn fast path — no accumulation, bailout = 4
 */
function tricornFastPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    const newRe = zRe2 - zIm2 + cRe;
    zIm = -2 * zRe * zIm + cIm; // Negative sign = conjugate
    zRe = newRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResult(maxIter);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResult(maxIter);
  }

  return {
    iterations: iter, escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2),
    ...INTERIOR_COLORING_DEFAULTS
  };
}

/**
 * Tricorn accumulation path — derivative + coloring data, bailout = 1e12
 * @tradeoff: Tricorn is anti-holomorphic. DE is approximate, visually acceptable.
 */
function tricornAccumPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  const acc = initAccumulator();
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  let dzRe = 0, dzIm = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe2 + zIm2 <= 1e12 && iter < maxIter) {
    // Approximate derivative (anti-holomorphic — not exact)
    const newDzRe = 2 * (zRe * dzRe + zIm * dzIm) + 1;
    const newDzIm = 2 * (-zRe * dzIm + zIm * dzRe);
    dzRe = newDzRe;
    dzIm = newDzIm;

    const newRe = zRe2 - zIm2 + cRe;
    zIm = -2 * zRe * zIm + cIm; // Negative sign = conjugate
    zRe = newRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;

    updateAccumulator(acc, zRe, zIm);

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResultWithAccum(maxIter, acc);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResultWithAccum(maxIter, acc);
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Tricorn (Mandelbar): z → conj(z)² + c
 * Uses complex conjugate, creating different symmetry
 */
export const calculateTricorn: FractalCalculator = (cRe, cIm, maxIter, _params, accumulate) => {
  if (accumulate) return tricornAccumPath(cRe, cIm, maxIter);
  return tricornFastPath(cRe, cIm, maxIter);
};

/**
 * Multibrot fast path — no accumulation, bailout = 4
 */
function multibrotFastPath(
  cRe: number, cIm: number, maxIter: number, n: number
): FractalResult {
  let zRe = 0, zIm = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    // z^n by direct complex multiplication
    let pRe = zRe, pIm = zIm;
    for (let k = 1; k < n; k++) {
      const tmpRe = pRe * zRe - pIm * zIm;
      const tmpIm = pRe * zIm + pIm * zRe;
      pRe = tmpRe;
      pIm = tmpIm;
    }
    zRe = pRe + cRe;
    zIm = pIm + cIm;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResult(maxIter);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResult(maxIter);
  }

  const mod2 = zRe * zRe + zIm * zIm;
  return {
    iterations: iter, escaped: true,
    smoothValue: smoothEscape(iter, mod2, 0, n),
    ...INTERIOR_COLORING_DEFAULTS
  };
}

/**
 * Multibrot accumulation path — derivative + coloring data, bailout = 1e12
 * Derivative: dz = n * z^(n-1) * dz + 1
 */
function multibrotAccumPath(
  cRe: number, cIm: number, maxIter: number, n: number
): FractalResult {
  const acc = initAccumulator();
  let zRe = 0, zIm = 0, iter = 0;
  let dzRe = 0, dzIm = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe * zRe + zIm * zIm <= 1e12 && iter < maxIter) {
    // z^n with z^(n-1) capture for derivative
    let pRe = zRe, pIm = zIm;
    let prevPRe = 1, prevPIm = 0; // z^0 = 1 (for n=1 edge case)
    for (let k = 1; k < n; k++) {
      prevPRe = pRe;
      prevPIm = pIm;
      const tmpRe = pRe * zRe - pIm * zIm;
      const tmpIm = pRe * zIm + pIm * zRe;
      pRe = tmpRe;
      pIm = tmpIm;
    }
    // prevPRe,prevPIm = z^(n-1); pRe,pIm = z^n

    // dz = n * z^(n-1) * dz + 1
    const newDzRe = n * (prevPRe * dzRe - prevPIm * dzIm) + 1;
    const newDzIm = n * (prevPRe * dzIm + prevPIm * dzRe);
    dzRe = newDzRe;
    dzIm = newDzIm;

    zRe = pRe + cRe;
    zIm = pIm + cIm;
    iter++;

    updateAccumulator(acc, zRe, zIm);

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return interiorResultWithAccum(maxIter, acc);
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return interiorResultWithAccum(maxIter, acc);
  }

  const mod2 = zRe * zRe + zIm * zIm;
  const sv = smoothEscape(iter, mod2, 0, n);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Multibrot: z → zⁿ + c (generalized Mandelbrot)
 * n=2 is classic Mandelbrot, higher n gives n-fold rotational symmetry
 */
export const calculateMultibrot: FractalCalculator = (cRe, cIm, maxIter, params, accumulate) => {
  // @tradeoff Integer powers only — direct multiplication replaces polar form.
  // Non-integer power (e.g. 2.5) silently rounds to nearest integer.
  const n = Math.round(params.power ?? 3);
  if (accumulate) return multibrotAccumPath(cRe, cIm, maxIter, n);
  return multibrotFastPath(cRe, cIm, maxIter, n);
};

