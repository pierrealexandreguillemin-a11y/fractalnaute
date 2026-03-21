import React from 'react';
import type { FractalType } from '../../domain';
import { getFractalTypeNames, getFractalLabel, getFractalConfig } from '../../domain';
import { labelStyle, selectStyle } from '../styles';

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
      <div style={{
        fontSize: '11px',
        color: 'var(--fractal-text-secondary)',
        padding: '8px',
        background: 'var(--fractal-bg-secondary)',
        borderRadius: '6px',
        marginTop: '4px',
        lineHeight: 1.4
      }}>
        <span style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
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
