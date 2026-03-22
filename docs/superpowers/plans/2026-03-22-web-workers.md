# Web Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize fractal rendering across N CPU cores using SharedArrayBuffer worker pool with progressive band-by-band rendering.

**Architecture:** A pool of N Web Workers (`navigator.hardwareConcurrency`) splits the canvas into horizontal bands. Each worker computes its band and writes RGBA pixels directly into a SharedArrayBuffer. The main thread does partial `putImageData` for each completed band. Cancellation via Atomics flag. Pool lifecycle managed via `useRef`.

**Tech Stack:** Web Workers, SharedArrayBuffer, Atomics, Next.js 16 (Turbopack worker bundling via `new URL('./worker.ts', import.meta.url)`)

**Spec:** `docs/superpowers/specs/2026-03-22-web-workers-design.md`

---

## File Structure

### Files to CREATE:
- `src/infrastructure/fractal.worker.ts` — Worker entry point (receives band, computes pixels, writes to SAB)
- `src/infrastructure/workerPool.ts` — Pool manager (creates workers, distributes bands, handles messages)

### Files to MODIFY:
- `src/infrastructure/renderer.ts` — Rewrite `renderFractal` to use worker pool
- `src/infrastructure/useRenderer.ts` — Adapt for async pool-based rendering
- `src/infrastructure/index.ts` — Export pool types if needed

### Files UNCHANGED:
- `src/domain/*` — All domain code stays the same, imported by workers
- `src/application/*` — Hooks unchanged
- `src/ui/*` — UI unchanged

---

## Task 1: Create the fractal worker

**Files:**
- Create: `src/infrastructure/fractal.worker.ts`

**Why:** The worker is the unit of parallelism. It must import domain functions, receive a band definition, compute pixels, write directly to SharedArrayBuffer, check cancel flag, and post completion message.

- [ ] **Step 1: Create `src/infrastructure/fractal.worker.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Fractal Worker
 * Computes a horizontal band of pixels and writes RGBA to SharedArrayBuffer
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { getFractalConfig } from '../domain/fractalTypes';
import { resolvePalette, getColorFast } from '../domain/palettes';
import type { FractalType, PaletteName, FractalParams, Viewport } from '../domain/types';

/** Message received by the worker */
interface WorkerInput {
  band: { startY: number; endY: number };
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  pixelBuffer: SharedArrayBuffer;
  cancelFlag: SharedArrayBuffer;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const {
    band, width, height, viewport,
    fractalType, maxIterations, palette, params,
    pixelBuffer, cancelFlag
  } = e.data;

  const pixels = new Uint8ClampedArray(pixelBuffer);
  const cancel = new Int32Array(cancelFlag);

  // Resolve calculator and palette once
  const config = getFractalConfig(fractalType);
  const calculator = config.calculator;
  const mergedParams = { ...config.params, ...params };
  const resolvedPalette = resolvePalette(palette);

  // Precalculate coordinate mapping
  const aspectRatio = width / height;
  const stepRe = viewport.scale * aspectRatio / width;
  const stepIm = viewport.scale / height;
  const originRe = viewport.centerRe - viewport.scale * aspectRatio * 0.5;
  const originIm = viewport.centerIm - viewport.scale * 0.5;

  // Compute band
  for (let y = band.startY; y < band.endY; y++) {
    // Check cancel flag every line
    if (Atomics.load(cancel, 0) === 1) {
      return; // Exit silently, await next message
    }

    for (let x = 0; x < width; x++) {
      const re = originRe + x * stepRe;
      const im = originIm + y * stepIm;
      const result = calculator(re, im, maxIterations, mergedParams);
      const [r, g, b] = getColorFast(result, resolvedPalette);

      const idx = (y * width + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  // Signal completion
  self.postMessage({
    type: 'band-done',
    startY: band.startY,
    endY: band.endY
  });
};
```

Note: This worker imports from `../domain/` directly. Next.js Turbopack bundles these imports into the worker file automatically when using `new URL('./fractal.worker.ts', import.meta.url)`.

- [ ] **Step 2: Commit**

```
feat(infra): create fractal worker for parallel band computation
```

---

## Task 2: Create the worker pool manager

**Files:**
- Create: `src/infrastructure/workerPool.ts`

**Why:** The pool manages worker lifecycle, distributes bands, handles messages, and coordinates the SharedArrayBuffer. This is the orchestration layer.

- [ ] **Step 1: Create `src/infrastructure/workerPool.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Worker Pool
 * Manages N fractal workers with SharedArrayBuffer for parallel rendering
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  FractalType, PaletteName, FractalParams, Viewport
} from '../domain/types';

export interface PoolRenderOptions {
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  onBandComplete?: (startY: number, endY: number) => void;
}

/**
 * Pool of Web Workers for parallel fractal computation.
 * Workers write directly to a SharedArrayBuffer.
 */
export class WorkerPool {
  private workers: Worker[] = [];
  private cancelFlag: SharedArrayBuffer;
  private cancelView: Int32Array;
  private pixelBuffer: SharedArrayBuffer | null = null;
  private pixelView: Uint8ClampedArray | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private pendingBands = 0;
  private renderResolve: ((time: number) => void) | null = null;
  private renderStartTime = 0;

  constructor(private poolSize: number) {
    // Cancel flag: 1 byte SharedArrayBuffer
    this.cancelFlag = new SharedArrayBuffer(4); // Int32 needs 4 bytes
    this.cancelView = new Int32Array(this.cancelFlag);

    // Create workers
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(
        new URL('./fractal.worker.ts', import.meta.url)
      );
      worker.onmessage = (e) => this.handleMessage(e);
      this.workers.push(worker);
    }
  }

  /** Ensure pixel buffer matches canvas dimensions */
  private ensureBuffer(width: number, height: number): void {
    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.pixelBuffer = new SharedArrayBuffer(width * height * 4);
      this.pixelView = new Uint8ClampedArray(this.pixelBuffer);
      this.lastWidth = width;
      this.lastHeight = height;
    }
  }

  /** Handle band-done messages from workers */
  private handleMessage(e: MessageEvent): void {
    if (e.data.type !== 'band-done') return;

    this.onBandCompleteCallback?.(e.data.startY, e.data.endY);

    this.pendingBands--;
    if (this.pendingBands === 0 && this.renderResolve) {
      const time = performance.now() - this.renderStartTime;
      this.renderResolve(time);
      this.renderResolve = null;
    }
  }

  private onBandCompleteCallback?:
    (startY: number, endY: number) => void;

  /** Cancel current render. Workers check flag every line. */
  cancel(): void {
    Atomics.store(this.cancelView, 0, 1);
  }

  /**
   * Render fractals in parallel across all workers.
   * Returns a promise that resolves with render time in ms.
   */
  render(options: PoolRenderOptions): Promise<number> {
    const {
      width, height, viewport, fractalType,
      maxIterations, palette, params, onBandComplete
    } = options;

    // Cancel any in-progress render
    this.cancel();

    // Reset cancel flag
    Atomics.store(this.cancelView, 0, 0);

    // Ensure buffer is right size
    this.ensureBuffer(width, height);

    this.onBandCompleteCallback = onBandComplete;
    this.renderStartTime = performance.now();

    // Split into bands
    const bandHeight = Math.ceil(height / this.poolSize);
    this.pendingBands = 0;

    for (let i = 0; i < this.poolSize; i++) {
      const startY = i * bandHeight;
      const endY = Math.min(startY + bandHeight, height);
      if (startY >= height) break; // More workers than lines

      this.pendingBands++;
      this.workers[i]!.postMessage({
        band: { startY, endY },
        width, height, viewport, fractalType,
        maxIterations, palette, params,
        pixelBuffer: this.pixelBuffer,
        cancelFlag: this.cancelFlag
      });
    }

    return new Promise((resolve) => {
      this.renderResolve = resolve;
    });
  }

  /** Get pixel data for putImageData */
  getPixelView(): Uint8ClampedArray | null {
    return this.pixelView;
  }

  /** Terminate all workers and release resources */
  destroy(): void {
    this.cancel();
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.pixelBuffer = null;
    this.pixelView = null;
    this.renderResolve = null;
  }
}

/** Create a pool with optimal worker count */
export function createWorkerPool(): WorkerPool {
  const cores = typeof navigator !== 'undefined'
    ? navigator.hardwareConcurrency ?? 4
    : 4;
  // Use cores - 1 to leave main thread responsive, minimum 2
  const poolSize = Math.max(2, cores - 1);
  return new WorkerPool(poolSize);
}
```

- [ ] **Step 2: Commit**

```
feat(infra): create worker pool manager with SharedArrayBuffer
```

---

## Task 3: Rewrite renderer to use worker pool

**Files:**
- Modify: `src/infrastructure/renderer.ts`

**Why:** Replace the single-threaded chunked `requestAnimationFrame` loop with pool-based parallel rendering. The renderer becomes a thin wrapper that creates an ImageData, delegates to the pool, and does `putImageData` on band completion.

- [ ] **Step 1: Rewrite `src/infrastructure/renderer.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Canvas Renderer
 * Delegates fractal computation to worker pool, handles canvas output
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import type { WorkerPool } from './workerPool';

export interface RenderOptions {
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  onProgress?: (progress: number) => void;
  onComplete?: (renderTime: number) => void;
}

/**
 * Render a fractal using the worker pool.
 * Returns a cancel function.
 */
export function renderFractal(
  canvas: HTMLCanvasElement,
  pool: WorkerPool,
  options: RenderOptions
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const {
    fractalType, viewport, maxIterations,
    palette, params, onProgress, onComplete
  } = options;
  const width = canvas.width;
  const height = canvas.height;

  // ImageData for putImageData — backed by pool's SharedArrayBuffer
  let imageData: ImageData | null = null;
  let totalBands = 0;
  let completedBands = 0;

  pool.render({
    width, height, viewport, fractalType,
    maxIterations, palette, params,
    onBandComplete: (startY, endY) => {
      // Create ImageData from SAB on first band completion
      if (!imageData) {
        const view = pool.getPixelView();
        if (!view) return;
        imageData = new ImageData(view, width, height);
        totalBands = Math.ceil(
          height / Math.ceil(height / (navigator.hardwareConcurrency ?? 4))
        );
      }

      // Partial putImageData for this band
      ctx.putImageData(imageData, 0, 0, 0, startY, width, endY - startY);

      completedBands++;
      onProgress?.(completedBands / totalBands);
    }
  }).then((renderTime) => {
    onComplete?.(renderTime);
  });

  // Return cancel function
  return () => {
    pool.cancel();
  };
}
```

Note: `renderFractal` now takes a `pool` parameter. This changes its signature — `useRenderer` will pass the pool.

- [ ] **Step 2: Commit**

```
feat(infra): rewrite renderer to delegate to worker pool
```

---

## Task 4: Adapt useRenderer for pool-based rendering

**Files:**
- Modify: `src/infrastructure/useRenderer.ts`

**Why:** The hook must create the pool on mount, store it in a ref, pass it to `renderFractal`, and destroy it on unmount.

- [ ] **Step 1: Rewrite `src/infrastructure/useRenderer.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * React hook managing worker pool lifecycle and fractal rendering
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import { renderFractal } from './renderer';
import { createWorkerPool, type WorkerPool } from './workerPool';
import { resizeCanvas, downloadCanvas } from './canvasUtils';

interface UseRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  onRenderStart?: () => void;
  onRenderComplete?: (renderTime: number) => void;
}

/**
 * Custom hook for managing fractal rendering with worker pool
 */
export function useRenderer({
  canvasRef,
  containerRef,
  fractalType,
  viewport,
  maxIterations,
  palette,
  params,
  onRenderStart,
  onRenderComplete
}: UseRendererOptions) {
  const cancelRenderRef = useRef<(() => void) | null>(null);
  const poolRef = useRef<WorkerPool | null>(null);

  // Store callbacks in refs to avoid infinite render loop
  const onRenderStartRef = useRef(onRenderStart);
  const onRenderCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onRenderStartRef.current = onRenderStart;
    onRenderCompleteRef.current = onRenderComplete;
  }, [onRenderStart, onRenderComplete]);

  // Create pool on mount, destroy on unmount
  useEffect(() => {
    poolRef.current = createWorkerPool();
    return () => {
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    resizeCanvas(canvas, container);
  }, [canvasRef, containerRef]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const pool = poolRef.current;
    if (!canvas || !pool) return;

    if (cancelRenderRef.current) {
      cancelRenderRef.current();
    }

    onRenderStartRef.current?.();

    cancelRenderRef.current = renderFractal(canvas, pool, {
      fractalType,
      viewport,
      maxIterations,
      palette,
      params,
      onComplete: (renderTime) => {
        cancelRenderRef.current = null;
        onRenderCompleteRef.current?.(renderTime);
      }
    });
  }, [canvasRef, fractalType, viewport, maxIterations, palette, params]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, fractalType);
  }, [canvasRef, fractalType]);

  // Render on mount and on any state change
  useEffect(() => {
    handleResize();
    render();
  }, [handleResize, render]);

  // Window resize
  useEffect(() => {
    const onResize = () => {
      handleResize();
      render();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [handleResize, render]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (cancelRenderRef.current) {
        cancelRenderRef.current();
      }
    };
  }, []);

  return { exportImage };
}
```

- [ ] **Step 2: Update `src/infrastructure/index.ts`**

Add pool exports:
```ts
export { WorkerPool, createWorkerPool } from './workerPool';
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: success. The worker should be bundled separately by Next.js.

If build fails with worker-related errors, check that `new URL('./fractal.worker.ts', import.meta.url)` is supported by the bundler. If not, may need to use `worker-loader` or configure `next.config.ts` with `webpack` config for worker files.

- [ ] **Step 4: Verify dev server**

```bash
npm run dev
```

Open http://localhost:3000 and check:
1. Fractal renders (no blank canvas)
2. No console errors about SharedArrayBuffer
3. Theme switching still works
4. Zoom/pan still works
5. Check DevTools → Application → Service Workers or Sources to see the worker file

- [ ] **Step 5: Commit**

```
feat(infra): integrate worker pool into renderer and useRenderer hook
```

---

## Task 5: Verify and fix ESLint/TypeScript

**Files:**
- Possibly modify: any files with lint/type errors

**Why:** The new files must pass the strict ESLint rules (max-lines-per-function 80, complexity 15, sonarjs, etc.) and TypeScript strict mode.

- [ ] **Step 1: Run typecheck**

```bash
npx tsc --noEmit
```

Fix any errors (likely around `self.onmessage` typing in worker, `navigator.hardwareConcurrency` optional, etc.).

- [ ] **Step 2: Run ESLint**

```bash
npx eslint src/ app/ --max-warnings 0
```

Fix any violations. The worker file's `onmessage` handler may exceed 80 lines — if so, extract the computation loop into a separate function within the same file.

- [ ] **Step 3: Run build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```
fix: resolve ESLint and TypeScript issues in worker files
```

---

## Summary

| Task | Files | Key change |
|------|-------|-----------|
| 1 | 1 new | `fractal.worker.ts` — computation unit |
| 2 | 1 new | `workerPool.ts` — pool manager + SharedArrayBuffer |
| 3 | 1 modified | `renderer.ts` — rewritten for pool |
| 4 | 2 modified | `useRenderer.ts` + `index.ts` — pool lifecycle |
| 5 | varies | ESLint/TypeScript fixes |

**Execution order:** 1 → 2 → 3 → 4 → 5 (strictly sequential — each depends on the previous)

**Critical path:** Task 4 is where the integration happens. If the worker bundling doesn't work with Next.js/Turbopack, that's where it'll surface. The fallback is to add a webpack config in `next.config.ts` for worker files.

**Memory safety checklist:**
- Pool in `useRef` → created once on mount ✓
- Pool destroyed in `useEffect` return → cleanup on unmount ✓
- Cancel flag SAB → created once with pool, reset before each render ✓
- Pixel SAB → reused across renders, recreated only on resize ✓
- No message handler accumulation → set once per worker at creation ✓
