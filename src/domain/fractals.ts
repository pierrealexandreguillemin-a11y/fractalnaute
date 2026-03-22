/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Fractal Calculators
 * Pure functions for different fractal set calculations
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalCalculator, FractalResult, FractalParams } from './types';
import { DEFAULT_JULIA_PARAMS, INTERIOR_COLORING_DEFAULTS } from './types';
import { isPeriodic, isInCardioid, isInBulb } from './periodicity';
import {
  initAccumulator,
  updateAccumulator,
  finalizeEscape,
  finalizeInterior
} from './coloringAccumulator';

/**
 * Smooth coloring helper
 */
function smoothEscape(iter: number, zRe2: number, zIm2: number, logBase: number = 2): number {
  const logZn = Math.log(zRe2 + zIm2) / 2;
  return iter + 1 - Math.log(logZn / Math.log(logBase)) / Math.log(logBase);
}

/**
 * Mandelbrot fast path — no accumulation, bailout = 4
 */
function mandelbrotFastPath(cRe: number, cIm: number, maxIter: number): FractalResult {
  if (isInCardioid(cRe, cIm) || isInBulb(cRe, cIm)) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
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
      return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
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
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
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
      const interior = finalizeInterior(acc);
      return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...interior };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    const interior = finalizeInterior(acc);
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...interior };
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Classic Mandelbrot: z → z² + c
 */
export const calculateMandelbrot: FractalCalculator = (cRe, cIm, maxIter, params) => {
  if (params._needsAccumulation) {
    return mandelbrotAccumPath(cRe, cIm, maxIter);
  }
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
      return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...INTERIOR_COLORING_DEFAULTS };
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
      const interior = finalizeInterior(acc);
      return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...interior };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    const interior = finalizeInterior(acc);
    return { iterations: maxIter, escaped: false, smoothValue: maxIter, ...interior };
  }

  const sv = smoothEscape(iter, zRe2, zIm2);
  const escape = finalizeEscape(acc, zRe, zIm, dzRe, dzIm, sv);
  return { iterations: iter, escaped: true, smoothValue: sv, ...escape };
}

/**
 * Julia set: z → z² + c (c is fixed, z₀ varies)
 * The magic: each point c on Mandelbrot generates a unique Julia set
 */
export const calculateJulia: FractalCalculator = (z0Re, z0Im, maxIter, params) => {
  if (params._needsAccumulation) {
    return juliaAccumPath(z0Re, z0Im, maxIter, params);
  }
  return juliaFastPath(z0Re, z0Im, maxIter, params);
};

/**
 * Burning Ship: z → (|Re(z)| + i|Im(z)|)² + c
 * Discovered by Michael Michelitsch and Otto E. Rössler in 1992
 */
export const calculateBurningShip: FractalCalculator = (cRe, cIm, maxIter) => {
  let zRe = 0, zIm = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    const absRe = Math.abs(zRe);
    const absIm = Math.abs(zIm);
    const newRe = absRe * absRe - absIm * absIm + cRe;
    zIm = 2 * absRe * absIm + cIm;
    zRe = newRe;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return { iterations: maxIter, escaped: false, smoothValue: maxIter };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter };
  }

  const mod2 = zRe * zRe + zIm * zIm;
  return {
    iterations: iter,
    escaped: true,
    smoothValue: smoothEscape(iter, mod2, 0)
  };
};

/**
 * Tricorn (Mandelbar): z → conj(z)² + c
 * Uses complex conjugate, creating different symmetry
 */
export const calculateTricorn: FractalCalculator = (cRe, cIm, maxIter) => {
  let zRe = 0, zIm = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    const newRe = zRe * zRe - zIm * zIm + cRe;
    zIm = -2 * zRe * zIm + cIm; // Negative sign = conjugate
    zRe = newRe;
    iter++;

    if (isPeriodic(zRe, zIm, refRe, refIm)) {
      return { iterations: maxIter, escaped: false, smoothValue: maxIter };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter };
  }

  const mod2 = zRe * zRe + zIm * zIm;
  return {
    iterations: iter,
    escaped: true,
    smoothValue: smoothEscape(iter, mod2, 0)
  };
};

/**
 * Multibrot: z → zⁿ + c (generalized Mandelbrot)
 * n=2 is classic Mandelbrot, higher n gives n-fold rotational symmetry
 */
export const calculateMultibrot: FractalCalculator = (cRe, cIm, maxIter, params) => {
  // @tradeoff Integer powers only — direct multiplication replaces polar form.
  // Non-integer power (e.g. 2.5) silently rounds to nearest integer.
  const n = Math.round(params.power ?? 3);
  let zRe = 0, zIm = 0, iter = 0;
  let refRe = 0, refIm = 0, period = 1, counter = 0;

  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    // z^n by direct complex multiplication (avoids 5 transcendental calls per iteration)
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
      return { iterations: maxIter, escaped: false, smoothValue: maxIter };
    }
    if (++counter >= period) {
      refRe = zRe; refIm = zIm;
      period <<= 1; counter = 0;
    }
  }

  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter };
  }

  const mod2 = zRe * zRe + zIm * zIm;
  return {
    iterations: iter,
    escaped: true,
    smoothValue: smoothEscape(iter, mod2, 0, n)
  };
};

