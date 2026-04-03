/**
 * Perturbation rendering orchestration.
 * Manages orbit result → GPU render → DS fallback → shader compile retry loop.
 */

import type { OrbitData } from '../domain';
import type { WorkerPool } from './workerPool';
import type { WebGLRenderer } from './gpu';
import { renderWithPool } from './renderCoordinator';
import type { RenderOptions } from './renderer';

/** Cancellable retry state for perturbation shader compile wait */
let perturbationRetryId: number | null = null;

export function cancelPerturbationRetry(): void {
  if (perturbationRetryId !== null) {
    cancelAnimationFrame(perturbationRetryId);
    perturbationRetryId = null;
  }
}

/** DS GPU / CPU fallback when perturbation shader isn't ready yet. */
export function renderDsFallback(
  canvas: HTMLCanvasElement, pool: WorkerPool | null,
  gpu: WebGLRenderer, options: RenderOptions
): void {
  const t0 = performance.now();
  const ok = gpu.render({
    viewport: options.viewport,
    fractalType: options.fractalType,
    maxIterations: options.maxIterations,
    coloringMode: options.coloringMode ?? 'classic',
    interiorColoring: options.interiorColoring ?? false,
    fractalParams: options.params,
    ssaa: options.ssaa,
  });
  if (ok) {
    gpu.setVisible(true);
    options.onComplete?.(performance.now() - t0, 'gpu');
    return;
  }
  if (pool) {
    renderWithPool({
      canvas, pool,
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      palette: options.palette,
      params: options.params,
      coloringMode: options.coloringMode,
      interiorColoring: options.interiorColoring,
      onProgress: options.onProgress,
      onComplete: options.onComplete,
    });
  } else {
    options.onComplete?.(0, 'cpu');
  }
}

// @tradeoff AMD ANGLE can't run GLSL loops >4096 even with #define.
// Cap perturbation GPU shader to 4096 iter (orbit has full data, shader uses first N).
// Multi-frame perturbation (E2e) would lift this — not yet implemented.
const PERTURBATION_GPU_MAX_ITER = 4096;

/** Handle perturbation orbit result: GPU render → DS preview + upgrade loop. */
export function handleOrbitResult(
  gpu: WebGLRenderer, orbitData: OrbitData,
  _canvas: HTMLCanvasElement, _pool: WorkerPool | null, options: RenderOptions,
  isStale: () => boolean
): void {
  // Cap shader iter to avoid AMD ANGLE loop limit, but orbit retains full data.
  const gpuMaxIter = Math.min(options.maxIterations, PERTURBATION_GPU_MAX_ITER, orbitData.length);
  const perturbOpts = {
    viewport: options.viewport, fractalType: options.fractalType,
    maxIterations: gpuMaxIter,
    coloringMode: options.coloringMode ?? 'classic' as const,
    interiorColoring: options.interiorColoring ?? false,
    fractalParams: options.params, ssaa: options.ssaa,
    precision: 'perturbation' as const, orbitData,
  };
  const t0 = performance.now();
  if (gpu.render(perturbOpts)) {
    gpu.setVisible(true);
    options.onComplete?.(performance.now() - t0, 'gpu');
    return;
  }
  // Don't render DS fallback at perturbation depths — DS precision is exhausted.
  // Keep retrying GPU until shader compiles (up to 10s = ~600 frames).
  gpu.setVisible(false);
  let attempt = 0;
  const tryUpgrade = () => {
    if (isStale() || attempt++ > 600) return;
    if (gpu.render(perturbOpts)) {
      gpu.setVisible(true);
      options.onComplete?.(performance.now() - t0, 'gpu');
      return;
    }
    perturbationRetryId = requestAnimationFrame(tryUpgrade);
  };
  perturbationRetryId = requestAnimationFrame(tryUpgrade);
}
