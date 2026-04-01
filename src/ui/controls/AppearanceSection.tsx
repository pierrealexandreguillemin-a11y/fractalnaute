/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Appearance Section
 * Theme, palette, and iterations controls
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { ThemeName, PaletteName } from '../../domain';
import { getPaletteNames, getPaletteLabel } from '../../domain';
import { getThemeLabel, getThemeNames } from '../themes';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { LABEL_CLASS } from './shared';

interface AppearanceSectionProps {
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
}

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  theme, palette, maxIterations,
  onThemeChange, onPaletteChange, onIterationsChange
}) => (
  <fieldset className="border-0 p-0 m-0">
    <legend className={LABEL_CLASS}>Apparence</legend>

    <div className="mb-3.5">
      <label id="theme-label" className={LABEL_CLASS}>Thème</label>
      <Select value={theme} onValueChange={(v) => onThemeChange(v as ThemeName)}>
        <SelectTrigger aria-labelledby="theme-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {getThemeNames().map((t) => (
            <SelectItem key={t} value={t}>{getThemeLabel(t)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="mb-3.5">
      <label id="palette-label" className={LABEL_CLASS}>Palette de couleurs</label>
      <Select value={palette} onValueChange={(v) => onPaletteChange(v as PaletteName)}>
        <SelectTrigger aria-labelledby="palette-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {getPaletteNames().map((p) => (
            <SelectItem key={p} value={p}>{getPaletteLabel(p)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="mb-3.5">
      <label id="iterations-label" className={LABEL_CLASS}>
        Itérations min: {maxIterations}
      </label>
      <Slider
        aria-labelledby="iterations-label"
        min={0}
        max={100}
        step={1}
        value={[Math.round(Math.log2(Math.max(50, maxIterations)) / Math.log2(100000) * 100)]}
        onValueChange={([v]) => {
          if (v !== undefined) {
            const iter = Math.round(Math.pow(100000, v / 100));
            onIterationsChange(Math.max(50, Math.min(100000, iter)));
          }
        }}
      />
    </div>
  </fieldset>
);
