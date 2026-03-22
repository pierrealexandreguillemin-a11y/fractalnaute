/**
 * ===================================================================
 * UI LAYER - Controls Panel Component
 * Thin assembler composing focused sub-sections
 * ===================================================================
 */

import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams } from '../domain';
import { glassBaseStyle, dividerStyle, radius, zIndex, BG_SECONDARY, BORDER_SOLID, BORDER_COLOR } from './styles';
import { FractalTypeSection, JuliaSection, AppearanceSection, ActionsSection } from './controls';

const TEXT_PRIMARY = 'var(--fractal-text-primary)';

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
  borderRadius: radius['2xl'],
  padding: '16px',
  minWidth: '260px',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px oklch(0 0 0 / 0.3)',
  color: TEXT_PRIMARY,
  zIndex: zIndex.controls
};

const collapsedButtonStyle: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '44px',
  height: '44px',
  color: TEXT_PRIMARY,
  fontSize: '20px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px',
  paddingBottom: '8px',
  borderBottom: `1px solid ${BORDER_COLOR}`
};

const closeButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: BG_SECONDARY,
  border: BORDER_SOLID,
  borderRadius: radius.md,
  color: TEXT_PRIMARY,
  fontSize: '14px',
  cursor: 'pointer'
};

/** Panel header with title and collapse button */
const PanelHeader: React.FC<{ onCollapse: () => void }> = ({ onCollapse }) => (
  <div style={headerStyle}>
    <span style={{
      fontSize: '14px',
      fontWeight: 600,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
      color: 'var(--fractal-text-secondary)'
    }}>
      Fractal Explorer
    </span>
    <button onClick={onCollapse} style={closeButtonStyle}>
      X
    </button>
  </div>
);

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
        title="Afficher les controles"
      >
        *
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <PanelHeader onCollapse={() => setIsCollapsed(true)} />

      <FractalTypeSection fractalType={fractalType} onFractalTypeChange={onFractalTypeChange} />

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
