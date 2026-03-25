import { describe, it, expect } from 'vitest';
import { assembleFragmentSource, isGpuSupported } from '../shaderCompiler';
import type { FractalType, ColoringMode } from '../../../domain/types';

describe('shaderCompiler', () => {
  const ALL_FRACTALS: FractalType[] = [
    'mandelbrot', 'julia', 'burningship', 'tricorn', 'multibrot3'
  ];

  const ALL_COLORING_MODES: ColoringMode[] = [
    'classic', 'stripe', 'decomposition', 'orbitTrap', 'normalMap'
  ];

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

    // ---- Coloring #defines --------------------------------------------------

    it('injects STRIPE_DENSITY define from domain constant', () => {
      const source = assembleFragmentSource('mandelbrot', 'stripe', 256);
      expect(source).toContain('#define STRIPE_DENSITY 5.0');
    });

    it('injects ORBIT_TRAP_CYCLE define from domain constant', () => {
      const source = assembleFragmentSource('mandelbrot', 'orbitTrap', 256);
      expect(source).toContain('#define ORBIT_TRAP_CYCLE 64.0');
    });

    it('injects NORMAL_MAP_LIGHT_ANGLE define from domain constant', () => {
      const source = assembleFragmentSource('mandelbrot', 'normalMap', 256);
      expect(source).toContain('#define NORMAL_MAP_LIGHT_ANGLE (-0.7854)');
    });

    it('injects INTERIOR_ATTENUATION define from domain constant', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('#define INTERIOR_ATTENUATION 0.4');
    });

    // ---- Non-classic coloring modes -----------------------------------------

    it('assembles stripe coloring with real accumulator', () => {
      const source = assembleFragmentSource('mandelbrot', 'stripe', 256);
      expect(source).not.toBeNull();
      expect(source).toContain('acc.stripeSum');
      expect(source).toContain('acc.prevStripeSum');
      expect(source).toContain('float mapToParam(');
      expect(source).toContain('float computeLightness(');
    });

    it('assembles decomposition coloring', () => {
      const source = assembleFragmentSource('mandelbrot', 'decomposition', 256);
      expect(source).not.toBeNull();
      expect(source).toContain('0.15');
      expect(source).toContain('0.65');
    });

    it('assembles orbitTrap coloring', () => {
      const source = assembleFragmentSource('mandelbrot', 'orbitTrap', 256);
      expect(source).not.toBeNull();
      expect(source).toContain('acc.trapDistSq');
      expect(source).toContain('ORBIT_TRAP_CYCLE');
    });

    it('assembles normalMap coloring with computeLightness', () => {
      const source = assembleFragmentSource('mandelbrot', 'normalMap', 256);
      expect(source).not.toBeNull();
      expect(source).toContain('computeLightness');
      expect(source).toContain('NORMAL_MAP_LIGHT_ANGLE');
      expect(source).toContain('acc.dz');
    });

    it('all 5 coloring modes assemble for all 5 fractals', () => {
      for (const fractal of ALL_FRACTALS) {
        for (const mode of ALL_COLORING_MODES) {
          const source = assembleFragmentSource(fractal, mode, 256);
          expect(source).not.toBeNull();
          expect(source).toContain('void main()');
        }
      }
    });

    // ---- Interior coloring uniform ------------------------------------------

    it('includes u_interiorColoring uniform in header', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('uniform int u_interiorColoring');
    });

    it('main template references u_interiorColoring for interior logic', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('u_interiorColoring > 0');
      expect(source).toContain('INTERIOR_ATTENUATION');
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

    it('returns true for all 5 coloring modes', () => {
      for (const mode of ALL_COLORING_MODES) {
        expect(isGpuSupported('mandelbrot', mode)).toBe(true);
      }
    });

    it('returns true for all fractal+coloring combinations', () => {
      for (const fractal of ALL_FRACTALS) {
        for (const mode of ALL_COLORING_MODES) {
          expect(isGpuSupported(fractal, mode)).toBe(true);
        }
      }
    });
  });
});
