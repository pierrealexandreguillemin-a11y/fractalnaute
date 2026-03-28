/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * Manages worker pool lifecycle, canvas resize, and export.
 * Viewport transitions delegated to useViewportTransition.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { Viewport, PaletteName, FractalType, FractalParams, ColoringMode, RenderBackend } from '../domain';
import { createWorkerPool, type WorkerPool } from './workerPool';
import { isWebGL2Available, createWebGLRenderer } from './gpu';
import type { WebGLRenderer } from './gpu';
import { resizeCanvas, downloadCanvas } from './canvasUtils';
import { useViewportTransition } from './useViewportTransition';

/** Poll GPU readiness and trigger re-render when shaders finish compiling.
 *  Skip if GPU is ready on first check — the initial render already used it. */
function scheduleGpuReadyRender(
  gpuRef: React.RefObject<WebGLRenderer | null>,
  forceRenderRef: React.MutableRefObject<(() => void) | null>
): void {
  let attempts = 0;
  const check = () => {
    if (++attempts > 60 || !gpuRef.current) return; // ~1s max
    if (gpuRef.current.isReady()) {
      // Only force re-render if GPU wasn't ready initially (shader was compiling)
      if (attempts > 1) forceRenderRef.current?.();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

interface UseRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  ssaa?: boolean;
  lastRenderTime?: number;
  /** Optional reference point for perturbation (deep zoom). Falls back to viewport center. */
  zoomTargetRe?: number;
  zoomTargetIm?: number;
  onRenderStart?: () => void;
  onRenderComplete?: (renderTime: number, backend: RenderBackend) => void;
  onStatusMessage?: (message: string | null) => void;
}

/**
 * Custom hook for managing fractal rendering.
 * Creates a worker pool on mount (if SAB available), destroys on unmount.
 */
export function useRenderer({
  canvasRef, containerRef,
  fractalType, viewport, maxIterations, palette, params,
  coloringMode = 'classic', interiorColoring = false, ssaa = false,
  lastRenderTime = 0,
  zoomTargetRe, zoomTargetIm,
  onRenderStart, onRenderComplete, onStatusMessage
}: UseRendererOptions) {
  const cancelRenderRef = useRef<(() => void) | null>(null);
  const poolRef = useRef<WorkerPool | null>(null);
  const gpuRef = useRef<WebGLRenderer | null>(null);
  const initialPaletteRef = useRef(palette);

  // Store callbacks in refs to avoid re-creating render closures on every parent render.
  const onRenderStartRef = useRef(onRenderStart);
  const onRenderCompleteRef = useRef(onRenderComplete);
  const onStatusMessageRef = useRef(onStatusMessage);
  useEffect(() => { onRenderStartRef.current = onRenderStart; onRenderCompleteRef.current = onRenderComplete; onStatusMessageRef.current = onStatusMessage; }, [onRenderStart, onRenderComplete, onStatusMessage]);

  // Pool + GPU lifecycle: create on mount, destroy on unmount
  const forceRenderRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    poolRef.current = createWorkerPool(); // null if SAB unavailable
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container && isWebGL2Available()) {
      gpuRef.current = createWebGLRenderer(container, initialPaletteRef.current);
      if (canvas) {
        gpuRef.current?.resize(canvas.width, canvas.height);
      }
      // GPU renderer created after first CPU render — schedule GPU re-render
      // when shader compilation completes (async via KHR_parallel_shader_compile)
      scheduleGpuReadyRender(gpuRef, forceRenderRef);
    }
    return () => {
      gpuRef.current?.destroy();
      gpuRef.current = null;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, [canvasRef, containerRef]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    resizeCanvas(canvas, container);
    gpuRef.current?.resize(canvas.width, canvas.height);
  }, [canvasRef, containerRef]);

  // Resize canvas synchronously before any render.
  // Must be useLayoutEffect and declared BEFORE useViewportTransition
  // so it fires first (React processes layout effects in declaration order).
  useLayoutEffect(() => {
    handleResize();
  }, [handleResize]);

  // Viewport transition — CSS transform + debounced render
  const { forceFullRender } = useViewportTransition({
    canvasRef, poolRef, gpuRef,
    fractalType, viewport, maxIterations, palette, params,
    coloringMode, interiorColoring, ssaa, lastRenderTime,
    zoomTargetRe, zoomTargetIm,
    cancelRenderRef, onRenderStartRef, onRenderCompleteRef, onStatusMessageRef
  });

  // Wire forceRenderRef so GPU-ready callback can trigger re-render
  useEffect(() => {
    forceRenderRef.current = forceFullRender;
  }, [forceFullRender]);

  // Keep GPU palette texture in sync with React state
  useEffect(() => {
    gpuRef.current?.updatePalette(palette);
  }, [palette]);

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
    // Export GPU canvas if GPU is active, otherwise CPU canvas
    const gpu = gpuRef.current;
    const canvas = gpu?.isReady() ? gpu.getCanvas() : canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, fractalType);
  }, [canvasRef, fractalType]);

  // Cleanup — capture ref value for safe access in cleanup function
  useEffect(() => {
    const ref = cancelRenderRef;
    return () => { ref.current?.(); };
  }, []);

  return { exportImage };
}
