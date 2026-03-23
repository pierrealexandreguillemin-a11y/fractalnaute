# GPU WebGL 2 Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebGL 2 GPU rendering (TWGL.js) for Mandelbrot + Classic coloring, achieving 10-60x performance gain over CPU Workers, with transparent fallback.

**Architecture:** Composable GLSL chunks assembled at compile-time (zero runtime branching). Facade pattern routes GPU → Workers → Fallback. Thin WebGLRenderer orchestrator delegates to shaderCompiler, paletteTexture, gpuFramebuffer, gpuDetector.

**Tech Stack:** TWGL.js (~15KB gzip), WebGL 2, GLSL 300 es, `KHR_parallel_shader_compile`, `EXT_disjoint_timer_query_webgl2`

**Spec:** `docs/superpowers/specs/2026-03-23-gpu-webgl2-rendering-design.md`

---

## Quality Gates

Every task MUST pass these gates before its commit:

| Gate | Command | Criteria |
|---|---|---|
| **Typecheck** | `npm run typecheck` | Zero errors |
| **Lint** | `npm run lint` | Zero warnings (`--max-warnings 0`) |
| **Tests** | `npm test` | All pass (existing 58 + new) |
| **Build** | `npm run build` | Success |

---

## Definition of Done (DoD)

A task is DONE when:
1. All quality gates pass
2. Code follows SRP (1 responsibility per file, per spec Section 2)
3. DRY respected (domain data never duplicated, `@mirror` tags on GLSL)
4. No `any` types, no `eslint-disable`, no `console.log` (`console.error` permitted per ESLint config)
5. New pure functions have vitest unit tests
6. Commit uses conventional format (`feat:`, `fix:`, `refactor:`, `test:`)

---

## Code Review Checkpoints

| After Task | Review Scope | Focus |
|---|---|---|
| Task 3 | Tasks 1-3: GLSL chunks + shaderCompiler | Shader correctness, `@mirror` accuracy, DRY |
| Task 6 | Full GPU pipeline (render to canvas) | Integration, context handling, fallback |
| Task 8 | Facade + useRenderer + useViewportTransition | No CPU regression, API contract |
| Task 10 | Progressive GPU + timer query | Perf guard, FBO lifecycle |
| Task 11 | Final | Full plan compliance, DoD checklist, visual parity |

---

## File Map

### New files (13)

| File | Responsibility | Task |
|---|---|---|
| `src/infrastructure/gpu/gpuDetector.ts` | WebGL 2 feature detection, cached | 1 |
| `src/infrastructure/gpu/shaders/chunks/header.glsl` | `#version 300 es`, precision, uniforms | 2 |
| `src/infrastructure/gpu/shaders/chunks/screenToComplex.glsl` | Viewport → complex plane | 2 |
| `src/infrastructure/gpu/shaders/chunks/smoothEscape.glsl` | Smooth iteration formula | 2 |
| `src/infrastructure/gpu/shaders/chunks/paletteLookup.glsl` | Texture sample helper | 2 |
| `src/infrastructure/gpu/shaders/chunks/accumulatorNoop.glsl` | Zero-cost noop for Classic | 2 |
| `src/infrastructure/gpu/shaders/iterations/mandelbrot.glsl` | Mandelbrot `iterate()` | 2 |
| `src/infrastructure/gpu/shaders/coloring/classic.glsl` | Classic `mapToParam()` | 2 |
| `src/infrastructure/gpu/shaders/main.glsl` | Template calling iterate + mapToParam | 2 |
| `src/infrastructure/gpu/shaders/fullscreen.vert` | Fullscreen triangle (3 vertices) | 2 |
| `src/infrastructure/gpu/shaderCompiler.ts` | Assemble, compile, cache programs | 3 |
| `src/infrastructure/gpu/paletteTexture.ts` | OKLCH palette → 256×1 sRGB texture | 4 |
| `src/infrastructure/gpu/webglRenderer.ts` | Orchestrate init/render/destroy | 5 |

### New files added later

| File | Responsibility | Task |
|---|---|---|
| `src/infrastructure/gpu/gpuFramebuffer.ts` | FBO quarter-res, blit | 9 |
| `src/infrastructure/gpu/__tests__/gpuDetector.test.ts` | Unit test | 1 |
| `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts` | Unit test | 3 |
| `src/infrastructure/gpu/__tests__/paletteTexture.test.ts` | Unit test | 4 |

### Modified files (5)

| File | Change | Task |
|---|---|---|
| `package.json` | Add `twgl.js` dependency | 1 |
| `src/domain/coloringModes.ts:19` | Add `export` to `COLOR_CYCLE_PERIOD` | 3 |
| `src/infrastructure/renderer.ts` | Add GPU path to facade | 7 |
| `src/infrastructure/useRenderer.ts` | Create WebGLRenderer on mount | 8 |
| `src/infrastructure/useViewportTransition.ts` | Add `gpuActive` flag, skip pixel-shift | 8 |

---

## Task 1: Install TWGL + GPU Detector

**Files:**
- Modify: `package.json`
- Create: `src/infrastructure/gpu/gpuDetector.ts`
- Create: `src/infrastructure/gpu/__tests__/gpuDetector.test.ts`

**DoD:** `isWebGL2Available()` works, TWGL installed, all quality gates pass.

- [ ] **Step 1: Install TWGL.js**

```bash
npm install twgl.js
```

Verify: `node -e "require('twgl.js')"` should not error. If no `@types/twgl.js` exists, we'll add a declaration file.

- [ ] **Step 2: Check TWGL types availability**

```bash
ls node_modules/twgl.js/dist/*/twgl-full.d.ts 2>/dev/null && echo "HAS_TYPES" || echo "NO_TYPES"
```

Also verify the import works:
```bash
node -e "import('twgl.js').then(m => console.log(Object.keys(m).slice(0,5)))"
```

If `NO_TYPES` or import fails: check TWGL v7 package.json for `"types"` and `"exports"` fields. Create `src/infrastructure/gpu/twgl.d.ts` with minimal declarations for what we use (`createTexture`, `setUniforms`). If ESM default export, use `import twgl from 'twgl.js'` instead of `import * as twgl`.

- [ ] **Step 3: Write failing test for gpuDetector**

```typescript
// src/infrastructure/gpu/__tests__/gpuDetector.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isWebGL2Available } from '../gpuDetector';

describe('gpuDetector', () => {
  it('returns false when document is unavailable (SSR/test)', () => {
    // vitest runs in Node — no canvas, no WebGL
    expect(isWebGL2Available()).toBe(false);
  });

  it('caches the result across calls', () => {
    const a = isWebGL2Available();
    const b = isWebGL2Available();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 4: Run test — verify it fails**

```bash
npm test -- src/infrastructure/gpu/__tests__/gpuDetector.test.ts
```

Expected: FAIL — `gpuDetector` does not exist yet.

- [ ] **Step 5: Implement gpuDetector.ts**

```typescript
// src/infrastructure/gpu/gpuDetector.ts

let cached: boolean | null = null;

/** Detect WebGL 2 availability. Result is cached for the session. */
export function isWebGL2Available(): boolean {
  if (cached !== null) return cached;

  if (typeof document === 'undefined') {
    cached = false;
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    cached = gl !== null;
    // Immediately lose the context to free resources
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }
  } catch {
    cached = false;
  }

  return cached;
}

/** Reset cache — only for testing */
export function resetGpuDetectorCache(): void {
  cached = null;
}
```

- [ ] **Step 6: Run test — verify it passes**

```bash
npm test -- src/infrastructure/gpu/__tests__/gpuDetector.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 7: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/infrastructure/gpu/gpuDetector.ts src/infrastructure/gpu/__tests__/gpuDetector.test.ts
git commit -m "feat(gpu): add TWGL.js dependency and WebGL 2 detector"
```

---

## Task 2: Write GLSL Shader Chunks

**Files:**
- Create: `src/infrastructure/gpu/shaders/fullscreen.vert`
- Create: `src/infrastructure/gpu/shaders/chunks/header.glsl`
- Create: `src/infrastructure/gpu/shaders/chunks/screenToComplex.glsl`
- Create: `src/infrastructure/gpu/shaders/chunks/smoothEscape.glsl`
- Create: `src/infrastructure/gpu/shaders/chunks/paletteLookup.glsl`
- Create: `src/infrastructure/gpu/shaders/chunks/accumulatorNoop.glsl`
- Create: `src/infrastructure/gpu/shaders/iterations/mandelbrot.glsl`
- Create: `src/infrastructure/gpu/shaders/coloring/classic.glsl`
- Create: `src/infrastructure/gpu/shaders/main.glsl`

**DoD:** All 9 GLSL files written, `@mirror` tags match domain code, typecheck/lint pass.

**Important:** GLSL files will be imported as raw strings. Next.js (Turbopack) does not support `?raw` imports natively. Store GLSL as TypeScript string constants in a barrel file for now — we'll evaluate Turbopack raw loader later if needed.

- [ ] **Step 1: Create barrel file with GLSL string constants**

Create `src/infrastructure/gpu/shaders/index.ts` — all GLSL as exported `const` strings. This approach:
- Works with any bundler (no raw loader needed)
- TypeScript type-safe
- Tree-shakes unused chunks in v2+

```typescript
// src/infrastructure/gpu/shaders/index.ts

// ---- Vertex shader (shared) ------------------------------------------------

export const fullscreenVert = /* glsl */ `#version 300 es
// Fullscreen triangle: 3 vertices, oversized to cover viewport
// Industry standard (Three.js) — more efficient than 2-triangle quad
// gl_VertexID arithmetic — zero buffer/attribute setup, only needs empty VAO
void main() {
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// ---- Fragment shader chunks -------------------------------------------------

export const headerChunk = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_resolution;
uniform sampler2D u_palette;

out vec4 fragColor;
`;

/**
 * @mirror domain/coordinates.ts:screenToComplex
 * CPU: re = centerRe + (x/width - 0.5) * scale * aspect
 *      im = centerIm + (y/height - 0.5) * scale
 * where scale = visible height in complex-plane units
 */
export const screenToComplexChunk = /* glsl */ `
vec2 screenToComplex(vec2 fragCoord, vec2 center, float scale, vec2 resolution) {
  float aspect = resolution.x / resolution.y;
  vec2 uv = fragCoord / resolution - 0.5;
  return center + vec2(uv.x * scale * aspect, uv.y * scale);
}
`;

/** @mirror domain/fractals.ts:smoothEscape (logBase=2 specialization) */
export const smoothEscapeChunk = /* glsl */ `
float smoothEscape(int iter, float mod2) {
  return float(iter) + 1.0 - log2(0.5 * log2(mod2));
}
`;

export const paletteLookupChunk = /* glsl */ `
vec3 paletteLookup(float t) {
  return texture(u_palette, vec2(t, 0.5)).rgb;
}
`;

export const accumulatorNoopChunk = /* glsl */ `
struct AccumState { float _unused; };
AccumState initAccumulator() { return AccumState(0.0); }
void updateAccumulator(vec2 z, inout AccumState acc) {}
`;

// ---- Iteration chunks -------------------------------------------------------

/** @mirror domain/fractals.ts:mandelbrotFastPath */
export const mandelbrotIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  iter = 0;
  escaped = false;

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > 4.0) {
      escaped = true;
      iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, acc);
  }

  iter = MAX_ITER;
  smoothVal = 0.0;
}
`;

// ---- Coloring chunks --------------------------------------------------------

/**
 * @mirror domain/coloringModes.ts:mapToColorParam (classic case)
 * COLOR_CYCLE_PERIOD injected as #define from domain constant (DRY)
 */
export const classicColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  return mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
}
`;

// ---- Main template ----------------------------------------------------------

export const mainChunk = /* glsl */ `
void main() {
  vec2 c = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);

  vec2 z;
  int iter;
  bool escaped;
  float smoothVal;
  AccumState acc = initAccumulator();

  iterate(c, z, iter, escaped, smoothVal, acc);

  if (!escaped) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float t = mapToParam(smoothVal, acc, z, iter);
  fragColor = vec4(paletteLookup(t), 1.0);
}
`;
```

- [ ] **Step 2: Run typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: PASS — these are just string constants.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/gpu/shaders/
git commit -m "feat(gpu): add GLSL shader chunks for Mandelbrot + Classic coloring"
```

---

## Task 3: Shader Compiler + Assembly + Cache

**Files:**
- Create: `src/infrastructure/gpu/shaderCompiler.ts`
- Create: `src/infrastructure/gpu/__tests__/shaderCompiler.test.ts`
- Modify: `src/domain/coloringModes.ts:19` (add `export`)

**DoD:** `assembleFragmentSource()` produces valid GLSL, `getOrCompile()` caches by ShaderKey, `COLOR_CYCLE_PERIOD` exported from domain.

- [ ] **Step 1: Export COLOR_CYCLE_PERIOD from domain**

In `src/domain/coloringModes.ts`, line 19, change:
```typescript
const COLOR_CYCLE_PERIOD = 256;
```
to:
```typescript
export const COLOR_CYCLE_PERIOD = 256;
```

Then add to `src/domain/index.ts` barrel export (after line 41):
```typescript
export { COLOR_CYCLE_PERIOD } from './coloringModes';
```

- [ ] **Step 2: Run existing tests — no regression**

```bash
npm test
```

Expected: All 58 tests pass.

- [ ] **Step 3: Write failing test for shaderCompiler**

```typescript
// src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
import { describe, it, expect } from 'vitest';
import { assembleFragmentSource } from '../shaderCompiler';

describe('shaderCompiler', () => {
  describe('assembleFragmentSource', () => {
    it('assembles Mandelbrot + Classic with correct #defines', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('#version 300 es');
      expect(source).toContain('#define MAX_ITER 256');
      expect(source).toContain('#define COLOR_CYCLE_PERIOD 256.0');
      expect(source).toContain('void iterate(');
      expect(source).toContain('float mapToParam(');
      expect(source).toContain('void main()');
    });

    it('injects different MAX_ITER values', () => {
      const s512 = assembleFragmentSource('mandelbrot', 'classic', 512);
      const s1024 = assembleFragmentSource('mandelbrot', 'classic', 1024);
      expect(s512).toContain('#define MAX_ITER 512');
      expect(s1024).toContain('#define MAX_ITER 1024');
      expect(s512).not.toContain('#define MAX_ITER 1024');
    });

    it('includes smoothEscape function', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('float smoothEscape(');
      expect(source).toContain('log2(0.5 * log2(mod2))');
    });

    it('includes accumulatorNoop for classic mode', () => {
      const source = assembleFragmentSource('mandelbrot', 'classic', 256);
      expect(source).toContain('struct AccumState');
      expect(source).toContain('AccumState initAccumulator()');
    });
  });
});
```

- [ ] **Step 4: Run test — verify it fails**

```bash
npm test -- src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
```

Expected: FAIL — `shaderCompiler` does not exist.

- [ ] **Step 5: Implement shaderCompiler.ts**

```typescript
// src/infrastructure/gpu/shaderCompiler.ts

import type { FractalType, ColoringMode } from '../../domain/types';
import { COLOR_CYCLE_PERIOD } from '../../domain/coloringModes';
import {
  fullscreenVert,
  headerChunk,
  screenToComplexChunk,
  smoothEscapeChunk,
  paletteLookupChunk,
  accumulatorNoopChunk,
  mandelbrotIterationChunk,
  classicColoringChunk,
  mainChunk
} from './shaders';

// ---- Shader Key & Cache -----------------------------------------------------

type ShaderKey = `${FractalType}_${ColoringMode}_${number}`;

function makeKey(fractal: FractalType, coloring: ColoringMode, maxIter: number): ShaderKey {
  return `${fractal}_${coloring}_${maxIter}`;
}

// ---- Chunk registries (extensible for v2) -----------------------------------

const iterationChunks: Partial<Record<FractalType, string>> = {
  mandelbrot: mandelbrotIterationChunk,
};

const coloringChunks: Partial<Record<ColoringMode, string>> = {
  classic: classicColoringChunk,
};

/** v1: classic uses noop. v2: stripe/orbitTrap/normalMap use real accumulator. */
function needsAccumulator(_coloring: ColoringMode): boolean {
  return false; // v1: only classic, no accumulation needed
}

// ---- Assembly ---------------------------------------------------------------

export function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): string {
  const iteration = iterationChunks[fractal];
  if (!iteration) throw new Error(`No GPU shader for fractal: ${fractal}`);

  const coloringChunk = coloringChunks[coloring];
  if (!coloringChunk) throw new Error(`No GPU shader for coloring: ${coloring}`);

  const accumulator = needsAccumulator(coloring)
    ? '/* TODO: real accumulator v2 */'
    : accumulatorNoopChunk;

  return [
    headerChunk,
    `#define MAX_ITER ${maxIter}`,
    `#define COLOR_CYCLE_PERIOD ${COLOR_CYCLE_PERIOD}.0`,
    screenToComplexChunk,
    smoothEscapeChunk,
    paletteLookupChunk,
    accumulator,
    iteration,
    coloringChunk,
    mainChunk,
  ].join('\n');
}

// ---- Compilation & Cache ----------------------------------------------------

interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
}

const cache = new Map<ShaderKey, CompiledProgram>();
const pendingCompiles = new Map<ShaderKey, WebGLProgram>();
let parallelExt: KHR_parallel_shader_compile | null = null;

export function initCompiler(gl: WebGL2RenderingContext): void {
  parallelExt = gl.getExtension('KHR_parallel_shader_compile');
}

/** Get cached program or start async compilation. Returns null if compiling. */
export function getOrCompile(
  gl: WebGL2RenderingContext,
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): CompiledProgram | null {
  const key = makeKey(fractal, coloring, maxIter);

  const cached = cache.get(key);
  if (cached) return cached;

  // Already compiling?
  if (pendingCompiles.has(key)) {
    pollCompilation(gl);
    return cache.get(key) ?? null;
  }

  // Start new compilation
  const fragSource = assembleFragmentSource(fractal, coloring, maxIter);
  startCompile(gl, key, fragSource);
  return null;
}

function startCompile(gl: WebGL2RenderingContext, key: ShaderKey, fragSource: string): void {
  const vertShader = compileShader(gl, gl.VERTEX_SHADER, fullscreenVert);
  const fragShader = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);

  const program = gl.createProgram()!;
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);

  // Clean up shader objects (program holds references)
  gl.deleteShader(vertShader);
  gl.deleteShader(fragShader);

  pendingCompiles.set(key, program);

  // If no parallel compile extension, block and finish now
  if (!parallelExt) {
    finishCompile(gl, key, program);
  }
}

/** Poll all pending compilations. Called from render loop. */
export function pollCompilation(gl: WebGL2RenderingContext): void {
  for (const [key, program] of pendingCompiles) {
    const ready = parallelExt
      ? gl.getProgramParameter(program, parallelExt.COMPLETION_STATUS_KHR) as boolean
      : true;

    if (ready) {
      finishCompile(gl, key, program);
    }
  }
}

function finishCompile(gl: WebGL2RenderingContext, key: ShaderKey, program: WebGLProgram): void {
  pendingCompiles.delete(key);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    console.error(`[GPU] Shader link failed [${key}]:`, log);
    return;
  }

  // Cache uniform locations
  const uniformLocations = new Map<string, WebGLUniformLocation>();
  const uniformNames = ['u_center', 'u_scale', 'u_resolution', 'u_palette'];
  for (const name of uniformNames) {
    const loc = gl.getUniformLocation(program, name);
    if (loc) uniformLocations.set(name, loc);
  }

  cache.set(key, { program, uniformLocations });
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  // Don't check compile status here — check at link time (MDN best practice)
  return shader;
}

/** Destroy all cached programs. Called on context loss or unmount. */
export function destroyAllPrograms(gl: WebGL2RenderingContext): void {
  for (const [, { program }] of cache) {
    gl.deleteProgram(program);
  }
  cache.clear();
  for (const [, program] of pendingCompiles) {
    gl.deleteProgram(program);
  }
  pendingCompiles.clear();
}

/** Check if any program is ready (for isReady() check). */
export function hasCompiledProgram(): boolean {
  return cache.size > 0;
}
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npm test -- src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/domain/coloringModes.ts src/domain/index.ts src/infrastructure/gpu/shaderCompiler.ts src/infrastructure/gpu/__tests__/shaderCompiler.test.ts
git commit -m "feat(gpu): add shader compiler with assembly, caching, and async compile"
```

---

## **CODE REVIEW CHECKPOINT 1** (after Task 3)

Review: Tasks 1-3. Focus: GLSL correctness (especially `screenToComplex` formula), `@mirror` accuracy vs `domain/coordinates.ts` and `domain/fractals.ts`, DRY, TWGL types.

---

## Task 4: Palette Texture

**Files:**
- Create: `src/infrastructure/gpu/paletteTexture.ts`
- Create: `src/infrastructure/gpu/__tests__/paletteTexture.test.ts`

**DoD:** `createPaletteData()` (pure function) produces correct 256×4 sRGB array from any palette. TWGL texture creation wrapped but untestable in Node (tested via integration later).

- [ ] **Step 1: Write failing test for paletteTexture (pure data part)**

```typescript
// src/infrastructure/gpu/__tests__/paletteTexture.test.ts
import { describe, it, expect } from 'vitest';
import { createPaletteData } from '../paletteTexture';

describe('paletteTexture', () => {
  it('produces a 256*4 = 1024 byte Uint8Array', () => {
    const data = createPaletteData('classic');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(256 * 4);
  });

  it('all alpha values are 255', () => {
    const data = createPaletteData('classic');
    for (let i = 0; i < 256; i++) {
      expect(data[i * 4 + 3]).toBe(255);
    }
  });

  it('RGB values are in [0, 255] range', () => {
    const data = createPaletteData('fire');
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });

  it('different palettes produce different data', () => {
    const classic = createPaletteData('classic');
    const fire = createPaletteData('fire');
    expect(classic).not.toEqual(fire);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- src/infrastructure/gpu/__tests__/paletteTexture.test.ts
```

- [ ] **Step 3: Implement paletteTexture.ts**

```typescript
// src/infrastructure/gpu/paletteTexture.ts

import type { PaletteName } from '../../domain/types';
import { resolvePalette } from '../../domain/palettes';
import { oklchToRgb } from '../../domain/color';
import * as twgl from 'twgl.js';

/**
 * Generate 256×4 sRGB pixel data from a named OKLCH palette.
 * Pure function — testable without WebGL context.
 */
export function createPaletteData(paletteName: PaletteName): Uint8Array {
  const palette = resolvePalette(paletteName);
  const data = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const oklch = palette(t);
    const [r, g, b] = oklchToRgb(oklch.L, oklch.C, oklch.H);
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }

  return data;
}

/**
 * Create a 256×1 sRGB texture from a named palette.
 * Requires WebGL 2 context.
 */
export function createPaletteTexture(
  gl: WebGL2RenderingContext,
  paletteName: PaletteName
): WebGLTexture {
  const data = createPaletteData(paletteName);

  return twgl.createTexture(gl, {
    src: data,
    width: 256,
    height: 1,
    min: gl.LINEAR,
    mag: gl.LINEAR,
    wrap: gl.CLAMP_TO_EDGE,
    internalFormat: gl.RGBA8,
  });
}

/**
 * Update an existing texture with new palette data (avoids re-allocation).
 */
export function updatePaletteTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  paletteName: PaletteName
): void {
  const data = createPaletteData(paletteName);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- src/infrastructure/gpu/__tests__/paletteTexture.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/gpu/paletteTexture.ts src/infrastructure/gpu/__tests__/paletteTexture.test.ts
git commit -m "feat(gpu): add palette OKLCH-to-texture converter"
```

---

## Task 5: WebGL Renderer (Orchestrator)

**Files:**
- Create: `src/infrastructure/gpu/webglRenderer.ts`

**DoD:** `createWebGLRenderer()` initializes WebGL 2 context, creates VAO, triggers default shader compilation. `render()` sets uniforms and draws. `destroy()` cleans up. Context loss handled.

**Note:** WebGL code cannot run in vitest (no GPU in Node). Tasks 5-9 are tested via manual browser testing (Tasks 8, 10). This is a deliberate design decision — GPU integration tests require a browser context.

**Design debt note:** `shaderCompiler.ts` uses module-level mutable state (cache, pendingCompiles). This works for v1 (single canvas) but should be refactored to a `createShaderCache(gl)` factory if we ever need multiple renderers.

- [ ] **Step 1: Implement webglRenderer.ts**

```typescript
// src/infrastructure/gpu/webglRenderer.ts

import type { Viewport, FractalType, PaletteName, FractalParams, ColoringMode } from '../../domain/types';
import * as twgl from 'twgl.js';
import {
  initCompiler,
  getOrCompile,
  pollCompilation,
  destroyAllPrograms,
  hasCompiledProgram
} from './shaderCompiler';
import { createPaletteTexture, updatePaletteTexture } from './paletteTexture';

export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
}

export interface WebGLRenderer {
  render(options: GPURenderOptions): boolean;
  updatePalette(palette: PaletteName): void;
  destroy(): void;
  isReady(): boolean;
}

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  initialPalette: PaletteName = 'classic'
): WebGLRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;

  // Empty VAO — required by WebGL 2 for gl_VertexID draws
  const emptyVAO = gl.createVertexArray();

  // Init shader compiler (detects KHR_parallel_shader_compile)
  initCompiler(gl);

  // Create palette texture
  let paletteTexture = createPaletteTexture(gl, initialPalette);

  // Eagerly start compiling default program (Mandelbrot + Classic + 256)
  getOrCompile(gl, 'mandelbrot', 'classic', 256);

  let contextLost = false;
  let currentPalette: PaletteName = initialPalette;

  // Context loss handlers
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
  };
  const onContextRestored = () => {
    contextLost = false;
    // Re-init everything with the CURRENT palette (not initial)
    initCompiler(gl);
    paletteTexture = createPaletteTexture(gl, currentPalette);
    getOrCompile(gl, 'mandelbrot', 'classic', 256);
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    isReady(): boolean {
      if (contextLost) return false;
      pollCompilation(gl);
      return hasCompiledProgram();
    },

    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;

      pollCompilation(gl);

      const compiled = getOrCompile(
        gl,
        options.fractalType,
        options.coloringMode,
        options.maxIterations
      );
      if (!compiled) return false; // Still compiling — caller falls back to CPU

      const { program, uniformLocations } = compiled;

      gl.useProgram(program);
      gl.bindVertexArray(emptyVAO);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // Set uniforms
      const uCenter = uniformLocations.get('u_center');
      const uScale = uniformLocations.get('u_scale');
      const uResolution = uniformLocations.get('u_resolution');
      const uPalette = uniformLocations.get('u_palette');

      if (uCenter) gl.uniform2f(uCenter, options.viewport.centerRe, options.viewport.centerIm);
      if (uScale) gl.uniform1f(uScale, options.viewport.scale);
      if (uResolution) gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);

      // Bind palette texture
      if (uPalette) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
        gl.uniform1i(uPalette, 0);
      }

      // Draw fullscreen triangle
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      return true;
    },

    updatePalette(palette: PaletteName): void {
      currentPalette = palette;
      if (contextLost) return;
      updatePaletteTexture(gl, paletteTexture, palette);
    },

    destroy(): void {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyAllPrograms(gl);
      gl.deleteTexture(paletteTexture);
      gl.deleteVertexArray(emptyVAO);
    }
  };
}
```

- [ ] **Step 2: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/gpu/webglRenderer.ts
git commit -m "feat(gpu): add WebGL renderer orchestrator with context loss handling"
```

---

## Task 6: Barrel Export + GPU Index

**Files:**
- Create: `src/infrastructure/gpu/index.ts`

**DoD:** Clean public API for the `gpu/` module.

- [ ] **Step 1: Create GPU barrel**

```typescript
// src/infrastructure/gpu/index.ts
export { isWebGL2Available } from './gpuDetector';
export { createWebGLRenderer } from './webglRenderer';
export type { WebGLRenderer, GPURenderOptions } from './webglRenderer';
```

- [ ] **Step 2: Quality gates + commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/infrastructure/gpu/index.ts
git commit -m "refactor(gpu): add barrel export for GPU module"
```

---

## **CODE REVIEW CHECKPOINT 2** (after Task 6)

Review: Tasks 4-6. Focus: Full GPU pipeline, context handling, TWGL usage, lifecycle.

---

## Task 7: Update Facade (renderer.ts)

**Files:**
- Modify: `src/infrastructure/renderer.ts`

**DoD:** `renderFractal()` accepts optional `WebGLRenderer`, routes GPU → Workers → Fallback. CPU path unchanged. Typecheck passes.

- [ ] **Step 1: Modify renderer.ts**

Add GPU path. Key changes:
- Import `WebGLRenderer` type
- Add `gpuRenderer` optional parameter
- Try GPU first, fall back to existing paths

```typescript
// At top of renderer.ts, add import:
import type { WebGLRenderer } from './gpu';

// Change renderFractal signature (line 30-34):
export function renderFractal(
  canvas: HTMLCanvasElement,
  pool: WorkerPool | null,
  gpuRenderer: WebGLRenderer | null,
  options: RenderOptions
): () => void {
  // Try GPU path first
  if (gpuRenderer?.isReady()) {
    const rendered = gpuRenderer.render({
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      coloringMode: options.coloringMode ?? 'classic',
      interiorColoring: options.interiorColoring ?? false,
      fractalParams: options.params
    });
    if (rendered) {
      // For non-progressive GPU, render is synchronous — call onComplete immediately.
      // For progressive GPU, webglRenderer handles onComplete via rAF callback.
      // The renderer exposes cancelPending() to cancel the rAF if a new render comes in.
      if (!gpuRenderer.isPendingFullRes?.()) {
        options.onComplete?.(0);
      }
      return () => { gpuRenderer.cancelPending?.(); };
    }
    // GPU not ready (compiling) — fall through to CPU
  }

  if (pool) {
    return renderWithPool({
      canvas, pool,
      viewport: options.viewport,
      fractalType: options.fractalType,
      maxIterations: options.maxIterations,
      palette: options.palette,
      params: options.params,
      coloringMode: options.coloringMode,
      interiorColoring: options.interiorColoring,
      onProgress: options.onProgress,
      onComplete: options.onComplete
    });
  }
  return renderFallback(canvas, options);
}
```

- [ ] **Step 2: Update ALL call sites to pass `null` for gpuRenderer**

In `src/infrastructure/useViewportTransition.ts`, function `doRenderFull` (line 54):

Change:
```typescript
cancelRenderRef.current = renderFractal(canvas, poolRef.current, {
```
To:
```typescript
cancelRenderRef.current = renderFractal(canvas, poolRef.current, null, {
```

This keeps the CPU path working unchanged. Task 8 will replace `null` with the actual GPU ref.

- [ ] **Step 3: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All must pass — the `null` placeholder ensures typecheck succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/renderer.ts src/infrastructure/useViewportTransition.ts
git commit -m "feat(gpu): add GPU path to renderer facade"
```

---

## Task 8: Integrate into useRenderer + useViewportTransition

**Files:**
- Modify: `src/infrastructure/useRenderer.ts`
- Modify: `src/infrastructure/useViewportTransition.ts`

**DoD:** GPU renderer created on mount if WebGL 2 available. Facade called with GPU renderer. Pixel-shift disabled when GPU active. CSS transform feedback unchanged. All quality gates pass.

- [ ] **Step 1: Update useRenderer.ts**

Add GPU ref, create on mount, pass to `useViewportTransition`:

```typescript
// Add imports:
import { isWebGL2Available, createWebGLRenderer } from './gpu';
import type { WebGLRenderer } from './gpu';

// Add ref (after poolRef):
const gpuRef = useRef<WebGLRenderer | null>(null);

// In pool lifecycle useEffect, add GPU init:
useEffect(() => {
  poolRef.current = createWorkerPool();
  const canvas = canvasRef.current;
  if (canvas && isWebGL2Available()) {
    gpuRef.current = createWebGLRenderer(canvas, palette);
  }
  return () => {
    gpuRef.current?.destroy();
    gpuRef.current = null;
    poolRef.current?.destroy();
    poolRef.current = null;
  };
}, []);

// Pass gpuRef to useViewportTransition:
const { forceFullRender } = useViewportTransition({
  canvasRef, poolRef, gpuRef,  // <-- add gpuRef
  fractalType, viewport, maxIterations, palette, params,
  coloringMode, interiorColoring,
  cancelRenderRef, onRenderStartRef, onRenderCompleteRef
});
```

Also update palette: when palette changes, call `gpuRef.current?.updatePalette(palette)`:

```typescript
// Add effect for palette updates:
useEffect(() => {
  gpuRef.current?.updatePalette(palette);
}, [palette]);
```

- [ ] **Step 2: Update useViewportTransition.ts**

Add `gpuRef` to `TransitionDeps`:

```typescript
interface TransitionDeps {
  // ... existing fields ...
  gpuRef: React.RefObject<WebGLRenderer | null>;
}
```

In `doRenderFull()` (line 54), pass GPU renderer to facade:

```typescript
cancelRenderRef.current = renderFractal(canvas, poolRef.current, gpuRef.current, { ... });
```

In the debounce callback (line 196-203), when GPU is active skip pixel-shift path:

```typescript
debounceRef.current = setTimeout(() => {
  debounceRef.current = null;
  const d = depsRef.current;
  const gpuActive = d.gpuRef.current?.isReady() ?? false;

  if (!gpuActive && prevViewportRef.current && isPanOnly(prevViewportRef.current, d.viewport)) {
    doRenderPanStrips(d, prevViewportRef);
  } else {
    doRenderFull(d, prevViewportRef);
  }
}, DEBOUNCE_MS);
```

- [ ] **Step 3: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 4: Manual browser test**

```bash
npm run dev
```

Open http://localhost:3000. Verify:
- Mandelbrot renders (GPU if WebGL 2 available, CPU fallback otherwise)
- Pan/zoom works
- Palette change works
- Other fractal types fall back to CPU (expected — only Mandelbrot has GPU shader)

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/useRenderer.ts src/infrastructure/useViewportTransition.ts
git commit -m "feat(gpu): integrate GPU renderer into hooks and viewport transition"
```

---

## **CODE REVIEW CHECKPOINT 3** (after Task 8)

Review: Tasks 7-8. Focus: No CPU regression, facade API, pixel-shift guard, lifecycle.

---

## Task 9: Progressive GPU Rendering (FBO + Timer Query)

**Files:**
- Create: `src/infrastructure/gpu/gpuFramebuffer.ts`
- Modify: `src/infrastructure/gpu/webglRenderer.ts`

**DoD:** Quarter-res FBO rendering when GPU frame >16ms. Timer query with heuristic fallback. Progressive cancel handles rAF.

- [ ] **Step 0: Add EXT_disjoint_timer_query_webgl2 type declaration**

TypeScript's `lib.dom.d.ts` does not include this WebGL extension type. Add it:

```typescript
// src/infrastructure/gpu/webgl-ext.d.ts
interface EXT_disjoint_timer_query_webgl2 {
  readonly QUERY_COUNTER_BITS_EXT: number;
  readonly TIME_ELAPSED_EXT: number;
  readonly TIMESTAMP_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
```

Extend `WebGL2RenderingContext.getExtension` overload in the same file:
```typescript
interface WebGL2RenderingContext {
  getExtension(name: 'EXT_disjoint_timer_query_webgl2'): EXT_disjoint_timer_query_webgl2 | null;
}
```

- [ ] **Step 1: Implement gpuFramebuffer.ts**

```typescript
// src/infrastructure/gpu/gpuFramebuffer.ts

/** Quarter-resolution FBO for progressive GPU rendering preview. */
export interface GPUFramebuffer {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export function createQuarterFBO(gl: WebGL2RenderingContext): GPUFramebuffer {
  const width = Math.max(1, Math.floor(gl.drawingBufferWidth / 4));
  const height = Math.max(1, Math.floor(gl.drawingBufferHeight / 4));

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  // Restore default
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

/** Resize FBO if canvas dimensions changed. */
export function resizeQuarterFBO(
  gl: WebGL2RenderingContext,
  existing: GPUFramebuffer
): GPUFramebuffer {
  const newWidth = Math.max(1, Math.floor(gl.drawingBufferWidth / 4));
  const newHeight = Math.max(1, Math.floor(gl.drawingBufferHeight / 4));

  if (newWidth === existing.width && newHeight === existing.height) return existing;

  destroyFBO(gl, existing);
  return createQuarterFBO(gl);
}

/** Blit FBO texture to canvas (upscale). */
export function blitFBOToCanvas(gl: WebGL2RenderingContext, fbo: GPUFramebuffer): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(
    0, 0, fbo.width, fbo.height,
    0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
    gl.COLOR_BUFFER_BIT, gl.LINEAR
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
}

export function destroyFBO(gl: WebGL2RenderingContext, fbo: GPUFramebuffer): void {
  gl.deleteFramebuffer(fbo.fbo);
  gl.deleteTexture(fbo.texture);
}
```

- [ ] **Step 2: Add progressive logic to webglRenderer.ts**

In `render()`, add progressive detection + FBO path:

```typescript
// Constants
const FRAME_BUDGET_MS = 16;
const PROGRESSIVE_THRESHOLD = 1920 * 1080 * 512;

// State
let lastGpuTimeMs = 0;
let quarterFBO: GPUFramebuffer | null = null;
let pendingFullResRAF: number | null = null;
let timerQueryExt: EXT_disjoint_timer_query_webgl2 | null = null;

// In init:
timerQueryExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

// In render():
const workload = gl.drawingBufferWidth * gl.drawingBufferHeight * options.maxIterations;
const needsProgressive = timerQueryExt
  ? lastGpuTimeMs > FRAME_BUDGET_MS
  : workload > PROGRESSIVE_THRESHOLD;

if (needsProgressive) {
  // Cancel pending full-res from previous progressive render
  if (pendingFullResRAF !== null) {
    cancelAnimationFrame(pendingFullResRAF);
    pendingFullResRAF = null;
  }

  // Ensure FBO exists and is sized correctly
  quarterFBO = quarterFBO
    ? resizeQuarterFBO(gl, quarterFBO)
    : createQuarterFBO(gl);

  // Pass 1: render to quarter-res FBO
  gl.bindFramebuffer(gl.FRAMEBUFFER, quarterFBO.fbo);
  gl.viewport(0, 0, quarterFBO.width, quarterFBO.height);
  /* ... set uniforms, draw ... */
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Blit upscaled preview to canvas
  blitFBOToCanvas(gl, quarterFBO);

  // Pass 2: full-res on next frame
  pendingFullResRAF = requestAnimationFrame(() => {
    pendingFullResRAF = null;
    /* ... render full-res to canvas ... */
  });
} else {
  /* ... direct full-res render ... */
}
```

- [ ] **Step 3: Update cancel in facade**

The cancel function returned by `renderFractal` for GPU progressive path must cancel the pending rAF. Expose a `cancelPending()` method on `WebGLRenderer`.

- [ ] **Step 4: Run all quality gates**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/gpu/gpuFramebuffer.ts src/infrastructure/gpu/webglRenderer.ts
git commit -m "feat(gpu): add progressive GPU rendering with quarter-res FBO"
```

---

## **CODE REVIEW CHECKPOINT 4** (after Task 9)

Review: Task 9. Focus: FBO lifecycle, timer query, progressive cancel, perf guard correctness.

---

## Task 10: Performance Benchmark

**Files:** None created — validation only.

**DoD:** Measured GPU render time at 1080p @256 iter. Documented in `docs/performance-history.md`.

- [ ] **Step 1: Manual perf measurement in browser**

```bash
npm run dev
```

Open DevTools → Performance tab. Record a render cycle. Measure:
- GPU frame time (should be <5ms @1080p @256iter)
- Compare with CPU baseline (228ms Classic)

- [ ] **Step 2: Document results in performance-history.md**

Add a new section:

```markdown
### + GPU WebGL 2 (TWGL)

WebGL 2 fragment shader via TWGL. Mandelbrot + Classic coloring. Fullscreen triangle, palette texture lookup.

| Metric | Value | vs CPU Workers |
|---|---|---|
| GPU render @256 | Xms | Xx |
| GPU render @1024 | Xms | Xx |
```

- [ ] **Step 3: Commit**

```bash
git add docs/performance-history.md
git commit -m "docs: add GPU rendering benchmark results"
```

---

## Task 11: Final Review + Cleanup

**Files:** Various — fix any issues found.

**DoD:** All quality gates pass. GPU barrel export clean. CLAUDE.md updated. Visual parity with CPU.

- [ ] **Step 1: Run full quality gate suite**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- [ ] **Step 2: Visual parity check**

Open browser. Compare:
- Mandelbrot Classic on GPU vs CPU fallback (disable GPU in code temporarily)
- Colors should match (same palette, same smooth coloring formula)
- Interior should be black

- [ ] **Step 3: Update CLAUDE.md**

Move "GPU WebGL 2 + TWGL" from "Next" to "Done" in the Performance Roadmap:

```markdown
- GPU rendering v4 (WebGL 2 + TWGL): Mandelbrot + Classic coloring. TWGL ~15KB.
  Fragment shader, palette texture, async compile (KHR_parallel_shader_compile).
  Progressive FBO when >16ms. Facade GPU→Workers→Fallback.
  Measured: Xms @256iter (Xx vs CPU baseline).
```

- [ ] **Step 4: Update GPU barrel in infrastructure index**

Ensure `src/infrastructure/gpu/index.ts` exports are correct and no dead exports remain.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/gpu/ src/infrastructure/renderer.ts src/infrastructure/useRenderer.ts src/infrastructure/useViewportTransition.ts src/domain/coloringModes.ts src/domain/index.ts CLAUDE.md docs/performance-history.md
git commit -m "feat(gpu): complete GPU WebGL 2 rendering v1 — Mandelbrot + Classic"
```

---

## **CODE REVIEW CHECKPOINT 5 — FINAL** (after Task 11)

Review: Full plan compliance.

Checklist:
- [ ] All quality gates pass (typecheck, lint, test, build)
- [ ] DoD met for every task
- [ ] SRP: each file has 1 responsibility
- [ ] DRY: domain data not duplicated, `@mirror` tags present
- [ ] No `any`, no `eslint-disable`, no `console.log` (except `console.error` for shader errors)
- [ ] GPU fallback works (disable WebGL → CPU renders correctly)
- [ ] Context loss handled (simulate via DevTools WebGL extension)
- [ ] Progressive rendering works (test with maxIter=4096)
- [ ] Visual parity: GPU Mandelbrot matches CPU Mandelbrot
- [ ] CLAUDE.md and performance-history.md updated
- [ ] All commits use conventional format

---

## Summary

| Task | Description | New Files | Modified Files |
|---|---|---|---|
| 1 | TWGL + GPU detector | 2 | 1 |
| 2 | GLSL shader chunks | 1 (barrel) | 0 |
| 3 | Shader compiler + cache | 2 | 2 |
| 4 | Palette texture | 2 | 0 |
| 5 | WebGL renderer | 1 | 0 |
| 6 | Barrel export | 1 | 0 |
| 7 | Facade update | 0 | 1 |
| 8 | Hook integration | 0 | 2 |
| 9 | Progressive GPU | 1 | 1 |
| 10 | Benchmark | 0 | 1 |
| 11 | Final cleanup | 0 | 2+ |
| **Total** | | **10** | **10** |
