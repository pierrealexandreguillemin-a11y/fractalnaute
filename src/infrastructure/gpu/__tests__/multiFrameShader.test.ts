import { describe, it, expect } from 'vitest';
import {
  assembleMultiFrameBatchSource, assembleResolveSource,
  assembleMultiFramePerturbationBatchSource,
  assembleMultiFramePerturbationResolveSource,
} from '../shaderCompiler';
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

  // ---- Perturbation multi-frame batch tests (10: 2 fractals × 5 colorings) ----

  const PERTURB_FRACTALS: FractalType[] = ['mandelbrot', 'julia'];

  for (const f of PERTURB_FRACTALS) {
    for (const c of COLORINGS) {
      it(`assembles perturbation batch shader for ${f} + ${c}`, () => {
        const src = assembleMultiFramePerturbationBatchSource(f, c, false);
        expect(src).not.toBeNull();
        expect(src).toContain('#define BATCH_SIZE 256');
        expect(src).toContain('layout(location = 0) out vec4 outZ');
        expect(src).toContain('layout(location = 3) out vec4 outHist');
        expect(src).toContain('u_rescaleS');
        expect(src).toContain('getOrbitData');
      });
    }
  }

  // ---- Perturbation multi-frame resolve tests (10: 2 fractals × 5 colorings) --

  for (const f of PERTURB_FRACTALS) {
    for (const c of COLORINGS) {
      it(`assembles perturbation resolve shader for ${f} + ${c}`, () => {
        const src = assembleMultiFramePerturbationResolveSource(c, false);
        expect(src).not.toBeNull();
        expect(src).toContain('u_rescaleS');
        // Preamble marker: reconstructs z/dz from delta state
        expect(src).toContain('z = sAcc.xy');
        expect(src).toContain('dz = sZ.zw * invS');
        // IEEE 754-2019 NaN/Inf guard
        expect(src).toContain('isnan(z.x)');
        expect(src).toContain('out vec4 fragColor');
      });
    }
  }
});
