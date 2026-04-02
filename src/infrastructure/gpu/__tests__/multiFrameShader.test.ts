import { describe, it, expect } from 'vitest';
import { assembleMultiFrameBatchSource, assembleResolveSource } from '../shaderCompiler';
import type { FractalType, ColoringMode } from '../../../domain/types';

describe('multiFrameShader', () => {
  const FRACTALS: FractalType[] = ['mandelbrot', 'julia', 'burningship', 'tricorn', 'multibrot3'];
  const COLORINGS: ColoringMode[] = ['classic', 'stripe', 'decomposition', 'orbitTrap', 'normalMap'];

  // 25 batch combo tests
  for (const f of FRACTALS) {
    for (const c of COLORINGS) {
      it(`assembles batch shader for ${f} + ${c}`, () => {
        const src = assembleMultiFrameBatchSource(f, c, false);
        expect(src).not.toBeNull();
        expect(src).toContain('#define BATCH_SIZE 256');
        expect(src).toContain('layout(location = 0) out vec4 outZ');
        expect(src).toContain('layout(location = 3) out vec4 outHist');
      });
    }
  }

  // 5 resolve tests
  for (const c of COLORINGS) {
    it(`assembles resolve shader for ${c}`, () => {
      const src = assembleResolveSource(c, false);
      expect(src).not.toBeNull();
      expect(src).toContain('out vec4 fragColor');
    });
  }

  // 4 specific checks
  it('mandelbrot batch includes DS arithmetic', () => {
    const src = assembleMultiFrameBatchSource('mandelbrot', 'classic', false)!;
    expect(src).toContain('ds_add');
    expect(src).toContain('u_centerLo');
    expect(src).toContain('screenToComplexDS');
  });

  it('julia batch includes juliaRe/Im uniforms', () => {
    const src = assembleMultiFrameBatchSource('julia', 'classic', false)!;
    expect(src).toContain('u_juliaRe');
    expect(src).toContain('u_juliaIm');
  });

  it('multibrot batch includes u_power and smoothEscapeGeneral', () => {
    const src = assembleMultiFrameBatchSource('multibrot3', 'classic', false)!;
    expect(src).toContain('u_power');
    expect(src).toContain('smoothEscapeGeneral');
  });

  it('stripe resolve uses cosine palette not texture', () => {
    const src = assembleResolveSource('stripe', false)!;
    expect(src).toContain('sin(t + vec3(');
  });
});
