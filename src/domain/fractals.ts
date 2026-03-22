/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Fractal Calculators
 * Pure functions for different fractal set calculations
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalCalculator } from './types';
import { DEFAULT_JULIA_PARAMS } from './types';

/**
 * Smooth coloring helper
 */
function smoothEscape(iter: number, zRe2: number, zIm2: number, logBase: number = 2): number {
  const logZn = Math.log(zRe2 + zIm2) / 2;
  return iter + 1 - Math.log(logZn / Math.log(logBase)) / Math.log(logBase);
}

/**
 * Classic Mandelbrot: z → z² + c
 */
export const calculateMandelbrot: FractalCalculator = (cRe, cIm, maxIter) => {
  let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
  
  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;
  }
  
  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter };
  }
  
  return {
    iterations: iter,
    escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2)
  };
};

/**
 * Julia set: z → z² + c (c is fixed, z₀ varies)
 * The magic: each point c on Mandelbrot generates a unique Julia set
 */
export const calculateJulia: FractalCalculator = (z0Re, z0Im, maxIter, params) => {
  const cRe = params.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!;
  const cIm = params.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!;
  
  let zRe = z0Re, zIm = z0Im;
  let zRe2 = zRe * zRe, zIm2 = zIm * zIm;
  let iter = 0;
  
  while (zRe2 + zIm2 <= 4 && iter < maxIter) {
    zIm = 2 * zRe * zIm + cIm;
    zRe = zRe2 - zIm2 + cRe;
    zRe2 = zRe * zRe;
    zIm2 = zIm * zIm;
    iter++;
  }
  
  if (iter === maxIter) {
    return { iterations: maxIter, escaped: false, smoothValue: maxIter };
  }
  
  return {
    iterations: iter,
    escaped: true,
    smoothValue: smoothEscape(iter, zRe2, zIm2)
  };
};

/**
 * Burning Ship: z → (|Re(z)| + i|Im(z)|)² + c
 * Discovered by Michael Michelitsch and Otto E. Rössler in 1992
 */
export const calculateBurningShip: FractalCalculator = (cRe, cIm, maxIter) => {
  let zRe = 0, zIm = 0, iter = 0;
  
  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    const absRe = Math.abs(zRe);
    const absIm = Math.abs(zIm);
    const newRe = absRe * absRe - absIm * absIm + cRe;
    zIm = 2 * absRe * absIm + cIm;
    zRe = newRe;
    iter++;
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
  
  while (zRe * zRe + zIm * zIm <= 4 && iter < maxIter) {
    const newRe = zRe * zRe - zIm * zIm + cRe;
    zIm = -2 * zRe * zIm + cIm; // Negative sign = conjugate
    zRe = newRe;
    iter++;
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

