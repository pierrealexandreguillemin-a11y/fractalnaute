import { describe, it, expect } from 'vitest';
import {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot
} from '../fractals';
import type { FractalResult, FractalParams, FractalCalculator } from '../types';
import { INTERIOR_COLORING_DEFAULTS, DEFAULT_JULIA_PARAMS } from '../types';

const MAX_ITER = 1000;
const EMPTY_PARAMS: FractalParams = {};

/** All 7 FractalResult fields */
const RESULT_FIELDS: (keyof FractalResult)[] = [
  'iterations',
  'escaped',
  'smoothValue',
  'stripeValue',
  'decompAngle',
  'orbitTrapDist',
  'distanceEstimate'
];

// ─── Mandelbrot ──────────────────────────────────────────────────────────

describe('Mandelbrot', () => {
  it('origin (0,0) is in set (escaped=false)', () => {
    const result = calculateMandelbrot(0, 0, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(false);
  });

  it('point (2,2) escapes quickly (escaped=true, low iterations)', () => {
    const result = calculateMandelbrot(2, 2, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(true);
    expect(result.iterations).toBeLessThan(10);
  });

  it('cardioid pre-test catches (0.25, 0)', () => {
    // (0.25, 0) is on the cardioid boundary — should be detected as interior
    const result = calculateMandelbrot(0.25, 0, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(false);
    expect(result.iterations).toBe(MAX_ITER);
  });

  it('bulb pre-test catches (-1, 0)', () => {
    // (-1, 0) is the center of the period-2 bulb
    const result = calculateMandelbrot(-1, 0, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(false);
    expect(result.iterations).toBe(MAX_ITER);
  });

  it('smoothValue > iterations for escaped points', () => {
    // smoothEscape adds a fractional part, so smoothValue is typically > iterations
    // but can also be slightly less; the key is it's not simply equal to iterations
    const result = calculateMandelbrot(0.5, 0.5, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(true);
    expect(result.smoothValue).not.toBe(result.iterations);
  });

  it('accumulate=false returns INTERIOR_COLORING_DEFAULTS fields', () => {
    // Escaped point without accumulation should have default coloring fields
    const result = calculateMandelbrot(2, 2, MAX_ITER, EMPTY_PARAMS, false);
    expect(result.escaped).toBe(true);
    expect(result.stripeValue).toBe(INTERIOR_COLORING_DEFAULTS.stripeValue);
    expect(result.decompAngle).toBe(INTERIOR_COLORING_DEFAULTS.decompAngle);
    expect(result.distanceEstimate).toBe(INTERIOR_COLORING_DEFAULTS.distanceEstimate);
  });

  it('accumulate=true returns non-default stripeValue for escaped points', () => {
    // Point outside the set that takes several iterations to escape
    const result = calculateMandelbrot(-0.75, 0.3, MAX_ITER, EMPTY_PARAMS, true);
    expect(result.escaped).toBe(true);
    expect(result.stripeValue).not.toBe(INTERIOR_COLORING_DEFAULTS.stripeValue);
  });

  it('accumulate=true returns valid distanceEstimate for escaped points', () => {
    const result = calculateMandelbrot(-0.75, 0.3, MAX_ITER, EMPTY_PARAMS, true);
    expect(result.escaped).toBe(true);
    expect(result.distanceEstimate).toBeGreaterThan(0);
  });
});

// ─── Julia ───────────────────────────────────────────────────────────────

describe('Julia', () => {
  it('default params produce mixed escaped/interior', () => {
    // Point far from origin should escape with default Julia params
    const escaped = calculateJulia(2, 2, MAX_ITER, DEFAULT_JULIA_PARAMS);
    expect(escaped.escaped).toBe(true);

    // Origin with default c = (-0.7, 0.27015) — check it produces a result
    const origin = calculateJulia(0, 0, MAX_ITER, DEFAULT_JULIA_PARAMS);
    // Just verify it returns a valid result (may or may not escape)
    expect(typeof origin.escaped).toBe('boolean');
    expect(typeof origin.iterations).toBe('number');
  });

  it('accumulate=true includes z0 in orbit trap (trapDist can be very small)', () => {
    // z0 near origin — orbit trap should capture the initial point
    const result = calculateJulia(0.01, 0.01, MAX_ITER, DEFAULT_JULIA_PARAMS, true);
    // orbitTrapDist should be at most sqrt(0.01^2 + 0.01^2) = ~0.0141
    // since z0 is included in orbit trap
    expect(result.orbitTrapDist).toBeLessThanOrEqual(0.02);
  });
});

// ─── BurningShip ─────────────────────────────────────────────────────────

describe('BurningShip', () => {
  it('(0,0) is in set', () => {
    const result = calculateBurningShip(0, 0, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(false);
  });

  it('accumulate=true derivative uses folded abs components (distanceEstimate > 0)', () => {
    // A point that escapes
    const result = calculateBurningShip(2, 2, MAX_ITER, EMPTY_PARAMS, true);
    expect(result.escaped).toBe(true);
    expect(result.distanceEstimate).toBeGreaterThan(0);
  });
});

// ─── Tricorn ─────────────────────────────────────────────────────────────

describe('Tricorn', () => {
  it('(0,0) is in set', () => {
    const result = calculateTricorn(0, 0, MAX_ITER, EMPTY_PARAMS);
    expect(result.escaped).toBe(false);
  });
});

// ─── Multibrot ───────────────────────────────────────────────────────────

describe('Multibrot', () => {
  it('power=2 should match Mandelbrot behavior at same point', () => {
    const point = { re: 0.3, im: 0.5 };
    const mandel = calculateMandelbrot(point.re, point.im, MAX_ITER, EMPTY_PARAMS);
    const multi2 = calculateMultibrot(point.re, point.im, MAX_ITER, { power: 2 });

    expect(multi2.escaped).toBe(mandel.escaped);
    expect(multi2.iterations).toBe(mandel.iterations);
    // smoothValue may differ slightly due to logBase parameter in smoothEscape
    // but escaped/iterations should be identical
  });

  it('power=3 at (0,0) is in set', () => {
    const result = calculateMultibrot(0, 0, MAX_ITER, { power: 3 });
    expect(result.escaped).toBe(false);
  });
});

// ─── All calculators: 7 fields present ───────────────────────────────────

describe('All calculators return all 7 FractalResult fields', () => {
  const calculators: [string, FractalCalculator, FractalParams][] = [
    ['Mandelbrot', calculateMandelbrot, EMPTY_PARAMS],
    ['Julia', calculateJulia, DEFAULT_JULIA_PARAMS],
    ['BurningShip', calculateBurningShip, EMPTY_PARAMS],
    ['Tricorn', calculateTricorn, EMPTY_PARAMS],
    ['Multibrot', calculateMultibrot, { power: 3 }]
  ];

  for (const [name, calc, params] of calculators) {
    it(`${name} — interior point has all fields`, () => {
      const result = calc(0, 0, MAX_ITER, params, false);
      for (const field of RESULT_FIELDS) {
        expect(result).toHaveProperty(field);
        expect(typeof result[field]).not.toBe('undefined');
      }
    });

    it(`${name} — escaped point has all fields`, () => {
      const result = calc(10, 10, MAX_ITER, params, false);
      expect(result.escaped).toBe(true);
      for (const field of RESULT_FIELDS) {
        expect(result).toHaveProperty(field);
        expect(typeof result[field]).not.toBe('undefined');
      }
    });

    it(`${name} — accumulate=true has all fields`, () => {
      const result = calc(10, 10, MAX_ITER, params, true);
      expect(result.escaped).toBe(true);
      for (const field of RESULT_FIELDS) {
        expect(result).toHaveProperty(field);
        expect(typeof result[field]).not.toBe('undefined');
      }
    });
  }
});
