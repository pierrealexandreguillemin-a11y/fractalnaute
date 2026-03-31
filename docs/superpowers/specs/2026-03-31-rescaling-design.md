# F1: Rescaling — Design Spec

## Problem

GPU perturbation shader uses float32 deltas. At zoom >10^-20, delta values underflow float32 normalized range (1.18e-38) → denormalized → precision loss → visual noise instead of fractal structure.

The orbit computation (WASM) handles arbitrary depth via DD/QD/ArbFloat. The GPU cannot display what the orbit computes.

## Goal

Rescale deltas by S = 2^k so they stay in float32's optimal range (~0.01–1.0). Unlock zoom depth to the orbit precision limit (10^-60 QD, 10^-300+ ArbFloat). No artificial depth cap.

## Scope

- **In:** Mandelbrot + Julia perturbation shaders, all 5 coloring modes, BLA compatibility.
- **Out:** BurningShip/Tricorn/Multibrot perturbation (separate spec, volet 2). Histogram coloring (F2). Video export (F3).

## Design Decisions

| Decision | Choice | Alternative (nice-to-have) |
|---|---|---|
| Rescaling trigger | **Static** — one S per frame, JS-computed uniform | **Dynamic** — per-pixel adaptive S during iteration. Implement if artefacts appear on isolated pixels after rebasing. |
| Depth limit | **None** — user waits, progress bar + cancel | Fixed timeout with warning |
| Coloring modes | **All 5** — z is de-rescaled before coloring | Classic/decomposition first |
| S encoding | **2^k (power of 2)** — exact in IEEE 754 | Arbitrary float (rounding errors) |

## Mathematical Basis

### Standard perturbation (current)

```
δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
z_n = Z_n + δ_n
```

### Rescaled perturbation

Define `δ̃ = δ × S` and `δ̃c = δc × S` where `S = 2^k`.

Multiply both sides by S:

```
δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c
```

Only change: quadratic term divided by S.

Since S = 2^k, division is exact in IEEE 754 (exponent shift, zero mantissa loss).

### Full position (for escape test + coloring)

```
z_n = Z_n + δ̃_n / S
```

Division by S is exact (power of 2). z_n is in real coordinates → all coloring modes work unmodified.

### Derivative (for normalMap/stripe accumulator)

```
δ̃'_{n+1} = 2·(Z'_n·δ̃_n + z_n·δ̃'_n)
```

Derivative is already multiplied by S implicitly (chain rule). The accumulator receives `dz = Z'_n + δ̃'_n / S` in real coordinates.

### Rebasing

Current: when |z|² < G·|Z|² → δ = z, refIter = 0.

Rescaled: `δ̃ = z × S`, refIter = 0. Since z is in real coordinates, multiply by S to get back to rescaled domain.

### BLA compatibility

BLA approximation: `δ̃_{m+L} = A·δ̃_m + B·δ̃c` (linear in δ̃).

The quadratic term (δ̃²/S) is what BLA ignores by definition (linear approximation). So BLA coefficients A, B are unchanged. The validity check needs adjustment:

```
Current:  |δ|² < r²
Rescaled: |δ̃|² / S² < r²  →  |δ̃|² < r² × S²
```

Pass `r² × S²` or compute `|δ̃/S|²` in the lookup. Simpler: multiply r² by S² once per frame via uniform.

### Julia

Same as Mandelbrot but `δ̃c = 0` (c is constant, not per-pixel). `δ̃_0 = (pixel - ref) × S`.

### Calculating S

```javascript
const pixelSpacing = scale / canvasWidth;
const k = Math.max(0, -Math.floor(Math.log2(pixelSpacing)) - 4);
const rescaleS = 2 ** k;  // 1.0 at standard zoom, ~2^40 at 10^-14, ~2^120 at 10^-40
```

The `-4` offset targets δ̃c ≈ 0.06 (well within float32 optimal range). `max(0, ...)` ensures S = 1 at standard zoom (no-op).

## Architecture

### Principle: rescaling is a uniform, not a feature

One `float u_rescaleS` uniform added. JS computes S, passes it. Shader divides quadratic term by S. When S = 1.0 (standard zoom), `δ̃²/S = δ²` — identical behavior. Always active, always neutral at S=1.

### Files modified (5)

| File | Change | Lines |
|---|---|---|
| `domain/types.ts` | Add `rescaleS: number` to OrbitData | 1 |
| `renderer.ts` | Compute S = 2^k, pass in OrbitData | ~5 |
| `shaders/perturbation.ts` | `δ̃²/S` in Mandelbrot + Julia iterate(), rescale init/rebase/escape/derivative | ~15 per chunk |
| `uniformBindings.ts` | Bind `u_rescaleS` uniform | ~3 |
| `shaderCompiler.ts` | Add `'u_rescaleS'` to UNIFORM_NAMES | 1 |

### Files NOT modified

- `bla.ts` — BLA is linear, S only affects quadratic term. Validity check uses `r² × S²` via uniform or computed in lookup.
- `blaTexture.ts` — BLA data unchanged.
- `orbit.worker.ts` — Reference orbit in real coordinates, not rescaled.
- `wasmBridge.ts` — Idem.
- `progressiveController.ts` — Agnostic to render content.
- No new files created.

### No #define, no branch

S=1.0 at standard zoom → `δ̃²/S = δ²/1 = δ²`. Same codepath for all zoom levels. No conditional compilation.

## Data Flow

```
JS (renderer.ts)
  │ pixelSpacing = scale / canvasWidth
  │ k = max(0, -floor(log2(pixelSpacing)) - 4)
  │ rescaleS = 2^k
  │ OrbitData.rescaleS = rescaleS
  │
  ▼
GPU (uniformBindings.ts)
  │ gl.uniform1f(u_rescaleS, rescaleS)
  │
  ▼
GPU (perturbation.ts) — iterate()
  │ // Init: rescale δc and δ₀
  │ dc_re *= u_rescaleS;  dc_im *= u_rescaleS;
  │ u *= u_rescaleS;  v *= u_rescaleS;
  │
  │ // Iteration loop:
  │ //   quadratic: u*u/u_rescaleS, v*v/u_rescaleS
  │ //   linear: 2*(u*O.x - v*O.y) unchanged (already rescaled)
  │ //   constant: dc_re, dc_im (already rescaled)
  │
  │ // Escape: z = O + vec2(u, v) / u_rescaleS
  │ // Rebase: u = z.x * u_rescaleS; v = z.y * u_rescaleS
  │ // Derivative: de-rescale for accumulator
  │
  ▼
GPU (coloring)
  │ z in real coordinates (de-rescaled) → 5 modes unchanged
```

## GLSL Changes (Mandelbrot perturbation)

```glsl
// Before iteration loop:
dc_re *= u_rescaleS;
dc_im *= u_rescaleS;
u *= u_rescaleS;
v *= u_rescaleS;
du *= u_rescaleS;
dv *= u_rescaleS;

// In iteration loop — quadratic term:
float invS = 1.0 / u_rescaleS;  // computed once, exact (power of 2)
float temp_u = u*u*invS - v*v*invS + 2.0*(u*O.x - v*O.y) + dc_re;
v = 2.0*u*v*invS + 2.0*(v*O.x + u*O.y) + dc_im;
u = temp_u;

// Escape test — de-rescale to real coordinates:
z = O + vec2(u, v) * invS;
float zz = z.x*z.x + z.y*z.y;
if (zz > BAILOUT_SQ) { ... }

// Rebase — re-rescale:
u = z.x * u_rescaleS;
v = z.y * u_rescaleS;

// Derivative — de-rescale for accumulator:
dz = nextOrbit.zw + vec2(du, dv) * invS;
updateAccumulator(z, dz, acc);
```

Julia: identical but no `dc_re/dc_im` rescaling (δc = 0).

## BLA Lookup Adjustment

Current: `if (dz2 < entry.r2)` where dz2 = |δ|².

Rescaled: dz2 = |δ̃|² = |δ|² × S². Two options:

**Option A (recommended):** Pass `u_rescaleS2 = S²` as uniform, compare `dz2 < entry.r2 * u_rescaleS2`.

**Option B:** De-rescale before lookup: `blaLookup(refIter, (u*u + v*v) * invS * invS, ...)`.

Option A avoids per-pixel division. One extra uniform, one multiply in lookup.

## ISO Compliance

### ISO 5055
- **Maintainability:** No new files. ~25 lines changed across 5 files. Complexity unchanged (no new branches). `u_rescaleS` is a single uniform — same pattern as `u_scale`.
- **Reliability:** S=1 at standard zoom → zero behavioral change for existing renders. Power-of-2 division is exact in IEEE 754 → no new rounding paths.

### IEEE 754-2019
- S = 2^k: multiplication/division by power of 2 is exact (exponent arithmetic only).
- `invS = 1.0 / S` is exact when S is a power of 2.
- No new NaN/Inf paths (S ≥ 1 always, division by S cannot overflow).

### ISO 9241-110
- No UI change. Zoom just goes deeper.
- Existing progress bar (orbit computation) covers the user wait.
- Cancel via SAB atomics unchanged.

## Testing

### Vitest (3 tests)

1. **rescaleS calculation:** S=1 at zoom 1.0, S=2^40 at zoom ~1e-14, S=2^120 at zoom ~1e-40. Edge: k=0 when pixelSpacing > 0.06.
2. **Shader assembly:** `u_rescaleS` present in compiled perturbation source.
3. **Neutral at S=1:** Rescaled formula with S=1 produces identical output to current formula (pure math test).

### Playwright cross-validation (2 tests)

4. **Parity at 10^-14:** Render with natural S vs forced S=1 → same pixel output (both are in float32 range, rescaling is neutral).
5. **Depth breakthrough at 10^-40:** Render at zoom 10^-40 with 1024 iter at a known exterior point → image has non-black pixels with fractal structure (currently: black noise).

### Manual verification

6. Zoom to 10^-60, 10^-100 via UI → visual inspection of fractal structure.

## Performance Impact

- **GPU:** One `invS` computed per pixel (reciprocal, 1 cycle). 4 extra multiplies per iteration (`*invS`). At 1024 iter: ~4096 extra FMUL = negligible vs existing ~20K FLOP/pixel.
- **JS:** One `Math.log2` + `Math.pow` per frame = negligible.
- **WASM:** Zero change.
- **BLA:** One extra multiply per lookup (`r2 * S2`) = negligible.

## Nice-to-have: Dynamic Per-Pixel Rescaling (Approach B)

If artefacts appear on isolated pixels (e.g., after rebasing to a value much smaller than the global S predicts), implement per-pixel adaptive rescaling:

```glsl
if (abs(u) > 1e18) {
  float correction = 1e-10;
  u *= correction; v *= correction;
  du *= correction; dv *= correction;
  localS *= correction;
}
if (abs(u) < 1e-18 && u_rescaleS > 1.0) {
  float correction = 1e10;
  u *= correction; v *= correction;
  du *= correction; dv *= correction;
  localS *= correction;
}
```

This adds GPU branching (warp divergence). Only implement if static rescaling produces visible artefacts.

## References

- Zhuoran (2021) — "Erta Fractal Explorer", Fractal Forums. Rescaling + rebasing.
- Claude Heiland-Allen (mathr) — deep-zoom.html. Full mathematical spec.
- Karl Runmo — Kalles Fraktaler 2+. Dynamic rescaling, C++/OpenCL. Zoom 10^-10000+.
- Phil Thompson — Very Plotter. Static rescaling, JavaScript/WebGL. Closest to our stack.
