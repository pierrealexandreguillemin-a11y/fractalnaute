# Advanced Coloring Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 coloring modes (classic, stripe, decomposition, orbit trap, normal map) + interior toggle, matching DeepMandelbrot visual quality while leveraging our 5 fractal types and OKLCH color science.

**Architecture:** Domain layer computes all coloring data during iteration (stripe avg, orbit trap, derivative, decomposition angle). Conditional accumulation: zero overhead on Classic mode. Two new files: `coloringAccumulator.ts` (shared observation) and `coloringModes.ts` (mode→color mapping). Interior toggle independent of mode.

**Tech Stack:** TypeScript domain layer, OKLCH palettes, Web Workers + SharedArrayBuffer, Radix UI Select/Checkbox.

**Spec:** `docs/superpowers/specs/2026-03-23-advanced-coloring-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/domain/types.ts` | Modify | `FractalResult` (4 new fields), `ColoringMode` type, `INTERIOR_DEFAULTS` |
| `src/domain/coloringAccumulator.ts` | **Create** | Stripe + trap accumulation, finalize escape/interior. No derivative. |
| `src/domain/coloringModes.ts` | **Create** | `mapToColorParam()`: mode → palette `t`. Normal lighting. |
| `src/domain/fractals.ts` | Modify | Conditional accumulation in all 5 calculators, inline derivatives |
| `src/domain/palettes.ts` | Modify | `getColorFast` accepts mode + interior, delegates to coloringModes |
| `src/domain/index.ts` | Modify | Export new types + functions |
| `src/application/useFractalState.ts` | Modify | 2 new state fields + 2 actions |
| `src/infrastructure/renderBand.ts` | Modify | `BandRenderParams` + 2 fields, compute `_needsAccumulation` |
| `src/infrastructure/fractal.worker.ts` | Modify | 2 new fields in `WorkerInput` |
| `src/infrastructure/renderer.ts` | Modify | Pass-through 2 fields |
| `src/infrastructure/renderCoordinator.ts` | Modify | Pass-through 2 fields in `CoordinatorRenderOptions` |
| `src/ui/controls/ColoringSection.tsx` | **Create** | Select + checkbox UI |
| `src/ui/ControlsPanel.tsx` | Modify | Add ColoringSection |
| `src/useFractalExplorer.ts` | Modify | Wire new state to panel + renderer |

---

## Task 1: Types + ColoringAccumulator

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/coloringAccumulator.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Add ColoringMode + expanded FractalResult + INTERIOR_DEFAULTS to types.ts**

After `FractalParams` interface (line 73), add:

```typescript
/** Available coloring modes */
export type ColoringMode =
  | 'classic'
  | 'stripe'
  | 'decomposition'
  | 'orbitTrap'
  | 'normalMap';
```

Replace `FractalResult` (lines 15-19) with:

```typescript
/** Result of fractal calculation for a single point */
export interface FractalResult {
  iterations: number;
  escaped: boolean;
  smoothValue: number;
  stripeValue: number;
  decompAngle: number;
  orbitTrapDist: number;
  distanceEstimate: number;
}

/** Default values for coloring fields on interior points */
export const INTERIOR_COLORING_DEFAULTS = {
  stripeValue: 0,
  decompAngle: 0,
  orbitTrapDist: Infinity,
  distanceEstimate: 0
} as const;
```

- [ ] **Step 2: Create coloringAccumulator.ts**

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coloring Accumulator
 * Stripe average + orbit trap tracking during fractal iteration.
 * Derivative is NOT here — it's fractal-specific, inlined in calculators.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { INTERIOR_COLORING_DEFAULTS } from './types';

/** Mutable state tracked during iteration */
export interface AccumulatorState {
  stripeSum: number;
  prevStripeSum: number;
  trapDistSq: number;
  count: number;
}

/** Stripe density parameter — controls stripe frequency */
const STRIPE_DENSITY = 5;

export function initAccumulator(): AccumulatorState {
  return { stripeSum: 0, prevStripeSum: 0, trapDistSq: Infinity, count: 0 };
}

/**
 * Update per iteration — called inside the hot loop.
 * Only stripe average + orbit trap. No derivative (fractal-specific).
 */
export function updateAccumulator(
  state: AccumulatorState,
  zRe: number,
  zIm: number
): void {
  // Stripe average: 0.5 * sin(STRIPE_DENSITY * arg(z)) + 0.5
  const arg = Math.atan2(zIm, zRe);
  state.prevStripeSum = state.stripeSum;
  state.stripeSum += 0.5 * Math.sin(STRIPE_DENSITY * arg) + 0.5;
  state.count++;

  // Orbit trap: track min |z|² (sqrt once at finalization)
  const distSq = zRe * zRe + zIm * zIm;
  if (distSq < state.trapDistSq) {
    state.trapDistSq = distSq;
  }
}

/** Finalize for escaped points */
export function finalizeEscape(
  state: AccumulatorState,
  zRe: number,
  zIm: number,
  dzRe: number,
  dzIm: number,
  iter: number,
  smoothValue: number
): {
  stripeValue: number;
  decompAngle: number;
  orbitTrapDist: number;
  distanceEstimate: number;
} {
  // Stripe: smooth interpolation between last 2 partial averages
  const frac = smoothValue - Math.floor(smoothValue);
  const avgPrev = state.count > 1
    ? state.prevStripeSum / (state.count - 1)
    : 0;
  const avgCurr = state.count > 0
    ? state.stripeSum / state.count
    : 0;
  const stripeValue = avgPrev + frac * (avgCurr - avgPrev);

  // Decomposition angle
  const decompAngle = Math.atan2(zIm, zRe);

  // Orbit trap distance (final sqrt)
  const orbitTrapDist = Math.sqrt(state.trapDistSq);

  // Distance estimation: |z| * ln|z| / |dz|
  const zMod = Math.sqrt(zRe * zRe + zIm * zIm);
  const dzMod = Math.sqrt(dzRe * dzRe + dzIm * dzIm);
  const distanceEstimate = dzMod > 0
    ? zMod * Math.log(zMod) / dzMod
    : 0;

  return { stripeValue, decompAngle, orbitTrapDist, distanceEstimate };
}

/** Finalize for interior points (Brent's cycle or maxIter) */
export function finalizeInterior(
  state: AccumulatorState
): {
  stripeValue: number;
  decompAngle: number;
  orbitTrapDist: number;
  distanceEstimate: number;
} {
  return {
    stripeValue: state.count > 0
      ? state.stripeSum / state.count
      : INTERIOR_COLORING_DEFAULTS.stripeValue,
    decompAngle: INTERIOR_COLORING_DEFAULTS.decompAngle,
    orbitTrapDist: state.trapDistSq < Infinity
      ? Math.sqrt(state.trapDistSq)
      : INTERIOR_COLORING_DEFAULTS.orbitTrapDist,
    distanceEstimate: INTERIOR_COLORING_DEFAULTS.distanceEstimate
  };
}
```

- [ ] **Step 3: Update domain/index.ts exports**

Add to exports:

```typescript
export type { ColoringMode } from './types';
export { INTERIOR_COLORING_DEFAULTS } from './types';

export {
  initAccumulator,
  updateAccumulator,
  finalizeEscape,
  finalizeInterior
} from './coloringAccumulator';
```

- [ ] **Step 4: Verify tsc + eslint**

Run: `npx tsc --noEmit && npx eslint src/domain/types.ts src/domain/coloringAccumulator.ts src/domain/index.ts --max-warnings 0`

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/coloringAccumulator.ts src/domain/index.ts
git commit -m "feat(domain): add ColoringMode type, FractalResult fields, coloringAccumulator"
```

---

## Task 2: ColoringModes — mode→color mapping

**Files:**
- Create: `src/domain/coloringModes.ts`
- Modify: `src/domain/palettes.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: Create coloringModes.ts**

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Coloring Modes
 * Maps FractalResult → palette parameter t ∈ [0,1] based on active mode.
 * SRP: mode-specific logic isolated from palette lookup.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FractalResult, ColoringMode } from './types';

/**
 * Map a fractal result to a palette parameter based on coloring mode.
 * Only called for escaped points (caller checks result.escaped).
 */
export function mapToColorParam(
  result: FractalResult,
  mode: ColoringMode
): number {
  switch (mode) {
    case 'classic':
      return (result.smoothValue % 256) / 256;

    case 'stripe':
      return stripeToParam(result);

    case 'decomposition':
      return decompToParam(result);

    case 'orbitTrap':
      return trapToParam(result);

    case 'normalMap':
      return normalToParam(result);

    default:
      return (result.smoothValue % 256) / 256;
  }
}

/** Stripe: modulate base color with stripe value */
function stripeToParam(result: FractalResult): number {
  const base = (result.smoothValue % 256) / 256;
  // Stripe value in [0,1] modulates brightness
  return (base + result.stripeValue * 0.5) % 1;
}

/** Decomposition: binary decomposition via angle */
function decompToParam(result: FractalResult): number {
  const base = (result.smoothValue % 256) / 256;
  // Alternate two color bands based on sign of angle
  const band = result.decompAngle >= 0 ? 0.0 : 0.5;
  return (base * 0.5 + band) % 1;
}

/** Orbit trap: map minimum distance to palette */
function trapToParam(result: FractalResult): number {
  // Clamp distance to [0, 2] range, normalize
  const d = Math.min(result.orbitTrapDist, 2) / 2;
  return d;
}

/** Normal map: use distance estimate for lighting */
function normalToParam(result: FractalResult): number {
  const base = (result.smoothValue % 256) / 256;
  return base;
}

/**
 * Compute lightness modifier for normal map mode.
 * Simulates directional lighting based on distance estimation gradient.
 * @returns multiplier for lightness [0.3, 1.5]
 */
export function computeNormalLightness(
  result: FractalResult,
  lightAngleRad: number
): number {
  if (result.distanceEstimate <= 0) return 1;

  // Use smooth iteration gradient as surface normal approximation
  const angle = Math.atan2(
    result.smoothValue - Math.floor(result.smoothValue),
    result.distanceEstimate
  );
  const dot = Math.cos(angle - lightAngleRad);
  // Remap [-1,1] to [0.3, 1.5] for ambient + diffuse
  return 0.3 + 1.2 * (dot * 0.5 + 0.5);
}

/**
 * Map interior point to palette parameter for interior coloring.
 * Uses orbit trap distance (most visually meaningful across all modes).
 */
export function mapInteriorToParam(result: FractalResult): number {
  if (result.orbitTrapDist === Infinity || result.orbitTrapDist === 0) {
    return 0;
  }
  return Math.min(result.orbitTrapDist, 2) / 2;
}

/** Coloring mode labels (French) */
export const COLORING_MODE_LABELS: Record<ColoringMode, string> = {
  classic: 'Classique',
  stripe: 'Métal brossé',
  decomposition: 'Tessellation',
  orbitTrap: 'Orbit trap',
  normalMap: 'Éclairage 3D'
};
```

- [ ] **Step 2: Update getColorFast in palettes.ts**

Replace `getColorFast` (lines 190-201):

```typescript
/**
 * Get color using a pre-resolved palette (hot path variant).
 * Supports coloring modes and interior coloring.
 */
export function getColorFast(
  result: FractalResult,
  palette: ColorPalette,
  coloringMode: ColoringMode = 'classic',
  interiorColoring: boolean = false
): RGB {
  if (!result.escaped) {
    if (!interiorColoring) return [0, 0, 0];
    // Interior coloring: orbit trap distance → palette at 40%
    const t = mapInteriorToParam(result);
    const oklch = palette(t);
    return oklchToRgb(oklch.L * 0.4, oklch.C * 0.4, oklch.H);
  }

  const t = mapToColorParam(result, coloringMode);
  const oklch = palette(t);

  if (coloringMode === 'normalMap') {
    const lightness = computeNormalLightness(result, -0.7854); // 315° light angle
    return oklchToRgb(
      Math.min(oklch.L * lightness, 1),
      oklch.C,
      oklch.H
    );
  }

  return oklchToRgb(oklch.L, oklch.C, oklch.H);
}
```

Add import at top of palettes.ts:

```typescript
import type { ColoringMode } from './types';
import { mapToColorParam, computeNormalLightness, mapInteriorToParam } from './coloringModes';
```

- [ ] **Step 3: Update domain/index.ts**

Add:

```typescript
export { mapToColorParam, computeNormalLightness, COLORING_MODE_LABELS } from './coloringModes';
```

- [ ] **Step 4: Verify tsc + eslint**

Run: `npx tsc --noEmit && npx eslint src/domain/ --max-warnings 0`

- [ ] **Step 5: Commit**

```bash
git add src/domain/coloringModes.ts src/domain/palettes.ts src/domain/index.ts
git commit -m "feat(domain): add coloringModes — mode→color mapping + interior coloring"
```

---

## Task 3: Calculator accumulation — Mandelbrot + Julia

**Files:**
- Modify: `src/domain/fractals.ts`

Modify `calculateMandelbrot` and `calculateJulia` to support conditional accumulation. Both use the same z²+c formula with different derivative rules.

- [ ] **Step 1: Add accumulator import and _needsAccumulation to FractalParams**

At top of fractals.ts, add:

```typescript
import {
  initAccumulator, updateAccumulator, finalizeEscape, finalizeInterior
} from './coloringAccumulator';
import { INTERIOR_COLORING_DEFAULTS } from './types';
```

Add to `FractalParams` in types.ts:

```typescript
export interface FractalParams {
  juliaRe?: number;
  juliaIm?: number;
  power?: number;
  /** @internal Set by renderBand — do not set manually */
  _needsAccumulation?: boolean;
}
```

- [ ] **Step 2: Modify calculateMandelbrot — add accumulation path**

Replace the entire `calculateMandelbrot` function with two paths. The fast path returns `INTERIOR_COLORING_DEFAULTS` for new fields. The accum path tracks stripe, trap, and derivative.

The derivative for Mandelbrot: `dz' = 2*z*dz + 1` in components:
- `dzRe' = 2*(zRe*dzRe - zIm*dzIm) + 1`
- `dzIm' = 2*(zRe*dzIm + zIm*dzRe)`

- [ ] **Step 3: Modify calculateJulia — add accumulation path**

Same structure. Julia derivative: `dz' = 2*z*dz` (no +1).

- [ ] **Step 4: Verify tsc + eslint**

Run: `npx tsc --noEmit && npx eslint src/domain/fractals.ts --max-warnings 0`

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/fractals.ts
git commit -m "feat(domain): conditional accumulation for Mandelbrot + Julia calculators"
```

---

## Task 4: Calculator accumulation — BurningShip, Tricorn, Multibrot

**Files:**
- Modify: `src/domain/fractals.ts`

- [ ] **Step 1: Modify calculateBurningShip — add accumulation path**

Burning Ship derivative uses FOLDED z components:
- `dzRe' = 2*(|zRe|*dzRe - |zIm|*dzIm) + 1`
- `dzIm' = 2*(|zRe|*dzIm + |zIm|*dzRe)`

- [ ] **Step 2: Modify calculateTricorn — add accumulation path**

Tricorn approximate derivative (anti-holomorphic, @tradeoff documented):
- `dzRe' = 2*(zRe*dzRe + zIm*dzIm) + 1`
- `dzIm' = 2*(-zRe*dzIm + zIm*dzRe)`

- [ ] **Step 3: Modify calculateMultibrot — add accumulation path**

Multibrot derivative: `dz = n * z^(n-1) * dz + 1`. Capture `z^(n-1)` from the power loop's second-to-last multiply.

- [ ] **Step 4: Verify tsc + eslint**

Run: `npx tsc --noEmit && npx eslint src/domain/fractals.ts --max-warnings 0`

- [ ] **Step 5: Commit**

```bash
git add src/domain/fractals.ts
git commit -m "feat(domain): conditional accumulation for BurningShip, Tricorn, Multibrot"
```

---

## Task 5: Infrastructure — pass coloring params through pipeline

**Files:**
- Modify: `src/infrastructure/renderBand.ts`
- Modify: `src/infrastructure/fractal.worker.ts`
- Modify: `src/infrastructure/renderer.ts`
- Modify: `src/infrastructure/renderCoordinator.ts`

- [ ] **Step 1: Add coloringMode + interiorColoring to BandRenderParams**

In renderBand.ts, add to `BandRenderParams`:

```typescript
coloringMode?: ColoringMode;
interiorColoring?: boolean;
```

Import `ColoringMode` from types. In `renderBand()`, compute `_needsAccumulation` and pass to calculator:

```typescript
const coloringMode = band.coloringMode ?? 'classic';
const interiorColoring = band.interiorColoring ?? false;
const needsAccum = coloringMode !== 'classic' || interiorColoring;

// In buildMergedParams call or inline:
const mergedParams = { ...config.params, ...params, _needsAccumulation: needsAccum };
```

Update the `getColorFast` call:

```typescript
const [r, g, b] = getColorFast(result, resolvedPalette, coloringMode, interiorColoring);
```

- [ ] **Step 2: Add fields to WorkerInput**

In fractal.worker.ts, add to `WorkerInput`:

```typescript
coloringMode: ColoringMode;
interiorColoring: boolean;
```

These are spread into renderBand via `...renderParams`.

- [ ] **Step 3: Add fields to RenderOptions + CoordinatorRenderOptions**

In renderer.ts `RenderOptions`, add:
```typescript
coloringMode?: ColoringMode;
interiorColoring?: boolean;
```

In renderCoordinator.ts `CoordinatorRenderOptions`, add the same. Both pass-through to worker/renderBand.

- [ ] **Step 4: Verify tsc + eslint + build**

Run: `npx tsc --noEmit && npx eslint src/infrastructure/ --max-warnings 0 && npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/
git commit -m "feat(infra): pass coloringMode + interiorColoring through render pipeline"
```

---

## Task 6: State — coloringMode + interiorColoring

**Files:**
- Modify: `src/application/useFractalState.ts`

- [ ] **Step 1: Add state fields + actions**

Add to `FractalState`:
```typescript
coloringMode: ColoringMode;
interiorColoring: boolean;
```

Add to `FractalAction`:
```typescript
| { type: 'SET_COLORING_MODE'; mode: ColoringMode }
| { type: 'SET_INTERIOR_COLORING'; enabled: boolean }
```

Add to `initialState`:
```typescript
coloringMode: 'classic',
interiorColoring: false,
```

Add reducer cases:
```typescript
case 'SET_COLORING_MODE':
  return { ...state, coloringMode: action.mode };
case 'SET_INTERIOR_COLORING':
  return { ...state, interiorColoring: action.enabled };
```

Add action creators:
```typescript
const setColoringMode = useCallback((mode: ColoringMode) => {
  dispatch({ type: 'SET_COLORING_MODE', mode });
}, []);
const setInteriorColoring = useCallback((enabled: boolean) => {
  dispatch({ type: 'SET_INTERIOR_COLORING', enabled });
}, []);
```

Export in actions object.

- [ ] **Step 2: Verify tsc + eslint**

- [ ] **Step 3: Commit**

```bash
git add src/application/useFractalState.ts
git commit -m "feat(app): add coloringMode + interiorColoring state"
```

---

## Task 7: UI — ColoringSection

**Files:**
- Create: `src/ui/controls/ColoringSection.tsx`
- Modify: `src/ui/controls/index.ts` (if barrel exists)
- Modify: `src/ui/ControlsPanel.tsx`
- Modify: `src/useFractalExplorer.ts`

- [ ] **Step 1: Create ColoringSection.tsx**

```tsx
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
      Colorer l&apos;intérieur
    </label>
  </>
);
```

- [ ] **Step 2: Wire into ControlsPanel.tsx**

Add `ColoringSection` import. Add props to `ControlsPanelProps`:

```typescript
coloringMode: ColoringMode;
interiorColoring: boolean;
onColoringModeChange: (mode: ColoringMode) => void;
onInteriorColoringChange: (enabled: boolean) => void;
```

Insert after `AppearanceSection` and before the actions separator.

- [ ] **Step 3: Wire in useFractalExplorer.ts**

Pass `state.coloringMode`, `state.interiorColoring` and action creators to ControlsPanel. Pass `coloringMode` and `interiorColoring` to `useRenderer` (→ render pipeline).

- [ ] **Step 4: Verify tsc + eslint + build**

Run: `npx tsc --noEmit && npx eslint src/ --max-warnings 0 && npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/ui/ src/useFractalExplorer.ts
git commit -m "feat(ui): add coloring mode select + interior toggle"
```

---

## Task 8: Visual verification + performance benchmark

- [ ] **Step 1: Navigate to localhost:3000 — verify Classic mode unchanged**

Screenshot Mandelbrot default view with Classic mode. Must be identical to before.

- [ ] **Step 2: Test each coloring mode on Mandelbrot**

Switch through all 5 modes, screenshot each. Verify visually distinct renders:
- Classic: smooth gradient (current look)
- Stripe: metallic/directional shading
- Decomposition: checkerboard/tessellation pattern
- Orbit trap: concentric rings/radial pattern
- Normal map: 3D lit surface

- [ ] **Step 3: Test interior toggle**

Enable "Colorer l'intérieur" — set interior should show muted palette color instead of black. Disable — should return to black.

- [ ] **Step 4: Test all 5 fractal types with Stripe mode**

Switch fractal type (Julia, BurningShip, Tricorn, Multibrot) with Stripe mode active. All must render without errors.

- [ ] **Step 5: Performance benchmark — Classic mode regression**

Measure render time on Classic mode. Must be within 5% of baseline (zero accumulation overhead).

- [ ] **Step 6: Industry audit — compare stripe vs DeepMandelbrot**

Navigate to https://deep-mandelbrot.js.org/, screenshot, compare side-by-side with our stripe mode. Document visual differences.

- [ ] **Step 7: Update CLAUDE.md + commit**

```bash
git add CLAUDE.md
git commit -m "docs: update roadmap — advanced coloring modes done"
```

---

## DoD (Definition of Done)

### DRY/SRP Gates
- [ ] Zero calculator duplication — stripe/trap via `coloringAccumulator.ts`
- [ ] Calculator/observer/color separation — 3 files, 3 responsibilities
- [ ] Zero per-iteration mode branching — `_needsAccumulation` check before loop
- [ ] `getColorFast` delegates to `coloringModes.ts`
- [ ] `INTERIOR_COLORING_DEFAULTS` is single source of truth
- [ ] No NaN in any `FractalResult` field
- [ ] All early-exit paths return all 7 fields

### Verification Gates
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npx eslint src/ --max-warnings 0` — 0 warnings
- [ ] `npm run build` — succeeds
- [ ] Visual: 5 modes distinct on Mandelbrot default view
- [ ] Visual: interior toggle works on each mode
- [ ] Visual: 5 fractal types correct with each mode
- [ ] Perf: zero overhead on Classic mode
- [ ] Max 80 lines per function
- [ ] All early-exit paths return 7 FractalResult fields
- [ ] Industry audit: stripe compared to DeepMandelbrot reference
