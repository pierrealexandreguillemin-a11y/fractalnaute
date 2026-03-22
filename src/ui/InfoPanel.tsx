/**
 * ===================================================================
 * UI LAYER - InfoPanel
 * ===================================================================
 */

import React from 'react';
import type { RenderStats } from '../domain';
import { glassBaseStyle, monoFontFamily } from './styles';

interface InfoPanelProps {
  stats: RenderStats;
}

const accentValueStyle: React.CSSProperties = {
  color: 'var(--fractal-accent-primary)',
  fontWeight: 500
};

const statItemStyle: React.CSSProperties = { display: 'flex', gap: '4px' };

export const InfoPanel: React.FC<InfoPanelProps> = ({ stats }) => (
  <div
    style={{
      ...glassBaseStyle,
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      padding: '8px 16px',
      fontSize: '11px',
      fontFamily: monoFontFamily,
      color: 'var(--fractal-text-secondary)',
    }}
  >
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      <div style={statItemStyle}>
        <span>Type:</span>
        <span style={accentValueStyle}>{stats.fractalName}</span>
      </div>
      <div style={statItemStyle}>
        <span>Zoom:</span>
        <span style={accentValueStyle}>{stats.zoomLevel.toFixed(2)}x</span>
      </div>
      <div style={statItemStyle}>
        <span>Centre:</span>
        <span style={accentValueStyle}>
          ({stats.centerRe.toFixed(4)}, {stats.centerIm.toFixed(4)})
        </span>
      </div>
    </div>
  </div>
);
