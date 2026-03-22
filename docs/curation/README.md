# Curated Fractal Explorers — Hands-On Evaluation

> Evaluated 2026-03-22 via Playwright. Screenshots in this directory.

## Tier S — Must-Study

### 1. DeepMandelbrot (munrocket)
- **URL**: https://deep-mandelbrot.js.org/
- **Screenshot**: [01-deep-mandelbrot.png](01-deep-mandelbrot.png)
- **Tech**: WebGL + Svelte + perturbation theory (Jampary arbitrary precision)
- **UX**: Immersive fullscreen, instant GPU render, supersampling toggle
- **Coloring**: Exceptional — smooth shading with metallic/copper tones, light-like reflections on set interior
- **Deep zoom**: Yes (perturbation theory), zoom to 10^-31
- **What to steal**: Perturbation theory implementation, coloring algorithms, ping-pong rendering
- **Weakness**: Mandelbrot only, minimal UI controls
- **Rating**: 9/10

### 2. Mandelbrot.site (rosslh)
- **URL**: https://mandelbrot.site
- **Screenshot**: [02-mandelbrot-site.png](02-mandelbrot-site.png)
- **Tech**: Rust + WASM + Leaflet.js tiles (no GPU!)
- **UX**: Best-in-class — shareable URLs, rich sidebar, 34 color palettes (d3-chromatic), Okhsl/LCh color adjustment, high-res export, keyboard shortcuts
- **Coloring**: d3-chromatic palettes with palette range slider — extremely flexible
- **Deep zoom**: f64 via WASM (~10^-15), no perturbation
- **What to steal**: UX patterns, color palette system with range adjustment, shareable URLs, multibrot exponent control
- **Weakness**: CPU-only (no GPU), slow at high zoom/iterations
- **Stars**: 277 (most popular browser Mandelbrot)
- **Rating**: 8/10 (UX) / 5/10 (perf)

## Tier A — Worth Studying

### 3. WebGPU Mandelbrot (BenjaminAster)
- **URL**: https://benjaminaster.com/webgpu-mandelbrot/
- **Screenshot**: [03-webgpu-mandelbrot.png](03-webgpu-mandelbrot.png)
- **Tech**: WebGPU + WGSL, zero dependencies
- **UX**: Minimal — slider + checkbox only. Clean fullscreen render.
- **Coloring**: Sinusoidal RGB, decent but basic
- **Deep zoom**: float32 only, "fixed point numbers" checkbox for extended precision
- **What to steal**: Minimal WebGPU boilerplate reference, fixed-point approach
- **Weakness**: Mandelbrot only, basic coloring, requires WebGPU browser
- **Rating**: 7/10 (tech) / 5/10 (UX)

### 4. BVDART Fractal Explorer
- **URL**: https://bvdart.nl/en/lab/fractals
- **Screenshot**: [05-bvdart-fractal-lab.png](05-bvdart-fractal-lab.png)
- **Tech**: WebGL fragment shader + OKLCH coloring + perturbation theory
- **UX**: Retro OS-style windowed UI. Mandelbrot, Julia, Burning Ship, Tricorn. Same fractal set as ours!
- **Coloring**: OKLCH color space (same as us), orbit-trap coloring
- **Deep zoom**: Perturbation theory mentioned in article, unclear depth
- **What to steal**: OKLCH coloring in GLSL, orbit-trap technique, Julia set click-to-generate UX
- **Weakness**: Embedded in a larger site, small canvas, cookie banner overlay
- **Rating**: 7/10

## Tier B — Reference Only

### 5. Fractals Explorer (Greece4ever)
- **URL**: https://greece4ever.github.io/Fractals-Explorer/
- **Screenshot**: [04-fractals-explorer.png](04-fractals-explorer.png)
- **Tech**: WebGL2 + GLSL, triple implementation (WebGL/OpenGL/OpenCL)
- **UX**: FPS counter (61fps!), console/shader code viewer, developer-oriented. Shows WebGL2 version info.
- **Coloring**: Purple/neon palette, radial glow effect
- **Deep zoom**: float32 only
- **What to steal**: FPS counter UX, shader code live viewer, multi-backend architecture pattern
- **Weakness**: 2021 (stale), limited fractal types, small render area
- **Rating**: 6/10

### 6. Very Plotter (Phil Thompson)
- **URL**: https://philthompson.me/very-plotter/
- **Screenshot**: [06-very-plotter.png](06-very-plotter.png)
- **Tech**: Pure JS, CPU-only, Web Workers, BigInt arbitrary precision
- **UX**: Minimal fullscreen. Progressive rendering visible in logs (width 32 → 16 → 8 → 4 → 2 → 1). Smooth coloring.
- **Coloring**: Gradient-based, smooth
- **Deep zoom**: Beyond 10^-300 via BigInt (!) — deepest browser implementation
- **What to steal**: BLA (Bilinear Approximation) algorithm, series approximation, progressive rendering strategy
- **Weakness**: CPU-only = slow, minimal UI
- **Rating**: 5/10 (UX) / 10/10 (algorithm depth)

---

## Competitive Positioning — Our Fractal Explorer

| Feature | Us | DeepMandelbrot | Mandelbrot.site | BVDART |
|---|---|---|---|---|
| **Fractal types** | 5 (Mandelbrot, Julia, BurningShip, Tricorn, Multibrot) | 1 (Mandelbrot) | 2 (Mandelbrot, Multibrot) | 4 (Mandelbrot, Julia, BurningShip, Tricorn) |
| **GPU rendering** | No (CPU Workers) | Yes (WebGL) | No (WASM) | Yes (WebGL) |
| **Color space** | OKLCH | sRGB | LCh/Okhsl selectable | OKLCH |
| **Palettes** | 9 | ~3 | 34 | ~4 |
| **Progressive render** | Yes (stride-based) | Yes (ping-pong) | Yes (tile-based) | Yes |
| **Instant feedback** | Yes (CSS transform) | Yes (GPU native) | No | Likely yes |
| **Deep zoom** | float64 (JS, ~10^-15) | Perturbation (10^-31) | f64 WASM (~10^-15) | Perturbation |
| **Adaptive iteration** | Yes (cardioid + Brent) | Unknown | Rectangle checking | Unknown |
| **Export** | PNG | No | PNG | Unknown |
| **Shareable URLs** | No | No | Yes | No |
| **Design** | Glass/Cosmos theme | Fullscreen immersive | Functional sidebar | Retro OS |

### Our advantages
- Most fractal types (5)
- OKLCH native (industry-leading color science)
- Adaptive iteration (cardioid + Brent's periodicity)
- CSS transform instant feedback (unique approach)

### Our gaps (to close with GPU v4)
- No GPU rendering (biggest gap — 10-60x perf difference)
- No perturbation theory (limits deep zoom to 10^-15)
- Fewer palettes than Mandelbrot.site
- No shareable URLs

---

## Key Takeaways for GPU v4

1. **DeepMandelbrot is the gold standard** for browser perturbation theory. Study its Jampary lib and shader architecture.
2. **BVDART proves OKLCH works in GLSL** — we can port our color system to the GPU without compromising color science.
3. **Mandelbrot.site proves UX wins users** (277 stars) even without GPU performance. UX investment pays off.
4. **Very Plotter's BLA algorithm** is the most advanced iteration optimization in browsers — worth studying for deep zoom.
5. **WebGPU is viable** (BenjaminAster's demo works) but float32-only and 70% browser support — not ready for primary target.
