/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FRACTAL EXPLORER - Main Component
 * Multi-fractal explorer with Julia picker
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use client';

import React, { useRef, useCallback } from 'react';

// Domain
import type { ThemeName, PaletteName, FractalType } from './domain';

// Application
import { useFractalState, useCanvasEvents } from './application';

// Infrastructure
import { useRenderer } from './infrastructure';

// UI
import {
  ControlsPanel,
  InfoPanel,
  HelpTooltip,
  LoadingOverlay,
  getThemeCSSVariables,
  keyframesCSS
} from './ui';

export interface FractalExplorerProps {
  /** Initial fractal type */
  initialFractalType?: FractalType;
  /** Initial theme */
  initialTheme?: ThemeName;
  /** Initial color palette */
  initialPalette?: PaletteName;
  /** Initial max iterations */
  initialIterations?: number;
  /** Show controls panel */
  showControls?: boolean;
  /** Show info panel */
  showInfo?: boolean;
  /** Show help tooltip */
  showHelp?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Custom inline styles */
  style?: React.CSSProperties;
  /** Theme change callback */
  onThemeChange?: (theme: ThemeName) => void;
}

/**
 * FractalExplorer - Multi-fractal interactive explorer
 * 
 * Fractals disponibles:
 * - Mandelbrot (z² + c)
 * - Julia (z² + c, c fixe)
 * - Burning Ship
 * - Tricorn
 * - Multibrot (z³, z⁴, z⁵)
 * 
 * @example
 * ```tsx
 * <FractalExplorer initialFractalType="julia" initialTheme="miami" />
 * ```
 */
export const FractalExplorer: React.FC<FractalExplorerProps> = ({
  initialFractalType = 'mandelbrot',
  initialTheme = 'default',
  initialPalette = 'classic',
  initialIterations = 256,
  showControls = true,
  showInfo = true,
  showHelp = true,
  className,
  style,
  onThemeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State management
  const { state, stats, actions } = useFractalState({
    fractalType: initialFractalType,
    theme: initialTheme,
    palette: initialPalette,
    maxIterations: initialIterations,
  });

  // Julia picker callback
  const handleJuliaPick = useCallback((re: number, im: number) => {
    actions.setJuliaParams({ juliaRe: re, juliaIm: im });
    actions.setPickingJulia(false);
    actions.setFractalType('julia');
  }, [actions]);

  // Canvas events
  useCanvasEvents({
    canvasRef,
    viewport: state.viewport,
    fractalType: state.fractalType,
    isPickingJulia: state.isPickingJulia,
    actions,
    onJuliaPick: handleJuliaPick
  });

  // Renderer
  const { exportImage } = useRenderer({
    canvasRef,
    containerRef,
    fractalType: state.fractalType,
    viewport: state.viewport,
    maxIterations: state.maxIterations,
    palette: state.palette,
    params: state.juliaParams,
    onRenderStart: () => actions.setRendering(true),
    onRenderComplete: (renderTime) => actions.setRendering(false, renderTime)
  });

  // Theme change handler
  const handleThemeChange = useCallback((theme: ThemeName) => {
    actions.setTheme(theme);
    onThemeChange?.(theme);
  }, [actions, onThemeChange]);

  // Start Julia picking
  const handlePickJulia = useCallback(() => {
    actions.setPickingJulia(true);
    // Switch to Mandelbrot for picking
    if (state.fractalType !== 'mandelbrot') {
      actions.setFractalType('mandelbrot');
    }
  }, [actions, state.fractalType]);

  const themeVars = getThemeCSSVariables(state.theme);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: keyframesCSS }} />
      
      <div
        ref={containerRef}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: themeVars['--fractal-bg-primary'],
          overflow: 'hidden',
          fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          ...themeVars as React.CSSProperties,
          ...style
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            cursor: 'crosshair',
            imageRendering: 'pixelated'
          }}
        />

        <LoadingOverlay isVisible={state.isRendering} />

        {showControls && (
          <ControlsPanel
            fractalType={state.fractalType}
            theme={state.theme}
            palette={state.palette}
            maxIterations={state.maxIterations}
            juliaParams={state.juliaParams}
            isPickingJulia={state.isPickingJulia}
            onFractalTypeChange={actions.setFractalType}
            onThemeChange={handleThemeChange}
            onPaletteChange={actions.setPalette}
            onIterationsChange={actions.setIterations}
            onJuliaParamsChange={actions.setJuliaParams}
            onPickJulia={handlePickJulia}
            onReset={actions.reset}
            onExport={exportImage}
          />
        )}

        {showInfo && <InfoPanel stats={stats} />}
        {showHelp && <HelpTooltip />}
      </div>
    </>
  );
};

export default FractalExplorer;
