# Instant Viewport Feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instant visual feedback on pan and zoom — CSS transform for immediate response, deferred worker render for pixel-perfect result. XaoS-style pixel reuse on pan (shift + render exposed strip only).

**Architecture:** Two layers of feedback. (1) On any viewport change (pan drag, wheel zoom, keyboard, touch), apply a CSS transform via `useLayoutEffect` (translate for pan, scale for zoom) to the existing canvas — synchronous before browser paint, ~1-2ms. (2) Debounce: after 80ms of no input, render only what's needed — for pan, shift the pixel buffer and render just the exposed strip; for zoom, full re-render. The CSS transform is reset when the computed image replaces it. GPU compositor layer hint via `will-change: transform`.

**Tech Stack:** CSS transforms, canvas 2D context, existing WorkerPool + renderCoordinator, React hooks (`useLayoutEffect` for synchronous visual updates).

**Measured baseline (current):**
- Pan first paint: 71ms, full: 157ms (~6fps)
- Zoom first paint: 86ms, full: 205ms (~5fps)

**Target:** <2ms perceived latency on interaction (CSS transform via useLayoutEffect), full render deferred.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/infrastructure/viewportTransform.ts` | Create | Pure functions: compute CSS transform string from old/new viewport, compute pixel shift deltas, compute exposed strip regions, shift pixel buffer. No React, no DOM. |
| `src/infrastructure/renderCoordinator.ts` | Modify | Add `renderStripsWithPool()` — dispatches exposed strip Y-ranges to workers. Reuses existing band dispatch pattern. |
| `src/infrastructure/useViewportTransition.ts` | Create | React hook: CSS transform application, debounce timer, pan-vs-zoom detection, strip render dispatch. Extracted from useRenderer for SRP and ESLint `max-lines-per-function` compliance. |
| `src/infrastructure/useRenderer.ts` | Modify | Integrate `useViewportTransition`, remove direct render-on-viewport-change, delegate to transition hook. |

**Files NOT modified:** `renderBand.ts`, `fractal.worker.ts`, `workerPool.ts`, `renderer.ts`, `useFractalState.ts`, `useCanvasEvents.ts`, domain layer.

---

## Task 1: viewportTransform.ts — Pure transform math

**Files:**
- Create: `src/infrastructure/viewportTransform.ts`

- [ ] **Step 1: Create viewportTransform.ts**

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Viewport Transform
 * Pure functions for instant CSS feedback on viewport changes.
 * No DOM, no React — pure math.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport } from '../domain/types';

/**
 * Compute CSS transform to visually approximate a viewport change.
 *
 * Uses transform-origin: 50% 50% (canvas center).
 * Formula: scale(s) translate(dxPx, dyPx)
 * where s = oldScale/newScale, and (dxPx, dyPx) maps the center shift
 * to pixel space in the old viewport.
 *
 * CSS applies transforms right-to-left: first translate, then scale from center.
 * This correctly keeps the zoom focus point fixed on screen because
 * zoomViewport() shifts centerRe/Im toward the focus — the translate
 * compensates for that shift under the scale.
 */
export function computeCSSTransform(
  oldViewport: Viewport,
  newViewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): string {
  const scaleRatio = oldViewport.scale / newViewport.scale;
  const aspectRatio = canvasWidth / canvasHeight;

  // Pixel offset of the old center relative to the new viewport's center,
  // expressed in old-viewport pixel units.
  const dxPixels = (oldViewport.centerRe - newViewport.centerRe)
    / (oldViewport.scale * aspectRatio) * canvasWidth;
  const dyPixels = (oldViewport.centerIm - newViewport.centerIm)
    / oldViewport.scale * canvasHeight;

  if (scaleRatio === 1) {
    return `translate(${dxPixels}px, ${dyPixels}px)`;
  }

  // scale(s) translate(dx, dy) with origin at center:
  // result = s*(x + dx - cx) + cx, s*(y + dy - cy) + cy
  return `scale(${scaleRatio}) translate(${dxPixels}px, ${dyPixels}px)`;
}

/**
 * Detect if viewport change is pan-only (same scale).
 * Safe to use === because panViewport() copies scale by value assignment,
 * not arithmetic — the float is bit-identical.
 */
export function isPanOnly(
  oldViewport: Viewport,
  newViewport: Viewport
): boolean {
  return oldViewport.scale === newViewport.scale;
}

/**
 * Compute pixel shift for pan pixel-reuse.
 * Returns how many pixels to shift the buffer (positive = content moves right/down).
 */
export function computePanShift(
  oldViewport: Viewport,
  newViewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): { dx: number; dy: number } {
  const aspectRatio = canvasWidth / canvasHeight;

  return {
    dx: Math.round(
      (oldViewport.centerRe - newViewport.centerRe)
      / (oldViewport.scale * aspectRatio) * canvasWidth
    ),
    dy: Math.round(
      (oldViewport.centerIm - newViewport.centerIm)
      / oldViewport.scale * canvasHeight
    )
  };
}

/** Rectangular region exposed after a pan shift */
export interface ExposedStrip {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

/**
 * Compute exposed strips after a pixel-buffer shift.
 * Returns 0-2 strips: one vertical edge + one horizontal edge.
 * Horizontal strip excludes the corner already covered by the vertical strip.
 */
export function computeExposedStrips(
  dx: number,
  dy: number,
  width: number,
  height: number
): ExposedStrip[] {
  const strips: ExposedStrip[] = [];

  if (dx > 0) {
    strips.push({ startX: 0, endX: Math.min(dx, width), startY: 0, endY: height });
  } else if (dx < 0) {
    strips.push({ startX: Math.max(width + dx, 0), endX: width, startY: 0, endY: height });
  }

  if (dy !== 0) {
    const sx = dx > 0 ? Math.min(dx, width) : 0;
    const ex = dx < 0 ? Math.max(width + dx, 0) : width;
    if (dy > 0) {
      strips.push({ startX: sx, endX: ex, startY: 0, endY: Math.min(dy, height) });
    } else {
      strips.push({ startX: sx, endX: ex, startY: Math.max(height + dy, 0), endY: height });
    }
  }

  return strips;
}

/**
 * Shift pixel buffer in-place for pan reuse.
 * Copies existing pixels to their new positions.
 * Exposed areas are left as-is (will be overwritten by strip render).
 */
export function shiftPixelBuffer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number
): void {
  if (dx === 0 && dy === 0) return;

  const rowBytes = width * 4;

  if (dy > 0) {
    for (let y = height - 1; y >= dy; y--) {
      copyRow(pixels, (y - dy) * rowBytes, y * rowBytes, width, dx);
    }
  } else {
    for (let y = Math.max(0, -dy); y < height; y++) {
      const srcY = y + dy;
      if (srcY >= 0 && srcY < height) {
        copyRow(pixels, srcY * rowBytes, y * rowBytes, width, dx);
      }
    }
  }
}

function copyRow(
  pixels: Uint8ClampedArray,
  srcOffset: number,
  dstOffset: number,
  width: number,
  dx: number
): void {
  if (dx === 0) {
    pixels.copyWithin(dstOffset, srcOffset, srcOffset + width * 4);
    return;
  }

  const copyWidth = (width - Math.abs(dx)) * 4;
  if (copyWidth <= 0) return;

  const srcStart = srcOffset + Math.max(0, -dx) * 4;
  const dstStart = dstOffset + Math.max(0, dx) * 4;
  pixels.copyWithin(dstStart, srcStart, srcStart + copyWidth);
}
```

- [ ] **Step 2: Verify TypeScript + ESLint**

Run: `npx tsc --noEmit && npx eslint src/infrastructure/viewportTransform.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/viewportTransform.ts
git commit -m "feat(infra): add viewportTransform — pure CSS transform + pixel shift math"
```

---

## Task 2: renderCoordinator — strip rendering support

**Files:**
- Modify: `src/infrastructure/renderCoordinator.ts`

- [ ] **Step 1: Add renderStripsWithPool**

Add import at top:
```typescript
import type { ExposedStrip } from './viewportTransform';
```

Add function after `renderWithPool`:

```typescript
/**
 * Render only exposed strips (after pan pixel-shift).
 * Dispatches each strip's Y-range as a full-width band to a worker.
 * Over-renders X dimension vs. strip boundaries, but strips are typically
 * <10% of canvas, so the overhead is negligible vs. protocol complexity.
 * Returns a cancel function.
 */
export function renderStripsWithPool(
  options: CoordinatorRenderOptions,
  strips: ExposedStrip[]
): () => void {
  const {
    canvas, pool, viewport, fractalType,
    maxIterations, palette, params,
    onProgress, onComplete
  } = options;

  const ctx = canvas.getContext('2d');
  if (!ctx || strips.length === 0) return () => {};

  const width = canvas.width;
  const height = canvas.height;
  const renderId = nextRenderId++;

  // Cancel flag already reset by caller (useViewportTransition)
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
        0, e.data.startY, width, e.data.endY - e.data.startY
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
      band: { startY: strip.startY, endY: strip.endY },
      renderId,
      stride: 1,
      width, height, viewport, fractalType,
      maxIterations, palette, params,
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
```

- [ ] **Step 2: Verify TypeScript + ESLint**

Run: `npx tsc --noEmit && npx eslint src/infrastructure/renderCoordinator.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/renderCoordinator.ts
git commit -m "feat(infra): add renderStripsWithPool for partial re-render on pan"
```

---

## Task 3: useViewportTransition — CSS transform + debounce hook

**Files:**
- Create: `src/infrastructure/useViewportTransition.ts`

Extracted as its own hook to respect ESLint `max-lines-per-function` and SRP. This hook owns:
- CSS transform application/reset
- Debounce timer management
- Pan-vs-zoom detection and dispatch

It does NOT own: worker pool lifecycle, canvas resize, export.

- [ ] **Step 1: Create useViewportTransition.ts**

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Viewport Transition Hook
 * Instant CSS feedback on viewport changes + debounced render dispatch.
 * Extracted from useRenderer for SRP and ESLint max-lines compliance.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useRef, useLayoutEffect, useCallback, useEffect } from 'react';
import type { Viewport, FractalType, PaletteName, FractalParams } from '../domain/types';
import type { WorkerPool } from './workerPool';
import { renderFractal } from './renderer';
import { renderStripsWithPool } from './renderCoordinator';
import {
  computeCSSTransform, isPanOnly, computePanShift,
  computeExposedStrips, shiftPixelBuffer
} from './viewportTransform';

/** Debounce delay — short enough to feel responsive, long enough to batch rapid inputs */
const DEBOUNCE_MS = 80;

interface UseViewportTransitionOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  poolRef: React.RefObject<WorkerPool | null>;
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  cancelRenderRef: React.MutableRefObject<(() => void) | null>;
  onRenderStartRef: React.MutableRefObject<(() => void) | undefined>;
  onRenderCompleteRef: React.MutableRefObject<((t: number) => void) | undefined>;
}

export function useViewportTransition(options: UseViewportTransitionOptions) {
  const {
    canvasRef, poolRef,
    fractalType, viewport, maxIterations, palette, params,
    cancelRenderRef, onRenderStartRef, onRenderCompleteRef
  } = options;

  const prevViewportRef = useRef<Viewport | null>(null);
  const prevParamsKeyRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Render dispatchers (stored in refs to avoid useCallback dep churn) ---

  const renderFullRef = useRef<() => void>(() => {});
  const renderPanStripsRef = useRef<() => void>(() => {});

  renderFullRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    cancelRenderRef.current?.();
    onRenderStartRef.current?.();
    resetTransform(canvas);

    cancelRenderRef.current = renderFractal(canvas, poolRef.current, {
      fractalType, viewport, maxIterations, palette, params,
      onComplete: (renderTime) => {
        cancelRenderRef.current = null;
        prevViewportRef.current = viewport;
        onRenderCompleteRef.current?.(renderTime);
      }
    });
  };

  renderPanStripsRef.current = () => {
    const canvas = canvasRef.current;
    const pool = poolRef.current;
    if (!canvas || !pool || !prevViewportRef.current) {
      renderFullRef.current();
      return;
    }

    const { dx, dy } = computePanShift(
      prevViewportRef.current, viewport,
      canvas.width, canvas.height
    );

    if (Math.abs(dx) >= canvas.width || Math.abs(dy) >= canvas.height) {
      renderFullRef.current();
      return;
    }

    cancelRenderRef.current?.();
    onRenderStartRef.current?.();
    resetTransform(canvas);

    // Cancel previous workers and reset flag before shifting buffer
    pool.cancel();
    pool.resetCancel();

    const { view } = pool.getPixelBuffer(canvas.width, canvas.height);
    shiftPixelBuffer(view, canvas.width, canvas.height, dx, dy);

    // Paint shifted buffer immediately
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      imageData.data.set(view);
      ctx.putImageData(imageData, 0, 0);
    }

    const strips = computeExposedStrips(dx, dy, canvas.width, canvas.height);
    if (strips.length === 0) {
      prevViewportRef.current = viewport;
      onRenderCompleteRef.current?.(0);
      return;
    }

    cancelRenderRef.current = renderStripsWithPool({
      canvas, pool, viewport, fractalType,
      maxIterations, palette, params,
      onComplete: (renderTime) => {
        cancelRenderRef.current = null;
        prevViewportRef.current = viewport;
        onRenderCompleteRef.current?.(renderTime);
      }
    }, strips);
  };

  // --- Stable key for non-viewport params ---
  const paramsKey = `${fractalType}|${maxIterations}|${palette}|${JSON.stringify(params)}`;

  // --- CSS transform: applied synchronously before paint via useLayoutEffect ---
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isFirstRender = prevViewportRef.current === null;
    const paramsChanged = paramsKey !== prevParamsKeyRef.current;
    prevParamsKeyRef.current = paramsKey;

    if (isFirstRender || paramsChanged) {
      renderFullRef.current();
      return;
    }

    // Viewport-only change — apply CSS transform synchronously
    const transform = computeCSSTransform(
      prevViewportRef.current, viewport,
      canvas.width, canvas.height
    );
    canvas.style.transform = transform;
    canvas.style.transformOrigin = '50% 50%';

    // Debounce the real render
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (prevViewportRef.current && isPanOnly(prevViewportRef.current, viewport)) {
        renderPanStripsRef.current();
      } else {
        renderFullRef.current();
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [canvasRef, viewport, paramsKey]);

  // --- GPU compositor hint ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.willChange = 'transform';
    return () => {
      if (canvas) canvas.style.willChange = '';
    };
  }, [canvasRef]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

  const forceFullRender = useCallback(() => {
    prevViewportRef.current = null;
    renderFullRef.current();
  }, []);

  return { forceFullRender };
}

function resetTransform(canvas: HTMLCanvasElement): void {
  canvas.style.transform = '';
  canvas.style.transformOrigin = '';
}
```

- [ ] **Step 2: Verify TypeScript + ESLint**

Run: `npx tsc --noEmit && npx eslint src/infrastructure/useViewportTransition.ts --max-warnings 0`

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/useViewportTransition.ts
git commit -m "feat(infra): add useViewportTransition — CSS transform + debounce + pan pixel-reuse"
```

---

## Task 4: useRenderer — integrate transition hook

**Files:**
- Modify: `src/infrastructure/useRenderer.ts`

Replace the direct render-on-viewport-change logic with `useViewportTransition`. The hook becomes much simpler — it owns pool lifecycle, resize, export, and delegates viewport transitions.

- [ ] **Step 1: Rewrite useRenderer.ts**

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * Manages worker pool lifecycle, canvas resize, and export.
 * Viewport transitions delegated to useViewportTransition.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import { createWorkerPool, type WorkerPool } from './workerPool';
import { resizeCanvas, downloadCanvas } from './canvasUtils';
import { useViewportTransition } from './useViewportTransition';

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
  const cancelRenderRef = useRef<(() => void) | null>(null);
  const poolRef = useRef<WorkerPool | null>(null);

  const onRenderStartRef = useRef(onRenderStart);
  const onRenderCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onRenderStartRef.current = onRenderStart;
    onRenderCompleteRef.current = onRenderComplete;
  }, [onRenderStart, onRenderComplete]);

  // Pool lifecycle
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

  // Viewport transition — CSS transform + debounced render
  const { forceFullRender } = useViewportTransition({
    canvasRef, poolRef,
    fractalType, viewport, maxIterations, palette, params,
    cancelRenderRef, onRenderStartRef, onRenderCompleteRef
  });

  // Resize canvas on mount
  useEffect(() => {
    handleResize();
  }, [handleResize]);

  // Window resize
  useEffect(() => {
    const handleWindowResize = () => {
      handleResize();
      forceFullRender();
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [handleResize, forceFullRender]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, fractalType);
  }, [canvasRef, fractalType]);

  // Cleanup
  useEffect(() => {
    return () => { cancelRenderRef.current?.(); };
  }, []);

  return { exportImage };
}
```

- [ ] **Step 2: Update infrastructure barrel export if needed**

Check `src/infrastructure/index.ts` — if it re-exports useRenderer, no change needed. If it exports internals that moved, update.

- [ ] **Step 3: Verify TypeScript + ESLint**

Run: `npx tsc --noEmit && npx eslint src/infrastructure/useRenderer.ts src/infrastructure/useViewportTransition.ts --max-warnings 0`

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/useRenderer.ts
git commit -m "refactor(infra): useRenderer delegates to useViewportTransition"
```

---

## Task 5: Visual verification + benchmark

- [ ] **Step 1: Navigate to http://localhost:3000 — verify Mandelbrot renders at default view**

- [ ] **Step 2: Zoom test — wheel zoom 5+ times**

Verify: instant CSS scale on each event, full-res render after debounce, no flash/glitch.

- [ ] **Step 3: Pan test — drag canvas**

Verify: instant CSS translate during drag, strip render fills exposed edge after release, previously computed area preserved.

- [ ] **Step 4: Other fractals — Julia, Burning Ship, Tricorn, Multibrot**

Verify correct rendering after zoom/pan on each.

- [ ] **Step 5: Param change — palette, iterations**

Verify full re-render (not just CSS transform).

- [ ] **Step 6: Export PNG**

Verify export still works correctly.

- [ ] **Step 7: Benchmark — putImageData monkey-patch**

Measure:
- First visual feedback latency on zoom (CSS transform, expect <2ms)
- First visual feedback latency on pan (CSS transform, expect <2ms)
- Full render time on pan (strip render, expect ~10-30ms vs 157ms baseline)

- [ ] **Step 8: Update CLAUDE.md roadmap**

Move "Tile caching (v3)" to done, rename to "Instant viewport feedback (v3)" with benchmarks.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update roadmap — instant viewport feedback done with benchmarks"
```

---

## DoD (Definition of Done)

- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/infrastructure/ --max-warnings 0` passes
- [ ] `npm run build` succeeds
- [ ] Visual: Mandelbrot zoom — instant CSS scale, full render after debounce
- [ ] Visual: Mandelbrot pan — instant CSS translate, strip render fills exposed edge
- [ ] Visual: Julia/BurningShip/Tricorn — correct rendering
- [ ] Visual: palette/iteration change — full re-render, no stale CSS transform
- [ ] Benchmark: perceived latency <2ms on interaction
- [ ] No regressions: export PNG, keyboard shortcuts, touch events
- [ ] CLAUDE.md roadmap updated with measured results
- [ ] All commits conventional
