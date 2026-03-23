/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - WebGL Renderer
 * Thin orchestrator: ties shader compiler + palette texture + GL draw calls.
 * Supports progressive rendering via quarter-res FBO preview + full-res pass.
 * ===============================================================================
 */

import type {
  Viewport, ColoringMode, PaletteName, FractalParams
} from '../../domain/types';
import {
  initCompiler, getOrCompile, pollCompilation,
  destroyAllPrograms, hasCompiledProgram
} from './shaderCompiler';
import { createPaletteTexture, updatePaletteTexture } from './paletteTexture';
import {
  createQuarterFBO, resizeQuarterFBO,
  blitFBOToCanvas, destroyFBO
} from './gpuFramebuffer';
import type { GPUFramebuffer } from './gpuFramebuffer';

// ---- Public types -----------------------------------------------------------

export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: import('../../domain/types').FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
}

export interface WebGLRenderer {
  render(options: GPURenderOptions): boolean;
  cancelPending(): void;
  updatePalette(palette: PaletteName): void;
  destroy(): void;
  isReady(): boolean;
}

// ---- Internal draw types ----------------------------------------------------

interface DrawTarget {
  fbo: WebGLFramebuffer | null;
  width: number;
  height: number;
}

interface CompiledRef {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
}

// ---- Uniform binding helpers ------------------------------------------------

/** Bind center / scale uniforms from viewport state. */
function setCenterAndScale(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  viewport: Viewport
): void {
  const center = locations.get('u_center');
  if (center) gl.uniform2f(center, viewport.centerRe, viewport.centerIm);
  const scale = locations.get('u_scale');
  if (scale) gl.uniform1f(scale, viewport.scale);
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

/** Render the fractal to a specific target (FBO or canvas). */
function renderToTarget(
  gl: WebGL2RenderingContext,
  target: DrawTarget,
  compiled: CompiledRef,
  viewport: Viewport,
  paletteTexture: WebGLTexture
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.width, target.height);
  gl.useProgram(compiled.program);
  setCenterAndScale(gl, compiled.uniformLocations, viewport);
  const res = compiled.uniformLocations.get('u_resolution');
  if (res) gl.uniform2f(res, target.width, target.height);
  bindPaletteTexture(gl, compiled.uniformLocations, paletteTexture);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- Progressive rendering heuristic ----------------------------------------

/** @tradeoff Heuristic threshold — matches 1080p at 512 iterations. */
const PROGRESSIVE_THRESHOLD = 1920 * 1080 * 512;
const FRAME_BUDGET_MS = 16;

function needsProgressiveRender(
  gl: WebGL2RenderingContext,
  maxIterations: number,
  hasTimerQuery: boolean,
  lastGpuTimeMs: number
): boolean {
  if (hasTimerQuery) return lastGpuTimeMs > FRAME_BUDGET_MS;
  const workload = gl.drawingBufferWidth * gl.drawingBufferHeight * maxIterations;
  return workload > PROGRESSIVE_THRESHOLD;
}

// ---- Progressive controller -------------------------------------------------

interface ProgressiveController {
  cancelPending(): void;
  renderProgressive(
    compiled: CompiledRef,
    options: GPURenderOptions,
    vao: WebGLVertexArrayObject | null,
    paletteTexture: WebGLTexture
  ): void;
  shouldUseProgressive(maxIterations: number): boolean;
  destroy(): void;
  resetState(): void;
}

function createProgressiveController(
  gl: WebGL2RenderingContext
): ProgressiveController {
  let lastGpuTimeMs = 0;
  let quarterFBO: GPUFramebuffer | null = null;
  let pendingFullResRAF: number | null = null;
  const timerQueryExt = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2'
  ) as EXT_disjoint_timer_query_webgl2 | null;

  function cancelPending(): void {
    if (pendingFullResRAF !== null) {
      cancelAnimationFrame(pendingFullResRAF);
      pendingFullResRAF = null;
    }
  }

  function canvasTarget(): DrawTarget {
    return {
      fbo: null,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight
    };
  }

  function scheduleFullRes(
    compiled: CompiledRef,
    options: GPURenderOptions,
    vao: WebGLVertexArrayObject | null,
    paletteTexture: WebGLTexture
  ): void {
    const start = performance.now();
    pendingFullResRAF = requestAnimationFrame(() => {
      pendingFullResRAF = null;
      gl.bindVertexArray(vao);
      renderToTarget(
        gl, canvasTarget(), compiled, options.viewport, paletteTexture
      );
      lastGpuTimeMs = performance.now() - start;
    });
  }

  return {
    cancelPending,

    shouldUseProgressive(maxIterations: number): boolean {
      return needsProgressiveRender(
        gl, maxIterations, timerQueryExt !== null, lastGpuTimeMs
      );
    },

    renderProgressive(compiled, options, vao, paletteTexture): void {
      quarterFBO = quarterFBO
        ? resizeQuarterFBO(gl, quarterFBO)
        : createQuarterFBO(gl);
      const fboTarget: DrawTarget = {
        fbo: quarterFBO.fbo,
        width: quarterFBO.width,
        height: quarterFBO.height
      };
      gl.bindVertexArray(vao);
      renderToTarget(gl, fboTarget, compiled, options.viewport, paletteTexture);
      blitFBOToCanvas(gl, quarterFBO);
      scheduleFullRes(compiled, options, vao, paletteTexture);
    },

    destroy(): void {
      cancelPending();
      if (quarterFBO) destroyFBO(gl, quarterFBO);
    },

    resetState(): void {
      lastGpuTimeMs = 0;
      quarterFBO = null;
    }
  };
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
  const maybeGl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!maybeGl) return null;
  const gl: WebGL2RenderingContext = maybeGl;

  const emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  initCompiler(gl);

  const palette = initialPalette ?? DEFAULT_PALETTE;
  let paletteTexture = createPaletteTexture(gl, palette);
  let currentPalette: PaletteName = palette;
  let contextLost = false;

  const progressive = createProgressiveController(gl);
  getOrCompile(gl, 'mandelbrot', 'classic', DEFAULT_MAX_ITER);

  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
  };

  const onContextRestored = (): void => {
    contextLost = false;
    progressive.resetState();
    initCompiler(gl);
    paletteTexture = createPaletteTexture(gl, currentPalette);
    getOrCompile(gl, 'mandelbrot', 'classic', DEFAULT_MAX_ITER);
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;
      progressive.cancelPending();
      pollCompilation(gl);
      const compiled = getOrCompile(
        gl, options.fractalType, options.coloringMode, options.maxIterations
      );
      if (!compiled) return false;
      if (progressive.shouldUseProgressive(options.maxIterations)) {
        progressive.renderProgressive(compiled, options, emptyVAO, paletteTexture);
      } else {
        gl.bindVertexArray(emptyVAO);
        renderToTarget(
          gl,
          { fbo: null, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
          compiled, options.viewport, paletteTexture
        );
      }
      return true;
    },

    cancelPending(): void {
      progressive.cancelPending();
    },

    updatePalette(name: PaletteName): void {
      currentPalette = name;
      if (!contextLost) updatePaletteTexture(gl, paletteTexture, name);
    },

    destroy(): void {
      progressive.destroy();
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
