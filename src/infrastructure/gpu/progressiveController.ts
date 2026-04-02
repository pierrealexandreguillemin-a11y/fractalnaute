/**
 * Progressive rendering controller with GPU timer queries.
 * Quarter-res FBO preview + deferred full-res pass prevents browser freeze.
 * Self-adaptive via measured GPU time from EXT_disjoint_timer_query_webgl2.
 */

import type { DrawTarget, CompiledRef, GPURenderOptions, OrbitContext } from './rendererTypes';
import { renderToTarget } from './renderPipeline';
import {
  createScaledFBO, resizeScaledFBO,
  blitFBOToCanvas, destroyFBO,
  PREVIEW_SCALE, SSAA_SCALE
} from './gpuFramebuffer';
import type { GPUFramebuffer } from './gpuFramebuffer';

// ---- Progressive rendering heuristic ----------------------------------------

/** GPU frame budget — one vsync at 60Hz */
const GPU_FRAME_BUDGET_MS = 16;

/** Conservative threshold for FIRST render (no GPU timing yet).
 * Lowered to 1024 to ensure progressive preview at deep zoom entry. */
const CONSERVATIVE_ITER_THRESHOLD = 1024;

function needsProgressiveRender(
  maxIterations: number,
  lastGpuTimeMs: number
): boolean {
  if (lastGpuTimeMs > GPU_FRAME_BUDGET_MS) return true;
  if (lastGpuTimeMs === 0 && maxIterations >= CONSERVATIVE_ITER_THRESHOLD) return true;
  return false;
}

// ---- GPU timer query --------------------------------------------------------

interface TimerQueryState {
  ext: EXT_disjoint_timer_query_webgl2 | null;
  pending: WebGLQuery | null;
  active: boolean;
  lastGpuTimeMs: number;
}

function createTimerQueryState(gl: WebGL2RenderingContext): TimerQueryState {
  const ext = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2'
  ) as EXT_disjoint_timer_query_webgl2 | null;
  return { ext, pending: null, active: false, lastGpuTimeMs: 0 };
}

function beginTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (!tq.ext || tq.pending) return;
  tq.pending = gl.createQuery();
  if (tq.pending) {
    gl.beginQuery(tq.ext.TIME_ELAPSED_EXT, tq.pending);
    tq.active = true;
  }
}

function endTimerQuery(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
  if (!tq.ext || !tq.active) return;
  gl.endQuery(tq.ext.TIME_ELAPSED_EXT);
  tq.active = false;
}

function pollTimer(gl: WebGL2RenderingContext, tq: TimerQueryState): void {
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

// ---- SSAA render helper -----------------------------------------------------

function canvasTarget(gl: WebGL2RenderingContext): DrawTarget {
  return { fbo: null, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
}

/** Render to canvas, optionally via SSAA 2x FBO. Falls back to direct if FBO unavailable. */
function renderWithSSAA(
  gl: WebGL2RenderingContext,
  ssaaFBO: GPUFramebuffer | null,
  compiled: CompiledRef,
  options: GPURenderOptions,
  vao: WebGLVertexArrayObject | null,
  paletteTexture: WebGLTexture,
  orbit?: OrbitContext
): GPUFramebuffer | null {
  gl.bindVertexArray(vao);
  if (options.ssaa) {
    const fbo = ssaaFBO ? resizeScaledFBO(gl, ssaaFBO, SSAA_SCALE) : createScaledFBO(gl, SSAA_SCALE);
    if (fbo) {
      const target: DrawTarget = { fbo: fbo.fbo, width: fbo.width, height: fbo.height };
      renderToTarget(gl, target, compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring, orbit);
      blitFBOToCanvas(gl, fbo);
      return fbo;
    }
  }
  renderToTarget(gl, canvasTarget(gl), compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring, orbit);
  return ssaaFBO;
}

// ---- Public interface -------------------------------------------------------

export interface ProgressiveController {
  cancelPending(): void;
  renderDirect(compiled: CompiledRef, options: GPURenderOptions, vao: WebGLVertexArrayObject | null, paletteTexture: WebGLTexture, orbit?: OrbitContext): void;
  renderProgressive(compiled: CompiledRef, options: GPURenderOptions, vao: WebGLVertexArrayObject | null, paletteTexture: WebGLTexture, orbit?: OrbitContext): void;
  shouldUseProgressive(maxIterations: number): boolean;
  pollTimerQuery(): void;
  destroy(): void;
  resetState(): void;
}

export function createProgressiveController(
  gl: WebGL2RenderingContext
): ProgressiveController {
  let previewFBO: GPUFramebuffer | null = null;
  let ssaaFBO: GPUFramebuffer | null = null;
  let pendingFullResRAF: number | null = null;
  const tq = createTimerQueryState(gl);

  return {
    cancelPending(): void {
      if (pendingFullResRAF !== null) {
        cancelAnimationFrame(pendingFullResRAF);
        pendingFullResRAF = null;
      }
    },

    pollTimerQuery: () => pollTimer(gl, tq),

    shouldUseProgressive(maxIterations: number): boolean {
      return needsProgressiveRender(maxIterations, tq.lastGpuTimeMs);
    },

    renderDirect(compiled, options, vao, paletteTexture, orbit): void {
      beginTimerQuery(gl, tq);
      ssaaFBO = renderWithSSAA(gl, ssaaFBO, compiled, options, vao, paletteTexture, orbit);
      endTimerQuery(gl, tq);
    },

    renderProgressive(compiled, options, vao, paletteTexture, orbit): void {
      previewFBO = previewFBO ? resizeScaledFBO(gl, previewFBO, PREVIEW_SCALE) : createScaledFBO(gl, PREVIEW_SCALE);
      gl.bindVertexArray(vao);
      if (previewFBO) {
        const target: DrawTarget = { fbo: previewFBO.fbo, width: previewFBO.width, height: previewFBO.height };
        renderToTarget(gl, target, compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring, orbit);
        blitFBOToCanvas(gl, previewFBO);
      } else {
        renderToTarget(gl, canvasTarget(gl), compiled, options.viewport, paletteTexture, options.fractalParams, options.interiorColoring, orbit);
      }
      pendingFullResRAF = requestAnimationFrame(() => {
        pendingFullResRAF = null;
        beginTimerQuery(gl, tq);
        ssaaFBO = renderWithSSAA(gl, ssaaFBO, compiled, options, vao, paletteTexture, orbit);
        endTimerQuery(gl, tq);
      });
    },

    destroy(): void {
      this.cancelPending();
      destroyTimerQuery(gl, tq);
      if (previewFBO) destroyFBO(gl, previewFBO);
      if (ssaaFBO) destroyFBO(gl, ssaaFBO);
    },

    resetState(): void {
      tq.lastGpuTimeMs = 0;
      destroyTimerQuery(gl, tq);
      previewFBO = null;
      ssaaFBO = null;
    }
  };
}
