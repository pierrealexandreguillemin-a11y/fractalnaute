/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Coloring Section
 * Coloring mode select + interior toggle
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { ColoringMode } from '../../domain';
import { COLORING_MODE_LABELS } from '../../domain/coloringModes';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { LABEL_CLASS } from './shared';

interface ColoringSectionProps {
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  onColoringModeChange: (mode: ColoringMode) => void;
  onInteriorColoringChange: (enabled: boolean) => void;
}

const COLORING_MODES: ColoringMode[] = [
  'classic', 'stripe', 'decomposition', 'orbitTrap', 'normalMap'
];

export const ColoringSection: React.FC<ColoringSectionProps> = ({
  coloringMode, interiorColoring,
  onColoringModeChange, onInteriorColoringChange
}) => (
  <>
    <div className="mb-3.5">
      <label className={LABEL_CLASS}>Mode de coloration</label>
      <Select value={coloringMode} onValueChange={(v) => onColoringModeChange(v as ColoringMode)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLORING_MODES.map((m) => (
            <SelectItem key={m} value={m}>{COLORING_MODE_LABELS[m]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
      <input
        type="checkbox"
        checked={interiorColoring}
        onChange={(e) => onInteriorColoringChange(e.target.checked)}
        className="accent-primary"
      />
      <span className="text-foreground">Colorer l&apos;intérieur</span>
    </label>
  </>
);
