/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - Shader Compiler
 * Assembly (pure, testable) + Compilation & Cache (WebGL, runtime-only)
 * ===============================================================================
 */

import type { FractalType, ColoringMode } from '../../domain/types';
import { COLOR_CYCLE_PERIOD } from '../../domain/coloringModes';
import {
  fullscreenVert,
  headerChunk, screenToComplexChunk, smoothEscapeChunk,
  paletteLookupChunk, accumulatorNoopChunk,
  mandelbrotIterationChunk, classicColoringChunk, mainChunk
} from './shaders';

// ---- Types ------------------------------------------------------------------

type ShaderKey = `${FractalType}_${ColoringMode}_${number}`;

interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
}

interface PendingCompile {
  program: WebGLProgram;
  vertShader: WebGLShader;
  fragShader: WebGLShader;
  key: ShaderKey;
}

// ---- Supported shader sets --------------------------------------------------

const ITERATION_CHUNKS: Partial<Record<FractalType, string>> = {
  mandelbrot: mandelbrotIterationChunk
};

const ACCUMULATOR_CHUNKS: Partial<Record<ColoringMode, string>> = {
  classic: accumulatorNoopChunk
};

const COLORING_CHUNKS: Partial<Record<ColoringMode, string>> = {
  classic: classicColoringChunk
};

// ---- Uniform names to cache -------------------------------------------------

const UNIFORM_NAMES = ['u_center', 'u_scale', 'u_resolution', 'u_palette'];

// ---- Assembly (pure, testable) ----------------------------------------------

function buildDefines(maxIter: number): string {
  return [
    `#define MAX_ITER ${maxIter}`,
    `#define COLOR_CYCLE_PERIOD ${COLOR_CYCLE_PERIOD}.0`
  ].join('\n');
}

function getIterationChunk(fractal: FractalType): string {
  const chunk = ITERATION_CHUNKS[fractal];
  if (!chunk) {
    throw new Error(`No GPU shader for fractal: ${fractal}`);
  }
  return chunk;
}

function getAccumulatorChunk(coloring: ColoringMode): string {
  const chunk = ACCUMULATOR_CHUNKS[coloring];
  if (!chunk) {
    throw new Error(`No GPU shader for coloring: ${coloring}`);
  }
  return chunk;
}

function getColoringChunk(coloring: ColoringMode): string {
  const chunk = COLORING_CHUNKS[coloring];
  if (!chunk) {
    throw new Error(`No GPU shader for coloring: ${coloring}`);
  }
  return chunk;
}

/**
 * Assemble a complete fragment shader source from chunks.
 * Pure function — no WebGL dependency, fully testable.
 */
export function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): string {
  const iteration = getIterationChunk(fractal);
  const accumulator = getAccumulatorChunk(coloring);
  const coloringChunk = getColoringChunk(coloring);

  return [
    headerChunk,
    buildDefines(maxIter),
    screenToComplexChunk,
    smoothEscapeChunk,
    paletteLookupChunk,
    accumulator,
    iteration,
    coloringChunk,
    mainChunk
  ].join('\n');
}

// ---- Module-level caches (design debt acknowledged for v1) ------------------

const cache = new Map<ShaderKey, CompiledProgram>();
const pendingCompiles: PendingCompile[] = [];
let parallelExt: KHR_parallel_shader_compile | null = null;

// ---- Compilation (WebGL, not testable in Node) ------------------------------

/** Initialize compiler state. Call once after GL context creation. */
export function initCompiler(gl: WebGL2RenderingContext): void {
  parallelExt = gl.getExtension('KHR_parallel_shader_compile');
  cache.clear();
  pendingCompiles.length = 0;
}

function makeShaderKey(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): ShaderKey {
  return `${fractal}_${coloring}_${maxIter}`;
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function createProgramFromShaders(
  gl: WebGL2RenderingContext,
  vert: WebGLShader,
  frag: WebGLShader
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  return program;
}

function cacheUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): Map<string, WebGLUniformLocation> {
  const locations = new Map<string, WebGLUniformLocation>();
  for (const name of UNIFORM_NAMES) {
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) {
      locations.set(name, loc);
    }
  }
  return locations;
}

function finalizePending(
  gl: WebGL2RenderingContext,
  pending: PendingCompile
): boolean {
  const linked = gl.getProgramParameter(
    pending.program, gl.LINK_STATUS
  ) as boolean;

  if (!linked) {
    const log = gl.getProgramInfoLog(pending.program) ?? 'unknown error';
    console.error(`Shader link failed [${pending.key}]: ${log}`);
    gl.deleteProgram(pending.program);
    cleanupShaders(gl, pending);
    return false;
  }

  cleanupShaders(gl, pending);
  const locations = cacheUniformLocations(gl, pending.program);
  cache.set(pending.key, { program: pending.program, uniformLocations: locations });
  return true;
}

function cleanupShaders(
  gl: WebGL2RenderingContext,
  pending: PendingCompile
): void {
  gl.deleteShader(pending.vertShader);
  gl.deleteShader(pending.fragShader);
}

/**
 * Get a compiled program from cache, or start async compilation.
 * Returns null while compilation is pending.
 */
export function getOrCompile(
  gl: WebGL2RenderingContext,
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): CompiledProgram | null {
  const key = makeShaderKey(fractal, coloring, maxIter);
  const existing = cache.get(key);
  if (existing) return existing;

  // Already pending — don't double-submit
  if (pendingCompiles.some(p => p.key === key)) return null;

  const fragSource = assembleFragmentSource(fractal, coloring, maxIter);
  const vert = createShader(gl, gl.VERTEX_SHADER, fullscreenVert);
  const frag = createShader(gl, gl.FRAGMENT_SHADER, fragSource);
  if (!vert || !frag) return null;

  const program = createProgramFromShaders(gl, vert, frag);
  if (!program) return null;

  pendingCompiles.push({ program, vertShader: vert, fragShader: frag, key });
  return null;
}

/** Poll pending shader compilations. Call from requestAnimationFrame. */
export function pollCompilation(gl: WebGL2RenderingContext): void {
  const COMPLETION_STATUS = 0x91B1; // GL_COMPLETION_STATUS_KHR

  for (let i = pendingCompiles.length - 1; i >= 0; i--) {
    const pending = pendingCompiles[i];
    if (!pending) continue;

    const ready = parallelExt
      ? (gl.getProgramParameter(pending.program, COMPLETION_STATUS) as boolean)
      : true; // No extension — linkProgram was synchronous

    if (ready) {
      finalizePending(gl, pending);
      pendingCompiles.splice(i, 1);
    }
  }
}

/** Destroy all cached programs and pending compiles. */
export function destroyAllPrograms(gl: WebGL2RenderingContext): void {
  for (const { program } of cache.values()) {
    gl.deleteProgram(program);
  }
  cache.clear();

  for (const pending of pendingCompiles) {
    gl.deleteProgram(pending.program);
    cleanupShaders(gl, pending);
  }
  pendingCompiles.length = 0;
}

/** Check whether any compiled program is available (for isReady()). */
export function hasCompiledProgram(): boolean {
  return cache.size > 0;
}
