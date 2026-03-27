import { describe, it, expect } from 'vitest';
import { needsPerturbation, PERTURBATION_THRESHOLD } from '../wasmBridge';

describe('wasmBridge', () => {
  describe('needsPerturbation', () => {
    it('returns false for normal zoom', () => {
      expect(needsPerturbation(1.0)).toBe(false);
      expect(needsPerturbation(1e-7)).toBe(false);
      expect(needsPerturbation(1e-12)).toBe(false);
    });

    it('returns true for deep zoom', () => {
      expect(needsPerturbation(1e-14)).toBe(true);
      expect(needsPerturbation(1e-40)).toBe(true);
    });

    it('returns false at exact threshold', () => {
      expect(needsPerturbation(PERTURBATION_THRESHOLD)).toBe(false);
    });

    it('returns true just below threshold', () => {
      expect(needsPerturbation(PERTURBATION_THRESHOLD / 10)).toBe(true);
    });
  });

  // Note: computeReferenceOrbit and cancelOrbit cannot be unit-tested
  // without a Worker + WASM environment. Test via Playwright integration.
});
