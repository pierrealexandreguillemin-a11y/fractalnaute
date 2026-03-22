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
src/ui/                 → Composants UI (inline styles, migration shadcn en cours)
src/components/ui/      → Composants shadcn/ui (Radix + Tailwind)
src/application/        → Hooks React (state, canvas events)
src/infrastructure/     → Renderer canvas, canvas utils
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

## Deploy

- **Target** : Vercel
- **Headers** : COOP/COEP (SharedArrayBuffer), HSTS, CSP, X-Frame-Options
- **Config** : `vercel.json` (prod), `next.config.ts` (dev)
