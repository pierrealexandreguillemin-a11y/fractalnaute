/**
 * ===================================================================
 * UI LAYER - InfoPanel
 * ===================================================================
 */

import React from 'react';
import type { RenderStats, PrecisionMode } from '../domain';
import { cn } from '@/lib/utils';
import { GLASS_PANEL } from './shared';

interface InfoPanelProps {
  stats: RenderStats;
  precisionMode?: PrecisionMode;
  orbitComputing?: boolean;
  orbitProgress?: number;
  maxIterations?: number;
  onCancelOrbit?: () => void;
  statusMessage?: string | null;
}

/** Format render time: <1ms shown as "<1ms", else rounded */
function formatRenderTime(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({
  stats, precisionMode, orbitComputing, orbitProgress = 0, maxIterations = 1024,
  onCancelOrbit, statusMessage,
}) => (
  <div
    className={cn(
      'absolute bottom-14 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-auto z-10 px-3 py-1.5 sm:px-4 sm:py-2',
      GLASS_PANEL,
      'text-[9px] sm:text-[11px] font-mono text-muted-foreground'
    )}
  >
    <div className="flex gap-4 flex-wrap items-center">
      <StatItem label="Type" value={stats.fractalName} />
      <StatItem label="Zoom" value={`${stats.zoomLevel.toFixed(2)}x`} />
      <StatItem
        label="Centre"
        value={`(${stats.centerRe.toFixed(4)}, ${stats.centerIm.toFixed(4)})`}
      />
      <StatItem label="Render" value={formatRenderTime(stats.renderTime)} />
      {stats.renderBackend && (
        <BackendBadge backend={stats.renderBackend} />
      )}
      {precisionMode && <PrecisionBadge mode={precisionMode} />}
      {orbitComputing && (
        <div className="flex items-center gap-1.5">
          <div
            role="progressbar"
            aria-valuenow={orbitProgress}
            aria-valuemin={0}
            aria-valuemax={maxIterations}
            aria-label="Computing reference orbit"
            className="flex items-center gap-1.5"
          >
            <div className="h-1 w-16 bg-muted-foreground/20 rounded overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{ width: `${Math.min(100, (orbitProgress / maxIterations) * 100)}%` }}
              />
            </div>
            <span className="text-[9px] opacity-60">
              {Math.round((orbitProgress / maxIterations) * 100)}%
            </span>
          </div>
          {onCancelOrbit && (
            <button
              type="button"
              onClick={onCancelOrbit}
              aria-label="Cancel orbit computation"
              className="text-[9px] px-1 py-0.5 rounded border border-current opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      )}
      {statusMessage && (
        <span role="alert" className="text-[9px] text-amber-400/80">
          {statusMessage}
        </span>
      )}
    </div>
  </div>
);

const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-1">
    <span>{label}:</span>
    <span className="text-primary font-medium">{value}</span>
  </div>
);

const BackendBadge: React.FC<{ backend: 'gpu' | 'cpu' }> = ({ backend }) => (
  <span
    className={cn(
      'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
      backend === 'gpu'
        ? 'bg-primary/20 text-primary'
        : 'bg-muted-foreground/20 text-muted-foreground'
    )}
  >
    {backend}
  </span>
);

/** Map precision mode to display label */
function precisionLabel(mode: PrecisionMode): string {
  if (mode === 'doubleSingle') return 'DS';
  if (mode === 'perturbation') return 'Perturbation';
  return '32-bit';
}

const PrecisionBadge: React.FC<{ mode: PrecisionMode }> = ({ mode }) => (
  <span
    aria-live="polite"
    className="text-xs px-1.5 py-0.5 rounded border border-current opacity-60"
    title={mode === 'perturbation'
      ? 'Deep zoom powered by perturbation theory — zoom deeper than 10⁻¹⁵ for fractal structures invisible at lower zoom' : undefined}
  >
    {precisionLabel(mode)}
  </span>
);
