/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Appearance Section
 * Theme, palette, and iterations controls
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { ThemeName, PaletteName } from '../../domain';
import { getPaletteNames, getPaletteLabel } from '../../domain';
import { getThemeLabel, getThemeNames } from '../themes';
import { labelStyle, selectStyle, radius } from '../styles';

interface AppearanceSectionProps {
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
}

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  theme,
  palette,
  maxIterations,
  onThemeChange,
  onPaletteChange,
  onIterationsChange
}) => (
  <>
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Thème</label>
      <select
        value={theme}
        onChange={(e) => onThemeChange(e.target.value as ThemeName)}
        style={selectStyle}
      >
        {getThemeNames().map((t) => (
          <option key={t} value={t}>{getThemeLabel(t)}</option>
        ))}
      </select>
    </div>

    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Palette de couleurs</label>
      <select
        value={palette}
        onChange={(e) => onPaletteChange(e.target.value as PaletteName)}
        style={selectStyle}
      >
        {getPaletteNames().map((p) => (
          <option key={p} value={p}>{getPaletteLabel(p)}</option>
        ))}
      </select>
    </div>

    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Itérations max: {maxIterations}</label>
      <input
        type="range"
        min="50"
        max="1000"
        value={maxIterations}
        onChange={(e) => onIterationsChange(parseInt(e.target.value, 10))}
        style={{
          width: '100%',
          height: '4px',
          background: 'var(--fractal-bg-secondary)',
          borderRadius: radius.xs,
          outline: 'none',
          cursor: 'pointer'
        }}
      />
    </div>
  </>
);
