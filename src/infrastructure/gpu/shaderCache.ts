/**
 * Shader compilation cache and async poll.
 * WebGL-dependent (not testable in Node).
 * Assembly logic lives in shaderCompiler.ts (pure, testable).
 */

import type { FractalType, ColoringMode, PrecisionMode } from '../../domain/types';
import { assembleFragmentSource } from './shaderCompiler';
import { fullscreenVert } from './shaders';
import { UNIFORM_NAMES } from './shaderCompiler';

// ---- Types ------------------------------------------------------------------

type ShaderKey = `${FractalType}_${ColoringMode}_${boolean}_${PrecisionMode}`;

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

// ---- Module-level caches ----------------------------------------------------

const cache = new Map<ShaderKey, CompiledProgram>();
const pendingCompiles: PendingCompile[] = [];
let parallelExt: KHR_parallel_shader_compile | null = null;

// ---- Internal helpers -------------------------------------------------------

function makeShaderKey(
  fractal: FractalType,
  coloring: ColoringMode,
  interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle'
): ShaderKey {
  // maxIter removed — now a uniform, not a #define. One shader per fractal/coloring/precision.
  return `${fractal}_${coloring}_${interiorColoring}_${precision}`;
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

function cleanupShaders(
  gl: WebGL2RenderingContext,
  pending: PendingCompile
): void {
  gl.deleteShader(pending.vertShader);
  gl.deleteShader(pending.fragShader);
}

function finalizePending(
  gl: WebGL2RenderingContext,
  pending: PendingCompile
): boolean {
  const linked = gl.getProgramParameter(
    pending.program, gl.LINK_STATUS
  ) as boolean;

  if (!linked) {
    const fragLog = gl.getShaderInfoLog(pending.fragShader) ?? '';
    const log = gl.getProgramInfoLog(pending.program) ?? 'unknown error';
    console.error(`Shader link failed [${pending.key}]: ${log} | frag: ${fragLog}`);
    gl.deleteProgram(pending.program);
    cleanupShaders(gl, pending);
    return false;
  }

  cleanupShaders(gl, pending);
  const locations = cacheUniformLocations(gl, pending.program);
  cache.set(pending.key, { program: pending.program, uniformLocations: locations });
  return true;
}

// ---- Public API -------------------------------------------------------------

/** Initialize compiler state. Call once after GL context creation. */
export function initCompiler(gl: WebGL2RenderingContext): void {
  parallelExt = gl.getExtension('KHR_parallel_shader_compile');
  cache.clear();
  pendingCompiles.length = 0;
}

/**
 * Get a compiled program from cache, or start async compilation.
 * Returns null while compilation is pending.
 */
export function getOrCompile(
  gl: WebGL2RenderingContext,
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number,
  interiorColoring: boolean = false,
  precision: PrecisionMode = 'doubleSingle'
): CompiledProgram | null {
  const key = makeShaderKey(fractal, coloring, interiorColoring, precision);
  const existing = cache.get(key);
  if (existing) return existing;

  if (pendingCompiles.some(p => p.key === key)) return null;

  // maxIter still passed to assembler for non-MAX_ITER defines, but no longer in cache key
  const fragSource = assembleFragmentSource(fractal, coloring, maxIter, interiorColoring, precision);
  if (!fragSource) return null;

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
      : true;

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
