/**
 * ===============================================================================
 * APPLICATION LAYER - State Management Hook
 * React hook wrapping the pure fractalReducer.
 * ===============================================================================
 */

import { useReducer, useCallback, useMemo } from 'react';
import type { FractalType, PaletteName, ThemeName, ColoringMode, FractalParams, RenderBackend, PrecisionMode } from '../domain';
import { getFractalConfig, getZoomLevel } from '../domain';
import type { RenderStats } from '../domain';
import {
  fractalReducer, buildInitialState,
  type FractalState, type FractalAction, type InitialFractalConfig
} from './fractalReducer';

export type { FractalState, FractalAction, InitialFractalConfig };

/**
 * Custom hook for fractal state management
 */
export function useFractalState(initial?: InitialFractalConfig) {
  const [state, dispatch] = useReducer(fractalReducer, initial, buildInitialState);

  const setFractalType = useCallback((fractalType: FractalType) => {
    dispatch({ type: 'SET_FRACTAL_TYPE', fractalType });
  }, []);
  const zoom = useCallback((factor: number, nxOff: number, nyOff: number, aspectRatio: number) => {
    dispatch({ type: 'ZOOM', factor, nxOff, nyOff, aspectRatio });
  }, []);
  const pan = useCallback((deltaRe: number, deltaIm: number) => {
    dispatch({ type: 'PAN', deltaRe, deltaIm });
  }, []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const setPalette = useCallback((palette: PaletteName) => dispatch({ type: 'SET_PALETTE', palette }), []);
  const setTheme = useCallback((theme: ThemeName) => dispatch({ type: 'SET_THEME', theme }), []);
  const setIterations = useCallback((maxIterations: number) => dispatch({ type: 'SET_ITERATIONS', maxIterations }), []);
  const setJuliaParams = useCallback((params: FractalParams) => dispatch({ type: 'SET_JULIA_PARAMS', params }), []);
  const setRendering = useCallback((isRendering: boolean, renderTime?: number, renderBackend?: RenderBackend) => {
    dispatch({ type: 'SET_RENDERING', isRendering, renderTime, renderBackend });
  }, []);
  const setPickingJulia = useCallback((isPickingJulia: boolean) => dispatch({ type: 'SET_PICKING_JULIA', isPickingJulia }), []);
  const setColoringMode = useCallback((mode: ColoringMode) => dispatch({ type: 'SET_COLORING_MODE', mode }), []);
  const setInteriorColoring = useCallback((enabled: boolean) => dispatch({ type: 'SET_INTERIOR_COLORING', enabled }), []);
  const setSSAA = useCallback((enabled: boolean) => dispatch({ type: 'SET_SSAA', enabled }), []);
  const setPrecisionMode = useCallback((mode: PrecisionMode) => dispatch({ type: 'SET_PRECISION_MODE', mode }), []);
  const setOrbitComputing = useCallback((computing: boolean) => dispatch({ type: 'SET_ORBIT_COMPUTING', computing }), []);
  const setOrbitProgress = useCallback((progress: number) => dispatch({ type: 'SET_ORBIT_PROGRESS', progress }), []);
  const setStatusMessage = useCallback((message: string | null) => dispatch({ type: 'SET_STATUS_MESSAGE', message }), []);
  const applyConfig = useCallback((config: InitialFractalConfig) => dispatch({ type: 'APPLY_CONFIG', config }), []);

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
      setFractalType, zoom, pan, reset, setPalette, setTheme,
      setIterations, setJuliaParams, setRendering, setPickingJulia,
      setColoringMode, setInteriorColoring, setSSAA, setPrecisionMode,
      setOrbitComputing, setOrbitProgress, setStatusMessage, applyConfig
    }
  };
}

export type FractalActions = ReturnType<typeof useFractalState>['actions'];
