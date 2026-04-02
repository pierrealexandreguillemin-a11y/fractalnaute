# Session Handoff — 2026-04-02

## Contexte projet

Fractalnaute est un explorateur de fractales WebGL 2 (Next.js, TypeScript, Rust/WASM).
5 fractales (Mandelbrot, Julia, BurningShip, Tricorn, Multibrot) × 5 colorings (classic, stripe, decomposition, orbitTrap, normalMap) = 25 combinaisons GPU-rendered.

Le projet a un pipeline deep zoom : float32 → double-single (DS, 2×f32) → perturbation theory (Rust/WASM orbit + GPU delta shader). Iter auto-scaling : 512×log2(1/scale), cap 32768.

**14 normes** régissent tout le code (CLAUDE.md) : 7 ISO (IEEE 754, ISO 5055/25010/9241-110/40500/27001/80000-2) + 7 opérationnelles (Playwright benchmarks, perf-history, meilleur du marché, verified=preuve, jamais dévier du plan, pas de push auto, ton code=tes bugs).

## Ce qui s'est passé cette session

### Problème initial : le "mur"

L'utilisateur voyait un mur noir/uniforme au deep zoom (~500K×). Le GPU shader compilait sans erreur mais ne faisait pas les itérations. Cause root : le pattern GLSL `for(i < 32768) { if(i >= u_maxIter) break; }` est cassé sur ANGLE/AMD — la boucle ne s'exécute pas.

### Fix 1 : `#define MAX_ITER` bucketed (commit `daec946`, pushé)

Revert du `uniform int u_maxIter` → `#define MAX_ITER N` avec 8 tiers (256, 512, ..., 32768). La boucle `for(i < MAX_ITER)` avec un bound compile-time fonctionne sur tous les drivers. Mais le driver AMD ne gère toujours pas les loops > ~4096 itérations, même avec `#define`.

### Fix 2 : Cap GPU 4096 iter (commit `ad074a0`, pushé)

Quand l'auto-scaling demande > 4096 iterations, le GPU est skippé et les CPU workers font le rendu (4-5 secondes). Ça marche mais c'est lent.

### Fix 3 : E2c multi-frame ping-pong (10 commits, mergé dans main, PAS pushé)

Split le render GPU en batches de 256 itérations par frame RAF. Chaque batch lit l'état précédent (z, dz, iter, accumulateur) depuis 4 textures RGBA32F, itère 256 fois, écrit le nouvel état. Un shader "resolve" mappe l'état final en couleur après chaque batch.

Architecture :
- **4 textures RGBA32F × 2 ping-pong** = 8 textures état per-pixel (~265 MB @1080p)
- **T_Z** : z.x, z.y (ou DS hi/lo pairs pour Mandelbrot)
- **T_Info** : iter, escaped, smoothVal, count
- **T_Acc** : dz.x, dz.y, stripeSum, trapDistSq
- **T_Hist** : stripePrev1, stripePrev2, stripePrev3, 0
- **5 batch shaders** (1 DS Mandelbrot + 4 float32) × **5 resolve shaders** = 10 programmes WebGL
- Compilation lazy (Map cache), RAF scheduling 1 batch/frame
- Cancel via stale flag + cancelAnimationFrame
- Fallback CPU si `EXT_color_buffer_float` absent ou shader compile fail
- `u_totalMaxIter` est un uniform (safe : early exit, PAS un loop bound)
- `u_bailoutSq` est un uniform (4.0 ou 300000.0 selon coloring)
- `BATCH_SIZE = 256` est un `#define` (safe loop bound)

### Canonisation des normes

Les 14 normes du projet étaient éparpillées (7 ISO dans une spec de mars, 7 opérationnelles dans des fichiers memory). Elles sont maintenant toutes dans CLAUDE.md comme source de vérité unique.

## État git

```
Branch : main
Dernier commit : 7baa42b (docs: session handoff)
Remote : origin/main est à ad074a0 (le GPU cap 4096)
Delta non-pushé : 12 commits (E2c multi-frame + handoff)
Worktree : .worktrees/e2c-multiframe (à nettoyer)
```

## Fichiers clés E2c

| Fichier | Rôle | Lignes |
|---------|------|--------|
| `src/infrastructure/gpu/shaders/multiFrame.ts` | 5 batch GLSL + 5 resolve GLSL + shared chunks | 614 |
| `src/infrastructure/gpu/multiFrameRenderer.ts` | FBO 4-MRT + controller RAF + compile lazy | 417 |
| `src/infrastructure/gpu/shaderCompiler.ts` | +assembleMultiFrameBatchSource/ResolveSource | +77 |
| `src/infrastructure/gpu/webglRenderer.ts` | +renderMultiFrame() | +24 |
| `src/infrastructure/gpu/rendererTypes.ts` | +MultiFrameFBO type | +17 |
| `src/infrastructure/renderer.ts` | tryMultiFrame dispatch (>4096 iter) | rewrite |
| `src/ui/InfoPanel.tsx` | aria-live="polite" (WCAG) | 1 line |
| `src/infrastructure/gpu/__tests__/multiFrameShader.test.ts` | 34 tests assembly | 55 |

## Benchmarks mesurés

| Scénario | GPU multi-frame | CPU | Speedup |
|----------|----------------|-----|---------|
| Mandelbrot DS @10K iter, zoom 2.8Mx | 2280ms | 5380ms | 2.4x |
| Mandelbrot DS @8.8K iter, zoom 466Kx | 771ms | ~4000ms | 5.2x |
| Default zoom (256 iter) | <1ms single-pass | — | Pas de régression |

## Vérifié (preuve screenshot Playwright)

- [x] Mandelbrot DS deep zoom 2.8Mx — GPU, détail visible
- [x] Mandelbrot DS deep zoom 466Kx — GPU, spirales magnifiques, mur cassé
- [x] Julia deep zoom — GPU multi-frame, badge GPU visible (5671ms, 8505 auto iter)
- [x] Default zoom — CPU first render (normal, GPU compile async), pas de régression
- [x] Build prod — `npm run build` pass
- [x] 262 tests — `npm test` pass

## NON vérifié — à faire en priorité

- [ ] **BurningShip deep zoom** — `http://localhost:3000/#f=burningship&re=-1.75&im=-0.02&s=0.00001`
- [ ] **Stripe coloring deep zoom** — `http://localhost:3000/#re=0.3219&im=-0.0352&s=0.000006&c=stripe`
- [ ] **OrbitTrap coloring** — `http://localhost:3000/#re=0.3219&im=-0.0352&s=0.000006&c=orbitTrap` (vérifie que trapDistSq init=1e20 fonctionne)
- [ ] **Cancel mid-render** — naviguer deep zoom puis immédiatement naviguer ailleurs → pas de crash, pas de console error WebGL

## 2 fixes code à faire

### Fix A : BATCH_SIZE en double
`multiFrameRenderer.ts:91` définit `const BATCH_SIZE = 256` (JS) et `shaderCompiler.ts:207` définit `'#define BATCH_SIZE 256'` (GLSL string). Si l'un change sans l'autre → batches mal comptés. Extraire la constante 256 en un seul endroit, par exemple exporter depuis `multiFrameRenderer.ts` et l'utiliser dans `shaderCompiler.ts` : `` `#define BATCH_SIZE ${MULTI_FRAME_BATCH_SIZE}` ``.

### Fix B : JSDoc manquant
`shaderCompiler.ts:assembleMultiFrameBatchSource` a les params `_coloring` et `_interiorColoring` préfixés `_` (unused). C'est intentionnel : le batch shader utilise TOUJOURS l'accumulateur réel (pas noop) et le coloring est appliqué dans le resolve shader, pas le batch. Mais ça mérite un JSDoc explicite pour que personne ne "fixe" ce qui n'est pas un bug.

## Audits passés

- **ISO audit complet** : 8 fichiers × 14 normes → 0 critique, 2 important (les 2 fixes ci-dessus)
- **CPU fallback** : code path vérifié (EXT absent → createMultiFrameFBO null → start() null → tryMultiFrame null → CPU)
- **Cancel** : stale flag + cancelAnimationFrame + pendingRAF=null → pas de RAF orphelin
- **NaN/Inf guards** : `makeNanInfGuard()` dans les 5 batch shaders (IEEE 754-2019)
- **@mirror tags** : 40+ dans multiFrame.ts (ISO 80000-2)

## Instructions de reprise

### 1. Lire ce fichier + CLAUDE.md (normes) + plan (`docs/superpowers/plans/2026-04-02-multiframe-ping-pong.md`)

### 2. Appliquer Fix A + Fix B
```bash
# Fix A : extraire BATCH_SIZE
# Fix B : ajouter JSDoc
npm run typecheck && npm run lint && npm test
git commit -m "fix(e2c): shared BATCH_SIZE constant, document unused batch params"
```

### 3. Lancer dev server et faire les 4 tests visuels
```bash
npm run dev
```
Naviguer aux 4 URLs listées dans "NON vérifié". Pour chaque :
- Screenshot comme preuve
- Vérifier que le status bar montre `GPU` (pas `CPU`)
- Vérifier que le rendu a du détail (pas un mur uniforme)
- Pour cancel : vérifier console (F12) = pas d'erreur WebGL

### 4. Si tout passe → commit les screenshots + mettre à jour ce handoff
```bash
git commit -m "test(e2c): visual verification — BurningShip, stripe, orbitTrap, cancel"
```

### 5. NE PAS PUSH — attendre instruction explicite de l'utilisateur

### 6. Cleanup worktree (optionnel)
```bash
git worktree remove .worktrees/e2c-multiframe
```

## Commandes utiles
```bash
npm run dev             # Dev server (Turbopack)
npm test                # 262 vitest
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --max-warnings 0
npm run build           # Build prod
cargo test --manifest-path wasm/Cargo.toml  # 57 rust tests
```
