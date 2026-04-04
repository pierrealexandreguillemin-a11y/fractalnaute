/**
 * Multi-frame ping-pong FBO management and RAF controller.
 * 4× RGBA32F textures store per-pixel iteration state between GPU batches.
 * Requires EXT_color_buffer_float (checked at creation time).
 *
 * Controller: compiles 10 shader programs (5 batch + 5 resolve) lazily,
 * manages ping-pong FBO pair, runs RAF loop (one batch/frame → resolve → display).
 * @see docs/superpowers/plans/2026-04-02-multiframe-ping-pong.md
 */

import { MULTI_FRAME_BATCH_SIZE } from './rendererTypes';
import type { MultiFrameFBO, CompiledRef, GPURenderOptions } from './rendererTypes';
import type { FractalType, ColoringMode, PrecisionMode, OrbitData } from '../../domain/types';
import type { OrbitContext, OrbitTextureState, BlaTextureState } from './rendererTypes';
import {
  assembleMultiFrameBatchSource, assembleResolveSource,
  assembleMultiFramePerturbationBatchSource, assembleMultiFramePerturbationResolveSource
} from './shaderCompiler';
import { fullscreenVert } from './shaders';
import { setCenterAndScale, setFractalParams } from './uniformBindings';
import { STRIPE_BAILOUT_SQ } from '../../domain/coloringAccumulator';
import { buildOrbitContext, uploadBlaData, buildOrbitWithBla } from './orbitContextBuilder';
import { splitDouble } from './shaders/doubleSingle';

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

// MULTI_FRAME_BATCH_SIZE imported from rendererTypes.ts (single source of truth)

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

  if (!linked) {
    const fragOk = gl.getShaderParameter(frag, gl.COMPILE_STATUS) as boolean;
    const vertOk = gl.getShaderParameter(vert, gl.COMPILE_STATUS) as boolean;
    console.error(`[multiFrame] link failed: vert=${String(vertOk)} frag=${String(fragOk)}`);
    if (!fragOk) console.error(`[multiFrame] frag: ${gl.getShaderInfoLog(frag) ?? ''}`);
    if (!vertOk) console.error(`[multiFrame] vert: ${gl.getShaderInfoLog(vert) ?? ''}`);
    console.error(`[multiFrame] program: ${gl.getProgramInfoLog(program) ?? ''}`);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    gl.deleteProgram(program);
    return null;
  }

  gl.deleteShader(vert);
  gl.deleteShader(frag);

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

/** Draw one batch: read from readFBO, write MULTI_FRAME_BATCH_SIZE iterations into writeFBO. */
function renderBatch(
  gl: WebGL2RenderingContext,
  prog: CompiledRef,
  readFBO: MultiFrameFBO,
  writeFBO: MultiFrameFBO,
  options: GPURenderOptions,
  vao: WebGLVertexArrayObject | null,
  orbit?: OrbitContext
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, writeFBO.fbo);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
  gl.viewport(0, 0, writeFBO.width, writeFBO.height);
  gl.useProgram(prog.program);

  bindPrevTextures(gl, prog.uniformLocations, readFBO);
  setBatchUniforms(gl, prog.uniformLocations, writeFBO, options, orbit);
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
  options: GPURenderOptions,
  orbit?: OrbitContext
): void {
  const resLoc = locations.get('u_resolution');
  if (resLoc) gl.uniform2f(resLoc, writeFBO.width, writeFBO.height);
  const maxLoc = locations.get('u_totalMaxIter');
  if (maxLoc) gl.uniform1i(maxLoc, options.maxIterations);
  const bailout = options.coloringMode === 'stripe' ? STRIPE_BAILOUT_SQ : DEFAULT_BAILOUT_SQ;
  const bailLoc = locations.get('u_bailoutSq');
  if (bailLoc) gl.uniform1f(bailLoc, bailout);
  if (orbit) bindOrbitForBatch(gl, locations, orbit);
}

/**
 * Bind orbit texture and perturbation uniforms for multi-frame batch.
 * Orbit texture goes on TEXTURE4 (TEXTURE0-3 are prev state textures).
 * @mirror uniformBindings.ts:setOrbitUniforms — same uniforms, different texture unit.
 */
function bindOrbitForBatch(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  orbit: OrbitContext
): void {
  const loc = (name: string) => locations.get(name);

  const orbitTexLoc = loc('u_orbitTexture');
  if (orbitTexLoc) {
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, orbit.orbitTexture);
    gl.uniform1i(orbitTexLoc, 4);
  }

  const lenLoc = loc('u_orbitLength');
  if (lenLoc) gl.uniform1i(lenLoc, orbit.orbitData.length);
  const texSizeLoc = loc('u_orbitTexSize');
  if (texSizeLoc) gl.uniform2f(texSizeLoc, orbit.orbitTexWidth, orbit.orbitTexHeight);

  const refLoc = loc('u_refPoint');
  if (refLoc) {
    const [reHi] = splitDouble(orbit.orbitData.refPointRe);
    const [imHi] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refLoc, reHi, imHi);
  }
  const refLoLoc = loc('u_refPointLo');
  if (refLoLoc) {
    const [, reLo] = splitDouble(orbit.orbitData.refPointRe);
    const [, imLo] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refLoLoc, reLo, imLo);
  }

  const rescaleLoc = loc('u_rescaleS');
  if (rescaleLoc) gl.uniform1f(rescaleLoc, orbit.rescaleS);
}

/** Resolve final state into a visible color on the canvas (null FBO). */
function renderResolve(
  gl: WebGL2RenderingContext,
  prog: CompiledRef,
  stateFBO: MultiFrameFBO,
  paletteTexture: WebGLTexture,
  interiorColoring: boolean,
  vao: WebGLVertexArrayObject | null,
  rescaleS?: number
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

  if (rescaleS !== undefined) {
    const rescaleLoc = prog.uniformLocations.get('u_rescaleS');
    if (rescaleLoc) gl.uniform1f(rescaleLoc, rescaleS);
  }

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
 * T_Hist.w = 0.0 → refIter=0 init (correct for both DS and perturbation modes).
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

/** Get or compile a perturbation batch program. Key prefix avoids cache collisions with DS. */
function getOrCompilePerturbBatch(
  gl: WebGL2RenderingContext,
  cache: Map<string, CompiledRef>,
  fractal: FractalType,
  coloring: ColoringMode,
  interiorColoring: boolean
): CompiledRef | null {
  const key = `perturb_${batchKey(fractal, coloring)}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const source = assembleMultiFramePerturbationBatchSource(fractal, coloring, interiorColoring);
  if (!source) return null;

  const compiled = compileMfProgram(gl, source);
  if (!compiled) return null;

  cache.set(key, compiled);
  return compiled;
}

/** Get or compile a perturbation resolve program. Key prefix avoids cache collisions. */
function getOrCompilePerturbResolve(
  gl: WebGL2RenderingContext,
  cache: Map<string, CompiledRef>,
  coloring: ColoringMode,
  interiorColoring: boolean
): CompiledRef | null {
  const key = `perturb_${coloring}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const source = assembleMultiFramePerturbationResolveSource(coloring, interiorColoring);
  if (!source) return null;

  const compiled = compileMfProgram(gl, source);
  if (!compiled) return null;

  cache.set(key, compiled);
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
    onComplete?: (renderTimeMs: number) => void,
    orbitData?: OrbitData,
    precision?: PrecisionMode
  ): (() => void) | null;
  destroy(): void;
}

/** Compile batch + resolve programs for the given precision mode. */
function compilePrograms(
  gl: WebGL2RenderingContext,
  batchCache: Map<string, CompiledRef>,
  resolveCache: Map<string, CompiledRef>,
  options: GPURenderOptions,
  isPerturbation: boolean
): { batchProg: CompiledRef; resolveProg: CompiledRef } | null {
  const { fractalType, coloringMode, interiorColoring } = options;
  const batchProg = isPerturbation
    ? getOrCompilePerturbBatch(gl, batchCache, fractalType, coloringMode, interiorColoring)
    : getOrCompileBatch(gl, batchCache, fractalType, coloringMode, interiorColoring);
  const resolveProg = isPerturbation
    ? getOrCompilePerturbResolve(gl, resolveCache, coloringMode, interiorColoring)
    : getOrCompileResolve(gl, resolveCache, coloringMode, interiorColoring);
  if (!batchProg || !resolveProg) return null;
  return { batchProg, resolveProg };
}

/** Build orbit context from OrbitData, uploading textures to GPU. */
function buildMfOrbitContext(
  gl: WebGL2RenderingContext,
  orbitState: OrbitTextureState,
  blaState: BlaTextureState,
  orbitData: OrbitData
): OrbitContext | null {
  const ctx = buildOrbitContext(gl, orbitState, orbitData);
  if (!ctx) return null;
  uploadBlaData(gl, blaState, orbitData);
  return buildOrbitWithBla(ctx, blaState, orbitData);
}

/** Run the ping-pong RAF loop. Returns a cancel function. */
function runRafLoop(
  gl: WebGL2RenderingContext,
  fbos: { a: MultiFrameFBO; b: MultiFrameFBO },
  batchProg: CompiledRef,
  resolveProg: CompiledRef,
  options: GPURenderOptions,
  vao: WebGLVertexArrayObject | null,
  paletteTexture: WebGLTexture,
  orbit: OrbitContext | undefined,
  onBatchProgress?: (batch: number, total: number) => void,
  onComplete?: (renderTimeMs: number) => void
): { cancel: () => void; setRaf: (id: number | null) => void } {
  const totalBatches = Math.ceil(options.maxIterations / MULTI_FRAME_BATCH_SIZE);
  const rescaleS = orbit?.rescaleS;
  let idx = 0;
  let stale = false;
  let rafId: number | null = null;
  const t0 = performance.now();

  const step = () => {
    if (stale || idx >= totalBatches) {
      if (!stale) onComplete?.(performance.now() - t0);
      rafId = null;
      return;
    }
    const rd = idx % 2 === 0 ? fbos.a : fbos.b;
    const wr = idx % 2 === 0 ? fbos.b : fbos.a;
    renderBatch(gl, batchProg, rd, wr, options, vao, orbit);
    renderResolve(gl, resolveProg, wr, paletteTexture, options.interiorColoring, vao, rescaleS);
    idx++;
    onBatchProgress?.(idx, totalBatches);
    rafId = requestAnimationFrame(step);
  };

  rafId = requestAnimationFrame(step);
  const cancel = () => { stale = true; if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } };
  return { cancel, setRaf: (id) => { rafId = id; } };
}

/**
 * Factory: creates a multi-frame ping-pong controller.
 * Compiles programs lazily, manages FBO pair,
 * runs RAF loop with cancellation support.
 * Supports both DS and perturbation precision modes.
 */
export function createMultiFrameController(
  gl: WebGL2RenderingContext
): MultiFrameController | null {
  const batchCache = new Map<string, CompiledRef>();
  const resolveCache = new Map<string, CompiledRef>();
  const fbos: { a: MultiFrameFBO | null; b: MultiFrameFBO | null } = { a: null, b: null };
  const orbitState: OrbitTextureState = { texture: null, width: 0, height: 0 };
  const blaState: BlaTextureState = { texture: null, width: 0, height: 0 };
  let pendingCancel: (() => void) | null = null;

  return {
    start(options, vao, paletteTexture, onBatchProgress, onComplete, orbitData, precision) {
      if (pendingCancel) { pendingCancel(); pendingCancel = null; }

      const isPerturbation = precision === 'perturbation';
      const progs = compilePrograms(gl, batchCache, resolveCache, options, isPerturbation);
      if (!progs) return null;

      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (!ensureFbos(gl, fbos, w, h)) return null;

      clearMrtFbo(gl, fbos.a!);
      clearMrtFbo(gl, fbos.b!);

      let orbit: OrbitContext | undefined;
      if (isPerturbation && orbitData) {
        const ctx = buildMfOrbitContext(gl, orbitState, blaState, orbitData);
        if (!ctx) return null;
        orbit = ctx;
      }

      const loop = runRafLoop(
        gl, { a: fbos.a!, b: fbos.b! },
        progs.batchProg, progs.resolveProg,
        options, vao, paletteTexture, orbit,
        onBatchProgress, onComplete
      );
      pendingCancel = loop.cancel;
      return loop.cancel;
    },

    destroy() {
      if (pendingCancel) { pendingCancel(); pendingCancel = null; }
      if (fbos.a) { destroyMultiFrameFBO(gl, fbos.a); fbos.a = null; }
      if (fbos.b) { destroyMultiFrameFBO(gl, fbos.b); fbos.b = null; }
      destroyCaches(gl, batchCache, resolveCache);
    }
  };
}
