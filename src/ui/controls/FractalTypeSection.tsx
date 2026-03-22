/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Fractal Type Section
 * Selector and info display for fractal type
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { FractalType } from '../../domain';
import { getFractalTypeNames, getFractalLabel, getFractalConfig } from '../../domain';
import { LABEL_CLASS } from './shared';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

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
    <div className="mb-3.5">
      <label className={LABEL_CLASS}>
        Type de fractale
      </label>
      <Select value={fractalType} onValueChange={(v) => onFractalTypeChange(v as FractalType)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {getFractalTypeNames().map((type) => (
            <SelectItem key={type} value={type}>
              {getFractalLabel(type)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-1 text-[11px] text-muted-foreground p-2 bg-glass-card border border-glass-border rounded-md leading-snug">
        <span className="font-mono text-primary text-xs">{config.formula}</span>
        <br />
        {config.description}
      </div>
    </div>
  );
};
