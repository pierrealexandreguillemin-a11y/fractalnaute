/**
 * ===================================================================
 * UI LAYER - InfoPanel
 * ===================================================================
 */

import React from 'react';
import type { RenderStats } from '../domain';
import { cn } from '@/lib/utils';
import { GLASS_PANEL } from './shared';

interface InfoPanelProps {
  stats: RenderStats;
}

/** Format render time: <1ms shown as "<1ms", else rounded */
function formatRenderTime(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ stats }) => (
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
