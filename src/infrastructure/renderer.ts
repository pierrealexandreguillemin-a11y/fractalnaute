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
 * Render a fractal to a canvas.
 * Single-thread fallback renderer — chunked via requestAnimationFrame.
 * Returns a cancel function.
 */
export function renderFractal(
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
