# Research: WebGL & WebGPU Fractal Renderer Implementations

> Date: 2026-03-22
> Purpose: Survey of open-source GPU-accelerated fractal renderers in browsers

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [WebGL Mandelbrot Renderers](#webgl-mandelbrot-renderers)
3. [WebGPU Fractal Renderers](#webgpu-fractal-renderers)
4. [Perturbation Theory Implementations](#perturbation-theory-implementations)
5. [Double-Single (Float Emulation) Techniques](#double-single-float-emulation-techniques)
6. [gpu.js and JS-to-GPU Libraries](#gpujs-and-js-to-gpu-libraries)
7. [Three.js / regl-based Renderers](#threejs--regl-based-renderers)
8. [Rust+WASM+WebGPU Hybrid Renderers](#rustwasm-webgpu-hybrid-renderers)
9. [Key Techniques Reference](#key-techniques-reference)
10. [Comparative Table](#comparative-table)
11. [Recommendations for fractal-explorer](#recommendations-for-fractal-explorer)

---

## Executive Summary

The landscape of browser-based GPU fractal rendering is split into three tiers:

1. **Basic WebGL fragment shader** (most common): fullscreen quad + GLSL fragment shader, float32 only, zoom limit ~10^-7. Simple, fast, ~50-150 lines of shader code. Dozens of repos.
2. **Extended precision via double-single emulation**: vec2-based emulated doubles in GLSL, ~4x slower, zoom limit ~10^-15 (zoom level 42). Fewer implementations, well-documented technique.
3. **Perturbation theory (deep zoom)**: CPU computes one arbitrary-precision reference orbit, GPU computes per-pixel perturbations in float32. Zoom depths to 10^-238+. Only 2-3 browser implementations exist (munrocket/deep-mandelbrot, Ambrose Cavalier's GPU Deep Zoom).

WebGPU renderers exist but are still basic (float32 only, no perturbation). No browser-based project combines WebGPU + perturbation theory + series approximation yet. The Rust/wgpu desktop ecosystem (grubertw/mandelbrot) is more advanced, with perturbation theory via CPU-side MPFR.

---

## WebGL Mandelbrot Renderers

### 1. munrocket/deep-mandelbrot (deep-fractal)

- **URL**: https://github.com/munrocket/deep-fractal
- **Stars**: 25
- **Tech**: JavaScript (49%), HTML (32%), Svelte (19%) — WebGL
- **Precision**: **Perturbation theory** with custom arbitrary precision lib (Jampary). Deep zoom to 10^-31 (1024 iterations). Reference orbit on CPU, perturbations on GPU in float32.
- **Architecture**: Ping-pong rendering, Svelte UI, Rollup build, PWA with service worker
- **Shader code**: ~100-200 lines (perturbation + coloring)
- **Notable**: Logarithmic search for reference point, adaptive super-sampling via distance estimation, orbit visualization (Ctrl key), Julia set support
- **Last activity**: 87 commits on master (active fork by JMaio at https://github.com/JMaio/deep-fractal)
- **Live demo**: https://deep-mandelbrot.js.org/

### 2. Ambrose Cavalier — GPU Deep Zoom

- **URL**: https://ambrosecavalier.com/projects/gpu-deep-zoom/about/
- **Stars**: N/A (not a GitHub repo, standalone project)
- **Tech**: JavaScript + WebGL, BigFloat arbitrary precision lib
- **Precision**: **Perturbation theory**. CPU computes reference orbit with BigFloat, GPU computes perturbations in float32. Achieves pixel sizes ~10^-238 (vs 10^-16 for JS doubles).
- **Architecture**: 4-module system: WebGL utility lib, JS arbitrary-precision reference calc, WebGL perturbation shader, HTML5 UI
- **Notable**: Far exceeds CPU double precision. Known limitation: struggles near mini-Mandelbrots.
- **Shader code**: ~100-150 lines estimated

### 3. Greece4ever/Fractals-Explorer

- **URL**: https://github.com/Greece4ever/Fractals-Explorer
- **Stars**: 3
- **Tech**: C++ (31%), JavaScript (30.5%), C (21%), GLSL (7.3%) — WebGL + OpenGL + OpenCL
- **Precision**: Float32 only (WebGL path), no extended precision
- **Architecture**: Triple implementation (OpenGL/C++, WebGL/JS, OpenCL/C++). WebGL version uses fragment shader on fullscreen quad.
- **Fractal types**: Mandelbrot, Julia, Newton, Tricorn, Burning Ship
- **Shader code**: ~100-200 lines GLSL
- **Notable**: Google Maps-style interactive exploration, mobile-friendly, desktop binaries available
- **Last activity**: March 2021 (50 commits)

### 4. AkosSeres/mandelbrot-web

- **URL**: https://github.com/AkosSeres/mandelbrot-web
- **Stars**: 5
- **Tech**: JavaScript (76%), HTML (24%) — WebGL
- **Precision**: Float32 only. Author notes "on high zoom levels, the image kind of falls apart"
- **Architecture**: Fullscreen canvas, WebGL fragment shader, each pixel independent
- **Notable**: Clean minimal implementation, mobile touch support (pinch zoom)
- **Last activity**: ~2021

### 5. jakobmollas/mandelbrot-shader-webgl

- **URL**: https://github.com/jakobmollas/mandelbrot-shader-webgl
- **Stars**: 0
- **Tech**: TypeScript (91%), HTML (9%) — WebGL2 (GLES 3), zero dependencies
- **Precision**: Float32 only. Notes that OpenGL ES specifies minimum 16-bit highp, zoom is poor on mobile.
- **Architecture**: Fragment shader on fullscreen quad, TypeScript orchestration
- **Shader code**: ~50-100 lines
- **Last activity**: September 2021 (2 commits)

### 6. Fractex (tobi18991/Fractex)

- **URL**: https://github.com/tobi18991/Fractex
- **Stars**: 1 (archived August 2025)
- **Tech**: HTML (35%), CSS (26%), JavaScript (22%), GLSL (17%) — WebGL
- **Precision**: Float32 only
- **Architecture**: WebGL fragment shader, responsive design
- **Fractal types**: Mandelbrot, Julia
- **Shader code**: ~100 lines (17% of codebase is GLSL)
- **Last activity**: Archived, 11 commits

### 7. gpfault.net Mandelbrot WebGL Tutorial

- **URL**: https://gpfault.net/posts/mandelbrot-webgl.txt.html
- **Type**: Tutorial/article (not a library)
- **Tech**: Raw WebGL, GLSL fragment shader
- **Precision**: Float32 only. Author acknowledges "there are only so many bits in a floating point number."
- **Architecture**: Fullscreen quad, complex number iteration in fragment shader using mat2 multiplication trick: `mat2(z,-z.y,z.x)*z + c`
- **Notable**: Good reference for coloring strategies (iteration grayscale, 4-color palette interpolation, cosine palettes). Suggests hybrid HW+SW approach for future.

### 8. BVDART Fractal Explorer

- **URL**: https://bvdart.nl/en/articles/building-an-interactive-fractal-explorer
- **Type**: Article + implementation
- **Tech**: WebGL + GLSL fragment shader
- **Precision**: Float32 baseline with **perturbation theory** for deep zoom. Float32 loses accuracy at ~10^-7 zoom.
- **Architecture**: CPU computes high-precision reference orbit, GPU computes perturbation formula: delta_n+1 = 2*Z_n*delta_n + delta_n^2 + delta_c
- **Notable**: Smooth coloring in OKLCH color space, orbit trap coloring, "feels as responsive as scrolling a map" on mobile. Renders 1024x1024 in <16ms even on mobile.

---

## WebGPU Fractal Renderers

### 1. BenjaminAster/WebGPU-Mandelbrot

- **URL**: https://github.com/BenjaminAster/WebGPU-Mandelbrot
- **Stars**: 10
- **Tech**: HTML (69%), WGSL (31%) — WebGPU
- **Precision**: Float32 only (f32), no double emulation
- **Architecture**: Fragment shader approach (not compute), fullscreen quad, uniforms for center/rectangle/maxIterations
- **Coloring**: Sinusoidal RGB based on iteration count: `sin(iter/max * k)` for k=5,10,15
- **Shader code**: ~50 lines WGSL
- **Notable**: Clean minimal WebGPU example, PWA support
- **Live demo**: benjaminaster.com/webgpu-mandelbrot/

### 2. scttfrdmn/webgpu-compute-exploration

- **URL**: https://github.com/scttfrdmn/webgpu-compute-exploration
- **Stars**: 3
- **Tech**: JavaScript (90%), WGSL, Rust (2.6% for WASM modules) — WebGPU
- **Precision**: Float32 only
- **Architecture**: Three-tier: Rust/WASM state management -> WebGPU compute -> Canvas rendering. Fragment shader ray marching for 3D fractals (not compute shaders for 2D Mandelbrot).
- **Fractal types**: Mandelbulb, Julia 3D, Menger Sponge, Mandelbox (all 3D, ray-marched)
- **Notable**: Sphere tracing with distance estimators, Phong lighting, ambient occlusion, fog. Workgroup sizes 64/128/256.
- **Last activity**: November 2025 (6 commits)

### 3. LeandroSQ/js-mandelbrot (multi-backend comparison)

- **URL**: https://github.com/LeandroSQ/js-mandelbrot
- **Stars**: 0
- **Tech**: TypeScript (79%), SCSS (6%), WGSL (5.4%), GLSL (2%) — WebGPU + WebGL + WASM + Canvas
- **Precision**: Float32 for WebGPU/WebGL/WASM (upgradeable to f64 for WebGL/WASM, NOT for WebGPU). MathJS renderer offers arbitrary precision.
- **Architecture**: 5 rendering backends compared side-by-side
- **Notable**: WebGPU lacks f64 support, limiting precision scaling. WASM underperforms pure JS due to data marshaling overhead. Tested on iPhone 13 Pro, MacBook M1, Windows Desktop.
- **Last activity**: December 2023 (23 commits)

**Key finding from WebGPU f64 status**: Double precision floats (IEEE-754 binary64) are tracked as [gpuweb issue #2805](https://github.com/gpuweb/gpuweb/issues/2805) opened April 2022. f16 is supported via `shader-f16` feature, but f64 remains unimplemented in WGSL as of March 2026.

---

## Perturbation Theory Implementations

### How It Works (Reference Architecture)

```
CPU (arbitrary precision)          GPU (float32)
┌─────────────────────┐          ┌──────────────────────┐
│ 1. Pick reference   │          │ 4. For each pixel:   │
│    point c_ref       │─────────▶│    delta_c = c - c_ref│
│ 2. Iterate z_n+1 =  │  orbit   │    delta_n+1 =       │
│    z_n^2 + c_ref     │  data    │      2*Z_n*delta_n   │
│ 3. Store full orbit  │          │      + delta_n^2     │
│    Z_0..Z_N at       │          │      + delta_c       │
│    arbitrary prec.   │          │ 5. Color based on    │
└─────────────────────┘          │    escape iteration  │
                                  └──────────────────────┘
```

### Browser implementations using perturbation theory:

| Project | Tech | Zoom Depth | Precision Lib | Status |
|---------|------|-----------|---------------|--------|
| munrocket/deep-mandelbrot | WebGL + JS | 10^-31 | Jampary (custom) | Active |
| Ambrose Cavalier GPU Deep Zoom | WebGL + JS | 10^-238 | BigFloat (custom) | Proof of concept |
| BVDART Fractal Explorer | WebGL + JS | Deep (unspecified) | Custom | Article |
| Phil Thompson / Very Plotter | JS (CPU only) | Beyond 10^-300 | BigInt-based custom | Active (391 commits) |

### Desktop implementations (for reference):

| Project | Tech | Zoom Depth | Precision Lib | Notable |
|---------|------|-----------|---------------|---------|
| rust-fractal-core | Rust | 10^-50000+ | MPFR via rug | Series approx, glitch detection |
| grubertw/mandelbrot | Rust + wgpu + WGSL | Deep | MPFR via rug | GPU perturbation + CPU reference, "Scout Engine" |

### Known limitations of perturbation theory:
- Struggles near mini-Mandelbrots (glitch regions)
- Requires glitch detection + re-referencing (solved in rust-fractal-core)
- Series approximation (BLA) can skip iterations but adds complexity
- Reference orbit must be recomputed on pan (can be cached on zoom-only)

---

## Double-Single (Float Emulation) Techniques

### Source: "Heavy computing with GLSL" by Henry Thasler

- **Blog series**: https://blog.cyclemap.link/2011-06-09-glsl-part2-emu/
- **Fork with code**: https://github.com/10110111/QSMandel

### How double-single works:

A double-precision value is stored as two floats (vec2):
- `ds.x` = high part (standard float)
- `ds.y` = low part (error/remainder)
- True value = ds.x + ds.y

Example: 0.4888129819481270 stored as (4.8881298e-1, 1.9481270e-9)

### Key operations (GLSL):

**ds_add**: Carry-over logic between high/low parts with error correction
**ds_mul**: Split-value technique using constant 8193 to partition mantissa bits, cross-products of high/low pairs
**ds_set(float)**: Copy to high part, set low = 0

### Performance:

| Mode | FPS (ATI HD4870) | Zoom depth |
|------|------------------|------------|
| Single precision (float) | ~200 | 10^-7 (level ~23) |
| Emulated double (vec2) | ~51 | 10^-15 (level ~42) |
| Hardware double (fp64) | ~154 | 10^-15 |
| Emulated quad (vec4) | ~6 | 10^-30 |

### Critical compiler caveat:
Nvidia compilers optimize away the precision trick. Required pragmas:
```glsl
#pragma optionNV(fastmath off)
#pragma optionNV(fastprecision off)
```
**WebGL strips pragmas**, making double-single emulation unreliable in WebGL on some drivers. This is a significant limitation.

### Shadertoy implementations:
- https://www.shadertoy.com/view/mdf3WS (Mandelbrot - Double Precision)
- https://www.shadertoy.com/view/mdB3WR (Interactive double precision)
- Users report WebGL may optimize away the emulated precision on some browsers/GPUs.

### Smooth coloring formula (used with double-single):
```glsl
float smooth_iter = float(n) + 1.0 - log(log(length(z))) / log(2.0);
```

---

## gpu.js and JS-to-GPU Libraries

### gpu.js

- **URL**: https://github.com/gpujs/gpu.js
- **Stars**: 15,400
- **Latest release**: v2.11.2 (January 19, 2025)
- **Tech**: Transpiles JavaScript kernel functions to GLSL shaders (WebGL 1 backend)
- **WebGL2**: NOT supported (issue #261, open since 2018)
- **WebGPU**: NOT supported
- **How it works**: `gpu.createKernel(function)` -> automatic GLSL transpilation. Thread coords via `this.thread.x/y/z`.
- **Performance**: 1-15x faster than CPU depending on hardware
- **Mandelbrot**: Official example exists. Each kernel computes divergence for one pixel.
- **Limitations for fractal rendering**:
  - No custom GLSL injection (you write JS, not shaders)
  - Limited to operations gpu.js can transpile
  - No double-single emulation possible (can't control GLSL output)
  - No WebGL2 features (transform feedback, etc.)
  - Constructor broken in Chrome/Edge post-v124 (issue #844, May 2025)
  - Effectively in maintenance mode, not active development
- **Verdict**: Easy for prototyping but **not suitable for production fractal rendering**. Too many limitations vs writing raw WebGL/GLSL.

### gpu.js example project: Bewelge/Mandelbrot-Set-Render
- **URL**: https://github.com/Bewelge/Mandelbrot-Set-Render
- **Stars**: 1
- **Tech**: JavaScript + GPU.js + jQuery
- **Architecture**: Each GPU.js kernel = one pixel's divergence calculation
- **Last activity**: March 2018

### turbo.js
- **URL**: https://turbo.js.org/
- **Status**: Appears abandoned, minimal ecosystem
- **Mandelbrot**: Used as benchmark only

**Conclusion on JS-to-GPU libs**: They abstract away too much control. For fractal rendering, you need direct shader access for precision tricks, custom coloring, and perturbation theory. Write raw WebGL/GLSL or WGSL instead.

---

## Three.js / regl-based Renderers

### Three.js Mandelbrot Implementations

#### sseemayer/ThreeJS-Fractal
- **URL**: https://github.com/sseemayer/ThreeJS-Fractal
- **Stars**: 9 (archived May 2025)
- **Tech**: JavaScript (100%), Three.js + GLSL
- **Architecture**: Plane geometry + orthographic camera + ShaderMaterial with custom fragment shader
- **Last activity**: February 2013 (very old)
- **Notable**: Demonstrates the Three.js approach — render a plane, camera in front, GLSL material on surface

#### paulrobello/fractals (Three.js + ray marching)
- **URL**: https://github.com/paulrobello/fractals
- **Tech**: Three.js + WebGL, GPU-based ray marching
- **Focus**: 3D fractals (Mandelbulb, etc.) rather than 2D Mandelbrot

#### FractalLab (zz85/FractalLab)
- **URL**: https://github.com/zz85/FractalLab
- **Stars**: 181
- **Tech**: JavaScript (56%), GLSL (22%), HTML (12%) — WebGL
- **Architecture**: GPU-accelerated raytracing of 3D fractal geometries
- **Notable**: Keyframe animation system, JSON camera export, video rendering via Node.js + FFmpeg
- **Original author**: Tom Beddard (2011), GPL v3
- **Focus**: 3D fractal exploration, not 2D Mandelbrot deep zoom

#### Three.js approach summary:
- Three.js adds overhead (~150KB+ bundle) for a fullscreen quad + ShaderMaterial
- The actual fractal computation is still in GLSL — Three.js just manages the WebGL context, uniforms, and geometry
- For 2D fractals, Three.js is **overkill**. A raw WebGL setup is ~100 lines of boilerplate vs Three.js's heavier abstraction
- For 3D ray-marched fractals, Three.js provides useful camera/lighting infrastructure

### regl-based Renderers
- No significant regl-based Mandelbrot renderer was found in the search
- regl is a functional WebGL wrapper that could work well (stateless, functional API)
- The only reference found was a 2016 tagged project on GitHub Topics, but no substantial implementation

---

## Rust+WASM+WebGPU Hybrid Renderers

### 1. grubertw/mandelbrot ("Mandelbrot Scout")

- **URL**: https://github.com/grubertw/mandelbrot
- **Stars**: 4
- **Tech**: Rust (87%), WGSL (13%) — Iced GUI + wgpu + MPFR (rug crate)
- **Precision**: **Perturbation theory with arbitrary-precision reference orbits** (MPFR via rug). GPU uses float32 for per-pixel perturbation.
- **Architecture**: Two-tier:
  - CPU "Scout Engine": discovers and computes high-precision reference orbits
  - GPU: fragment shader for per-pixel escape-time with perturbation
  - GPU feedback via reduce/compute shaders to seed orbit locations
- **Notable**: Distance estimation + stripe averaging for coloring. Multi-reference orbit support with automatic rebasing for glitched pixels. Maintains quadratic term (no linearization). Settings via TOML.
- **Last release**: March 16, 2026 (active!)
- **Limitation**: Windows builds have MPFR dependency conflicts

### 2. paulrobello/par-fractal

- **URL**: https://github.com/paulrobello/par-fractal
- **Stars**: 21
- **Tech**: Rust + wgpu-rs + egui, WASM via Trunk
- **Precision**: Float32 only (standard shader precision)
- **Architecture**: 35 fractal types (20 2D + 15 3D), PBR shading for 3D, LOD system
- **Fractal types**: Mandelbrot, Julia, Burning Ship, Tricorn, Newton, Buddhabrot, Mandelbulb, Menger Sponge, etc.
- **Notable**: 48 static + 12 procedural color palettes, mobile touch support
- **Last activity**: 115 commits, active

### 3. Shapur1234/Fractl

- **URL**: https://github.com/Shapur1234/Fractl
- **Stars**: 4
- **Tech**: Rust (77%), Nix (13%), WGSL (7%) — wgpu
- **Precision**: f64 on CPU, f32 on GPU compute shader. WASM builds use f64 exclusively.
- **Architecture**: Three backends (single-thread, Rayon multi-thread, wgpu GPU compute)
- **Fractal types**: Mandelbrot, Multibrot (variable exponent)
- **Last activity**: January 2024 (v0.1.0)
- **Planned**: Julia set, F128, WebGPU compute for WASM

### 4. rosslh/Mandelbrot.site

- **URL**: https://github.com/rosslh/mandelbrot.site
- **Stars**: 277 (highest-starred browser Mandelbrot project found)
- **Tech**: Rust (46%) + TypeScript (28.5%) + HTML — Rust->WASM, Leaflet.js for map UI
- **Precision**: Standard Rust f64 in WASM (no GPU, no perturbation)
- **Architecture**: Leaflet.js tile-based rendering (map-like), Web Workers via threads.js for parallel tile generation, "rectangle checking" optimization
- **Notable**: Most polished UX — shareable URLs, high-res export, PWA, multibrot exploration. No WebGL at all — pure CPU/WASM computation.
- **Last activity**: Active

### 5. ryanrossiter/fractaljs

- **URL**: https://github.com/ryanrossiter/fractaljs
- **Stars**: 1
- **Tech**: JavaScript (90%), WebAssembly (7%), HTML — dual WebGL + WASM
- **Precision**: WebGL path = float32 (limited zoom). WASM path = f64 (double precision, ~2x deeper zoom).
- **Architecture**: Dynamic resolution scaling — lower res during pan/zoom for WASM path
- **Notable**: Rare example of dual GPU/WASM approach. WASM compensates for WebGL precision limits.
- **Last activity**: March 2018

---

## Key Techniques Reference

### Fullscreen Quad Setup (standard for all 2D fractal renderers)
Two triangles covering viewport, creating 1:1 fragment-to-pixel mapping:
```
vertices: [-1,-1], [1,1], [-1,1], [-1,-1], [1,1], [1,-1]
```
No MVP matrix — keep fractal always fullscreen, transformations via uniforms (center, zoom).

### WebGL Loop Limitation Workaround
Most WebGL implementations disallow non-constant loop conditions. Solution: define `MAX_ITER` as a constant replaced before shader compilation, recompile shader when iteration count changes.

### Smooth Coloring
```glsl
float smooth_iter = float(n) + 1.0 - log(log(length(z))) / log(2.0);
```
Produces continuous color gradients instead of banding.

### Cosine Color Palette (Inigo Quilez)
```glsl
vec3 palette(float t) {
    vec3 a = vec3(0.5); vec3 b = vec3(0.5);
    vec3 c = vec3(1.0); vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}
```

### Orbit Trap Coloring
During iteration, compute minimum distance from z to a geometric shape (point, line, circle). Use the minimum distance for coloring. Reveals internal structure of the set.

### Distance Estimation
```glsl
// dz tracks derivative: dz = 2*z*dz + 1
float de = 2.0 * length(z) * log(length(z)) / length(dz);
```
Used for adaptive supersampling, edge detection, and 3D fractal ray marching.

### Complex Multiplication via mat2 (optimization)
```glsl
vec2 cmul(vec2 z, vec2 w) {
    return mat2(z, -z.y, z.x) * w;
}
```

---

## Comparative Table

| Project | Stars | Tech | Precision | Zoom Depth | Perturbation | Architecture | Activity |
|---------|-------|------|-----------|------------|-------------|--------------|----------|
| rosslh/Mandelbrot.site | 277 | Rust+WASM+Leaflet | f64 (WASM) | ~10^-15 | No | CPU tiles + Web Workers | Active |
| zz85/FractalLab | 181 | WebGL+GLSL | f32 | ~10^-7 | No | 3D raytracing | 2011 (fork active) |
| rust-fractal-core | 43 | Rust (desktop) | MPFR arbitrary | 10^-50000+ | Yes + Series Approx | CPU multi-threaded | 2020 |
| munrocket/deep-mandelbrot | 25 | WebGL+Svelte+JS | Perturbation (Jampary) | 10^-31 | **Yes** | CPU ref + GPU perturb | Active |
| par-fractal | 21 | Rust+wgpu+egui | f32 | ~10^-7 | No | GPU fragment shader | Active |
| BenjaminAster/WebGPU-Mandelbrot | 10 | WebGPU+WGSL | f32 | ~10^-7 | No | Fragment shader | Recent |
| sseemayer/ThreeJS-Fractal | 9 | Three.js+GLSL | f32 | ~10^-7 | No | Plane+ShaderMaterial | 2013 (archived) |
| mandelbrot-web | 5 | WebGL+JS | f32 | ~10^-7 | No | Fragment shader | 2021 |
| grubertw/mandelbrot | 4 | Rust+wgpu+WGSL+MPFR | Perturbation (MPFR) | Deep | **Yes** | Scout Engine + GPU | **Mar 2026** |
| Shapur1234/Fractl | 4 | Rust+wgpu+WGSL | f32 GPU / f64 CPU | ~10^-7 GPU | No | 3 backends | Jan 2024 |
| Greece4ever/Fractals-Explorer | 3 | WebGL+OpenCL+C++ | f32 | ~10^-7 | No | Triple implementation | 2021 |
| Phil Thompson/Very Plotter | 2 | JS (CPU only) | BigInt arbitrary | Beyond 10^-300 | **Yes + BLA** | Web Workers | Active (391 commits) |
| gpu.js (library) | 15.4K | JS->GLSL transpiler | f32 only | N/A | N/A | Kernel abstraction | Maintenance mode |

---

## Recommendations for fractal-explorer

### Precision Strategy (tiered approach)

1. **Tier 1 — Float32 WebGL/WebGPU** (zoom 1 to ~10^7): Standard fragment shader, fast, covers 90% of casual use.

2. **Tier 2 — Double-single emulation** (zoom ~10^7 to ~10^14): vec2-based emulated doubles in GLSL. ~4x slower but still real-time. Caveat: unreliable on some WebGL drivers due to compiler optimizations. Test across browsers.

3. **Tier 3 — Perturbation theory** (zoom beyond 10^14): CPU-side arbitrary precision reference orbit (use BigInt or a JS arbitrary precision lib like decimal.js), GPU-side float32 perturbation. This is the gold standard for deep zoom. Only ~3 browser implementations exist — significant competitive advantage.

### Architecture Recommendation

- **Fullscreen quad + fragment shader** for rendering (not compute shaders — fragment shaders are simpler, equally fast for 2D, and have better browser support)
- **WebGL2** as primary target (universal support), with optional **WebGPU** path for future
- **Uniform-based** zoom/center control (no MVP matrix)
- **Shader recompilation** when max iterations change (constant loop bounds)
- For perturbation: **Web Worker** for CPU reference orbit computation (non-blocking), pass orbit as texture or SSBO to GPU

### Key reference implementations to study:

1. **munrocket/deep-mandelbrot** — Best browser perturbation implementation
2. **grubertw/mandelbrot** — Best Rust/wgpu perturbation implementation (Scout Engine pattern)
3. **Thasler "Heavy computing with GLSL"** — Definitive double-single emulation reference
4. **Phil Thompson / Very Plotter** — BLA + series approximation in JS (CPU-only but algorithm reference)
5. **gpfault.net tutorial** — Clean WebGL Mandelbrot architecture reference

---

## Sources

- [munrocket/deep-mandelbrot](https://github.com/munrocket/deep-fractal)
- [JMaio/deep-fractal (fork)](https://github.com/JMaio/deep-fractal)
- [Ambrose Cavalier GPU Deep Zoom](https://ambrosecavalier.com/projects/gpu-deep-zoom/about/)
- [BenjaminAster/WebGPU-Mandelbrot](https://github.com/BenjaminAster/WebGPU-Mandelbrot)
- [LeandroSQ/js-mandelbrot](https://github.com/LeandroSQ/js-mandelbrot)
- [scttfrdmn/webgpu-compute-exploration](https://github.com/scttfrdmn/webgpu-compute-exploration)
- [paulrobello/par-fractal](https://github.com/paulrobello/par-fractal)
- [Shapur1234/Fractl](https://github.com/Shapur1234/Fractl)
- [grubertw/mandelbrot (Mandelbrot Scout)](https://github.com/grubertw/mandelbrot)
- [rosslh/Mandelbrot.site](https://github.com/rosslh/mandelbrot.site)
- [Greece4ever/Fractals-Explorer](https://github.com/Greece4ever/Fractals-Explorer)
- [jakobmollas/mandelbrot-shader-webgl](https://github.com/jakobmollas/mandelbrot-shader-webgl)
- [tobi18991/Fractex](https://github.com/tobi18991/Fractex)
- [sseemayer/ThreeJS-Fractal](https://github.com/sseemayer/ThreeJS-Fractal)
- [zz85/FractalLab](https://github.com/zz85/FractalLab)
- [Bewelge/Mandelbrot-Set-Render (gpu.js)](https://github.com/Bewelge/Mandelbrot-Set-Render)
- [ryanrossiter/fractaljs](https://github.com/ryanrossiter/fractaljs)
- [AkosSeres/mandelbrot-web](https://github.com/AkosSeres/mandelbrot-web)
- [gpu.js](https://github.com/gpujs/gpu.js)
- [philthompson/visualize-primes (Very Plotter)](https://github.com/philthompson/visualize-primes)
- [rust-fractal/rust-fractal-core](https://github.com/rust-fractal/rust-fractal-core)
- [gpfault.net — Rendering the Mandelbrot Set With WebGL](https://gpfault.net/posts/mandelbrot-webgl.txt.html)
- [Thasler — Heavy Computing with GLSL Part 2: Double-Single Emulation](https://blog.cyclemap.link/2011-06-09-glsl-part2-emu/)
- [Thasler — Heavy Computing with GLSL Part 5: Emulated Quad Precision](https://blog.cyclemap.link/2012-02-12-part5/)
- [Phil Thompson — Perturbation Theory and the Mandelbrot set](https://philthompson.me/2022/Perturbation-Theory-and-the-Mandelbrot-set.html)
- [Phil Thompson — Faster Mandelbrot Set Rendering with BLA](https://philthompson.me/2023/Faster-Mandelbrot-Set-Rendering-with-BLA-Bivariate-Linear-Approximation.html)
- [BVDART — Building an Interactive Fractal Explorer with WebGL](https://bvdart.nl/en/articles/building-an-interactive-fractal-explorer)
- [WebGPU f64 issue #2805](https://github.com/gpuweb/gpuweb/issues/2805)
- [Shadertoy — Mandelbrot Double Precision](https://www.shadertoy.com/view/mdf3WS)
- [10110111/QSMandel (quad-single GLSL fork)](https://github.com/10110111/QSMandel)
