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
