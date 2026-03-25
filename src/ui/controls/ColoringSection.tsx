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
import { Checkbox } from '@/components/ui/checkbox';
import { LABEL_CLASS } from './shared';

interface ColoringSectionProps {
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  ssaa: boolean;
  onColoringModeChange: (mode: ColoringMode) => void;
  onInteriorColoringChange: (enabled: boolean) => void;
  onSSAAChange: (enabled: boolean) => void;
}

const COLORING_MODES = Object.keys(COLORING_MODE_LABELS) as ColoringMode[];

/** Short descriptions for each mode */
const MODE_DESCRIPTIONS: Record<ColoringMode, string> = {
  classic: 'Dégradé lisse standard',
  stripe: 'Reflets directionnels métalliques',
  decomposition: 'Damier angulaire aux frontières',
  orbitTrap: 'Distance minimale à l\'origine',
  normalMap: 'Surface 3D avec éclairage directionnel'
};

export const ColoringSection: React.FC<ColoringSectionProps> = ({
  coloringMode, interiorColoring, ssaa,
  onColoringModeChange, onInteriorColoringChange, onSSAAChange
}) => (
  <fieldset className="border-0 p-0 m-0">
    <legend className={LABEL_CLASS}>Coloration</legend>

    <div className="mb-3.5">
      <label id="coloring-mode-label" className={LABEL_CLASS}>Mode de coloration</label>
      <Select value={coloringMode} onValueChange={(v) => onColoringModeChange(v as ColoringMode)}>
        <SelectTrigger aria-labelledby="coloring-mode-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLORING_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              <span>{COLORING_MODE_LABELS[m]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground mt-1">
        {MODE_DESCRIPTIONS[coloringMode]}
      </p>
    </div>

    <div className="flex items-center gap-2 mb-3.5">
      <Checkbox
        id="interior-coloring"
        checked={interiorColoring}
        onCheckedChange={(checked) => onInteriorColoringChange(checked === true)}
      />
      <label
        htmlFor="interior-coloring"
        className="text-sm text-foreground cursor-pointer select-none"
      >
        Colorer l&apos;intérieur
      </label>
    </div>

    <div className="flex items-center gap-2 mb-3.5">
      <Checkbox
        id="ssaa"
        checked={ssaa}
        onCheckedChange={(checked) => onSSAAChange(checked === true)}
      />
      <label
        htmlFor="ssaa"
        className="text-sm text-foreground cursor-pointer select-none"
      >
        Anti-aliasing 2x (SSAA)
      </label>
    </div>
  </fieldset>
);
