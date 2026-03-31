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

export const UNIFORM_NAMES = [
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

