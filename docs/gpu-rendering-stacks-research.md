# GPU-Accelerated Fractal Rendering: Technology Stack Research

**Date**: 2026-03-22
**Context**: Migration from CPU-based rendering (TypeScript, Web Workers, SharedArrayBuffer, band decomposition) to GPU-accelerated rendering.
**Current architecture**: `src/infrastructure/` (renderer, workerPool, renderBand, fractal.worker) + `src/domain/fractals.ts` (pure calculators: Mandelbrot, Julia, BurningShip, Tricorn, Multibrot).

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Stack-by-Stack Analysis](#stack-by-stack-analysis)
3. [Comparison Table](#comparison-table)
4. [Precision Deep-Dive](#precision-deep-dive)
5. [Recommendation](#recommendation)
6. [Sources](#sources)

---

## Executive Summary

For a fractal explorer that renders Mandelbrot/Julia/BurningShip/Tricorn/Multibrot on a fullscreen quad, the core GPU work is always a **fragment shader** (or compute shader) that runs the escape-time iteration per pixel. The choice of stack determines how much wrapper code sits between your GLSL/WGSL and the browser's GPU API.

**Key finding**: All stacks ultimately compile to the same GPU pipeline. The performance difference between them is negligible (<1%) once the shader is running. The real differentiators are: **boilerplate effort**, **bundle size**, **maintenance surface**, and **precision extensibility**.

---

## Stack-by-Stack Analysis

### 1. Raw WebGL 2.0 (Fullscreen Quad + Fragment Shader)

**How it works**: Create a WebGL2 context, compile a vertex shader that emits a fullscreen triangle/quad, compile a fragment shader that implements the fractal iteration loop, pass uniforms (viewport center, zoom, maxIterations, palette data), and call `drawArrays`.

**Boilerplate**: ~75-120 lines of JS for the minimal setup (context creation, shader compilation with error handling, buffer creation, uniform location lookups, draw loop). The vertex shader is ~8 lines. The fragment shader (Mandelbrot) is ~30-50 lines of GLSL.

**Performance gain**: 100-500x over CPU single-thread. Our current Web Workers setup (4-8 cores) gets ~8-16x over single-thread, so GPU would be **~10-60x faster than our current best**. At 1920x1080 with 256 iterations, expect sub-5ms render times (vs ~70-150ms current).

**Precision**: Native float32 only. Zoom limited to ~10^7 (about 23 doublings from default view). Double-single emulation possible (store double as vec2, custom add/mul functions), extending to zoom level ~42 (~10^15) at 4x slowdown. Perturbation theory is the industry-standard solution for deeper zooms (CPU computes one high-precision reference orbit, GPU computes delta per pixel).

**Browser support**: WebGL 2.0 at **~96%** global support (caniuse). Effectively universal.

**Bundle size**: **0 KB** added. It's a browser API. Only your GLSL strings and ~100 lines of JS wrapper.

**React/Next.js integration**: Manual. Use a `useEffect` + `useRef` to grab the canvas, initialize WebGL context, and manage the render loop. Clean but requires understanding WebGL lifecycle. Our existing `useRenderer` hook pattern maps directly.

**Maintenance burden**: Medium. Must manually manage shader compilation, uniform locations, error handling, and context loss recovery. The fractal logic must be rewritten in GLSL (cannot share TypeScript domain code). Two codebases to maintain (GLSL + TS fallback).

**GLSL loop constraint**: WebGL GLSL requires `for` loops with compile-time-determinable iteration counts. Workaround: use a large constant max and `break` early. This works fine for fractals.

---

### 2. WebGPU (Compute Shader, WGSL)

**How it works**: Request a GPU adapter/device, create a render pipeline or compute pipeline, write the fractal in WGSL (WebGPU Shading Language), bind uniforms via bind groups, dispatch work or render to a fullscreen quad.

**Boilerplate**: ~150-250 lines of JS. More verbose than WebGL due to explicit resource management (bind group layouts, pipeline descriptors, command encoders). The WGSL shader itself is similar in length to GLSL (~40-60 lines for Mandelbrot).

**Performance gain**: For a simple fullscreen-quad fractal, **comparable to WebGL** (same GPU hardware). The 2-10x advantage of WebGPU over WebGL applies to draw-call-heavy scenes, not single-quad rendering. Compute shaders could enable parallel reduction for histogram coloring or progressive refinement, but for basic per-pixel iteration the fragment shader approach is equivalent.

**Precision**: WGSL supports `f32` only (no native f64 in current spec). Same double-single emulation techniques apply. WGSL is more expressive than GLSL for complex arithmetic code.

**Browser support**: **~70%** global as of early 2026. Chrome, Edge, Firefox (Windows + macOS ARM), Safari (macOS Tahoe 26 / iOS 26). Missing: Firefox on Linux/Android, older Safari, older mobile. **Not yet universal enough for a public-facing app without fallback.**

**Bundle size**: **0 KB** added (browser API). But you need a fallback to WebGL for the ~30% without WebGPU support.

**React/Next.js integration**: Same manual approach as WebGL. Three.js r171+ offers `import from 'three/webgpu'` with automatic WebGL 2 fallback, but that pulls in Three.js.

**Maintenance burden**: High if used standalone (must maintain WebGPU + WebGL fallback = two GPU codebases + CPU fallback = three codebases). If using Three.js as abstraction layer, the fallback is handled but you pay the bundle size.

**Verdict**: Premature for primary target. Worth monitoring for 2027+. The compute shader capability is interesting for advanced features (perturbation theory on GPU, histogram equalization) but not needed for v1 GPU migration.

---

### 3. gpu.js

**How it works**: Write JavaScript kernel functions, gpu.js compiles them to WebGL fragment shaders at runtime via AST transpilation.

**Status**: **Effectively abandoned.** Last npm release: v2.16.0 (2023, 3+ years ago). 200+ open issues, PRs not merged. GitHub issue #807 ("Is this project dead?") confirms no active maintainer. Known constructor breakage in recent Chrome/Edge versions.

**Performance gain**: Slower than hand-written GLSL due to: generated shader code is unoptimized, no control over GPU-specific optimizations (branch elimination, early bailout), and runtime compilation overhead. Estimated 2-5x slower than equivalent GLSL.

**Precision**: float32 only, no double-single emulation support. `loopMaxIterations` setting caps iteration loops (default 1000, configurable but adds complexity).

**Browser support**: Targets WebGL 1/2, so ~96% in theory. In practice, broken in recent browsers.

**Bundle size**: **~350-500 KB** minified (unpacked: 2.4 MB). Very heavy for what it provides.

**React/Next.js integration**: No official React bindings. Manual integration only.

**Maintenance burden**: Extreme risk. Abandoned project + breakage in modern browsers + no path to WebGPU. Dead end.

**Verdict**: **Eliminated.** Do not use. Abandoned, heavy, slower than alternatives, no precision escape hatch.

---

### 4. Three.js ShaderMaterial

**How it works**: Three.js provides `ShaderMaterial` (or `RawShaderMaterial`) where you supply custom vertex/fragment GLSL shaders. Three.js handles WebGL context, program compilation, uniform management, and (since r171) automatic WebGPU/WebGL2 fallback. You render a `PlaneGeometry` with your fractal shader.

**Boilerplate**: ~30-50 lines of JS/TS (create scene, camera, plane, shader material, renderer). Three.js handles all the WebGL plumbing. The GLSL shader is the same as raw WebGL.

**Performance gain**: Identical to raw WebGL for a single-quad shader. Three.js overhead is negligible for this use case (no scene graph traversal, no lighting, no mesh processing).

**Precision**: Same as raw WebGL (float32, double-single emulation in GLSL).

**Browser support**: WebGL2 path: ~96%. WebGPU path (r171+): ~70%. Auto-fallback between them.

**Bundle size**: **~670 KB** minified, **~182 KB** gzipped (entire three.js). Tree-shaking is limited; you cannot easily strip the library to only ShaderMaterial. Unpacked: 36.5 MB (includes examples, docs, etc. -- not all shipped to client).

**React/Next.js integration**: Excellent via `@react-three/fiber` (R3F). Well-maintained, large ecosystem, SSR-compatible patterns documented. However, R3F adds another ~50 KB gzipped.

**Maintenance burden**: Low for the WebGL wrapper layer. Three.js is actively maintained (monthly releases). The WebGPU fallback path is handled for you. But you're paying 182 KB gzipped for a canvas wrapper you barely use.

**Verdict**: **Viable but overkill.** You'd be shipping a full 3D engine to render a 2D quad. The auto WebGPU fallback is genuinely valuable, but the bundle cost is hard to justify.

---

### 5. regl (Functional WebGL)

**How it works**: Define WebGL "commands" as plain objects with shader strings, attributes, uniforms, and draw call config. regl handles state management, shader compilation, and buffer setup. Functional API: no shared mutable state.

**Boilerplate**: ~20-40 lines of JS. Define one command with your fragment shader, call it per frame. Very concise.

**Performance gain**: Identical to raw WebGL. regl adds no rendering overhead (thin wrapper over WebGL calls).

**Precision**: Same as raw WebGL.

**Browser support**: WebGL 1 focused. **WebGL 2 support is incomplete** (open issue #378 since 2017, still unresolved). This means no `#version 300 es` shaders, no integer textures for LUT palettes, no guaranteed `highp` in fragment shaders on mobile.

**Bundle size**: **~80 KB** minified, ~26 KB gzipped (estimated from unpacked 1.2 MB npm package). Reasonable.

**React/Next.js integration**: No official bindings. `react-regl` exists but is unmaintained. Manual canvas ref integration required.

**Maintenance burden**: Low wrapper maintenance, but the library itself shows slow development. No WebGPU migration path. You'd need to replace it entirely for WebGPU.

**Verdict**: **Decent for WebGL-only, but WebGL 2 gap is a blocker.** Double-single emulation needs `highp float` guarantees that WebGL 2 provides. Without WebGL 2 support, this is risky for precision work.

---

### 6. TWGL (Tiny WebGL Helper Library)

**How it works**: Thin utility functions that reduce WebGL boilerplate. `createProgramInfo` compiles shaders; `createBufferInfoFromArrays` sets up geometry; `setUniforms` handles uniforms. You still write raw WebGL logic, just with less ceremony.

**Boilerplate**: ~40-60 lines of JS (vs ~75-120 for raw WebGL). Cuts boilerplate roughly in half while keeping full control.

**Performance gain**: Identical to raw WebGL. Zero abstraction overhead.

**Precision**: Same as raw WebGL. Full control over shader code.

**Browser support**: WebGL 1 and **WebGL 2 supported** (documented examples with UBOs, 3D textures, etc.). Underlying browser support: ~96%.

**Bundle size**: **~50 KB** minified, ~15 KB gzipped (estimated). Very lightweight.

**React/Next.js integration**: No React bindings. Manual canvas ref, same as raw WebGL. But the reduced boilerplate makes this easier to encapsulate in a custom hook.

**Maintenance burden**: Low. Last commit December 2024 (active). The library is stable and minimal -- not much to break. Creator (Gregg Tavares) is a Google WebGL team member. No WebGPU path, but the wrapper is thin enough that switching away is straightforward.

**Verdict**: **Strong contender.** Best ratio of boilerplate reduction to bundle cost. Full WebGL 2 support. Thin enough that migration to WebGPU later is not painful.

---

### 7. Shadertoy-Style (Minimal JS Wrapper)

**How it works**: Write a GLSL fragment shader following Shadertoy conventions (`mainImage(out vec4 fragColor, in vec2 fragCoord)`), use a minimal JS wrapper (~50-80 lines) or the `shadertoy-react` npm component (6 KB) to handle the WebGL setup, canvas, uniforms (`iResolution`, `iTime`, `iMouse`), and render loop.

**Boilerplate**: With `shadertoy-react`: **~10 lines of React code**. Paste your GLSL shader as a prop. Custom uniforms supported. The component handles WebGL context, fullscreen quad, and built-in uniforms.

**Performance gain**: Identical to raw WebGL.

**Precision**: Same as raw WebGL. Full GLSL control.

**Browser support**: ~96% (WebGL). `shadertoy-react` uses WebGL 1 internally. Custom wrappers can target WebGL 2.

**Bundle size**: `shadertoy-react`: **~6 KB** minified. Custom wrapper: 0 KB. Alternatively, `react-shaders` (built on shadertoy-react) provides more features.

**React/Next.js integration**: **Excellent.** `shadertoy-react` is a drop-in React component. Supports custom uniforms for viewport, zoom, palette data, etc. Automatically manages event listeners only for used uniforms (performance-conscious).

**Maintenance burden**: Low if using shadertoy-react. The GLSL shader is the same as any other approach. The wrapper component is small and stable.

**Limitations**: No built-in WebGPU fallback. `shadertoy-react` may not expose all WebGL 2 features. For double-single emulation you may need a custom wrapper or fork.

**Verdict**: **Fastest path to a working GPU renderer in React.** Ideal for prototyping. May need to be replaced with a custom wrapper for production features (WebGL 2, double-single, perturbation theory).

---

### 8. Emscripten/WASM + WebGL Interop

**How it works**: Write fractal computation in C/C++, compile to WebAssembly via Emscripten. Emscripten maps OpenGL ES 3.0 calls to WebGL 2. The C code handles WebGL context creation, shader compilation, and rendering.

**Boilerplate**: High. Full Emscripten toolchain setup. C/C++ codebase. Build system complexity. Emscripten runtime adds overhead.

**Performance gain**: WASM CPU compute is ~1.5-2x faster than JS for the same algorithm, but **still CPU-bound**. The GPU rendering part is identical to raw WebGL (same shaders). WASM does NOT make the GPU faster. The benefit would be for CPU-side work like perturbation theory reference orbit computation.

**Precision**: C code can use native `double` for CPU-side perturbation theory. GPU shaders are still float32 GLSL. This is actually the **ideal combination** for deep zoom: C `double` (or arbitrary precision library) for reference orbit on CPU, float32 GLSL for per-pixel delta on GPU.

**Browser support**: WASM: ~96%. WebGL 2 via Emscripten: ~96%. Combined: ~96%.

**Bundle size**: Emscripten runtime: **~50-100 KB**. WASM binary for fractal math: ~10-30 KB. Total: ~60-130 KB added.

**React/Next.js integration**: Complex. Need to load WASM module, manage memory, bridge between React state and C functions. Well-documented patterns exist but it's significantly more work than pure JS/TS.

**Maintenance burden**: Very high. Two languages (C + GLSL + TypeScript). Build toolchain complexity. Harder to debug. Harder to onboard contributors.

**Verdict**: **Overkill for v1.** The only genuine advantage is native `double` for perturbation theory reference orbits, which can be done with a small WASM module later without Emscripten's full WebGL bridge. Do not use Emscripten to drive WebGL -- use it only for CPU math if needed.

---

## Comparison Table

| Criteria | Raw WebGL 2 | WebGPU | gpu.js | Three.js | regl | TWGL | Shadertoy wrapper | Emscripten/WASM |
|---|---|---|---|---|---|---|---|---|
| **Migration effort** | Medium (rewrite fractals in GLSL, ~200 LOC wrapper) | High (new API + fallback needed) | Low (JS syntax) but broken | Low-Medium (ecosystem helps) | Low-Medium | Medium-Low | Very Low (~10 lines React) | Very High |
| **GPU perf gain vs current Workers** | 10-60x | 10-60x (same GPU) | 5-20x (unoptimized shaders) | 10-60x | 10-60x | 10-60x | 10-60x | 10-60x (GPU part identical) |
| **Bundle size (gzipped)** | **0 KB** | **0 KB** (+fallback cost) | ~120 KB | ~182 KB (+50 KB for R3F) | ~26 KB | ~15 KB | ~6 KB (shadertoy-react) | ~50-100 KB |
| **float32 deep zoom limit** | ~10^7 (zoom level 17) | ~10^7 | ~10^7 | ~10^7 | ~10^7 | ~10^7 | ~10^7 | ~10^7 (GPU) |
| **Double-single emulation** | Yes (4x slowdown, zoom to 10^15) | Yes (WGSL vec2) | No | Yes | Risky (no WebGL 2) | Yes | Possible with custom wrapper | Yes |
| **Perturbation theory** | Possible (CPU ref orbit + GPU delta) | Best (compute shader for ref orbit) | No | Possible | Possible | Possible | Unlikely | Best for CPU ref orbit |
| **Browser support** | ~96% | ~70% | Broken in modern browsers | ~96% (WebGL) / ~70% (WebGPU) | ~96% | ~96% | ~96% | ~96% |
| **React/Next.js integration** | Manual (custom hook) | Manual | Manual | Excellent (R3F) | Poor | Manual | Excellent (component) | Complex |
| **WebGPU migration path** | Must rewrite wrapper | Native | None | Automatic (r171+) | None | Must rewrite | Must rewrite | Via wasm_webgpu |
| **Maintenance burden** | Medium | High (dual GPU codebases) | Dead project | Low (active community) | Medium (slow dev) | Low (stable, active) | Low | Very High |
| **Project health** | Browser API (eternal) | Browser API (growing) | Abandoned (2023) | Excellent (monthly releases) | Slow (last release 2024) | Good (active, Dec 2024) | Small but stable | Emscripten: active |

---

## Precision Deep-Dive

### The float32 Problem

All GPU approaches share the same fundamental limitation: GPU shaders only support 32-bit floats (float32), which gives ~7 decimal digits of precision. For fractal rendering:

- **Zoom level ~17** (~10^7x magnification): float32 precision exhausted. Pixels become "blocky."
- Our current CPU TypeScript code uses JavaScript `number` (float64), supporting zoom to ~10^15.

### Solutions (ranked by complexity)

| Technique | Zoom depth | GPU perf cost | Implementation complexity |
|---|---|---|---|
| Native float32 | 10^7 (level 17) | None | None |
| Double-single emulation (vec2) | 10^15 (level 42) | 4x slowdown | Medium (custom GLSL math library, ~100 LOC) |
| Perturbation theory + float32 GPU | 10^238+ (unlimited) | ~1.5x overhead | High (CPU arbitrary precision ref orbit + GPU delta shader) |
| Perturbation + double-single GPU | 10^238+ (unlimited) | ~6x overhead | Very High |

### Practical Impact

For a public-facing fractal explorer, zoom level 17 (float32 native) covers the vast majority of user exploration. The iconic Mandelbrot features (seahorses, mini-brots, spirals) are all reachable within 10^7 zoom. Double-single emulation at 4x slowdown still gives interactive framerates and extends to zoom level 42, which satisfies power users.

Perturbation theory is the gold standard for deep zoom but requires significant architectural changes (arbitrary precision CPU math, reference orbit storage, glitch detection). This is a separate project phase, not a v1 requirement.

---

## Recommendation

### For v1 GPU migration: **TWGL + custom WebGL 2 wrapper**

**Why TWGL over raw WebGL**: Cuts boilerplate in half (~60 lines vs ~120), handles the tedious parts (shader compilation, uniform setters, buffer management) without adding abstraction. 15 KB gzipped. Full WebGL 2 support. Maintained by a Google WebGL team member.

**Why not shadertoy-react for production**: While it's the fastest prototype path, it locks you into WebGL 1 conventions and doesn't expose WebGL 2 features needed for double-single emulation (`highp float` guarantees, integer textures for palette LUTs).

**Why not Three.js**: 182 KB gzipped for a canvas wrapper. The auto WebGPU fallback is nice but premature -- WebGPU is at 70% support and we need CPU fallback anyway.

### Architecture sketch

```
src/infrastructure/
  gpu/
    shaders/          # GLSL fragment shaders (one per fractal type)
    webglRenderer.ts  # TWGL-based WebGL 2 renderer
    shaderUtils.ts    # Shader compilation, uniform management
  cpuRenderer.ts      # Current worker-based renderer (renamed)
  renderer.ts         # Facade: detect GPU support, delegate to gpu/ or cpu/
```

The fractal math in `src/domain/fractals.ts` cannot be shared with GLSL (different languages). Each fractal needs a GLSL port. The domain types, viewport math, and palette definitions remain shared.

### Migration phases

1. **Phase 1**: TWGL + WebGL 2, single Mandelbrot shader, float32 only. Keep CPU fallback. Target: <5ms render at 1080p.
2. **Phase 2**: Port all 5 fractal types to GLSL. Palette as texture uniform.
3. **Phase 3**: Double-single emulation for deep zoom (4x slowdown, zoom to 10^15).
4. **Phase 4** (future): Evaluate WebGPU when support reaches ~90%. Consider perturbation theory for ultra-deep zoom.

---

## Sources

### WebGL Fractal Rendering
- [Rendering the Mandelbrot Set With WebGL](https://gpfault.net/posts/mandelbrot-webgl.txt.html)
- [Barebones WebGL in 75 Lines of Code](https://avikdas.com/2020/07/08/barebones-webgl-in-75-lines-of-code.html)
- [Using WebGL2 to Draw Fractals](https://mybytestream.com/blog/javascript-fractals-with-webgl-animation.html)
- [Fractal Lab - Interactive WebGL Fractal Explorer](http://hirnsohle.de/test/fractalLab/)
- [Building an Interactive Fractal Explorer with WebGL](https://bvdart.nl/en/articles/building-an-interactive-fractal-explorer)

### WebGPU
- [WebGPU Hits Critical Mass: All Major Browsers Now Ship It](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)
- [WebGPU 2026: 70% Browser Support, 15x Performance Gains](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/)
- [WebGPU in 2025: The Complete Developer's Guide](https://dev.to/amaresh_adak/webgpu-in-2025-the-complete-developers-guide-3foh)
- [WebGPU API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebGPU Mandelbrot (BenjaminAster)](https://github.com/BenjaminAster/WebGPU-Mandelbrot)
- [WebGPU Browser Support - Can I Use](https://caniuse.com/webgpu)
- [WebGL to WebGPU: 70% Browser Support & 3x Faster Apps](https://wishtreetech.com/blogs/digital-product-engineering/unlocking-the-power-of-webgl-and-webgpu-the-zero-install-enterprise/)

### gpu.js
- [gpu.js GitHub](https://github.com/gpujs/gpu.js/)
- [Is this project dead? - Issue #807](https://github.com/gpujs/gpu.js/issues/807)
- [Unlocking the Power of GPU with GPU.js](https://scribbler.live/2024/10/05/GPU-Processing-with-GPU-js.html)

### Three.js
- [ShaderMaterial - Three.js Docs](https://threejs.org/docs/pages/ShaderMaterial.html)
- [WebGPU Three.js Migration Guide 2026](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Using WebGL Shadertoy Shaders in Three.js](https://felixrieseberg.com/using-webgl-shadertoy-shaders-in-three-js/)
- [Three.js WebGPURenderer Part 1](https://medium.com/@christianhelgeson/three-js-webgpurenderer-part-1-fragment-vertex-shaders-1070063447f0)

### regl
- [regl - Functional WebGL](https://regl-project.github.io/regl/)
- [regl GitHub](https://github.com/regl-project/regl)
- [WebGL 2 support - Issue #378](https://github.com/regl-project/regl/issues/378)

### TWGL
- [TWGL.js Official Site](https://twgljs.org/)
- [TWGL GitHub](https://github.com/greggman/twgl.js)

### Shadertoy / React Wrappers
- [shadertoy-react (6 KB React component)](https://github.com/mvilledieu/shadertoy-react)
- [React Shaders - Rysana](https://rysana.com/docs/react-shaders)
- [Fractals/Shadertoy - Wikibooks](https://en.wikibooks.org/wiki/Fractals/shadertoy)

### Precision / Deep Zoom
- [Double Precision in OpenGL and WebGL - Syntopia](http://blog.hvidtfeldts.net/index.php/2012/07/double-precision-in-opengl-and-webgl/)
- [Heavy Computing with GLSL Part 2: Double-Single Emulation](https://blog.cyclemap.link/2011-06-09-glsl-part2-emu/)
- [WebGL Mandelbrot Deep Zoom (Perturbation Theory)](https://ambrosecavalier.com/projects/gpu-deep-zoom/about/)
- [Emulated Double Precision in OpenGL ES Shader](https://www.betelge.com/blog/2014/10/05/emulated-double-precision-in-opengl-es-shader/)
- [Deep Zoom Theory and Practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html)
- [Mandelbrot Deep Zoomer Using Perturbation and WebGL - Fractal Forums](https://fractalforums.org/programming/11/mandelbrot-deep-zoomer-using-perturbation-and-webgl/3492)

### Emscripten / WASM
- [Combining WebAssembly with WebGL High-Performance Graphics](https://dev.to/tianyaschool/combining-webassembly-with-webgl-high-performance-graphics-processing-322)
- [How to Use WebGL Shaders in WebAssembly](https://www.freecodecamp.org/news/how-to-use-webgl-shaders-in-webassembly-1e6c5effc813/)
- [Optimizing WebGL - Emscripten Docs](https://emscripten.org/docs/optimizing/Optimizing-WebGL.html)
- [wasm_webgpu (Emscripten WebGPU bindings)](https://github.com/juj/wasm_webgpu)

### Browser Support
- [WebGL 2.0 - Can I Use](https://caniuse.com/webgl2)
- [WebGL - Can I Use](https://caniuse.com/webgl)
- [WebGPU - Can I Use](https://caniuse.com/webgpu)

### Performance Benchmarks
- [Mandelbrot Benchmark](https://mandelbrot.silversky.dev/beta/benchmark/)
- [GPU Acceleration in Browsers: WebGPU Performance Benchmarks](https://www.mayhemcode.com/2025/12/gpu-acceleration-in-browsers-webgpu.html)
- [Mandelbrot, Workers, WASM and WebGPU](https://danini.dev/blog/mandelbrot-web-workers-wasm-and-webgpu/)
