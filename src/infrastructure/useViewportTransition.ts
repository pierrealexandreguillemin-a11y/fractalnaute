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
import { getOrCreateImageData } from './canvasUtils';
import {
  computeCSSTransform, isPanOnly, computePanShift,
  computeExposedStrips, shiftPixelBuffer
} from './viewportTransform';

/** Debounce delay — short enough to feel responsive, long enough to batch rapid inputs */
const DEBOUNCE_MS = 80;

interface TransitionDeps {
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

/** Full re-render — cancel previous, reset transform, dispatch two-pass workers */
function doRenderFull(
  deps: TransitionDeps,
  prevViewportRef: React.MutableRefObject<Viewport | null>
): void {
  const { canvasRef, poolRef, cancelRenderRef, onRenderStartRef, onRenderCompleteRef } = deps;
  const canvas = canvasRef.current;
  if (!canvas) return;

  cancelRenderRef.current?.();
  onRenderStartRef.current?.();
  resetTransform(canvas);

  // Update baseline eagerly so CSS feedback stays in sync during rapid input
  prevViewportRef.current = deps.viewport;

  cancelRenderRef.current = renderFractal(canvas, poolRef.current, {
    fractalType: deps.fractalType,
    viewport: deps.viewport,
    maxIterations: deps.maxIterations,
    palette: deps.palette,
    params: deps.params,
    onComplete: (renderTime) => {
      cancelRenderRef.current = null;
      onRenderCompleteRef.current?.(renderTime);
    }
  });
}

/** Pan pixel-reuse — shift buffer, paint, render only exposed strips */
function doRenderPanStrips(
  deps: TransitionDeps,
  prevViewportRef: React.MutableRefObject<Viewport | null>
): void {
  const { canvasRef, poolRef, cancelRenderRef, onRenderStartRef, onRenderCompleteRef } = deps;
  const canvas = canvasRef.current;
  const pool = poolRef.current;

  if (!canvas || !pool || !prevViewportRef.current) {
    doRenderFull(deps, prevViewportRef);
    return;
  }

  const { dx, dy } = computePanShift(
    prevViewportRef.current, deps.viewport,
    canvas.width, canvas.height
  );

  if (Math.abs(dx) >= canvas.width || Math.abs(dy) >= canvas.height) {
    doRenderFull(deps, prevViewportRef);
    return;
  }

  cancelRenderRef.current?.();
  onRenderStartRef.current?.();
  resetTransform(canvas);

  pool.cancel();
  pool.resetCancel();

  shiftAndPaint(pool, canvas, dx, dy);

  // Update baseline eagerly so CSS feedback stays in sync during rapid input
  prevViewportRef.current = deps.viewport;

  const strips = computeExposedStrips(dx, dy, canvas.width, canvas.height);
  if (strips.length === 0) {
    onRenderCompleteRef.current?.(0);
    return;
  }

  cancelRenderRef.current = renderStripsWithPool({
    canvas, pool,
    viewport: deps.viewport,
    fractalType: deps.fractalType,
    maxIterations: deps.maxIterations,
    palette: deps.palette,
    params: deps.params,
    onComplete: (renderTime) => {
      cancelRenderRef.current = null;
      onRenderCompleteRef.current?.(renderTime);
    }
  }, strips);
}

/** Shift SAB pixel buffer by (dx, dy) and paint immediately to canvas */
function shiftAndPaint(
  pool: WorkerPool,
  canvas: HTMLCanvasElement,
  dx: number,
  dy: number
): void {
  const { view } = pool.getPixelBuffer(canvas.width, canvas.height);
  shiftPixelBuffer(view, canvas.width, canvas.height, dx, dy);

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imageData = getOrCreateImageData(ctx, canvas.width, canvas.height);
    imageData.data.set(view);
    ctx.putImageData(imageData, 0, 0);
  }
}

function resetTransform(canvas: HTMLCanvasElement): void {
  canvas.style.transform = '';
  canvas.style.transformOrigin = '';
}

/**
 * Hook: instant CSS feedback on viewport changes + debounced render.
 *
 * - useLayoutEffect applies CSS transform synchronously before browser paint (~1-2ms)
 * - After 80ms of no input, dispatches real render (pan strips or full)
 * - will-change: transform hints GPU compositor layer
 */
export function useViewportTransition(deps: TransitionDeps) {
  const { canvasRef } = deps;
  const prevViewportRef = useRef<Viewport | null>(null);
  const prevParamsKeyRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref wrapper — synced via effect to avoid ref update during render
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; });

  const paramsKey = `${deps.fractalType}|${deps.maxIterations}|${deps.palette}|${JSON.stringify(deps.params)}`;

  // CSS transform: applied synchronously before paint
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isFirstRender = prevViewportRef.current === null;
    const paramsChanged = paramsKey !== prevParamsKeyRef.current;
    prevParamsKeyRef.current = paramsKey;

    if (isFirstRender || paramsChanged) {
      doRenderFull(depsRef.current, prevViewportRef);
      return;
    }

    // Viewport-only change — apply CSS transform synchronously
    // prevViewportRef.current is non-null here (isFirstRender check above)
    const prevVp = prevViewportRef.current!;
    const transform = computeCSSTransform(
      prevVp, deps.viewport,
      canvas.width, canvas.height
    );
    canvas.style.transform = transform;
    canvas.style.transformOrigin = '50% 50%';

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const d = depsRef.current;
      if (prevViewportRef.current && isPanOnly(prevViewportRef.current, d.viewport)) {
        doRenderPanStrips(d, prevViewportRef);
      } else {
        doRenderFull(d, prevViewportRef);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [canvasRef, deps.viewport, paramsKey]);

  // GPU compositor hint
  useEffect(() => {
    const el = canvasRef.current;
    if (el) el.style.willChange = 'transform';
    return () => { if (el) el.style.willChange = ''; };
  }, [canvasRef]);

  // Cleanup debounce on unmount
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
    doRenderFull(depsRef.current, prevViewportRef);
  }, []);

  return { forceFullRender };
}
