/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - Canvas Renderer (Facade)
 * Feature-detects SharedArrayBuffer → parallel pool or single-thread fallback
 * ===============================================================================
 */

import type { Viewport, PaletteName, FractalType, FractalParams, ColoringMode, RenderBackend, PrecisionMode, OrbitData } from '../domain';
import type { WorkerPool } from './workerPool';
import type { WebGLRenderer } from './gpu';
import { renderWithPool } from './renderCoordinator';
import { renderBand, buildMergedParams } from './renderBand';
import { needsPerturbation, computeReferenceOrbit, cancelOrbit } from './wasmBridge';
import { handleOrbitResult, cancelPerturbationRetry, renderDsFallback } from './perturbationRenderer';

export interface RenderOptions {
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  ssaa?: boolean;
  onStatusMessage?: (message: string | null) => void;
  zoomTargetRe?: number;
  zoomTargetIm?: number;
  onProgress?: (progress: number) => void;
  onComplete?: (renderTime: number, backend: RenderBackend) => void;
}

/** Compute rescaling factor S = 2^k for float32 delta precision. */
export function computeRescaleS(scale: number, canvasWidth: number): number {
  const pixelSpacing = scale / canvasWidth;
  const k = Math.max(0, -Math.floor(Math.log2(pixelSpacing)) - 4);
  return 2 ** k;
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
  const precision = getPrecisionMode(options.viewport, options.fractalType);

  if (precision === 'perturbation' && gpuRenderer?.isReady()) {
    const refRe = options.zoomTargetRe ?? options.viewport.centerRe;
    const refIm = options.zoomTargetIm ?? options.viewport.centerIm;
    let stale = false;
    const isStale = () => stale;

    // @tradeoff maxDc ≈ scale × 2 (conservative upper bound for max |δc|).
    // Exact: max|pixel - ref| across viewport, but scale×2 covers the diagonal.
    // Too large → BLA validity radii shrink (fewer skips). Too small → artifacts.
    const maxDc = options.viewport.scale * 2;

    computeReferenceOrbit(
      refRe.toString(), refIm.toString(),
      options.maxIterations, options.viewport.scale.toString(), maxDc
    ).then(({ data, length, cancelled, blaData, blaNumLevels, blaLevelOffsets }) => {
      if (cancelled || stale) return;
      const orbitData: OrbitData = {
        data, length, refPointRe: refRe, refPointIm: refIm,
        blaData, blaNumLevels, blaLevelOffsets,
        rescaleS: computeRescaleS(options.viewport.scale, canvas.width),
      };
      handleOrbitResult(gpuRenderer, orbitData, canvas, pool, options, isStale);
    }).catch((err: unknown) => {
      if (stale) return;
      const msg = String(err);
      console.warn('[perturbation] orbit failed:', msg);
      if (msg.includes('timed out')) {
        options.onStatusMessage?.('Orbit computation timed out — using standard precision');
      } else if (msg.includes('memory') || msg.includes('alloc')) {
        options.onStatusMessage?.('Not enough memory for this zoom depth — try reducing iterations');
      } else {
        options.onStatusMessage?.('Deep zoom computation failed — using standard precision');
      }
      gpuRenderer.setVisible(false);
      renderDsFallback(canvas, pool, gpuRenderer, options);
    });

    return () => { stale = true; cancelOrbit(); cancelPerturbationRetry(); gpuRenderer.cancelPending(); };
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
