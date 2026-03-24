import { describe, it, expect } from 'vitest';
import { assembleFragmentSource, isGpuSupported } from '../shaderCompiler';

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

    it('returns null for unsupported fractal type', () => {
      expect(assembleFragmentSource('julia', 'classic', 256)).toBeNull();
    });

    it('returns null for unsupported coloring mode', () => {
      expect(assembleFragmentSource('mandelbrot', 'stripe', 256)).toBeNull();
    });
  });

  describe('isGpuSupported', () => {
    it('returns true for Mandelbrot + Classic', () => {
      expect(isGpuSupported('mandelbrot', 'classic')).toBe(true);
    });

    it('returns false for Julia (no GPU shader yet)', () => {
      expect(isGpuSupported('julia', 'classic')).toBe(false);
    });

    it('returns false for unsupported coloring mode', () => {
      expect(isGpuSupported('mandelbrot', 'stripe')).toBe(false);
    });
  });
});
