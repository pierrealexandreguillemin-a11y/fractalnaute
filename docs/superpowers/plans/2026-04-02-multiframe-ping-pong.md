# E2c: Ping-Pong Multi-Frame GPU Rendering — 25 Combos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Split GPU iteration into 256-iter batches across RAF frames via ping-pong FBOs. 5 fractals × 5 colorings + interior. Removes GPU_MAX_ITER=4096 cap.

**Architecture:** 4 RGBA32F textures per ping-pong set (z, dz, iter, accumulator). Batch shader reads prev state, iterates 256×, writes via MRT. Resolve shader maps state → color. One batch per RAF frame → progressive display. `EXT_color_buffer_float` required (fallback: CPU).

**Scope:** 5 batch shaders (1 DS Mandelbrot + 4 float32) × 5 resolve shaders = 10 programs. 25 combos.

**Recherche:** Pas de publication académique existante pour le multi-frame iteration accumulation fractal. Pattern ping-pong bien documenté (simulations GPU), appliqué ici aux fractales. Refs: [Ping-Pong FBO](https://ostefani.dev/tech-notes/ping-pong-technique), [deep-mandelbrot](https://github.com/munrocket/deep-mandelbrot), [Perturbation Theory](https://philthompson.me/2022/Perturbation-Theory-and-the-Mandelbrot-set.html), [Adaptive rendering](https://gliu20.github.io/blog/programming/2021/12/30/how-i-optimized-my-fractal-viewer/).

---

## Audit 14 normes (source de vérité : CLAUDE.md)

### 7 normes ISO

| # | Norme | Applicable ? | Comment le plan adresse |
|---|-------|-------------|------------------------|
| 1 | **IEEE 754-2019** | OUI | Guards `isnan()`/`isinf()` dans les 5 batch shaders (comme perturbation.ts:95). Pixel NaN/Inf → iter=totalMaxIter, escaped=false (interior). DS twoSum/twoProd inchangés (reused chunks). |
| 2 | **ISO 5055** | OUI | ESLint 0 warnings. complexity≤15, lines≤80, depth≤4, no-nested-functions, no-nested-conditional, no-duplicate-string. Module-level helpers. Record maps. |
| 3 | **ISO 25010** | OUI | Performance: ~1s GPU @16K iter vs 4-5s CPU. Compatibility: EXT_color_buffer_float check, CPU fallback. Reliability: cancel RAF, destroy FBOs. Security: pas de nouveau input string. Maintainability: SRP (FBO/shaders/controller/integration séparés), DRY (@mirror tags). |
| 4 | **ISO 9241-110** | OUI | Controllability: viewport change → cancel multi-frame instantanément. Self-descriptiveness: status bar affiche `GPU (batch N/M)` pendant multi-frame. Conformity: zoom fonctionne pareil à toutes les profondeurs. |
| 5 | **ISO 40500 (WCAG 2.1)** | OUI | Multi-frame progress: `aria-live="polite"` sur status message batch. Pas de freeze UI (1 batch/RAF = 16ms max). Cancel via navigation (existant). |
| 6 | **ISO 27001** | PARTIEL | Pas de nouveau input user. EXT check = validation GPU capability. CSP inchangé. `npm audit` vérifié en pre-push. N/A pour cargo (pas de nouveau Rust). |
| 7 | **ISO 80000-2** | OUI | `@mirror` tags dans chaque batch shader liant à la formule (ex: `@mirror domain/fractals.ts:mandelbrotFastPath`). Variables GLSL documentées (ds_zre ≡ Re(z) hi+lo). |

### 7 normes opérationnelles

| # | Norme | Applicable ? | Comment le plan adresse |
|---|-------|-------------|------------------------|
| 8 | **Playwright benchmarks** | OUI | Task 7 mesure render time à CHAQUE combo testé. Benchmarks ajoutés aussi à Task 5 (controller smoke test). |
| 9 | **Performance history** | OUI | Task 8 met à jour `docs/performance-history.md` avec mesures multi-frame (ms/batch, total @16K iter, comparaison CPU). |
| 10 | **Meilleur du marché** | OUI | Formules auditées vs code existant (appendix). Code existant déjà audité vs deep-mandelbrot/mandelbrot.page. Multi-frame = même formules, split en batches. Pas de dégradation. |
| 11 | **Verified = preuve** | OUI | Chaque task significative (3, 5, 6) inclut un step "verify" avec output QG visible. Task 7 = screenshots. Aucun "done" sans preuve. |
| 12 | **Jamais dévier du plan** | OUI | Code GLSL fourni dans les steps (pas "see above"). Chaque step est auto-suffisant. Audit post-implémentation contre le plan. |
| 13 | **Pas de push auto** | OUI | Le plan ne contient aucun `git push`. Dernier step = "attendre instruction push". |
| 14 | **Ton code = tes bugs** | OUI | Si multi-frame casse un combo existant, c'est une régression à corriger dans le plan, pas "hors scope". |

---

## Contrat — Obligations non-négociables

| # | Obligation | Mesure de succès |
|---|-----------|-----------------|
| 1 | 25 combos GPU multi-frame | Test assembly non-null pour les 25 (testé vitest) |
| 2 | Zoom infini | Pas de cap iter — GPU gère 32768+ via batches 256 |
| 3 | Mur cassé | Screenshot Playwright : détail à 2 coords différentes |
| 4 | Toutes les branches colorées | Pixels loin du set échappent dans premiers batches |
| 5 | 14 normes respectées | Audit complet ci-dessus, vérifié à chaque task |
| 6 | Pas de régression | 228+ tests, build prod OK, single-pass intact |
| 7 | Fallback CPU | Si EXT absent ou compile fail → CPU transparently |
| 8 | Annulation | Viewport change → cancel RAF → nouveau render propre |
| 9 | Pas de push auto | Commit local seulement — attendre instruction |

---

## Quality Gates — après CHAQUE step "Verify"

```bash
npm run typecheck && npm run lint && npm test
```

**Si un gate échoue → fix AVANT commit. Jamais d'exception.**

---

## DoD par Task

1. Code + tests TDD (RED→GREEN quand applicable)
2. QG passent (0 erreurs)
3. Commit conventionnel (hooks passent)
4. Compteur tests ≥ précédent
5. Pas de `git push` (commit local seulement)

## DoD Finale

| # | Critère | Preuve requise |
|---|---------|---------------|
| 1 | Mur cassé `(-1.749998, 0)` zoom 2.8Mx | Screenshot Playwright |
| 2 | Mur cassé `(0.3219, -0.0352)` zoom 464770x | Screenshot Playwright |
| 3 | Status = `GPU` | Visible dans screenshots |
| 4 | Default zoom intact `<1ms` single-pass | Screenshot Playwright |
| 5 | Julia deep zoom GPU multi-frame | Screenshot Playwright |
| 6 | BurningShip/Tricorn/Multibrot deep zoom GPU | Screenshot Playwright |
| 7 | 5 colorings fonctionnent en multi-frame | Screenshots Playwright |
| 8 | Annulation sans crash | Test interactif Playwright |
| 9 | `npm run build` pass | Output console |
| 10 | Tests ≥ 262 | Output `npm test` |
| 11 | `docs/performance-history.md` mis à jour | Diff dans commit |
| 12 | Pas de push — attendre instruction | Dernier step du plan |

---

## VRAM Budget

| Résolution | 1 texture RGBA32F | 8 textures (4×2 ping-pong) |
|-----------|-------------------|-----------------------------|
| 1920×1080 | 33 MB | **265 MB** |
| 1280×720 | 15 MB | **118 MB** |

Mitigation : détruire FBOs quand multi-frame inactif.

---

## State Layout (4 MRT × RGBA32F)

| Texture | R | G | B | A |
|---------|---|---|---|---|
| **T_Z** | z.x / ds_zre.hi | z.y / ds_zre.lo | 0 / ds_zim.hi | 0 / ds_zim.lo |
| **T_Info** | float(iter) | float(escaped) | smoothVal | float(count) |
| **T_Acc** | dz.x | dz.y | stripeSum | trapDistSq |
| **T_Hist** | stripePrev1 | stripePrev2 | stripePrev3 | 0 |

## Texture Units

| Shader | TEX0 | TEX1 | TEX2 | TEX3 | TEX4 |
|--------|------|------|------|------|------|
| Batch | prevZ | prevInfo | prevAcc | prevHist | — |
| Resolve | stateZ | stateInfo | stateAcc | stateHist | palette |

## Uniforms

**Batch** : `u_center`, `u_scale`, `u_centerLo`/`u_scaleLo` (DS), `u_resolution`, `u_prevZ/Info/Acc/Hist`, `u_totalMaxIter` (uniform int — safe, early exit not loop bound), `u_bailoutSq` (uniform float), `u_juliaRe/Im` (Julia), `u_power` (Multibrot)

**Resolve** : `u_stateZ/Info/Acc/Hist`, `u_palette`, `u_interiorColoring`

## Compile-time Constants

```glsl
#define BATCH_SIZE 256
#define COLOR_CYCLE_PERIOD 256.0
#define ORBIT_TRAP_CYCLE 64.0
#define NORMAL_MAP_LIGHT_ANGLE (-0.7854)
#define INTERIOR_ATTENUATION 0.4
```

---

## Code Patterns ISO-Compliant

### Pattern A: Module-level (no nested functions — sonarjs)
```typescript
// ✅ Module-level function
function renderBatch(gl: WebGL2RenderingContext, ...): void { ... }
// ✅ Arrow in closure (permitted by sonarjs)
export function createController(gl: WebGL2RenderingContext) {
  const cancel = () => { ... };
  return { start() { ... } };
}
// ❌ INTERDIT — nested function declaration
function createController(gl) { function cancel() { ... } }
```

### Pattern B: Record maps (no duplicate strings — sonarjs)
```typescript
const BATCH_CHUNKS: Record<FractalType, string> = {
  mandelbrot: mandelbrotDSBatchChunk, julia: juliaBatchChunk, ...
};
```

### Pattern C: IEEE 754 NaN/Inf guard (dans chaque batch shader)
```glsl
// @mirror shaders/perturbation.ts:95 — IEEE 754-2019 NaN/Inf guard
if (isnan(z.x) || isnan(z.y) || isinf(z.x) || isinf(z.y)) {
  outZ = pZ; outInfo = vec4(float(u_totalMaxIter), 0.0, 0.0, float(count));
  outAcc = pAcc; outHist = pHist; return;
}
```

### Pattern D: @mirror tags (ISO 80000-2)
```glsl
// @mirror domain/fractals.ts:mandelbrotFastPath
// z_{n+1} = z_n² + c  (ISO 80000-2)
ds_zre = ds_add(ds_sub(ds_x2, ds_y2), ds_cre);
```

---

## File Structure

| File | Rôle |
|------|------|
| **Create:** `shaders/multiFrame.ts` | 5 batch GLSL + 5 resolve GLSL + headers |
| **Create:** `multiFrameRenderer.ts` | 4-MRT FBO + controller + compile + RAF |
| **Create:** `__tests__/multiFrameShader.test.ts` | 34 tests assembly |
| **Modify:** `shaderCompiler.ts` | +2 assembly functions |
| **Modify:** `webglRenderer.ts` | +renderMultiFrame() |
| **Modify:** `rendererTypes.ts` | +MultiFrameFBO, +renderMultiFrame |
| **Modify:** `renderer.ts` | tryMultiFrame dispatch + status message batch N/M |

---

## Tasks

### Task 1: Types + 4-MRT FBO

**Files:** `rendererTypes.ts`, `multiFrameRenderer.ts`
**DoD:** Types, FBO create/destroy, EXT check, 4 color attachments. QG passent.

- [ ] 1.1: `MultiFrameFBO` type (texZ, texInfo, texAcc, texHist + fbo + w/h)
- [ ] 1.2: `createMultiFrameFBO(gl, w, h)` — EXT check (@mirror orbitTexture.ts:12), 4× createFloat32Texture, 4× framebufferTexture2D(COLOR_ATTACHMENT0..3), checkFramebufferStatus
- [ ] 1.3: `destroyMultiFrameFBO(gl, fbo)` — 4× deleteTexture + deleteFramebuffer
- [ ] 1.4: Verify QG: `npm run typecheck && npm run lint && npm test`
- [ ] 1.5: Commit `feat(e2c): 4-MRT FBO infrastructure`

---

### Task 2: Batch GLSL — 5 fractals

**Files:** `shaders/multiFrame.ts`
**DoD:** 5 batch main() chunks. IEEE 754 NaN/Inf guards. @mirror tags. u_center/u_scale dans header. QG passent.

- [ ] 2.1: Shared batch header (u_center, u_scale, u_resolution, u_prevZ/Info/Acc/Hist, u_totalMaxIter, u_bailoutSq) + MRT output layout(location=0..3)
- [ ] 2.2: DS extras header (u_centerLo, u_scaleLo)
- [ ] 2.3: Julia extras header (u_juliaRe, u_juliaIm)
- [ ] 2.4: Multibrot extras header (u_power)
- [ ] 2.5: Mandelbrot DS batch main():
  - State read + passthrough si done
  - screenToComplexDS pour c
  - Cardioid/bulb pre-test à prevIter==0 (`@mirror shaders/index.ts:mandelbrotDSIterationChunk`)
  - DS z²+c loop BATCH_SIZE (`@mirror` z_{n+1} = z_n² + c, ISO 80000-2)
  - dz=2z·dz+1 (`@mirror` Z'_{n+1} = 2·Z_n·Z'_n + 1)
  - Accumulator inline (stripeSum, trapDistSq, history shift)
  - **IEEE 754 NaN/Inf guard** (Pattern C)
  - State write (escaped ou continue)
- [ ] 2.6: Julia batch main() — z₀=pixel (prevIter==0→z=screenToComplex), c=juliaC, dz₀=1, dz=2z·dz (pas +1), NaN/Inf guard
- [ ] 2.7: BurningShip batch main() — z=abs(z), dz=2|z|·dz+1, NaN/Inf guard
- [ ] 2.8: Tricorn batch main() — z.y=-z.y (conj), dz≈2conj(z)·dz+1, NaN/Inf guard
- [ ] 2.9: Multibrot batch main() — z^n loop, dz=n·z^(n-1)·dz+1, smoothEscapeGeneral, NaN/Inf guard
- [ ] 2.10: Verify QG
- [ ] 2.11: Commit `feat(e2c): batch GLSL — 5 fractals, 4-MRT, IEEE 754 guards, @mirror tags`

---

### Task 3: Resolve GLSL — 5 colorings

**Files:** `shaders/multiFrame.ts`
**DoD:** 5 resolve main() chunks. Interior coloring. @mirror tags. Formules exactes (audit appendix). QG passent.

- [ ] 3.1: Shared resolve header + state read + interior path (`@mirror shaders/index.ts:mainChunk`)
- [ ] 3.2: Classic resolve — `t = mod(smoothVal, 256) / 256` (`@mirror coloringModes.ts:classicToParam`)
- [ ] 3.3: Stripe resolve — Catmull-Rom + cosine palette (`@mirror shaders/index.ts:stripeColoringChunk`)
- [ ] 3.4: Decomposition resolve — `atan(z.y, z.x) >= 0 ? 0.15 : 0.65` (`@mirror`)
- [ ] 3.5: OrbitTrap resolve — log blend (`@mirror shaders/index.ts:orbitTrapColoringChunk`)
- [ ] 3.6: NormalMap resolve — DE lightness (`@mirror shaders/index.ts:normalMapColoringChunk`)
- [ ] 3.7: Verify QG
- [ ] 3.8: Commit `feat(e2c): resolve GLSL — 5 colorings + interior, @mirror tags`

---

### Task 4: Assembly + Tests (TDD)

**Files:** `shaderCompiler.ts`, `__tests__/multiFrameShader.test.ts`
**DoD:** TDD strict RED→GREEN. 34 tests. Record maps. Assembly ≤80 lines/fn. QG passent.

- [ ] 4.1: Write test file — 25 batch + 5 resolve + 4 specific = 34 tests (RED)
- [ ] 4.2: Run → confirm RED
- [ ] 4.3: `MULTI_FRAME_BATCH_CHUNKS: Record<FractalType, string>` map
- [ ] 4.4: `MULTI_FRAME_RESOLVE_CHUNKS: Record<ColoringMode, string>` map
- [ ] 4.5: `assembleMultiFrameBatchSource(fractal, coloring, interior)` — select chunks, compose
- [ ] 4.6: `assembleResolveSource(coloring, interior)` — select chunks, compose
- [ ] 4.7: Run → confirm GREEN (34 tests)
- [ ] 4.8: Verify QG (262 total)
- [ ] 4.9: Commit `feat(e2c): shader assembly — 25 combos, Record maps, TDD`

---

### Task 5: Multi-Frame Controller

**Files:** `multiFrameRenderer.ts`
**DoD:** Controller exports. 10 programs. RAF loop. Ping-pong. Cancel. Module-level helpers. Status message `batch N/M` (ISO 9241-110). QG passent.

- [ ] 5.1: Module-level `compileProgram(gl, fragSource): CompiledRef | null`
- [ ] 5.2: Module-level `renderBatch(gl, prog, readFBO, writeFBO, options, vao)` — bind 4 textures TEX0-3, set uniforms, drawBuffers, drawArrays
- [ ] 5.3: Module-level `renderResolve(gl, prog, stateFBO, paletteTex, vao)` — bind state+palette TEX0-4, drawArrays to null FBO
- [ ] 5.4: Module-level `clearMrtFbo(gl, fbo)` — clearBufferfv ×4
- [ ] 5.5: `createMultiFrameController(gl)` factory — compile 10 programs, closure state, return `{ start, destroy }`
- [ ] 5.6: `start()` — RAF loop, ping-pong, resolve each batch. **Status callback `onBatchProgress(batch, total)`** pour ISO 9241-110 self-descriptiveness. Return cancel arrow fn.
- [ ] 5.7: `destroy()` — cancel, destroy FBOs, delete programs
- [ ] 5.8: **Smoke test** — start dev server, navigate deep zoom, vérifier que multi-frame s'active (Playwright screenshot, render time). **Preuve avant commit** (norme 11).
- [ ] 5.9: Verify QG
- [ ] 5.10: Commit `feat(e2c): multi-frame controller — 10 programs, RAF, status callback`

---

### Task 6: Integration

**Files:** `rendererTypes.ts`, `webglRenderer.ts`, `renderer.ts`
**DoD:** `renderMultiFrame()` sur interface. Dispatch >4096 iter. Fallback CPU. Status bar `GPU (batch N/M)`. QG passent.

- [ ] 6.1: Add `renderMultiFrame(options, onBatchProgress?, onComplete?)` to WebGLRenderer interface
- [ ] 6.2: Implement in webglRenderer.ts
- [ ] 6.3: renderer.ts — `tryMultiFrame` + `trySinglePass` (module-level). Status message: `onStatusMessage(\`iter: ${iter} (auto) — batch ${n}/${total}\`)` (ISO 9241-110)
- [ ] 6.4: **WCAG** : status message dans `aria-live="polite"` region (vérifier que le conteneur existant a l'attribut)
- [ ] 6.5: Verify QG
- [ ] 6.6: **Playwright smoke test** — deep zoom, vérifier `GPU` dans status bar, batch progress visible. Screenshot = preuve.
- [ ] 6.7: Commit `feat(e2c): integrate multi-frame — 25 combos, status bar, WCAG`

---

### Task 7: Visual Verification (Playwright) + Benchmarks

**DoD:** 12 critères DoD finale vérifiés. Benchmarks mesurés. Screenshots sauvegardés.

- [ ] 7.1: Mandelbrot deep zoom — mur cassé, `GPU`, **mesurer render time**
- [ ] 7.2: Coords user (0.3219, -0.0352) — mur cassé, **mesurer render time**
- [ ] 7.3: Default zoom — single-pass `<1ms`
- [ ] 7.4: Julia deep zoom — multi-frame GPU, **mesurer render time**
- [ ] 7.5: BurningShip deep zoom — multi-frame GPU
- [ ] 7.6: Stripe coloring deep zoom
- [ ] 7.7: NormalMap coloring deep zoom
- [ ] 7.8: Annulation sans crash
- [ ] 7.9: `npm run build` pass
- [ ] 7.10: Commit `test(e2c): visual verification + benchmarks`

---

### Task 8: Docs + Performance History

**Files:** `CLAUDE.md`, `docs/performance-history.md`
**DoD:** E2c DONE dans roadmap. Benchmarks dans perf history. QG + build passent. **PAS DE PUSH — attendre instruction.**

- [ ] 8.1: Mark E2c DONE dans CLAUDE.md roadmap
- [ ] 8.2: Documenter multi-frame dans GPU gotchas
- [ ] 8.3: **`docs/performance-history.md`** — ajouter section multi-frame avec mesures Task 7 :
  - ms/batch moyen
  - total @16K iter (Mandelbrot DS)
  - total @8K iter (Julia, BurningShip, etc.)
  - comparaison CPU (avant/après)
- [ ] 8.4: `npm run typecheck && npm run lint && npm test && npm run build`
- [ ] 8.5: Commit `docs: E2c DONE — benchmarks, perf history, 25 combos`
- [ ] 8.6: **NE PAS PUSH — attendre instruction explicite de l'utilisateur**

---

## Appendix: Formulas Audit

### Iteration par fractal

| Fractal | z₀ | c | z update | dz update | Pre-test | smooth | NaN guard |
|---------|-----|---|----------|-----------|----------|--------|-----------|
| Mandelbrot DS | 0 | screenToComplexDS | DS z²+c | 2z·dz+1 | cardioid+bulb | log2 | oui |
| Julia | pixel | juliaC | z²+c | 2z·dz | none | log2 | oui |
| BurningShip | 0 | screenToComplex | abs(z)²+c | 2\|z\|·dz+1 | none | log2 | oui |
| Tricorn | 0 | screenToComplex | conj(z)²+c | 2conj(z)·dz+1 | none | log2 | oui |
| Multibrot | 0 | screenToComplex | z^n+c | n·z^(n-1)·dz+1 | none | logBase=n | oui |

### Color mapping par coloring

| Coloring | mapToParam | lightness | Palette | Acc fields |
|----------|-----------|-----------|---------|-----------|
| Classic | smoothVal mod 256 / 256 | 1.0 | texture | — |
| Stripe | Catmull-Rom + freq | 1.0 | cosine | stripeSum, sp1-3, count |
| Decomposition | atan(z) binary | 1.0 | texture | z |
| OrbitTrap | log(trap) + blend | 1.0 | texture | trapDistSq |
| NormalMap | smooth + angle | DE lighting | texture | dz, z |

### Bailout

| Coloring | u_bailoutSq |
|----------|------------|
| Stripe | 300000.0 |
| Autres | 4.0 |
