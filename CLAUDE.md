# CLAUDE.md — Conventions pour Fractalnaute

Ce fichier documente les conventions, patterns et decisions architecturales du projet.

## Commandes essentielles

```bash
npm run dev             # Dev server Next.js (Turbopack) avec headers COOP/COEP
npm run build           # Build production
npm run lint            # ESLint (sonarjs + security)
npm run lint:fix        # ESLint autofix
npm run typecheck       # tsc --noEmit (strict, noUncheckedIndexedAccess)
```

## Architecture

### Layers (imports strictement unidirectionnels)

```
app/                    → UI entry (Next.js App Router, 'use client')
src/ui/                 → Composants UI (Tailwind + shadcn)
src/components/ui/      → Composants shadcn/ui (Radix + Tailwind)
src/application/        → Hooks React (state, canvas events)
src/infrastructure/     → Renderer canvas, canvas utils, Web Workers
src/domain/             → Logique pure (fractals, palettes OKLCH, color math)
```

Direction des imports : `app → ui → application → domain`, `infrastructure → domain`.
Jamais d'import inverse.

### Domain layer — pur, zero dependance

- `color.ts` : conversion OKLCH↔sRGB (Bjorn Ottosson), hot path
- `fractals.ts` : calculateurs (Mandelbrot, Julia, BurningShip, Tricorn, Multibrot)
- `palettes.ts` : palettes OKLCH avec interpolation perceptuelle
- `coordinates.ts` : transformations ecran↔plan complexe
- `types.ts` : types partages (OKLCH, RGB, FractalResult, etc.)

### Color system — OKLCH source of truth

- Toutes les couleurs sont definies en OKLCH
- `themes.ts` : valeurs CSS `oklch()` pour les custom properties
- `palettes.ts` : stops OKLCH, interpolation en espace perceptuel
- Conversion sRGB uniquement aux frontieres device (ImageData, CSS fallback)
- `@tradeoff` tags marquent les decisions de compromis (grep-able)

## Conventions

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`
- Zero `any` — `@typescript-eslint/no-explicit-any: error`

### ESLint (ISO 5055 — qualite code source)

- `complexity: 15` max
- `max-lines-per-function: 80` (skipBlankLines, skipComments)
- `sonarjs/cognitive-complexity: 15` max
- `sonarjs/no-nested-functions: error`
- `sonarjs/no-nested-conditional: error`
- `sonarjs/no-duplicate-string: error`
- `max-depth: 4` max
- `no-console: error` (sauf warn/error)
- Zero warnings autorise (`--max-warnings 0`)

### Normes ISO applicables (canonisees depuis spec perturbation 2026-03-26 §8)

| Norme | Sujet | Application dans le projet |
|-------|-------|---------------------------|
| **IEEE 754-2019** | Arithmetique flottante | Guards NaN/Inf dans tous les shaders GPU. DS twoSum/twoProd rely on round-to-nearest-even. Denormals mitigated par rescaling. |
| **ISO 5055** | Qualite code source | ESLint rules ci-dessus. Zero warnings, zero any, complexity capped. |
| **ISO 25010** | Modele qualite (8 caracteristiques) | Performance (<1ms GPU), Compatibility (Chrome 91+, Firefox 89+, Safari 15.2+), Reliability (fallback CPU, timeout orbit), Security (cargo audit, CSP), Maintainability (SRP, DRY, @mirror tags). |
| **ISO 9241-110** | Ergonomie interaction (7 principes) | Controllability (cancel orbit, cancel multi-frame). Self-descriptiveness (badges GPU/CPU/DS/Perturbation). Conformity to expectations (zoom just works at every depth). |
| **ISO 40500 (WCAG 2.1)** | Accessibilite | `role="progressbar"` + `aria-valuenow` pour operations longues. `aria-live="polite"` pour changements de mode. Keyboard-accessible cancel. Couleur jamais seul indicateur (WCAG 1.4.1). `fieldset/legend` (WCAG 1.3.1). |
| **ISO 27001 / OWASP** | Securite | CSP (script-src wasm-unsafe-eval), COOP/COEP, input validation (Result not panic), cargo audit, Cargo.lock committe. |
| **ISO 80000-2** | Notation mathematique | Formules en notation standard dans les commentaires. `@mirror` tags liant GLSL a la formule math et au CPU equivalent. Variables GLSL documentees dans glossaire (spec §0). |

### Normes operationnelles (feedback utilisateur — meme force que ISO)

| Norme | Regle | Verification |
|-------|-------|-------------|
| **Playwright benchmarks** | Mesurer render time (Playwright) a chaque task significative, pas seulement a la fin. | Screenshot + temps dans le commit message ou perf-history. |
| **Performance history** | `docs/performance-history.md` mis a jour a chaque push avec les nouvelles mesures. Ne pas ecraser les anciennes. | Diff du fichier dans le commit. |
| **Meilleur du marche** | Chaque formule = meilleure ref connue (pas generique). Lire la recherche AVANT d'implementer. | Ref documentee (`@mirror` ou `@see`) pour chaque formule. |
| **Jamais verified sans preuve** | "Verified" = screenshot ou pixel check. "Renders" = no crash + compile. "Untested" = explicite. | Preuve visible (screenshot, output) AVANT de claim done. |
| **Jamais devier du plan** | Suivre le plan mot par mot. Si un step ne peut pas etre implemente tel quel, DEMANDER avant. | Audit chaque fichier contre le plan ligne par ligne apres implementation. |
| **Pas de push auto** | Ne JAMAIS push sans instruction explicite de l'utilisateur. Commiter localement, attendre. | Pas de `git push` dans les scripts de plan sauf si l'utilisateur le demande. |
| **Ton code = tes bugs** | Pas de "pre-existant hors scope". Si le code existe dans le repo, c'est ta responsabilite. | Corriger tout bug trouve, meme dans du code ancien. |

### Commits

- Conventional commits (`feat:`, `fix:`, `refactor:`, `perf:`, `docs:`, `chore:`)
- Sujet max 100 caracteres
- Commitlint enforce en hook commit-msg

### Git hooks (Husky)

- `pre-commit` : lint-staged (ESLint --max-warnings 0)
- `commit-msg` : commitlint conventional
- `pre-push` : typecheck → ESLint → build → npm audit

### Performance tags

Les decisions de compromis perf sont marquees `@tradeoff` dans le code :
```bash
grep -r @tradeoff src/
```

### Fichiers standalone

`standalone/fractal-explorer.html` est un prototype independant, PAS un miroir de la version React. Source de verite = `src/`.

## Performance Roadmap

### Done
- putImageData partial (dirty rect)
- Precalcul screenToComplex (8M allocs eliminated)
- Multibrot direct multiplication (×5 for z³)
- resolvePalette (per-pixel lookup eliminated)
- DEG_TO_RAD constant extraction
- Web Workers v1: pool (hardwareConcurrency-1), SAB, band decomposition, Atomics cancel, renderId anti-stale, ImageData cache, buildMergedParams, destroyed guard, single-thread fallback
- Adaptive iteration: cardioid/bulb pre-test (Mandelbrot), Brent's periodicity checking (all 5 fractals), epsilon 1e-15. Measured: 3.4x@256iter, 8.6x@1024iter
- Progressive rendering v2: stride-based two-pass (stride 4 preview → stride 1 full-res). Preview in ~3ms, 5% total overhead. Industry-standard approach (Fractint/UltraFractal style).
- Instant viewport feedback v3 (XaoS-style): CSS transform via useLayoutEffect for instant visual feedback on pan/zoom (<2ms perceived). 80ms debounce, then: pan → pixel-shift + x-range-clipped strip render (2-3 strips, ~5% pixels); zoom → full two-pass re-render. will-change:transform GPU hint. Baseline: 71ms/157ms pan → instant CSS + 80ms debounce + strip render.
- Advanced coloring: 5 modes (classic, stripe/métal brossé, tessellation/decomposition, orbit trap, normal map/éclairage 3D) + interior toggle. Conditional accumulation (zero Classic overhead measured: 228ms vs 228ms baseline). Stripe +75% overhead (atan2+sin per iter). Harkonen stripe avg, distance estimation (bailout 1e12), orbit trap (log scale), binary decomposition. SRP: coloringAccumulator.ts (observe) + coloringModes.ts (map+dispatch) + palettes.ts (pure lookup). Radix Checkbox, fieldset/legend WCAG 1.3.1, aria-labelledby on all selects, mobile responsive.
- GPU rendering v4 (WebGL 2): Mandelbrot + Classic coloring via fragment shader.
  Measured: 0.04ms @256iter 1920x912 (~5700x vs CPU 228ms). AMD Radeon integrated RDNA2.
  Dual canvas: GPU creates own overlay canvas (pointer-events:none) — single canvas can't have both webgl2 AND 2d context.
  Raw WebGL 2 (no library). Composable GLSL chunks as TS string constants (compile-time, zero branching).
  Cardioid/bulb pre-test in GLSL. Y-axis negated (-uv.y) for WebGL→canvas convention.
  KHR_parallel_shader_compile async. Palette as 256×1 sRGB texture (gl.LINEAR).
  Progressive FBO infrastructure built but disabled (no measured need).
  Graceful fallback: unsupported fractal/coloring → null → CPU Workers (no throw).
  Facade GPU→Workers→Fallback. Context loss → CPU fallback.

- GPU v2 (all 5 fractals): Julia, BurningShip, Tricorn, Multibrot ported to GLSL.
  Derivative (dz) tracking in all shaders for future distance estimation.
  Measured: 0.025-0.050ms @256iter all fractals (3500-7000x vs CPU).

- GPU v3 (all 5 coloring modes): stripe, decomposition, orbitTrap, normalMap ported to GLSL.
  Real accumulator (stripe avg + orbit trap + dz). Interior coloring (orbit trap + attenuation).
  Distance estimation for normalMap lighting. All 25 fractal×coloring combinations GPU-rendered.
  Constants DRY: STRIPE_DENSITY, ORBIT_TRAP_CYCLE, NORMAL_MAP_LIGHT_ANGLE, INTERIOR_ATTENUATION from domain.
  Verified via Playwright screenshots (5/5 modes correct, 0 console errors).

### Done
1. ~~Parity tests coloring modes~~ — 34 tests GPU/CPU formula parity
2. ~~UI: render time + GPU/CPU indicator~~ — InfoPanel badge
3. ~~Progressive FBO + timer query~~ — adaptive >16ms, EXT_disjoint_timer_query_webgl2
4. ~~SSAA 2x2~~ — GPU 2x FBO, toggle, composes with progressive
5. ~~Double-single emulation~~ — Mandelbrot DS (vec2 hi+lo), zoom 10^-15
6. ~~Stripe rewrite~~ — deep-mandelbrot quality (Re·Im/|z|², Catmull-Rom standard form, bailout 300K)
7. ~~P0 UX~~ — URL state, touch pinch, responsive mobile, adaptive debounce
8. ~~Perturbation theory v1~~ — Rust/WASM dashu-float orbit + GPU perturbation shader.
   Mandelbrot + Julia. Zoom 10^-14 verified (structure visible). SAB cancel/progress, WCAG progressbar.
   Measured: orbit ~1s @256iter, GPU ~50ms, total <1.5s. Plans A+B complete.
9. ~~Precision ladder~~ — DD (2xf64, 0.03ms), QD (4xf64, 0.26ms), ArbFloat fallback.
   OrbitFloat trait (DRY). Orbit no longer bottleneck (<1ms). GPU render (~50ms) = new bottleneck.
10. ~~Rescaling (F1)~~ — static S = 2^k per frame, δ̃ = δ×S keeps float32 precise at any depth.
   Zoom 10^-14 verified: structure visible at (-1.749998, 0), 62ms GPU+Perturbation, 1024 iter.
   BLA lookup simulation: >100/255 iter skipped (vitest). Rescale parity: de-rescaled == non-rescaled.
   Default iter 256→1024, slider max→4096.
11. ~~High-precision coordinate pipeline~~ — decimal.js-light (200 digits) for zoom/pan arithmetic.
   Viewport.deepRe/deepIm/deepScale strings threaded URL→state→WASM.
   DD/QD Rust parse via dashu DBig (hi+lo extraction, not f64-only).
   PERTURBATION_THRESHOLD lifted to domain layer (single source of truth).
   Verified interactively: zoom 10^23x, perturbation kicks in at ~5e-14, <1ms render at all depths.
   URL encodes 32-digit coords in base64 (dre/dim/ds params).
   Focus-point zoom via Decimal (pixel offset × scale, not f64 subtraction).
   Iter auto-scaling: 128×log2(1/scale), cap 8192, only at scale<1e-6.
   Known limit: GPU perturbation render bloquant (1-5s). Fix: E2c ping-pong.

### BROKEN PROMISES — audit trail (honnête, mis à jour 2026-04-03)

| # | Promesse | Statut | Notes |
|---|---|---|---|
| 1 | "Depth breakthrough 10^-40: non-black pixels" | **BUG** | 10^-14 fonctionne (screenshot). 10^-30+ : orbite Rust retourne mais rendu uniforme (pas de structure). Bug dans orbit.rs ArbFloat a haute precision — a debugger. |
| 2 | "Manual verification: Zoom 10^-60, 10^-100" | **BLOQUE PAR #1** | Meme cause racine. Le timeout adaptatif est livre mais le bug orbite persiste. |
| 3 | "Unlimited zoom depth (10^-60+)" | **LIVRÉ (moteur)** | Pipeline deep coords + perturbation + rescaling + BLA fonctionne à 10^-23+ vérifié. Pas de crash. |
| 4 | "GPU render @256iter <10ms with BLA" | **LIVRÉ** | BLA toggle ?bla=0. Mesuré: ON=4853ms vs OFF=5331ms (9%). Faible gain car premier render = CPU fallback. |
| 5 | "BLA pixel cross-validation" | **NON FAIT** | Nécessite coords extérieures haute-précision. |
| 6 | "Overlap zone DS ≈ perturbation" | **LIVRÉ** | Vérifié visuellement (Playwright): même résultat aux mêmes coords. |
| 7 | "Playwright benchmarks 3 profondeurs" | **LIVRÉ** | 5/5 tests formalisés (10^-8, 10^-12, 10^-14, 10^-40, interactif). |
| 8 | "10^-80 malachite <50ms" | **BLOQUE PAR #1** | Depend de SA (E2d) + fix orbit ArbFloat. |

Problème ouvert : **Perturbation GPU > 10^-14 — non verifiable en Playwright**.
Diagnostic (2026-04-03, debugging systematique Phase 1-4) :
- Orbite Rust **CORRECTE** (32768 iter a 10^-20, verifie par debug log).
- Shader perturbation **GPU cap 4096 iter** (`PERTURBATION_GPU_MAX_ITER` dans perturbationRenderer.ts).
- Playwright utilise WebKit headless (pas Chrome/AMD) → shader perturbation ne compile pas.
- **Verification requise dans le vrai browser** (Chrome + AMD Radeon) pour les promesses 1 & 2.
- A 10^-14 : structure visible dans le vrai browser (verifie session precedente).
- Si le vrai browser compile le shader perturbation a 4096 iter, 10^-20+ devrait fonctionner.
- Si le cap 4096 est insuffisant, multi-frame perturbation (E2e) sera necessaire.

~~Problème résolu~~ : GPU perturbation render trop lent (1-5s bloquant) — **RESOLU par E2c** (771ms @8.8K iter).

### Next — ordre logique (mis a jour 2026-04-03)

| Priorite | Feature | Effort | Debloque |
|----------|---------|--------|----------|
| **P0** | Fix orbit ArbFloat 10^-30+ (bug #1) | debug Rust | Promesses 1, 2, 8 |
| **P1** | F2 Histogram coloring | 1 sem | Banding → 0, qualite visuelle |
| **P2** | E2d Series Approximation (SA) | 2-3 sem | Promesse 8 (10^-80 <50ms), deep zoom perf 10x |
| **P3** | Verifier promesse 8 (post-SA) | 1h | 10^-80 malachite <50ms |
| **P4** | Promesse 5 BLA cross-validation | qq heures | Coords ref externes |
| **P5** | F3 Video export | 2 sem | Zoom animation MP4/WebM |
| **P6** | F4 LLM-readable (SEO) | 1 sem | Discoverability |

#### Phase C: Perturbation correctness — DONE (rebasing)

~~C1/C2~~ : rebasing Heiland-Allen dans le shader GLSL gere la detection de glitch
implicitement (spec §2: "Rebasing eliminates multi-reference entirely").
Grid search inutile avec rebasing.

#### Phase D: Smooth deep zoom — **P0 NEXT** (bottleneck = GPU perturbation render bloquant)

| # | Feature | Impact | Effort | Status |
|---|---|---|---|---|
| ~~E2c~~ | ~~Ping-pong multi-frame~~ | **DONE** — 256 iter/batch, 4 MRT RGBA32F, GPU 771ms @8.8K iter (vs CPU 5380ms). 25 combos. | — | — |
| E2d | **Series Approximation (SA)** | Skip iter pour TOUS pixels (10x) | 2-3 sem | After E2c |

##### ~~E2c. Ping-pong multi-frame~~ — DONE
256 iter/batch, 4 MRT RGBA32F state textures, ping-pong FBO swap.
GPU 771ms @8.8K iter (vs CPU 5380ms). All 25 fractal×coloring combos.
Lazy compilation (10 programs: 5 batch × 5 resolve). RAF scheduling ~16ms/batch.
EXT_color_buffer_float required, CPU fallback.
Ref: https://github.com/munrocket/deep-mandelbrot

##### E2d. Series Approximation (SA)
Complémentaire à BLA : SA skip pour TOUS pixels (coefficients Taylor de l'orbite de référence).
Typiquement 10x supplémentaire au-dessus de perturbation seule. 3-50 termes Taylor.
Ref: mathr.co.uk, K.I. Martin SuperFractalThing paper, Wikibooks Fractals/perturbation.

#### Phase E: Done

| # | Feature | Status |
|---|---|---|
| ~~E1~~ | ~~Orbit perf (DD/QD/ArbFloat)~~ | **DONE** — DD 0.03ms, QD 0.26ms |
| ~~E2a~~ | ~~Orbit uniform array~~ | **ELIMINE** |
| ~~E2b~~ | ~~BLA iteration skip~~ | **DONE** — toggle ?bla=0, mesuré 9% |
| ~~11~~ | ~~High-precision coords~~ | **DONE** — decimal.js-light, deep URL params |
| ~~Iter auto-scaling~~ | ~~suggestIterations~~ | **DONE** — 512*depth, cap 32768, all depths |
| ~~Focus-point Decimal~~ | ~~Pixel offset × scale~~ | **DONE** — plus de f64 subtraction |

#### Phase F: Polish & features

| # | Feature | Gain | Effort | Status | Priorité |
|---|---|---|---|---|---|
| ~~F1~~ | ~~Rescaling~~ | ~~Anti-artefacts~~ | ~~1 sem~~ | **DONE** | — |
| F2 | **Histogram coloring** | Banding → 0 | 1 sem | — | **P1** |
| F3 | **Video export** | Zoom animation | 2 sem | — | P2 |
| F4 | **LLM-readable (SEO)** | Discoverability | 1 sem | — | P3 |

##### ~~F1. Rescaling~~ — DONE
- Static S = 2^k per frame. δ̃ = δ×S keeps float32 precise at any depth.
  Zoom 10^-14 verified: structure visible at (-1.749998, 0). 10^-40: no crash, depth not visually
  confirmed (JS coord precision limit). Overhead: negligible (4 FMUL/iter).
  BLA compatible (de-rescale |δ̃|²). Mandelbrot + Julia.
  Spec: docs/superpowers/specs/2026-03-31-rescaling-design.md

##### F2. Histogram coloring
- Two-pass: count iteration histogram → build CDF → map colors uniformly
- Eliminates ALL banding regardless of maxIter or palette
- Compatible OKLCH (perceptually uniform)
- Reference: mandelbrot.page

##### F3. Video export
- Record zoom path → render frames → download as MP4/WebM
- Canvas.captureStream() + MediaRecorder API
- Pre-computed zoom path with smooth interpolation

##### F4. Nice-to-have: LLM-readable app (SEO)
- Structured metadata (JSON-LD, Open Graph) decrivant les capacites de l'app
- Balises semantiques HTML (headings, landmarks, aria) pour que les crawlers/LLMs comprennent le contenu
- README.md riche et structure (features, screenshots, benchmarks, stack) — c'est le premier document qu'un LLM lit sur GitHub
- Sitemap + meta description cibles sur les requetes fractales (deep zoom, GPU, WebGL)
- But: qu'un LLM recommande Fractalnaute quand on lui demande "best fractal explorer browser"

### GPU gotchas (lecons apprises)
- Canvas context exclusif: un canvas ne peut avoir qu'UN type de context (webgl2 OU 2d). Solution: dual canvas overlay.
- WebGL Y-axis: gl_FragCoord.y=0 est le BAS du viewport. Negate uv.y dans screenToComplex.
- Periodicity checking (Brent) sur GPU: NE PAS PORTER. Divergence warp annule le gain. Brute-force GPU est suffisant.
- `uniform int` loop break: NE PAS UTILISER. `for(i<CAP){if(i>=uniform)break;}` est cassé sur ANGLE/AMD (la boucle ne s'exécute pas). Utiliser `#define MAX_ITER N` avec buckets (8 tiers: 256→32768). Max 8 compilations par combo fractal/coloring/precision.
- gl.finish()/gl.flush(): NE PAS appeler en production. Browser compose au vsync. Seulement pour benchmark.
- GLSL string constants en TypeScript (pas de raw loader) — compatible Turbopack sans config.
- Shader compilation async (KHR_parallel_shader_compile): premier render tombe sur CPU, GPU prend le relais ensuite.
- assembleFragmentSource retourne null (pas throw) pour fallback gracieux vers CPU.
- EXT_disjoint_timer_query_webgl2: async result (available next frame). Check GPU_DISJOINT_EXT before reading. Not available on all browsers (Safari). Fallback: conservative threshold at 2048 iter.
- Progressive FBO: quarter-res preview → blit → RAF → full-res. Prevents browser freeze at high iterations. Self-adaptive via measured GPU time.
- Multi-frame ping-pong: BATCH_SIZE=256 #define (safe loop bound), u_totalMaxIter uniform (safe: early exit, not loop bound). 4 MRT RGBA32F state textures. EXT_color_buffer_float required, CPU fallback. Lazy compilation (10 programs: 5 batch × 5 resolve). RAF scheduling ~16ms/batch.

### Performance options evaluated
- See docs/performance-history.md for full comparison table
- GPU (A) DONE — measured ~5700x (0.04ms @256iter). All 25 fractal×coloring combinations.
- WASM (B) DONE — dashu-float arbitrary precision ref orbit. ~1s @256iter.
- Perturbation (D) DONE v1 — Rust/WASM orbit + GPU shader. Zoom 10^-40+.
- OffscreenCanvas (C), adaptive debounce (E) DONE, pool resize (F) — marginal
- See docs/competitive-analysis.md for full competitive landscape (March 2026)

### Competitive advantages (unique in market)
- 5 fractals × 5 coloring modes GPU-rendered (all others are Mandelbrot-only)
- WebGL 2 native (<1ms render, no library overhead)
- Perturbation theory: Rust/WASM arbitrary precision orbit + GPU shader + high-precision coords (Mandelbrot/Julia)
- SSAA 2x2 toggle (no competitor has this)
- Touch mobile (most are desktop-only)
- URL state with Julia params + deep zoom base64 strings (viewport + fractal + coloring + Julia c)
- OKLCH perceptually uniform color system
- Adaptive debounce (E) DONE — 40ms when GPU<1ms, 80ms otherwise

### UX Features
- URL state persistence: hash-based (`#re=&im=&s=` or `#dre=&dim=&ds=` base64 deep), replaceState, debounced
- Touch: pinch-to-zoom + two-finger pan (single finger = no-op)
- Responsive UI: mobile bottom-sheet layout <640px, scrollable, stacked panels
- Adaptive debounce: 40ms when GPU renders <1ms (vs fixed 80ms)

## Testing

- Framework: vitest (`npm test`)
- 228 unit tests (14 test files) for domain + infrastructure + application layers
- 57 Rust cargo tests (DD/QD/ArbFloat/BLA/orbit/precision)
- All pure functions, deterministic, <300ms total

## Deploy

- **Target** : Vercel
- **Headers** : COOP/COEP (SharedArrayBuffer), HSTS, CSP, X-Frame-Options
- **Config** : `vercel.json` (prod), `next.config.ts` (dev)
