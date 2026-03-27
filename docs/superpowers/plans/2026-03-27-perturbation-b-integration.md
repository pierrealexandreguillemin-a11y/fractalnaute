# Perturbation Theory — Plan B: Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Plan A foundation (WASM orbit, GLSL shader, orbit texture) into the existing codebase. After this plan: deep zoom works end-to-end.

**Prerequisite:** Plan A (`2026-03-27-perturbation-a-foundation.md`) completed and verified. All go/no-go gates passed.

**Architecture:** Extend shader compiler with perturbation path → extend WebGL renderer with orbit uniforms → wire renderer facade → add UX (progress, cancel, badges, deep URLs) → benchmark.

**Spec:** `docs/superpowers/specs/2026-03-26-perturbation-theory-design.md`

---

## File Map

### Modified files
- `src/infrastructure/gpu/shaderCompiler.ts` — Add perturbation assembly path, extend `ShaderKey`
- `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts` — Perturbation assembly tests
- `src/infrastructure/gpu/webglRenderer.ts` — Orbit texture binding, perturbation uniforms, `GPURenderOptions` extension
- `src/infrastructure/renderer.ts` — Perturbation pipeline in facade, `getPrecisionMode()`, async orbit
- `src/infrastructure/useRenderer.ts` — Pass zoom target to renderer
- `src/application/useFractalState.ts` — Track precision mode + orbit computing state
- `src/application/useCanvasEvents.ts` — Escape cancel
- `src/application/useUrlState.ts` — Deep URL encoding (base64 decimal strings)
- UI component for InfoPanel — Precision badge + orbit progress bar

### Referenced files (from Plan A, read-only)
- `src/infrastructure/gpu/shaders/perturbation.ts` — GLSL chunks (created in Plan A)
- `src/infrastructure/gpu/orbitTexture.ts` — Texture upload (created in Plan A)
- `src/infrastructure/wasmBridge.ts` — WASM bridge (created in Plan A)
- `src/infrastructure/orbit.worker.ts` — Orbit Worker (created in Plan A)
- `src/domain/types.ts` — `PrecisionMode`, `OrbitData`, `DeepViewport` (added in Plan A)

---

## Task 1: Shader Compiler Extension

**Goal:** Extend `assembleFragmentSource` to produce perturbation shaders.

**Files:**
- Modify: `src/infrastructure/gpu/shaderCompiler.ts`
- Modify: `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`

- [ ] **Step 1: Write failing test for perturbation assembly**

Add to `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`:
```typescript
import { assembleFragmentSource } from '../shaderCompiler';

describe('perturbation shader assembly', () => {
  it('assembles mandelbrot perturbation shader', () => {
    const source = assembleFragmentSource('mandelbrot', 'classic', 256, false, 'perturbation');
    expect(source).not.toBeNull();
    expect(source).toContain('u_orbitTexture');
    expect(source).toContain('getOrbitData');
    expect(source).toContain('refIter = 0'); // rebasing
  });

  it('assembles julia perturbation shader', () => {
    const source = assembleFragmentSource('julia', 'classic', 256, false, 'perturbation');
    expect(source).not.toBeNull();
    expect(source).toContain('u_orbitTexture');
  });

  it('returns null for unsupported perturbation fractals', () => {
    expect(assembleFragmentSource('burningship', 'classic', 256, false, 'perturbation')).toBeNull();
    expect(assembleFragmentSource('tricorn', 'classic', 256, false, 'perturbation')).toBeNull();
    expect(assembleFragmentSource('multibrot3', 'classic', 256, false, 'perturbation')).toBeNull();
  });

  it('perturbation works with all 5 coloring modes', () => {
    const modes = ['classic', 'stripe', 'decomposition', 'orbitTrap', 'normalMap'] as const;
    for (const mode of modes) {
      const source = assembleFragmentSource('mandelbrot', mode, 256, false, 'perturbation');
      expect(source).not.toBeNull();
    }
  });

  it('existing DS tests still pass with default precision param', () => {
    // 4-arg calls default to 'doubleSingle' — no regression
    const source = assembleFragmentSource('mandelbrot', 'classic', 256, false);
    expect(source).not.toBeNull();
    expect(source).toContain('ds_add'); // DS arithmetic
    expect(source).not.toContain('u_orbitTexture');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`
Expected: FAIL — `assembleFragmentSource` doesn't accept 5th argument yet.

- [ ] **Step 3: Implement perturbation path in shaderCompiler.ts**

In `src/infrastructure/gpu/shaderCompiler.ts`:

1. Add imports at top:
```typescript
import {
  perturbationHeaderChunk, orbitLookupChunk,
  mandelbrotPerturbationChunk, juliaPerturbationChunk,
  PERTURBATION_UNIFORM_NAMES
} from './shaders/perturbation';
import type { PrecisionMode } from '../../domain/types';
```

2. Update `ShaderKey` type:
```typescript
type ShaderKey = `${FractalType}_${ColoringMode}_${number}_${boolean}_${PrecisionMode}`;
```

3. Extend `UNIFORM_NAMES`:
```typescript
const UNIFORM_NAMES = [
  'u_center', 'u_scale', 'u_resolution', 'u_palette',
  'u_juliaRe', 'u_juliaIm', 'u_power', 'u_interiorColoring',
  ...DS_UNIFORM_NAMES,
  ...PERTURBATION_UNIFORM_NAMES
];
```

4. Update `assembleFragmentSource` — add `precision` parameter with default:
```typescript
export function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number,
  interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle'
): string | null {
  const coloringChunk = getColoringChunk(coloring);
  if (!coloringChunk) return null;

  const needsRealAccum = coloring !== 'classic' || interiorColoring;
  const accumulator = needsRealAccum ? accumulatorRealChunk : accumulatorNoopChunk;
  const isStripe = coloring === 'stripe';
  const paletteChunk = isStripe ? cosinePaletteLookupChunk : paletteLookupChunk;
  const defines = buildDefines(maxIter, isStripe);

  // Perturbation path
  if (precision === 'perturbation') {
    const iteration = fractal === 'mandelbrot' ? mandelbrotPerturbationChunk
                    : fractal === 'julia' ? juliaPerturbationChunk
                    : null;
    if (!iteration) return null;

    return [
      headerChunk, perturbationHeaderChunk, dsHeaderChunk, defines,
      doubleSingleChunk, screenToComplexDSChunk, screenToComplexChunk,
      smoothEscapeChunk, paletteChunk, accumulator,
      orbitLookupChunk, iteration, coloringChunk, mainChunk
    ].join('\n');
  }

  // Existing DS/float32 paths (unchanged)
  const useDS = fractal === 'mandelbrot';
  const iteration = useDS ? mandelbrotDSIterationChunk : getIterationChunk(fractal);
  if (!iteration) return null;

  return [
    headerChunk,
    ...(useDS ? [dsHeaderChunk, defines, doubleSingleChunk, screenToComplexDSChunk] : [defines]),
    screenToComplexChunk, smoothEscapeChunk, paletteChunk, accumulator,
    iteration, coloringChunk, mainChunk
  ].join('\n');
}
```

5. Update `isGpuSupported`:
```typescript
export function isGpuSupported(
  fractal: FractalType, coloring: ColoringMode,
  precision: PrecisionMode = 'doubleSingle'
): boolean {
  if (precision === 'perturbation') {
    return (fractal === 'mandelbrot' || fractal === 'julia')
      && getColoringChunk(coloring) !== null;
  }
  const hasIteration = fractal === 'mandelbrot' || getIterationChunk(fractal) !== null;
  return hasIteration && getColoringChunk(coloring) !== null;
}
```

6. Update `getOrCompile` to pass precision:
```typescript
export function getOrCompile(
  gl: WebGL2RenderingContext, fractal: FractalType, coloring: ColoringMode,
  maxIter: number, interiorColoring: boolean,
  precision: PrecisionMode = 'doubleSingle'
): CompiledProgram | null {
  const key: ShaderKey = `${fractal}_${coloring}_${maxIter}_${interiorColoring}_${precision}`;
  // ... rest uses assembleFragmentSource(fractal, coloring, maxIter, interiorColoring, precision)
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`
Expected: All tests pass (existing + new).

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/gpu/shaderCompiler.ts src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
git commit -m "feat(gpu): extend shader compiler with perturbation assembly path"
```

---

## Task 2: WebGL Renderer Extension

**Goal:** Extend `webglRenderer.ts` to bind orbit texture and set perturbation uniforms.

**Files:**
- Modify: `src/infrastructure/gpu/webglRenderer.ts`

- [ ] **Step 1: Add imports**

```typescript
import { createOrbitTexture, updateOrbitTexture, destroyOrbitTexture } from './orbitTexture';
import type { OrbitData, PrecisionMode } from '../../domain/types';
```

- [ ] **Step 2: Extend GPURenderOptions**

```typescript
export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
  ssaa?: boolean;
  precision?: PrecisionMode;
  orbitData?: OrbitData;
}
```

- [ ] **Step 3: Add orbit state + uniform binding inside createWebGLRenderer**

```typescript
// State
let orbitTexture: WebGLTexture | null = null;
let orbitTexWidth = 0;
let orbitTexHeight = 0;

// Upload orbit (reuse texture if fits)
function uploadOrbit(data: OrbitData): boolean {
  if (orbitTexture && data.length <= orbitTexWidth * orbitTexHeight) {
    updateOrbitTexture(gl, orbitTexture, data.data, data.length, orbitTexWidth, orbitTexHeight);
    return true;
  }
  if (orbitTexture) destroyOrbitTexture(gl, orbitTexture);
  const result = createOrbitTexture(gl, data.data, data.length);
  if (!result) return false; // EXT_color_buffer_float unavailable (ISO 25010)
  orbitTexture = result.texture;
  orbitTexWidth = result.width;
  orbitTexHeight = result.height;
  return true;
}

// Bind orbit uniforms
function setOrbitUniforms(locs: Map<string, WebGLUniformLocation>, orbit: OrbitData): void {
  const l = (name: string) => locs.get(name);
  const len = l('u_orbitLength');
  if (len) gl.uniform1i(len, orbit.length);
  const ts = l('u_orbitTexSize');
  if (ts) gl.uniform2f(ts, orbitTexWidth, orbitTexHeight);
  const rp = l('u_refPoint');
  if (rp) { const [h] = splitDouble(orbit.refPointRe); const [i] = splitDouble(orbit.refPointIm); gl.uniform2f(rp, h, i); }
  const rpl = l('u_refPointLo');
  if (rpl) { const [,lo1] = splitDouble(orbit.refPointRe); const [,lo2] = splitDouble(orbit.refPointIm); gl.uniform2f(rpl, lo1, lo2); }
  const ot = l('u_orbitTexture');
  if (ot && orbitTexture) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, orbitTexture); gl.uniform1i(ot, 1); gl.activeTexture(gl.TEXTURE0); }
}
```

- [ ] **Step 4: Wire into render() method**

In the `render()` method, after `getOrCompile` and before draw:
```typescript
const precision = options.precision ?? 'doubleSingle';
const compiled = getOrCompile(gl, options.fractalType, options.coloringMode,
  options.maxIterations, options.interiorColoring, precision);
// ...existing setCenterAndScale...
if (precision === 'perturbation' && options.orbitData) {
  if (!uploadOrbit(options.orbitData)) return false; // ISO 25010: fallback
  setOrbitUniforms(compiled.uniformLocations, options.orbitData);
}
```

- [ ] **Step 5: Clean up orbit texture in destroy()**

```typescript
if (orbitTexture) destroyOrbitTexture(gl, orbitTexture);
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: All pass (new params are optional, no regression).

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/gpu/webglRenderer.ts
git commit -m "feat(gpu): orbit texture binding + perturbation uniforms in WebGL renderer"
```

---

## Task 3: Pipeline Integration — Renderer Facade

**Goal:** Wire the complete perturbation pipeline: zoom target → WASM orbit → GPU render.

**Files:**
- Modify: `src/infrastructure/renderer.ts`
- Modify: `src/infrastructure/useRenderer.ts`

- [ ] **Step 1: Add perturbation imports and helpers to renderer.ts**

```typescript
import { needsPerturbation, computeReferenceOrbit, cancelOrbit } from './wasmBridge';
import type { OrbitData, PrecisionMode } from '../domain/types';

function getPrecisionMode(viewport: Viewport, fractalType: FractalType): PrecisionMode {
  if (!needsPerturbation(viewport.scale)) {
    return fractalType === 'mandelbrot' ? 'doubleSingle' : 'float32';
  }
  return (fractalType === 'mandelbrot' || fractalType === 'julia')
    ? 'perturbation' : 'doubleSingle';
}
```

- [ ] **Step 2: Add zoomTarget to RenderOptions**

```typescript
export interface RenderOptions {
  // ...existing fields...
  zoomTargetRe?: number;
  zoomTargetIm?: number;
}
```

- [ ] **Step 3: Add perturbation path in renderFractal**

Before the existing GPU path, add:
```typescript
const precision = getPrecisionMode(options.viewport, options.fractalType);

if (precision === 'perturbation' && gpuRenderer) {
  const refRe = options.zoomTargetRe ?? options.viewport.centerRe;
  const refIm = options.zoomTargetIm ?? options.viewport.centerIm;

  computeReferenceOrbit(
    refRe.toString(), refIm.toString(),
    options.maxIterations, options.viewport.scale.toString()
  ).then(({ data, length, cancelled }) => {
    if (cancelled) return; // user cancelled, stale render
    const orbitData: OrbitData = { data, length, refPointRe: refRe, refPointIm: refIm };
    const t0 = performance.now();
    const ok = gpuRenderer.render({
      viewport: options.viewport, fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      coloringMode: options.coloringMode ?? 'classic',
      interiorColoring: options.interiorColoring ?? false,
      fractalParams: options.params, ssaa: options.ssaa,
      precision: 'perturbation', orbitData,
    });
    if (ok) {
      gpuRenderer.setVisible(true);
      options.onComplete?.(performance.now() - t0, 'gpu');
    }
  }).catch(() => {
    // WASM error or timeout — fall through to DS on next render
  });

  return () => { cancelOrbit(); gpuRenderer.cancelPending(); };
}
```

- [ ] **Step 4: Pass zoom target from useRenderer.ts**

In `src/infrastructure/useRenderer.ts`, thread `zoomTargetRe/Im` from the last zoom action into `RenderOptions`. The zoom focus already exists in `useFractalState.ts` (the `ZOOM` action stores `focusRe`, `focusIm`). Store it in state and pass to the renderer.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run typecheck && npm test`

- [ ] **Step 6: Manual test**

Run: `npm run wasm:build && npm run dev`
Zoom to ~10^-14 on Mandelbrot. Verify no errors, perturbation activates.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/renderer.ts src/infrastructure/useRenderer.ts
git commit -m "feat: integrate perturbation pipeline — zoom target → WASM orbit → GPU render"
```

---

## Task 4: UX — Progress, Cancel, Badges, Deep URLs

**Goal:** Orbit progress bar, Escape cancel, precision badge, WCAG, deep URL encoding.

**Files:**
- Modify: `src/application/useFractalState.ts`
- Modify: `src/application/useCanvasEvents.ts`
- Modify: `src/application/useUrlState.ts`
- Modify: UI component for InfoPanel (find via `grep -r InfoPanel src/`)

- [ ] **Step 1: Add orbit state to useFractalState.ts**

```typescript
import type { PrecisionMode } from '../domain/types';

// Add to FractalState:
precisionMode: PrecisionMode;
orbitComputing: boolean;

// Add to initialState:
precisionMode: 'float32',
orbitComputing: false,

// Add reducer cases:
case 'SET_PRECISION_MODE':
  return { ...state, precisionMode: action.mode };
case 'SET_ORBIT_COMPUTING':
  return { ...state, orbitComputing: action.computing };
```

- [ ] **Step 2: Add Escape cancel to useCanvasEvents.ts**

In the `keydown` handler `switch` block:
```typescript
case 'Escape':
  cancelOrbit(); // import from '../infrastructure/wasmBridge'
  break;
```

- [ ] **Step 3: Add precision badge to InfoPanel (WCAG 1.4.1)**

```tsx
<span
  aria-live="polite"
  className="text-xs px-1.5 py-0.5 rounded border"
  title={precisionMode === 'perturbation'
    ? 'Deep zoom powered by perturbation theory — zoom deeper than 10⁻¹⁵' : undefined}
>
  {precisionMode === 'float32' && '32-bit'}
  {precisionMode === 'doubleSingle' && 'DS'}
  {precisionMode === 'perturbation' && 'Perturbation'}
</span>
```

- [ ] **Step 4: Add orbit progress bar (WCAG 2.1)**

```tsx
{orbitComputing && (
  <div
    role="progressbar"
    aria-valuenow={orbitProgress}
    aria-valuemin={0}
    aria-valuemax={maxIterations}
    aria-label="Computing reference orbit"
    className="h-1 bg-neutral-700 rounded overflow-hidden"
  >
    <div
      className="h-full bg-blue-500 transition-all duration-100"
      style={{ width: `${(orbitProgress / maxIterations) * 100}%` }}
    />
  </div>
)}
```

Poll `getOrbitProgress()` from `wasmBridge.ts` via `useEffect` + `requestAnimationFrame` while `orbitComputing` is true.

- [ ] **Step 5: Add deep URL encoding to useUrlState.ts**

```typescript
import { PERTURBATION_THRESHOLD } from '../infrastructure/wasmBridge';

function encodeDeepViewport(viewport: Viewport): string {
  if (viewport.scale >= PERTURBATION_THRESHOLD) {
    return `re=${viewport.centerRe}&im=${viewport.centerIm}&s=${viewport.scale}`;
  }
  return `dre=${btoa(viewport.centerRe.toString())}&dim=${btoa(viewport.centerIm.toString())}&ds=${btoa(viewport.scale.toString())}`;
}

function decodeDeepViewport(params: URLSearchParams): Viewport | null {
  const dre = params.get('dre');
  if (!dre) return null;
  return {
    centerRe: parseFloat(atob(dre)),
    centerIm: parseFloat(atob(params.get('dim') ?? '')),
    scale: parseFloat(atob(params.get('ds') ?? '')),
  };
}
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/application/ src/ui/
git commit -m "feat(ux): orbit progress bar, Escape cancel, precision badge, WCAG, deep URLs"
```

---

## Task 5: Playwright Benchmarks + Performance History

**Goal:** Measure and document perturbation performance.

**Files:**
- Modify: `docs/performance-history.md`

- [ ] **Step 1: Benchmark at multiple zoom depths**

Test coordinates:
- Overlap: `re=-0.75, im=0.1, scale=1e-13`
- Deep: `re=-1.768778833, im=-0.001738996, scale=1e-20`
- Very deep: `re=-0.7436438885706, im=0.1318259043, scale=1e-40`

Measure: orbit WASM time, GPU render time, total wall-clock.

- [ ] **Step 2: Document in performance-history.md**

```markdown
### + Perturbation Theory (Rust/WASM + GPU)

Reference orbit: Rust/WASM astro-float arbitrary precision.
GPU: perturbation delta iteration with rebasing (Zhuoran 2021).
Auto-switch: float32 → DS → perturbation at 10^-7 / 10^-13.

| Zoom | Orbit (WASM) | GPU render | Total | Notes |
|---|---|---|---|---|
| 10^-13 | Xms | Xms | Xms | Overlap zone (validates parity with DS) |
| 10^-20 | Xms | Xms | Xms | |
| 10^-40 | Xms | Xms | Xms | |
| 10^-60 | Xms | Xms | Xms | |
```

- [ ] **Step 3: Commit**

```bash
git add docs/performance-history.md
git commit -m "perf: add perturbation benchmarks to performance history"
```

---

## Future Tasks (post Plan B, documented in spec)

### Series Approximation (SA) — Spec step 7
- Polynomial coefficients `A_n, B_n, C_n` in Rust
- Skip iterations on GPU via precomputed polynomials
- Expected: 5-10x speedup at deep zoom

### Progressive Orbit — Spec step 8
- Render partial orbit during computation, re-render when complete
- Target: <200ms to first visual at 10^-60

### Rescaling — Spec step 10
- Range extension `δ = S·w` when float32 delta underflows
- Only if artefacts observed at extreme relative zoom

---

## Plan B Verification Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] `cargo test` passes (Rust unit tests)
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] Manual: zoom overview → 10^-40 Mandelbrot, no artefacts
- [ ] Manual: zoom overview → 10^-40 Julia, no artefacts
- [ ] Manual: BurningShip/Tricorn at 10^-14 show DS fallback gracefully
- [ ] Overlap zone (10^-13): perturbation ≈ DS output visually
- [ ] InfoPanel shows correct precision badge
- [ ] URL state preserved on reload at deep zoom
- [ ] Escape cancels orbit computation
- [ ] Progress bar: `role="progressbar"` + `aria-valuenow/min/max` (WCAG 2.1)
- [ ] Precision badge: `aria-live="polite"` (WCAG 2.1)
- [ ] Badge distinguishable without color — text + border (WCAG 1.4.1)
- [ ] `cargo audit` clean (ISO 27001)
- [ ] CSP includes `wasm-unsafe-eval` in vercel.json (ISO 27001)
- [ ] Playwright benchmarks documented in performance-history.md
