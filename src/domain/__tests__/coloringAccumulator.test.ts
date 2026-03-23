import { describe, it, expect } from 'vitest';
import {
  initAccumulator,
  updateAccumulator,
  finalizeEscape,
  finalizeInterior
} from '../coloringAccumulator';
import { INTERIOR_COLORING_DEFAULTS } from '../types';

describe('initAccumulator', () => {
  it('returns correct initial state', () => {
    const acc = initAccumulator();
    expect(acc.stripeSum).toBe(0);
    expect(acc.prevStripeSum).toBe(0);
    expect(acc.trapDistSq).toBe(Infinity);
    expect(acc.count).toBe(0);
  });
});

describe('updateAccumulator', () => {
  it('increments count', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 1, 0);
    expect(acc.count).toBe(1);
    updateAccumulator(acc, 1, 0);
    expect(acc.count).toBe(2);
  });

  it('tracks minimum distance squared (orbit trap)', () => {
    const acc = initAccumulator();
    // First point at distance sqrt(2) => distSq = 2
    updateAccumulator(acc, 1, 1);
    expect(acc.trapDistSq).toBe(2);

    // Second point farther away => trapDistSq stays at 2
    updateAccumulator(acc, 3, 4);
    expect(acc.trapDistSq).toBe(2);

    // Third point closer => trapDistSq decreases
    updateAccumulator(acc, 0.5, 0.5);
    expect(acc.trapDistSq).toBe(0.5);
  });

  it('with z at origin gives trapDistSq=0', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 0, 0);
    expect(acc.trapDistSq).toBe(0);
  });

  it('stripe sum changes with different z angles', () => {
    // z at angle 0 (positive real axis)
    const acc1 = initAccumulator();
    updateAccumulator(acc1, 1, 0);
    const sum1 = acc1.stripeSum;

    // z at angle PI/2 (positive imaginary axis)
    const acc2 = initAccumulator();
    updateAccumulator(acc2, 0, 1);
    const sum2 = acc2.stripeSum;

    // Different angles produce different stripe sums
    // atan2(0,1) = 0, atan2(1,0) = PI/2 — sin at different frequencies
    expect(sum2).not.toBe(sum1);
  });
});

describe('finalizeEscape', () => {
  it('returns stripeValue in [0,1]', () => {
    const acc = initAccumulator();
    // Simulate several iterations
    updateAccumulator(acc, 1, 0.5);
    updateAccumulator(acc, -0.3, 1.2);
    updateAccumulator(acc, 2.1, -0.7);
    updateAccumulator(acc, -1.5, 0.3);
    updateAccumulator(acc, 0.8, -1.9);

    const result = finalizeEscape(acc, 10, 10, 5, 5, 5.3);
    expect(result.stripeValue).toBeGreaterThanOrEqual(0);
    expect(result.stripeValue).toBeLessThanOrEqual(1);
  });

  it('returns valid decompAngle (atan2 range)', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 1, 1);

    const result = finalizeEscape(acc, 3, 4, 1, 1, 5.5);
    expect(result.decompAngle).toBeGreaterThanOrEqual(-Math.PI);
    expect(result.decompAngle).toBeLessThanOrEqual(Math.PI);
  });

  it('returns orbitTrapDist >= 0', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 0.5, 0.5);
    updateAccumulator(acc, 2, 3);

    const result = finalizeEscape(acc, 10, 10, 1, 1, 5.5);
    expect(result.orbitTrapDist).toBeGreaterThanOrEqual(0);
  });

  it('distanceEstimate is 0 when dzMod=0', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 1, 1);

    const result = finalizeEscape(acc, 10, 10, 0, 0, 5.5);
    expect(result.distanceEstimate).toBe(0);
  });

  it('distanceEstimate > 0 for valid dz', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 1, 1);

    // z = (10, 10) => zMod = sqrt(200) > 1, so log(zMod) > 0
    // dz = (5, 5) => dzMod = sqrt(50) > 0
    const result = finalizeEscape(acc, 10, 10, 5, 5, 5.5);
    expect(result.distanceEstimate).toBeGreaterThan(0);
  });
});

describe('finalizeInterior', () => {
  it('returns INTERIOR_COLORING_DEFAULTS.decompAngle (0)', () => {
    const acc = initAccumulator();
    const result = finalizeInterior(acc);
    expect(result.decompAngle).toBe(INTERIOR_COLORING_DEFAULTS.decompAngle);
    expect(result.decompAngle).toBe(0);
  });

  it('returns INTERIOR_COLORING_DEFAULTS.distanceEstimate (0)', () => {
    const acc = initAccumulator();
    const result = finalizeInterior(acc);
    expect(result.distanceEstimate).toBe(INTERIOR_COLORING_DEFAULTS.distanceEstimate);
    expect(result.distanceEstimate).toBe(0);
  });

  it('with no iterations returns defaults', () => {
    const acc = initAccumulator();
    const result = finalizeInterior(acc);
    expect(result.stripeValue).toBe(INTERIOR_COLORING_DEFAULTS.stripeValue);
    expect(result.decompAngle).toBe(INTERIOR_COLORING_DEFAULTS.decompAngle);
    expect(result.orbitTrapDist).toBe(INTERIOR_COLORING_DEFAULTS.orbitTrapDist);
    expect(result.distanceEstimate).toBe(INTERIOR_COLORING_DEFAULTS.distanceEstimate);
  });

  it('with iterations returns sqrt(trapDistSq)', () => {
    const acc = initAccumulator();
    updateAccumulator(acc, 3, 4); // distSq = 9 + 16 = 25
    updateAccumulator(acc, 10, 10); // distSq = 200, not closer

    const result = finalizeInterior(acc);
    expect(result.orbitTrapDist).toBe(Math.sqrt(25));
    expect(result.orbitTrapDist).toBe(5);
  });
});
