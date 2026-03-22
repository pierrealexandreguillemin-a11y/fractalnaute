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

/**
 * Custom hook for managing fractal rendering.
 * Creates a worker pool on mount (if SAB available), destroys on unmount.
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

  // Store callbacks in refs to avoid re-creating render() on every parent render.
  // Without this, onRenderStart → setRendering(true) → re-render → new closure →
  // new render ref → useEffect re-fires → infinite loop.
  const onRenderStartRef = useRef(onRenderStart);
  const onRenderCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onRenderStartRef.current = onRenderStart;
    onRenderCompleteRef.current = onRenderComplete;
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

    cancelRenderRef.current?.();
    onRenderStartRef.current?.();

    cancelRenderRef.current = renderFractal(canvas, poolRef.current, {
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
    const handleWindowResize = () => {
      handleResize();
      render();
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [handleResize, render]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelRenderRef.current?.();
    };
  }, []);

  return { exportImage };
}
