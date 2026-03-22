/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Coordinator
 * SRP: distributes bands to workers, handles progressive rendering
 * Does not manage worker lifecycle (that's workerPool.ts)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  FractalType, PaletteName, FractalParams, Viewport
} from '../domain/types';
import type { WorkerPool } from './workerPool';

export interface CoordinatorRenderOptions {
  canvas: HTMLCanvasElement;
  pool: WorkerPool;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  onProgress?: (progress: number) => void;
  onComplete?: (renderTime: number) => void;
}

/** Preview stride — 1/16 of pixels computed, filled as 4x4 blocks */
const PREVIEW_STRIDE = 4;

/** Monotonic render ID — prevents stale band-done messages from old renders */
let nextRenderId = 0;

/** Cached ImageData — reused when canvas dimensions haven't changed */
let cachedImageData: ImageData | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

function getOrCreateImageData(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): ImageData {
  if (cachedImageData && cachedWidth === width && cachedHeight === height) {
    return cachedImageData;
  }
  cachedImageData = ctx.createImageData(width, height);
  cachedWidth = width;
  cachedHeight = height;
  return cachedImageData;
}

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
