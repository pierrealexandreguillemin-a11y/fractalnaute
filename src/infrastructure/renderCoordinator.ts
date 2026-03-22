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

/** Monotonic render ID — prevents stale band-done messages from old renders */
let nextRenderId = 0;

/**
 * Distribute bands to workers and handle progressive canvas updates.
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

  // Cancel any in-progress render, then reset for new one
  pool.cancel();
  pool.resetCancel();

  // Get or create pixel buffer (SAB-backed)
  const { buffer, view } = pool.getPixelBuffer(width, height);

  // ImageData cannot wrap a SAB-backed Uint8ClampedArray (browser security restriction).
  // We create a plain ImageData and copy band regions from the SAB view on each completion.
  const imageData = ctx.createImageData(width, height);

  const startTime = performance.now();
  const bandHeight = Math.ceil(height / pool.size);
  let completedBands = 0;
  let totalBands = 0;
  let cancelled = false;

  // Set up message handlers for this render
  const handlers: ((e: MessageEvent) => void)[] = [];

  for (let i = 0; i < pool.size; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(startY + bandHeight, height);
    if (startY >= height) break;
    totalBands++;

    const handler = (e: MessageEvent) => {
      if (cancelled) return;
      if (e.data.type !== 'band-done') return;
      if (e.data.renderId !== renderId) return;

      // Copy band pixels from SAB view into plain ImageData, then paint
      const bStart = e.data.startY * width * 4;
      const bEnd = e.data.endY * width * 4;
      imageData.data.set(view.subarray(bStart, bEnd), bStart);

      ctx.putImageData(
        imageData, 0, 0,
        0, e.data.startY, width, e.data.endY - e.data.startY
      );

      completedBands++;
      onProgress?.(completedBands / totalBands);

      if (completedBands === totalBands) {
        cleanup();
        onComplete?.(performance.now() - startTime);
      }
    };

    pool.workers[i]!.addEventListener('message', handler);
    handlers.push(handler);

    // Dispatch band to worker
    pool.workers[i]!.postMessage({
      band: { startY, endY },
      renderId,
      width, height, viewport, fractalType,
      maxIterations, palette, params,
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

  // Return cancel function
  return () => {
    cancelled = true;
    pool.cancel();
    cleanup();
  };
}
