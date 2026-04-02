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
import {
  multiFrameBatchHeaderChunk, multiFrameDSHeaderChunk,
  multiFrameJuliaHeaderChunk, multiFrameMultibrotHeaderChunk,
  mandelbrotDSBatchChunk, juliaBatchChunk,
  burningshipBatchChunk, tricornBatchChunk, multibrotBatchChunk,
  resolveHeaderChunk, RESOLVE_DEFINES,
  resolveClassicChunk, resolveStripeChunk,
  resolveDecompositionChunk, resolveOrbitTrapChunk, resolveNormalMapChunk,
} from './shaders/multiFrame';

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

// ---- Iteration bucket tiers -------------------------------------------------

/** Fixed set of MAX_ITER values to limit shader recompilations.
 * 8 tiers → at most 8 compiled variants per fractal/coloring/precision combo.
 * @tradeoff Some wasted iterations (e.g. 3000 requested → 4096 compiled)
 * vs. reliable cross-driver behavior (uniform int break was broken on AMD ANGLE). */
const ITER_BUCKETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768] as const;

/** Round up maxIter to the next bucket tier. */
export function bucketMaxIter(maxIter: number): number {
  for (const bucket of ITER_BUCKETS) {
    if (maxIter <= bucket) return bucket;
  }
  return 32768;
}

// ---- Uniform names to cache -------------------------------------------------

export const UNIFORM_NAMES = [
  'u_center', 'u_scale', 'u_resolution', 'u_palette',
  'u_juliaRe', 'u_juliaIm', 'u_power', 'u_interiorColoring',
  ...DS_UNIFORM_NAMES,
  ...PERTURBATION_UNIFORM_NAMES,
  ...BLA_UNIFORM_NAMES,
  'u_blaLevelOffsets[0]'
];

// ---- Assembly (pure, testable) ----------------------------------------------

function buildDefines(needsHighBailout: boolean, maxIter: number): string {
  return [
    `#define MAX_ITER ${maxIter}`,
    `#define COLOR_CYCLE_PERIOD ${COLOR_CYCLE_PERIOD}.0`,
    `#define BAILOUT_SQ ${needsHighBailout ? STRIPE_BAILOUT_SQ.toFixed(1) : '4.0'}`,
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

  const blaDisabledByUrl = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bla') === '0';
  const useBla = BLA_ELIGIBLE_MODES.has(coloring) && !blaDisabledByUrl;
  const blaDefine = useBla ? '#define USE_BLA\n' : '';
  const defines = buildDefines(common.isStripe, maxIter);

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

  const defines = buildDefines(common.isStripe, maxIter);
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

// ---- Multi-frame batch/resolve assembly ------------------------------------

const BATCH_DEFINE = '#define BATCH_SIZE 256';

const MULTI_FRAME_BATCH_CHUNKS: Partial<Record<FractalType, string>> = {
  mandelbrot: mandelbrotDSBatchChunk,
  julia: juliaBatchChunk,
  burningship: burningshipBatchChunk,
  tricorn: tricornBatchChunk,
  multibrot3: multibrotBatchChunk,
};

const MULTI_FRAME_RESOLVE_CHUNKS: Partial<Record<ColoringMode, string>> = {
  classic: resolveClassicChunk,
  stripe: resolveStripeChunk,
  decomposition: resolveDecompositionChunk,
  orbitTrap: resolveOrbitTrapChunk,
  normalMap: resolveNormalMapChunk,
};

/** Return fractal-specific header extensions for multi-frame batch. */
function getBatchHeaderExtensions(fractal: FractalType): string[] {
  if (fractal === 'mandelbrot') {
    return [multiFrameDSHeaderChunk, dsHeaderChunk, doubleSingleChunk, screenToComplexDSChunk];
  }
  if (fractal === 'julia') return [multiFrameJuliaHeaderChunk];
  if (fractal === 'multibrot3') return [multiFrameMultibrotHeaderChunk];
  return [];
}

/**
 * Assemble a multi-frame batch fragment shader.
 * Renders BATCH_SIZE iterations per frame, writing state to 4 MRT outputs.
 * Pure function — no WebGL dependency, fully testable.
 */
export function assembleMultiFrameBatchSource(
  fractal: FractalType,
  _coloring: ColoringMode,
  _interiorColoring: boolean
): string | null {
  const batchMain = MULTI_FRAME_BATCH_CHUNKS[fractal] ?? null;
  if (!batchMain) return null;

  const extensions = getBatchHeaderExtensions(fractal);
  return [
    multiFrameBatchHeaderChunk,
    BATCH_DEFINE,
    ...extensions,
    batchMain,
  ].join('\n');
}

/**
 * Assemble a resolve fragment shader that maps final iteration state to color.
 * Reads from 4 state textures (batch output) and writes to fragColor.
 * Pure function — no WebGL dependency, fully testable.
 */
export function assembleResolveSource(
  coloring: ColoringMode,
  _interiorColoring: boolean
): string | null {
  const resolveMain = MULTI_FRAME_RESOLVE_CHUNKS[coloring] ?? null;
  if (!resolveMain) return null;

  return [resolveHeaderChunk, RESOLVE_DEFINES, resolveMain].join('\n');
}

