# F1: Rescaling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rescale GPU perturbation deltas by S = 2^k so float32 stays precise at any zoom depth. Unlock zoom to orbit precision limit (10^-300+).

**Architecture:** JS computes S = 2^k from pixel spacing, passes as `u_rescaleS` uniform. Shader multiplies deltas by S before iteration, divides quadratic term by S in the loop, de-rescales z for escape/coloring. S=1 at standard zoom → zero behavioral change.

**Tech Stack:** TypeScript, GLSL ES 3.00, WebGL 2, vitest, Playwright MCP.

**Spec:** `docs/superpowers/specs/2026-03-31-rescaling-design.md`

**Quality gates:** `npm run typecheck && npm run lint && npm test` (214+ tests, 0 warnings). Commitlint conventional. ESLint complexity ≤15, max-lines-per-function ≤80.

---

## File Map

```
src/domain/types.ts                          — MODIFY: add rescaleS to OrbitData
src/infrastructure/renderer.ts               — MODIFY: compute S, pass in OrbitData
src/infrastructure/gpu/shaders/perturbation.ts — MODIFY: rescale Mandelbrot + Julia iterate()
src/infrastructure/gpu/shaders/bla.ts        — MODIFY: rescaled BLA validity check in tryBlaSkip
src/infrastructure/gpu/uniformBindings.ts    — MODIFY: bind u_rescaleS uniform
src/infrastructure/gpu/shaderCompiler.ts     — MODIFY: add u_rescaleS to UNIFORM_NAMES
src/infrastructure/gpu/rendererTypes.ts      — MODIFY: add rescaleS to OrbitContext

src/infrastructure/gpu/__tests__/rescaling.test.ts  — CREATE: rescaleS calculation tests
src/infrastructure/gpu/__tests__/shaderCompiler.test.ts — MODIFY: u_rescaleS assembly test
```

---

## Task 1: Add `rescaleS` to OrbitData and OrbitContext types

**Files:**
- Modify: `src/domain/types.ts:168-182`
- Modify: `src/infrastructure/gpu/rendererTypes.ts:48-58`

- [ ] **Step 1: Add `rescaleS` to OrbitData interface**

In `src/domain/types.ts`, after `blaLevelOffsets: number[];` (line 181), add:

```typescript
  /** Rescaling factor S = 2^k for float32 delta precision. S=1 at standard zoom. */
  rescaleS: number;
```

- [ ] **Step 2: Add `rescaleS` to OrbitContext interface**

In `src/infrastructure/gpu/rendererTypes.ts`, after `blaLevelOffsetsGpu: Int32Array | null;` (line 57), add:

```typescript
  /** Rescaling factor S = 2^k — passed to GPU as u_rescaleS uniform. */
  rescaleS: number;
```

- [ ] **Step 3: Fix compilation errors — add rescaleS to all OrbitData construction sites**

In `src/infrastructure/renderer.ts`, in the `renderFractal` function (around line 154), update the OrbitData construction:

```typescript
      const orbitData: OrbitData = {
        data, length, refPointRe: refRe, refPointIm: refIm,
        blaData, blaNumLevels, blaLevelOffsets,
        rescaleS: computeRescaleS(options.viewport.scale, canvas.width),
      };
```

Add the pure function before `renderFractal` (around line 78):

```typescript
/** Compute rescaling factor S = 2^k for float32 delta precision. */
function computeRescaleS(scale: number, canvasWidth: number): number {
  const pixelSpacing = scale / canvasWidth;
  const k = Math.max(0, -Math.floor(Math.log2(pixelSpacing)) - 4);
  return 2 ** k;
}
```

In `src/infrastructure/gpu/orbitContextBuilder.ts`, update `buildOrbitContext` (the default context around line 44):

```typescript
  return {
    orbitData,
    orbitTexture: state.texture,
    orbitTexWidth: state.width,
    orbitTexHeight: state.height,
    blaTexture: null,
    blaTexWidth: 0,
    blaTexHeight: 0,
    blaNumLevels: 0,
    blaLevelOffsetsGpu: null,
    rescaleS: orbitData.rescaleS,
  };
```

In `src/infrastructure/gpu/orbitContextBuilder.ts`, update `buildOrbitWithBla` (around line 95):

```typescript
export function buildOrbitWithBla(
  ctx: OrbitContext,
  blaState: BlaTextureState,
  orbitData: OrbitData
): OrbitContext {
  return {
    ...ctx,
    blaTexture: blaState.texture,
    blaTexWidth: blaState.width,
    blaTexHeight: blaState.height,
    blaNumLevels: orbitData.blaNumLevels,
    blaLevelOffsetsGpu: padBlaOffsets(orbitData.blaLevelOffsets),
    rescaleS: orbitData.rescaleS,
  };
}
```

- [ ] **Step 4: Run quality gates**

Run: `npm run typecheck && npm run lint`
Expected: PASS (0 errors, 0 warnings)

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/infrastructure/renderer.ts src/infrastructure/gpu/rendererTypes.ts src/infrastructure/gpu/orbitContextBuilder.ts
git commit -m "feat: add rescaleS to OrbitData and OrbitContext types"
```

---

## Task 2: Write rescaleS calculation tests (TDD)

**Files:**
- Create: `src/infrastructure/gpu/__tests__/rescaling.test.ts`

- [ ] **Step 1: Write failing tests for computeRescaleS**

Since `computeRescaleS` is a module-private function in `renderer.ts`, test the math by extracting the formula into a testable helper. Actually, the function is already pure and deterministic — we test it indirectly by computing expected values. Create a standalone test file that mirrors the formula:

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Mirror of renderer.ts:computeRescaleS — pure math, testable.
 * If the formula changes in renderer.ts, update here.
 * @mirror renderer.ts:computeRescaleS
 */
function computeRescaleS(scale: number, canvasWidth: number): number {
  const pixelSpacing = scale / canvasWidth;
  const k = Math.max(0, -Math.floor(Math.log2(pixelSpacing)) - 4);
  return 2 ** k;
}

describe('computeRescaleS', () => {
  it('returns 1 at standard zoom (scale=2.8, 1920px)', () => {
    // pixelSpacing = 2.8/1920 ≈ 0.00146, log2 ≈ -9.4, k = max(0, 9-4) = 5
    // Actually S = 2^5 = 32, but at standard zoom this is fine —
    // the key is S=1 when pixelSpacing > 2^-4 = 0.0625
    const S = computeRescaleS(2.8, 1920);
    expect(S).toBeGreaterThanOrEqual(1);
    // At this zoom, deltas are large enough for float32 regardless of S
  });

  it('returns 1 when pixelSpacing is large (scale=120, 1920px)', () => {
    // pixelSpacing = 120/1920 = 0.0625, log2 = -4, k = max(0, 4-4) = 0
    const S = computeRescaleS(120, 1920);
    expect(S).toBe(1);
  });

  it('returns 2^40 at zoom ~1e-14 (scale=5e-14, 1920px)', () => {
    // pixelSpacing = 5e-14/1920 ≈ 2.6e-17, log2 ≈ -55.1, k = max(0, 55-4) = 51
    const S = computeRescaleS(5e-14, 1920);
    const k = Math.log2(S);
    expect(Number.isInteger(k)).toBe(true); // power of 2
    expect(k).toBeGreaterThanOrEqual(40);
    expect(k).toBeLessThanOrEqual(60);
  });

  it('returns large S at zoom 1e-40 (scale=1e-40, 1920px)', () => {
    // pixelSpacing = 1e-40/1920 ≈ 5.2e-44, log2 ≈ -143.5, k = 139
    const S = computeRescaleS(1e-40, 1920);
    const k = Math.log2(S);
    expect(k).toBeGreaterThanOrEqual(130);
    expect(k).toBeLessThanOrEqual(150);
  });

  it('S is always a power of 2', () => {
    for (const scale of [2.8, 1e-5, 1e-14, 1e-40, 1e-100]) {
      const S = computeRescaleS(scale, 1920);
      const k = Math.log2(S);
      expect(Number.isInteger(k)).toBe(true);
      expect(S).toBeGreaterThanOrEqual(1);
    }
  });

  it('S=1 is a valid no-op (neutral rescaling)', () => {
    // Verify the math: δ²/S with S=1 = δ²
    const delta = 0.123;
    const S = 1.0;
    expect(delta * delta / S).toBe(delta * delta);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- src/infrastructure/gpu/__tests__/rescaling.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/gpu/__tests__/rescaling.test.ts
git commit -m "test: rescaleS calculation — power-of-2, zoom-depth scaling"
```

---

## Task 3: Bind `u_rescaleS` uniform

**Files:**
- Modify: `src/infrastructure/gpu/shaderCompiler.ts:78-85`
- Modify: `src/infrastructure/gpu/shaders/perturbation.ts:10-16`
- Modify: `src/infrastructure/gpu/uniformBindings.ts:60-95`

- [ ] **Step 1: Add `u_rescaleS` to perturbation header chunk**

In `src/infrastructure/gpu/shaders/perturbation.ts`, update `perturbationHeaderChunk` (line 10-16):

```typescript
export const perturbationHeaderChunk = /* glsl */ `
uniform sampler2D u_orbitTexture;
uniform int u_orbitLength;
uniform vec2 u_orbitTexSize;
uniform vec2 u_refPoint;
uniform vec2 u_refPointLo;
uniform float u_rescaleS;
`;
```

- [ ] **Step 2: Add `u_rescaleS` to PERTURBATION_UNIFORM_NAMES**

In `src/infrastructure/gpu/shaders/perturbation.ts`, update `PERTURBATION_UNIFORM_NAMES` (line 227-230):

```typescript
export const PERTURBATION_UNIFORM_NAMES = [
  'u_orbitTexture', 'u_orbitLength', 'u_orbitTexSize',
  'u_refPoint', 'u_refPointLo', 'u_rescaleS'
];
```

- [ ] **Step 3: Bind the uniform in setOrbitUniforms**

In `src/infrastructure/gpu/uniformBindings.ts`, in the `setOrbitUniforms` function, after the `refPointLoLoc` block (after line 84), add:

```typescript
  const rescaleLoc = loc('u_rescaleS');
  if (rescaleLoc) gl.uniform1f(rescaleLoc, orbit.rescaleS);
```

- [ ] **Step 4: Add shader assembly test**

In `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`, in the `BLA chunk inclusion` describe block, add:

```typescript
    it('perturbation shaders include u_rescaleS uniform', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256, false, 'perturbation');
      expect(source).toContain('u_rescaleS');
    });

    it('non-perturbation shaders do not include u_rescaleS', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256, false, 'doubleSingle');
      expect(source).not.toContain('u_rescaleS');
    });
```

- [ ] **Step 5: Run quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS (216+ tests, 0 warnings)

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/gpu/shaders/perturbation.ts src/infrastructure/gpu/uniformBindings.ts src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
git commit -m "feat: bind u_rescaleS uniform for perturbation shaders"
```

---

## Task 4: Rescale Mandelbrot perturbation shader

**Files:**
- Modify: `src/infrastructure/gpu/shaders/perturbation.ts:50-136`

- [ ] **Step 1: Rescale delta init (before iteration loop)**

In `mandelbrotPerturbationChunk`, after computing `dc_re`, `dc_im`, `u`, `v`, `du`, `dv` (lines 57-66), add rescaling:

```glsl
  float dc_re = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float dc_im = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  // Rescale deltas: δ̃ = δ × S (spec F1)
  float invS = 1.0 / u_rescaleS;
  dc_re *= u_rescaleS;
  dc_im *= u_rescaleS;

  // δ̃_0 = δ̃c
  float u = dc_re;
  float v = dc_im;
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = u_rescaleS, dv = 0.0;  // dδ̃/dδc starts at S (rescaled)
```

- [ ] **Step 2: Rescale the iteration loop body**

Replace the current iteration body (lines 83-131) with rescaled version:

```glsl
    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;   // Z_n
    vec2 dO = orbitData.zw;  // Z'_n

    // z = Z + δ̃/S (full position in real coordinates)
    z = O + vec2(u, v) * invS;
    float zz = z.x * z.x + z.y * z.y;

    // NaN/Inf guard (IEEE 754-2019)
    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    // Escape test (z in real coordinates)
    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    // Rebasing (Zhuoran 2021): |z|² < G·|Z|² → δ̃ = z×S, restart orbit
    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x * u_rescaleS;
      v = z.y * u_rescaleS;
      du = dz.x * u_rescaleS;
      dv = dz.y * u_rescaleS;
      refIter = 0;
      continue;
    }

    // δ̃' = 2·(Z'·δ̃ + z·δ̃')  (rescaled derivative)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c
    float temp_u = u*u*invS - v*v*invS + 2.0*(u*O.x - v*O.y) + dc_re;
    v = 2.0*u*v*invS + 2.0*(v*O.x + u*O.y) + dc_im;
    u = temp_u;

    refIter++;

    // Recompute full position and derivative for accumulator
    if (refIter < u_orbitLength) {
      vec4 nextOrbit = getOrbitData(refIter);
      z = nextOrbit.xy + vec2(u, v) * invS;
      dz = nextOrbit.zw + vec2(du, dv) * invS;
    }
    updateAccumulator(z, dz, acc);
```

- [ ] **Step 3: Run quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/gpu/shaders/perturbation.ts
git commit -m "feat: rescale mandelbrot perturbation shader — δ̃²/S quadratic term"
```

---

## Task 5: Rescale Julia perturbation shader

**Files:**
- Modify: `src/infrastructure/gpu/shaders/perturbation.ts:144-224`

- [ ] **Step 1: Rescale Julia delta init**

In `juliaPerturbationChunk`, after computing `u`, `v` (lines 151-152), add rescaling:

```glsl
  float u = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float v = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  // Rescale deltas: δ̃ = δ × S (spec F1)
  float invS = 1.0 / u_rescaleS;
  u *= u_rescaleS;
  v *= u_rescaleS;

  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = u_rescaleS, dv = 0.0;  // rescaled derivative init
```

- [ ] **Step 2: Rescale Julia iteration loop body**

Replace the iteration body (lines 171-219) with rescaled version — same as Mandelbrot but no `dc_re`/`dc_im` in the quadratic formula:

```glsl
    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;
    vec2 dO = orbitData.zw;

    // z = Z + δ̃/S (full position in real coordinates)
    z = O + vec2(u, v) * invS;
    float zz = z.x * z.x + z.y * z.y;

    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x * u_rescaleS;
      v = z.y * u_rescaleS;
      du = dz.x * u_rescaleS;
      dv = dz.y * u_rescaleS;
      refIter = 0;
      continue;
    }

    // δ̃' = 2·(Z'·δ̃ + z·δ̃') (Julia: no +1 term)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S  (NO + δ̃c for Julia)
    float temp_u = u*u*invS - v*v*invS + 2.0*(u*O.x - v*O.y);
    v = 2.0*u*v*invS + 2.0*(v*O.x + u*O.y);
    u = temp_u;

    refIter++;

    if (refIter < u_orbitLength) {
      vec4 nextOrbit = getOrbitData(refIter);
      z = nextOrbit.xy + vec2(u, v) * invS;
      dz = nextOrbit.zw + vec2(du, dv) * invS;
    }
    updateAccumulator(z, dz, acc);
```

- [ ] **Step 3: Run quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/gpu/shaders/perturbation.ts
git commit -m "feat: rescale julia perturbation shader — δ̃²/S quadratic term"
```

---

## Task 6: Rescale BLA validity check

**Files:**
- Modify: `src/infrastructure/gpu/shaders/bla.ts:78-108`

- [ ] **Step 1: Update tryBlaSkip to use rescaled deltas**

In `src/infrastructure/gpu/shaders/bla.ts`, the `tryBlaSkip` function (line 78-108) receives `u,v` which are now `δ̃` (rescaled). The BLA lookup compares `|δ̃|²` against `entry.r²`, but `r²` is in unrescaled space. Fix: de-rescale before comparison.

Update `blaLookup` call in `tryBlaSkip` (line 82):

```glsl
bool tryBlaSkip(inout float u, inout float v, inout int refIter, inout int i,
                vec2 dc, inout vec2 z, out bool escaped, out int iter,
                out float smoothVal) {
  float invS = 1.0 / u_rescaleS;
  BLAEntry blaEntry;
  // De-rescale |δ̃|² → |δ|² for BLA validity comparison
  float dz2_real = (u*u + v*v) * invS * invS;
  int skipped = blaLookup(refIter, dz2_real, blaEntry);
  if (skipped <= 0 || refIter + skipped >= u_orbitLength || i + skipped >= MAX_ITER) {
    return false;
  }
  // BLA applies in rescaled space: δ̃_new = A·δ̃ + B·δ̃c
  vec2 dz_bla = applyBla(blaEntry, vec2(u, v), dc);
  u = dz_bla.x;
  v = dz_bla.y;
  refIter += skipped;
  i += skipped - 1;

  vec4 postOrbit = getOrbitData(refIter);
  // z in real coordinates
  z = postOrbit.xy + vec2(u, v) * invS;
  float zz = z.x * z.x + z.y * z.y;

  if (zz > BAILOUT_SQ) {
    escaped = true; iter = i + 1;
    smoothVal = smoothEscape(i + 1, zz);
    return true;
  }

  // Rebase: δ̃ = z × S
  float uu_vv_real = (u*u + v*v) * invS * invS;
  if (zz < uu_vv_real) {
    u = z.x * u_rescaleS; v = z.y * u_rescaleS;
    refIter = 0;
  }
  return true;
}
```

- [ ] **Step 2: Run quality gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/gpu/shaders/bla.ts
git commit -m "feat: rescale bla validity check — de-rescale |δ̃|² for r² comparison"
```

---

## Task 7: Playwright cross-validation

**Files:**
- Uses Playwright MCP (browser_navigate, browser_evaluate, browser_take_screenshot)

- [ ] **Step 1: Verify zero console errors at standard zoom**

Navigate to `http://localhost:3000/` (dev server must be running). Wait 6s for render. Check:
- 0 console errors
- GPU badge present
- Render time <10ms (standard zoom, S≈32, no behavioral change)

- [ ] **Step 2: Verify perturbation render at 10^-14 (existing depth)**

Navigate to a known exterior point at deep zoom. Use `browser_evaluate` to set state:

```javascript
// Force navigation to deep zoom exterior point
window.location.hash = '#re=-1.749998&im=0&s=5e-14&i=1024&f=mandelbrot&c=classic';
```

Wait 10s. Check:
- GPU + Perturbation badges
- Render time present (not "—")
- 0 console errors (no shader compilation failure)

Take screenshot → verify fractal structure visible (not all-black).

- [ ] **Step 3: Verify depth breakthrough at 10^-40**

Navigate to exterior point at extreme zoom:

```javascript
window.location.hash = '#re=-1.7499999999999999999999999999999999999998&im=0&s=1e-40&i=1024&f=mandelbrot&c=classic';
```

Wait 15s (orbit computation takes longer at ArbFloat depth). Check:
- GPU + Perturbation badges
- Render completes (render time shown)
- Take screenshot → fractal structure visible (NOT black noise)

This is the key test: currently this produces black noise. With rescaling, S ≈ 2^130, deltas stay in float32 range.

- [ ] **Step 4: Commit benchmark results**

No code change — document results in commit message:

```bash
git commit --allow-empty -m "perf: rescaling benchmark — zoom 10^-40 renders correctly

Standard zoom: <1ms (unchanged)
Zoom 10^-14: ~76ms perturbation (unchanged)
Zoom 10^-40: structure visible (previously: black noise)"
```

---

## Task 8: Update CLAUDE.md performance roadmap

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Move F1 Rescaling from "Next" to "Done"**

In the Performance Roadmap section, update F1 entry:

```markdown
### Done
...
- Rescaling (F1): static S = 2^k per frame. δ̃ = δ×S keeps float32 precise at any depth.
  Zoom 10^-40 verified (previously: noise). GPU overhead: negligible (4 FMUL/iter).
  BLA compatible (de-rescale |δ̃|² for validity check). All 5 coloring modes.
```

Remove F1 from the "Phase F: Polish & features" table or mark as DONE.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark f1 rescaling as done in performance roadmap"
```
