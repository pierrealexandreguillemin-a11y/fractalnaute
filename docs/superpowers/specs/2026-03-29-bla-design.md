# E2b: BLA (Bivariate Linear Approximation) — Design Spec

## Problem

GPU perturbation render = 50-80ms at 256 iterations.
Bottleneck: iteration loop itself (tested: texelFetch stub → no improvement).
At deep zoom (10K+ iterations), render would take seconds.

## Goal

Skip 80-99% of GPU per-pixel iterations via precomputed linear approximation.
Target: 256 iter render <5ms, 10K iter render <50ms.

## Mathematical Basis

When `|δ_n|` is small relative to `|Z_n|`, the perturbation iteration:

```
δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
```

becomes approximately linear (quadratic term negligible):

```
δ_{n+1} ≈ 2·Z_n·δ_n + δc
```

A BLA entry encodes L consecutive linear steps as a single affine transform:

```
δ_{m+L} = A·δ_m + B·δc
```

where A, B are complex coefficients computed from the reference orbit.

### Single-step BLA (level 0)

```
A = 2·Z_m        (complex)
B = 1 + 0i       (complex)
r = ε·|2·Z_m|    (validity radius)
l = 1             (iterations skipped)
```

Valid when `|δ_m| < r`.

### Composition (merge two adjacent BLAs)

Given BLA `x` at iter m (skips l_x) and BLA `y` at iter m+l_x (skips l_y):

```
A_merged = A_y · A_x
B_merged = A_y · B_x + B_y
l_merged = l_x + l_y
r_merged = min(r_x, max(0, (r_y - |B_x|·maxDc) / |A_x|))
```

where `maxDc` = max `|δc|` across all on-screen pixels.

### BLA table: binary tree

- Level 0: M entries, each skips 1 iteration
- Level 1: M/2 entries, each skips 2 iterations (merged pairs)
- Level k: M/2^k entries, each skips 2^k iterations
- Top level: 1 entry, skips ~M iterations
- Total entries: ~2M. After culling levels 0-1: ~M/2

### Per-pixel lookup (`LookupBackwards`)

Find largest valid skip at reference iteration m:

```
k = m - 1
level = number of trailing zeros in binary representation of k
search from level down to first_level:
  if |δ_z|² < r² at this level → apply BLA, skip l iterations
  else → try next lower level
if no BLA valid → do one standard perturbation iteration
```

GLSL: `findLSB(k)` gives trailing zeros. O(log M) per lookup.

### Per-pixel iteration loop (GPU)

```
while iter < maxIter:
  // BLA phase: skip as many iterations as possible
  while (bla = lookup(refIter, |δ_z|²)) != null:
    δ_z = bla.A · δ_z + bla.B · δc    // affine transform
    refIter += bla.l
    iter += bla.l
    z = Z[refIter] + δ_z
    if |z|² > bailout: escape
    // rebase if needed
    if |z|² < |δ_z|²: δ_z = z, refIter = 0

  // Perturbation phase: one standard iteration
  δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
  refIter++; iter++
  // escape + rebase checks
```

## Architecture

### Data flow

```
WASM Worker:
  1. compute_reference_orbit() → Float32Array [Z_re, Z_im, Z'_re, Z'_im] × M
  2. compute_bla_table() → Float32Array [A_re, A_im, B_re, B_im, r², l] × ~M/2
     ↓
JS bridge:
  3. Upload orbit texture (existing)
  4. Upload BLA texture (new)
     ↓
GPU shader:
  5. Per-pixel: BLA lookup → skip → perturbation fallback
```

### Design principles (ISO 5055 maintainability)

**DRY:**
- BLA table construction reuses `OrbitFloat` trait (same orbit data, no duplication)
- BLA GLSL lookup is ONE function called from both Mandelbrot and Julia iterate()
- `getOrbitData(int i)` interface unchanged — BLA adds a parallel lookup, doesn't replace it

**SRP:**
- `bla.rs` = BLA table construction only (input: orbit f32 array, output: BLA f32 array)
- `blaTexture.ts` = BLA texture upload only
- `shaders/bla.ts` = GLSL BLA lookup + application only
- `perturbation.ts` = iterate() gains BLA phase, but the BLA logic is in the imported chunk

**Thin layer:**
- WASM: `compute_bla_table(orbit_data, orbit_length, max_dc, epsilon)` → `Float32Array`
  Pure function. No state. No orbit computation. Just coefficient math.
- GPU: `blaLookup(int refIter, float dz2)` → `BLAEntry` or null.
  Pure function. No state modification.
- JS: `createBlaTexture(gl, blaData, blaEntryCount)` → texture.
  Same pattern as `createOrbitTexture`. Thin wrapper.

### File structure

```
wasm/src/
  bla.rs             — NEW: BLA table construction (pure function, no orbit logic)
  lib.rs             — ADD: compute_bla_table WASM export
  orbit.rs           — UNCHANGED
  dd.rs/qd.rs/arb.rs — UNCHANGED

src/infrastructure/
  wasmBridge.ts      — ADD: computeBlaTable() wrapper
  orbit.worker.ts    — ADD: BLA table computation after orbit

src/infrastructure/gpu/
  blaTexture.ts      — NEW: upload BLA table as RGBA32F texture (thin, like orbitTexture.ts)
  shaders/bla.ts     — NEW: GLSL chunks for BLA lookup + application
  shaders/perturbation.ts — MODIFY: iterate() adds BLA phase before perturbation loop
  webglRenderer.ts   — MODIFY: bind BLA texture + uniforms
  shaderCompiler.ts  — MODIFY: include BLA chunks when precision='perturbation'
```

### BLA texture layout

Each BLA entry = 6 floats: `A_re, A_im, B_re, B_im, r², l_as_float`.
Packed as: 2 RGBA32F texels per entry (8 floats, 2 unused).

Texel 0: `(A_re, A_im, B_re, B_im)`
Texel 1: `(r², l_as_float, level, 0)`

Total texture size: ~M entries × 2 texels = ~2M texels.
At M=10000 (10K iterations): ~20K texels = 160×125 texture = 320KB. Negligible.

### BLA table in WASM (bla.rs)

```rust
/// Compute BLA table from reference orbit f32 data.
///
/// Input: orbit [Z_re, Z_im, Z'_re, Z'_im] × orbit_length (f32)
/// Output: BLA table [A_re, A_im, B_re, B_im, r², l] × entry_count (f32)
///
/// Pure function. No OrbitFloat dependency. Operates on f32 directly.
pub fn compute_bla_table(
    orbit_data: &[f32],
    orbit_length: usize,
    max_dc: f32,         // max |δc| across viewport
    epsilon: f32,        // validity threshold (default 2^-23)
) -> Vec<f32>
```

SRP: this function does NOT compute the orbit. It receives orbit data and produces BLA coefficients. The orbit is computed separately by `compute_orbit<T>`.

### Coloring mode constraint

BLA skips iterations → per-iteration accumulator values lost.

| Coloring mode | BLA compatible | Reason |
|---|---|---|
| classic | Yes | Only uses escape iteration + smoothVal |
| decomposition | Yes | Only uses final z angle |
| stripe | **No** | Needs per-iteration Re·Im/|z|² accumulation |
| orbitTrap | **No** | Needs per-iteration min distance tracking |
| normalMap | **No** | Needs per-iteration derivative accumulation |

**@tradeoff**: BLA disabled for stripe/orbitTrap/normalMap coloring modes.
These modes fall back to standard perturbation (no BLA phase in iterate).
Shader compiler sets `#define USE_BLA` only for compatible modes.

### Epsilon parameter

**@tradeoff**: `epsilon = 2^-23` (float32 mantissa precision).
- Too large → visual artifacts (wrong iteration counts near boundary)
- Too small → fewer iterations skipped (slower)
- FractalShark uses 2^-23. Very Plotter auto-tunes.
- Start with 2^-23, tune later if artifacts appear.

## ISO Compliance

### ISO 5055

- **Reliability**: `bla.rs` uses `deny(clippy::unwrap_used)`. Returns `Vec<f32>` (no Result needed — pure math on valid f32 input). BLA lookup returns null gracefully on failure → standard perturbation fallback.
- **Security**: `forbid(unsafe_code)`. No new dependencies.
- **Performance**: `@tradeoff` on epsilon, coloring constraint, BLA table size O(M). BLA table construction parallelizable per-level (future optimization).
- **Maintainability**: DRY (one lookup function for Mandelbrot + Julia). SRP (bla.rs, blaTexture.ts, shaders/bla.ts each have one job). Thin layers (pure functions, no state). Cognitive complexity: lookup ~10, table construction ~15, iterate modification ~5 (phase addition, not rewrite).

### IEEE 754

- BLA coefficients A, B computed in f32 (GPU precision). No higher precision needed — BLA is an approximation by definition.
- `findLSB()` is a GLSL ES 3.00 built-in. No custom bit manipulation.
- Validity radius comparison `|δ_z|² < r²` uses f32 — consistent with perturbation shader.

### ISO 9241-110

- Cancel/progress: BLA table construction runs in same Worker, same ControlSignal. Cancellable.
- Status: no new UI. Render time in InfoPanel reflects BLA speedup automatically.
- Fallback: if BLA table construction fails → render without BLA (standard perturbation). No error visible to user.

### WCAG 2.1

No UI change. Existing progressbar covers the combined orbit + BLA computation.

## Testing

### WASM unit tests (cargo test)

- `bla.rs`: single-step BLA coefficients match 2·Z_m formula
- `bla.rs`: merge two BLAs produces correct A_merged, B_merged
- `bla.rs`: validity radius shrinks correctly on merge
- `bla.rs`: table entry count = expected for M iterations
- `bla.rs`: BLA application matches brute-force perturbation for simple orbit

### JS unit tests (vitest)

- `blaTexture.ts`: texture dimensions match entry count
- Shader compiler: BLA chunks included for classic/decomposition, excluded for stripe/orbitTrap/normalMap

### Cross-validation

- Render viewport with BLA enabled vs disabled: pixel output must match within f32 tolerance
- Test at 10^-14, 10^-40, 10^-80

### Playwright benchmarks

- Same 3 coordinates. Measure GPU render time before/after BLA.
- Add higher iteration test (maxIter=4096) to see BLA skip benefit.

## Performance Targets

| Metric | Current | Target |
|---|---|---|
| GPU render @256iter (classic) | ~50-80ms | <10ms |
| GPU render @4096iter (classic) | untested (~800ms est.) | <50ms |
| BLA table construction @256iter | N/A | <1ms |
| BLA table construction @10Kiter | N/A | <10ms |
| Iterations skipped per pixel | 0 | 80-99% |

## References

- Phil Thompson — "Bivariate Linear Approximation" (philthompson.me 2023)
- FractalShark — BLA.h, BLAS.cpp, BLAKernels.cuh (GPU CUDA implementation)
- Very Plotter — plots.js (JavaScript BLA implementation)
- mathr (Claude Heiland-Allen) — deep-zoom.html (mathematical specification)
- Zhuoran — Fractal Forums thread (rebasing + BLA interaction)
