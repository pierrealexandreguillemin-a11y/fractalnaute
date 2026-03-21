/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coordinate Transforms
 * Pure functions for coordinate conversions
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Complex, Viewport } from './types';

/**
 * Convert screen coordinates to complex plane coordinates
 */
export function screenToComplex(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: Viewport
): Complex {
  const aspectRatio = width / height;
  return {
    re: viewport.centerRe + (x / width - 0.5) * viewport.scale * aspectRatio,
    im: viewport.centerIm + (y / height - 0.5) * viewport.scale
  };
}

/**
 * Convert complex plane coordinates to screen coordinates
 */
export function complexToScreen(
  c: Complex,
  width: number,
  height: number,
  viewport: Viewport
): { x: number; y: number } {
  const aspectRatio = width / height;
  return {
    x: ((c.re - viewport.centerRe) / (viewport.scale * aspectRatio) + 0.5) * width,
    y: ((c.im - viewport.centerIm) / viewport.scale + 0.5) * height
  };
}

/**
 * Calculate new viewport after zoom operation
 */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  focusRe: number,
  focusIm: number
): Viewport {
  return {
    centerRe: viewport.centerRe + (focusRe - viewport.centerRe) * (1 - factor),
    centerIm: viewport.centerIm + (focusIm - viewport.centerIm) * (1 - factor),
    scale: viewport.scale * factor
  };
}

/**
 * Calculate new viewport after pan operation
 */
export function panViewport(
  viewport: Viewport,
  deltaRe: number,
  deltaIm: number
): Viewport {
  return {
    centerRe: viewport.centerRe + deltaRe,
    centerIm: viewport.centerIm + deltaIm,
    scale: viewport.scale
  };
}

/**
 * Calculate zoom level relative to default scale
 */
export function getZoomLevel(viewport: Viewport, defaultScale: number): number {
  return defaultScale / viewport.scale;
}

/**
 * Format complex number as human-readable string
 * Example: "c = -0.7000 + 0.2702i"
 */
export function formatComplexCoords(
  re: number,
  im: number,
  precision: number = 4
): string {
  const sign = im >= 0 ? '+' : '';
  return `c = ${re.toFixed(precision)} ${sign} ${im.toFixed(precision)}i`;
}
