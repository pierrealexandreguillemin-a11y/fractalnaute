/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Render Hook
 * React hook for managing fractal rendering
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import { renderFractal } from './renderer';
import { resizeCanvas, downloadCanvas } from './canvasUtils';

interface UseRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLElement>;
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  onRenderStart?: () => void;
  onRenderComplete?: (renderTime: number) => void;
}

/**
 * Custom hook for managing fractal rendering
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
  const isFirstRender = useRef(true);

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    resizeCanvas(canvas, container);
  }, [canvasRef, containerRef]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (cancelRenderRef.current) {
      cancelRenderRef.current();
    }

    onRenderStart?.();

    cancelRenderRef.current = renderFractal(canvas, {
      fractalType,
      viewport,
      maxIterations,
      palette,
      params,
      onComplete: (renderTime) => {
        cancelRenderRef.current = null;
        onRenderComplete?.(renderTime);
      }
    });
  }, [canvasRef, fractalType, viewport, maxIterations, palette, params, onRenderStart, onRenderComplete]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadCanvas(canvas, fractalType);
  }, [canvasRef, fractalType]);

  // Initial setup
  useEffect(() => {
    handleResize();
    if (isFirstRender.current) {
      isFirstRender.current = false;
      requestAnimationFrame(render);
    }
  }, [handleResize, render]);

  // Re-render on changes
  useEffect(() => {
    if (!isFirstRender.current) {
      render();
    }
  }, [fractalType, viewport, maxIterations, palette, params, render]);

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
      if (cancelRenderRef.current) {
        cancelRenderRef.current();
      }
    };
  }, []);

  return { render, exportImage, handleResize };
}
