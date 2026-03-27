import { describe, it, expect } from 'vitest';
import {
  mandelbrotPerturbationChunk,
  juliaPerturbationChunk,
  perturbationHeaderChunk,
  orbitLookupChunk,
  PERTURBATION_UNIFORM_NAMES
} from '../shaders/perturbation';

describe('perturbation GLSL chunks', () => {
  describe('mandelbrotPerturbationChunk', () => {
    it('contains iterate function signature', () => {
      expect(mandelbrotPerturbationChunk).toContain(
        'void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped'
      );
    });

    it('contains rebasing logic', () => {
      expect(mandelbrotPerturbationChunk).toContain('refIter = 0');
      expect(mandelbrotPerturbationChunk).toContain('1e-6');
    });

    it('contains NaN guard', () => {
      expect(mandelbrotPerturbationChunk).toContain('isnan(u)');
      expect(mandelbrotPerturbationChunk).toContain('isinf(u)');
    });

    it('contains δc addition for Mandelbrot', () => {
      expect(mandelbrotPerturbationChunk).toContain('+ dc_re');
      expect(mandelbrotPerturbationChunk).toContain('+ dc_im');
    });

    it('reads orbit from texture', () => {
      expect(mandelbrotPerturbationChunk).toContain('getOrbitData(refIter)');
    });
  });

  describe('juliaPerturbationChunk', () => {
    it('does NOT contain δc addition', () => {
      const lines = juliaPerturbationChunk.split('\n');
      const perturbLines = lines.filter(l =>
        l.includes('temp_u =') && l.includes('u*u - v*v')
      );
      for (const line of perturbLines) {
        expect(line).not.toContain('dc_re');
      }
    });

    it('contains rebasing logic same as Mandelbrot', () => {
      expect(juliaPerturbationChunk).toContain('refIter = 0');
    });
  });

  describe('orbitLookupChunk', () => {
    it('contains texelFetch for orbit data', () => {
      expect(orbitLookupChunk).toContain('texelFetch');
      expect(orbitLookupChunk).toContain('getOrbitData');
    });
  });

  describe('perturbationHeaderChunk', () => {
    it('declares orbit texture uniform', () => {
      expect(perturbationHeaderChunk).toContain('uniform sampler2D u_orbitTexture');
    });

    it('declares orbit length uniform', () => {
      expect(perturbationHeaderChunk).toContain('uniform int u_orbitLength');
    });
  });

  describe('PERTURBATION_UNIFORM_NAMES', () => {
    it('includes all required uniforms', () => {
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitTexture');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitLength');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitTexSize');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_refPoint');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_refPointLo');
    });
  });
});
