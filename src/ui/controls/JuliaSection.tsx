/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Julia Section
 * Julia parameter picker and presets
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { FractalParams } from '../../domain';
import { DEFAULT_JULIA_PARAMS, JULIA_PRESETS, formatComplexCoords } from '../../domain';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

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
    <div className="mb-3.5">
      <label className="block text-[11px] font-medium tracking-wide uppercase text-muted-foreground mb-1">
        Paramètre Julia (c)
      </label>
      <Button onClick={onPickJulia} variant="secondary" className="w-full mb-2">
        🎯 Choisir sur Mandelbrot
      </Button>

      {isPickingJulia && (
        <PickingIndicator juliaLabel={juliaLabel} />
      )}

      <JuliaPresetSelect onJuliaParamsChange={onJuliaParamsChange} />
    </div>
  );
};

/** Animated indicator shown while picking Julia parameter */
const PickingIndicator: React.FC<{ juliaLabel: string }> = ({ juliaLabel }) => (
  <div className="p-2 px-3 bg-ring border border-primary rounded-lg text-[11px] text-center animate-[fractal-pulse_1.5s_ease-in-out_infinite]">
    Cliquez sur Mandelbrot pour choisir c
    <div className="font-mono text-[10px] text-primary mt-1">
      {juliaLabel}
    </div>
  </div>
);

/** Julia preset selector */
const JuliaPresetSelect: React.FC<{
  onJuliaParamsChange: (params: FractalParams) => void;
}> = ({ onJuliaParamsChange }) => (
  <div className="mt-2">
    <label className="block text-[11px] font-medium tracking-wide uppercase text-muted-foreground mb-1">
      Presets Julia
    </label>
    <Select
      onValueChange={(v) => {
        const [re, im] = v.split(',').map(Number);
        onJuliaParamsChange({ juliaRe: re, juliaIm: im });
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Personnalisé" />
      </SelectTrigger>
      <SelectContent>
        {JULIA_PRESETS.map((preset) => (
          <SelectItem key={preset.name} value={`${preset.re},${preset.im}`}>
            {preset.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
