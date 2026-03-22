/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Band Renderer
 * Shared pixel computation logic — used by worker AND fallback paths
 * DRY: single source of truth for the render loop
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  FractalType, PaletteName, FractalParams, Viewport, ColoringMode
} from '../domain/types';
import { getFractalConfig } from '../domain/fractalTypes';
import { resolvePalette, getColorFast } from '../domain/palettes';

export interface BandRenderParams {
  /** X-range clipping for strip rendering. Defaults to full width. */
  startX?: number;
  endX?: number;
  startY: number;
  endY: number;
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  /** Coloring algorithm. Defaults to 'classic' (smooth iteration count). */
  coloringMode?: ColoringMode;
  /** Whether to color interior (non-escaping) points. Defaults to false (black). */
  interiorColoring?: boolean;
  /** Pixel stride for progressive rendering. 1 = full-res (default), 4 = preview. */
  stride?: number;
}

/**
 * Build merged params once per render — avoids repeated spreads in hot path.
 * Callers that invoke renderBand multiple times (fallback chunks) should
 * call this once and pass the result via band.params.
 */
export function buildMergedParams(
  fractalType: FractalType,
  params: FractalParams
): FractalParams {
  const config = getFractalConfig(fractalType);
  return { ...config.params, ...params };
}

/**
 * Render a horizontal band of pixels into a Uint8ClampedArray buffer.
 *
 * @param pixels - RGBA buffer (width * height * 4 bytes)
 * @param band - Band parameters (params should be pre-merged via buildMergedParams)
 * @param shouldCancel - Optional function checked every line; return true to abort
 * @returns true if completed, false if cancelled
 */
export function renderBand(
  pixels: Uint8ClampedArray,
  band: BandRenderParams,
  shouldCancel?: () => boolean
): boolean {
  const {
    startX: rawStartX, endX: rawEndX,
    startY, endY, width, height, viewport,
    fractalType, maxIterations, palette, params,
    coloringMode: rawColoringMode, interiorColoring: rawInteriorColoring,
    stride: rawStride
  } = band;

  const stride = rawStride ?? 1;
  const startX = rawStartX ?? 0;
  const endX = rawEndX ?? width;
  const coloringMode = rawColoringMode ?? 'classic';
  const interiorColoring = rawInteriorColoring ?? false;
  const config = getFractalConfig(fractalType);
  const calculator = config.calculator;
  const resolvedPalette = resolvePalette(palette);

  // Precalculate coordinate mapping
  // PERF: inlined screenToComplex — keep in sync with coordinates.ts
  const aspectRatio = width / height;
  const stepRe = viewport.scale * aspectRatio / width;
  const stepIm = viewport.scale / height;
  const originRe = viewport.centerRe - viewport.scale * aspectRatio * 0.5;
  const originIm = viewport.centerIm - viewport.scale * 0.5;

  // Tell calculators whether to accumulate orbit data for advanced coloring
  const needsAccum = coloringMode !== 'classic' || interiorColoring;
  const effectiveParams = needsAccum
    ? { ...params, _needsAccumulation: true }
    : params;

  for (let y = startY; y < endY; y += stride) {
    if (shouldCancel?.()) return false;

    for (let x = startX; x < endX; x += stride) {
      const re = originRe + x * stepRe;
      const im = originIm + y * stepIm;
      const result = calculator(re, im, maxIterations, effectiveParams);
      const [r, g, b] = getColorFast(result, resolvedPalette, coloringMode, interiorColoring);

      // Fill stride×stride block, clamped to band/canvas boundaries
      const blockEndY = Math.min(y + stride, endY);
      const blockEndX = Math.min(x + stride, endX);
      for (let by = y; by < blockEndY; by++) {
        for (let bx = x; bx < blockEndX; bx++) {
          const idx = (by * width + bx) * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = 255;
        }
      }
    }
  }

  return true;
}
