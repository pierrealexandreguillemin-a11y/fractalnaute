/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Julia Section
 * Julia parameter picker and presets
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { FractalParams } from '../../domain';
import { DEFAULT_JULIA_PARAMS, JULIA_PRESETS, formatComplexCoords } from '../../domain';
import { labelStyle, selectStyle, monoFontFamily, buttonStyle } from '../styles';

interface JuliaSectionProps {
  juliaParams: FractalParams;
  isPickingJulia: boolean;
  onJuliaParamsChange: (params: FractalParams) => void;
  onPickJulia: () => void;
}

export const JuliaSection: React.FC<JuliaSectionProps> = ({
  juliaParams,
  isPickingJulia,
  onJuliaParamsChange,
  onPickJulia
}) => {
  const juliaLabel = formatComplexCoords(
    juliaParams.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!,
    juliaParams.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!
  );

  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Paramètre Julia (c)</label>
      <button
        onClick={onPickJulia}
        style={{ ...buttonStyle, width: '100%', marginBottom: '8px' }}
      >
        🎯 Choisir sur Mandelbrot
      </button>

      {isPickingJulia && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--fractal-accent-glow)',
          border: '1px solid var(--fractal-accent-primary)',
          borderRadius: '8px',
          fontSize: '11px',
          textAlign: 'center',
          animation: 'fractal-pulse 1.5s ease-in-out infinite'
        }}>
          Cliquez sur Mandelbrot pour choisir c
          <div style={{
            fontFamily: monoFontFamily,
            fontSize: '10px',
            color: 'var(--fractal-accent-primary)',
            marginTop: '4px'
          }}>
            {juliaLabel}
          </div>
        </div>
      )}

      <div style={{ marginTop: '8px' }}>
        <label style={labelStyle}>Presets Julia</label>
        <select
          onChange={(e) => {
            if (e.target.value) {
              const [re, im] = e.target.value.split(',').map(Number);
              onJuliaParamsChange({ juliaRe: re, juliaIm: im });
            }
          }}
          style={selectStyle}
          defaultValue=""
        >
          <option value="">Personnalisé</option>
          {JULIA_PRESETS.map((preset) => (
            <option key={preset.name} value={`${preset.re},${preset.im}`}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
