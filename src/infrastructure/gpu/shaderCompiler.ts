/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - Shader Compiler
 * Assembly (pure, testable) + Compilation & Cache (WebGL, runtime-only)
 * ===============================================================================
 */

import type { FractalType, ColoringMode, PrecisionMode } from '../../domain/types';
import {
  COLOR_CYCLE_PERIOD, ORBIT_TRAP_CYCLE,
  NORMAL_MAP_LIGHT_ANGLE, INTERIOR_ATTENUATION
} from '../../domain/coloringModes';
import { STRIPE_BAILOUT_SQ } from '../../domain/coloringAccumulator';
import {
  fullscreenVert,
  headerChunk, screenToComplexChunk, smoothEscapeChunk,
  paletteLookupChunk, cosinePaletteLookupChunk,
  accumulatorNoopChunk, accumulatorRealChunk,
  mandelbrotIterationChunk, mandelbrotDSIterationChunk,
  juliaIterationChunk,
  burningshipIterationChunk, tricornIterationChunk,
  multibrotIterationChunk,
  classicColoringChunk, stripeColoringChunk,
  decompositionColoringChunk, orbitTrapColoringChunk,
  normalMapColoringChunk,
  mainChunk
} from './shaders';
import {
  doubleSingleChunk, dsHeaderChunk, screenToComplexDSChunk, DS_UNIFORM_NAMES
} from './shaders/doubleSingle';
import {
  perturbationHeaderChunk, orbitLookupChunk,
  mandelbrotPerturbationChunk, juliaPerturbationChunk,
  PERTURBATION_UNIFORM_NAMES
} from './shaders/perturbation';
import { blaHeaderChunk, blaLookupChunk, BLA_UNIFORM_NAMES } from './shaders/bla';

// ---- Types ------------------------------------------------------------------

type ShaderKey = `${FractalType}_${ColoringMode}_${number}_${boolean}_${PrecisionMode}`;

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
  mandelbrot: mandelbrotIterationChunk,
  julia: juliaIterationChunk,
  burningship: burningshipIterationChunk,
  tricorn: tricornIterationChunk,
  multibrot3: multibrotIterationChunk,
};

// Accumulator selection is now inline in assembleFragmentSource
// based on coloring mode AND interiorColoring flag.
// @mirror renderBand.ts:needsAccum — same logic: coloring !== 'classic' || interiorColoring

const COLORING_CHUNKS: Partial<Record<ColoringMode, string>> = {
  classic: classicColoringChunk,
  stripe: stripeColoringChunk,
  decomposition: decompositionColoringChunk,
  orbitTrap: orbitTrapColoringChunk,
  normalMap: normalMapColoringChunk,
};

// ---- Uniform names to cache -------------------------------------------------

const UNIFORM_NAMES = [
  'u_center', 'u_scale', 'u_resolution', 'u_palette',
  'u_juliaRe', 'u_juliaIm', 'u_power', 'u_interiorColoring',
  ...DS_UNIFORM_NAMES,
  ...PERTURBATION_UNIFORM_NAMES,
  ...BLA_UNIFORM_NAMES,
  'u_blaLevelOffsets[0]'
];

// ---- Assembly (pure, testable) ----------------------------------------------

function buildDefines(maxIter: number, needsHighBailout: boolean): string {
  return [
    `#define MAX_ITER ${maxIter}`,
    `#define COLOR_CYCLE_PERIOD ${COLOR_CYCLE_PERIOD}.0`,
    `#define BAILOUT_SQ ${needsHighBailout ? STRIPE_BAILOUT_SQ : '4.0'}`,
    `#define ORBIT_TRAP_CYCLE ${ORBIT_TRAP_CYCLE}.0`,
    `#define NORMAL_MAP_LIGHT_ANGLE (${NORMAL_MAP_LIGHT_ANGLE})`,
    `#define INTERIOR_ATTENUATION ${INTERIOR_ATTENUATION}`
  ].join('\n');
}

function getIterationChunk(fractal: FractalType): string | null {
  return ITERATION_CHUNKS[fractal] ?? null;
}

function getColoringChunk(coloring: ColoringMode): string | null {
  return COLORING_CHUNKS[coloring] ?? null;
}

/** Check if a fractal+coloring combination has GPU support. */
export function isGpuSupported(
  fractal: FractalType, coloring: ColoringMode,
  precision: PrecisionMode = 'doubleSingle'
): boolean {
  if (precision === 'perturbation') {
    return (fractal === 'mandelbrot' || fractal === 'julia')
      && getColoringChunk(coloring) !== null;
  }
  // Mandelbrot uses DS iteration (not in ITERATION_CHUNKS)
  const hasIteration = fractal === 'mandelbrot' || getIterationChunk(fractal) !== null;
  return hasIteration && getColoringChunk(coloring) !== null;
}

/** Resolve common shader ingredients from coloring mode. */
function resolveCommonChunks(coloring: ColoringMode, interiorColoring: boolean) {
  const coloringChunk = getColoringChunk(coloring);
  if (!coloringChunk) return null;
  const needsRealAccum = coloring !== 'classic' || interiorColoring;
  const accumulator = needsRealAccum ? accumulatorRealChunk : accumulatorNoopChunk;
  const isStripe = coloring === 'stripe';
  const paletteChunk = isStripe ? cosinePaletteLookupChunk : paletteLookupChunk;
  return { coloringChunk, accumulator, paletteChunk, isStripe };
}

const PERTURBATION_CHUNKS: Partial<Record<FractalType, string>> = {
  mandelbrot: mandelbrotPerturbationChunk,
  julia: juliaPerturbationChunk,
};

/** @tradeoff BLA disabled for stripe/orbitTrap/normalMap (need per-iteration accumulators) */
const BLA_ELIGIBLE_MODES = new Set<ColoringMode>(['classic', 'decomposition']);

/** Assemble perturbation fragment shader. */
function assemblePerturbationSource(
  fractal: FractalType, coloring: ColoringMode,
  maxIter: number, common: NonNullable<ReturnType<typeof resolveCommonChunks>>
): string | null {
  const iteration = PERTURBATION_CHUNKS[fractal] ?? null;
  if (!iteration) return null;

  const useBla = BLA_ELIGIBLE_MODES.has(coloring);
  const blaDefine = useBla ? '#define USE_BLA\n' : '';
  const defines = buildDefines(maxIter, common.isStripe);

  // GLSL declaration order: tryBlaSkip() calls getOrbitData() + smoothEscape(),
  // so blaLookupChunk must come AFTER orbitLookupChunk + smoothEscapeChunk.
  return [
    headerChunk, perturbationHeaderChunk, dsHeaderChunk, defines, blaDefine,
    ...(useBla ? [blaHeaderChunk] : []),
    doubleSingleChunk, screenToComplexDSChunk, screenToComplexChunk,
    smoothEscapeChunk, common.paletteChunk, common.accumulator,
    orbitLookupChunk, ...(useBla ? [blaLookupChunk] : []),
    iteration, common.coloringChunk, mainChunk
  ].join('\n');
}

/**
 * Assemble a complete fragment shader source from chunks.
 * Pure function — no WebGL dependency, fully testable.
 */
export function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number,
  interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle'
): string | null {
  const common = resolveCommonChunks(coloring, interiorColoring);
  if (!common) return null;

  if (precision === 'perturbation') {
    return assemblePerturbationSource(fractal, coloring, maxIter, common);
  }

  const defines = buildDefines(maxIter, common.isStripe);
  const useDS = fractal === 'mandelbrot';
  const iteration = useDS ? mandelbrotDSIterationChunk : getIterationChunk(fractal);
  if (!iteration) return null;

  return [
    headerChunk,
    ...(useDS ? [dsHeaderChunk, defines, doubleSingleChunk, screenToComplexDSChunk] : [defines]),
    screenToComplexChunk, smoothEscapeChunk, common.paletteChunk,
    common.accumulator, iteration, common.coloringChunk, mainChunk
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
  maxIter: number,
  interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle'
): ShaderKey {
  return `${fractal}_${coloring}_${maxIter}_${interiorColoring}_${precision}`;
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
  maxIter: number,
  interiorColoring: boolean = false,
  precision: PrecisionMode = 'doubleSingle'
): CompiledProgram | null {
  const key = makeShaderKey(fractal, coloring, maxIter, interiorColoring, precision);
  const existing = cache.get(key);
  if (existing) return existing;

  // Already pending — don't double-submit
  if (pendingCompiles.some(p => p.key === key)) return null;

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
