/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APPLICATION LAYER - State Management
 * React hooks for fractal explorer state
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  FractalType,
  PaletteName,
  ThemeName,
  ColoringMode,
  Viewport,
  FractalParams,
  RenderStats,
  RenderBackend
} from '../domain';
import {
  DEFAULT_JULIA_PARAMS,
  getDefaultViewport,
  getFractalConfig,
  zoomViewport,
  panViewport,
  getZoomLevel
} from '../domain';

/** State interface */
interface FractalState {
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
}

/** Action types */
type FractalAction =
  | { type: 'SET_FRACTAL_TYPE'; fractalType: FractalType }
  | { type: 'ZOOM'; factor: number; focusRe: number; focusIm: number }
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
  | { type: 'SET_SSAA'; enabled: boolean };

/** Initial state */
const initialState: FractalState = {
  fractalType: 'mandelbrot',
  viewport: getDefaultViewport('mandelbrot'),
  maxIterations: 256,
  palette: 'classic',
  coloringMode: 'classic',
  interiorColoring: false,
  theme: 'default',
  juliaParams: { ...DEFAULT_JULIA_PARAMS },
  isRendering: false,
  isPickingJulia: false,
  renderTime: 0,
  renderBackend: null,
  ssaa: false
};

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
function fractalReducer(state: FractalState, action: FractalAction): FractalState {
  switch (action.type) {
    case 'SET_FRACTAL_TYPE': {
      const config = getFractalConfig(action.fractalType);
      return {
        ...state,
        fractalType: action.fractalType,
        viewport: { ...config.defaultView },
        juliaParams: {
          ...state.juliaParams,
          ...(config.params ?? {})
        }
      };
    }

    case 'ZOOM':
      return {
        ...state,
        viewport: zoomViewport(state.viewport, action.factor, action.focusRe, action.focusIm)
      };

    case 'PAN':
      return {
        ...state,
        viewport: panViewport(state.viewport, action.deltaRe, action.deltaIm)
      };

    case 'RESET':
      return {
        ...state,
        viewport: getDefaultViewport(state.fractalType)
      };

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

    case 'SET_COLORING_MODE':
      return { ...state, coloringMode: action.mode };

    case 'SET_INTERIOR_COLORING':
      return { ...state, interiorColoring: action.enabled };

    case 'SET_SSAA':
      return { ...state, ssaa: action.enabled };

    default:
      return state;
  }
}

/** Optional initial config overrides */
export interface InitialFractalConfig {
  fractalType?: FractalType;
  theme?: ThemeName;
  palette?: PaletteName;
  maxIterations?: number;
}

function buildInitialState(initial?: InitialFractalConfig): FractalState {
  return {
    ...initialState,
    ...(initial?.fractalType && {
      fractalType: initial.fractalType,
      viewport: getDefaultViewport(initial.fractalType),
    }),
    ...(initial?.theme && { theme: initial.theme }),
    ...(initial?.palette && { palette: initial.palette }),
    ...(initial?.maxIterations !== undefined && { maxIterations: initial.maxIterations }),
  };
}

/**
 * Custom hook for fractal state management
 */
export function useFractalState(initial?: InitialFractalConfig) {
  const [state, dispatch] = useReducer(fractalReducer, initial, buildInitialState);

  // Actions
  const setFractalType = useCallback((fractalType: FractalType) => {
    dispatch({ type: 'SET_FRACTAL_TYPE', fractalType });
  }, []);

  const zoom = useCallback((factor: number, focusRe: number, focusIm: number) => {
    dispatch({ type: 'ZOOM', factor, focusRe, focusIm });
  }, []);

  const pan = useCallback((deltaRe: number, deltaIm: number) => {
    dispatch({ type: 'PAN', deltaRe, deltaIm });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const setPalette = useCallback((palette: PaletteName) => {
    dispatch({ type: 'SET_PALETTE', palette });
  }, []);

  const setTheme = useCallback((theme: ThemeName) => {
    dispatch({ type: 'SET_THEME', theme });
  }, []);

  const setIterations = useCallback((maxIterations: number) => {
    dispatch({ type: 'SET_ITERATIONS', maxIterations });
  }, []);

  const setJuliaParams = useCallback((params: FractalParams) => {
    dispatch({ type: 'SET_JULIA_PARAMS', params });
  }, []);

  const setRendering = useCallback((isRendering: boolean, renderTime?: number, renderBackend?: RenderBackend) => {
    dispatch({ type: 'SET_RENDERING', isRendering, renderTime, renderBackend });
  }, []);

  const setPickingJulia = useCallback((isPickingJulia: boolean) => {
    dispatch({ type: 'SET_PICKING_JULIA', isPickingJulia });
  }, []);

  const setColoringMode = useCallback((mode: ColoringMode) => {
    dispatch({ type: 'SET_COLORING_MODE', mode });
  }, []);

  const setInteriorColoring = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_INTERIOR_COLORING', enabled });
  }, []);

  const setSSAA = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_SSAA', enabled });
  }, []);

  // Computed stats
  const stats: RenderStats = useMemo(() => {
    const config = getFractalConfig(state.fractalType);
    return {
      fractalType: state.fractalType,
      fractalName: config.name,
      zoomLevel: getZoomLevel(state.viewport, config.defaultView.scale),
      centerRe: state.viewport.centerRe,
      centerIm: state.viewport.centerIm,
      renderTime: state.renderTime,
      renderBackend: state.renderBackend
    };
  }, [state.fractalType, state.viewport, state.renderTime, state.renderBackend]);

  return {
    state,
    stats,
    actions: {
      setFractalType,
      zoom,
      pan,
      reset,
      setPalette,
      setTheme,
      setIterations,
      setJuliaParams,
      setRendering,
      setPickingJulia,
      setColoringMode,
      setInteriorColoring,
      setSSAA
    }
  };
}

export type FractalActions = ReturnType<typeof useFractalState>['actions'];
