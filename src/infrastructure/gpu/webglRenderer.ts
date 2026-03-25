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
  createScaledFBO, resizeScaledFBO,
  blitFBOToCanvas, destroyFBO,
  PREVIEW_SCALE, SSAA_SCALE
} from './gpuFramebuffer';
import type { GPUFramebuffer } from './gpuFramebuffer';
import { splitDouble } from './shaders/doubleSingle';

// ---- Public types -----------------------------------------------------------

export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
  ssaa?: boolean;
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

/** Bind center / scale uniforms from viewport state (hi + DS lo corrections). */
function setCenterAndScale(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  viewport: Viewport
): void {
  const [reHi, reLo] = splitDouble(viewport.centerRe);
  const [imHi, imLo] = splitDouble(viewport.centerIm);
  const [scaleHi, scaleLo] = splitDouble(viewport.scale);

  const center = locations.get('u_center');
  if (center) gl.uniform2f(center, reHi, imHi);
  const scale = locations.get('u_scale');
  if (scale) gl.uniform1f(scale, scaleHi);

  // DS lo corrections (unused by float32 shaders — uniforms default to 0)
  const centerLo = locations.get('u_centerLo');
  if (centerLo) gl.uniform2f(centerLo, reLo, imLo);
  const scaleLoLoc = locations.get('u_scaleLo');
  if (scaleLoLoc) gl.uniform1f(scaleLoLoc, scaleLo);
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

/** GPU frame budget — one vsync at 60Hz */
const GPU_FRAME_BUDGET_MS = 16;

/**
 * Iteration threshold for conservative progressive on FIRST render
 * (no GPU timing measurement available yet). Adaptive after first frame.
 */
const CONSERVATIVE_ITER_THRESHOLD = 2048;

/**
 * Decide whether the next frame should use progressive FBO rendering.
 * Data-driven: uses measured GPU time from previous frame via timer query.
 * Falls back to conservative threshold on first render at high iterations.
 */
function needsProgressiveRender(
  maxIterations: number,
  lastGpuTimeMs: number
): boolean {
  // Measured: previous frame exceeded 16ms budget → go progressive
  if (lastGpuTimeMs > GPU_FRAME_BUDGET_MS) return true;
  // No measurement yet + high iterations → conservative progressive
  if (lastGpuTimeMs === 0 && maxIterations >= CONSERVATIVE_ITER_THRESHOLD) return true;
  return false;
}

// ---- Progressive controller -------------------------------------------------

interface ProgressiveController {
  cancelPending(): void;
  renderDirect(compiled: CompiledRef, options: GPURenderOptions, vao: WebGLVertexArrayObject | null, paletteTexture: WebGLTexture): void;
  renderProgressive(compiled: CompiledRef, options: GPURenderOptions, vao: WebGLVertexArrayObject | null, paletteTexture: WebGLTexture): void;
  shouldUseProgressive(maxIterations: number): boolean;
  pollTimerQuery(): void;
  destroy(): void;
  resetState(): void;
}

// ---- GPU timer query wrapper ------------------------------------------------

interface TimerQueryState {
  ext: EXT_disjoint_timer_query_webgl2 | null;
  pending: WebGLQuery | null;
  lastGpuTimeMs: number;
}

function createTimerQueryState(gl: WebGL2RenderingContext): TimerQueryState {
  const ext = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2'
  ) as EXT_disjoint_timer_query_webgl2 | null;
  return { ext, pending: null, lastGpuTimeMs: 0 };
}

function beginTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (!tq.ext || tq.pending) return;
  tq.pending = gl.createQuery();
  if (tq.pending) gl.beginQuery(tq.ext.TIME_ELAPSED_EXT, tq.pending);
}

function endTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (!tq.ext || !tq.pending) return;
  gl.endQuery(tq.ext.TIME_ELAPSED_EXT);
}

function pollTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (!tq.pending) return;
  const available = gl.getQueryParameter(tq.pending, gl.QUERY_RESULT_AVAILABLE) as boolean;
  if (!available) return;
  if (tq.ext) {
    const disjoint = gl.getParameter(tq.ext.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) {
      const ns = gl.getQueryParameter(tq.pending, gl.QUERY_RESULT) as number;
      tq.lastGpuTimeMs = ns / 1_000_000;
    }
  }
  gl.deleteQuery(tq.pending);
  tq.pending = null;
}

function destroyTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (tq.pending) { gl.deleteQuery(tq.pending); tq.pending = null; }
}

// ---- Progressive controller -------------------------------------------------

function createProgressiveController(
  gl: WebGL2RenderingContext
): ProgressiveController {
  let previewFBO: GPUFramebuffer | null = null;
  let ssaaFBO: GPUFramebuffer | null = null;
  let pendingFullResRAF: number | null = null;
  const tq = createTimerQueryState(gl);

  function cancelPending(): void {
    if (pendingFullResRAF !== null) {
      cancelAnimationFrame(pendingFullResRAF);
      pendingFullResRAF = null;
    }
  }

  function canvasTarget(): DrawTarget {
    return { fbo: null, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
  }

  /** Render to canvas, optionally via SSAA 2x FBO. Falls back to direct if FBO unavailable. */
  function renderWithSSAA(
    compiled: CompiledRef, options: GPURenderOptions,
    vao: WebGLVertexArrayObject | null, paletteTexture: WebGLTexture
  ): void {
    gl.bindVertexArray(vao);
    if (options.ssaa) {
      ssaaFBO = ssaaFBO ? resizeScaledFBO(gl, ssaaFBO, SSAA_SCALE) : createScaledFBO(gl, SSAA_SCALE);
      if (ssaaFBO) {
        const target: DrawTarget = { fbo: ssaaFBO.fbo, width: ssaaFBO.width, height: ssaaFBO.height };
        renderToTarget(gl, target, compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring);
        blitFBOToCanvas(gl, ssaaFBO);
        return;
      }
      // FBO creation failed (exceeds MAX_TEXTURE_SIZE or VRAM) — fall through to direct
    }
    renderToTarget(gl, canvasTarget(), compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring);
  }

  return {
    cancelPending,
    pollTimerQuery: () => pollTimerQuery(gl, tq),

    shouldUseProgressive(maxIterations: number): boolean {
      return needsProgressiveRender(maxIterations, tq.lastGpuTimeMs);
    },

    renderDirect(compiled, options, vao, paletteTexture): void {
      beginTimerQuery(gl, tq);
      renderWithSSAA(compiled, options, vao, paletteTexture);
      endTimerQuery(gl, tq);
    },

    renderProgressive(compiled, options, vao, paletteTexture): void {
      // Preview: quarter-res (no SSAA — speed over quality)
      previewFBO = previewFBO ? resizeScaledFBO(gl, previewFBO, PREVIEW_SCALE) : createScaledFBO(gl, PREVIEW_SCALE);
      gl.bindVertexArray(vao);
      if (previewFBO) {
        const target: DrawTarget = { fbo: previewFBO.fbo, width: previewFBO.width, height: previewFBO.height };
        renderToTarget(gl, target, compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring);
        blitFBOToCanvas(gl, previewFBO);
      } else {
        // FBO unavailable — render direct as preview
        renderToTarget(gl, canvasTarget(), compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring);
      }
      // Full-res on next frame (with SSAA if enabled).
      // cancelPending() at the top of render() prevents stale callbacks.
      pendingFullResRAF = requestAnimationFrame(() => {
        pendingFullResRAF = null;
        beginTimerQuery(gl, tq);
        renderWithSSAA(compiled, options, vao, paletteTexture);
        endTimerQuery(gl, tq);
      });
    },

    destroy(): void {
      cancelPending();
      destroyTimerQuery(gl, tq);
      if (previewFBO) destroyFBO(gl, previewFBO);
      if (ssaaFBO) destroyFBO(gl, ssaaFBO);
    },

    resetState(): void {
      // Called after context loss — old GL handles are invalid.
      // GL calls on a lost context are spec-guaranteed no-ops.
      tq.lastGpuTimeMs = 0;
      destroyTimerQuery(gl, tq);
      previewFBO = null;
      ssaaFBO = null;
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

  const maybeGl = gpuCanvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
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
 * Accepts an isDestroyed callback to cancel idle work after destroy().
 */
function precompileCommonVariants(
  gl: WebGL2RenderingContext,
  isDestroyed: () => boolean
): void {
  let index = 0;

  function compileNext(): void {
    if (isDestroyed()) return;
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
  let destroyed = false;

  const progressive = createProgressiveController(gl);
  getOrCompile(gl, 'mandelbrot', 'classic', PRECOMPILE_MAX_ITER);
  precompileCommonVariants(gl, () => destroyed);

  const { onContextLost, onContextRestored } = setupContextHandlers(
    gl, gpuCanvas, progressive, () => currentPalette,
    (tex: WebGLTexture) => { paletteTexture = tex; },
    (v: boolean) => { contextLost = v; }
  );

  return {
    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;
      progressive.cancelPending();
      progressive.pollTimerQuery();
      pollCompilation(gl);
      const compiled = getOrCompile(
        gl, options.fractalType, options.coloringMode, options.maxIterations,
        options.interiorColoring
      );
      if (!compiled) return false;
      if (progressive.shouldUseProgressive(options.maxIterations)) {
        progressive.renderProgressive(compiled, options, emptyVAO, paletteTexture);
      } else {
        progressive.renderDirect(compiled, options, emptyVAO, paletteTexture);
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
      destroyed = true;
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

    getCanvas(): HTMLCanvasElement { return gpuCanvas; }
  };
}
