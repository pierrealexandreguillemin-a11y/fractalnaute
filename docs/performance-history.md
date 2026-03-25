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

Note: GPU values are for Mandelbrot + Classic coloring only. Other fractals/coloring modes use CPU Workers fallback.

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

### + GPU WebGL 2 (TWGL) — v1 Mandelbrot then v2 All Fractals

WebGL 2 fragment shader via TWGL.js. All 5 fractals + Classic coloring. Fullscreen triangle (gl_VertexID), palette as 256×1 sRGB texture (gl.LINEAR). Composable GLSL chunks assembled at compile-time. Cardioid/bulb pre-test (Mandelbrot only). Derivative (dz) tracking for future distance estimation. Dedicated GPU canvas overlay (separate from CPU 2d canvas).

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

## Performance Improvement Options

| Option | Expected Gain | Effort | Status |
|---|---|---|---|
| **A. GPU WebGL 2 (TWGL)** | **Measured: ~5700x** (0.04ms @256iter) | High | DONE. Mandelbrot + Classic. Dedicated GPU canvas + cardioid pre-test. |
| **B. WASM (Rust)** | 1.5-2x vs JS CPU | Medium | Only useful for perturbation theory ref orbit, not pixel rendering |
| **C. OffscreenCanvas** | ~20% — unblocks main thread | Low | Workers use OffscreenCanvas instead of SAB→putImageData |
| **D. Perturbation theory** | Unlimited deep zoom | High | JS arbitrary precision (Jampary-style). Only ~3 browser implementations exist. |
| **E. Adaptive debounce** | Better perceived responsiveness | Low | 40ms if last render <100ms, 120ms otherwise |
| **F. Worker pool resize** | ~10-30% | Trivial | Dynamic pool size based on runtime load |

### Recommended path

1. **A (GPU)** — DONE. Measured 228ms → 0.04ms (~5700x). Mandelbrot + Classic only.
2. **D (Perturbation)** — after GPU. Deep zoom beyond float64. DeepMandelbrot proves JS-only is viable.
3. C/E/F become unnecessary once GPU is in place.
4. B (WASM) only for perturbation ref orbit computation if JS perf is insufficient.

### Reference implementations

- **DeepMandelbrot** (https://deep-mandelbrot.js.org/) — WebGL + perturbation, JS arbitrary precision (Jampary), stripe coloring. Gold standard.
- **Mandelbrot.site** (https://mandelbrot.site) — Rust+WASM, best UX, no GPU. 277 stars.
- **BenjaminAster WebGPU Mandelbrot** — minimal WebGPU reference.

See `docs/curation/README.md` for full evaluation with screenshots.
