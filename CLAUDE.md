# CLAUDE.md — Conventions pour Claude Code

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
- GPU rendering v4 (WebGL 2 + TWGL): Mandelbrot + Classic coloring via fragment shader.
  Measured: 0.04ms @256iter 1920x912 (~5700x vs CPU 228ms). AMD Radeon integrated RDNA2.
  Dual canvas: GPU creates own overlay canvas (pointer-events:none) — single canvas can't have both webgl2 AND 2d context.
  TWGL.js ~15KB (only createTexture). Composable GLSL chunks as TS string constants (compile-time, zero branching).
  Cardioid/bulb pre-test in GLSL. Y-axis negated (-uv.y) for WebGL→canvas convention.
  KHR_parallel_shader_compile async. Palette as 256×1 sRGB texture (gl.LINEAR).
  Progressive FBO infrastructure built but disabled (no measured need).
  Graceful fallback: unsupported fractal/coloring → null → CPU Workers (no throw).
  Facade GPU→Workers→Fallback. Context loss → CPU fallback.

- GPU v2 (all 5 fractals): Julia, BurningShip, Tricorn, Multibrot ported to GLSL.
  Derivative (dz) tracking in all shaders for future distance estimation.
  Measured: 0.025-0.050ms @256iter all fractals (3500-7000x vs CPU).

### Next: GPU v3 (coloring modes) & Deep zoom
- GPU v3: port 5 coloring modes to GLSL (stripe, decomposition, orbitTrap, normalMap) + real accumulator + interior coloring
- Precision: float32 (zoom cap ~10^7). Double-single vec2 extends to ~10^15.

### Future: Deep zoom (perturbation theory)
- JS arbitrary precision ref orbit (Jampary-style) + float32 GPU delta iterations
- Only ~3 browser implementations exist — competitive advantage
- Research: docs/research-deep-mandelbrot.md

### GPU gotchas (lecons apprises)
- Canvas context exclusif: un canvas ne peut avoir qu'UN type de context (webgl2 OU 2d). Solution: dual canvas overlay.
- WebGL Y-axis: gl_FragCoord.y=0 est le BAS du viewport. Negate uv.y dans screenToComplex.
- Periodicity checking (Brent) sur GPU: NE PAS PORTER. Divergence warp annule le gain. Brute-force GPU est suffisant.
- gl.finish()/gl.flush(): NE PAS appeler en production. Browser compose au vsync. Seulement pour benchmark.
- GLSL string constants en TypeScript (pas de raw loader) — compatible Turbopack sans config.
- Shader compilation async (KHR_parallel_shader_compile): premier render tombe sur CPU, GPU prend le relais ensuite.
- assembleFragmentSource retourne null (pas throw) pour fallback gracieux vers CPU.

### Performance options evaluated
- See docs/performance-history.md for full comparison table
- GPU (A) DONE — measured ~5700x (0.04ms @256iter). Mandelbrot+Classic only.
- WASM (B) only for perturbation ref orbit if JS perf insufficient
- OffscreenCanvas (C), adaptive debounce (E), pool resize (F) — marginal, unnecessary after GPU

## Testing

- Framework: vitest (`npm test`)
- 58 unit tests for domain layer (coloringAccumulator, coloringModes, fractals)
- All pure functions, deterministic, 32ms total

## Deploy

- **Target** : Vercel
- **Headers** : COOP/COEP (SharedArrayBuffer), HSTS, CSP, X-Frame-Options
- **Config** : `vercel.json` (prod), `next.config.ts` (dev)
