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

interface AppearanceSectionProps {
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
}

const LABEL_CLASS = 'block text-[11px] font-medium tracking-wide uppercase text-muted-foreground mb-1';

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  theme, palette, maxIterations,
  onThemeChange, onPaletteChange, onIterationsChange
}) => (
  <>
    <div className="mb-3.5">
      <label className={LABEL_CLASS}>Thème</label>
      <Select value={theme} onValueChange={(v) => onThemeChange(v as ThemeName)}>
        <SelectTrigger>
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
      <label className={LABEL_CLASS}>Palette de couleurs</label>
      <Select value={palette} onValueChange={(v) => onPaletteChange(v as PaletteName)}>
        <SelectTrigger>
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
      <label className={LABEL_CLASS}>
        Itérations max: {maxIterations}
      </label>
      <Slider
        min={50}
        max={1000}
        step={1}
        value={[maxIterations]}
        onValueChange={([v]) => { if (v !== undefined) onIterationsChange(v); }}
      />
    </div>
  </>
);
