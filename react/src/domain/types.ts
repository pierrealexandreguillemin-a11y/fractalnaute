/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Types & Interfaces
 * Fractal Explorer - Multi-fractal support
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Complex number representation */
export interface Complex {
  re: number;
  im: number;
}

/** Result of fractal calculation for a single point */
export interface FractalResult {
  iterations: number;
  escaped: boolean;
  smoothValue: number;
}

/** Viewport configuration for the complex plane */
export interface Viewport {
  centerRe: number;
  centerIm: number;
  scale: number;
}

/** RGB color tuple */
export type RGB = [r: number, g: number, b: number];

/** OKLCH color — perceptually uniform, source of truth */
export interface OKLCH {
  L: number;  // Lightness [0, 1]
  C: number;  // Chroma [0, ~0.4]
  H: number;  // Hue [0, 360) degrees
}

/** Color palette function — works in OKLCH space */
export type ColorPalette = (t: number) => OKLCH;

/** Available fractal types */
export type FractalType =
  | 'mandelbrot'
  | 'julia'
  | 'burningship'
  | 'tricorn'
  | 'multibrot3'
  | 'multibrot4'
  | 'multibrot5';

/** Available color palette names */
export type PaletteName =
  | 'classic'
  | 'fire'
  | 'ice'
  | 'neon'
  | 'grayscale'
  | 'psychedelic'
  | 'sunset'
  | 'miami'
  | 'electric';

/** Available theme names */
export type ThemeName =
  | 'default'
  | 'miami'
  | 'ocean'
  | 'light';

/** Parameters for fractal calculations */
export interface FractalParams {
  juliaRe?: number;
  juliaIm?: number;
  power?: number;
}

/** Fractal calculator function signature */
export type FractalCalculator = (
  re: number,
  im: number,
  maxIterations: number,
  params: FractalParams
) => FractalResult;

/** Configuration for a fractal type */
export interface FractalTypeConfig {
  name: string;
  formula: string;
  description: string;
  calculator: FractalCalculator;
  defaultView: Viewport;
  params?: FractalParams;
  hasJuliaParam?: boolean;
}

/** Julia preset configuration */
export interface JuliaPreset {
  name: string;
  re: number;
  im: number;
}

/** Render statistics */
export interface RenderStats {
  fractalType: FractalType;
  fractalName: string;
  zoomLevel: number;
  centerRe: number;
  centerIm: number;
  renderTime: number;
}

/** Default Julia parameters */
export const DEFAULT_JULIA_PARAMS: FractalParams = {
  juliaRe: -0.7,
  juliaIm: 0.27015
};

/** Julia presets */
export const JULIA_PRESETS: JuliaPreset[] = [
  { name: 'Dendrite spirale', re: -0.7, im: 0.27015 },
  { name: 'Lapin de Douady', re: -0.8, im: 0.156 },
  { name: 'Dragon', re: -0.4, im: 0.6 },
  { name: 'Spirale dorée', re: 0.285, im: 0.01 },
  { name: 'Étoile de mer', re: -0.835, im: -0.2321 },
  { name: 'San Marco', re: -0.75, im: 0 },
  { name: 'Flocon', re: 0.355, im: 0.355 }
];
