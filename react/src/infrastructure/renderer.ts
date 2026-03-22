/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Canvas Renderer
 * Handles all canvas rendering operations
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Viewport, PaletteName, FractalType, FractalParams } from '../domain';
import { getColor, getFractalConfig } from '../domain';

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
 * Render a fractal to a canvas
 */
export function renderFractal(
  canvas: HTMLCanvasElement,
  options: RenderOptions
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const { fractalType, viewport, maxIterations, palette, params, onProgress, onComplete } = options;
  const width = canvas.width;
  const height = canvas.height;
  
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  const config = getFractalConfig(fractalType);
  const calculator = config.calculator;
  const mergedParams = { ...config.params, ...params };
  
  const startTime = performance.now();
  let cancelled = false;
  let currentY = 0;
  const chunkSize = 12;

  // Precalculate coordinate mapping (avoids 8M divisions + object allocations)
  const aspectRatio = width / height;
  const stepRe = viewport.scale * aspectRatio / width;
  const stepIm = viewport.scale / height;
  const originRe = viewport.centerRe - viewport.scale * aspectRatio * 0.5;
  const originIm = viewport.centerIm - viewport.scale * 0.5;

  const renderChunk = () => {
    if (cancelled) return;

    const endY = Math.min(currentY + chunkSize, height);

    for (let y = currentY; y < endY; y++) {
      for (let x = 0; x < width; x++) {
        const re = originRe + x * stepRe;
        const im = originIm + y * stepIm;
        const result = calculator(re, im, maxIterations, mergedParams);
        const [r, g, b] = getColor(result, palette);

        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0, 0, currentY, width, endY - currentY);
    currentY = endY;

    if (onProgress) {
      onProgress(currentY / height);
    }

    if (currentY < height) {
      requestAnimationFrame(renderChunk);
    } else {
      const renderTime = performance.now() - startTime;
      if (onComplete) {
        onComplete(renderTime);
      }
    }
  };

  requestAnimationFrame(renderChunk);

  return () => {
    cancelled = true;
  };
}

