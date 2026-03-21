/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FRACTAL EXPLORER
 * Multi-fractal interactive explorer component
 * 
 * Supports: Mandelbrot, Julia, Burning Ship, Tricorn, Multibrot (3-5)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Main component
export { FractalExplorer, default } from './FractalExplorer';
export type { FractalExplorerProps } from './FractalExplorer';

// Domain exports
export type {
  Complex,
  FractalResult,
  Viewport,
  RGB,
  FractalType,
  PaletteName,
  ThemeName,
  FractalParams,
  FractalTypeConfig,
  JuliaPreset,
  RenderStats
} from './domain';

export {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot,
  fractalTypes,
  getFractalConfig,
  getFractalLabel,
  palettes,
  getColor,
  getPaletteNames,
  getPaletteLabel,
  screenToComplex,
  formatComplexCoords,
  JULIA_PRESETS
} from './domain';

// Application layer exports
export type { InitialFractalConfig } from './application';

// Theme exports
export { themes, getThemeCSSVariables, getThemeLabel } from './ui';
export type { ThemeColors } from './ui';
