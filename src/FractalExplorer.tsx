/**
 * ===================================================================
 * FRACTAL EXPLORER - Main Component
 * Multi-fractal explorer with Julia picker
 * ===================================================================
 */

'use client';

import React from 'react';
import type { ThemeName, PaletteName, FractalType } from './domain';
import { ControlsPanel, InfoPanel, HelpTooltip, LoadingOverlay } from './ui';
import { useFractalExplorer } from './useFractalExplorer';
import { cn } from '@/lib/utils';

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

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full min-h-[400px] flex items-center justify-center overflow-hidden',
        'bg-background text-foreground font-sans',
        className
      )}
      style={style}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Visualisation fractale interactive"
        className="block cursor-crosshair [image-rendering:pixelated] touch-none"
      />

      <LoadingOverlay isVisible={state.isRendering} />

      {showControls && (
        <ControlsPanel
          fractalType={state.fractalType}
          theme={state.theme}
          palette={state.palette}
          maxIterations={state.maxIterations}
          coloringMode={state.coloringMode}
          interiorColoring={state.interiorColoring}
          ssaa={state.ssaa}
          juliaParams={state.juliaParams}
          isPickingJulia={state.isPickingJulia}
          onFractalTypeChange={actions.setFractalType}
          onThemeChange={handleThemeChange}
          onPaletteChange={actions.setPalette}
          onIterationsChange={actions.setIterations}
          onColoringModeChange={actions.setColoringMode}
          onInteriorColoringChange={actions.setInteriorColoring}
          onSSAAChange={actions.setSSAA}
          onJuliaParamsChange={actions.setJuliaParams}
          onPickJulia={handlePickJulia}
          onReset={actions.reset}
          onExport={exportImage}
        />
      )}

      {showInfo && <InfoPanel stats={stats} />}
      {showHelp && <HelpTooltip />}
    </div>
  );
};

export default FractalExplorer;
