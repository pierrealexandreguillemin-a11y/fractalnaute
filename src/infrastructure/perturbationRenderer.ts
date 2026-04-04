/**
 * Perturbation rendering orchestration.
 * Routes orbit result to multi-frame GPU render (no iteration cap),
 * with single-pass fallback (4096 cap) when multi-frame is unavailable.
 */

import type { OrbitData } from '../domain';
import type { WebGLRenderer } from './gpu';
import type { RenderOptions } from './renderer';

// @tradeoff AMD ANGLE can't run GLSL loops >4096 even with #define.
// Single-pass fallback only — multi-frame has no such limit (256 iter/batch).
const SINGLE_PASS_MAX_ITER = 4096;

/**
 * Handle perturbation orbit result: multi-frame GPU render (preferred),
 * single-pass fallback (capped 4096) when multi-frame unavailable.
 * Returns cancel function from multi-frame, or null for single-pass.
 */
export function handleOrbitResult(
  gpu: WebGLRenderer, orbitData: OrbitData,
  options: RenderOptions, isStale: () => boolean
): (() => void) | null {
  if (isStale()) return null;

  const gpuOpts = {
    viewport: options.viewport,
    fractalType: options.fractalType,
    maxIterations: options.maxIterations,
    coloringMode: options.coloringMode ?? 'classic' as const,
    interiorColoring: options.interiorColoring ?? false,
    fractalParams: options.params,
    ssaa: options.ssaa,
    precision: 'perturbation' as const,
    orbitData,
  };

  // Preferred path: multi-frame (no iteration cap, 256 iter/batch).
  const cancel = gpu.renderMultiFrame(
    gpuOpts,
    (batch, total) => {
      options.onStatusMessage?.(
        `iter: ${options.maxIterations} (auto) \u2014 GPU batch ${batch}/${total}`
      );
    },
    (elapsed) => { options.onComplete?.(elapsed, 'gpu'); }
  );

  if (cancel) {
    gpu.setVisible(true);
    return cancel;
  }

  // Fallback: single-pass with 4096 cap (AMD ANGLE loop limit).
  const cappedOpts = {
    ...gpuOpts,
    maxIterations: Math.min(options.maxIterations, SINGLE_PASS_MAX_ITER, orbitData.length),
  };
  const t0 = performance.now();
  if (gpu.render(cappedOpts)) {
    gpu.setVisible(true);
    options.onComplete?.(performance.now() - t0, 'gpu');
    return null;
  }

  // GPU render failed entirely (shader not compiled yet).
  // At perturbation depths DS precision is exhausted — don't fallback.
  // CSS transform keeps the previous (correct) image stretched.
  gpu.setVisible(false);
  return null;
}
