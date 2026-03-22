/**
 * ===================================================================
 * UI LAYER - Controls Panel Component
 * Thin assembler composing focused sub-sections
 * ===================================================================
 */

import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams } from '../domain';
import { cn } from '@/lib/utils';
import { GLASS_PANEL } from './shared';
import { FractalTypeSection, JuliaSection, AppearanceSection, ActionsSection } from './controls';

interface ControlsPanelProps {
  fractalType: FractalType;
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  juliaParams: FractalParams;
  isPickingJulia: boolean;
  onFractalTypeChange: (type: FractalType) => void;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
  onJuliaParamsChange: (params: FractalParams) => void;
  onPickJulia: () => void;
  onReset: () => void;
  onExport: () => void;
}

const CONTROLS_PANEL = cn(
  GLASS_PANEL,
  'rounded-2xl shadow-[0_8px_32px_oklch(0_0_0/0.3)]'
);

/** Panel header with title and collapse button */
const PanelHeader: React.FC<{ onCollapse: () => void }> = ({ onCollapse }) => (
  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
    <span className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
      Fractal Explorer
    </span>
    <button
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
        onClick={() => setIsCollapsed(false)}
        title="Afficher les controles"
        aria-label="Afficher les contrôles"
        className={cn(
          CONTROLS_PANEL,
          'absolute top-4 right-4 w-11 h-11 z-100',
          'text-foreground text-xl cursor-pointer flex items-center justify-center'
        )}
      >
        *
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
  juliaParams, isPickingJulia,
  onFractalTypeChange, onThemeChange, onPaletteChange,
  onIterationsChange, onJuliaParamsChange, onPickJulia,
  onReset, onExport, onCollapse
}) => (
  <div
    className={cn(
      CONTROLS_PANEL,
      'absolute top-4 right-4 p-4 min-w-[260px] max-h-[calc(100vh-32px)]',
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

    <ActionsSection onReset={onReset} onExport={onExport} />
  </div>
);
