/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * Manages worker pool lifecycle, canvas resize, and export.
 * Viewport transitions delegated to useViewportTransition.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { Viewport, PaletteName, FractalType, FractalParams, ColoringMode } from '../domain';
import { createWorkerPool, type WorkerPool } from './workerPool';
import { isWebGL2Available, createWebGLRenderer } from './gpu';
import type { WebGLRenderer } from './gpu';
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
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  onRenderStart?: () => void;
  onRenderComplete?: (renderTime: number) => void;
}

/**
 * Custom hook for managing fractal rendering.
 * Creates a worker pool on mount (if SAB available), destroys on unmount.
 */
export function useRenderer({
  canvasRef, containerRef,
  fractalType, viewport, maxIterations, palette, params,
  coloringMode = 'classic', interiorColoring = false,
  onRenderStart, onRenderComplete
}: UseRendererOptions) {
  const cancelRenderRef = useRef<(() => void) | null>(null);
  const poolRef = useRef<WorkerPool | null>(null);
  const gpuRef = useRef<WebGLRenderer | null>(null);
  const initialPaletteRef = useRef(palette);

  // Store callbacks in refs to avoid re-creating render closures on every parent render.
  const onRenderStartRef = useRef(onRenderStart);
  const onRenderCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onRenderStartRef.current = onRenderStart;
    onRenderCompleteRef.current = onRenderComplete;
  }, [onRenderStart, onRenderComplete]);

  // Pool + GPU lifecycle: create on mount, destroy on unmount
  useEffect(() => {
    poolRef.current = createWorkerPool(); // null if SAB unavailable
    const canvas = canvasRef.current;
    if (canvas && isWebGL2Available()) {
      gpuRef.current = createWebGLRenderer(canvas, initialPaletteRef.current);
    }
    return () => {
      gpuRef.current?.destroy();
      gpuRef.current = null;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, [canvasRef]);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    resizeCanvas(canvas, container);
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
    coloringMode, interiorColoring,
    cancelRenderRef, onRenderStartRef, onRenderCompleteRef
  });

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
    const canvas = canvasRef.current;
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
