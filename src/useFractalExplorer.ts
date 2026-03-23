/**
 * ===================================================================
 * Hook: useFractalExplorer
 * Wires together state, events, and renderer for the main component.
 * ===================================================================
 */

import { useRef, useCallback, useEffect } from 'react';
import type { ThemeName, FractalType } from './domain';
import { useFractalState, useCanvasEvents } from './application';
import type { InitialFractalConfig } from './application';
import { useRenderer } from './infrastructure';

interface UseFractalExplorerOptions extends InitialFractalConfig {
  onThemeChange?: (theme: ThemeName) => void;
}

export function useFractalExplorer(options: UseFractalExplorerOptions) {
  const { onThemeChange: onThemeChangeExternal, ...initialConfig } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { state, stats, actions } = useFractalState(initialConfig);

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
    onRenderStart: () => actions.setRendering(true),
    onRenderComplete: (renderTime: number) => actions.setRendering(false, renderTime)
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
