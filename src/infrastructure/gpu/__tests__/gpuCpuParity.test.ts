/**
 * GPU/CPU mathematical parity tests.
 *
 * Verifies that GLSL formulas (re-implemented in TypeScript) produce
 * the same outputs as the CPU domain functions for known inputs.
 * Catches formula transcription errors without needing a browser.
 *
 * @mirror infrastructure/gpu/shaders/index.ts
 */
import { describe, it, expect } from 'vitest';
import { screenToComplex } from '../../../domain/coordinates';
import { calculateMandelbrot } from '../../../domain/fractals';
import { mapToColorParam, COLOR_CYCLE_PERIOD } from '../../../domain/coloringModes';
import { isInCardioid, isInBulb } from '../../../domain/periodicity';
import type { FractalResult } from '../../../domain/types';

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

// ---- Tests ------------------------------------------------------------------

describe('GPU/CPU parity — screenToComplex', () => {
  // CPU uses pixel-corner (x,y), GPU uses pixel-center gl_FragCoord.
  // We feed both the same convention (pixel-center) and verify parity.
  const cases = [
    { x: 960, y: 456, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 0, y: 0, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 1919, y: 911, cRe: -0.5, cIm: 0.0, scale: 2.8, w: 1920, h: 912 },
    { x: 480, y: 228, cRe: -1.0, cIm: 0.3, scale: 0.5, w: 1920, h: 912 },
  ];

  for (const tc of cases) {
    it(`pixel (${tc.x}, ${tc.y})`, () => {
      // CPU: pixel-corner convention
      const cpu = screenToComplex(tc.x, tc.y, tc.w, tc.h, {
        centerRe: tc.cRe, centerIm: tc.cIm, scale: tc.scale,
      });

      // GPU: gl_FragCoord uses pixel-center, Y flipped from bottom
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

describe('GPU/CPU parity — classic coloring mapToParam', () => {
  it('produces same t for given smoothValues', () => {
    const smoothValues = [0.5, 42.7, 128.3, 255.9, 300.1];
    for (const sv of smoothValues) {
      const result: FractalResult = {
        iterations: 42, escaped: true, smoothValue: sv,
        stripeValue: 0, decompAngle: 0, orbitTrapDist: 1, distanceEstimate: 0,
      };
      const cpuT = mapToColorParam(result, 'classic');
      // GPU: mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD
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
      // Both should detect interior
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
    // (2, 0) is clearly outside
    expect(gpuIsInCardioid(2.0, 0.0)).toBe(false);
    expect(isInCardioid(2.0, 0.0)).toBe(false);
    expect(gpuIsInBulb(2.0, 0.0)).toBe(false);
    expect(isInBulb(2.0, 0.0)).toBe(false);
  });
});

describe('GPU/CPU parity — Mandelbrot iteration agreement', () => {
  // Known-escaping points: verify CPU iteration + smoothEscape matches
  // the GPU formula applied to the same final z values.
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
      // CPU smoothEscape uses the same final z
      expect(gpuSmooth).toBeCloseTo(result.smoothValue, 8);
    });
  }
});
