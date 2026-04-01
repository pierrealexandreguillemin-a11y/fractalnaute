# Session Handoff — 2026-04-01

## Bug critique en cours : LE MUR (shader ne rend pas les itérations)

L'utilisateur voit un mur (couleur uniforme) au zoom ~500K-1.5M près de la frontière Mandelbrot.
Le status bar affiche `iter: 8969 (auto)`, `GPU`, `DS`, `<1ms` — mais <1ms pour 9000 iter est IMPOSSIBLE
sauf si le shader ne fait PAS les itérations (boucle skip, uniform non appliqué, ou shader silently broken).

### Hypothèses à tester en priorité
1. **MAX_ITER_CAP trop grand** — 100K→32768 (fixé ce commit, NON VÉRIFIÉ en prod)
2. **u_maxIter uniform pas bindé** — le `console.warn` ne se déclenche PAS (uniform trouvé), MAIS la valeur pourrait ne pas atteindre le shader. Ajouter `console.warn` avec la VALEUR bindée.
3. **Shader compilé mais la boucle `for(i<MAX_ITER_CAP){if(i>=u_maxIter)break;}` est optimisée/ignorée** — tester avec `#define MAX_ITER N` restauré pour comparer.
4. **Vérification F12 Console obligatoire** — demander à l'utilisateur les erreurs shader console en prod.

### IMPORTANT : le u_maxIter uniform a REMPLACÉ #define MAX_ITER
Avant : `#define MAX_ITER 256` → shader compilé par iter count → cache miss chaque zoom → 100-800ms recompile.
Après : `uniform int u_maxIter` + `const int MAX_ITER_CAP = 32768` → un shader, loop cap constant.
Si ça ne marche pas → REVERT au `#define MAX_ITER` avec des buckets (256, 512, 1024, 2048, 4096, 8192, 16384, 32768) pour limiter les recompilations.

## Ce qui a été livré cette session (32 commits)

### Deep zoom pipeline
- `decimal.js-light` coords haute précision (URL→state→WASM)
- Focus-point via Decimal (pixel offset × scale, plus de f64→0)
- DD/QD Rust parse via `dashu::DBig` (hi+lo extraction)
- `PERTURBATION_THRESHOLD` single source dans domain
- `formatCoord` fix (exponent stripping bug)

### Iteration auto-scaling
- `suggestIterations(scale, userMax)` = 512 × log2(1/scale), cap 32768
- Appliqué à TOUS les chemins de rendu (GPU, CPU, perturbation)
- Slider logarithmique, label "Itérations min"
- Status bar affiche `iter: N (auto)`

### u_maxIter uniform (POTENTIELLEMENT CASSÉ)
- `MAX_ITER` → `u_maxIter` uniform + `MAX_ITER_CAP = 32768` constant
- Shader compilé UNE fois par fractal/coloring/precision (plus de recompile par zoom)
- Cache key sans maxIter

### ISO conformity (2 rounds code review)
- Catmull-Rom standard form (GPU+CPU+tests)
- CPU bailout STRIPE_BAILOUT_SQ
- ImageData WeakMap (plus de singleton)
- wasmBridge activeReject + timeout fix
- Worker `{ type: 'module' }`
- WCAG `type="button"`
- `@tradeoff` tags

### Performance
- Progressive preview 1/8 res + seuil 1024
- `image-rendering: pixelated` supprimé (zoom CSS lisse)
- BLA toggle `?bla=0`
- Speed Insights installé + CSP fixé
- COEP `credentialless` (pour Speed Insights + SharedArrayBuffer)
- Région Vercel `cdg1` (Paris)

### Tests
- 5 Playwright tests formalisés (10^-8, 10^-12, 10^-14, 10^-40, interactif)
- e2e/ exclu de vitest (13/13 pass)
- 228 vitest, 57 cargo

## Pour reprendre

1. **TESTER LE DERNIER DEPLOY** — le MAX_ITER_CAP 32768 est-il suffisant pour casser le mur ?
2. Si mur persiste : **REVERT u_maxIter → #define MAX_ITER avec buckets**
3. Si mur cassé : **F2 histogram coloring** (redistribution palette, élimine banding)
4. **CLS** vérifier si la fix canvas w-full h-full améliore le score
5. **Ping-pong multi-frame (E2c)** pour smooth perturbation

## État git
- Branch: main
- Working tree: CLEAN
- Dernier push: `66c4fb9` — lower gpu loop cap to 32768
- Vercel: deployed, success, cdg1

## Commandes utiles
```bash
npm run dev          # Dev server
npm test             # 228 vitest
npm run typecheck    # tsc
npm run lint         # eslint
npx playwright test e2e/ # 5 e2e tests
cargo test --manifest-path wasm/Cargo.toml  # 57 rust tests
```
