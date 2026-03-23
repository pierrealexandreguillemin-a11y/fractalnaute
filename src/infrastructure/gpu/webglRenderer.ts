/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - WebGL Renderer
 * Thin orchestrator: ties shader compiler + palette texture + GL draw calls
 * ===============================================================================
 */

import type {
  Viewport, FractalType, ColoringMode, PaletteName, FractalParams
} from '../../domain/types';
import {
  initCompiler, getOrCompile, pollCompilation,
  destroyAllPrograms, hasCompiledProgram
} from './shaderCompiler';
import { createPaletteTexture, updatePaletteTexture } from './paletteTexture';

// ---- Public types -----------------------------------------------------------

export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
}

export interface WebGLRenderer {
  render(options: GPURenderOptions): boolean;
  updatePalette(palette: PaletteName): void;
  destroy(): void;
  isReady(): boolean;
}

// ---- Uniform binding helpers ------------------------------------------------

/** Bind center / scale / resolution uniforms from viewport state. */
function setViewportUniforms(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  viewport: Viewport
): void {
  const center = locations.get('u_center');
  if (center) gl.uniform2f(center, viewport.centerRe, viewport.centerIm);

  const scale = locations.get('u_scale');
  if (scale) gl.uniform1f(scale, viewport.scale);

  const resolution = locations.get('u_resolution');
  if (resolution) {
    gl.uniform2f(resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
}

/** Bind palette sampler uniform. */
function bindPaletteTexture(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  texture: WebGLTexture
): void {
  const paletteLoc = locations.get('u_palette');
  if (!paletteLoc) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(paletteLoc, 0);
}

// ---- Factory ----------------------------------------------------------------

const DEFAULT_PALETTE: PaletteName = 'classic';
const DEFAULT_MAX_ITER = 256;

/**
 * Create a WebGL 2 renderer bound to a canvas.
 * Returns null if the browser does not support WebGL 2.
 */
export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  initialPalette?: PaletteName
): WebGLRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;

  // Required by WebGL 2 — bind once, keep forever
  const emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);

  initCompiler(gl);

  const palette = initialPalette ?? DEFAULT_PALETTE;
  let paletteTexture = createPaletteTexture(gl, palette);
  let currentPalette: PaletteName = palette;
  let contextLost = false;

  // Eagerly start default shader compilation
  getOrCompile(gl, 'mandelbrot', 'classic', DEFAULT_MAX_ITER);

  // -- Context loss -----------------------------------------------------------

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
  };

  const onContextRestored = (): void => {
    contextLost = false;
    initCompiler(gl);
    paletteTexture = createPaletteTexture(gl, currentPalette);
    getOrCompile(gl, 'mandelbrot', 'classic', DEFAULT_MAX_ITER);
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // -- Renderer object --------------------------------------------------------

  return {
    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;
      pollCompilation(gl);

      const compiled = getOrCompile(
        gl, options.fractalType, options.coloringMode, options.maxIterations
      );
      if (!compiled) return false;

      gl.useProgram(compiled.program);
      gl.bindVertexArray(emptyVAO);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      setViewportUniforms(gl, compiled.uniformLocations, options.viewport);
      bindPaletteTexture(gl, compiled.uniformLocations, paletteTexture);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },

    updatePalette(name: PaletteName): void {
      currentPalette = name;
      if (!contextLost) {
        updatePaletteTexture(gl, paletteTexture, name);
      }
    },

    destroy(): void {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyAllPrograms(gl);
      gl.deleteTexture(paletteTexture);
      gl.deleteVertexArray(emptyVAO);
    },

    isReady(): boolean {
      if (contextLost) return false;
      pollCompilation(gl);
      return hasCompiledProgram();
    }
  };
}
