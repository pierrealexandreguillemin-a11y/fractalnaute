# Advanced Coloring Modes — Design Spec

**Date**: 2026-03-23
**Goal**: 5 coloring modes + interior toggle for visual parity with DeepMandelbrot, leveraging our existing 5 fractal types and OKLCH color science.

---

## Coloring Modes

1. **Classic** — smooth iteration count → palette LUT (current behavior)
2. **Stripe** — stripe average coloring per Jussi Harkonen: `0.5 * sin(stripe_density * arg(z)) + 0.5` accumulated per iteration, smoothed via linear interpolation of last 2 partial sums using fractional escape count. "Brushed metal" effect.
3. **Decomposition** — binary decomposition via `arg(z)` at escape. Tessellation/checkerboard at boundaries.
4. **Orbit trap** — minimum squared distance from z to trap point (origin) during iteration, sqrt once at finalization. Reveals internal structure.
5. **Normal map** — 3D lighting simulation via distance estimation gradient. Directional light on fractal "surface".

## Interior Toggle

- Checkbox "Interior coloring", off by default
- Off: `rgb(0,0,0)` — black absolute
- On: palette color using normalized `orbitTrapDist` (most visually meaningful for all modes), attenuated to 40%

Independent of coloring mode.

---

## Interior Point Contract

When `escaped === false` (interior points — cardioid/bulb pre-test, Brent's cycle detection, or maxIter reached):

```typescript
const INTERIOR_RESULT: Partial<FractalResult> = {
  stripeValue: 0,
  decompAngle: 0,        // not NaN — avoids silent NaN propagation
  orbitTrapDist: Infinity, // or actual min distance if iterations ran (Brent's)
  distanceEstimate: 0
};
```

- **Cardioid/bulb early exit**: No iterations ran. All accumulator fields get defaults above.
- **Brent's cycle detection**: Iterations ran partially. `orbitTrapDist` preserves the actual minimum distance (useful for interior coloring). `stripeValue` preserves partial accumulation.
- **maxIter reached**: Full iteration ran. All accumulator values are valid.

The coloring layer ALWAYS checks `result.escaped` before using mode-specific values. Interior points use `orbitTrapDist` for `t` when interior coloring is enabled, regardless of mode.

---

## Domain Layer Changes

### `FractalResult` (types.ts)

```typescript
interface FractalResult {
  iterations: number;
  escaped: boolean;
  smoothValue: number;        // existing
  stripeValue: number;        // 0.5*sin(density*arg(z))+0.5 accumulated, smoothed
  decompAngle: number;        // arg(z) at escape, 0 if interior
  orbitTrapDist: number;      // min(|z|) during iteration (sqrt of tracked min |z|²)
  distanceEstimate: number;   // |z|·ln|z| / |dz|, 0 if interior
}
```

Every return path in every calculator MUST return all 7 fields. Define a `INTERIOR_DEFAULTS` constant for the 4 new fields.

### Conditional accumulation (performance)

Accumulating 6 extra values per iteration adds ~60% overhead to the inner loop. This is unacceptable for Classic mode (the default).

**Solution**: Single branch BEFORE the loop, not per-iteration:

```typescript
const needsAccumulation = coloringMode !== 'classic' || interiorColoring;
```

- If `needsAccumulation === false`: skip all accumulation, return `INTERIOR_DEFAULTS` for new fields. Zero overhead on Classic mode.
- If `needsAccumulation === true`: run full accumulation loop.

This means `coloringMode` must be passed to calculators (via params or a separate argument). Two code paths per calculator, but the inner loops share the z-iteration formula (DRY via the existing pattern).

### Derivative formulas per fractal type

Derivatives are computed INLINE in each calculator (not via callback — closures in hot loops risk V8 deopt and GC pressure). Only stripe + trap accumulation is shared via `coloringAccumulator.ts`.

| Fractal | dz update (component form) | Notes |
|---|---|---|
| Mandelbrot | `dzRe' = 2(zRe·dzRe - zIm·dzIm) + 1`<br>`dzIm' = 2(zRe·dzIm + zIm·dzRe)` | Standard complex derivative |
| Julia | `dzRe' = 2(zRe·dzRe - zIm·dzIm)`<br>`dzIm' = 2(zRe·dzIm + zIm·dzRe)` | No +1 (c is constant) |
| Burning Ship | `dzRe' = 2(|zRe|·dzRe - |zIm|·dzIm) + 1`<br>`dzIm' = 2(|zRe|·dzIm + |zIm|·dzRe)` | Uses folded z components `(|Re|, |Im|)`, NOT scalar `|z|` |
| Tricorn | Approximate: `dzRe' = 2(zRe·dzRe + zIm·dzIm) + 1`<br>`dzIm' = 2(-zRe·dzIm + zIm·dzRe)` | **@tradeoff**: Tricorn is anti-holomorphic (conjugation). Standard DE formula `|z|·ln|z|/|dz|` is mathematically invalid. We use an approximate derivative for visual normal mapping purposes. The visual result is aesthetically acceptable but not geometrically exact. |
| Multibrot | `dz = n · z^(n-1) · dz + 1` | `z^(n-1)` captured from the existing power loop's second-to-last iteration (variable `pRe_prev, pIm_prev` before the final multiply). No duplicate computation. |

### Calculator changes (fractals.ts)

Each calculator has two paths:

```typescript
export const calculateMandelbrot: FractalCalculator = (cRe, cIm, maxIter, params) => {
  // ... cardioid/bulb pre-test (returns INTERIOR_DEFAULTS for new fields)

  if (!params._needsAccumulation) {
    // Fast path: current code, no accumulation overhead
    return fastPath(cRe, cIm, maxIter, params);
  }

  // Accumulation path: stripe, trap, derivative
  return accumPath(cRe, cIm, maxIter, params);
};
```

The fast path IS the current code with `INTERIOR_DEFAULTS` spread. The accum path adds the 6 extra accumulators. Both share the same z-iteration formula.

---

## Shared Accumulation Helper

```typescript
// domain/coloringAccumulator.ts — NEW FILE
// Owns: stripe sum, orbit trap tracking, finalization
// Does NOT own: derivative (fractal-specific, inlined in calculators)

interface AccumulatorState {
  stripeSum: number;
  prevStripeSum: number;
  trapDistSq: number;         // squared distance — sqrt once at end
}

function initAccumulator(): AccumulatorState;

// Called per iteration — only stripe + trap (no derivative)
function updateAccumulator(
  state: AccumulatorState,
  zRe: number, zIm: number
): void;

// Called at escape — finalize all coloring values
function finalizeEscape(
  state: AccumulatorState,
  zRe: number, zIm: number,
  dzRe: number, dzIm: number,
  iter: number, smoothValue: number
): { stripeValue: number; decompAngle: number; orbitTrapDist: number; distanceEstimate: number };

// Called for interior points
function finalizeInterior(
  state: AccumulatorState
): { stripeValue: number; decompAngle: number; orbitTrapDist: number; distanceEstimate: number };
```

**SRP boundaries**:
- `fractals.ts` → computes z iteration + derivative (fractal-specific)
- `coloringAccumulator.ts` → observes z for stripe/trap, finalizes coloring data
- `coloringModes.ts` → maps coloring data → palette parameter t

---

## Palette Layer Changes

### `ColoringMode` type (types.ts)

```typescript
type ColoringMode = 'classic' | 'stripe' | 'decomposition' | 'orbitTrap' | 'normalMap';
```

### Color computation

**SRP**: Extract mode-specific mapping into a new file:

```typescript
// domain/coloringModes.ts — NEW FILE

// Maps FractalResult → palette parameter t ∈ [0,1] based on mode
// ALWAYS checks result.escaped first
function mapToColorParam(result: FractalResult, mode: ColoringMode): number;

// For normalMap: returns lightness modifier based on DE gradient
function computeNormalLightness(result: FractalResult, lightAngle: number): number;
```

Interior handling in `getColorFast`:
1. If `!escaped && !interiorColoring` → return `[0, 0, 0]` (black)
2. If `!escaped && interiorColoring` → `t = normalize(result.orbitTrapDist)`, palette at 40% brightness
3. If `escaped` → `t = mapToColorParam(result, mode)`, full palette

### Stripe smooth interpolation

Standard stripe average smoothing uses linear interpolation between last 2 partial sums using fractional escape count `f`:

```typescript
stripeValue = prevStripeSum + f * (stripeSum - prevStripeSum);
// where f = fractional part of smooth iteration count
```

Only 2 data points needed (prevStripeSum, stripeSum). No Catmull-Rom required — the smooth iteration count already provides continuous interpolation.

---

## State Layer Changes

### useFractalState.ts

New state fields:
```typescript
coloringMode: ColoringMode;     // default: 'classic'
interiorColoring: boolean;       // default: false
```

New actions:
```typescript
| { type: 'SET_COLORING_MODE'; mode: ColoringMode }
| { type: 'SET_INTERIOR_COLORING'; enabled: boolean }
```

Both trigger full re-render.

---

## UI Changes

### ControlPanel.tsx

After "Palette de couleurs" select:
- **Select "Mode de coloration"** — 5 options:
  - Classique, Métal brossé, Tessellation, Orbit trap, Éclairage 3D
- **Checkbox "Colorer l'intérieur"** — unchecked by default

If AppearanceSection exceeds 80 lines, extract coloring controls into `ColoringSection.tsx`.

---

## Infrastructure Impact

### renderBand.ts

`BandRenderParams` gains `coloringMode` and `interiorColoring`. These are passed to `getColorFast` AND to the calculator (via `params._needsAccumulation`).

The `_needsAccumulation` flag is computed once in renderBand before the loop:
```typescript
const needsAccum = band.coloringMode !== 'classic' || band.interiorColoring;
const mergedParams = { ...params, _needsAccumulation: needsAccum };
```

### Interface cascade

Adding `coloringMode` + `interiorColoring` requires updating these interfaces (2 fields each):
- `BandRenderParams` (renderBand.ts)
- `WorkerInput` (fractal.worker.ts)
- `RenderOptions` (renderer.ts)
- `CoordinatorRenderOptions` (renderCoordinator.ts)

All pass-through — no logic change.

---

## File Structure

| File | Action | SRP |
|---|---|---|
| `domain/types.ts` | Modify | FractalResult + ColoringMode + INTERIOR_DEFAULTS |
| `domain/coloringAccumulator.ts` | **Create** | Stripe/trap accumulation + finalization (no derivative) |
| `domain/coloringModes.ts` | **Create** | Mode → palette parameter t mapping + normal lighting |
| `domain/fractals.ts` | Modify | Conditional accumulation, inline derivatives |
| `domain/palettes.ts` | Modify | getColorFast delegates to coloringModes |
| `application/useFractalState.ts` | Modify | 2 new state fields + actions |
| `ui/ControlPanel.tsx` | Modify | Select + checkbox (extract section if >80 lines) |
| `infrastructure/renderBand.ts` | Modify | Compute _needsAccumulation, pass to calculator |
| `infrastructure/fractal.worker.ts` | Modify | 2 new fields in message |
| `infrastructure/renderer.ts` | Modify | Pass-through 2 fields |
| `infrastructure/renderCoordinator.ts` | Modify | Pass-through 2 fields |

---

## DRY/SRP Quality Gates

1. **No calculator duplication**: Stripe + trap accumulation shared via `coloringAccumulator.ts`. Derivative is inline (fractal-specific) but follows the same pattern.
2. **No coloring logic in calculators**: Calculators compute z + dz. Accumulator observes z. Coloring maps to color. Three distinct responsibilities.
3. **No per-iteration mode branching**: Single `_needsAccumulation` check before loop. Mode selection in `getColorFast` (once per pixel, outside loop).
4. **getColorFast stays small**: Delegates to `coloringModes.ts`.
5. **FractalResult is the only interface between calculator and coloring**: No other coupling.
6. **INTERIOR_DEFAULTS constant**: Single source of truth for interior field values. Every early-exit path spreads it.
7. **No NaN in results**: All fields are valid numbers. `escaped` flag is the discriminator, not sentinel values.

## Verification Quality Gates

1. `npx tsc --noEmit` — zero errors
2. `npx eslint src/ --max-warnings 0` — zero warnings
3. `npm run build` — succeeds
4. Visual: each of the 5 modes renders distinctly on Mandelbrot default view
5. Visual: interior toggle works (black ↔ colored) on each mode
6. Visual: all 5 fractal types render correctly with each mode
7. Performance: **zero overhead on Classic mode** (conditional accumulation skipped). Accumulation modes: ~60% overhead acceptable.
8. No function exceeds 80 lines (ESLint max-lines-per-function)
9. All calculator early-exit paths return all 7 FractalResult fields (no undefined)
10. Industry audit: stripe vs DeepMandelbrot (Harkonen), decomposition vs Fractint, DE vs Heiland-Allen, normal map vs Shadertoy references, orbit trap vs standard point-trap, OKLCH uniformity preserved across modes
