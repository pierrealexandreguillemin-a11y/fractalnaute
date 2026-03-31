/**
 * GPU/CPU mathematical parity tests.
 *
 * Verifies that GLSL formulas (re-implemented in TypeScript) produce
 * the same outputs as the CPU domain functions for known inputs.
 * Catches formula transcription errors without needing a browser.
 *
 * Known GPU/CPU divergences (intentional, documented here):
 * - Bailout: GPU uses 4.0, CPU accumulate path uses 1e12 (better DE quality)
 * - trapDistSq init: GPU 1e20, CPU Infinity (GPU float has no Inf literal)
 * - PI precision: GPU GLSL uses 3.14159265 (~8 digits), CPU uses Math.PI (~15)
 * These don't affect formula parity tests (both sides run in float64 here).
 *
 * @mirror infrastructure/gpu/shaders/index.ts
 */
import { describe, it, expect } from 'vitest';
import { screenToComplex } from '../../../domain/coordinates';
import { calculateMandelbrot, calculateMultibrot } from '../../../domain/fractals';
import {
  mapToColorParam, COLOR_CYCLE_PERIOD, ORBIT_TRAP_CYCLE,
  NORMAL_MAP_LIGHT_ANGLE, computeNormalLightness, mapInteriorToParam
} from '../../../domain/coloringModes';
import {
  initAccumulator, updateAccumulator, finalizeEscape
} from '../../../domain/coloringAccumulator';
import { isInCardioid, isInBulb } from '../../../domain/periodicity';
import type { FractalResult } from '../../../domain/types';

// ---- Test helpers -----------------------------------------------------------

/** Factory for escaped FractalResult with sensible defaults */
function makeEscapedResult(overrides: Partial<FractalResult> = {}): FractalResult {
  return {
    iterations: 50, escaped: true, smoothValue: 10.5,
    stripeValue: 0, decompAngle: 0, orbitTrapDist: 1, distanceEstimate: 0,
    ...overrides,
  };
}

/**
 * Run Mandelbrot iteration with both CPU and GPU accumulators (bailout=4).
 * Shared helper — eliminates duplicated iteration loops in end-to-end tests.
 */
function iterateMandelbrot(cRe: number, cIm: number) {
  const gpuAcc = gpuInitAccumulator();
  const cpuAcc = initAccumulator();
  let zRe = 0, zIm = 0, iter = 0;
  let dzRe = 0, dzIm = 0;

  while (zRe * zRe + zIm * zIm <= 4 && iter < 256) {
    const newDzRe = 2 * (zRe * dzRe - zIm * dzIm) + 1;
    const newDzIm = 2 * (zRe * dzIm + zIm * dzRe);
    dzRe = newDzRe; dzIm = newDzIm;

    const newIm = 2 * zRe * zIm + cIm;
    const newRe = zRe * zRe - zIm * zIm + cRe;
    zRe = newRe; zIm = newIm;

    updateAccumulator(cpuAcc, zRe, zIm);
    gpuUpdateAccumulator(zRe, zIm, gpuAcc);
    iter++;
  }

  const mod2 = zRe * zRe + zIm * zIm;
  return {
    zRe, zIm, dzRe, dzIm, iter,
    smoothVal: gpuSmoothEscape(iter, mod2),
    gpuAcc, cpuAcc,
  };
}

// ---- GPU-equivalent helpers (replicate GLSL in TypeScript) ------------------

/**
 * GPU screenToComplex — mirrors shaders/index.ts:screenToComplexChunk.
 * Uses pixel-center convention (gl_FragCoord = pixel + 0.5) with Y negated.
 */
function gpuScreenToComplex(
  fragX: number, fragY: number,
  centerRe: number, centerIm: number,
  scale: number, width: number, height: number
): { re: number; im: number } {
  const aspect = width / height;
  const uvX = fragX / width - 0.5;
  const uvY = fragY / height - 0.5;
  return {
    re: centerRe + uvX * scale * aspect,
    im: centerIm + (-uvY) * scale,
  };
}

/**
 * GPU smoothEscape — mirrors shaders/index.ts:smoothEscapeChunk.
 * float(iter) + 1.0 - log2(0.5 * log2(mod2))
 */
function gpuSmoothEscape(iter: number, mod2: number): number {
  return iter + 1.0 - Math.log2(0.5 * Math.log2(mod2));
}

/**
 * GPU smoothEscapeGeneral — mirrors shaders/index.ts:smoothEscapeChunk.
 * Generalized version for Multibrot with logBase=n.
 * float(iter) + 1.0 - log(log(mod2)*0.5 / lnBase) / lnBase
 */
function gpuSmoothEscapeGeneral(iter: number, mod2: number, logBase: number): number {
  const lnBase = Math.log(logBase);
  const logZn = Math.log(mod2) * 0.5;
  return iter + 1.0 - Math.log(logZn / lnBase) / lnBase;
}

/**
 * CPU smoothEscape — mirrors domain/fractals.ts:smoothEscape (logBase=2).
 * iter + 1 - log(logZn / ln2) / ln2
 */
function cpuSmoothEscape(iter: number, zRe2: number, zIm2: number): number {
  const LN2 = Math.LN2;
  const logZn = Math.log(zRe2 + zIm2) / 2;
  return iter + 1 - Math.log(logZn / LN2) / LN2;
}

/**
 * GPU cardioid pre-test — mirrors shaders/index.ts:mandelbrotIterationChunk.
 * q*(q + x_minus_quarter) <= 0.25*y2
 */
function gpuIsInCardioid(cRe: number, cIm: number): boolean {
  const xmq = cRe - 0.25;
  const y2 = cIm * cIm;
  const q = xmq * xmq + y2;
  return q * (q + xmq) <= 0.25 * y2;
}

/** GPU bulb test — mirrors shaders/index.ts:mandelbrotIterationChunk. */
function gpuIsInBulb(cRe: number, cIm: number): boolean {
  const xp1 = cRe + 1.0;
  return xp1 * xp1 + cIm * cIm <= 0.0625;
}

// ---- GPU-equivalent helpers for coloring modes ------------------------------

/** GPU accumulator state — mirrors AccumState struct in accumulatorRealChunk */
interface GpuAccumState {
  stripeSum: number;
  stripePrev1: number;
  stripePrev2: number;
  stripePrev3: number;
  trapDistSq: number;
  count: number;
}

/** @mirror shaders/index.ts:accumulatorRealChunk — initAccumulator */
function gpuInitAccumulator(): GpuAccumState {
  return { stripeSum: 0, stripePrev1: 0, stripePrev2: 0, stripePrev3: 0, trapDistSq: 1e20, count: 0 };
}

/** @mirror shaders/index.ts:accumulatorRealChunk — updateAccumulator */
function gpuUpdateAccumulator(zRe: number, zIm: number, acc: GpuAccumState): void {
  acc.stripePrev3 = acc.stripePrev2;
  acc.stripePrev2 = acc.stripePrev1;
  acc.stripePrev1 = acc.stripeSum;
  const zz = zRe * zRe + zIm * zIm;
  if (zz > 0) {
    acc.stripeSum += zRe * zIm / zz;
  }
  acc.count++;

  if (zz < acc.trapDistSq) {
    acc.trapDistSq = zz;
  }
}

/**
 * Catmull-Rom cubic interpolation — mirrors GLSL catmullRom in stripeColoringChunk.
 */
function catmullRom(s0: number, s1: number, s2: number, s3: number, d: number): number {
  const d2 = d * d, d3 = d * d2;
  return 0.5 * (
    s0 * (-d + 2 * d2 - d3) +
    s1 * (2 - 5 * d2 + 3 * d3) +
    s2 * (d + 4 * d2 - 3 * d3) +
    s3 * (d3 - d2)
  );
}

/**
 * @mirror shaders/index.ts:stripeColoringChunk — mapToParam
 * GPU does finalization + mapping in one step (no separate finalizeEscape).
 * Stripe as primary signal with Catmull-Rom interpolation.
 */
function gpuStripeMapToParam(smoothVal: number, acc: GpuAccumState, maxIter: number = 256): number {
  const frac = smoothVal - Math.floor(smoothVal);
  const ext = 2 * acc.stripeSum - acc.stripePrev1;
  const interpolated = acc.count >= 3
    ? catmullRom(acc.stripePrev1, acc.stripeSum, ext, 2 * ext - acc.stripeSum, frac)
    : acc.stripeSum + frac * (ext - acc.stripeSum);
  const stripeRatio = acc.count > 0 ? interpolated / acc.count : 0;
  // @mirror deep-mandelbrot: stripe amplitude + iteration frequency
  const amplitude = 0.7 + 2.5 * stripeRatio;
  const frequency = 50.0 * smoothVal / maxIter;
  return amplitude + frequency;
}

/** @mirror shaders/index.ts:decompositionColoringChunk — mapToParam */
function gpuDecompMapToParam(zRe: number, zIm: number): number {
  const angle = Math.atan2(zIm, zRe);
  return angle >= 0 ? 0.15 : 0.65;
}

/** @mirror shaders/index.ts:orbitTrapColoringChunk — mapToParam */
function gpuTrapMapToParam(smoothVal: number, trapDistSq: number): number {
  const d = Math.min(Math.sqrt(trapDistSq), 4);
  const logMapped = Math.log(1 + d) / Math.log(5);
  const base = (smoothVal % ORBIT_TRAP_CYCLE) / ORBIT_TRAP_CYCLE;
  return (logMapped * 0.6 + base * 0.4) % 1;
}

/** @mirror shaders/index.ts:normalMapColoringChunk — mapToParam */
function gpuNormalMapToParam(smoothVal: number, zRe: number, zIm: number): number {
  const base = (smoothVal % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  const angle = Math.atan2(zIm, zRe);
  const angleNorm = (angle + Math.PI) / (2 * Math.PI);
  return (base * 0.7 + angleNorm * 0.3) % 1;
}

/** @mirror shaders/index.ts:normalMapColoringChunk — computeLightness */
function gpuComputeNormalLightness(
  zRe: number, zIm: number, dzRe: number, dzIm: number
): number {
  const zMod = Math.sqrt(zRe * zRe + zIm * zIm);
  const dzMod = Math.sqrt(dzRe * dzRe + dzIm * dzIm);
  const de = dzMod > 0 ? zMod * Math.log(zMod) / dzMod : 0;
  if (de <= 0) return 0.5;
  const dotL = Math.cos(Math.atan2(zIm, zRe) - NORMAL_MAP_LIGHT_ANGLE);
  const logDE = Math.log(1 + de * 10);
  const height = Math.min(logDE / 3, 1);
  return 0.2 + 1.2 * (dotL * 0.5 + 0.5) * (0.3 + 0.7 * height);
}

/** @mirror shaders/index.ts:mainChunk — interior coloring branch */
function gpuInteriorParam(trapDistSq: number): number {
  const trapDist = Math.sqrt(trapDistSq);
  return Math.min(trapDist, 2) / 2;
}

// ---- Tests ------------------------------------------------------------------

describe('GPU/CPU parity — screenToComplex', () => {
  const cases = [
    { x: 960, y: 456, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 0, y: 0, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 1919, y: 911, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 480, y: 228, cRe: -1.0, cIm: 0.3, scale: 0.5, w: 1920, h: 912 },
  ];

  for (const tc of cases) {
    it(`pixel (${tc.x}, ${tc.y})`, () => {
      const cpu = screenToComplex(tc.x, tc.y, tc.w, tc.h, {
        centerRe: tc.cRe, centerIm: tc.cIm, scale: tc.scale,
      });
      const glFragX = tc.x + 0.5;
      const glFragY = tc.h - tc.y - 0.5;
      const gpu = gpuScreenToComplex(
        glFragX, glFragY, tc.cRe, tc.cIm, tc.scale, tc.w, tc.h,
      );
      // Difference is exactly half-pixel offset (sub-pixel, expected)
      const halfPixelRe = 0.5 / tc.w * tc.scale * (tc.w / tc.h);
      const halfPixelIm = 0.5 / tc.h * tc.scale;
      expect(gpu.re - cpu.re).toBeCloseTo(halfPixelRe, 10);
      expect(gpu.im - cpu.im).toBeCloseTo(halfPixelIm, 10);
    });
  }
});

describe('GPU/CPU parity — smoothEscape', () => {
  const cases = [
    { iter: 10, zRe: 2.1, zIm: 0.5 },
    { iter: 50, zRe: 1.5, zIm: 1.8 },
    { iter: 100, zRe: 3.0, zIm: 0.1 },
    { iter: 255, zRe: 2.001, zIm: 0.001 },
  ];

  for (const tc of cases) {
    it(`iter=${tc.iter}, z=(${tc.zRe}, ${tc.zIm})`, () => {
      const zRe2 = tc.zRe * tc.zRe;
      const zIm2 = tc.zIm * tc.zIm;
      const mod2 = zRe2 + zIm2;
      const gpuVal = gpuSmoothEscape(tc.iter, mod2);
      const cpuVal = cpuSmoothEscape(tc.iter, zRe2, zIm2);
      expect(gpuVal).toBeCloseTo(cpuVal, 10);
    });
  }
});

describe('GPU/CPU parity — smoothEscapeGeneral (Multibrot)', () => {
  const cases = [
    { iter: 10, mod2: 5.0, logBase: 3 },
    { iter: 50, mod2: 10.0, logBase: 4 },
    { iter: 100, mod2: 20.0, logBase: 5 },
    { iter: 25, mod2: 6.5, logBase: 3 },
  ];

  for (const tc of cases) {
    it(`iter=${tc.iter}, mod2=${tc.mod2}, logBase=${tc.logBase}`, () => {
      const gpuVal = gpuSmoothEscapeGeneral(tc.iter, tc.mod2, tc.logBase);
      const lnBase = Math.log(tc.logBase);
      const logZn = Math.log(tc.mod2) / 2;
      const cpuVal = tc.iter + 1 - Math.log(logZn / lnBase) / lnBase;
      expect(gpuVal).toBeCloseTo(cpuVal, 10);
    });
  }

  it('Multibrot escape uses logBase=n, matching CPU', () => {
    const result = calculateMultibrot(1.0, 0.0, 256, { power: 3 });
    expect(result.escaped).toBe(true);

    let zRe = 0, zIm = 0, iter = 0;
    while (zRe * zRe + zIm * zIm <= 4 && iter < 256) {
      let pRe = zRe, pIm = zIm;
      for (let k = 1; k < 3; k++) {
        const tmpRe = pRe * zRe - pIm * zIm;
        const tmpIm = pRe * zIm + pIm * zRe;
        pRe = tmpRe;
        pIm = tmpIm;
      }
      zRe = pRe + 1.0;
      zIm = pIm + 0.0;
      iter++;
    }

    const mod2 = zRe * zRe + zIm * zIm;
    const gpuSmooth = gpuSmoothEscapeGeneral(iter, mod2, 3);
    expect(gpuSmooth).toBeCloseTo(result.smoothValue, 8);
  });
});

describe('GPU/CPU parity — classic coloring mapToParam', () => {
  it('produces same t for given smoothValues', () => {
    const smoothValues = [0.5, 42.7, 128.3, 255.9, 300.1];
    for (const sv of smoothValues) {
      const cpuT = mapToColorParam(makeEscapedResult({ smoothValue: sv }), 'classic');
      const gpuT = (sv % COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
      expect(gpuT).toBeCloseTo(cpuT, 10);
    }
  });
});

describe('GPU/CPU parity — cardioid/bulb pre-test', () => {
  const cardioidPoints = [
    { re: 0.0, im: 0.0 },
    { re: -0.5, im: 0.0 },
    { re: 0.24, im: 0.0 },
  ];

  for (const p of cardioidPoints) {
    it(`cardioid agrees at (${p.re}, ${p.im})`, () => {
      expect(gpuIsInCardioid(p.re, p.im)).toBe(isInCardioid(p.re, p.im));
      const result = calculateMandelbrot(p.re, p.im, 256, {});
      expect(result.escaped).toBe(false);
    });
  }

  const bulbPoints = [{ re: -1.0, im: 0.0 }];

  for (const p of bulbPoints) {
    it(`bulb agrees at (${p.re}, ${p.im})`, () => {
      expect(gpuIsInBulb(p.re, p.im)).toBe(isInBulb(p.re, p.im));
      const result = calculateMandelbrot(p.re, p.im, 256, {});
      expect(result.escaped).toBe(false);
    });
  }

  it('exterior point rejected by both', () => {
    expect(gpuIsInCardioid(2.0, 0.0)).toBe(false);
    expect(isInCardioid(2.0, 0.0)).toBe(false);
    expect(gpuIsInBulb(2.0, 0.0)).toBe(false);
    expect(isInBulb(2.0, 0.0)).toBe(false);
  });
});

describe('GPU/CPU parity — Mandelbrot iteration agreement', () => {
  const escapingPoints = [
    { cRe: 0.5, cIm: 0.5 },
    { cRe: -2.0, cIm: 0.5 },
    { cRe: 1.0, cIm: 0.0 },
  ];

  for (const p of escapingPoints) {
    it(`escape match at c=(${p.cRe}, ${p.cIm})`, () => {
      const result = calculateMandelbrot(p.cRe, p.cIm, 256, {});
      expect(result.escaped).toBe(true);

      // Re-run iteration manually to capture final z for GPU formula
      let zRe = 0, zIm = 0, zRe2 = 0, zIm2 = 0, iter = 0;
      while (zRe2 + zIm2 <= 4 && iter < 256) {
        zIm = 2 * zRe * zIm + p.cIm;
        zRe = zRe2 - zIm2 + p.cRe;
        zRe2 = zRe * zRe;
        zIm2 = zIm * zIm;
        iter++;
      }

      const mod2 = zRe2 + zIm2;
      const gpuSmooth = gpuSmoothEscape(iter, mod2);
      expect(gpuSmooth).toBeCloseTo(result.smoothValue, 8);
    });
  }
});

// ---- Coloring mode parity tests ---------------------------------------------

describe('GPU/CPU parity — accumulator', () => {
  const zSequence = [
    { re: 0.3, im: 0.5 },
    { re: -0.2, im: 0.8 },
    { re: 1.1, im: -0.3 },
    { re: 0.05, im: 0.05 },
    { re: -1.5, im: 1.2 },
  ];

  it('per-iteration stripeSum and count match', () => {
    const cpuAcc = initAccumulator();
    const gpuAcc = gpuInitAccumulator();

    for (const z of zSequence) {
      updateAccumulator(cpuAcc, z.re, z.im);
      gpuUpdateAccumulator(z.re, z.im, gpuAcc);

      expect(gpuAcc.stripeSum).toBeCloseTo(cpuAcc.stripeSum, 12);
      expect(gpuAcc.stripePrev1).toBeCloseTo(cpuAcc.stripePrev1, 12);
      expect(gpuAcc.count).toBe(cpuAcc.count);
    }
  });

  it('trapDistSq tracks minimum identically', () => {
    const cpuAcc = initAccumulator();
    const gpuAcc = gpuInitAccumulator();

    for (const z of zSequence) {
      updateAccumulator(cpuAcc, z.re, z.im);
      gpuUpdateAccumulator(z.re, z.im, gpuAcc);
    }

    // CPU starts at Infinity, GPU at 1e20 — both converge to same min
    // (any real |z|^2 < 1e20 and < Infinity)
    expect(gpuAcc.trapDistSq).toBeCloseTo(cpuAcc.trapDistSq, 12);
  });
});

describe('GPU/CPU parity — stripe coloring', () => {
  const cases = [
    { smoothVal: 5.7, s: 3.1, s1: 2.3, s2: 1.5, count: 5 },
    { smoothVal: 128.3, s: 64.8, s1: 60.1, s2: 55.0, count: 128 },
    { smoothVal: 0.5, s: 0.8, s1: 0.0, s2: 0.0, count: 1 },
    { smoothVal: 255.99, s: 125.5, s1: 120.0, s2: 115.0, count: 255 },
  ];

  for (const tc of cases) {
    it(`smoothVal=${tc.smoothVal}, count=${tc.count}`, () => {
      // CPU: finalizeEscape computes stripeValue via Catmull-Rom, then stripeToParam maps it
      const frac = tc.smoothVal - Math.floor(tc.smoothVal);
      const ext = 2 * tc.s - tc.s1;
      const interpolated = tc.count >= 3
        ? catmullRom(tc.s1, tc.s, ext, 2 * ext - tc.s, frac)
        : tc.s + frac * (ext - tc.s);
      const stripeValue = tc.count > 0 ? interpolated / tc.count : 0;
      const cpuT = mapToColorParam(
        makeEscapedResult({ smoothValue: tc.smoothVal, stripeValue }),
        'stripe',
      );

      // GPU: inline Catmull-Rom + mapping
      const gpuAcc: GpuAccumState = {
        stripeSum: tc.s, stripePrev1: tc.s1, stripePrev2: tc.s2, stripePrev3: 0,
        trapDistSq: 1, count: tc.count,
      };
      const gpuT = gpuStripeMapToParam(tc.smoothVal, gpuAcc);

      expect(gpuT).toBeCloseTo(cpuT, 10);
    });
  }

  it('count=0 edge case: both return amplitude+frequency baseline', () => {
    const smoothVal = 42.7;
    const cpuT = mapToColorParam(
      makeEscapedResult({ smoothValue: smoothVal, stripeValue: 0 }),
      'stripe',
    );
    const gpuAcc: GpuAccumState = {
      stripeSum: 0, stripePrev1: 0, stripePrev2: 0, stripePrev3: 0,
      trapDistSq: 1e20, count: 0,
    };
    const gpuT = gpuStripeMapToParam(smoothVal, gpuAcc);

    // amplitude=0.7, frequency=50*42.7/256
    const expected = 0.7 + 50.0 * smoothVal / 256;
    expect(gpuT).toBeCloseTo(expected, 10);
    expect(cpuT).toBeCloseTo(expected, 10);
  });

  it('end-to-end with shared iteration', () => {
    // Tests full accumulator → finalize → map pipeline parity
    const r = iterateMandelbrot(0.5, 0.5);

    const escape = finalizeEscape(r.cpuAcc, r.zRe, r.zIm, r.dzRe, r.dzIm, r.smoothVal);
    const cpuT = mapToColorParam(
      makeEscapedResult({ iterations: r.iter, smoothValue: r.smoothVal, ...escape }),
      'stripe',
    );
    const gpuT = gpuStripeMapToParam(r.smoothVal, r.gpuAcc);

    expect(gpuT).toBeCloseTo(cpuT, 10);
  });
});

describe('GPU/CPU parity — decomposition coloring', () => {
  // All four quadrants + axis-aligned boundary cases
  const cases = [
    { zRe: 1.5, zIm: 0.3, desc: 'Q1 (positive angle)' },
    { zRe: -1.2, zIm: 0.8, desc: 'Q2 (positive angle)' },
    { zRe: -0.5, zIm: -1.0, desc: 'Q3 (negative angle)' },
    { zRe: 2.0, zIm: -0.1, desc: 'Q4 (negative angle)' },
    { zRe: 1.0, zIm: 0.0, desc: 'positive x-axis (angle=0, >= 0)' },
    { zRe: -1.0, zIm: 0.0, desc: 'negative x-axis (angle=PI, >= 0)' },
  ];

  for (const tc of cases) {
    it(tc.desc, () => {
      const decompAngle = Math.atan2(tc.zIm, tc.zRe);
      const cpuT = mapToColorParam(makeEscapedResult({ decompAngle }), 'decomposition');
      const gpuT = gpuDecompMapToParam(tc.zRe, tc.zIm);
      expect(gpuT).toBe(cpuT);
    });
  }
});

describe('GPU/CPU parity — orbit trap coloring', () => {
  const cases = [
    { smoothVal: 42.7, trapDistSq: 0.5 },
    { smoothVal: 10.0, trapDistSq: 0.01 },
    { smoothVal: 200.3, trapDistSq: 4.0 },
    { smoothVal: 63.9, trapDistSq: 25.0 }, // clamped to d=4
    { smoothVal: 1.0, trapDistSq: 1e-6 },  // very close orbit
  ];

  for (const tc of cases) {
    it(`smoothVal=${tc.smoothVal}, trapDistSq=${tc.trapDistSq}`, () => {
      const cpuT = mapToColorParam(
        makeEscapedResult({
          smoothValue: tc.smoothVal,
          orbitTrapDist: Math.sqrt(tc.trapDistSq),
        }),
        'orbitTrap',
      );
      const gpuT = gpuTrapMapToParam(tc.smoothVal, tc.trapDistSq);
      expect(gpuT).toBeCloseTo(cpuT, 12);
    });
  }

  it('end-to-end with shared iteration (trapDistSq from accumulator)', () => {
    const r = iterateMandelbrot(0.5, 0.5);

    const escape = finalizeEscape(r.cpuAcc, r.zRe, r.zIm, r.dzRe, r.dzIm, r.smoothVal);
    const cpuT = mapToColorParam(
      makeEscapedResult({ iterations: r.iter, smoothValue: r.smoothVal, ...escape }),
      'orbitTrap',
    );
    const gpuT = gpuTrapMapToParam(r.smoothVal, r.gpuAcc.trapDistSq);

    expect(gpuT).toBeCloseTo(cpuT, 10);
  });
});

describe('GPU/CPU parity — normal map coloring', () => {
  const zCases = [
    { zRe: 2.1, zIm: 0.5, dzRe: 3.0, dzIm: 1.5, smoothVal: 10.5 },
    { zRe: -1.8, zIm: 1.2, dzRe: 5.0, dzIm: -2.0, smoothVal: 50.3 },
    { zRe: 3.0, zIm: -0.1, dzRe: 8.0, dzIm: 0.5, smoothVal: 100.7 },
    { zRe: 1.5, zIm: 1.5, dzRe: 2.0, dzIm: 2.0, smoothVal: 255.0 },
  ];

  for (const tc of zCases) {
    it(`mapToParam at z=(${tc.zRe}, ${tc.zIm})`, () => {
      const decompAngle = Math.atan2(tc.zIm, tc.zRe);
      const cpuT = mapToColorParam(
        makeEscapedResult({ smoothValue: tc.smoothVal, decompAngle }),
        'normalMap',
      );
      const gpuT = gpuNormalMapToParam(tc.smoothVal, tc.zRe, tc.zIm);
      expect(gpuT).toBeCloseTo(cpuT, 12);
    });
  }

  for (const tc of zCases) {
    it(`computeLightness at z=(${tc.zRe}, ${tc.zIm}), dz=(${tc.dzRe}, ${tc.dzIm})`, () => {
      const decompAngle = Math.atan2(tc.zIm, tc.zRe);
      const zMod = Math.sqrt(tc.zRe * tc.zRe + tc.zIm * tc.zIm);
      const dzMod = Math.sqrt(tc.dzRe * tc.dzRe + tc.dzIm * tc.dzIm);
      const distanceEstimate = dzMod > 0 ? zMod * Math.log(zMod) / dzMod : 0;
      const cpuL = computeNormalLightness(
        makeEscapedResult({ smoothValue: tc.smoothVal, decompAngle, distanceEstimate }),
        NORMAL_MAP_LIGHT_ANGLE,
      );
      const gpuL = gpuComputeNormalLightness(tc.zRe, tc.zIm, tc.dzRe, tc.dzIm);
      expect(gpuL).toBeCloseTo(cpuL, 12);
    });
  }

  it('computeLightness returns 0.5 when DE <= 0', () => {
    const cpuL = computeNormalLightness(
      makeEscapedResult({ decompAngle: 0.5, distanceEstimate: -1 }),
      NORMAL_MAP_LIGHT_ANGLE,
    );
    expect(cpuL).toBe(0.5);
    // GPU: zMod=0.5 < 1 → log(0.5) < 0 → de < 0 → returns 0.5
    expect(gpuComputeNormalLightness(0.5, 0.0, 1.0, 0.0)).toBe(0.5);
  });

  it('computeLightness returns 0.5 when dz = (0,0)', () => {
    const cpuL = computeNormalLightness(
      makeEscapedResult({ decompAngle: 0.3, distanceEstimate: 0 }),
      NORMAL_MAP_LIGHT_ANGLE,
    );
    expect(cpuL).toBe(0.5);
    // GPU: dzMod=0 → de=0 → de<=0 branch
    expect(gpuComputeNormalLightness(2.0, 0.3, 0.0, 0.0)).toBe(0.5);
  });

  it('end-to-end with shared iteration (mapToParam + computeLightness)', () => {
    // Normal map is the most complex mode — tests full pipeline with real dz
    const r = iterateMandelbrot(0.5, 0.5);

    const escape = finalizeEscape(r.cpuAcc, r.zRe, r.zIm, r.dzRe, r.dzIm, r.smoothVal);
    const cpuResult = makeEscapedResult({
      iterations: r.iter, smoothValue: r.smoothVal, ...escape,
    });
    const cpuT = mapToColorParam(cpuResult, 'normalMap');
    const cpuL = computeNormalLightness(cpuResult, NORMAL_MAP_LIGHT_ANGLE);

    const gpuT = gpuNormalMapToParam(r.smoothVal, r.zRe, r.zIm);
    const gpuL = gpuComputeNormalLightness(r.zRe, r.zIm, r.dzRe, r.dzIm);

    expect(gpuT).toBeCloseTo(cpuT, 10);
    expect(gpuL).toBeCloseTo(cpuL, 10);
  });
});

describe('GPU/CPU parity — interior coloring', () => {
  const cases = [
    { trapDistSq: 0.25, desc: 'small trap distance' },
    { trapDistSq: 1.0, desc: 'unit distance' },
    { trapDistSq: 4.0, desc: 'at clamp boundary (d=2)' },
    { trapDistSq: 16.0, desc: 'beyond clamp (d=4, clamped to 2)' },
    { trapDistSq: 0.001, desc: 'very close orbit' },
  ];

  for (const tc of cases) {
    it(tc.desc, () => {
      const orbitTrapDist = Math.sqrt(tc.trapDistSq);
      const cpuResult: FractalResult = {
        iterations: 256, escaped: false, smoothValue: 0,
        stripeValue: 0, decompAngle: 0, orbitTrapDist, distanceEstimate: 0,
      };
      const cpuT = mapInteriorToParam(cpuResult);
      const gpuT = gpuInteriorParam(tc.trapDistSq);
      expect(gpuT).toBeCloseTo(cpuT, 12);
    });
  }
});
