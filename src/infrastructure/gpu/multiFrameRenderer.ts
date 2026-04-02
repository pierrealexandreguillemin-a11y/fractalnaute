/**
 * Multi-frame ping-pong FBO management and RAF controller.
 * 4× RGBA32F textures store per-pixel iteration state between GPU batches.
 * Requires EXT_color_buffer_float (checked at creation time).
 *
 * Controller: compiles 10 shader programs (5 batch + 5 resolve) lazily,
 * manages ping-pong FBO pair, runs RAF loop (one batch/frame → resolve → display).
 * @see docs/superpowers/plans/2026-04-02-multiframe-ping-pong.md
 */

import type { MultiFrameFBO, CompiledRef, GPURenderOptions } from './rendererTypes';
import type { FractalType, ColoringMode } from '../../domain/types';
import { assembleMultiFrameBatchSource, assembleResolveSource } from './shaderCompiler';
import { fullscreenVert } from './shaders';
import { setCenterAndScale, setFractalParams } from './uniformBindings';
import { STRIPE_BAILOUT_SQ } from '../../domain/coloringAccumulator';

/** Create a RGBA32F texture with NEAREST filtering and CLAMP_TO_EDGE wrapping. */
function createFloat32Texture(
  gl: WebGL2RenderingContext, width: number, height: number
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Delete an array of textures that may include null entries (partial creation). */
function deleteTextures(gl: WebGL2RenderingContext, textures: (WebGLTexture | null)[]): void {
  for (const tex of textures) {
    if (tex) gl.deleteTexture(tex);
  }
}

/** Create a 4-MRT FBO for multi-frame state storage. Returns null if unsupported. */
export function createMultiFrameFBO(
  gl: WebGL2RenderingContext, width: number, height: number
): MultiFrameFBO | null {
  // @mirror orbitTexture.ts:12 — EXT_color_buffer_float required for RGBA32F render targets
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) return null;

  const fbo = gl.createFramebuffer();
  if (!fbo) return null;

  const texZ = createFloat32Texture(gl, width, height);
  const texInfo = createFloat32Texture(gl, width, height);
  const texAcc = createFloat32Texture(gl, width, height);
  const texHist = createFloat32Texture(gl, width, height);

  if (!texZ || !texInfo || !texAcc || !texHist) {
    gl.deleteFramebuffer(fbo);
    deleteTextures(gl, [texZ, texInfo, texAcc, texHist]);
    return null;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texZ, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texInfo, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, texAcc, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, texHist, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    deleteTextures(gl, [texZ, texInfo, texAcc, texHist]);
    return null;
  }

  return { fbo, texZ, texInfo, texAcc, texHist, width, height };
}

/** Destroy a multi-frame FBO and all its textures. */
export function destroyMultiFrameFBO(
  gl: WebGL2RenderingContext, mf: MultiFrameFBO
): void {
  deleteTextures(gl, [mf.texZ, mf.texInfo, mf.texAcc, mf.texHist]);
  gl.deleteFramebuffer(mf.fbo);
}

// ---- Shader compilation (module-level) --------------------------------------

/** Iterations per batch frame. totalBatches = ceil(maxIter / BATCH_SIZE). */
const BATCH_SIZE = 256;

/** Default bailout for non-stripe coloring modes. */
const DEFAULT_BAILOUT_SQ = 4.0;

/** Compile a shader program from vertex + fragment source, enumerate all active uniforms. */
function compileMfProgram(
  gl: WebGL2RenderingContext, fragSource: string
): CompiledRef | null {
  const vert = gl.createShader(gl.VERTEX_SHADER);
  const frag = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vert || !frag) return null;

  gl.shaderSource(vert, fullscreenVert);
  gl.compileShader(vert);
  gl.shaderSource(frag, fragSource);
  gl.compileShader(frag);

  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vert); gl.deleteShader(frag); return null; }

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!linked) {
    console.error(`[multiFrame] link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    gl.deleteProgram(program);
    return null;
  }

  return { program, uniformLocations: enumerateUniforms(gl, program) };
}

/** Enumerate all active uniforms into a Map for quick lookup. */
function enumerateUniforms(
  gl: WebGL2RenderingContext, program: WebGLProgram
): Map<string, WebGLUniformLocation> {
  const locations = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const loc = gl.getUniformLocation(program, info.name);
    if (loc) locations.set(info.name, loc);
  }
  return locations;
}

// ---- Render helpers (module-level) ------------------------------------------

/** Draw one batch: read from readFBO, write BATCH_SIZE iterations into writeFBO. */
function renderBatch(
  gl: WebGL2RenderingContext,
  prog: CompiledRef,
  readFBO: MultiFrameFBO,
  writeFBO: MultiFrameFBO,
  options: GPURenderOptions,
  vao: WebGLVertexArrayObject | null
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fbo);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
  gl.viewport(0, 0, writeFBO.width, writeFBO.height);
  gl.useProgram(prog.program);

  bindPrevTextures(gl, prog.uniformLocations, readFBO);
  setBatchUniforms(gl, prog.uniformLocations, writeFBO, options);
  setCenterAndScale(gl, prog.uniformLocations, options.viewport);
  setFractalParams(gl, prog.uniformLocations, options.fractalParams);

  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Bind 4 previous-state textures on TEXTURE0–3. */
function bindPrevTextures(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  readFBO: MultiFrameFBO
): void {
  const textures = [readFBO.texZ, readFBO.texInfo, readFBO.texAcc, readFBO.texHist];
  const samplers = ['u_prevZ', 'u_prevInfo', 'u_prevAcc', 'u_prevHist'];
  for (let i = 0; i < 4; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]!);
    const loc = locations.get(samplers[i]!);
    if (loc) gl.uniform1i(loc, i);
  }
}

/** Set batch-specific uniforms (resolution, maxIter, bailout). */
function setBatchUniforms(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  writeFBO: MultiFrameFBO,
  options: GPURenderOptions
): void {
  const resLoc = locations.get('u_resolution');
  if (resLoc) gl.uniform2f(resLoc, writeFBO.width, writeFBO.height);
  const maxLoc = locations.get('u_totalMaxIter');
  if (maxLoc) gl.uniform1i(maxLoc, options.maxIterations);
  const bailout = options.coloringMode === 'stripe' ? STRIPE_BAILOUT_SQ : DEFAULT_BAILOUT_SQ;
  const bailLoc = locations.get('u_bailoutSq');
  if (bailLoc) gl.uniform1f(bailLoc, bailout);
}

/** Resolve final state into a visible color on the canvas (null FBO). */
function renderResolve(
  gl: WebGL2RenderingContext,
  prog: CompiledRef,
  stateFBO: MultiFrameFBO,
  paletteTexture: WebGLTexture,
  interiorColoring: boolean,
  vao: WebGLVertexArrayObject | null
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.useProgram(prog.program);

  bindStateTextures(gl, prog.uniformLocations, stateFBO);

  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
  const palLoc = prog.uniformLocations.get('u_palette');
  if (palLoc) gl.uniform1i(palLoc, 4);

  const intLoc = prog.uniformLocations.get('u_interiorColoring');
  if (intLoc) gl.uniform1i(intLoc, interiorColoring ? 1 : 0);

  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Bind 4 state textures on TEXTURE0–3 for resolve pass. */
function bindStateTextures(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  stateFBO: MultiFrameFBO
): void {
  const textures = [stateFBO.texZ, stateFBO.texInfo, stateFBO.texAcc, stateFBO.texHist];
  const samplers = ['u_stateZ', 'u_stateInfo', 'u_stateAcc', 'u_stateHist'];
  for (let i = 0; i < 4; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]!);
    const loc = locations.get(samplers[i]!);
    if (loc) gl.uniform1i(loc, i);
  }
}

/**
 * Clear a 4-MRT FBO to initial state.
 * IMPORTANT: T_Acc.w = 1e20 (trapDistSq) — NOT 0.0.
 */
function clearMrtFbo(gl: WebGL2RenderingContext, fbo: MultiFrameFBO): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
  gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
  gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0, 0, 0, 0]));
  gl.clearBufferfv(gl.COLOR, 2, new Float32Array([0, 0, 0, 1e20]));
  gl.clearBufferfv(gl.COLOR, 3, new Float32Array([0, 0, 0, 0]));
}

// ---- Lazy program compilation helpers (module-level) ------------------------

/** Build cache key for batch programs: "fractal_coloring". */
function batchKey(fractal: FractalType, coloring: ColoringMode): string {
  return `${fractal}_${coloring}`;
}

/** Get or compile a batch program for the given fractal/coloring combination. */
function getOrCompileBatch(
  gl: WebGL2RenderingContext,
  cache: Map<string, CompiledRef>,
  fractal: FractalType,
  coloring: ColoringMode,
  interiorColoring: boolean
): CompiledRef | null {
  const key = batchKey(fractal, coloring);
  const existing = cache.get(key);
  if (existing) return existing;

  const source = assembleMultiFrameBatchSource(fractal, coloring, interiorColoring);
  if (!source) return null;

  const compiled = compileMfProgram(gl, source);
  if (!compiled) return null;

  cache.set(key, compiled);
  return compiled;
}

/** Get or compile a resolve program for the given coloring mode. */
function getOrCompileResolve(
  gl: WebGL2RenderingContext,
  cache: Map<string, CompiledRef>,
  coloring: ColoringMode,
  interiorColoring: boolean
): CompiledRef | null {
  const existing = cache.get(coloring);
  if (existing) return existing;

  const source = assembleResolveSource(coloring, interiorColoring);
  if (!source) return null;

  const compiled = compileMfProgram(gl, source);
  if (!compiled) return null;

  cache.set(coloring, compiled);
  return compiled;
}

/** Ensure both FBOs exist and match the given canvas dimensions. */
function ensureFbos(
  gl: WebGL2RenderingContext,
  current: { a: MultiFrameFBO | null; b: MultiFrameFBO | null },
  width: number,
  height: number
): boolean {
  if (current.a && current.a.width === width && current.a.height === height) return true;
  if (current.a) destroyMultiFrameFBO(gl, current.a);
  if (current.b) destroyMultiFrameFBO(gl, current.b);
  current.a = createMultiFrameFBO(gl, width, height);
  current.b = createMultiFrameFBO(gl, width, height);
  return current.a !== null && current.b !== null;
}

/** Delete all cached programs. */
function destroyCaches(
  gl: WebGL2RenderingContext,
  ...caches: Map<string, CompiledRef>[]
): void {
  for (const cache of caches) {
    for (const ref of cache.values()) gl.deleteProgram(ref.program);
    cache.clear();
  }
}

// ---- Public interface -------------------------------------------------------

export interface MultiFrameController {
  start(
    options: GPURenderOptions,
    vao: WebGLVertexArrayObject | null,
    paletteTexture: WebGLTexture,
    onBatchProgress?: (batch: number, total: number) => void,
    onComplete?: (renderTimeMs: number) => void
  ): (() => void) | null;
  destroy(): void;
}

/**
 * Factory: creates a multi-frame ping-pong controller.
 * Compiles 10 programs lazily (5 batch + 5 resolve), manages FBO pair,
 * runs RAF loop with cancellation support.
 */
export function createMultiFrameController(
  gl: WebGL2RenderingContext
): MultiFrameController | null {
  const batchCache = new Map<string, CompiledRef>();
  const resolveCache = new Map<string, CompiledRef>();
  const fbos: { a: MultiFrameFBO | null; b: MultiFrameFBO | null } = { a: null, b: null };
  let pendingRAF: number | null = null;

  return {
    start(options, vao, paletteTexture, onBatchProgress, onComplete) {
      if (pendingRAF !== null) { cancelAnimationFrame(pendingRAF); pendingRAF = null; }

      const batchProg = getOrCompileBatch(
        gl, batchCache, options.fractalType, options.coloringMode, options.interiorColoring
      );
      const resolveProg = getOrCompileResolve(
        gl, resolveCache, options.coloringMode, options.interiorColoring
      );
      if (!batchProg || !resolveProg) return null;

      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (!ensureFbos(gl, fbos, w, h)) return null;

      clearMrtFbo(gl, fbos.a!);
      clearMrtFbo(gl, fbos.b!);

      const totalBatches = Math.ceil(options.maxIterations / BATCH_SIZE);
      let idx = 0;
      let stale = false;
      const t0 = performance.now();

      const step = () => {
        if (stale || idx >= totalBatches) {
          if (!stale) onComplete?.(performance.now() - t0);
          pendingRAF = null;
          return;
        }
        const rd = idx % 2 === 0 ? fbos.a! : fbos.b!;
        const wr = idx % 2 === 0 ? fbos.b! : fbos.a!;
        renderBatch(gl, batchProg, rd, wr, options, vao);
        renderResolve(gl, resolveProg, wr, paletteTexture, options.interiorColoring, vao);
        idx++;
        onBatchProgress?.(idx, totalBatches);
        pendingRAF = requestAnimationFrame(step);
      };

      pendingRAF = requestAnimationFrame(step);
      return () => { stale = true; if (pendingRAF !== null) { cancelAnimationFrame(pendingRAF); pendingRAF = null; } };
    },

    destroy() {
      if (pendingRAF !== null) { cancelAnimationFrame(pendingRAF); pendingRAF = null; }
      if (fbos.a) { destroyMultiFrameFBO(gl, fbos.a); fbos.a = null; }
      if (fbos.b) { destroyMultiFrameFBO(gl, fbos.b); fbos.b = null; }
      destroyCaches(gl, batchCache, resolveCache);
    }
  };
}
