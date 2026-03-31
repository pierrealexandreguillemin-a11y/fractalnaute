import { describe, it, expect } from 'vitest';
import { computeRescaleS } from '../../renderer';

describe('computeRescaleS', () => {
  it('returns 2^6 at standard zoom (scale=2.8, 1920px)', () => {
    // pixelSpacing = 2.8/1920 ≈ 0.00146, log2 ≈ -9.42, floor → -10, k = max(0, 10-4) = 6
    const S = computeRescaleS(2.8, 1920);
    expect(S).toBe(64);
  });

  it('returns 1 when pixelSpacing is large (scale=120, 1920px)', () => {
    const S = computeRescaleS(120, 1920);
    expect(S).toBe(1);
  });

  it('returns 2^40+ at zoom ~1e-14 (scale=5e-14, 1920px)', () => {
    const S = computeRescaleS(5e-14, 1920);
    const k = Math.log2(S);
    expect(Number.isInteger(k)).toBe(true);
    expect(k).toBeGreaterThanOrEqual(40);
    expect(k).toBeLessThanOrEqual(60);
  });

  it('returns large S at zoom 1e-40 (scale=1e-40, 1920px)', () => {
    const S = computeRescaleS(1e-40, 1920);
    const k = Math.log2(S);
    expect(k).toBeGreaterThanOrEqual(130);
    expect(k).toBeLessThanOrEqual(150);
  });

  it('S is always a power of 2', () => {
    for (const scale of [2.8, 1e-5, 1e-14, 1e-40, 1e-100]) {
      const S = computeRescaleS(scale, 1920);
      const k = Math.log2(S);
      expect(Number.isInteger(k)).toBe(true);
      expect(S).toBeGreaterThanOrEqual(1);
    }
  });

  it('S=1 at wide zoom is a neutral no-op', () => {
    const S = computeRescaleS(120, 1920);
    expect(S).toBe(1);
    const delta = 0.123;
    expect(delta * delta / S).toBe(delta * delta);
  });
});

describe('rescaled perturbation parity', () => {
  /** One perturbation step: δ_{n+1} = 2·Z·δ + δ² + δc */
  function perturbStep(Zre: number, Zim: number, dRe: number, dIm: number, dcRe: number, dcIm: number) {
    const uNew = dRe * dRe - dIm * dIm + 2 * (dRe * Zre - dIm * Zim) + dcRe;
    const vNew = 2 * dRe * dIm + 2 * (dIm * Zre + dRe * Zim) + dcIm;
    return { re: uNew, im: vNew };
  }

  /** One rescaled step: δ̃_{n+1} = 2·Z·δ̃ + δ̃²/S + δ̃c */
  function rescaledStep(Zre: number, Zim: number, uRe: number, uIm: number, dcRe: number, dcIm: number, S: number) {
    const invS = 1 / S;
    const uNew = uRe * uRe * invS - uIm * uIm * invS + 2 * (uRe * Zre - uIm * Zim) + dcRe;
    const vNew = 2 * uRe * uIm * invS + 2 * (uIm * Zre + uRe * Zim) + dcIm;
    return { re: uNew, im: vNew };
  }

  it('rescaled step with S=1 matches standard perturbation', () => {
    const Z = { re: 0.5, im: 0.3 };
    const dc = { re: 0.01, im: -0.02 };
    const delta = { re: 0.001, im: 0.002 };

    const standard = perturbStep(Z.re, Z.im, delta.re, delta.im, dc.re, dc.im);
    const rescaled = rescaledStep(Z.re, Z.im, delta.re, delta.im, dc.re, dc.im, 1.0);
    expect(rescaled.re).toBeCloseTo(standard.re, 15);
    expect(rescaled.im).toBeCloseTo(standard.im, 15);
  });

  it('rescaled step with S>>1 produces same z after de-rescaling', () => {
    const S = 2 ** 50;
    const Z = { re: 0.5, im: 0.3 };
    const dc = { re: 1e-17, im: -2e-17 };
    const delta = { re: 1e-17, im: 2e-17 };

    // Standard: δ_{n+1}
    const std = perturbStep(Z.re, Z.im, delta.re, delta.im, dc.re, dc.im);
    // z_std = Z + δ
    const zStd = { re: Z.re + std.re, im: Z.im + std.im };

    // Rescaled: δ̃ = δ×S, δ̃c = dc×S
    const dTilde = { re: delta.re * S, im: delta.im * S };
    const dcTilde = { re: dc.re * S, im: dc.im * S };
    const res = rescaledStep(Z.re, Z.im, dTilde.re, dTilde.im, dcTilde.re, dcTilde.im, S);
    // z_res = Z + δ̃/S
    const zRes = { re: Z.re + res.re / S, im: Z.im + res.im / S };

    // z positions must match (within float64 rounding)
    expect(zRes.re).toBeCloseTo(zStd.re, 10);
    expect(zRes.im).toBeCloseTo(zStd.im, 10);
  });
});
