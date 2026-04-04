# E2e: Multi-Frame Perturbation GPU Rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Lift the 4096 iter cap on perturbation GPU by splitting iteration into 256-iter batches (same ping-pong pattern as E2c for DS). Enables deep zoom 10^-20+ with visible structure.

**Architecture:** Reuse E2c 4-MRT FBO infrastructure. New perturbation-specific batch shaders store δ̃ (delta), δ̃' (derivative), refIter per pixel. DRY resolve: shared `perturbationResolvePreambleChunk` reconstructs z/dz from delta+orbit, then reuses existing resolve coloring body. BLA disabled in multi-frame mode (incompatible with fixed batches). Rebasing supported via per-pixel refIter.

**Scope:** 2 batch shaders (Mandelbrot + Julia) × 5 resolve shaders = 12 programs (lazy compiled). All 10 perturbation×coloring combos.

**Recherche:** Perturbation batching — no prior art. Standard perturbation refs: mathr.co.uk (rebasing, glitch detection), K.I. Martin SuperFractalThing (SA/BLA), Zhuoran "deep-mandelbrot" (GPU perturbation). Ping-pong FBO: same as E2c (ostefani.dev, munrocket/deep-mandelbrot).

---

## Audit 14 normes (source de vérité : CLAUDE.md)

### 7 normes ISO

| # | Norme | Comment le plan adresse |
|---|-------|------------------------|
| 1 | **IEEE 754-2019** | `makeNanInfGuard()` reuse (E2c) dans les 2 batch shaders + guard dans resolve preamble. |
| 2 | **ISO 5055** | ESLint 0 warnings. GLSL helpers reutilises d'E2c (PASSTHROUGH_CHECK, makeNanInfGuard, ACCUMULATOR_UPDATE). Pas de duplication. complexity≤15, lines≤80. |
| 3 | **ISO 25010** | Performance: benchmark Playwright tasks 5, 6, 7. Compatibility: CPU fallback (orbit timeout). Maintainability: SRP (batch/resolve/assembly separes), DRY (preamble partage). |
| 4 | **ISO 9241-110** | Controllability: cancel multi-frame perturbation (existing). Self-descriptiveness: `GPU batch N/M` status (task 6.4). |
| 5 | **ISO 40500 (WCAG)** | aria-live="polite" deja en place (E2c). Verifier pas de regression (task 7). |
| 6 | **ISO 27001** | Pas de nouveau input user. npm audit en pre-push. |
| 7 | **ISO 80000-2** | `@mirror` tags dans chaque batch shader liant a perturbation.ts single-pass. Formules documentees en appendix. |

### 7 normes operationnelles

| # | Norme | Comment le plan adresse |
|---|-------|------------------------|
| 8 | **Playwright benchmarks** | Tasks 5 (smoke test), 6 (integration smoke), 7 (full benchmarks). Render time mesure a chaque step. |
| 9 | **Performance history** | Task 8.3 met a jour `docs/performance-history.md`. |
| 10 | **Meilleur du marche** | Refs: mathr.co.uk rebasing, SuperFractalThing perturbation. @mirror + @see pour chaque formule. |
| 11 | **Verified = preuve** | Task 5.6 (badge GPU visible), task 7 (screenshots). Aucun "done" sans preuve. |
| 12 | **Jamais devier du plan** | Code GLSL fourni. Audit post-implementation. |
| 13 | **Pas de push auto** | Task 8.6 explicite. |
| 14 | **Ton code = tes bugs** | Regression tests inclus (task 7.3 default zoom). |

---

## Contrat — Obligations non-negociables

| # | Obligation | Mesure de succes |
|---|-----------|-----------------|
| 1 | 10 combos perturbation multi-frame | Test assembly non-null (vitest) |
| 2 | Structure visible 10^-20 | Screenshot Playwright (badge GPU) |
| 3 | Pas de regression 10^-14 | Screenshot (meme qualite) |
| 4 | Pas de regression default zoom | Screenshot (<1ms, single-pass DS) |
| 5 | 14 normes respectees | Audit complet ci-dessus |
| 6 | DRY resolve | Preamble partage, pas 5 copies |
| 7 | Fallback CPU | Si EXT absent ou compile fail → CPU |
| 8 | Annulation | Viewport change → cancel → propre |
| 9 | Pas de push auto | Commit local seulement |

---

## Quality Gates — apres CHAQUE step "Verify"

```bash
npm run typecheck && npm run lint && npm test
```

**Si un gate echoue → fix AVANT commit. Jamais d'exception.**

---

## DoD par Task

1. Code + tests TDD (RED→GREEN quand applicable)
2. QG passent (0 erreurs)
3. Commit conventionnel (hooks passent)
4. Compteur tests ≥ precedent
5. Pas de `git push` (commit local seulement)

## DoD Finale

| # | Critere | Preuve requise |
|---|---------|---------------|
| 1 | 10^-20 structure visible | Screenshot (badge GPU, perturbation) |
| 2 | 10^-14 no regression | Screenshot (meme qualite que DS) |
| 3 | Default zoom intact <1ms | Screenshot (single-pass DS) |
| 4 | All 10 perturbation×coloring combos | Assembly test non-null |
| 5 | `npm run build` pass | Console output |
| 6 | Tests ≥ 262 | `npm test` output |
| 7 | Performance-history.md | Diff dans commit |
| 8 | Pas de push | Attendre instruction |

---

## State Layout (4 MRT × RGBA32F)

| Texture | R | G | B | A |
|---------|---|---|---|---|
| **T_Z** (loc=0) | u (δ̃.re) | v (δ̃.im) | du (δ̃'.re) | dv (δ̃'.im) |
| **T_Info** (loc=1) | float(iter) | float(escaped) | smoothVal | float(count) |
| **T_Acc** (loc=2) | z.x | z.y | stripeSum | trapDistSq |
| **T_Hist** (loc=3) | stripePrev1 | stripePrev2 | stripePrev3 | float(refIter) |

- T_Z stores **rescaled** perturbation state (u,v multiplied by S)
- T_Acc.xy stores the **full position** z = O + (u,v)/S (recomputed each iter for accumulator + resolve)
- T_Hist.w stores **refIter** per pixel (can be reset by rebasing)

## Uniforms

**Batch:** u_center, u_scale, u_centerLo, u_scaleLo (DS for c_pixel), u_resolution, u_prevZ/Info/Acc/Hist, u_totalMaxIter, u_bailoutSq, u_orbitTexture, u_orbitLength, u_orbitTexSize, u_refPoint, u_refPointLo, u_rescaleS, u_rescaleS2, u_juliaRe/Im (Julia only)

**Resolve:** u_stateZ/Info/Acc/Hist, u_palette, u_interiorColoring, u_rescaleS

## Differences from E2c DS

| Aspect | E2c DS | E2e Perturbation |
|--------|--------|-----------------|
| T_Z content | DS z (hi+lo pairs) | δ̃, δ̃' (perturbation delta+derivative) |
| T_Hist.w | 0 (unused) | refIter (orbit index) |
| T_Acc.xy | dz.x, dz.y | z.x, z.y (full position) |
| Orbit texture | none | bound to TEXTURE4 (batch) |
| BLA | n/a | disabled (incompatible with fixed batches) |
| Rebasing | n/a | supported (refIter reset per pixel) |
| Resolve z source | T_Z (DS decode) | T_Acc.xy (stored directly) |
| Resolve dz source | T_Acc.xy | T_Z.zw / u_rescaleS |

## DRY Strategy — Resolve Shaders

**Problem:** 5 resolve coloring bodies are identical between DS and perturbation. Only the preamble (z/dz source) differs.

**Solution:** `perturbationResolvePreambleChunk` is injected BEFORE the existing resolve coloring body. It overrides `z` and `dz` variables:

```glsl
// perturbationResolvePreambleChunk — injected before coloring body
// @mirror perturbation.ts — reconstruct z/dz from delta+orbit
vec2 z = sAcc.xy;                          // full position (stored by batch)
float invS = 1.0 / u_rescaleS;
vec2 dz = sZ.zw * invS;                   // dz = (du, dv) / S
```

The resolve assembly becomes: `resolveHeader + RESOLVE_DEFINES + perturbationPreamble + resolveColoringBody`.

No code duplication — same 5 coloring bodies reused.

---

## File Structure

| File | Role |
|------|------|
| **Modify:** `shaders/multiFrame.ts` | +perturbation batch header, +2 batch chunks (Mandelbrot/Julia), +resolve preamble |
| **Modify:** `shaderCompiler.ts` | +assembleMultiFramePerturbationBatchSource, +assembleMultiFramePerturbationResolveSource, +Record maps |
| **Modify:** `multiFrameRenderer.ts` | +perturbation uniforms in batch, +orbit texture binding, +u_rescaleS in resolve |
| **Modify:** `webglRenderer.ts` | +extend renderMultiFrame to accept orbitData |
| **Modify:** `renderer.ts` | Route perturbation → multi-frame when >4096 iter |
| **Modify:** `perturbationRenderer.ts` | Remove 4096 cap, use renderMultiFrame |
| **Modify:** `__tests__/multiFrameShader.test.ts` | +20 tests assembly |

---

## Tasks

### Task 1: Perturbation Batch GLSL — Mandelbrot

**Files:** `shaders/multiFrame.ts`
**DoD:** Mandelbrot perturbation batch main() chunk. Reuses E2c helpers (PASSTHROUGH_CHECK, makeNanInfGuard, ACCUMULATOR_UPDATE). @mirror tags to perturbation.ts. QG pass.

- [ ] 1.1: `perturbationBatchHeaderChunk` — orbit uniforms + `getOrbitData(i)` function. Reuse from `perturbation.ts:orbitLookupChunk` pattern. @mirror perturbation.ts:21-26.
- [ ] 1.2: `mandelbrotPerturbationBatchChunk` — main() with:
  - READ_PREV_STATE (reuse multiFrame.ts pattern)
  - PASSTHROUGH_CHECK (reuse multiFrame.ts:53-56)
  - screenToComplexDS for c_pixel (@mirror shaders/doubleSingle.ts)
  - δc = c_pixel - refPoint (DS subtraction), δ̃c = δc × S (@mirror perturbation.ts:59-65)
  - Init at prevIter==0: u=δ̃c.re, v=δ̃c.im, du=S, dv=0, refIter=0 (@mirror perturbation.ts:68-75)
  - Loop `i < BATCH_SIZE`:
    - `if (refIter >= u_orbitLength) break` (@mirror perturbation.ts:84)
    - Orbit lookup → O.xy, dO.xy (@mirror perturbation.ts:86-88)
    - z = O + (u,v)/S (@mirror perturbation.ts:90-91)
    - Escape test on z → write MRT + return (@mirror perturbation.ts:100-105)
    - Rebasing: |z|² < 1e-6·|O|² → reset δ̃ = z·S, refIter=0 (@mirror perturbation.ts:107-116)
    - δ̃' update (@mirror perturbation.ts:118-122)
    - δ̃ update (@mirror perturbation.ts:124-127)
    - refIter++ (@mirror perturbation.ts:129)
    - ACCUMULATOR_UPDATE with full z (reuse multiFrame.ts:70-75)
  - `makeNanInfGuard('z')` (reuse E2c pattern) — IEEE 754-2019
  - Write MRT: T_Z(u,v,du,dv), T_Info(iter,escaped,smooth,count), T_Acc(z.x,z.y,stripe,trap), T_Hist(sp1,sp2,sp3,refIter)
- [ ] 1.3: Verify QG: `npm run typecheck && npm run lint && npm test`
- [ ] 1.4: Commit `feat(e2e): perturbation batch GLSL — Mandelbrot, rebasing, orbit lookup`

---

### Task 2: Perturbation Batch GLSL — Julia

**Files:** `shaders/multiFrame.ts`
**DoD:** Julia perturbation batch. δc=0. dz=2z·dz (no +1). @mirror perturbation.ts:juliaPerturbationChunk. NaN/Inf guard. QG pass.

- [ ] 2.1: `juliaPerturbationBatchChunk` — same structure as Mandelbrot but:
  - z₀ = screenToComplex (pixel IS z₀, not c) (@mirror perturbation.ts:161-165)
  - δc = 0, δ̃c = 0 (@mirror perturbation.ts:169)
  - Init: u = (z₀ - refPoint) × S, du=S, dv=0 (@mirror perturbation.ts:171-175)
  - δ̃ update: u,v = 2·O·δ̃ + δ̃²/S (no +δ̃c) (@mirror perturbation.ts:220)
  - δ̃' update: du,dv = 2·z·(du,dv) (no +1 in dz, Julia tracks dz/dz₀) (@mirror perturbation.ts:213-218)
  - `makeNanInfGuard('z')` — IEEE 754-2019
- [ ] 2.2: Verify QG
- [ ] 2.3: Commit `feat(e2e): perturbation batch GLSL — Julia`

---

### Task 3: Perturbation Resolve — DRY Preamble + Assembly

**Files:** `shaders/multiFrame.ts`, `shaderCompiler.ts`, `__tests__/multiFrameShader.test.ts`
**DoD:** Shared preamble + 5 resolve compositions. 20 assembly tests (TDD). No code duplication with DS resolve. QG pass.

- [ ] 3.1: `perturbationResolveHeaderChunk` — same as `resolveHeaderChunk` but adds `uniform float u_rescaleS;`
- [ ] 3.2: `perturbationResolvePreambleChunk` — overrides z/dz from delta state:
  ```glsl
  // @mirror perturbation.ts — reconstruct z/dz from stored delta
  vec2 z = sAcc.xy;                   // full position (stored by batch)
  float invS = 1.0 / u_rescaleS;
  vec2 dz = sZ.zw * invS;            // (du, dv) / S
  ```
  + NaN/Inf guard on z (IEEE 754-2019)
- [ ] 3.3: Write 20 tests (RED): 10 batch assembly (2 fractals × 5 colorings non-null) + 10 resolve assembly (2 × 5 checks for preamble + coloring body)
- [ ] 3.4: `MULTI_FRAME_PERTURBATION_BATCH_CHUNKS: Partial<Record<FractalType, string>>` (mandelbrot + julia)
- [ ] 3.5: `assembleMultiFramePerturbationBatchSource(fractal, coloring, interiorColoring)` — perturbation header + BATCH_DEFINE + DS chunks (for c_pixel) + perturbation batch header + orbit lookup + batch chunk
- [ ] 3.6: `assembleMultiFramePerturbationResolveSource(coloring, interiorColoring)` — perturbation resolve header + RESOLVE_DEFINES + preamble + existing resolve coloring body (DRY — reuse `MULTI_FRAME_RESOLVE_CHUNKS[coloring]`)
- [ ] 3.7: Run tests → confirm GREEN (20 new tests)
- [ ] 3.8: Verify QG (tests ≥ 282)
- [ ] 3.9: Commit `feat(e2e): assembly + tests — 10 combos, DRY resolve, TDD`

---

### Task 4: Multi-Frame Controller — Perturbation Support

**Files:** `multiFrameRenderer.ts`
**DoD:** Controller supports perturbation rendering. Orbit texture bound. Lazy compilation. QG pass.

- [ ] 4.1: Extend `setBatchUniforms()` — when orbitData present: bind orbit texture on TEXTURE4, set u_orbitLength, u_orbitTexSize, u_refPoint, u_refPointLo, u_rescaleS, u_rescaleS2
- [ ] 4.2: Extend `renderResolve()` — when perturbation: set u_rescaleS uniform
- [ ] 4.3: Extend `start()` signature: accept `orbitData?: OrbitData` + `precision?: PrecisionMode`. When perturbation, use `assembleMultiFramePerturbationBatchSource` / `assembleMultiFramePerturbationResolveSource` instead of DS assembly.
- [ ] 4.4: Update `clearMrtFbo()` — T_Hist.w = 0 (refIter init), T_Acc.xy = 0 (z init)
- [ ] 4.5: Verify QG
- [ ] 4.6: **Smoke test** — start dev server, navigate to `#dre=LTEuNzQ5OTk4&dim=MC4w&ds=MWUtMTQ%3D`. Verify badge GPU visible. Screenshot = preuve. (Norme 11)
- [ ] 4.7: Commit `feat(e2e): multi-frame controller — perturbation support, orbit binding`

---

### Task 5: Integration — Route Perturbation to Multi-Frame

**Files:** `renderer.ts`, `perturbationRenderer.ts`, `webglRenderer.ts`
**DoD:** Perturbation + high iter → multi-frame perturbation. Remove 4096 cap. Batch progress in status bar. QG pass.

- [ ] 5.1: Remove `PERTURBATION_GPU_MAX_ITER` from `perturbationRenderer.ts`
- [ ] 5.2: In `handleOrbitResult()`: use `gpuRenderer.renderMultiFrame()` with orbitData and precision='perturbation'. Remove single-pass retry loop.
- [ ] 5.3: Extend `renderMultiFrame()` in `webglRenderer.ts` — accept optional orbitData, pass to multi-frame controller `start()`.
- [ ] 5.4: `onBatchProgress` callback for perturbation status bar: `iter: N (auto) — GPU batch X/Y` (ISO 9241-110)
- [ ] 5.5: Verify QG
- [ ] 5.6: **Smoke test** — dev server, navigate 10^-14 deep zoom. Verify badge GPU + batch progress. **Mesurer render time.** Screenshot = preuve. (Normes 8 + 11)
- [ ] 5.7: Commit `feat(e2e): integrate perturbation multi-frame — remove 4096 cap`

---

### Task 6: Visual Verification + Benchmarks

**DoD:** Screenshots at 10^-14 (no regression), 10^-20 (structure visible), default (no regression). Benchmarks mesures. Toute claim = preuve. (Normes 8, 11)

- [ ] 6.1: 10^-14 deep zoom — GPU perturbation, structure visible, badge GPU, **mesurer render time**
- [ ] 6.2: 10^-20 deep zoom — GPU perturbation, structure visible, badge GPU, **mesurer render time**
- [ ] 6.3: Default zoom — no regression (single-pass DS, <1ms)
- [ ] 6.4: `npm run build` pass
- [ ] 6.5: Commit `test(e2e): visual verification — 10^-14, 10^-20, benchmarks`

---

### Task 7: Docs + Performance History

**Files:** `CLAUDE.md`, `docs/performance-history.md`
**DoD:** E2e DONE dans roadmap. Broken promises 1 & 2 updated. Benchmarks dans perf history. QG + build. **PAS DE PUSH.**

- [ ] 7.1: Mark E2e DONE dans CLAUDE.md roadmap
- [ ] 7.2: Update broken promises 1 & 2 status (verified ou non)
- [ ] 7.3: `docs/performance-history.md` — ajouter section E2e avec mesures task 6
- [ ] 7.4: QG + build
- [ ] 7.5: Commit `docs: E2e DONE — perturbation multi-frame, deep zoom 10^-20+`
- [ ] 7.6: **NE PAS PUSH — attendre instruction explicite**

---

## Appendix: Perturbation Formulas

### Mandelbrot Perturbation (batch iteration)

```
Given: O_n (orbit ref), δ̃_n (rescaled delta), S (rescale factor), δ̃_c (rescaled pixel delta)
z_n = O_n + δ̃_n/S                    (full position)     @mirror perturbation.ts:90-91
δ̃_{n+1} = 2·O_n·δ̃_n + δ̃_n²/S + δ̃_c  (rescaled Mandelbrot)  @mirror perturbation.ts:124-127
δ̃'_{n+1} = 2·(O'_n·δ_n/S + z_n·δ̃'_n) (derivative)       @mirror perturbation.ts:118-122
Rebasing: if |z_n|² < 1e-6·|O_n|², set δ̃_n = z_n·S, refIter = 0  @mirror perturbation.ts:107-116
```
Ref: mathr.co.uk rebasing, Heiland-Allen. @see https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html

### Julia Perturbation (batch iteration)

```
Same as Mandelbrot but:
- δ̃_c = 0 (c is constant for Julia)                      @mirror perturbation.ts:169
- δ̃'_{n+1} = 2·z_n·δ̃'_n (no +1 term — dz/dz₀ not dz/dc) @mirror perturbation.ts:213-218
```

### Bailout

| Coloring | u_bailoutSq |
|----------|------------|
| Stripe | 300000.0 (@mirror domain/coloringAccumulator.ts:STRIPE_BAILOUT_SQ) |
| Others | 4.0 |
