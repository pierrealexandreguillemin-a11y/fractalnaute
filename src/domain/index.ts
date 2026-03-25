/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Public API
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Types
export type {
  Complex,
  FractalResult,
  Viewport,
  RGB,
  OKLCH,
  FractalType,
  PaletteName,
  ThemeName,
  FractalParams,
  FractalTypeConfig,
  JuliaPreset,
  RenderStats,
  RenderBackend
} from './types';

export { DEFAULT_JULIA_PARAMS, JULIA_PRESETS, INTERIOR_COLORING_DEFAULTS } from './types';

export type { ColoringMode } from './types';

export {
  initAccumulator,
  updateAccumulator,
  finalizeEscape,
  finalizeInterior
} from './coloringAccumulator';

export {
  mapToColorParam,
  mapInteriorToParam,
  computeNormalLightness,
  getColorForResult,
  COLORING_MODE_LABELS,
  COLORING_MODES,
  COLOR_CYCLE_PERIOD,
  ORBIT_TRAP_CYCLE,
  NORMAL_MAP_LIGHT_ANGLE,
  INTERIOR_ATTENUATION
} from './coloringModes';

export type { ColorPalette } from './types';

// Fractal calculators
export {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot
} from './fractals';

// Fractal type configurations
export {
  fractalTypes,
  getFractalConfig,
  getDefaultViewport,
  getFractalTypeNames,
  getFractalLabel
} from './fractalTypes';

// Color palettes
export {
  resolvePalette,
  lookupPaletteColor,
  lookupPaletteColorWithLightness,
  lookupPaletteColorAttenuated,
  getPaletteNames,
  getPaletteLabel
} from './palettes';

// Color conversions
export { oklchToRgb, srgbToOklch, oklchToCss } from './color';

// Coordinate transforms
export {
  screenToComplex,
  zoomViewport,
  panViewport,
  getZoomLevel,
  formatComplexCoords
} from './coordinates';
