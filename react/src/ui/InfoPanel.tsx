/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - InfoPanel
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { RenderStats } from '../domain';
import { glassBaseStyle } from './styles';

interface InfoPanelProps {
  stats: RenderStats;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ stats }) => (
  <div
    style={{
      ...glassBaseStyle,
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      padding: '8px 16px',
      fontSize: '11px',
      fontFamily: "'SF Mono', 'Fira Code', monospace",
      color: 'var(--fractal-text-secondary)',
    }}
  >
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Type:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          {stats.fractalName}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Zoom:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          {stats.zoomLevel.toFixed(2)}x
        </span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Centre:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          ({stats.centerRe.toFixed(4)}, {stats.centerIm.toFixed(4)})
        </span>
      </div>
    </div>
  </div>
);
