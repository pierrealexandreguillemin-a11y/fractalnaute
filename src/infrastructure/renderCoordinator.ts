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

  // Cancel any in-progress render + reset flag
  pool.cancel();
  pool.resetCancel();

  // Get or create pixel buffer
  const { buffer, view } = pool.getPixelBuffer(width, height);

  // Create ImageData backed by the SAB view.
  // TypeScript's ImageDataArray type requires ArrayBuffer (not SharedArrayBuffer),
  // but all modern browsers accept SAB-backed Uint8ClampedArray at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageData = new ImageData(view as any as Uint8ClampedArray<ArrayBuffer>, width, height);

  const startTime = performance.now();
  const bandHeight = Math.ceil(height / pool.size);
  let completedBands = 0;
  let totalBands = 0;

  // Set up message handlers for this render
  const handlers: ((e: MessageEvent) => void)[] = [];

  for (let i = 0; i < pool.size; i++) {
    const startY = i * bandHeight;
    const endY = Math.min(startY + bandHeight, height);
    if (startY >= height) break;
    totalBands++;

    const handler = (e: MessageEvent) => {
      if (e.data.type !== 'band-done') return;
      if (e.data.startY !== startY) return; // Not our band

      // Progressive: paint this band immediately
      ctx.putImageData(
        imageData, 0, 0,
        0, e.data.startY, width, e.data.endY - e.data.startY
      );

      completedBands++;
      onProgress?.(completedBands / totalBands);

      if (completedBands === totalBands) {
        // Clean up handlers
        cleanup();
        onComplete?.(performance.now() - startTime);
      }
    };

    pool.workers[i]!.addEventListener('message', handler);
    handlers.push(handler);

    // Dispatch band to worker
    pool.workers[i]!.postMessage({
      band: { startY, endY },
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
    pool.cancel();
    cleanup();
  };
}
