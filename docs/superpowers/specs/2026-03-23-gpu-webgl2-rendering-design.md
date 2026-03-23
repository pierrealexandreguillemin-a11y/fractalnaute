# GPU WebGL 2 Rendering — Design Spec

**Date**: 2026-03-23
**Scope v1**: Mandelbrot + Classic coloring, pipeline WebGL 2 complet
**Stack**: TWGL.js (~15KB gzip, WebGL 2, zero dep)
**Expected gain**: 10-60x (228ms CPU → <5ms GPU @1080p)

---

## 1. File Structure

```
src/infrastructure/
  gpu/
    webglRenderer.ts       # Thin orchestrator: init, render, destroy
    shaderCompiler.ts       # Compile/link shaders, cache Map<ShaderKey, WebGLProgram>
    paletteTexture.ts       # OKLCH palette → 256x1 sRGB texture
    gpuDetector.ts          # isWebGL2Available(), cached result
    gpuFramebuffer.ts       # FBO quarter-res for progressive GPU, blit
    shaders/
      fullscreen.vert       # Fullscreen triangle (3 vertices, gl_VertexID trick), shared
      main.glsl             # Template: calls iterate() + mapToParam()
      chunks/
        header.glsl            # #version 300 es, precision, common uniforms
        screenToComplex.glsl   # Viewport → complex plane transform
        smoothEscape.glsl      # Smooth iteration count formula
        paletteLookup.glsl     # texture(u_palette, vec2(t, 0.5))
        accumulator.glsl       # Stripe avg + orbit trap (for future coloring modes)
        accumulatorNoop.glsl   # Empty accumulator (zero overhead for Classic)
      iterations/
        mandelbrot.glsl        # iterate(): z = z^2 + c
        julia.glsl             # iterate(): z = z^2 + c_julia        (v2)
        burningship.glsl       # iterate(): z = (|Re|,|Im|)^2 + c   (v2)
        tricorn.glsl           # iterate(): z = conj(z)^2 + c        (v2)
        multibrot.glsl         # iterate(): z = z^n + c               (v2)
      coloring/
        classic.glsl           # mapToParam(): smoothVal → t
        stripe.glsl            # mapToParam(): smoothVal + stripe → t (v2)
        decomposition.glsl     # mapToParam(): arg(z) → t             (v2)
        orbitTrap.glsl         # mapToParam(): log(trapDist) → t      (v2)
        normalMap.glsl         # mapToParam(): DE + lighting → t      (v2)
  renderer.ts               # Facade: GPU → Workers → Fallback (modified)
  useRenderer.ts             # Creates WebGLRenderer + WorkerPool on mount
```

Files marked `(v2)` are placeholders — only `mandelbrot.glsl` and `classic.glsl` are implemented in v1.

CPU files unchanged: `renderBand.ts`, `workerPool.ts`, `renderCoordinator.ts`, `fractal.worker.ts`.

---

## 2. SRP — Single Responsibility Per File

| File | Single Responsibility | Does NOT |
|---|---|---|
| `gpuDetector.ts` | Detect WebGL 2, cache result | Init GL context |
| `shaderCompiler.ts` | Compile/link shaders, report errors, cache programs | Know fractals, manage uniforms |
| `paletteTexture.ts` | Convert `ColorPalette` → 256x1 sRGB texture | Interpolate OKLCH (domain does that) |
| `gpuFramebuffer.ts` | Create/manage quarter-res FBO, blit to canvas | Decide when to use progressive |
| `webglRenderer.ts` | Orchestrate render cycle (uniforms, draw, progressive) | Compile shaders, generate textures |
| `renderer.ts` | Route GPU → Workers → Fallback | Know implementation details |
| `fullscreen.vert` | Position fullscreen triangle | Any coloring or iteration |
| `mandelbrot.frag` (assembled) | Iterate Mandelbrot + color + palette lookup | Manage GL context |

**DRY principle**: domain data (palette OKLCH stops, Viewport, FractalParams, FractalResult) defined once in `src/domain/`. GPU path consumes via explicit transforms (`paletteTexture.ts` reads `palettes.ts`, uniforms map `Viewport`).

---

## 3. Facade — renderer.ts

### Current

```typescript
renderFractal(canvas, pool, options) → cancel()
  if (pool) → renderWithPool(...)
  else      → renderFallback(...)
```

### After

```typescript
renderFractal(canvas, pool, gpuRenderer?, options) → cancel()
  if (gpuRenderer?.isReady()) → gpuRenderer.render(options)
  else if (pool)              → renderWithPool(...)
  else                        → renderFallback(...)
```

`gpuRenderer` is optional (`WebGLRenderer | null`). All 3 paths return `{ cancel: () => void }`. Consumer is unaware of which path runs.

GPU path cancel: no-op for single-pass; cancels pending `requestAnimationFrame` for progressive two-pass.
Workers path cancel: Atomics.store(cancelFlag, 0, 1) — unchanged.
Fallback path cancel: set cancelled flag — unchanged.

### Canvas Context Constraint

A canvas can only have ONE context type (`webgl2` OR `2d`, not both). When GPU is active, the pixel-shift optimization in `useViewportTransition.ts` (which uses `getContext('2d')` + `putImageData`) is incompatible.

**Decision**: when GPU renderer is active, disable pixel-shift strip rendering for pans. GPU renders the full viewport in <5ms, making strip optimization unnecessary. The CSS transform instant feedback (<2ms) remains active for both paths.

`useViewportTransition.ts` receives a `gpuActive: boolean` flag:
- `gpuActive = true` → all viewport changes trigger a full GPU re-render (no strip reuse)
- `gpuActive = false` → existing CPU pixel-shift + strip render (unchanged)

---

## 4. Composable Shader Architecture

### Problem

5 fractals x 5 coloring modes = 25 combinations. Duplicating = anti-DRY. Runtime branching (`if/else` in hot loop) = GPU thread divergence = perf killer.

### Solution

Compile-time composition of GLSL chunks via string concatenation. Zero runtime branching. Each formula exists once.

### Function Contracts (GLSL interfaces)

```glsl
// iterations/*.glsl — each fractal implements:
void iterate(in vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc);

// coloring/*.glsl — each mode implements:
float mapToParam(in float smoothVal, in AccumState acc, in vec2 z, in int iter);

// accumulator.glsl — called by iterate() each iteration:
void updateAccumulator(in vec2 z, inout AccumState acc);
```

### Assembly (shaderCompiler.ts)

```typescript
import { COLOR_CYCLE_PERIOD } from '@/domain/coloringModes';

type ShaderKey = `${FractalType}_${ColoringMode}_${number}`;

function assembleFragmentSource(
  fractal: FractalType,
  coloring: ColoringMode,
  maxIter: number
): string {
  return [
    chunks.header,
    `#define MAX_ITER ${maxIter}`,
    `#define COLOR_CYCLE_PERIOD ${COLOR_CYCLE_PERIOD}.0`,  // DRY: sourced from domain
    chunks.screenToComplex,
    chunks.smoothEscape,
    chunks.paletteLookup,
    needsAccumulator(coloring) ? chunks.accumulator : chunks.accumulatorNoop,
    iterations[fractal],
    coloringChunks[coloring],
    chunks.main,
  ].join('\n');
}
```

### Template main.glsl

```glsl
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
```

### smoothEscape chunk

```glsl
// @mirror domain/fractals.ts:smoothEscape (logBase=2 specialization)
// CPU formula: iter + 1 - log(log(zRe2 + zIm2) / 2 / ln2) / ln2
// Simplified for logBase=2: iter + 1 - log2(0.5 * log2(mod2))
// where mod2 = zRe2 + zIm2 = |z|^2
// Uses native log2() for clarity and GPU efficiency
float smoothEscape(in int iter, in float mod2) {
  return float(iter) + 1.0 - log2(0.5 * log2(mod2));
}
```

### accumulatorNoop chunk

```glsl
// Zero-cost accumulator for Classic coloring — no per-iteration overhead
struct AccumState { float _unused; };
AccumState initAccumulator() { return AccumState(0.0); }
void updateAccumulator(in vec2 z, inout AccumState acc) { /* noop */ }
```

### Mandelbrot iteration chunk (v1)

```glsl
// @mirror domain/fractals.ts:mandelbrotFastPath
void iterate(in vec2 c, out vec2 z, out int iter, out bool escaped,
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
```

### Classic coloring chunk (v1)

```glsl
// @mirror domain/coloringModes.ts:mapClassic
// COLOR_CYCLE_PERIOD injected as #define from domain constant (DRY)
float mapToParam(in float smoothVal, in AccumState acc, in vec2 z, in int iter) {
  return mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
}
```

---

## 5. WebGLRenderer

```typescript
interface WebGLRenderer {
  render(options: GPURenderOptions): void;
  updatePalette(palette: PaletteName): void;
  destroy(): void;
  isReady(): boolean;
}

interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
}
```

### Lifecycle

1. **`createWebGLRenderer(canvas)`** — get `webgl2` context, create empty VAO (required by WebGL 2), start async compile of Mandelbrot+Classic+256 via `KHR_parallel_shader_compile`
2. **`render(options)`** — check cache for `{fractalType, coloringMode, maxIter}` program. If cached → set uniforms + draw. If not → start async compile, return `isReady() = false` (caller falls back to CPU)
3. **`updatePalette(name)`** — regenerate 256x1 texture via `paletteTexture.ts`
4. **`destroy()`** — delete all programs, textures, buffers

### Delegation

- Shader compilation → `shaderCompiler.ts`
- Palette texture → `paletteTexture.ts`
- FBO management → `gpuFramebuffer.ts`
- GPU detection → `gpuDetector.ts`

---

## 6. useRenderer.ts Integration

### Current

```typescript
const pool = useRef<WorkerPool | null>(null);
useEffect(() => {
  pool.current = createWorkerPool();
  return () => pool.current?.destroy();
}, []);
```

### After — same pattern

```typescript
const pool = useRef<WorkerPool | null>(null);
const gpu = useRef<WebGLRenderer | null>(null);

useEffect(() => {
  pool.current = createWorkerPool();
  if (isWebGL2Available()) {
    gpu.current = createWebGLRenderer(canvasRef.current!);
  }
  return () => {
    gpu.current?.destroy();
    pool.current?.destroy();
  };
}, []);
```

The facade `renderFractal(canvas, pool.current, gpu.current, options)` receives both.

---

## 7. Graceful Fallback Strategy

```
gpuRenderer.isReady()?
  ├─ yes → gpuRenderer.render(options)
  │
  └─ no (compiling OR WebGL 2 absent OR context lost)
      ├─ pool? → renderWithPool(...)
      └─ no   → renderFallback(...)
```

### Context Loss Handling

```typescript
// In createWebGLRenderer():
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();  // Required per Khronos spec
  contextLost = true;  // isReady() returns false → CPU fallback
});

canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  reInitAllResources();  // Re-create programs, textures, buffers
});
```

---

## 8. KHR_parallel_shader_compile

Non-blocking shader compilation. Critical on Windows/ANGLE (50-300ms compile time).

```typescript
// shaderCompiler.ts
const ext = gl.getExtension('KHR_parallel_shader_compile');

function startAsyncCompile(gl, key, vertSrc, fragSrc): void {
  const program = gl.createProgram();
  // ... attach shaders, link ...
  pendingCompiles.set(key, program);
}

function pollCompilation(gl): void {
  for (const [key, program] of pendingCompiles) {
    const ready = ext
      ? gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR)
      : true;  // Fallback: blocking (no extension)

    if (ready) {
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        cache.set(key, program);
      } else {
        console.error(`Shader link failed [${key}]:`, gl.getProgramInfoLog(program));
      }
      pendingCompiles.delete(key);
    }
  }
}
```

Poll is called from `render()` — zero extra timers, piggybacks on the render loop.

---

## 9. #define MAX_ITER — Compile-time Loop Bound

`MAX_ITER` is injected as `#define` at shader assembly time, not as a uniform.

**Why**: GPU compilers constant-fold `#define` values, producing tighter loop code. Uniform-based loop bounds prevent this optimization.

**Cache key**: `${fractalType}_${coloringMode}_${maxIterations}` — e.g., `mandelbrot_classic_256`.

**Recompilation frequency**: only when user changes maxIterations (rare — discrete steps: 256, 512, 1024, 2048). Cached permutations persist for the session.

**@tradeoff**: compile-time `#define` prevents constant iteration-count changes but enables GPU compiler optimization. Validated as industry standard (Doom, Three.js, Fractal Lab).

---

## 10. Progressive GPU Rendering (Perf Guard)

At high iteration + deep zoom, even GPU can exceed 16ms. On integrated GPUs (Intel UHD) with maxIter=2048, this is realistic.

### Mechanism: Resolution Scaling (2 passes)

```
Pass 1 (preview): render at canvas/4 (480x270 @1080p) → upscale blit → immediate display
Pass 2 (full-res): render at native resolution (1920x1080) → final display
```

Mirrors the CPU pattern (stride 4 → stride 1) but with FBO resolution scaling.

### Detection

Primary: `EXT_disjoint_timer_query_webgl2` (~75% support) measures actual GPU frame time.

Fallback heuristic when timer query unavailable:

```typescript
const workload = width * height * maxIterations;
const PROGRESSIVE_THRESHOLD = 1920 * 1080 * 512;
const needsProgressive = timerAvailable
  ? lastGpuTimeMs > FRAME_BUDGET_MS
  : workload > PROGRESSIVE_THRESHOLD;
```

### Implementation (webglRenderer.ts)

```typescript
const FRAME_BUDGET_MS = 16;
let lastGpuTimeMs = 0;

function render(options: GPURenderOptions): void {
  const needsProgressive = lastGpuTimeMs > FRAME_BUDGET_MS;

  if (needsProgressive) {
    renderToFBO(quarterFBO, options);   // 1/16 pixels
    blitToCanvas(quarterFBO);           // instant upscaled preview

    requestAnimationFrame(() => {
      renderToCanvas(options);          // full-res
      lastGpuTimeMs = readTimerQuery();
    });
  } else {
    renderToCanvas(options);
    lastGpuTimeMs = readTimerQuery();
  }
}
```

### SRP

- `webglRenderer.ts`: decides progressive vs direct, orchestrates passes
- `gpuFramebuffer.ts`: creates/manages quarter-res FBO, blit to canvas
- `shaderCompiler.ts`: compiles — unaware of progressive rendering

---

## 11. Palette Texture

```typescript
// paletteTexture.ts
import { resolvePalette } from '@/domain/palettes';
import { oklchToRgb } from '@/domain/color';

export function createPaletteTexture(gl: WebGL2RenderingContext, palette: PaletteName): WebGLTexture {
  const colorFn = resolvePalette(palette);
  const data = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const oklch = colorFn(t);
    const [r, g, b] = oklchToRgb(oklch.L, oklch.C, oklch.H);
    data[i * 4]     = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }

  const tex = twgl.createTexture(gl, {
    src: data,
    width: 256,
    height: 1,
    min: gl.LINEAR,    // Smooth interpolation between palette entries (matches CPU)
    mag: gl.LINEAR,
    wrap: gl.CLAMP_TO_EDGE,
    internalFormat: gl.RGBA8,  // sRGB-ready, no double-decode
  });

  return tex;
}
```

**DRY**: palette definition stays in `domain/palettes.ts`. `paletteTexture.ts` only converts to GPU format. OKLCH interpolation happens in domain layer — GPU gets pre-baked sRGB.

---

## 12. Fullscreen Vertex Shader

```glsl
#version 300 es

// Fullscreen triangle: 3 vertices, oversized to cover viewport
// Industry standard (Three.js, modern engines) — more efficient than 2-triangle quad
// gl_VertexID arithmetic — zero buffer/attribute setup, only needs empty VAO bound
void main() {
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
```

Draw call: `gl.drawArrays(gl.TRIANGLES, 0, 3)` with empty VAO bound.

```typescript
// In createWebGLRenderer():
const emptyVAO = gl.createVertexArray();  // Required by WebGL 2 (no default VAO)
// In render():
gl.bindVertexArray(emptyVAO);
gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

Shared by all fragment shaders. One file, never duplicated.

---

## 13. Uniforms Map

| Uniform | Type | Source | Updated when |
|---|---|---|---|
| `u_center` | `vec2` | `Viewport.centerRe/Im` | Every render |
| `u_scale` | `float` | `Viewport.scale` | Every render |
| `u_resolution` | `vec2` | Canvas `width, height` | Resize |
| `u_palette` | `sampler2D` | Palette texture | Palette change |
| `u_juliaRe` | `float` | `FractalParams.juliaRe` | Fractal change (v2) |
| `u_juliaIm` | `float` | `FractalParams.juliaIm` | Fractal change (v2) |
| `u_power` | `int` | `FractalParams.power` | Fractal change (v2) |

Note: `maxIterations` is NOT a uniform — it is injected as `#define MAX_ITER` at compile time (Section 9). `COLOR_CYCLE_PERIOD` is also a `#define`, sourced from the domain constant.

---

## 14. Anti-Patterns Avoided

Per WebGL Fundamentals, MDN, and Emscripten:

- No properties attached to WebGL objects (context loss safety)
- No `getError()` in production (causes CPU-GPU sync stall)
- No GL state reset after each draw (lazy state transitions)
- No `getUniformLocation()` at render time (cached at program setup)
- No runtime branching in iteration hot loop (compile-time composition)
- No `readPixels()` (no CPU-GPU sync, all rendering stays on GPU)
- `gl.viewport()` called on every render (handles canvas resize)
- All GLSL that mirrors CPU code tagged `@mirror domain/<file>:<function>` for traceability

---

## 15. Industry Standards Conformance

| Decision | Standard | Reference |
|---|---|---|
| Facade GPU→Workers→Fallback | Progressive enhancement | Figma, Three.js, TensorFlow.js |
| Thin orchestrator + delegation | SRP | Three.js WebGLRenderer architecture |
| Program cache Map | Shader management | Three.js WebGLPrograms, Emscripten |
| KHR_parallel_shader_compile | Non-blocking compile | MDN, Khronos spec, PlayCanvas |
| Palette 256x1 texture | LUT pattern | WebGL Fundamentals, gpfault.net |
| Context lost → CPU fallback | Resilience | Khronos wiki, Figma |
| Lazy + eager default compile | Warm-up strategy | MJP Shader Permutations, TF.js |
| #define MAX_ITER | Compile-time specialization | Doom, Three.js, Fractal Lab |
| Chunk composition | Shader modularity | Three.js ShaderChunk, luma.gl |
| Progressive GPU (resolution scaling) | Perf guard | Josh Stockin OpenGL Fractals |

---

## 16. v1 Deliverables

| What | Files |
|---|---|
| GPU detection | `gpuDetector.ts` |
| Shader compiler + cache | `shaderCompiler.ts` |
| Palette texture | `paletteTexture.ts` |
| FBO progressive | `gpuFramebuffer.ts` |
| WebGL renderer | `webglRenderer.ts` |
| Facade update | `renderer.ts` (modified) |
| Hook update | `useRenderer.ts` (modified) |
| Viewport transition | `useViewportTransition.ts` (modified — `gpuActive` flag) |
| Vertex shader | `shaders/fullscreen.vert` |
| GLSL chunks | `shaders/chunks/` (6 files) |
| Mandelbrot iteration | `shaders/iterations/mandelbrot.glsl` |
| Classic coloring | `shaders/coloring/classic.glsl` |
| Main template | `shaders/main.glsl` |
| TWGL dependency | `package.json` (modified) |
| TWGL types | `types/twgl.d.ts` (if `@types/twgl.js` unavailable) |

**Total new files**: 13 (+ optional type declarations)
**Modified files**: 5 (`renderer.ts`, `useRenderer.ts`, `useViewportTransition.ts`, `package.json`, `domain/coloringModes.ts` — add `export` to `COLOR_CYCLE_PERIOD`)
**CPU code changes**: minimal (guard `gpuActive` in `useViewportTransition.ts`)

---

## 17. Future Extensions (post-v1)

- **v2**: Port 4 remaining fractals (julia, burningship, tricorn, multibrot) — 1 new `.glsl` per fractal
- **v2**: Port 4 remaining coloring modes — 1 new `.glsl` per mode + enable `accumulator.glsl`
- **v3**: Double-single emulation (vec2-based, zoom to 10^15) — new `chunks/doubleSingle.glsl`
- **v4**: Perturbation theory — CPU arbitrary precision ref orbit + GPU float32 delta
- **v4**: WebGPU path when browser support reaches ~90%
