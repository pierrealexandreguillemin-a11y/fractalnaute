# Session Handoff — 2026-03-31 (session 2)

## Ce qui a été fait

### High-precision coordinate pipeline — merged sur main
- decimal.js-light (200 digits) for zoom/pan arithmetic in fractalReducer
- Viewport.deepRe/deepIm/deepScale optional string fields
- URL deep params (dre/dim/ds base64) preserve full precision
- renderer.ts passes deep strings to WASM orbit (not number.toString())
- DD/QD Rust: parse via dashu DBig (hi+lo extraction, not f64-only)
- PERTURBATION_THRESHOLD lifted to domain/types.ts (single source)
- Removed dead DeepViewport interface

### ISO conformity fixes (2 rounds of code review)
- Catmull-Rom: reversed coefficients fixed to standard form (GPU+CPU+tests)
- CPU bailout: 1e12 → STRIPE_BAILOUT_SQ (300000), @tradeoff documented
- ImageData cache: module singleton → WeakMap<ctx> (no cross-canvas corruption)
- wasmBridge: activeReject for Promise cleanup on cancel; timeout no double-reject
- workerPool: { type: 'module' } on fractal.worker
- gpuCanvasFactory: @tradeoff tag on preserveDrawingBuffer
- ControlsPanel: type="button" on collapse buttons (WCAG 4.1.2)
- smoothEscapeMod2: dedicated variant for Multibrot mod2
- formatCoord: fix trailing zero stripping in exponent (1e-10 → 1e-1 bug)

### Interactive deep zoom verification
- Verified: zoom 10^23x, perturbation at ~5e-14, <1ms at all depths
- URL encodes 32-digit coords in base64
- Structure visible up to ~10^-14 (1024 iter)
- Beyond 10^-14: flat color (needs >1024 iter at depth)
- Focus-point zoom degrades past 10^-15 (f64 offset → 0)

## Ce qui n'est PAS fait (honest)

1. **Fractal structure at >10^-14** — 1024 iter insufficient, needs iteration auto-scaling
2. **Focus-point zoom past 10^-15** — f64 subtraction focusRe-centerRe → 0. Needs pixel-based offset with Decimal.
3. **BLA speedup measurement** — still no A/B toggle
4. **Playwright tests formalized** — screenshots taken ad-hoc, not CI-ready

## Prochaines étapes

### P0 (bloquants pour deep zoom visible)
1. **Iteration auto-scaling** — maxIter = f(zoom_depth). At 10^-20, need ~10K+ iter.
2. **Focus-point offset via Decimal** — compute offset from pixel coords + scale, not f64 subtraction

### P1 (features à impact UX)
3. **F2: Histogram coloring** — two-pass CDF, eliminates ALL banding
4. **BLA speedup toggle** — ?bla=0 URL param for measurement

### Deprioritised
- E2c ping-pong multi-frame (masque latence)
- Perturbation volet 2 (BurningShip/Tricorn/Multibrot)

## État git
- Branch: main, 7 commits ahead of origin
- 228 vitest, 57 cargo, 0 lint, typecheck clean, build OK
- Pas de push (workflow: JAMAIS push auto)

## Fichiers clés modifiés
```
src/application/deepArithmetic.ts    — NEW: Decimal zoom/pan
src/application/fractalReducer.ts    — deep zoom/pan, deep config fields
src/application/useUrlState.ts       — deep string parsing, formatCoord fix
src/domain/types.ts                  — Viewport.deep*, PERTURBATION_THRESHOLD
src/domain/coloringAccumulator.ts    — Catmull-Rom standard form, @tradeoff
src/domain/fractals.ts               — STRIPE_BAILOUT_SQ, smoothEscapeMod2
src/infrastructure/renderer.ts       — deep strings to WASM, renderPerturbation extract
src/infrastructure/wasmBridge.ts     — activeReject, timeout fix, domain import
src/infrastructure/canvasUtils.ts    — WeakMap<ctx> ImageData cache
src/infrastructure/workerPool.ts     — { type: 'module' }
src/infrastructure/gpu/shaders/index.ts — Catmull-Rom standard form
src/infrastructure/gpu/gpuCanvasFactory.ts — @tradeoff preserveDrawingBuffer
src/ui/ControlsPanel.tsx             — type="button" WCAG
wasm/src/dd.rs                       — DBig hi+lo parsing
wasm/src/qd.rs                       — DBig 4-component parsing
```
