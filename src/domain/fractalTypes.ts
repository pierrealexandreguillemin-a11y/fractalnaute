/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Fractal Type Configurations
 * Metadata and default settings for each fractal type
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalType, FractalTypeConfig, Viewport } from './types';
import {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot
} from './fractals';

/**
 * All fractal type configurations
 */
export const fractalTypes: Record<FractalType, FractalTypeConfig> = {
  mandelbrot: {
    name: 'Mandelbrot',
    formula: 'z → z² + c',
    description: "L'ensemble de Mandelbrot classique",
    calculator: calculateMandelbrot,
    defaultView: { centerRe: -0.5, centerIm: 0, scale: 2.8 }
  },
  julia: {
    name: 'Julia',
    formula: 'z → z² + c (c fixe)',
    description: 'Ensemble de Julia - cliquez sur Mandelbrot pour choisir c',
    calculator: calculateJulia,
    defaultView: { centerRe: 0, centerIm: 0, scale: 2.8 },
    hasJuliaParam: true
  },
  burningship: {
    name: 'Burning Ship',
    formula: 'z → (|Re(z)| + i|Im(z)|)² + c',
    description: 'Le navire en feu - découvert en 1992',
    calculator: calculateBurningShip,
    defaultView: { centerRe: -0.4, centerIm: -0.5, scale: 2.5 }
  },
  tricorn: {
    name: 'Tricorn',
    formula: 'z → conj(z)² + c',
    description: 'Le Tricorn ou Mandelbar - utilise le conjugué complexe',
    calculator: calculateTricorn,
    defaultView: { centerRe: -0.3, centerIm: 0, scale: 2.8 }
  },
  multibrot3: {
    name: 'Multibrot (z³)',
    formula: 'z → z³ + c',
    description: 'Multibrot de degré 3 - symétrie ternaire',
    calculator: calculateMultibrot,
    defaultView: { centerRe: 0, centerIm: 0, scale: 2.2 },
    params: { power: 3 }
  }
};

/**
 * Get fractal type configuration
 */
export function getFractalConfig(type: FractalType): FractalTypeConfig {
  return fractalTypes[type];
}

/**
 * Get default viewport for a fractal type
 */
export function getDefaultViewport(type: FractalType): Viewport {
  return { ...fractalTypes[type].defaultView };
}

/**
 * Get all fractal type names
 */
export function getFractalTypeNames(): FractalType[] {
  return Object.keys(fractalTypes) as FractalType[];
}

/**
 * Get human-readable label for a fractal type
 */
export function getFractalLabel(type: FractalType): string {
  return fractalTypes[type].name;
}
