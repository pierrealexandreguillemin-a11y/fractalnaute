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
