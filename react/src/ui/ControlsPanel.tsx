/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Controls Panel Component
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams } from '../domain';
import {
  getPaletteNames,
  getPaletteLabel,
  getFractalTypeNames,
  getFractalConfig,
  JULIA_PRESETS
} from '../domain';
import { getThemeLabel, getThemeNames } from './themes';
import { glassBaseStyle, dividerStyle, labelStyle, selectStyle } from './styles';

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

const glassPanel: React.CSSProperties = {
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
  const config = getFractalConfig(fractalType);

  const formatJuliaCoords = () => {
    const re = juliaParams.juliaRe ?? -0.7;
    const im = juliaParams.juliaIm ?? 0.27;
    const sign = im >= 0 ? '+' : '';
    return `c = ${re.toFixed(4)} ${sign} ${im.toFixed(4)}i`;
  };

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        style={{
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
        }}
        title="Afficher les contrôles"
      >
        ⚙️
      </button>
    );
  }

  return (
    <div style={glassPanel}>
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

      {/* Fractal Type */}
      <div style={{ marginBottom: '14px' }}>
        <label style={labelStyle}>Type de fractale</label>
        <select
          value={fractalType}
          onChange={(e) => onFractalTypeChange(e.target.value as FractalType)}
          style={selectStyle}
        >
          {getFractalTypeNames().map((type) => (
            <option key={type} value={type}>
              {getFractalConfig(type).name}
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

      {/* Julia Options */}
      {fractalType === 'julia' && (
        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Paramètre Julia (c)</label>
          <button
            onClick={onPickJulia}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--fractal-bg-secondary)',
              border: '1px solid var(--fractal-border-color)',
              borderRadius: '8px',
              color: 'var(--fractal-text-primary)',
              fontSize: '12px',
              cursor: 'pointer',
              marginBottom: '8px'
            }}
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
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: '10px',
                color: 'var(--fractal-accent-primary)',
                marginTop: '4px'
              }}>
                {formatJuliaCoords()}
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
      )}

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Theme */}
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

      {/* Palette */}
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

      {/* Iterations */}
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
            borderRadius: '2px',
            outline: 'none',
            cursor: 'pointer'
          }}
        />
      </div>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Actions */}
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
          style={{
            flex: 1,
            padding: '8px 16px',
            background: 'var(--fractal-bg-secondary)',
            border: '1px solid var(--fractal-border-color)',
            borderRadius: '8px',
            color: 'var(--fractal-text-primary)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          📷 Export
        </button>
      </div>
    </div>
  );
};
