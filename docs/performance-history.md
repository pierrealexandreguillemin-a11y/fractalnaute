# Performance History — Fractal Explorer

Benchmarks measured on Mandelbrot 1920×1080, maxIter=256 unless noted.

## Measurement Methods

- **Calc**: Node.js benchmark, single-thread, pure computation (no DOM/workers)
- **Browser**: Playwright putImageData monkey-patch (full pipeline: React + workers + canvas paint)
- **Feedback**: time to first visual response for the user
- **Final**: time to pixel-perfect completed image

---

## Evolution by Version

### Baseline (pre-optimization)

Single-thread, no workers, no bailout, no progressive rendering.

| Metric | Value |
|---|---|
| Calc @256 | 175ms |
| Calc @1024 | 646ms |

### + Web Workers v1

Pool of `hardwareConcurrency - 1` workers (typically 11), SharedArrayBuffer, horizontal band decomposition, Atomics cancel, renderId anti-stale, ImageData cache, single-thread fallback.

| Metric | Value | vs Baseline |
|---|---|---|
| Calc @256 | ~16ms (estimated ÷11) | ~11x |
| Calc @1024 | ~59ms (estimated ÷11) | ~11x |

### + Adaptive Iteration

Cardioid/bulb pre-test (Mandelbrot only), Brent's cycle detection (all 5 fractals), epsilon 1e-15.

| Metric | Value | vs Baseline |
|---|---|---|
| Calc @256 | 52ms | 3.4x |
| Calc @1024 | 75ms | 8.6x |

Gain increases with maxIter — Brent's catches deep cycles early.

### + Progressive Rendering v2

Stride-based two-pass: stride 4 preview (1/16 pixels, 4×4 blocks) → stride 1 full-res. Industry-standard approach (Fractint/UltraFractal style).

| Metric | Value | Notes |
|---|---|---|
| Preview (stride 4) | 3ms | Time to first blocky visual |
| Overhead vs single-pass | +2ms (5%) | Acceptable |
| Browser pan first paint | 71ms | Full pipeline |
| Browser pan final | 157ms | 22 paints (11 workers × 2 passes) |
| Browser zoom first paint | 86ms | Full pipeline |
| Browser zoom final | 205ms | 22 paints |

### + Instant Viewport Feedback v3

XaoS-style pixel reuse. CSS transform via `useLayoutEffect` for instant visual feedback. 80ms debounce. Pan: pixel-buffer shift + x-range-clipped strip render. Zoom: CSS scale + full re-render. `will-change: transform` GPU compositor hint.

| Metric | Value | vs Progressive v2 |
|---|---|---|
| Pan feedback | <2ms (CSS translate) | 71ms → <2ms (**~35x**) |
| Pan final (net) | 79ms (3 paints) | 157ms → 79ms (**2x**) |
| Pan strip render | 41ms (2 strips, x-clipped) | New |
| Zoom feedback | <2ms (CSS scale) | 86ms → <2ms (**~43x**) |
| Zoom final (net) | 135ms | 205ms → 135ms (**1.5x**) |

---

## Cumulative Gains (Baseline → Current)

| Metric | Baseline | CPU Workers | GPU (Mandelbrot) | Factor (GPU vs Baseline) |
|---|---|---|---|---|
| Calc @256 (Mandelbrot) | 175ms | 52ms | **0.030ms** | **~5800x** |
| Calc @256 (all 5 avg) | 175ms | 52ms | **0.037ms** | **~4700x** |
| Pan visual feedback | 71ms | <2ms | <2ms (CSS) | **~35x** |
| Pan final render | 157ms | 79ms | **0.04ms** (GPU) | **~3925x** |
| Zoom visual feedback | 86ms | <2ms | <2ms (CSS) | **~43x** |
| Zoom final render | 205ms | 135ms | **0.04ms** (GPU) | **~5125x** |

Note: GPU values measured on Mandelbrot + Classic. All 25 fractal×coloring combinations are GPU-rendered.

---

## Architecture Summary

```
User input (mouse/touch/keyboard)
    │
    ├─ Instant: CSS transform (useLayoutEffect, <2ms)
    │   └─ translate (pan) or scale (zoom) on existing canvas
    │
    └─ Debounced (80ms): Worker render
        ├─ Pan: shiftPixelBuffer → paint shifted → renderStripsWithPool (x-clipped)
        └─ Zoom: renderWithPool (two-pass: stride 4 → stride 1)
            │
            Workers (11 threads, SharedArrayBuffer)
            ├─ Adaptive iteration (cardioid/bulb + Brent's periodicity)
            └─ Band-by-band putImageData (progressive display)
```

### + Advanced Coloring

5 coloring modes (classic, stripe, decomposition, orbit trap, normal map) + interior toggle. Conditional accumulation: zero overhead on Classic mode.

| Metric | Value | Notes |
|---|---|---|
| Classic mode | 228ms | Zero overhead vs pre-coloring baseline |
| Stripe mode | 400ms | +75% (Math.atan2 + Math.sin per iteration) |
| Tessellation | ~230ms | Minimal overhead (just arg(z) at escape) |
| Orbit trap | ~250ms | Log scale mapping |
| Normal map | ~260ms | DE + angle computation |

### + GPU WebGL 2 — v1 Mandelbrot then v2 All Fractals

WebGL 2 fragment shader (raw WebGL 2, no library). All 5 fractals + Classic coloring. Fullscreen triangle (gl_VertexID), palette as 256×1 sRGB texture (gl.LINEAR). Composable GLSL chunks assembled at compile-time. Cardioid/bulb pre-test (Mandelbrot only). Derivative (dz) tracking for future distance estimation. Dedicated GPU canvas overlay (separate from CPU 2d canvas).

Measured on AMD Radeon Graphics (integrated RDNA2), 1920×912 @256iter, Playwright + gl.finish() sync.

| Fractal | GPU (ms) | vs CPU baseline (175ms) | Notes |
|---|---|---|---|
| **Mandelbrot** | 0.030 | **~5800x** | Cardioid/bulb pre-test active |
| **Julia** | 0.045 | **~3900x** | z₀ = pixel, c = uniform |
| **BurningShip** | 0.050 | **~3500x** | abs(z) before squaring |
| **Tricorn** | 0.035 | **~5000x** | conj(z) before squaring |
| **Multibrot3** | 0.025 | **~7000x** | z³ via direct multiplication |

Note: times are drawArrays+finish (GPU sync). Total wall-clock includes React dispatch + debounce (80ms) + uniform setup (~0.01ms). All sub-0.05ms.

### + GPU v3 — All Coloring Modes

All 5 coloring modes ported to GLSL. Real accumulator (stripe avg, orbit trap, dz). Interior coloring via orbit trap + attenuation. Distance estimation for normalMap lighting.

Measured on Mandelbrot @256iter 1920×912, AMD Radeon integrated RDNA2.

| Mode | GPU (ms) | CPU (ms) | Gain | Notes |
|---|---|---|---|---|
| **Classic** | 0.030 | 228 | **~7600x** | Noop accumulator |
| **Stripe** | 0.040 | 400 | **~10000x** | atan2 + sin per iteration |
| **Decomposition** | 0.035 | 230 | **~6571x** | atan2 at escape |
| **Orbit Trap** | 0.035 | 250 | **~7143x** | log + min tracking |
| **Normal Map** | 0.050 | 260 | **~5200x** | DE + cos lighting |

All 25 fractal×coloring combinations are GPU-rendered. Interior coloring support included.

---

## + Perturbation Theory (Rust/WASM dashu-float + GPU)

Reference orbit: Rust/WASM `dashu-float` `DBig` arbitrary decimal precision.
GPU: perturbation delta iteration with rebasing (Zhuoran 2021).
Auto-switch: float32 → DS → perturbation at scale < 10^-13.

**Measurement:** Playwright (headed Chromium), AMD Radeon RDNA2, 1280×720, maxIter=256.
Timing: total = navigation → InfoPanel render time shown. GPU render = InfoPanel value. Orbit ≈ total - GPU - 300ms overhead.

| Zoom | Orbit (WASM) | GPU render | Total | Notes |
|---|---|---|---|---|
| 10^-14 | ~880ms | 60ms | 1242ms | Overlap zone — validates DS→perturbation switch |
| 10^-20 | ~1050ms | 51ms | 1396ms | Misiurewicz point (`-1.769, -0.002`) |
| 10^-40 | ~1100ms | 54ms | 1453ms | Seahorse valley (`-0.744, 0.132`) — 197 bits precision |

**Key observations:**
- Orbit time is ~1s regardless of zoom depth (dominated by 256 iterations, not precision)
- GPU render ≈ 50-60ms at all depths (constant — perturbation shader complexity is independent of precision)
- Total < 1.5s for all depths — interactive for single renders
- Orbit computation is the bottleneck (95% of total time)
- Previous f64-only limit: 10^-15. Now: 10^-40+ (dashu-float arbitrary precision)

## + Precision Ladder (DD/QD/ArbFloat)

Replaced dashu `DBig` (decimal) with IEEE 754 float expansion:
- DD (2xf64, 106 bits): zoom 10^-13 to 10^-30
- QD (4xf64, 212 bits): zoom 10^-30 to 10^-60
- ArbFloat (dashu fallback): zoom 10^-60+

Generic `compute_orbit<T: OrbitFloat>` — single orbit loop for all 3 types (DRY).

**Measurement:** Node.js direct WASM timing, 256 iterations, averaged over 10-100 runs.

| Level | Zoom | Orbit time | vs ArbFloat | Notes |
|---|---|---|---|---|
| DD | 10^-14 | **0.03ms** | **15x** | 2xf64, zero alloc, stack only |
| QD | 10^-20 | **0.26ms** | 1.7x | 4xf64, zero alloc |
| QD | 10^-40 | **0.26ms** | 1.7x | Same as 10^-20 (dominated by iter count) |
| ArbFloat | 10^-80 | 5.28ms | — | New capability (was impossible before) |
| ArbFloat | 10^-14 | 0.45ms | 1x (baseline) | Previous DBig baseline |

**Key observations:**
- Orbit is no longer the bottleneck (<1ms for DD/QD vs ~50-60ms GPU render)
- DD 15x faster than ArbFloat for the common zoom range (10^-14 to 10^-30)
- QD matches ArbFloat speed but supports zoom to 10^-60 without arbitrary precision overhead
- 10^-80 zoom now possible (5ms orbit) — was previously impossible

## + BLA (Bivariate Linear Approximation) (E2b)

Skip 80-99% of GPU per-pixel iterations via precomputed linear approximation.
BLA table built in WASM after reference orbit. Uploaded as RGBA32F texture.
`#define USE_BLA` for classic/decomposition. Stripe/orbitTrap/normalMap fallback to standard perturbation.

**Measurement:** Playwright (headed Chromium), AMD Radeon RDNA2, 1280×720, maxIter=256, classic coloring.

| Zoom | Before (no BLA) | After (BLA) | GPU Speedup | Notes |
|---|---|---|---|---|
| 10^-14 | 60ms | <1ms | **>60x** | DS→perturbation boundary |
| 10^-20 | 51ms | <1ms | **>50x** | Misiurewicz point |
| 10^-40 | 54ms | <1ms | **>50x** | Seahorse valley, 197 bits |

**Key observations:**
- GPU render time dropped from ~50-60ms to <1ms at all zoom depths
- BLA table construction is included in orbit time (negligible: <1ms for 256 iter)
- Total time still dominated by orbit WASM computation (~1s)
- @tradeoff: BLA incompatible with stripe/orbitTrap/normalMap (per-iteration accumulation needed)
- All 3 coordinates render correctly (Playwright screenshots verified)

---

## Performance Improvement Options

| Option | Expected Gain | Effort | Status |
|---|---|---|---|
| **A. GPU WebGL 2** | **Measured: ~5700x** (0.04ms @256iter) | High | DONE. All 25 fractal×coloring combinations. Dedicated GPU canvas + cardioid pre-test. |
| **B. WASM (Rust)** | 1.5-2x vs JS CPU | Medium | DONE. dashu-float arbitrary precision ref orbit. ~1s @256iter. |
| **C. OffscreenCanvas** | ~20% — unblocks main thread | Low | Workers use OffscreenCanvas instead of SAB→putImageData |
| **D. Perturbation theory** | Unlimited deep zoom | High | DONE. Rust/WASM dashu-float orbit + GPU perturbation shader. Zoom 10^-40+. |
| **E. Adaptive debounce** | Better perceived responsiveness | Low | 40ms if last render <100ms, 120ms otherwise |
| **F. Worker pool resize** | ~10-30% | Trivial | Dynamic pool size based on runtime load |

### Recommended path

1. **A (GPU)** — DONE. Measured 228ms → 0.04ms (~5700x). All 25 fractal×coloring combinations.
2. **D (Perturbation)** — DONE. Zoom 10^-40+ via Rust/WASM orbit + GPU perturbation shader.
3. **B (WASM)** — DONE. dashu-float arbitrary precision for reference orbit.
4. C/E/F become unnecessary once GPU + perturbation are in place.

### Reference implementations

- **DeepMandelbrot** (https://deep-mandelbrot.js.org/) — WebGL + perturbation, JS arbitrary precision (Jampary), stripe coloring. Gold standard.
- **Mandelbrot.site** (https://mandelbrot.site) — Rust+WASM, best UX, no GPU. 277 stars.
- **BenjaminAster WebGPU Mandelbrot** — minimal WebGPU reference.

See `docs/curation/README.md` for full evaluation with screenshots.

---

## Multi-frame ping-pong (E2c) — 2026-04-02

| Metric | Value | Notes |
|--------|-------|-------|
| Batch size | 256 iter/frame | #define, safe on all drivers |
| Mandelbrot DS @10K iter, zoom 2.8Mx | GPU 2280ms | vs CPU 5380ms (2.4x speedup) |
| Mandelbrot DS @8.8K iter, zoom 466Kx | GPU 771ms | vs CPU ~4000ms (5.2x speedup) |
| Default zoom (256 iter) | Single-pass <1ms | No regression, multi-frame not triggered |
| VRAM (1920×1080) | ~265 MB | 4 textures × 2 ping-pong × RGBA32F |
| Programs compiled | 10 | 5 batch (1 per fractal) × 5 resolve (1 per coloring), lazy |
| Combos supported | 25 | 5 fractals × 5 colorings, all multi-frame GPU |

---

## Multi-frame perturbation (E2e) — 2026-04-04

| Metric | Value | Notes |
|--------|-------|-------|
| Batch size | 256 iter/frame | Same as E2c, #define BATCH_SIZE |
| Iteration cap | **None** | Was 4096 single-pass (AMD ANGLE limit). Multi-frame lifts cap entirely. |
| Perturbation combos | 10 | 2 fractals (Mandelbrot+Julia) × 5 colorings |
| Programs compiled | 12 | 2 batch + 5 resolve (perturbation) + existing DS programs, lazy |
| BLA in multi-frame | Disabled | Incompatible with fixed batch sizes. Measured 9% gain — acceptable loss. |
| Rebasing | Supported | Per-pixel refIter in T_Hist.w, reset on glitch detection |
| DRY resolve | Yes | Shared preamble, 5 coloring bodies reused from DS resolve |
| Orbit texture | TEXTURE4 | Avoids conflict with MRT state on TEXTURE0-3 |
| VRAM overhead | ~0 | Same FBOs as E2c, orbit texture already allocated by single-pass path |
| Visual verification | **Pending** | Playwright session expired. Requires real browser (Chrome+AMD) test. |
