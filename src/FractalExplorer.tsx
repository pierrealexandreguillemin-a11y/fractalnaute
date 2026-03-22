/**
 * ===================================================================
 * FRACTAL EXPLORER - Main Component
 * Multi-fractal explorer with Julia picker
 * ===================================================================
 */

'use client';

import React from 'react';
import type { ThemeName, PaletteName, FractalType } from './domain';
import {
  ControlsPanel,
  InfoPanel,
  HelpTooltip,
  LoadingOverlay,
  getThemeCSSVariables,
  keyframesCSS
} from './ui';
import { useFractalExplorer } from './useFractalExplorer';

export interface FractalExplorerProps {
  initialFractalType?: FractalType;
  initialTheme?: ThemeName;
  initialPalette?: PaletteName;
  initialIterations?: number;
  showControls?: boolean;
  showInfo?: boolean;
  showHelp?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onThemeChange?: (theme: ThemeName) => void;
}

const FONT_FAMILY = "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
  const {
    containerRef, canvasRef, state, stats, actions,
    exportImage, handleThemeChange, handlePickJulia
  } = useFractalExplorer({
    fractalType: initialFractalType,
    theme: initialTheme,
    palette: initialPalette,
    maxIterations: initialIterations,
    onThemeChange
  });

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
          fontFamily: FONT_FAMILY,
          ...themeVars as React.CSSProperties,
          ...style
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', cursor: 'crosshair', imageRendering: 'pixelated' }}
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
