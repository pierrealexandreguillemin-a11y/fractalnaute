/**
 * ===================================================================
 * Hook: useFractalExplorer
 * Wires together state, events, and renderer for the main component.
 * ===================================================================
 */

import { useRef, useCallback, useEffect, useMemo } from 'react';
import type { ThemeName, FractalType } from './domain';
import { useFractalState, useCanvasEvents, useUrlInitialConfig, useUrlSync } from './application';
import type { InitialFractalConfig } from './application';
import { useRenderer } from './infrastructure';

interface UseFractalExplorerOptions extends InitialFractalConfig {
  onThemeChange?: (theme: ThemeName) => void;
}

export function useFractalExplorer(options: UseFractalExplorerOptions) {
  const { onThemeChange: onThemeChangeExternal, ...initialConfig } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // URL hash overrides props-based initial config
  const urlConfig = useUrlInitialConfig();
  const mergedConfig = useMemo<InitialFractalConfig>(
    () => ({ ...initialConfig, ...urlConfig }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
    []
  );

  const { state, stats, actions } = useFractalState(mergedConfig);

  // Sync state changes back to URL hash (debounced)
  useUrlSync({
    centerRe: state.viewport.centerRe,
    centerIm: state.viewport.centerIm,
    scale: state.viewport.scale,
    fractalType: state.fractalType,
    maxIterations: state.maxIterations,
    palette: state.palette,
    coloringMode: state.coloringMode,
    interiorColoring: state.interiorColoring,
    ssaa: state.ssaa,
    juliaRe: state.juliaParams.juliaRe ?? -0.7,
    juliaIm: state.juliaParams.juliaIm ?? 0.27015,
  });

  const handleJuliaPick = useCallback((re: number, im: number) => {
    actions.setJuliaParams({ juliaRe: re, juliaIm: im });
    actions.setPickingJulia(false);
    actions.setFractalType('julia');
  }, [actions]);

  useCanvasEvents({
    canvasRef,
    viewport: state.viewport,
    fractalType: state.fractalType,
    isPickingJulia: state.isPickingJulia,
    actions,
    onJuliaPick: handleJuliaPick
  });

  const { exportImage } = useRenderer({
    canvasRef,
    containerRef,
    fractalType: state.fractalType,
    viewport: state.viewport,
    maxIterations: state.maxIterations,
    palette: state.palette,
    params: state.juliaParams,
    coloringMode: state.coloringMode,
    interiorColoring: state.interiorColoring,
    ssaa: state.ssaa,
    lastRenderTime: state.renderTime,
    onRenderStart: () => actions.setRendering(true),
    onRenderComplete: (renderTime, backend) => actions.setRendering(false, renderTime, backend)
  });

  // Sync theme to <html> for Radix portals (dropdowns teleport to <body>)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  const handleThemeChange = useCallback((theme: ThemeName) => {
    actions.setTheme(theme);
    onThemeChangeExternal?.(theme);
  }, [actions, onThemeChangeExternal]);

  const handlePickJulia = useCallback(() => {
    actions.setPickingJulia(true);
    if (state.fractalType !== 'mandelbrot') {
      actions.setFractalType('mandelbrot' as FractalType);
    }
  }, [actions, state.fractalType]);

  return {
    containerRef,
    canvasRef,
    state,
    stats,
    actions,
    exportImage,
    handleThemeChange,
    handlePickJulia
  };
}
