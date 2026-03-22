/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Worker Pool
 * SRP: manages worker lifecycle and SharedArrayBuffer allocation only
 * Render coordination is in renderCoordinator.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Check if SharedArrayBuffer is available (requires COOP/COEP headers) */
export function isSharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined';
}

export class WorkerPool {
  readonly workers: Worker[];
  readonly cancelFlag: SharedArrayBuffer;
  readonly cancelView: Int32Array;
  private pixelBuffer: SharedArrayBuffer | null = null;
  private pixelView: Uint8ClampedArray | null = null;
  private bufferWidth = 0;
  private bufferHeight = 0;

  constructor(readonly size: number) {
    this.cancelFlag = new SharedArrayBuffer(4);
    this.cancelView = new Int32Array(this.cancelFlag);

    this.workers = [];
    for (let i = 0; i < size; i++) {
      this.workers.push(
        new Worker(new URL('./fractal.worker.ts', import.meta.url))
      );
    }
  }

  /** Get or create pixel buffer matching canvas dimensions */
  getPixelBuffer(width: number, height: number): {
    buffer: SharedArrayBuffer;
    view: Uint8ClampedArray;
  } {
    if (
      width !== this.bufferWidth ||
      height !== this.bufferHeight ||
      !this.pixelBuffer ||
      !this.pixelView
    ) {
      this.pixelBuffer = new SharedArrayBuffer(width * height * 4);
      this.pixelView = new Uint8ClampedArray(this.pixelBuffer);
      this.bufferWidth = width;
      this.bufferHeight = height;
    }
    return { buffer: this.pixelBuffer, view: this.pixelView };
  }

  /** Signal all workers to cancel current computation */
  cancel(): void {
    Atomics.store(this.cancelView, 0, 1);
  }

  /** Reset cancel flag before new render */
  resetCancel(): void {
    Atomics.store(this.cancelView, 0, 0);
  }

  /** Terminate all workers and release resources */
  destroy(): void {
    this.cancel();
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers.length = 0;
    this.pixelBuffer = null;
    this.pixelView = null;
  }
}

/** Create pool with optimal size (cores - 1, min 2) */
export function createWorkerPool(): WorkerPool | null {
  if (!isSharedArrayBufferAvailable()) return null;

  const cores = navigator.hardwareConcurrency ?? 4;
  return new WorkerPool(Math.max(2, cores - 1));
}
