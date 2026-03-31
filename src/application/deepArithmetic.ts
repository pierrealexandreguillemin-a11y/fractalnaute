/**
 * High-precision coordinate arithmetic for deep zoom (>10^-13).
 * Uses decimal.js-light for arbitrary-precision add/multiply on decimal strings.
 * Called by fractalReducer for ZOOM and PAN actions.
 */

import Decimal from 'decimal.js-light';
import type { Viewport } from '../domain';

// Scoped constructor — 200 significant digits, covers zoom 10^-180 with margin.
// Clone avoids mutating the global Decimal for other consumers.
const D = Decimal.clone({ precision: 200 });

/** Ensure viewport has deep strings (initialise from f64 if absent). */
function ensureDeep(vp: Viewport): { re: Decimal; im: Decimal; scale: Decimal } {
  return {
    re: new D(vp.deepRe ?? vp.centerRe.toString()),
    im: new D(vp.deepIm ?? vp.centerIm.toString()),
    scale: new D(vp.deepScale ?? vp.scale.toString()),
  };
}

/** Build viewport with both f64 (GPU/UI) and deep strings (WASM). */
function toViewport(re: Decimal, im: Decimal, scale: Decimal): Viewport {
  return {
    centerRe: re.toNumber(),
    centerIm: im.toNumber(),
    scale: scale.toNumber(),
    deepRe: re.toString(),
    deepIm: im.toString(),
    deepScale: scale.toString(),
  };
}

/**
 * Deep-precision zoom: newCenter = center + offset * (1 - factor).
 * offsetRe/Im are f64 (pixel delta from center — always small, precise in f64).
 */
export function deepZoom(
  vp: Viewport, factor: number, focusRe: number, focusIm: number
): Viewport {
  const { re, im, scale } = ensureDeep(vp);
  const offsetRe = focusRe - vp.centerRe;
  const offsetIm = focusIm - vp.centerIm;
  const shift = 1 - factor;
  return toViewport(
    re.plus(offsetRe * shift),
    im.plus(offsetIm * shift),
    scale.times(factor),
  );
}

/**
 * Deep-precision pan: newCenter = center + delta.
 * deltaRe/Im are f64 (pixel drag in complex plane — always small).
 */
export function deepPan(vp: Viewport, deltaRe: number, deltaIm: number): Viewport {
  const { re, im, scale } = ensureDeep(vp);
  return toViewport(
    re.plus(deltaRe),
    im.plus(deltaIm),
    scale,
  );
}
