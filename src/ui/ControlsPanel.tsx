/**
 * ===================================================================
 * UI LAYER - Controls Panel Component
 * Thin assembler composing focused sub-sections
 * ===================================================================
 */

import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams, ColoringMode } from '../domain';
import { cn } from '@/lib/utils';
import { GLASS_PANEL } from './shared';
import { FractalTypeSection, JuliaSection, AppearanceSection, ColoringSection, ActionsSection } from './controls';

interface ControlsPanelProps {
  fractalType: FractalType;
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  juliaParams: FractalParams;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  isPickingJulia: boolean;
  onFractalTypeChange: (type: FractalType) => void;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
  onJuliaParamsChange: (params: FractalParams) => void;
  onPickJulia: () => void;
  onColoringModeChange: (mode: ColoringMode) => void;
  onInteriorColoringChange: (enabled: boolean) => void;
  ssaa: boolean;
  onSSAAChange: (enabled: boolean) => void;
  onReset: () => void;
  onExport: () => void;
}

const CONTROLS_PANEL = cn(
  GLASS_PANEL,
  'rounded-2xl shadow-[0_8px_32px_oklch(0_0_0/0.3)]'
);

const PANEL_TITLE_CLASS = 'text-sm font-semibold tracking-wide uppercase text-muted-foreground';

/** Panel header with title and collapse button */
const PanelHeader: React.FC<{ onCollapse: () => void }> = ({ onCollapse }) => (
  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
    <span className={PANEL_TITLE_CLASS}>
      Fractal Explorer
    </span>
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Réduire le panneau"
      className="px-2 py-1 bg-glass-card border border-glass-border rounded-md text-sm text-foreground cursor-pointer hover:bg-glass-bg"
    >
      X
    </button>
  </div>
);

export const ControlsPanel: React.FC<ControlsPanelProps> = (props) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        title="Afficher les contrôles"
        aria-label="Afficher les contrôles"
        className={cn(
          CONTROLS_PANEL,
          'absolute bottom-2 right-2 sm:bottom-auto sm:top-4 sm:right-4 w-11 h-11 z-100',
          'text-foreground cursor-pointer flex items-center justify-center'
        )}
      >
        <svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1.5 3C1.22386 3 1 3.22386 1 3.5C1 3.77614 1.22386 4 1.5 4H13.5C13.7761 4 14 3.77614 14 3.5C14 3.22386 13.7761 3 13.5 3H1.5ZM1 7.5C1 7.22386 1.22386 7 1.5 7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H1.5C1.22386 8 1 7.77614 1 7.5ZM1 11.5C1 11.2239 1.22386 11 1.5 11H13.5C13.7761 11 14 11.2239 14 11.5C14 11.7761 13.7761 12 13.5 12H1.5C1.22386 12 1 11.7761 1 11.5Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
        </svg>
      </button>
    );
  }

  return (
    <ControlsPanelBody {...props} onCollapse={() => setIsCollapsed(true)} />
  );
};

/** Expanded panel body — extracted for max-lines-per-function compliance */
const ControlsPanelBody: React.FC<ControlsPanelProps & { onCollapse: () => void }> = ({
  fractalType, theme, palette, maxIterations,
  coloringMode, interiorColoring, ssaa,
  juliaParams, isPickingJulia,
  onFractalTypeChange, onThemeChange, onPaletteChange,
  onIterationsChange, onColoringModeChange, onInteriorColoringChange, onSSAAChange,
  onJuliaParamsChange, onPickJulia,
  onReset, onExport, onCollapse
}) => (
  <div
    className={cn(
      CONTROLS_PANEL,
      'absolute bottom-0 left-0 right-0 p-3 min-w-0 max-h-[60vh]',
      'sm:bottom-auto sm:left-auto sm:top-4 sm:right-4 sm:p-4 sm:min-w-[260px] sm:max-h-[calc(100vh-32px)]',
      'sm:rounded-2xl rounded-t-2xl rounded-b-none',
      'overflow-y-auto text-foreground z-100'
    )}
  >
    <PanelHeader onCollapse={onCollapse} />

    <FractalTypeSection fractalType={fractalType} onFractalTypeChange={onFractalTypeChange} />

    {fractalType === 'julia' && (
      <JuliaSection
        juliaParams={juliaParams}
        isPickingJulia={isPickingJulia}
        onJuliaParamsChange={onJuliaParamsChange}
        onPickJulia={onPickJulia}
      />
    )}

    <div className="h-px bg-border my-3" />

    <AppearanceSection
      theme={theme}
      palette={palette}
      maxIterations={maxIterations}
      onThemeChange={onThemeChange}
      onPaletteChange={onPaletteChange}
      onIterationsChange={onIterationsChange}
    />

    <div className="h-px bg-border my-3" />

    <ColoringSection
      coloringMode={coloringMode}
      interiorColoring={interiorColoring}
      ssaa={ssaa}
      onColoringModeChange={onColoringModeChange}
      onInteriorColoringChange={onInteriorColoringChange}
      onSSAAChange={onSSAAChange}
    />

    <div className="h-px bg-border my-3" />

    <ActionsSection onReset={onReset} onExport={onExport} />
  </div>
);
