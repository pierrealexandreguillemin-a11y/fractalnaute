# Session Handoff — 2026-04-02

## Résumé session

**Bug d'entrée :** GPU shader ne rendait pas les itérations au-delà de ~4096 (mur noir/uniforme à deep zoom). Cause : le pattern GLSL `for(i<CAP){if(i>=uniform)break;}` cassé sur ANGLE/AMD.

**Fix 1 (commit `daec946`) :** Revert `u_maxIter` uniform → `#define MAX_ITER N` avec 8 tiers bucketed (256→32768).

**Fix 2 (commit `ad074a0`) :** Cap GPU à 4096 iter, fallback CPU au-delà.

**Fix 3 — E2c multi-frame (10 commits, mergé dans main) :** Ping-pong multi-frame — split render en batches 256 iter/frame via 4 MRT RGBA32F FBOs. Lève le cap GPU. 25 fractal×coloring combos.

**Canonisation normes :** 14 normes projet (7 ISO + 7 opérationnelles) canonisées dans CLAUDE.md — étaient enterrées dans une spec de mars.

## État git

- **Branch :** main
- **Worktree :** `.worktrees/e2c-multiframe` (peut être nettoyé : `git worktree remove .worktrees/e2c-multiframe`)
- **PAS pushé** — attendre instruction utilisateur

## E2c — Benchmarks mesurés

| Scénario | GPU multi-frame | CPU | Speedup |
|----------|----------------|-----|---------|
| Mandelbrot DS @10K iter, zoom 2.8Mx | 2280ms | 5380ms | 2.4x |
| Mandelbrot DS @8.8K iter, zoom 466Kx | 771ms | ~4000ms | 5.2x |
| Default zoom (256 iter) | <1ms single-pass | — | Pas de régression |

## Vérifié (preuve screenshot)

- [x] Mandelbrot DS deep zoom 2.8Mx — GPU, détail visible
- [x] Mandelbrot DS deep zoom 466Kx — GPU, spirales visibles
- [x] Julia deep zoom — GPU multi-frame, badge GPU
- [x] Default zoom — pas de régression

## NON vérifié (Playwright session fermée)

- [ ] BurningShip deep zoom GPU multi-frame
- [ ] Non-classic coloring (stripe, orbitTrap, normalMap) en multi-frame
- [ ] Cancel mid-render (navigate pendant multi-frame → pas de crash)
- [ ] orbitTrap coloring (trapDistSq init = 1e20)

## Audité par code review

- CPU fallback EXT absent → **PASS**
- Cancel implementation → **PASS**
- ISO audit 8 fichiers × 14 normes → **PASS** (0 critique)

## 2 points importants à corriger

1. **BATCH_SIZE en double** — `multiFrameRenderer.ts:91` (JS) et `shaderCompiler.ts:207` (GLSL). Risque divergence. Extraire constante partagée.
2. **`_coloring`/`_interiorColoring` non documentés** dans `assembleMultiFrameBatchSource` — ajouter JSDoc expliquant : accumulator toujours réel en batch, coloring = resolve-time.

## Pour reprendre

### Étape 1 : Fixer les 2 points importants
```
# Extraire BATCH_SIZE en constante partagée
# Ajouter JSDoc sur assembleMultiFrameBatchSource
npm run typecheck && npm run lint && npm test
git commit -m "fix(e2c): shared BATCH_SIZE constant, document unused batch params"
```

### Étape 2 : Tests visuels manquants (4 combos)
```
npm run dev
# Via Playwright ou manuellement :
# 1. http://localhost:3000/#f=burningship&re=-1.75&im=-0.02&s=0.00001
# 2. http://localhost:3000/#re=0.3219&im=-0.0352&s=0.000006&c=stripe
# 3. http://localhost:3000/#re=0.3219&im=-0.0352&s=0.000006&c=orbitTrap
# 4. Navigate deep → navigate default rapidement → pas de crash
```

### Étape 3 : Push (quand utilisateur le demande)
```
git push  # pre-push hook : typecheck → lint → build → audit
```

### Étape 4 : Cleanup worktree
```
git worktree remove .worktrees/e2c-multiframe
```

## Commandes utiles
```
npm run dev          # Dev server
npm test             # 262 vitest
npm run typecheck    # tsc
npm run lint         # eslint
npm run build        # Build prod
cargo test --manifest-path wasm/Cargo.toml  # 57 rust tests
```
