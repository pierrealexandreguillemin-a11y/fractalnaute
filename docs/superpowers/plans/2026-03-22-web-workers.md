# Web Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize fractal rendering across N CPU cores using SharedArrayBuffer worker pool with progressive band-by-band rendering. Fallback to single-thread when SAB is unavailable.

**Architecture:** Shared render logic (`renderBand`) used by both worker and fallback paths. Worker pool managed by a dedicated class. Render coordination separated from pool lifecycle. Feature-detection gates SharedArrayBuffer before creating workers.

**Tech Stack:** Web Workers, SharedArrayBuffer, Atomics, Next.js 16

**Spec:** `docs/superpowers/specs/2026-03-22-web-workers-design.md`

---

## Definition of Done

- [ ] Fractal renders identically across all 5 types and all 4 themes
- [ ] Render time measured and logged: must be < 50% of single-thread baseline on 4+ core machine
- [ ] Zero memory leak: 10 consecutive renders show no heap growth in DevTools Memory tab
- [ ] Zoom/pan/reset/type-switch all trigger re-render without errors
- [ ] Cancel (new render during in-progress) works cleanly — no visual artifacts
- [ ] Fallback path works when SharedArrayBuffer is unavailable
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` all pass with zero errors/warnings

---

## File Structure

### Files to CREATE:
- `src/infrastructure/renderBand.ts` — Shared render logic (DRY: used by worker AND fallback)
- `src/infrastructure/fractal.worker.ts` — Worker entry point (thin: receives message, calls renderBand, posts done)
- `src/infrastructure/workerPool.ts` — Pool lifecycle (create/destroy workers, manage SAB)
- `src/infrastructure/renderCoordinator.ts` — Render orchestration (distribute bands, handle messages, progressive putImageData)

### Files to MODIFY:
- `src/infrastructure/renderer.ts` — Feature-detect SAB, delegate to coordinator or fallback
- `src/infrastructure/useRenderer.ts` — Pool in useRef, pass to renderer
- `src/infrastructure/index.ts` — Export new types

### Files UNCHANGED:
- `src/domain/*` — Imported by renderBand (and thus by workers)
- `src/application/*`, `src/ui/*`, `app/*`

---

## Task 1: Extract shared render logic (`renderBand.ts`)

**Files:**
- Create: `src/infrastructure/renderBand.ts`
- Modify: `src/infrastructure/renderer.ts` — use `renderBand` in the existing single-thread path

**Why (DRY):** The pixel computation loop (precalculate coords, iterate, color, write to buffer) is needed by both the worker and the fallback single-thread renderer. Extract it once, use it everywhere. This also makes the existing renderer a consumer of `renderBand`, validating the function before workers are added.

- [ ] **Step 1: Create `src/infrastructure/renderBand.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Band Renderer
 * Shared pixel computation logic — used by worker AND fallback paths
 * DRY: single source of truth for the render loop
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  FractalType, PaletteName, FractalParams, Viewport
} from '../domain/types';
import { getFractalConfig } from '../domain/fractalTypes';
import { resolvePalette, getColorFast } from '../domain/palettes';

export interface BandRenderParams {
  startY: number;
  endY: number;
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
}

/**
 * Render a horizontal band of pixels into a Uint8ClampedArray buffer.
 *
 * @param pixels - RGBA buffer (width * height * 4 bytes)
 * @param band - Band parameters
 * @param shouldCancel - Optional function checked every line; return true to abort
 * @returns true if completed, false if cancelled
 */
export function renderBand(
  pixels: Uint8ClampedArray,
  band: BandRenderParams,
  shouldCancel?: () => boolean
): boolean {
  const {
    startY, endY, width, height, viewport,
    fractalType, maxIterations, palette, params
  } = band;

  const config = getFractalConfig(fractalType);
  const calculator = config.calculator;
  const mergedParams = { ...config.params, ...params };
  const resolvedPalette = resolvePalette(palette);

  // Precalculate coordinate mapping
  // PERF: inlined screenToComplex — keep in sync with coordinates.ts
  const aspectRatio = width / height;
  const stepRe = viewport.scale * aspectRatio / width;
  const stepIm = viewport.scale / height;
  const originRe = viewport.centerRe - viewport.scale * aspectRatio * 0.5;
  const originIm = viewport.centerIm - viewport.scale * 0.5;

  for (let y = startY; y < endY; y++) {
    if (shouldCancel?.()) return false;

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

  return true;
}
```

- [ ] **Step 2: Refactor `renderer.ts` to use `renderBand`**

Replace the inline computation loop in `renderFractal` with a call to `renderBand`. This validates `renderBand` before workers use it. The existing chunked `requestAnimationFrame` structure stays — it becomes the fallback path.

Read the current `renderer.ts`, then replace the inner loop logic:

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Canvas Renderer
 * Single-thread fallback + feature detection for worker pool
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import { renderBand } from './renderBand';

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
 * Single-thread fallback renderer.
 * Used when SharedArrayBuffer is unavailable.
 * Returns a cancel function.
 */
export function renderFallback(
  canvas: HTMLCanvasElement,
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

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const startTime = performance.now();
  let cancelled = false;
  let currentY = 0;
  const chunkSize = 12;

  const renderChunk = () => {
    if (cancelled) return;

    const endY = Math.min(currentY + chunkSize, height);

    renderBand(data, {
      startY: currentY, endY, width, height,
      viewport, fractalType, maxIterations, palette, params
    }, () => cancelled);

    ctx.putImageData(imageData, 0, 0, 0, currentY, width, endY - currentY);
    currentY = endY;

    onProgress?.(currentY / height);

    if (currentY < height) {
      requestAnimationFrame(renderChunk);
    } else {
      onComplete?.(performance.now() - startTime);
    }
  };

  requestAnimationFrame(renderChunk);
  return () => { cancelled = true; };
}
```

Note: function renamed from `renderFractal` to `renderFallback`. The old export name will be handled in Task 5 when we wire everything together.

- [ ] **Step 3: Verify fallback still works**

```bash
npx tsc --noEmit && npx eslint src/infrastructure/renderBand.ts src/infrastructure/renderer.ts --max-warnings 0
```

- [ ] **Step 4: Commit**

```
refactor(infra): extract renderBand as shared DRY render logic
```

---

## Task 2: Create the fractal worker

**Files:**
- Create: `src/infrastructure/fractal.worker.ts`

**Why:** Thin worker entry point. Receives a message with band params + SharedArrayBuffer, calls `renderBand`, posts completion. SRP: the worker only handles message protocol, all computation is in `renderBand`.

- [ ] **Step 1: Create `src/infrastructure/fractal.worker.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Fractal Worker
 * Thin entry point: message protocol + cancel flag
 * Computation delegated to renderBand (DRY)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { renderBand } from './renderBand';
import type {
  FractalType, PaletteName, FractalParams, Viewport
} from '../domain/types';

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
  const { band, pixelBuffer, cancelFlag, ...renderParams } = e.data;

  const pixels = new Uint8ClampedArray(pixelBuffer);
  const cancel = new Int32Array(cancelFlag);

  const completed = renderBand(pixels, {
    startY: band.startY,
    endY: band.endY,
    ...renderParams
  }, () => Atomics.load(cancel, 0) === 1);

  if (completed) {
    self.postMessage({
      type: 'band-done',
      startY: band.startY,
      endY: band.endY
    });
  }
};
```

- [ ] **Step 2: Commit**

```
feat(infra): create fractal worker (thin message protocol + renderBand)
```

---

## Task 3: Create worker pool (lifecycle only)

**Files:**
- Create: `src/infrastructure/workerPool.ts`

**Why (SRP):** Pool lifecycle is separated from render coordination. This class only manages worker creation, termination, SharedArrayBuffer allocation, and the cancel flag. It does NOT know about bands, progress, or canvas.

- [ ] **Step 1: Create `src/infrastructure/workerPool.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```
feat(infra): create worker pool (lifecycle + SAB management)
```

---

## Task 4: Create render coordinator

**Files:**
- Create: `src/infrastructure/renderCoordinator.ts`

**Why (SRP):** Render coordination is separated from pool lifecycle. The coordinator takes a pool, splits the image into bands, distributes work, listens for completion messages, and triggers canvas updates. It knows about bands and progress, the pool does not.

- [ ] **Step 1: Create `src/infrastructure/renderCoordinator.ts`**

```ts
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

  // Create ImageData backed by the SAB view
  const imageData = new ImageData(view, width, height);

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
```

- [ ] **Step 2: Commit**

```
feat(infra): create render coordinator (band distribution + progressive updates)
```

---

## Task 5: Wire everything together

**Files:**
- Modify: `src/infrastructure/renderer.ts` — unified entry point with feature detection
- Modify: `src/infrastructure/useRenderer.ts` — pool lifecycle in useRef
- Modify: `src/infrastructure/index.ts` — updated exports

**Why:** This is the integration task. The renderer becomes a facade that feature-detects SharedArrayBuffer, delegates to coordinator (parallel) or fallback (single-thread). The hook manages the pool lifecycle.

- [ ] **Step 1: Rewrite `renderer.ts` as unified facade**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Canvas Renderer (Facade)
 * Feature-detects SharedArrayBuffer → parallel pool or single-thread fallback
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import type { WorkerPool } from './workerPool';
import { renderWithPool } from './renderCoordinator';
import { renderBand } from './renderBand';

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
 * Render a fractal to canvas.
 * If pool is provided, uses parallel workers.
 * Otherwise, falls back to single-thread chunked rendering.
 */
export function renderFractal(
  canvas: HTMLCanvasElement,
  pool: WorkerPool | null,
  options: RenderOptions
): () => void {
  if (pool) {
    return renderWithPool({
      canvas, pool,
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      palette: options.palette,
      params: options.params,
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
    palette, params, onProgress, onComplete
  } = options;
  const { width, height } = canvas;
  const imageData = ctx.createImageData(width, height);
  const startTime = performance.now();
  let cancelled = false;
  let currentY = 0;
  const chunkSize = 12;

  const renderChunk = () => {
    if (cancelled) return;
    const endY = Math.min(currentY + chunkSize, height);

    renderBand(imageData.data, {
      startY: currentY, endY, width, height,
      viewport, fractalType, maxIterations, palette, params
    }, () => cancelled);

    ctx.putImageData(imageData, 0, 0, 0, currentY, width, endY - currentY);
    currentY = endY;
    onProgress?.(currentY / height);

    if (currentY < height) {
      requestAnimationFrame(renderChunk);
    } else {
      onComplete?.(performance.now() - startTime);
    }
  };

  requestAnimationFrame(renderChunk);
  return () => { cancelled = true; };
}
```

- [ ] **Step 2: Rewrite `useRenderer.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * Manages worker pool lifecycle and triggers rendering
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

export function useRenderer({
  canvasRef, containerRef,
  fractalType, viewport, maxIterations, palette, params,
  onRenderStart, onRenderComplete
}: UseRendererOptions) {
  const cancelRef = useRef<(() => void) | null>(null);
  const poolRef = useRef<WorkerPool | null>(null);

  // Callback refs to avoid infinite loop
  const onStartRef = useRef(onRenderStart);
  const onCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onStartRef.current = onRenderStart;
    onCompleteRef.current = onRenderComplete;
  }, [onRenderStart, onRenderComplete]);

  // Pool lifecycle: create on mount, destroy on unmount
  useEffect(() => {
    poolRef.current = createWorkerPool(); // null if SAB unavailable
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
    if (!canvas) return;

    cancelRef.current?.();
    onStartRef.current?.();

    cancelRef.current = renderFractal(canvas, poolRef.current, {
      fractalType, viewport, maxIterations, palette, params,
      onComplete: (time) => {
        cancelRef.current = null;
        onCompleteRef.current?.(time);
      }
    });
  }, [canvasRef, fractalType, viewport, maxIterations, palette, params]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, fractalType);
  }, [canvasRef, fractalType]);

  useEffect(() => {
    handleResize();
    render();
  }, [handleResize, render]);

  useEffect(() => {
    const onResize = () => { handleResize(); render(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [handleResize, render]);

  useEffect(() => {
    return () => { cancelRef.current?.(); };
  }, []);

  return { exportImage };
}
```

- [ ] **Step 3: Update `src/infrastructure/index.ts`**

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Public API
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { renderFractal } from './renderer';
export { renderBand } from './renderBand';
export { resizeCanvas, exportCanvas, downloadCanvas } from './canvasUtils';
export { useRenderer } from './useRenderer';
export { WorkerPool, createWorkerPool, isSharedArrayBufferAvailable } from './workerPool';
```

- [ ] **Step 4: Commit**

```
feat(infra): unified renderer facade with parallel/fallback paths
```

---

## Task 6: ESLint / TypeScript compliance

**Files:**
- All new/modified infrastructure files

**Why:** Strict rules (max-lines-per-function 80, complexity 15, sonarjs). Worker `self.onmessage` typing needs explicit cast. ESLint may flag patterns in coordinator handlers.

- [ ] **Step 1: Run typecheck**

```bash
npx tsc --noEmit
```

Common issues to fix:
- `self.onmessage` in worker: may need `declare const self: DedicatedWorkerGlobalScope`
- `Atomics.load`/`Atomics.store` — needs `lib: ["ES2020"]` in tsconfig (already set)
- `navigator.hardwareConcurrency` — already guarded with `?? 4`

- [ ] **Step 2: Run ESLint**

```bash
npx eslint src/infrastructure/ --max-warnings 0
```

Common issues to fix:
- `renderBand` may exceed 80 lines → split into `precalculateCoords` helper
- `renderCoordinator.ts` handler setup may trigger `sonarjs/cognitive-complexity` → extract `createBandHandler`
- Worker file may need eslint-disable for `no-restricted-globals` on `self`

- [ ] **Step 3: Run build**

```bash
npm run build
```

If worker bundling fails:
- Verify `new URL('./fractal.worker.ts', import.meta.url)` syntax
- If Turbopack doesn't support it, add webpack config to `next.config.ts`:
```ts
webpack: (config) => {
  config.module.rules.push({
    test: /\.worker\.ts$/,
    use: { loader: 'worker-loader' }
  });
  return config;
}
```

- [ ] **Step 4: Commit**

```
fix: ESLint and TypeScript compliance for worker infrastructure
```

---

## Task 7: Integration verification

**Files:**
- No code changes — verification only

**Why:** Quality gates. The feature must be verified against the Definition of Done before declaring complete.

- [ ] **Step 1: Visual verification**

```bash
npm run dev
```

Open http://localhost:3000. Check each item:
- [ ] Mandelbrot renders correctly
- [ ] Switch to each fractal type — all render
- [ ] Switch themes — colors apply
- [ ] Zoom in/out — re-renders progressively
- [ ] Pan — re-renders
- [ ] Reset button works
- [ ] Export button produces PNG

- [ ] **Step 2: Performance verification**

Open DevTools → Console. The render time is logged via `onComplete`. Compare:
- Single-thread baseline (if you want to test: temporarily pass `null` as pool in useRenderer)
- Worker pool render time
- Target: pool time < 50% of single-thread on 4+ cores

- [ ] **Step 3: Memory leak verification**

Open DevTools → Memory tab.
1. Take heap snapshot
2. Render 10 times (zoom in/out rapidly)
3. Take second heap snapshot
4. Compare: no significant heap growth (< 5% variance)
5. Switch types 5 times
6. Take third snapshot — still stable

- [ ] **Step 4: Cancel verification**

Zoom rapidly (10 fast scrolls). The renders should cancel cleanly:
- No visual artifacts (partial bands from old render mixed with new)
- No console errors
- Final render is correct

- [ ] **Step 5: Fallback verification**

Temporarily disable SharedArrayBuffer to test fallback:
- In `workerPool.ts`, change `isSharedArrayBufferAvailable` to return `false`
- Verify fractal still renders (single-thread)
- Revert the change

- [ ] **Step 6: Document results**

Create a brief verification report in the commit message or as a comment.

- [ ] **Step 7: Commit**

```
feat: complete Web Workers integration — verified parallel rendering
```

---

## Summary

| Task | Files | Responsibility |
|------|-------|---------------|
| 1 | `renderBand.ts` + refactor `renderer.ts` | DRY: shared render logic |
| 2 | `fractal.worker.ts` | Thin worker: message protocol + cancel |
| 3 | `workerPool.ts` | SRP: pool lifecycle + SAB management |
| 4 | `renderCoordinator.ts` | SRP: band distribution + progressive updates |
| 5 | `renderer.ts` + `useRenderer.ts` + `index.ts` | Integration: facade + hook + exports |
| 6 | All infra files | Compliance: ESLint + TypeScript |
| 7 | None (verification) | Quality gates: visual + perf + memory + cancel |

**Execution order:** Strictly sequential (1 → 2 → 3 → 4 → 5 → 6 → 7)

**DRY compliance:** `renderBand` is the single source of truth for pixel computation, used by both worker and fallback paths.

**SRP compliance:**
- `renderBand.ts` — pixel computation only
- `fractal.worker.ts` — message protocol only
- `workerPool.ts` — worker lifecycle + SAB allocation only
- `renderCoordinator.ts` — band distribution + progressive rendering only
- `renderer.ts` — feature detection facade only
- `useRenderer.ts` — React lifecycle only

**Fallback:** If `SharedArrayBuffer` is unavailable, `createWorkerPool()` returns `null`, `renderFractal` receives `null` pool, delegates to `renderFallback` (the current single-thread chunked renderer).

**Memory safety:**
- Pool created once in `useRef` on mount
- Pool destroyed in `useEffect` return on unmount
- Cancel flag SAB: created once with pool, reset before each render
- Pixel SAB: reused, recreated only on resize
- Message handlers: added per render, cleaned up on completion or cancel
