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
  const { dxPixels, dyPixels } = computePixelDelta(
    oldViewport, newViewport, canvasWidth, canvasHeight
  );

  if (scaleRatio === 1) {
    return `translate(${dxPixels}px, ${dyPixels}px)`;
  }

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
  const { dxPixels, dyPixels } = computePixelDelta(
    oldViewport, newViewport, canvasWidth, canvasHeight
  );
  return { dx: Math.round(dxPixels), dy: Math.round(dyPixels) };
}

/** Pixel delta between two viewports (DRY helper for CSS transform + pan shift) */
function computePixelDelta(
  oldViewport: Viewport,
  newViewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): { dxPixels: number; dyPixels: number } {
  const aspectRatio = canvasWidth / canvasHeight;
  return {
    dxPixels: (oldViewport.centerRe - newViewport.centerRe)
      / (oldViewport.scale * aspectRatio) * canvasWidth,
    dyPixels: (oldViewport.centerIm - newViewport.centerIm)
      / oldViewport.scale * canvasHeight
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
