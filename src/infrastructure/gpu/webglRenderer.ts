/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - WebGL Renderer
 * Thin orchestrator: ties shader compiler + palette texture + GL draw calls.
 * Supports progressive rendering via quarter-res FBO preview + full-res pass.
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
import {
  createQuarterFBO, resizeQuarterFBO,
  blitFBOToCanvas, destroyFBO
} from './gpuFramebuffer';
import type { GPUFramebuffer } from './gpuFramebuffer';

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
  cancelPending(): void;
  updatePalette(palette: PaletteName): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
  isReady(): boolean;
  /** Get the GPU canvas element for export/screenshot. */
  getCanvas(): HTMLCanvasElement;
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

/** Bind fractal-specific uniforms (Julia c, Multibrot power). */
function setFractalParams(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  params: FractalParams
): void {
  const juliaRe = locations.get('u_juliaRe');
  const juliaIm = locations.get('u_juliaIm');
  const power = locations.get('u_power');
  if (juliaRe) gl.uniform1f(juliaRe, params.juliaRe ?? -0.7);
  if (juliaIm) gl.uniform1f(juliaIm, params.juliaIm ?? 0.27015);
  if (power) gl.uniform1i(power, params.power ?? 3);
}

/** Render the fractal to a specific target (FBO or canvas). */
function renderToTarget(
  gl: WebGL2RenderingContext,
  target: DrawTarget,
  compiled: CompiledRef,
  viewport: Viewport,
  paletteTexture: WebGLTexture,
  fractalParams: FractalParams,
  interiorColoring: boolean = false
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.width, target.height);
  gl.useProgram(compiled.program);
  setCenterAndScale(gl, compiled.uniformLocations, viewport);
  const res = compiled.uniformLocations.get('u_resolution');
  if (res) gl.uniform2f(res, target.width, target.height);
  setFractalParams(gl, compiled.uniformLocations, fractalParams);
  const intColor = compiled.uniformLocations.get('u_interiorColoring');
  if (intColor) gl.uniform1i(intColor, interiorColoring ? 1 : 0);
  bindPaletteTexture(gl, compiled.uniformLocations, paletteTexture);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- Progressive rendering heuristic ----------------------------------------

/**
 * Progressive rendering is disabled: no measured evidence that GPU frames
 * exceed 16ms with cardioid/bulb pre-test at typical resolutions.
 * To re-enable: implement EXT_disjoint_timer_query_webgl2 measurement,
 * confirm >16ms frames, then add workload-based heuristic here.
 */
function needsProgressiveRender(
  _gl: WebGL2RenderingContext,
  _maxIterations: number,
  _hasTimerQuery: boolean,
  _lastGpuTimeMs: number
): boolean {
  return false;
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
        gl, canvasTarget(), compiled, options.viewport, paletteTexture,
        options.fractalParams, options.interiorColoring
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
      renderToTarget(gl, fboTarget, compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring);
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

// ---- GPU canvas factory -----------------------------------------------------

/**
 * Create an overlay canvas for WebGL 2 rendering.
 * Separate canvas avoids the one-context-per-canvas browser restriction
 * (the CPU path needs a `2d` context on the main canvas).
 */
function createGpuCanvas(
  container: HTMLElement
): { gpuCanvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  const gpuCanvas = document.createElement('canvas');
  gpuCanvas.style.position = 'absolute';
  gpuCanvas.style.top = '0';
  gpuCanvas.style.left = '0';
  gpuCanvas.style.width = '100%';
  gpuCanvas.style.height = '100%';
  gpuCanvas.style.pointerEvents = 'none';
  gpuCanvas.style.display = 'none';

  const maybeGl = gpuCanvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!maybeGl) return null;

  container.appendChild(gpuCanvas);
  return { gpuCanvas, gl: maybeGl };
}

// ---- Factory ----------------------------------------------------------------

const DEFAULT_PALETTE: PaletteName = 'classic';
/** Default iteration count for eager pre-compilation of the initial shader. */
const PRECOMPILE_MAX_ITER = 256;

// ---- Idle-time shader pre-compilation ---------------------------------------

/** Fractal variants to pre-compile (classic coloring covers the default). */
const PRECOMPILE_FRACTALS: FractalType[] = [
  'julia', 'burningship', 'tricorn', 'multibrot3'
];

/**
 * Pre-compile common shader variants during browser idle time.
 * This eliminates the CPU-fallback stall when switching fractal type.
 * mandelbrot+classic is already compiled eagerly; this covers the rest.
 */
function precompileCommonVariants(gl: WebGL2RenderingContext): void {
  let index = 0;

  function compileNext(): void {
    if (index >= PRECOMPILE_FRACTALS.length) return;
    const fractal = PRECOMPILE_FRACTALS[index]!;
    getOrCompile(gl, fractal, 'classic', PRECOMPILE_MAX_ITER);
    index++;
    scheduleNext();
  }

  function scheduleNext(): void {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(compileNext);
    } else {
      setTimeout(compileNext, 50);
    }
  }

  scheduleNext();
}

/**
 * Create a WebGL 2 renderer with its own dedicated canvas overlay.
 * Returns null if the browser does not support WebGL 2.
 */
function setupContextHandlers(
  gl: WebGL2RenderingContext,
  gpuCanvas: HTMLCanvasElement,
  progressive: ProgressiveController,
  getCurrentPalette: () => PaletteName,
  setPaletteTexture: (tex: WebGLTexture) => void,
  setContextLost: (v: boolean) => void
): { onContextLost: (e: Event) => void; onContextRestored: () => void } {
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    setContextLost(true);
  };
  const onContextRestored = (): void => {
    setContextLost(false);
    progressive.resetState();
    initCompiler(gl);
    setPaletteTexture(createPaletteTexture(gl, getCurrentPalette()));
    getOrCompile(gl, 'mandelbrot', 'classic', PRECOMPILE_MAX_ITER);
  };
  gpuCanvas.addEventListener('webglcontextlost', onContextLost);
  gpuCanvas.addEventListener('webglcontextrestored', onContextRestored);
  return { onContextLost, onContextRestored };
}

export function createWebGLRenderer(
  container: HTMLElement,
  initialPalette?: PaletteName
): WebGLRenderer | null {
  const result = createGpuCanvas(container);
  if (!result) return null;
  const { gpuCanvas, gl } = result;

  const emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  initCompiler(gl);

  const palette = initialPalette ?? DEFAULT_PALETTE;
  let paletteTexture = createPaletteTexture(gl, palette);
  let currentPalette: PaletteName = palette;
  let contextLost = false;

  const progressive = createProgressiveController(gl);
  getOrCompile(gl, 'mandelbrot', 'classic', PRECOMPILE_MAX_ITER);
  precompileCommonVariants(gl);

  const { onContextLost, onContextRestored } = setupContextHandlers(
    gl, gpuCanvas, progressive, () => currentPalette,
    (tex: WebGLTexture) => { paletteTexture = tex; },
    (v: boolean) => { contextLost = v; }
  );

  return {
    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;
      progressive.cancelPending();
      pollCompilation(gl);
      const compiled = getOrCompile(
        gl, options.fractalType, options.coloringMode, options.maxIterations,
        options.interiorColoring
      );
      if (!compiled) return false;
      if (progressive.shouldUseProgressive(options.maxIterations)) {
        progressive.renderProgressive(compiled, options, emptyVAO, paletteTexture);
      } else {
        gl.bindVertexArray(emptyVAO);
        renderToTarget(
          gl,
          { fbo: null, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
          compiled, options.viewport, paletteTexture, options.fractalParams,
          options.interiorColoring
        );
      }
      return true;
    },

    cancelPending(): void { progressive.cancelPending(); },

    updatePalette(name: PaletteName): void {
      currentPalette = name;
      if (!contextLost) updatePaletteTexture(gl, paletteTexture, name);
    },

    resize(width: number, height: number): void {
      gpuCanvas.width = width;
      gpuCanvas.height = height;
    },

    setVisible(visible: boolean): void {
      gpuCanvas.style.display = visible ? 'block' : 'none';
    },

    destroy(): void {
      progressive.destroy();
      gpuCanvas.removeEventListener('webglcontextlost', onContextLost);
      gpuCanvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyAllPrograms(gl);
      gl.deleteTexture(paletteTexture);
      gl.deleteVertexArray(emptyVAO);
      gpuCanvas.remove();
    },

    isReady(): boolean {
      if (contextLost) return false;
      pollCompilation(gl);
      return hasCompiledProgram();
    },

    getCanvas(): HTMLCanvasElement {
      return gpuCanvas;
    }
  };
}
