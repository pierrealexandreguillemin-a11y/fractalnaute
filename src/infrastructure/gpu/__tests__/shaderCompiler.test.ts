import { describe, it, expect } from 'vitest';
import { assembleFragmentSource, isGpuSupported } from '../shaderCompiler';
import type { FractalType } from '../../../domain/types';

describe('shaderCompiler', () => {
  describe('assembleFragmentSource', () => {
    it('assembles Mandelbrot + Classic with correct #defines', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('#version 300 es');
      expect(source).toContain('#define MAX_ITER 256');
      expect(source).toContain('#define COLOR_CYCLE_PERIOD 256.0');
      expect(source).toContain('void iterate(');
      expect(source).toContain('float mapToParam(');
      expect(source).toContain('void main()');
    });

    it('injects different MAX_ITER values', () => {
      const s512 = assembleFragmentSource('mandelbrot', 'classic', 512);
      const s1024 = assembleFragmentSource('mandelbrot', 'classic', 1024);
      expect(s512).toContain('#define MAX_ITER 512');
      expect(s1024).toContain('#define MAX_ITER 1024');
      expect(s512).not.toContain('#define MAX_ITER 1024');
    });

    it('includes smoothEscape function', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('float smoothEscape(');
      expect(source).toContain('log2(0.5 * log2(mod2))');
    });

    it('includes accumulatorNoop for classic mode', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('struct AccumState');
      expect(source).toContain('AccumState initAccumulator()');
    });

    it('returns null for unsupported coloring mode', () => {
      expect(assembleFragmentSource('mandelbrot', 'stripe', 256)).toBeNull();
    });

    const ALL_FRACTALS: FractalType[] = [
      'mandelbrot', 'julia', 'burningship', 'tricorn', 'multibrot3'
    ];

    for (const fractal of ALL_FRACTALS) {
      it(`assembles ${fractal} + classic`, () => {
        const source = assembleFragmentSource(fractal, 'classic', 256);
        expect(source).not.toBeNull();
        expect(source).toContain('void iterate(');
        expect(source).toContain('#define MAX_ITER 256');
        expect(source).toContain('void main()');
      });
    }

    it('Julia shader references u_juliaRe and u_juliaIm uniforms', () => {
      const source = assembleFragmentSource('julia', 'classic', 256);
      expect(source).toContain('u_juliaRe');
      expect(source).toContain('u_juliaIm');
    });

    it('Multibrot shader references u_power uniform', () => {
      const source = assembleFragmentSource('multibrot3', 'classic', 256);
      expect(source).toContain('u_power');
    });

    it('BurningShip shader uses abs(z) before squaring', () => {
      const source = assembleFragmentSource('burningship', 'classic', 256);
      expect(source).toContain('abs(z)');
    });

    it('Tricorn shader negates z.y for conjugate', () => {
      const source = assembleFragmentSource('tricorn', 'classic', 256);
      expect(source).toContain('z.y = -z.y');
    });

    it('all shaders include dz tracking for v3 coloring', () => {
      for (const fractal of ALL_FRACTALS) {
        const source = assembleFragmentSource(fractal, 'classic', 256);
        expect(source).toContain('vec2 dz');
      }
    });
  });

  describe('isGpuSupported', () => {
    it('returns true for Mandelbrot + Classic', () => {
      expect(isGpuSupported('mandelbrot', 'classic')).toBe(true);
    });

    it('returns true for all 5 fractals with classic coloring', () => {
      expect(isGpuSupported('julia', 'classic')).toBe(true);
      expect(isGpuSupported('burningship', 'classic')).toBe(true);
      expect(isGpuSupported('tricorn', 'classic')).toBe(true);
      expect(isGpuSupported('multibrot3', 'classic')).toBe(true);
    });

    it('returns false for unsupported coloring mode', () => {
      expect(isGpuSupported('mandelbrot', 'stripe')).toBe(false);
    });
  });
});
