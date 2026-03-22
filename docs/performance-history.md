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

| Metric | Baseline | Current | Factor |
|---|---|---|---|
| Calc @256 | 175ms | 52ms | **3.4x** |
| Calc @1024 | 646ms | 75ms | **8.6x** |
| Pan visual feedback | 71ms | <2ms | **~35x** |
| Pan final render | 157ms | 79ms | **2x** |
| Zoom visual feedback | 86ms | <2ms | **~43x** |
| Zoom final render | 205ms | 135ms | **1.5x** |

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

## Next: GPU (WebGL/WebGPU)

Expected: ×100+ gain over CPU workers for pixel computation.
