/**
 * Pure fractal state reducer and config override helpers.
 * No React dependency — fully testable.
 */

import type {
  FractalType, PaletteName, ThemeName, ColoringMode,
  FractalParams, RenderBackend, PrecisionMode
} from '../domain';
import { DEFAULT_JULIA_PARAMS, getDefaultViewport, getFractalConfig } from '../domain';
import type { Viewport } from '../domain';

/** State interface */
export interface FractalState {
  fractalType: FractalType;
  viewport: Viewport;
  maxIterations: number;
  palette: PaletteName;
  theme: ThemeName;
  juliaParams: FractalParams;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  isRendering: boolean;
  isPickingJulia: boolean;
  renderTime: number;
  renderBackend: RenderBackend | null;
  ssaa: boolean;
  precisionMode: PrecisionMode;
  orbitComputing: boolean;
  orbitProgress: number;
  statusMessage: string | null;
}

/** Action types */
export type FractalAction =
  | { type: 'SET_FRACTAL_TYPE'; fractalType: FractalType }
  | { type: 'ZOOM'; factor: number; nxOff: number; nyOff: number; aspectRatio: number }
  | { type: 'PAN'; deltaRe: number; deltaIm: number }
  | { type: 'RESET' }
  | { type: 'SET_PALETTE'; palette: PaletteName }
  | { type: 'SET_THEME'; theme: ThemeName }
  | { type: 'SET_ITERATIONS'; maxIterations: number }
  | { type: 'SET_JULIA_PARAMS'; params: FractalParams }
  | { type: 'SET_RENDERING'; isRendering: boolean; renderTime?: number; renderBackend?: RenderBackend }
  | { type: 'SET_PICKING_JULIA'; isPickingJulia: boolean }
  | { type: 'SET_COLORING_MODE'; mode: ColoringMode }
  | { type: 'SET_INTERIOR_COLORING'; enabled: boolean }
  | { type: 'SET_SSAA'; enabled: boolean }
  | { type: 'SET_PRECISION_MODE'; mode: PrecisionMode }
  | { type: 'SET_ORBIT_COMPUTING'; computing: boolean }
  | { type: 'SET_ORBIT_PROGRESS'; progress: number }
  | { type: 'SET_STATUS_MESSAGE'; message: string | null }
  | { type: 'APPLY_CONFIG'; config: InitialFractalConfig };

/** Optional initial config overrides */
export interface InitialFractalConfig {
  fractalType?: FractalType;
  theme?: ThemeName;
  palette?: PaletteName;
  maxIterations?: number;
  centerRe?: number;
  centerIm?: number;
  scale?: number;
  deepRe?: string;
  deepIm?: string;
  deepScale?: string;
  coloringMode?: ColoringMode;
  interiorColoring?: boolean;
  ssaa?: boolean;
  juliaRe?: number;
  juliaIm?: number;
}

/** Initial state */
export const initialState: FractalState = {
  fractalType: 'mandelbrot',
  viewport: getDefaultViewport('mandelbrot'),
  maxIterations: 1024,
  palette: 'classic',
  coloringMode: 'classic',
  interiorColoring: false,
  theme: 'default',
  juliaParams: { ...DEFAULT_JULIA_PARAMS },
  isRendering: false,
  isPickingJulia: false,
  renderTime: 0,
  renderBackend: null,
  ssaa: false,
  precisionMode: 'float32' as PrecisionMode,
  orbitComputing: false,
  orbitProgress: 0,
  statusMessage: null
};

// ---- Reducer ----------------------------------------------------------------

/** Handle SET_RENDERING — extracted to stay under complexity limit */
function applySetRendering(
  state: FractalState,
  action: { isRendering: boolean; renderTime?: number; renderBackend?: RenderBackend }
): FractalState {
  return {
    ...state,
    isRendering: action.isRendering,
    renderTime: action.renderTime ?? state.renderTime,
    renderBackend: action.renderBackend ?? state.renderBackend
  };
}

/** State reducer */
export function fractalReducer(state: FractalState, action: FractalAction): FractalState {
  switch (action.type) {
    case 'SET_FRACTAL_TYPE': {
      const config = getFractalConfig(action.fractalType);
      return {
        ...state,
        fractalType: action.fractalType,
        viewport: { ...config.defaultView },
        juliaParams: { ...state.juliaParams, ...(config.params ?? {}) }
      };
    }
    case 'ZOOM':
      return { ...state, viewport: deepZoom(state.viewport, action.factor, action.nxOff, action.nyOff, action.aspectRatio) };
    case 'PAN':
      return { ...state, viewport: deepPan(state.viewport, action.deltaRe, action.deltaIm) };
    case 'RESET':
      return { ...state, viewport: getDefaultViewport(state.fractalType) };
    case 'SET_PALETTE':
      return { ...state, palette: action.palette };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'SET_ITERATIONS':
      return { ...state, maxIterations: action.maxIterations };
    case 'SET_JULIA_PARAMS':
      return { ...state, juliaParams: { ...state.juliaParams, ...action.params } };
    case 'SET_RENDERING':
      return applySetRendering(state, action);
    case 'SET_PICKING_JULIA':
      return { ...state, isPickingJulia: action.isPickingJulia };
    default:
      return reducerExtras(state, action);
  }
}

/** Handle secondary actions — extracted to stay under complexity limit */
function reducerExtras(state: FractalState, action: FractalAction): FractalState {
  switch (action.type) {
    case 'SET_COLORING_MODE':
      return { ...state, coloringMode: action.mode };
    case 'SET_INTERIOR_COLORING':
      return { ...state, interiorColoring: action.enabled };
    case 'SET_SSAA':
      return { ...state, ssaa: action.enabled };
    case 'SET_PRECISION_MODE':
      return { ...state, precisionMode: action.mode };
    case 'SET_ORBIT_COMPUTING':
      return { ...state, orbitComputing: action.computing };
    case 'SET_ORBIT_PROGRESS':
      return { ...state, orbitProgress: action.progress };
    case 'SET_STATUS_MESSAGE':
      return { ...state, statusMessage: action.message };
    case 'APPLY_CONFIG': {
      let s = state;
      const c = action.config;
      if (c.fractalType) {
        s = { ...s, fractalType: c.fractalType, viewport: getDefaultViewport(c.fractalType) };
      }
      s = applyScalarOverrides(s, c);
      s = applyJuliaOverrides(s, c);
      return applyViewportOverrides(s, c);
    }
    default:
      return state;
  }
}

// ---- Config override helpers ------------------------------------------------
import { deepZoom, deepPan } from './deepArithmetic';

/** Apply simple scalar overrides from initial config */
function applyScalarOverrides(base: FractalState, initial?: InitialFractalConfig): FractalState {
  if (!initial) return base;
  return {
    ...base,
    ...(initial.theme && { theme: initial.theme }),
    ...(initial.palette && { palette: initial.palette }),
    ...(initial.maxIterations !== undefined && { maxIterations: initial.maxIterations }),
    ...(initial.coloringMode && { coloringMode: initial.coloringMode }),
    ...(initial.interiorColoring !== undefined && { interiorColoring: initial.interiorColoring }),
    ...(initial.ssaa !== undefined && { ssaa: initial.ssaa }),
  };
}

/** Apply Julia param overrides from initial config */
function applyJuliaOverrides(base: FractalState, initial?: InitialFractalConfig): FractalState {
  if (initial?.juliaRe === undefined && initial?.juliaIm === undefined) return base;
  return {
    ...base,
    juliaParams: {
      ...base.juliaParams,
      ...(initial.juliaRe !== undefined && { juliaRe: initial.juliaRe }),
      ...(initial.juliaIm !== undefined && { juliaIm: initial.juliaIm }),
    }
  };
}

/** Apply viewport coordinate overrides after fractalType default viewport is set */
function applyViewportOverrides(
  state: FractalState, initial?: InitialFractalConfig
): FractalState {
  if (!initial) return state;
  const has = initial.centerRe !== undefined || initial.centerIm !== undefined || initial.scale !== undefined
    || initial.deepRe !== undefined || initial.deepIm !== undefined || initial.deepScale !== undefined;
  if (!has) return state;
  return {
    ...state,
    viewport: {
      centerRe: initial.centerRe ?? state.viewport.centerRe,
      centerIm: initial.centerIm ?? state.viewport.centerIm,
      scale: initial.scale ?? state.viewport.scale,
      deepRe: initial.deepRe ?? state.viewport.deepRe,
      deepIm: initial.deepIm ?? state.viewport.deepIm,
      deepScale: initial.deepScale ?? state.viewport.deepScale,
    },
  };
}

export function buildInitialState(initial?: InitialFractalConfig): FractalState {
  const withFractal = {
    ...initialState,
    ...(initial?.fractalType && {
      fractalType: initial.fractalType,
      viewport: getDefaultViewport(initial.fractalType),
    }),
  };
  const withScalars = applyScalarOverrides(withFractal, initial);
  const withJulia = applyJuliaOverrides(withScalars, initial);
  return applyViewportOverrides(withJulia, initial);
}
