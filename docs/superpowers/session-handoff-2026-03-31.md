# Session Handoff — 2026-03-31

## Ce qui a été fait cette session

### BLA (E2b) — merged sur main
- Rust/WASM BLA table construction (binary tree)
- GPU shader lookup + apply (tryBlaSkip shared Mandelbrot/Julia)
- BLA compatible classic + decomposition (disabled for stripe/orbitTrap/normalMap)
- Lookup simulation vitest prouve >100/255 iter skippées
- findLSB() remplacé par manual bit scan (AMD WebGL2)

### Rescaling (F1) — merged sur main
- Static S = 2^k per frame via u_rescaleS uniform
- invS exact en IEEE 754 (puissance de 2)
- BLA validity: Option A (u_rescaleS2 = S², compare dz2 < r2 * S²)
- Zoom 10^-14 structure visible (Mandelbrot 62ms, Julia 560ms)
- 5 coloring modes compilent en perturbation (stripe BAILOUT_SQ fix)
- Zoom 10^-40 renders (70ms, pas de crash, point intérieur)

### SRP refactoring — merged sur main
- webglRenderer.ts 742 → 7 modules
- shaderCompiler.ts 360 → shaderCompiler 178 + shaderCache 193
- renderer.ts 269 → renderer 183 + perturbationRenderer 93
- useFractalState.ts 363 → useFractalState 77 + fractalReducer 233

### Autres fixes
- CSP unsafe-eval dev mode (Next.js 16)
- Favicon SVG
- Timer query INVALID_OPERATION (active flag)
- Default iter 256→1024, slider max→4096
- Stripe BAILOUT_SQ int→float GLSL literal

### Tests
- 228 vitest pass, 0 lint warnings, typecheck clean
- BLA lookup simulation (4 tests)
- Rescaling parity S=1 + S=2^50 (2 tests)
- Shader assembly u_rescaleS inclusion/exclusion (2 tests)

## Ce qui n'est PAS fait (honest)

1. **Zoom >10^-15 avec structure visible** — JS number coords = 15 digits. Pour vérifier visuellement 10^-40+, il faut zoomer interactivement (pas via URL).
2. **BLA speedup mesuré en isolation** — pas de toggle on/off dans l'UI, le render time inclut l'orbite.
3. **Playwright tests formalisés** — tests exécutés en live via MCP mais pas commitées comme artefacts.
4. **fractalReducer.ts à 233 lignes** — pure data/switch, difficile à splitter sans sur-fragmenter.
5. **perturbation.ts à 245 lignes** — 2 GLSL chunks (Mandelbrot+Julia), indissociables.

## Prochaines étapes (par priorité)

### Court terme (gains immédiats)
1. **Vérification interactive deep zoom** — ouvrir l'app, zoomer manuellement au-delà de 10^-15, prendre des screenshots. C'est le seul moyen de prouver que le rescaling fonctionne visuellement en profondeur.
2. **Mesurer BLA speedup** — ajouter un toggle `?bla=0` dans l'URL pour désactiver BLA et comparer les render times à 1024 iter.

### Moyen terme (features)
3. **E2c: Ping-pong multi-frame** — <1ms to first visible (spec non écrite)
4. **F2: Histogram coloring** — two-pass CDF, élimine le banding
5. **Perturbation parity (volet 2)** — BurningShip, Tricorn, Multibrot (spec séparée à écrire)

### Architecture
6. **Playwright test runner** — migrer de MCP (ad-hoc) vers Playwright test runner (formalisé, CI-ready)
7. **High-precision URL coords** — stocker centerRe/Im en string (pas number) pour >15 digits

## État git
- Branch: `main` (merged feat/e2b-bla)
- 29 commits sur la branche, merge commit `8bfea30`
- Pas de push (workflow: JAMAIS push auto)

## Fichiers clés modifiés
```
src/infrastructure/gpu/
  shaders/perturbation.ts    — rescaled Mandelbrot + Julia GLSL
  shaders/bla.ts             — BLA lookup + tryBlaSkip (rescaled)
  shaderCompiler.ts          — assembly (pure, 178 lines)
  shaderCache.ts             — compilation cache (NEW, 193 lines)
  uniformBindings.ts         — u_rescaleS + u_rescaleS2 binding
  rendererTypes.ts           — OrbitContext.rescaleS
  orbitContextBuilder.ts     — rescaleS propagation
  renderPipeline.ts          — draw call
  progressiveController.ts   — timer query
  gpuCanvasFactory.ts        — canvas + precompile
  webglRenderer.ts           — factory (119 lines)
  blaTexture.ts              — BLA texture RGBA32F

src/infrastructure/
  renderer.ts                — computeRescaleS + facade (183 lines)
  perturbationRenderer.ts    — orbit result handling (NEW, 93 lines)

src/application/
  fractalReducer.ts          — pure state reducer (NEW, 233 lines)
  useFractalState.ts         — React hook (77 lines)

src/domain/types.ts          — OrbitData.rescaleS
```
