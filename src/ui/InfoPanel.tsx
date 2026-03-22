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

export const InfoPanel: React.FC<InfoPanelProps> = ({ stats }) => (
  <div
    className={cn(
      'absolute bottom-4 left-4 z-10 px-4 py-2',
      GLASS_PANEL,
      'text-[11px] font-mono text-muted-foreground'
    )}
  >
    <div className="flex gap-4 flex-wrap">
      <StatItem label="Type" value={stats.fractalName} />
      <StatItem label="Zoom" value={`${stats.zoomLevel.toFixed(2)}x`} />
      <StatItem
        label="Centre"
        value={`(${stats.centerRe.toFixed(4)}, ${stats.centerIm.toFixed(4)})`}
      />
    </div>
  </div>
);

const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex gap-1">
    <span>{label}:</span>
    <span className="text-primary font-medium">{value}</span>
  </div>
);
