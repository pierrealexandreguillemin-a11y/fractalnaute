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

/** Auto-scale iterations for deep zoom: more depth → more iterations needed. */
export function suggestIterations(scale: number, userMax: number): number {
  // sqrt(2/scale) gives a good heuristic for iteration count at depth
  const suggested = Math.ceil(Math.sqrt(2 / scale));
  // Use the larger of user setting and auto suggestion, cap at 100000
  return Math.min(100000, Math.max(userMax, suggested));
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
/** Launch perturbation render (orbit + GPU). Returns cancel function. */
function renderPerturbation(
  canvas: HTMLCanvasElement, pool: WorkerPool | null,
  gpuRenderer: WebGLRenderer, options: RenderOptions
): () => void {
  const refRe = options.zoomTargetRe ?? options.viewport.centerRe;
  const refIm = options.zoomTargetIm ?? options.viewport.centerIm;
  let stale = false;
  const isStale = () => stale;

  // Auto-scale iterations for deep zoom
  const effectiveMaxIter = suggestIterations(options.viewport.scale, options.maxIterations);

  // @tradeoff maxDc ≈ scale × 2 (conservative upper bound for max |δc|).
  const maxDc = options.viewport.scale * 2;

  // Use deep strings only when ref point IS the viewport center (no zoom target override).
  // When zoomTarget differs, deep strings describe a different point — use f64.toString().
  const refReStr = (options.zoomTargetRe === undefined)
    ? (options.viewport.deepRe ?? refRe.toString()) : refRe.toString();
  const refImStr = (options.zoomTargetIm === undefined)
    ? (options.viewport.deepIm ?? refIm.toString()) : refIm.toString();
  const scaleStr = options.viewport.deepScale ?? options.viewport.scale.toString();

  computeReferenceOrbit(
    refReStr, refImStr,
    effectiveMaxIter, scaleStr, maxDc
  ).then(({ data, length, cancelled, blaData, blaNumLevels, blaLevelOffsets }) => {
    if (cancelled || stale) return;
    const orbitData: OrbitData = {
      data, length, refPointRe: refRe, refPointIm: refIm,
      blaData, blaNumLevels, blaLevelOffsets,
      rescaleS: computeRescaleS(options.viewport.scale, canvas.width),
    };
    // Pass effectiveMaxIter to GPU render via options override
    const perturbOpts = { ...options, maxIterations: effectiveMaxIter };
    handleOrbitResult(gpuRenderer, orbitData, canvas, pool, perturbOpts, isStale);
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

export function renderFractal(
  canvas: HTMLCanvasElement,
  pool: WorkerPool | null,
  gpuRenderer: WebGLRenderer | null,
  options: RenderOptions
): () => void {
  const precision = getPrecisionMode(options.viewport, options.fractalType);

  if (precision === 'perturbation' && gpuRenderer?.isReady()) {
    return renderPerturbation(canvas, pool, gpuRenderer, options);
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
