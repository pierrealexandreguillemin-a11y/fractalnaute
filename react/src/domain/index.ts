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
  ColorPalette,
  FractalType,
  PaletteName,
  ThemeName,
  FractalParams,
  FractalCalculator,
  FractalTypeConfig,
  JuliaPreset,
  FractalConfig,
  RenderStats
} from './types';

export { DEFAULT_JULIA_PARAMS, JULIA_PRESETS } from './types';

// Fractal calculators
export {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot,
  fractalCalculators
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
  palettes,
  getColor,
  getPaletteNames,
  getPaletteLabel
} from './palettes';

// Coordinate transforms
export {
  screenToComplex,
  complexToScreen,
  zoomViewport,
  panViewport,
  getZoomLevel,
  formatComplexCoords
} from './coordinates';
