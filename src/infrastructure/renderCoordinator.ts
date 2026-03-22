/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Coordinator
 * SRP: distributes bands to workers, handles progressive rendering
 * Does not manage worker lifecycle (that's workerPool.ts)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  FractalType, PaletteName, FractalParams, Viewport, ColoringMode
} from '../domain/types';
import type { WorkerPool } from './workerPool';
import type { ExposedStrip } from './viewportTransform';
import { getOrCreateImageData } from './canvasUtils';

export interface CoordinatorRenderOptions {
  canvas: HTMLCanvasElement;
  pool: WorkerPool;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  onProgress?: (progress: number) => void;
  onComplete?: (renderTime: number) => void;
}

/** Preview stride — 1/16 of pixels computed, filled as 4x4 blocks */
const PREVIEW_STRIDE = 4;

/** Monotonic render ID — prevents stale band-done messages from old renders */
let nextRenderId = 0;


/** Shared state for a render session (preview + full-res passes) */
interface RenderSession {
  ctx: CanvasRenderingContext2D;
  pool: WorkerPool;
  buffer: SharedArrayBuffer;
  view: Uint8ClampedArray;
  imageData: ImageData;
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  cancelled: boolean;
}

/**
 * Dispatch a single pass (preview or full-res) to workers.
 * Returns a cleanup function for message handlers.
 */
function dispatchPass(
  session: RenderSession,
  stride: number,
  renderId: number,
  onPassComplete: () => void
): () => void {
  const { pool, buffer, view, imageData, ctx, width, height } = session;
  const bandHeight = Math.ceil(height / pool.size);
  let completedBands = 0;
  let totalBands = 0;
  const handlers: ((e: MessageEvent) => void)[] = [];

  for (let i = 0; i < pool.size; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(startY + bandHeight, height);
    if (startY >= height) break;
    totalBands++;

    const handler = (e: MessageEvent) => {
      if (session.cancelled) return;
      if (e.data.type !== 'band-done') return;
      if (e.data.renderId !== renderId) return;

      const bStart = e.data.startY * width * 4;
      const bEnd = e.data.endY * width * 4;
      imageData.data.set(view.subarray(bStart, bEnd), bStart);

      ctx.putImageData(
        imageData, 0, 0,
        0, e.data.startY, width, e.data.endY - e.data.startY
      );

      completedBands++;
      if (completedBands === totalBands) {
        cleanup();
        onPassComplete();
      }
    };

    pool.workers[i]!.addEventListener('message', handler);
    handlers.push(handler);

    pool.workers[i]!.postMessage({
      band: { startY, endY },
      renderId,
      stride,
      width, height,
      viewport: session.viewport,
      fractalType: session.fractalType,
      maxIterations: session.maxIterations,
      palette: session.palette,
      params: session.params,
      coloringMode: session.coloringMode,
      interiorColoring: session.interiorColoring,
      pixelBuffer: buffer,
      cancelFlag: pool.cancelFlag
    });
  }

  function cleanup(): void {
    for (let i = 0; i < handlers.length; i++) {
      pool.workers[i]?.removeEventListener('message', handlers[i]!);
    }
    handlers.length = 0;
  }

  return cleanup;
}

/**
 * Two-pass progressive rendering:
 * 1. Preview pass (stride 4) — 1/16 pixels, 4x4 blocks, near-instant
 * 2. Full-res pass (stride 1) — all pixels, band-by-band progressive
 *
 * Returns a cancel function.
 */
export function renderWithPool(
  options: CoordinatorRenderOptions
): () => void {
  const {
    canvas, pool, viewport, fractalType,
    maxIterations, palette, params,
    coloringMode, interiorColoring,
    onProgress, onComplete
  } = options;

  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const width = canvas.width;
  const height = canvas.height;
  const renderId = nextRenderId++;

  pool.cancel();
  pool.resetCancel();

  const { buffer, view } = pool.getPixelBuffer(width, height);
  const imageData = getOrCreateImageData(ctx, width, height);
  const startTime = performance.now();

  const session: RenderSession = {
    ctx, pool, buffer, view, imageData, width, height,
    viewport, fractalType, maxIterations, palette, params,
    coloringMode, interiorColoring,
    cancelled: false
  };

  let activeCleanup: (() => void) | null = null;

  // Pass 1: preview (stride 4)
  activeCleanup = dispatchPass(session, PREVIEW_STRIDE, renderId, () => {
    if (session.cancelled) return;
    onProgress?.(0);

    // Pass 2: full resolution (stride 1)
    pool.resetCancel();
    activeCleanup = dispatchPass(session, 1, renderId, () => {
      onProgress?.(1);
      onComplete?.(performance.now() - startTime);
    });
  });

  return () => {
    session.cancelled = true;
    pool.cancel();
    activeCleanup?.();
  };
}

/**
 * Render only exposed strips (after pan pixel-shift).
 * Dispatches each strip's Y-range as a full-width band to a worker.
 * Over-renders X dimension vs. strip boundaries, but strips are typically
 * <10% of canvas, so the overhead is negligible vs. protocol complexity.
 *
 * @precondition Caller must call pool.cancel() + pool.resetCancel() before invoking.
 * Returns a cancel function.
 */
export function renderStripsWithPool(
  options: CoordinatorRenderOptions,
  strips: ExposedStrip[]
): () => void {
  const {
    canvas, pool, viewport, fractalType,
    maxIterations, palette, params,
    coloringMode, interiorColoring,
    onProgress, onComplete
  } = options;

  const ctx = canvas.getContext('2d');
  if (!ctx || strips.length === 0) return () => {};

  const width = canvas.width;
  const height = canvas.height;
  const renderId = nextRenderId++;

  const { buffer, view } = pool.getPixelBuffer(width, height);
  const imageData = getOrCreateImageData(ctx, width, height);
  const startTime = performance.now();

  let completedStrips = 0;
  let cancelled = false;
  const handlers: { worker: Worker; handler: (e: MessageEvent) => void }[] = [];

  for (let i = 0; i < strips.length; i++) {
    const strip = strips[i]!;
    const workerIdx = i % pool.size;
    const worker = pool.workers[workerIdx]!;

    const handler = (e: MessageEvent) => {
      if (cancelled) return;
      if (e.data.type !== 'band-done') return;
      if (e.data.renderId !== renderId) return;

      const bStart = e.data.startY * width * 4;
      const bEnd = e.data.endY * width * 4;
      imageData.data.set(view.subarray(bStart, bEnd), bStart);
      ctx.putImageData(
        imageData, 0, 0,
        strip.startX, e.data.startY,
        strip.endX - strip.startX, e.data.endY - e.data.startY
      );

      completedStrips++;
      if (completedStrips === strips.length) {
        cleanup();
        onProgress?.(1);
        onComplete?.(performance.now() - startTime);
      }
    };

    worker.addEventListener('message', handler);
    handlers.push({ worker, handler });

    worker.postMessage({
      band: {
        startX: strip.startX, endX: strip.endX,
        startY: strip.startY, endY: strip.endY
      },
      renderId,
      stride: 1,
      width, height, viewport, fractalType,
      maxIterations, palette, params,
      coloringMode, interiorColoring,
      pixelBuffer: buffer,
      cancelFlag: pool.cancelFlag
    });
  }

  function cleanup(): void {
    for (const { worker, handler } of handlers) {
      worker.removeEventListener('message', handler);
    }
    handlers.length = 0;
  }

  return () => {
    cancelled = true;
    pool.cancel();
    cleanup();
  };
}
