# Competitive Analysis — Browser Fractal Explorers (March 2026)

## Tier S — Deep Zoom Leaders

### mandelbrot.page (davidbau)
- **URL**: https://mandelbrot.page/
- **Source**: https://github.com/davidbau/mandelbrot
- **Stack**: Pure JS + GPU (added 2025) + DD/QD precision
- **Zoom depth**: 10^-60+ (quad-double perturbation, added 2025)
- **Precision**: Double-Double (~30 digits), Quad-Double (~60 digits)
- **Coloring**: Histogram-based (uniform distribution), HCL color space
- **Unique**: Progressive infinite refinement (keeps improving while idle), video export, URL bookmarks
- **Weakness**: Mandelbrot only, no other fractals

### deep-mandelbrot (munrocket)
- **URL**: https://deep-mandelbrot.js.org/
- **Source**: https://github.com/munrocket/deep-fractal
- **Stars**: ~25
- **Stack**: WebGL + custom Jampary arbitrary precision library (JS)
- **Zoom depth**: 10^-31 (perturbation theory)
- **Precision**: Jampary (array of 4-5 doubles, ~60+ significant digits)
- **Coloring**: Cosine palette (Quilez), stripe average (Re·Im/|z|²), Catmull-Rom interpolation
- **Unique**: Logarithmic grid search (12x12) for optimal reference point, ping-pong rendering, adaptive supersampling via DE
- **Weakness**: Mandelbrot only, no mobile, no URL sharing

### Ambrose Cavalier GPU Deep Zoom
- **URL**: https://ambrosecavalier.com/projects/gpu-deep-zoom/about/
- **Stack**: WebGL + BigFloat (arbitrary precision float32 array)
- **Zoom depth**: 10^-238 (browser record)
- **Precision**: BigFloat — mantissa in float32 array, arbitrary length
- **Weakness**: Proof-of-concept, slow (~50ms), no coloring options

## Tier A — Quality Explorers

### fractals.top (David's Fractal Explorer v5)
- **URL**: https://fractals.top/
- **Stack**: WebGPU (primary) + WebGL (fallback), dual backend
- **Zoom depth**: Float64 (~10^-15)
- **Unique**: Custom fractal formulas, WebGPU with Vulkan/D3D12/Metal backends
- **Weakness**: No perturbation, limited to float64 zoom

### mandelbrot.site (rosslh)
- **URL**: https://mandelbrot.site/
- **Source**: https://github.com/rosslh/mandelbrot.site
- **Stars**: 277
- **Stack**: Rust/WASM + TypeScript + Leaflet.js (map-style tiles)
- **Zoom depth**: Float64
- **Unique**: Best UX (map-like tile rendering), shareable URLs, high-res export
- **Weakness**: No GPU rendering, no deep zoom beyond float64

### Very Plotter (philthompson)
- **URL**: via philthompson.me
- **Stack**: Browser-based, JS
- **Unique**: Series Approximation (BLA) in browser — one of very few
- **References**: https://philthompson.me/2022/Perturbation-Theory-and-the-Mandelbrot-set.html

## Tier B — Basic GPU Explorers

### Fractex (tobi18991)
- **URL**: https://tobi18991.github.io/Fractex/
- **Source**: https://github.com/tobi18991/Fractex
- **Stack**: WebGL
- **Zoom depth**: Float32 (~10^-7)

### Greece4ever/Fractals-Explorer
- **Source**: https://github.com/Greece4ever/Fractals-Explorer
- **Stack**: OpenGL, WebGL, OpenCL
- **Unique**: Multi-fractal (Mandelbrot, Julia, Newton, Tricorn, Burning Ship)

## Desktop Reference (non-browser)

### rust-fractal-core
- **Source**: https://github.com/rust-fractal/rust-fractal-core
- **Stack**: Rust + MPFR
- **Features**: Perturbation + Series Approximation + glitch detection + multi-reference
- **Represents**: Gold standard for what's possible with native code

### DeepDrill
- **Source**: https://github.com/dirkwhoffmann/DeepDrill
- **URL**: https://dirkwhoffmann.github.io/DeepDrill/
- **Stack**: C++ + perturbation + series approximation

---

## Feature Matrix

| Feature | mandelbrot.page | deep-mandelbrot | Ambrose | fractals.top | mandelbrot.site | **Fractalnaute** |
|---|---|---|---|---|---|---|
| GPU rendering | Yes (2025) | WebGL | WebGL | WebGPU/GL | No | **WebGL 2** |
| Perturbation | DD/QD | Jampary | BigFloat | No | No | **No (planned)** |
| Series Approx | No | No | No | No | No | No |
| Zoom depth | 10^-60+ | 10^-31 | 10^-238 | 10^-15 | 10^-15 | **10^-15 (DS)** |
| Multi-fractal | No | No | No | Custom | No | **5 types** |
| Coloring modes | Histogram | Cosine stripe | Basic | Basic | Basic | **5 modes** |
| SSAA toggle | No | DE-adaptive | No | No | No | **Yes** |
| Touch mobile | ? | No | No | ? | No | **Yes** |
| URL sharing | Yes | No | No | ? | Yes | **Yes** |
| Video export | Yes | No | No | No | No | No |
| Progressive | Infinite | No | No | No | No | FBO preview |

## Secret Recipes

### 1. Precision Ladder (mandelbrot.page)
Float64 → Double-Double → Quad-Double, switched dynamically based on zoom depth.
Each level doubles the significant digits. No single precision system — adaptive.

### 2. Jampary Arbitrary Precision (deep-mandelbrot)
Custom JS library: each number = array of 4-5 IEEE doubles.
Key insight: doubles as "digits" in a multi-word number. ~60+ significant digits.
No external dependency, no WASM.

### 3. Reference Point Selection (deep-mandelbrot)
12×12 logarithmic grid, 15 iterations of refinement.
Bad reference point = glitches everywhere. Good one = clean render.

### 4. Histogram Coloring (mandelbrot.page)
Count iterations across all pixels → build CDF → map colors uniformly.
Eliminates banding completely. Independent of max iterations.
Requires two-pass render (count then color).

### 5. Progressive Infinite Refinement (mandelbrot.page)
Starts at low max_iter, keeps doubling in background.
User sees instant result that gets better over time.
Combined with cycle detection for early termination.

---

## Key Research References

- Phil Thompson — [Perturbation Theory and the Mandelbrot set](https://philthompson.me/2022/Perturbation-Theory-and-the-Mandelbrot-set.html)
- Phil Thompson — [Faster Mandelbrot with BLA](https://philthompson.me/2022/Faster-Mandelbrot-Set-Rendering-with-BLA.html)
- Claude Heiland-Allen — [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html)
- Inigo Quilez — [Cosine palettes](https://iquilezles.org/articles/palettes/)
- Henry Thasler — [Heavy Computing with GLSL](https://blog.cyclemap.link/2011-06-09-glsl-part2-emu/)
- deck.gl — [64-bit Layers (DS emulation)](https://deck.gl/docs/developer-guide/fp64)
- Wikibooks — [Fractals/perturbation](https://en.wikibooks.org/wiki/Fractals/perturbation)
