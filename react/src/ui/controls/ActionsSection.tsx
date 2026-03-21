import React from 'react';
import { buttonStyle } from '../styles';

interface ActionsSectionProps {
  onReset: () => void;
  onExport: () => void;
}

export const ActionsSection: React.FC<ActionsSectionProps> = ({ onReset, onExport }) => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <button
      onClick={onReset}
      style={{
        flex: 1,
        padding: '8px 16px',
        background: 'linear-gradient(135deg, var(--fractal-accent-primary), var(--fractal-accent-secondary))',
        border: 'none',
        borderRadius: '8px',
        color: 'white',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer'
      }}
    >
      🔄 Reset
    </button>
    <button
      onClick={onExport}
      style={{ ...buttonStyle, flex: 1, padding: '8px 16px', fontWeight: 600 }}
    >
      📷 Export
    </button>
  </div>
);
