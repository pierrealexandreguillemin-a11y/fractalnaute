import { describe, it, expect } from 'vitest';
import {
  mapToColorParam,
  computeNormalLightness,
  mapInteriorToParam,
  getColorForResult
} from '../coloringModes';
import { resolvePalette } from '../palettes';
import type { FractalResult, ColoringMode } from '../types';
import { INTERIOR_COLORING_DEFAULTS } from '../types';

/** Helper: build a minimal escaped FractalResult */
function escapedResult(overrides: Partial<FractalResult> = {}): FractalResult {
  return {
    iterations: 42,
    escaped: true,
    smoothValue: 42.7,
    stripeValue: 0.35,
    decompAngle: 0.8,
    orbitTrapDist: 1.5,
    distanceEstimate: 0.02,
    ...overrides
  };
}

/** Helper: build a minimal interior FractalResult */
function interiorResult(overrides: Partial<FractalResult> = {}): FractalResult {
  return {
    iterations: 1000,
    escaped: false,
    smoothValue: 1000,
    ...INTERIOR_COLORING_DEFAULTS,
    ...overrides
  };
}

describe('mapToColorParam', () => {
  it('classic mode returns smoothValue-based t in [0,1]', () => {
    const result = escapedResult({ smoothValue: 130.5 });
    const t = mapToColorParam(result, 'classic');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
  });

  it('stripe mode returns different t than classic for same result', () => {
    const result = escapedResult({ smoothValue: 42.7, stripeValue: 0.35 });
    const tClassic = mapToColorParam(result, 'classic');
    const tStripe = mapToColorParam(result, 'stripe');
    expect(tStripe).not.toBe(tClassic);
  });

  it('decomposition returns exactly 0.15 or 0.65', () => {
    const positive = escapedResult({ decompAngle: 1.0 }); // >= 0
    const negative = escapedResult({ decompAngle: -1.0 }); // < 0

    expect(mapToColorParam(positive, 'decomposition')).toBe(0.15);
    expect(mapToColorParam(negative, 'decomposition')).toBe(0.65);
  });

  it('orbitTrap returns value in [0,1]', () => {
    const result = escapedResult({ orbitTrapDist: 2.5, smoothValue: 50.3 });
    const t = mapToColorParam(result, 'orbitTrap');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
  });

  it('normalMap returns value in [0,1]', () => {
    const result = escapedResult({ decompAngle: 0.5, smoothValue: 100.2 });
    const t = mapToColorParam(result, 'normalMap');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
  });
});

describe('computeNormalLightness', () => {
  it('returns 0.5 when distanceEstimate=0', () => {
    const result = escapedResult({ distanceEstimate: 0 });
    const lightness = computeNormalLightness(result, 0);
    expect(lightness).toBe(0.5);
  });

  it('returns value in [0.2, 1.4] range', () => {
    const result = escapedResult({ distanceEstimate: 0.05, decompAngle: 1.0 });
    const lightness = computeNormalLightness(result, 0);
    expect(lightness).toBeGreaterThanOrEqual(0.2);
    expect(lightness).toBeLessThanOrEqual(1.4);
  });

  it('varies with light angle', () => {
    const result = escapedResult({ distanceEstimate: 0.05, decompAngle: 0.5 });
    const l1 = computeNormalLightness(result, 0);
    const l2 = computeNormalLightness(result, Math.PI);
    expect(l1).not.toBe(l2);
  });
});

describe('mapInteriorToParam', () => {
  it('returns 0 for Infinity orbitTrapDist', () => {
    const result = interiorResult({ orbitTrapDist: Infinity });
    expect(mapInteriorToParam(result)).toBe(0);
  });

  it('returns 0 for zero orbitTrapDist', () => {
    const result = interiorResult({ orbitTrapDist: 0 });
    expect(mapInteriorToParam(result)).toBe(0);
  });

  it('returns value in [0,1] for valid distance', () => {
    const result = interiorResult({ orbitTrapDist: 1.0 });
    const t = mapInteriorToParam(result);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });
});

describe('getColorForResult', () => {
  const palette = resolvePalette('classic');

  it('returns [0,0,0] for interior without interiorColoring', () => {
    const result = interiorResult();
    const color = getColorForResult(result, palette, 'classic', false);
    expect(color).toEqual([0, 0, 0]);
  });

  it('returns non-black for interior with interiorColoring', () => {
    // Need an orbitTrapDist that is not Infinity and not 0 so mapInteriorToParam > 0
    const result = interiorResult({ orbitTrapDist: 0.8 });
    const color = getColorForResult(result, palette, 'classic', true);
    // At least one channel should be non-zero
    const [r, g, b] = color;
    expect(r + g + b).toBeGreaterThan(0);
  });

  it('returns valid RGB for escaped point in each mode', () => {
    const modes: ColoringMode[] = ['classic', 'stripe', 'decomposition', 'orbitTrap', 'normalMap'];
    const result = escapedResult();

    for (const mode of modes) {
      const color = getColorForResult(result, palette, mode, false);
      expect(color).toHaveLength(3);
      const [r, g, b] = color;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });
});
