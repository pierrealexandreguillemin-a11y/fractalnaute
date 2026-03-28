/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Canvas Renderer (Facade)
 * Feature-detects SharedArrayBuffer → parallel pool or single-thread fallback
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport, PaletteName, FractalType, FractalParams, ColoringMode, RenderBackend, PrecisionMode, OrbitData } from '../domain';
import type { WorkerPool } from './workerPool';
import type { WebGLRenderer, GPURenderOptions } from './gpu';
import { renderWithPool } from './renderCoordinator';
import { renderBand, buildMergedParams } from './renderBand';
import { needsPerturbation, computeReferenceOrbit, cancelOrbit } from './wasmBridge';

/** Max retry attempts while waiting for perturbation shader compilation */
const PERTURBATION_RENDER_MAX_RETRIES = 30; // ~500ms at 16ms/frame

/** Retry perturbation GPU render until shader compiles (async KHR_parallel_shader_compile). */
function tryPerturbationRender(
  gpu: WebGLRenderer,
  opts: GPURenderOptions,
  onComplete?: (renderTime: number, backend: RenderBackend) => void,
  attempt = 0
): void {
  const t0 = performance.now();
  if (gpu.render(opts)) {
    gpu.setVisible(true);
    onComplete?.(performance.now() - t0, 'gpu');
    return;
  }
  if (attempt >= PERTURBATION_RENDER_MAX_RETRIES) {
    console.warn('[perturbation] shader compile timeout — falling back');
    onComplete?.(0, 'cpu');
    return;
  }
  requestAnimationFrame(() => tryPerturbationRender(gpu, opts, onComplete, attempt + 1));
}

export interface RenderOptions {
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  ssaa?: boolean;
  zoomTargetRe?: number;
  zoomTargetIm?: number;
  onProgress?: (progress: number) => void;
  onComplete?: (renderTime: number, backend: RenderBackend) => void;
}

/** Select precision mode based on zoom depth and fractal type. */
function getPrecisionMode(viewport: Viewport, fractalType: FractalType): PrecisionMode {
  if (!needsPerturbation(viewport.scale)) {
    return fractalType === 'mandelbrot' ? 'doubleSingle' : 'float32';
  }
  return (fractalType === 'mandelbrot' || fractalType === 'julia')
    ? 'perturbation' : 'doubleSingle';
}

/**
 * Render a fractal to canvas.
 * If pool is provided, uses parallel workers.
 * Otherwise, falls back to single-thread chunked rendering.
 */
export function renderFractal(
  canvas: HTMLCanvasElement,
  pool: WorkerPool | null,
  gpuRenderer: WebGLRenderer | null,
  options: RenderOptions
): () => void {
  // Perturbation path: async WASM orbit → GPU render (deep zoom on Mandelbrot/Julia)
  const precision = getPrecisionMode(options.viewport, options.fractalType);

  if (precision === 'perturbation' && gpuRenderer?.isReady()) {
    const refRe = options.zoomTargetRe ?? options.viewport.centerRe;
    const refIm = options.zoomTargetIm ?? options.viewport.centerIm;

    computeReferenceOrbit(
      refRe.toString(), refIm.toString(),
      options.maxIterations, options.viewport.scale.toString()
    ).then(({ data, length, cancelled }) => {
      if (cancelled) return;
      const orbitData: OrbitData = { data, length, refPointRe: refRe, refPointIm: refIm };
      const renderOpts = {
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
      tryPerturbationRender(gpuRenderer, renderOpts, options.onComplete);
    }).catch((err: unknown) => {
      console.warn('[perturbation] orbit failed:', String(err));
      options.onComplete?.(0, 'cpu');
    });

    return () => { cancelOrbit(); gpuRenderer.cancelPending(); };
  }

  // Try GPU path first
  if (gpuRenderer?.isReady()) {
    const startTime = performance.now();
    const rendered = gpuRenderer.render({
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      coloringMode: options.coloringMode ?? 'classic',
      interiorColoring: options.interiorColoring ?? false,
      fractalParams: options.params,
      ssaa: options.ssaa
    });
    if (rendered) {
      gpuRenderer.setVisible(true);
      const elapsed = performance.now() - startTime;
      options.onComplete?.(elapsed, 'gpu');
      return () => { gpuRenderer.cancelPending(); };
    }
    // GPU not ready (compiling) — hide GPU canvas, fall through to CPU
    gpuRenderer.setVisible(false);
  }

  if (pool) {
    return renderWithPool({
      canvas, pool,
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      palette: options.palette,
      params: options.params,
      coloringMode: options.coloringMode,
      interiorColoring: options.interiorColoring,
      onProgress: options.onProgress,
      onComplete: options.onComplete
    });
  }
  return renderFallback(canvas, options);
}

/** Single-thread fallback (chunked requestAnimationFrame) */
function renderFallback(
  canvas: HTMLCanvasElement,
  options: RenderOptions
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const {
    fractalType, viewport, maxIterations,
    palette, params, coloringMode, interiorColoring,
    onProgress, onComplete
  } = options;
  const { width, height } = canvas;
  const mergedParams = buildMergedParams(fractalType, params);
  const imageData = ctx.createImageData(width, height);
  const startTime = performance.now();
  let cancelled = false;
  let currentY = 0;
  /** Rows per animation frame in fallback (single-thread) mode. Balances responsiveness vs overhead. */
  const FALLBACK_CHUNK_HEIGHT = 12;

  const renderChunk = () => {
    if (cancelled) return;
    const endY = Math.min(currentY + FALLBACK_CHUNK_HEIGHT, height);

    renderBand(imageData.data, {
      startY: currentY, endY, width, height,
      viewport, fractalType, maxIterations, palette, params: mergedParams,
      coloringMode, interiorColoring
    }, () => cancelled);

    ctx.putImageData(imageData, 0, 0, 0, currentY, width, endY - currentY);
    currentY = endY;
    onProgress?.(currentY / height);

    if (currentY < height) {
      requestAnimationFrame(renderChunk);
    } else {
      onComplete?.(performance.now() - startTime, 'cpu');
    }
  };

  requestAnimationFrame(renderChunk);
  return () => { cancelled = true; };
}
