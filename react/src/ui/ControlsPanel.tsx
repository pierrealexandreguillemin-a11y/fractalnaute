/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Controls Panel Component
 * Thin assembler composing focused sub-sections
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams } from '../domain';
import { glassBaseStyle, dividerStyle } from './styles';
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

const panelStyle: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  borderRadius: '16px',
  padding: '16px',
  minWidth: '260px',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  color: 'var(--fractal-text-primary)',
  zIndex: 100
};

const collapsedButtonStyle: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '44px',
  height: '44px',
  color: 'var(--fractal-text-primary)',
  fontSize: '20px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  fractalType,
  theme,
  palette,
  maxIterations,
  juliaParams,
  isPickingJulia,
  onFractalTypeChange,
  onThemeChange,
  onPaletteChange,
  onIterationsChange,
  onJuliaParamsChange,
  onPickJulia,
  onReset,
  onExport
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        style={collapsedButtonStyle}
        title="Afficher les contrôles"
      >
        ⚙️
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--fractal-border-color)'
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: 'var(--fractal-text-secondary)'
        }}>
          🌀 Fractal Explorer
        </span>
        <button
          onClick={() => setIsCollapsed(true)}
          style={{
            padding: '4px 8px',
            background: 'var(--fractal-bg-secondary)',
            border: '1px solid var(--fractal-border-color)',
            borderRadius: '6px',
            color: 'var(--fractal-text-primary)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          ✕
        </button>
      </div>

      <FractalTypeSection
        fractalType={fractalType}
        onFractalTypeChange={onFractalTypeChange}
      />

      {fractalType === 'julia' && (
        <JuliaSection
          juliaParams={juliaParams}
          isPickingJulia={isPickingJulia}
          onJuliaParamsChange={onJuliaParamsChange}
          onPickJulia={onPickJulia}
        />
      )}

      <div style={dividerStyle} />

      <AppearanceSection
        theme={theme}
        palette={palette}
        maxIterations={maxIterations}
        onThemeChange={onThemeChange}
        onPaletteChange={onPaletteChange}
        onIterationsChange={onIterationsChange}
      />

      <div style={dividerStyle} />

      <ActionsSection onReset={onReset} onExport={onExport} />
    </div>
  );
};
