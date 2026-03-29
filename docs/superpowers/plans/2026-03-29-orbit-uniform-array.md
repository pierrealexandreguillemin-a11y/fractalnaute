# E2a: Orbit Uniform Array — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace orbit texture (`texelFetch`) with uniform array (`u_orbit[N]`) for perturbation rendering. Test hypothesis: texelFetch is the 50ms bottleneck.

**Architecture:** `#ifdef USE_ORBIT_UNIFORMS` in GLSL selects uniform array vs texture. Shader compiler sets the define when `maxIter <= MAX_ORBIT_UNIFORMS`. JS side uploads via `gl.uniform4fv` instead of texture bind. Fallback to texture for high iteration counts.

**Tech Stack:** GLSL ES 3.00, WebGL 2, TypeScript.

**Spec:** `docs/superpowers/specs/2026-03-29-orbit-uniform-array-design.md`

---

## File Map

```
src/infrastructure/gpu/
  shaders/perturbation.ts  — MODIFY: add uniform-based header + orbit lookup chunks
  shaderCompiler.ts        — MODIFY: add USE_ORBIT_UNIFORMS define, query max uniforms
  webglRenderer.ts         — MODIFY: upload orbit via gl.uniform4fv when uniform path active
  orbitTexture.ts           — UNCHANGED (kept for fallback)
```

---

## Task 1: GLSL Uniform Orbit Chunks

**Goal:** Add new GLSL chunks for uniform-based orbit access. Keep existing texture chunks intact.

**Files:**
- Modify: `src/infrastructure/gpu/shaders/perturbation.ts`

- [ ] **Step 1: Add uniform-based header chunk**

In `src/infrastructure/gpu/shaders/perturbation.ts`, add after `perturbationHeaderChunk` (line 16):

```typescript
/**
 * Uniforms for orbit data as array (register-speed access).
 * Used when maxIter <= MAX_ORBIT_UNIFORMS (set by shader compiler).
 * @tradeoff Uniform array avoids texelFetch overhead (~236M reads at 256iter).
 * Fallback to texture for high iteration counts.
 */
export const perturbationUniformHeaderChunk = /* glsl */ `
uniform vec4 u_orbit[MAX_ORBIT_SIZE];
uniform int u_orbitLength;
uniform vec2 u_refPoint;
uniform vec2 u_refPointLo;
`;
```

- [ ] **Step 2: Add uniform-based orbit lookup chunk**

Add after `orbitLookupChunk` (line 24):

```typescript
/** Orbit uniform array lookup — direct register access, no texture fetch. */
export const orbitUniformLookupChunk = /* glsl */ `
vec4 getOrbitData(int i) {
  return u_orbit[i];
}
`;
```

- [ ] **Step 3: Add `u_orbit` to uniform names**

Add after `PERTURBATION_UNIFORM_NAMES` (line 214):

```typescript
/** Uniform names for the orbit-as-uniforms path. */
export const PERTURBATION_UNIFORM_UNIFORM_NAMES = [
  'u_orbit', 'u_orbitLength',
  'u_refPoint', 'u_refPointLo'
];
```

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1
```

Expected: all 201 tests pass (no runtime change yet).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/gpu/shaders/perturbation.ts
git commit -m "feat(gpu): add GLSL uniform orbit chunks (register-speed access)"
```

---

## Task 2: Shader Compiler — Uniform Path Selection

**Goal:** Shader compiler selects uniform or texture path based on `maxIter` vs GPU limit.

**Files:**
- Modify: `src/infrastructure/gpu/shaderCompiler.ts`

- [ ] **Step 1: Add MAX_ORBIT_UNIFORMS constant and define logic**

Read `src/infrastructure/gpu/shaderCompiler.ts`. Find the `buildDefines` function and the perturbation assembly section.

Add at the top of the file (after imports):

```typescript
/**
 * @tradeoff Max orbit iterations storable as uniforms.
 * WebGL 2 guarantees MIN 224 fragment uniform vectors.
 * Reserve ~30 for other uniforms → 190 safe.
 * Configurable per GPU via gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS).
 */
export const DEFAULT_MAX_ORBIT_UNIFORMS = 190;
```

- [ ] **Step 2: Modify `assembleFragmentSource` for perturbation path**

In the perturbation path (around line 142-156), replace:

```typescript
    return [
      headerChunk, perturbationHeaderChunk, dsHeaderChunk, defines,
      doubleSingleChunk, screenToComplexDSChunk, screenToComplexChunk,
      smoothEscapeChunk, paletteChunk, accumulator,
      orbitLookupChunk, iteration, coloringChunk, mainChunk
    ].join('\n');
```

With:

```typescript
    const useUniformOrbit = maxIter <= maxOrbitUniforms;
    const orbitHeader = useUniformOrbit
      ? perturbationUniformHeaderChunk
      : perturbationHeaderChunk;
    const orbitLookup = useUniformOrbit
      ? orbitUniformLookupChunk
      : orbitLookupChunk;
    const orbitDefines = useUniformOrbit
      ? `#define USE_ORBIT_UNIFORMS\n#define MAX_ORBIT_SIZE ${maxIter}\n`
      : '';

    return [
      headerChunk, orbitHeader, dsHeaderChunk, defines, orbitDefines,
      doubleSingleChunk, screenToComplexDSChunk, screenToComplexChunk,
      smoothEscapeChunk, paletteChunk, accumulator,
      orbitLookup, iteration, coloringChunk, mainChunk
    ].join('\n');
```

- [ ] **Step 3: Add `maxOrbitUniforms` parameter**

Update `assembleFragmentSource` signature to accept an optional parameter:

```typescript
export function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number,
  interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle',
  maxOrbitUniforms: number = DEFAULT_MAX_ORBIT_UNIFORMS
): string | null {
```

- [ ] **Step 4: Add imports for new chunks**

Update the import from `./shaders/perturbation` to include:

```typescript
import {
  perturbationHeaderChunk, orbitLookupChunk,
  perturbationUniformHeaderChunk, orbitUniformLookupChunk,
  mandelbrotPerturbationChunk, juliaPerturbationChunk,
  PERTURBATION_UNIFORM_NAMES, PERTURBATION_UNIFORM_UNIFORM_NAMES,
} from './shaders/perturbation';
```

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1
```

Expected: existing shader compiler tests pass. The perturbation shader tests should still produce valid shader source.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/gpu/shaderCompiler.ts
git commit -m "feat(gpu): shader compiler selects uniform vs texture orbit path"
```

---

## Task 3: WebGL Renderer — Uniform Upload

**Goal:** Upload orbit data via `gl.uniform4fv` when uniform path is active. Keep texture path as fallback.

**Files:**
- Modify: `src/infrastructure/gpu/webglRenderer.ts`

- [ ] **Step 1: Add uniform orbit upload to `setOrbitUniforms`**

Read `src/infrastructure/gpu/webglRenderer.ts` lines 117-153 (`setOrbitUniforms` function).

Replace the function with:

```typescript
/** Set perturbation-specific uniforms (orbit data, ref point, orbit length). */
function setOrbitUniforms(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  orbit: OrbitContext
): void {
  const loc = (name: string) => locations.get(name);

  const lenLoc = loc('u_orbitLength');
  if (lenLoc) gl.uniform1i(lenLoc, orbit.orbitData.length);

  const refPointLoc = loc('u_refPoint');
  if (refPointLoc) {
    const [reHi] = splitDouble(orbit.orbitData.refPointRe);
    const [imHi] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refPointLoc, reHi, imHi);
  }

  const refPointLoLoc = loc('u_refPointLo');
  if (refPointLoLoc) {
    const [, reLo] = splitDouble(orbit.orbitData.refPointRe);
    const [, imLo] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refPointLoLoc, reLo, imLo);
  }

  // Uniform orbit path: upload orbit data as vec4 array
  const orbitLoc = loc('u_orbit');
  if (orbitLoc) {
    gl.uniform4fv(orbitLoc, orbit.orbitData.data.subarray(0, orbit.orbitData.length * 4));
    return; // uniform path — no texture bind needed
  }

  // Texture fallback path
  const orbitTexLoc = loc('u_orbitTexture');
  if (orbitTexLoc) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, orbit.orbitTexture);
    gl.uniform1i(orbitTexLoc, 1);
    gl.activeTexture(gl.TEXTURE0);
  }
}
```

The key insight: the shader compiler decides which path at compile time (`USE_ORBIT_UNIFORMS` define). The uniform location `u_orbit` only exists if the uniform path was compiled in. So `loc('u_orbit')` returns the location only when the uniform path is active — zero branching needed at render time.

- [ ] **Step 2: Query `MAX_FRAGMENT_UNIFORM_VECTORS` at init**

Find the renderer init function (where `gl` context is created). Add:

```typescript
const maxFragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
// Reserve ~30 for non-orbit uniforms (viewport, palette, etc.)
const maxOrbitUniforms = Math.max(0, maxFragUniforms - 30);
```

Pass `maxOrbitUniforms` through to wherever `assembleFragmentSource` is called for perturbation shaders.

- [ ] **Step 3: Update uniform name lookup**

Find where `PERTURBATION_UNIFORM_NAMES` is used to collect uniform locations. Add `PERTURBATION_UNIFORM_UNIFORM_NAMES` entries so that `u_orbit` location is queried when the uniform path is compiled in:

```typescript
// After existing PERTURBATION_UNIFORM_NAMES usage:
// Also look up u_orbit (only exists when USE_ORBIT_UNIFORMS is defined)
for (const name of [...PERTURBATION_UNIFORM_NAMES, ...PERTURBATION_UNIFORM_UNIFORM_NAMES]) {
  const loc = gl.getUniformLocation(program, name);
  if (loc) locations.set(name, loc);
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npm run typecheck && npm test 2>&1
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/gpu/webglRenderer.ts
git commit -m "feat(gpu): upload orbit via gl.uniform4fv (register-speed access)"
```

---

## Task 4: Benchmark + Performance Validation

**Goal:** Measure before/after render time. Confirm or reject texelFetch hypothesis.

**Files:**
- No code changes — measurement only

- [ ] **Step 1: Start dev server**

```bash
npm run dev &
```

- [ ] **Step 2: Run Playwright benchmarks**

```bash
npx playwright test e2e/perturbation-benchmark.spec.ts --reporter=line
```

Record the 3 results (10^-14, 10^-20, 10^-40).

- [ ] **Step 3: Compare with baseline**

Baseline (texture path):
| Zoom | GPU render |
|---|---|
| 10^-14 | ~60ms |
| 10^-20 | ~51ms |
| 10^-40 | ~54ms |

If uniform path: expected <15ms. If no improvement: bottleneck is elsewhere.

- [ ] **Step 4: Update performance-history.md**

Add results under the "Precision Ladder" section:

```markdown
### + Orbit Uniform Array (E2a)

Replaced texelFetch orbit texture with uniform vec4 array for ≤190 iterations.

| Zoom | Before (texture) | After (uniform) | Speedup |
|---|---|---|---|
| 10^-14 | ~60ms | Xms | Xx |
| 10^-20 | ~51ms | Xms | Xx |
| 10^-40 | ~54ms | Xms | Xx |
```

- [ ] **Step 5: Commit**

```bash
git add docs/performance-history.md
git commit -m "perf: orbit uniform array benchmark results (E2a)"
```

- [ ] **Step 6: Push**

```bash
git push
```
