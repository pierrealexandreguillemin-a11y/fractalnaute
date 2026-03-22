# Web Workers Design Spec

**Goal:** Parallelize fractal rendering across N CPU cores using a SharedArrayBuffer worker pool. Eliminate all intermediate object allocations (FractalResult, RGB tuples). Progressive band-by-band rendering.

**Standard:** SharedArrayBuffer + Atomics (requires COOP/COEP headers, already in place).

## Architecture

### New files

**`src/infrastructure/fractal.worker.ts`** — Web Worker entry point. Receives band assignment + fractal parameters. Computes pixels, writes RGBA directly into SharedArrayBuffer. Posts `band-done` message when complete. Checks cancel flag via `Atomics.load` every line.

**`src/infrastructure/workerPool.ts`** — Pool manager. Creates N workers (`navigator.hardwareConcurrency`). Splits image into N horizontal bands. Distributes work, listens for `band-done` messages, triggers partial `putImageData` for each completed band. Exposes `renderParallel()` and `destroy()`.

### Modified files

**`src/infrastructure/renderer.ts`** — `renderFractal` rewritten to use the worker pool instead of single-threaded chunked rendering.

**`src/infrastructure/useRenderer.ts`** — Adapted for async rendering. Pool stored in `useRef`, created on mount, destroyed on unmount.

## Data flow

```
Main thread                              Workers (×N)
    │                                        │
    ├─ Create/reuse SharedArrayBuffer        │
    │  (width × height × 4 bytes)            │
    ├─ Reset cancel flag (Atomics.store)     │
    │                                        │
    ├─ postMessage({                         │
    │    band: {startY, endY},               │
    │    viewport, fractalType, params,      │
    │    maxIterations, palette,             │
    │    width, height,                      │
    │    sab, cancelFlag                     │
    │  }) ──────────────────────────────────►│
    │                                        ├─ For each pixel in band:
    │                                        │    re = originRe + x * stepRe
    │                                        │    im = originIm + y * stepIm
    │                                        │    iterate fractal
    │                                        │    convert OKLCH → sRGB
    │                                        │    write RGBA to SAB
    │                                        │  Every line: check cancel flag
    │                                        │
    │◄── postMessage({type: 'band-done',     │
    │     startY, endY}) ───────────────────┤
    ├─ putImageData(partial, dirty rect)     │
    │                                        │
    │  ... repeat for each band ...          │
    │                                        │
    ├─ All bands done → onComplete(time)     │
```

## Worker internals

The worker imports domain functions directly (bundled by Next.js/Webpack):
- `calculateMandelbrot`, `calculateJulia`, etc. from `domain/fractals`
- `resolvePalette`, palette functions from `domain/palettes`
- `oklchToRgb` from `domain/color`
- `getFractalConfig` from `domain/fractalTypes`

**Zero allocations in hot path:** The worker does NOT create `FractalResult` objects or `RGB` tuples. Instead, it inlines the calculation:

```
// Pseudocode — actual implementation avoids object creation
iterate → get (iterations, escaped, smoothValue) as locals
if escaped: compute OKLCH → RGB inline, write to SAB
else: write [0, 0, 0, 255] to SAB
```

This requires modifying the calculator functions to accept an output parameter or inlining the logic. Pragmatic approach: keep the current calculator API (returns object) for v1, optimize to zero-alloc in v2 if profiling shows it matters. The SAB direct-write already eliminates the RGB tuple allocation.

## Cancellation

A 1-byte `SharedArrayBuffer` serves as cancel flag:
- Main thread: `Atomics.store(cancelView, 0, 1)` to cancel
- Workers: `if (Atomics.load(cancelView, 0) === 1) return` — checked every line
- Before new render: `Atomics.store(cancelView, 0, 0)` to reset

No worker termination needed. Workers exit their loop early and await next message.

## Memory management

| Resource | Lifecycle | Cleanup |
|----------|-----------|---------|
| Worker pool | Created in `useRef` on mount | `pool.destroy()` in `useEffect` return |
| Pixel SharedArrayBuffer | Created on first render, reused | Recreated only on canvas resize |
| Cancel flag SharedArrayBuffer | Created once with pool | Destroyed with pool |
| Message handlers | Set once per worker at creation | Removed on `worker.terminate()` |

**Resize handling:** When canvas dimensions change, the old SAB is too small/large. Sequence: cancel current render → wait for workers to stop → create new SAB → render with new SAB.

## Progressive rendering

Each worker's `band-done` message triggers a partial `putImageData` on the main thread. The image fills in as bands complete. Bands near the set boundary (more iterations) may finish later, creating a natural progressive fill.

## What does NOT change

- Domain layer (fractals, palettes, color) — unchanged, just imported by workers
- Application layer (state, events) — unchanged
- UI layer — unchanged
- `getColor` / `getColorFast` — still called (inside workers now)
- Canvas interaction (zoom, pan, click) — unchanged, just triggers new renders

## Browser requirements

- SharedArrayBuffer: Chrome 68+, Firefox 79+, Safari 15.2+
- Atomics: same support matrix
- COOP/COEP headers: already configured in `next.config.ts` and `vercel.json`
