# Advanced Coloring Modes — Design Spec

**Date**: 2026-03-23
**Goal**: 5 coloring modes + interior toggle for visual parity with DeepMandelbrot, leveraging our existing 5 fractal types and OKLCH color science.

---

## Coloring Modes

1. **Classic** — smooth iteration count → palette LUT (current behavior)
2. **Stripe** — stripe average coloring (`Re(z)*Im(z)/|z|²` accumulated), Catmull-Rom interpolated. "Brushed metal" effect.
3. **Decomposition** — binary decomposition via `arg(z)` at escape. Tessellation/checkerboard at boundaries.
4. **Orbit trap** — minimum distance from z to trap point (origin by default) during iteration. Reveals internal structure.
5. **Normal map** — 3D lighting simulation via distance estimation gradient. Directional light on fractal "surface".

## Interior Toggle

- Checkbox "Interior coloring", off by default
- Off: `rgb(0,0,0)` — black absolute
- On: palette color attenuated to 40% opacity over black

Independent of coloring mode.

---

## Domain Layer Changes

### `FractalResult` (types.ts)

```typescript
interface FractalResult {
  iterations: number;
  escaped: boolean;
  smoothValue: number;        // existing
  stripeValue: number;        // Re(z)*Im(z)/|z|² accumulated + smoothed
  decompAngle: number;        // arg(z) at escape, NaN if interior
  orbitTrapDist: number;      // min(|z - origin|) during iteration
  distanceEstimate: number;   // |z|·ln|z| / |dz|, 0 if interior
}
```

All values computed unconditionally — no branching per coloring mode. The mode selects which value to map to color in the palette layer.

### Calculator changes (fractals.ts)

Each of the 5 calculators accumulates ALL values during the iteration loop:

```
Per iteration:
  stripe += |Re(z)*Im(z)| / (|z|²)      // stripe average
  trapDist = min(trapDist, |z|)          // orbit trap (origin)
  dz = 2*z*dz + 1                        // derivative (Mandelbrot)
                                          // varies per fractal type

At escape:
  decompAngle = atan2(zIm, zRe)
  distEst = |z| * ln(|z|) / |dz|
  stripeValue = smooth interpolation of last 2 stripe sums
```

**DRY concern**: The accumulation logic (stripe, trap, derivative) is identical across all 5 calculators. Extract into a shared helper:

```typescript
// domain/coloringAccumulator.ts — NEW FILE
interface AccumulatorState {
  stripeSum: number;
  prevStripeSum: number;
  trapDist: number;
  dzRe: number;
  dzIm: number;
}

function initAccumulator(): AccumulatorState;
function updateAccumulator(state, zRe, zIm, dzRe, dzIm): void;
function finalizeAccumulator(state, zRe, zIm, iter, smoothValue): ColoringData;
```

Each calculator calls `updateAccumulator()` inside its loop and `finalizeAccumulator()` at escape. The derivative update (`dz`) differs per fractal type — passed as parameter or callback.

**SRP**: `fractals.ts` stays focused on the escape-time iteration formula. `coloringAccumulator.ts` owns the coloring data accumulation. Clean boundary: calculator computes z, accumulator observes z.

### Derivative formulas per fractal type

| Fractal | dz update |
|---|---|
| Mandelbrot | `dz = 2·z·dz + 1` |
| Julia | `dz = 2·z·dz` (no +1, c is constant) |
| Burning Ship | `dz = 2·|z|·dz + 1` (absolute values) |
| Tricorn | `dz = 2·conj(z)·dz + 1` (conjugate) |
| Multibrot | `dz = n·z^(n-1)·dz + 1` |

---

## Palette Layer Changes

### `ColoringMode` type (types.ts)

```typescript
type ColoringMode = 'classic' | 'stripe' | 'decomposition' | 'orbitTrap' | 'normalMap';
```

### Color computation (palettes.ts)

**SRP concern**: `getColorFast` currently maps `FractalResult → RGB`. With 5 modes, this function would need a switch statement and grow too large.

Extract mode-specific mapping into a new file:

```typescript
// domain/coloringModes.ts — NEW FILE
// Maps FractalResult → palette parameter t ∈ [0,1] based on mode
function mapToColorParam(result: FractalResult, mode: ColoringMode): number;

// For normalMap: returns modified lightness, not just t
function applyNormalLighting(result: FractalResult, lightAngle: number): number;
```

`getColorFast` calls `mapToColorParam` to get `t`, then does the existing palette lookup. Interior handling: if `!escaped && !interiorColoring`, return black. If `!escaped && interiorColoring`, return palette color at 40%.

### Catmull-Rom smooth interpolation

Replace linear interpolation in stripe mode with Catmull-Rom spline for smoother transitions. This is a pure function in `coloringModes.ts`:

```typescript
function catmullRomInterpolate(p0: number, p1: number, p2: number, p3: number, t: number): number;
```

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

Both trigger a full re-render (new palette params, not viewport-only).

---

## UI Changes

### ControlPanel.tsx

After "Palette de couleurs" select, add:
- **Select "Mode de coloration"** — 5 options with French labels:
  - Classique, Métal brossé, Tessellation, Orbit trap, Éclairage 3D
- **Checkbox "Colorer l'intérieur"** — unchecked by default

---

## Infrastructure Impact

### renderBand.ts

`getColorFast` signature changes to accept `coloringMode` and `interiorColoring`. These are passed through the existing `BandRenderParams` (add 2 fields).

### fractal.worker.ts

Worker message includes `coloringMode` and `interiorColoring` in params. No structural change — just 2 more fields in the message.

---

## File Structure

| File | Action | SRP |
|---|---|---|
| `domain/types.ts` | Modify | Add fields to FractalResult, add ColoringMode type |
| `domain/coloringAccumulator.ts` | **Create** | Stripe/trap/derivative accumulation — shared across all 5 calculators |
| `domain/coloringModes.ts` | **Create** | Mode → palette parameter mapping + Catmull-Rom + normal lighting |
| `domain/fractals.ts` | Modify | Call accumulator in each calculator loop |
| `domain/palettes.ts` | Modify | getColorFast uses coloringModes for mapping |
| `application/useFractalState.ts` | Modify | 2 new state fields + actions |
| `ui/ControlPanel.tsx` | Modify | Select + checkbox |
| `infrastructure/renderBand.ts` | Modify | Pass mode + interior to coloring |
| `infrastructure/fractal.worker.ts` | Modify | 2 new fields in message |

**No monolithic changes.** Two new focused files. Existing files get minimal additions.

---

## DRY/SRP Quality Gates

1. **No calculator duplication**: All 5 calculators use `coloringAccumulator` — no copy-paste of stripe/trap/derivative logic
2. **No coloring logic in calculators**: Calculators compute z. Accumulator observes z. Coloring maps to color. Three distinct responsibilities.
3. **No mode branching in hot loop**: Mode selection happens once in `getColorFast`, not per-iteration
4. **getColorFast stays small**: Delegates to `coloringModes.ts` for mode-specific mapping
5. **FractalResult is the only interface between calculator and coloring**: No other coupling

## Verification Quality Gates

1. `npx tsc --noEmit` — zero errors
2. `npx eslint src/ --max-warnings 0` — zero warnings
3. `npm run build` — succeeds
4. Visual: each of the 5 modes renders distinctly on Mandelbrot default view
5. Visual: interior toggle works (black ↔ colored) on each mode
6. Visual: all 5 fractal types render correctly with each mode
7. Performance: no measurable regression on Classic mode (accumulation overhead < 5%)
8. No function exceeds 80 lines (ESLint max-lines-per-function)
