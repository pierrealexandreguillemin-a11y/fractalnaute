/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - Palette Texture
 * Converts OKLCH palettes to sRGB texture data for GPU rendering
 * ===============================================================================
 */

import type { PaletteName } from '../../domain/types';
import { resolvePalette } from '../../domain/palettes';
import { oklchToRgb } from '../../domain/color';
import { createTexture } from 'twgl.js';

const PALETTE_SIZE = 256;
const COMPONENTS = 4; // RGBA
const ALPHA_OPAQUE = 255;

/**
 * Generate 256x4 sRGB pixel data from a named OKLCH palette.
 * Pure function — testable without WebGL context.
 */
export function createPaletteData(paletteName: PaletteName): Uint8Array {
  const palette = resolvePalette(paletteName);
  const data = new Uint8Array(PALETTE_SIZE * COMPONENTS);

  for (let i = 0; i < PALETTE_SIZE; i++) {
    const t = i / (PALETTE_SIZE - 1);
    const oklch = palette(t);
    const [r, g, b] = oklchToRgb(oklch.L, oklch.C, oklch.H);
    const offset = i * COMPONENTS;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = ALPHA_OPAQUE;
  }

  return data;
}

/**
 * Create a 256x1 sRGB texture from a named palette.
 * Requires WebGL 2 context.
 */
export function createPaletteTexture(
  gl: WebGL2RenderingContext,
  paletteName: PaletteName
): WebGLTexture {
  const data = createPaletteData(paletteName);

  return createTexture(gl, {
    src: data,
    width: PALETTE_SIZE,
    height: 1,
    min: gl.LINEAR,
    mag: gl.LINEAR,
    wrap: gl.CLAMP_TO_EDGE,
    internalFormat: gl.RGBA8,
  });
}

/**
 * Update an existing texture with new palette data (avoids re-allocation).
 */
export function updatePaletteTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  paletteName: PaletteName
): void {
  const data = createPaletteData(paletteName);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0,
    PALETTE_SIZE, 1,
    gl.RGBA, gl.UNSIGNED_BYTE, data
  );
}
