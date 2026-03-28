/**
 * ===================================================================
 * Hook: useFractalExplorer
 * Wires together state, events, and renderer for the main component.
 * ===================================================================
 */

import { useRef, useCallback, useEffect } from 'react';
import type { ThemeName, FractalType } from './domain';
import { useFractalState, useCanvasEvents, useUrlSync, parseHash } from './application';
import type { InitialFractalConfig } from './application';
import { useRenderer, cancelOrbit, needsPerturbation, getOrbitProgress } from './infrastructure';
import type { PrecisionMode } from './domain';

interface UseFractalExplorerOptions extends InitialFractalConfig {
  onThemeChange?: (theme: ThemeName) => void;
}

/** Derive precision mode from viewport scale and fractal type */
function derivePrecisionMode(scale: number, fractalType: FractalType): PrecisionMode {
  if (needsPerturbation(scale)) {
    return (fractalType === 'mandelbrot' || fractalType === 'julia') ? 'perturbation' : 'doubleSingle';
  }
  return fractalType === 'mandelbrot' ? 'doubleSingle' : 'float32';
}

/** Build the UrlState object from fractal state for URL sync */
function buildUrlState(state: {
  viewport: { centerRe: number; centerIm: number; scale: number };
  fractalType: FractalType; maxIterations: number; palette: string;
  coloringMode: string; interiorColoring: boolean; ssaa: boolean;
  juliaParams: { juliaRe?: number; juliaIm?: number };
}) {
  return {
    centerRe: state.viewport.centerRe, centerIm: state.viewport.centerIm,
    scale: state.viewport.scale, fractalType: state.fractalType,
    maxIterations: state.maxIterations, palette: state.palette,
    coloringMode: state.coloringMode, interiorColoring: state.interiorColoring,
    ssaa: state.ssaa,
    juliaRe: state.juliaParams.juliaRe ?? -0.7, juliaIm: state.juliaParams.juliaIm ?? 0.27015,
  };
}

export function useFractalExplorer(options: UseFractalExplorerOptions) {
  const { onThemeChange: onThemeChangeExternal, ...initialConfig } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { state, stats, actions } = useFractalState(initialConfig);

  // Apply URL hash config after hydration to avoid SSR mismatch (ISO 9241-110)
  useEffect(() => {
    const urlConfig = parseHash(window.location.hash);
    if (Object.keys(urlConfig).length > 0) {
      actions.applyConfig(urlConfig);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  useUrlSync(buildUrlState(state) as Parameters<typeof useUrlSync>[0]);

  // Derive precision mode — no state, no effect, no re-render loop
  const precisionMode = derivePrecisionMode(state.viewport.scale, state.fractalType);

  const handleJuliaPick = useCallback((re: number, im: number) => {
    actions.setJuliaParams({ juliaRe: re, juliaIm: im });
    actions.setPickingJulia(false);
    actions.setFractalType('julia');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- actions callbacks are stable (useCallback with [])
  }, []);

  const handleEscapeCancel = useCallback(() => {
    cancelOrbit();
    actions.setOrbitComputing(false);
    actions.setOrbitProgress(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- actions callbacks are stable (useCallback with [])
  }, []);

  // Poll orbit progress via SAB while computing (ISO 9241-110: self-descriptiveness)
  useEffect(() => {
    if (!state.orbitComputing) return;
    let rafId: number;
    const poll = () => {
      actions.setOrbitProgress(getOrbitProgress());
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- actions stable
  }, [state.orbitComputing]);

  useCanvasEvents({
    canvasRef, viewport: state.viewport, fractalType: state.fractalType,
    isPickingJulia: state.isPickingJulia, actions,
    onJuliaPick: handleJuliaPick, onEscapeCancel: handleEscapeCancel,
  });

  const { exportImage } = useRenderer({
    canvasRef, containerRef, fractalType: state.fractalType,
    viewport: state.viewport, maxIterations: state.maxIterations,
    palette: state.palette, params: state.juliaParams,
    coloringMode: state.coloringMode, interiorColoring: state.interiorColoring,
    ssaa: state.ssaa, lastRenderTime: state.renderTime,
    onRenderStart: () => actions.setRendering(true),
    onRenderComplete: (renderTime, backend) => actions.setRendering(false, renderTime, backend),
  });

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
    containerRef, canvasRef, state, stats, actions,
    exportImage, handleThemeChange, handlePickJulia,
    precisionMode,
  };
}
