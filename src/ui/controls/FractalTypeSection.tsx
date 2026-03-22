/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Fractal Type Section
 * Selector and info display for fractal type
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { FractalType } from '../../domain';
import { getFractalTypeNames, getFractalLabel, getFractalConfig } from '../../domain';
import { labelStyle, selectStyle, monoFontFamily, infoBoxStyle } from '../styles';

interface FractalTypeSectionProps {
  fractalType: FractalType;
  onFractalTypeChange: (type: FractalType) => void;
}

export const FractalTypeSection: React.FC<FractalTypeSectionProps> = ({
  fractalType,
  onFractalTypeChange
}) => {
  const config = getFractalConfig(fractalType);

  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Type de fractale</label>
      <select
        value={fractalType}
        onChange={(e) => onFractalTypeChange(e.target.value as FractalType)}
        style={selectStyle}
      >
        {getFractalTypeNames().map((type) => (
          <option key={type} value={type}>
            {getFractalLabel(type)}
          </option>
        ))}
      </select>
      <div style={{ ...infoBoxStyle, marginTop: '4px' }}>
        <span style={{
          fontFamily: monoFontFamily,
          color: 'var(--fractal-accent-primary)',
          fontSize: '12px'
        }}>
          {config.formula}
        </span>
        <br />
        {config.description}
      </div>
    </div>
  );
};
