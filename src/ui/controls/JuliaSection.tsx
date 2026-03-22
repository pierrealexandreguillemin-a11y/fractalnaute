/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Julia Section
 * Julia parameter picker and presets
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import type { FractalParams } from '../../domain';
import { DEFAULT_JULIA_PARAMS, JULIA_PRESETS, formatComplexCoords } from '../../domain';
import { LABEL_CLASS } from './shared';
import { Button } from '@/components/ui/button';

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
      <label className={LABEL_CLASS}>
        Paramètre Julia (c)
      </label>
      <Button onClick={onPickJulia} variant="outline" className="w-full mb-2">
        🎯 Choisir sur Mandelbrot
      </Button>

      {isPickingJulia && (
        <PickingIndicator juliaLabel={juliaLabel} />
      )}

      <JuliaPresetChips onJuliaParamsChange={onJuliaParamsChange} />
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

/** Julia preset chips — direct click instead of dropdown */
const JuliaPresetChips: React.FC<{
  onJuliaParamsChange: (params: FractalParams) => void;
}> = ({ onJuliaParamsChange }) => (
  <div className="mt-2">
    <label className={LABEL_CLASS}>
      Presets
    </label>
    <div className="flex flex-wrap gap-1.5">
      {JULIA_PRESETS.map((preset) => (
        <button
          key={preset.name}
          onClick={() => onJuliaParamsChange({ juliaRe: preset.re, juliaIm: preset.im })}
          className="px-2 py-1 text-[10px] bg-glass-card border border-glass-border rounded-md text-foreground cursor-pointer hover:bg-glass-bg transition-colors"
        >
          {preset.name}
        </button>
      ))}
    </div>
  </div>
);
