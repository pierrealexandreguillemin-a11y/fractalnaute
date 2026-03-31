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

### ESLint (ISO 5055)

- `complexity: 15` max
- `max-lines-per-function: 80` (skipBlankLines, skipComments)
- `sonarjs/cognitive-complexity: 15` max
- `no-console: error` (sauf warn/error)
- Zero warnings autorise (`--max-warnings 0`)

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
   Known limits: structure needs >1024 iter at deep zoom; focus-point zoom degrades past 10^-15
   (f64 offset → 0, @tradeoff documented).

### BROKEN PROMISES (audit 2026-04-01 — honnête)

Engagements des plans/specs NON tenus à ce jour :

1. **"Depth breakthrough at 10^-40: image has non-black pixels"** (rescaling spec L233)
   — NON LIVRÉ. Aplat à 10^-40. 1024 iter insuffisant. Iteration auto-scaling absent.
2. **"Manual verification: Zoom to 10^-60, 10^-100 via UI"** (rescaling spec L237)
   — JAMAIS FAIT. Focus-point f64 dégradé à 10^-15.
3. **"Unlimited zoom depth (10^-60+)"** (perturbation spec L6)
   — FAUX. Structure visible à ~10^-14 max.
4. **"GPU render @256iter <10ms with BLA"** (BLA spec L267)
   — JAMAIS MESURÉ. Pas de benchmark BLA on/off.
5. **"Cross-validation: BLA on vs off pixel match at 10^-14, 10^-40, 10^-80"** (BLA spec L259)
   — JAMAIS FAIT.
6. **"Overlap zone (10^-13): DS and perturbation identical output"** (perturbation spec L593)
   — JAMAIS VÉRIFIÉ.
7. **"Playwright benchmarks at 10^-14, 10^-20, 10^-40"** (perturbation plan B L554)
   — JAMAIS FORMALISÉ. Ad-hoc seulement.
8. **"10^-80: <50ms (malachite)"** (precision ladder plan L308)
   — JAMAIS TESTÉ VISUELLEMENT.

Causes racines :
- Iteration fixe (max 4096 slider) → structure invisible en deep zoom
- Focus-point zoom f64 → offset nul à 10^-15 → navigation impossible
- Aucun test Playwright formalisé → aucune preuve mesurable
- formatCoord bug (exposant strippé) → URLs corrompues (fixé 2026-03-31)

### Next (ordre par impact perf)

Post-precision-ladder : orbite <1ms, GPU ~50ms = nouveau bottleneck.

#### Phase C: Perturbation correctness — DONE (rebasing)

~~C1/C2~~ : rebasing Heiland-Allen dans le shader GLSL gere la detection de glitch
implicitement (spec §2: "Rebasing eliminates multi-reference entirely").
Grid search inutile avec rebasing.

#### Phase D: Perceived speed — DEPRIORITISE

| # | Feature | Gain | Effort | Status |
|---|---|---|---|---|
| D1 | **Progressive orbit** | <200ms to first visual | 1 sem | **Deprioritise** |

D1 masquerait une latence orbit qui n'existe plus (<1ms avec DD/QD).
Utile uniquement pour iterations elevees (10K+) ou ArbFloat (10^-80+, ~5ms).
Reprioritiser si un nouveau bottleneck apparait.

#### Phase E: Real speed

| # | Feature | Gain | Effort | Status |
|---|---|---|---|---|
| ~~E1~~ | ~~Orbit perf (DD/QD)~~ | ~~100-1000x~~ | ~~2 sem~~ | **DONE** (precision ladder) |
| E2 | **Series Approximation (SA)** | GPU 50ms → <5ms | 3 sem | **NEXT** |

##### ~~E1. Orbit performance — DONE~~
- Precision ladder: DD 0.03ms, QD 0.26ms, ArbFloat 5.28ms @256iter.
- Orbite n'est plus le bottleneck. GPU render (~50ms) est le nouveau bottleneck.
- Spec: `docs/superpowers/specs/2026-03-29-precision-ladder-design.md`
- Plan: `docs/superpowers/plans/2026-03-29-precision-ladder.md`

##### E2. GPU perturbation render optimization — **NEXT**

Bottleneck identifie : perturbation GPU = 50-80ms vs 0.03ms standard.
Cause reelle : boucle d'iteration GPU (256 iter/pixel, branching rebasing/bailout/NaN).
texelFetch teste et elimine (stub vec4(0.0) → pas de gain coherent).

| # | Technique | Impact | Effort | Status |
|---|---|---|---|---|
| ~~E2a~~ | ~~Orbit uniform array~~ | ~~50ms→10ms~~ | ~~1 sem~~ | **ELIMINE** (texelFetch pas le bottleneck) |
| ~~E2b~~ | ~~BLA (Bivariate Linear Approximation)~~ | ~~Skip 80-99% iter~~ | ~~3-4 sem~~ | **DONE** |
| E2c | **Ping-pong multi-frame** | <1ms first visible | 1 sem | Deprioritise (masque latence) |
| E2d | **SA classique** | 2-3x | 2-3 sem | Supersede par BLA |

Techniques eliminees (avec justification mathematique) :
- Matrix exponentiation : z^2+c est quadratique, pas lineaire
- Parareal : iteration chaotique, coarse solver inutile
- Neural surrogates : frontiere fractale = frequence infinie, NN ne peut pas representer
- Periodicity GPU : divergence warp annule le gain (deja documente)
- Workgroup shared memory : pas disponible en WebGL 2 (WebGPU requis)

Ordre d'execution : ~~E2a~~ → ~~E2b~~ → E2c (deprioritise) | F2 (histogram) **NEXT**

#### Phase F: Polish & features

| # | Feature | Gain | Effort | Reference |
|---|---|---|---|---|
| ~~F1~~ | ~~**Rescaling**~~ | ~~Anti-artefacts extreme zoom~~ | ~~1 sem~~ | ~~Zhuoran 2021~~ |
| F2 | **Histogram coloring** | Banding → 0 | 1 sem | mandelbrot.page (HCL) |
| F3 | **Video export** | Feature (zoom animation) | 2 sem | mandelbrot.page |
| F4 | **LLM-readable app (SEO)** | Discoverability | 1 sem | — |

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
- gl.finish()/gl.flush(): NE PAS appeler en production. Browser compose au vsync. Seulement pour benchmark.
- GLSL string constants en TypeScript (pas de raw loader) — compatible Turbopack sans config.
- Shader compilation async (KHR_parallel_shader_compile): premier render tombe sur CPU, GPU prend le relais ensuite.
- assembleFragmentSource retourne null (pas throw) pour fallback gracieux vers CPU.
- EXT_disjoint_timer_query_webgl2: async result (available next frame). Check GPU_DISJOINT_EXT before reading. Not available on all browsers (Safari). Fallback: conservative threshold at 2048 iter.
- Progressive FBO: quarter-res preview → blit → RAF → full-res. Prevents browser freeze at high iterations. Self-adaptive via measured GPU time.

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
