# Perturbation Theory — Deep Zoom to 10^-∞ — Design Spec

**Date**: 2026-03-26
**Scope**: Rust/WASM arbitrary precision + GPU perturbation rendering + glitch detection + BLA + progressive orbit
**Prerequisite**: GPU v3 done (all 25 fractal×coloring combos), DS emulation (zoom 10^-15), SSAA, URL state, touch mobile
**Target**: Unlimited zoom depth (10^-60+ v1, 10^-∞ with sufficient patience)
**Fractals**: Mandelbrot + Julia (documented limitation for BurningShip/Tricorn/Multibrot)

---

## 1. Problem Statement

The current double-single (DS) emulation extends GPU float32 precision to ~15 decimal digits, enabling zoom to ~10^-15. Beyond this, all pixels collapse to the same coordinate — the "float precision wall."

Perturbation theory bypasses this wall entirely: instead of computing each pixel in high precision, compute ONE reference orbit at arbitrary precision on CPU, then compute each pixel's small delta from that reference on GPU in float32. The delta stays small (a few pixels of offset), so float32 always suffices regardless of zoom depth.

### Why this matters

- **User blocker**: the float32 wall is the #1 limitation hit in real usage
- **Competitive gap**: deep-mandelbrot (10^-31), mandelbrot.page (10^-60+), Ambrose (10^-238) all have perturbation. We don't.
- **Visual quality**: the most interesting fractal structures (mini-Mandelbrots, Misiurewicz points) live at deep zoom

---

## 2. Architecture Overview

```
┌─────────────────────────────────┐        ┌──────────────────────────────────┐
│         Rust / WASM             │        │          GPU WebGL 2             │
│                                 │        │                                  │
│  astro-float (arbitrary prec.)  │        │  Perturbation shader (GLSL)     │
│  Reference orbit computation    │──F32──→│  Delta iteration (float32)      │
│  Reference point selection      │  tex   │  Coloring (5 modes, existing)   │
│  Series Approximation (BLA)     │        │  Glitch flag output (MRT)       │
│  Glitch analysis (read flags)   │←─F32──│  SSAA (existing)                │
│  Progressive orbit streaming    │  tex   │                                  │
└─────────────────────────────────┘        └──────────────────────────────────┘
```

### Data flow

1. **User zooms** → viewport update with `scale < 10^-13` triggers perturbation path
2. **Reference point selection** (Rust/WASM, parallelized via Web Workers): logarithmic grid search finds the point that iterates longest before escaping
3. **Reference orbit** (Rust/WASM, single thread, sequential): computes full orbit `[x, y, dx, dy]` at arbitrary precision using `astro-float`, stores into `Float32Array`
4. **Orbit upload** (JS→GPU): `Float32Array` → `gl.FLOAT` 2D texture, `NEAREST` filtering. Each orbit entry = 1 RGBA texel `[x, y, dx, dy]`. Texture size = `ceil(sqrt(orbitLength))²`
5. **GPU perturbation render**: fragment shader reads orbit from texture, computes delta iteration per pixel, applies existing coloring pipeline
6. **Glitch detection** (GPU MRT output → CPU read): second render target flags pixels where `|δ| > |R|`. CPU reads flags, selects new reference for glitched regions, re-renders those regions.
7. **Progressive orbit** (optional): partial orbit renders intermediate result while full orbit computation continues

### Precision switching (automatic, invisible to user)

| Zoom depth (scale) | Rendering path | Precision |
|---|---|---|
| > 10^-7 | GPU float32 (existing) | ~7 digits |
| 10^-7 → 10^-13 | GPU DS (existing) | ~15 digits |
| < 10^-13 | **GPU perturbation** (new) | Unlimited (auto-scaled) |

The switch is transparent — the user zooms and it just works. The `assembleFragmentSource` function selects the appropriate iteration chunk based on zoom depth.

### Precision auto-scaling

The `astro-float` precision adapts to zoom depth:
```
bits = ceil(log2(1/scale)) + 64
```
The +64 margin ensures no precision loss in intermediate computations. At zoom 10^-40, this gives ~197 bits (~59 digits). At zoom 10^-100, ~396 bits (~119 digits).

---

## 3. Rust/WASM Module

### 3.1 Crate structure

```
wasm/
├── Cargo.toml
├── src/
│   ├── lib.rs              # WASM entry points (wasm-bindgen)
│   ├── precision.rs        # astro-float wrappers, precision auto-scaling
│   ├── orbit.rs            # Reference orbit computation
│   ├── reference.rs        # Reference point selection (grid search)
│   ├── bla.rs              # Series Approximation (BLA)
│   └── glitch.rs           # Glitch analysis (read flag texture, pick new refs)
```

### 3.2 Dependency: `astro-float`

- **Crate**: `astro-float` (pure Rust, no C dependencies, WASM-compatible)
- **Why not MPFR**: GMP/MPFR are C libraries that don't compile to WASM natively
- **Why not our own FP expansion**: `astro-float` uses optimized algorithms (Karatsuba for large N), is battle-tested, has no precision ceiling
- **Precision**: configurable at runtime, auto-scaled to zoom depth

### 3.3 Quality standards (ISO 5055 equivalent)

- `#![deny(clippy::all, clippy::pedantic)]` — zero warnings
- `#![forbid(unsafe_code)]` — no unsafe unless justified and documented
- Cognitive complexity limits via Clippy
- `cargo audit` in CI
- `cargo test` with unit tests covering precision edge cases (cancellation, overflow, underflow)
- `#[wasm_bindgen]` only on public API functions (thin layer principle)

### 3.4 WASM bridge (thin layer)

```rust
#[wasm_bindgen]
pub fn compute_reference_orbit(
    center_re: &str,   // decimal string (JS can't pass >f64)
    center_im: &str,
    max_iter: u32,
    precision_bits: u32,
) -> Float32Array {
    // Returns flat [x0, y0, dx0, dy0, x1, y1, dx1, dy1, ...]
    // Each value downcast to f32 for GPU texture upload
}

#[wasm_bindgen]
pub fn find_reference_point(
    center_re: &str,
    center_im: &str,
    scale: &str,
    max_iter: u32,
    precision_bits: u32,
    grid_size: u32,       // default 12
    refinements: u32,     // default 15
) -> Box<[u8]> {
    // Returns best reference point as decimal string pair
}

#[wasm_bindgen]
pub fn compute_bla_coefficients(
    orbit: &Float32Array,
    orbit_length: u32,
) -> Float32Array {
    // Returns BLA coefficient array for the GPU
}
```

**String-based coordinate passing**: JavaScript `number` is float64 (~15 digits). For coordinates at zoom 10^-40, we need 40+ digits. The WASM bridge accepts decimal strings and parses them into `astro-float` BigFloat internally.

### 3.5 Reference orbit computation

The orbit is the sequence `Z_0, Z_1, Z_2, ...` where `Z_{n+1} = Z_n² + C` at the reference point C.

```rust
fn compute_orbit(c_re: &BigFloat, c_im: &BigFloat, max_iter: u32, prec: usize)
    -> Vec<[f32; 4]>  // [x, y, dx, dy] per iteration
{
    let mut z_re = BigFloat::zero(prec);
    let mut z_im = BigFloat::zero(prec);
    let mut dz_re = BigFloat::zero(prec);
    let mut dz_im = BigFloat::zero(prec);
    let mut orbit = Vec::with_capacity(max_iter as usize);

    for _ in 0..max_iter {
        // Store as f32 for GPU
        orbit.push([
            z_re.to_f32(), z_im.to_f32(),
            dz_re.to_f32(), dz_im.to_f32(),
        ]);

        // dz = 2·z·dz + 1
        let dz_re_new = 2.0*(z_re*dz_re - z_im*dz_im) + 1.0;
        let dz_im_new = 2.0*(z_re*dz_im + z_im*dz_re);
        dz_re = dz_re_new;
        dz_im = dz_im_new;

        // z = z² + c
        let z_re_new = z_re*z_re - z_im*z_im + c_re;
        let z_im_new = 2.0*z_re*z_im + c_im;
        z_re = z_re_new;
        z_im = z_im_new;

        // Escape check
        if z_re.to_f64()*z_re.to_f64() + z_im.to_f64()*z_im.to_f64() > BAILOUT_SQ {
            break;
        }
    }
    orbit
}
```

### 3.6 Reference point selection

Logarithmic grid search, matching deep-mandelbrot's `searchOrigin()`:

1. Start with a `grid_size × grid_size` grid (default 12×12) centered on the viewport
2. For each grid point, iterate Mandelbrot and record escape iteration count
3. Select the region around the point with the highest iteration count
4. Subdivide that region and repeat (default 15 refinements)
5. Return the point that iterates the longest before escaping

This is **parallelizable**: each grid point is independent. Multiple Web Workers can each instantiate the WASM module and test a subset of grid points.

### 3.7 Series Approximation (BLA — Bilinear Approximation)

BLA skips large chunks of iterations by approximating the perturbation recurrence with a linear map:

```
δ_{n+k} ≈ A_k · δ_n + B_k
```

Where `A_k` and `B_k` are precomputed from the reference orbit. This reduces per-pixel iteration count from `maxIter` to `O(log(maxIter))` for pixels far from the boundary.

**Implementation**: precompute `(A_k, B_k)` coefficients in Rust from the reference orbit, upload as a second texture, apply in the GPU shader before falling back to per-iteration delta computation.

**Reference**: Phil Thompson — "Faster Mandelbrot Set Rendering with BLA" (philthompson.me)

---

## 4. GPU Perturbation Shader

### 4.1 New GLSL chunks

**`perturbationHeaderChunk`**: uniforms for orbit texture and metadata
```glsl
uniform sampler2D u_orbitTexture;   // float texture, RGBA32F
uniform int u_orbitLength;          // number of iterations in orbit
uniform vec2 u_orbitTexSize;        // texture dimensions for index→UV conversion
uniform vec2 u_refPoint;            // reference point (f32 hi parts, for delta computation)
uniform vec2 u_refPointLo;         // reference point (f32 lo parts, DS precision)
```

**`orbitLookupChunk`**: reads orbit data from texture
```glsl
vec4 getOrbitData(int iter) {
    // Orbit packed as [x, y, dx, dy] per texel
    int texIdx = iter;
    int texW = int(u_orbitTexSize.x);
    ivec2 coord = ivec2(texIdx % texW, texIdx / texW);
    return texelFetch(u_orbitTexture, coord, 0);  // NEAREST, no filtering
}
```

**`mandelbrotPerturbationChunk`**: perturbation iteration
```glsl
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
    // Delta from reference point (pixel coord - ref, in complex plane)
    // Uses DS precision for the initial delta computation
    vec2 ds_re, ds_im;
    screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
    float u = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
    float v = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

    z = vec2(0.0);
    vec2 dz = vec2(0.0);
    iter = 0; escaped = false; smoothVal = 0.0;
    float du = 0.0, dv = 0.0;  // perturbation derivative

    for (int i = 0; i < MAX_ITER; i++) {
        if (i >= u_orbitLength) break;  // orbit exhausted

        vec4 orbitData = getOrbitData(i);
        vec2 O = orbitData.xy;    // reference position
        vec2 dO = orbitData.zw;   // reference derivative

        // Full position = reference + delta
        z = O + vec2(u, v);
        float zz = z.x * z.x + z.y * z.y;

        if (zz > BAILOUT_SQ) {
            escaped = true; iter = i;
            smoothVal = smoothEscape(i, zz);
            return;
        }

        // Glitch check: |delta|² > |reference|² → flag for MRT
        // (written to glitchFlag output in main)

        // Perturbation derivative:
        // dz_new = 2*(dO·δdz + z·dz_delta)
        float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
        dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
        du = temp_du;
        dz = vec2(du, dv) + dO;

        // Perturbation iteration:
        // δ_new = 2·R·δ + δ² + δc
        float temp_u = u*u - v*v + 2.0*(u*O.x - v*O.y);
        v = 2.0*u*v + 2.0*(v*O.x + u*O.y);
        u = temp_u;
        // Add δc (= pixel_c - ref_c, which is the initial u,v)
        u += ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
        v += ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

        updateAccumulator(z, dz, acc);
    }

    iter = MAX_ITER;
}
```

**Note**: the `δc` addition at each iteration is the initial delta (pixel - reference in complex plane). This is constant per pixel, so it should be cached as a local variable, not recomputed each iteration. The code above is conceptual — the implementation will optimize this.

### 4.2 Julia perturbation variant

For Julia sets, the perturbation recurrence is the same (`δ_{n+1} = 2·R_n·δ_n + δ_n²`) but:
- `c` is a constant (not per-pixel), so `δc = 0` — no per-iteration δc addition
- `δ_0 = pixel - ref` (initial delta is the coordinate difference)
- The reference orbit uses `c = juliaC` (uniform), not `c = refPoint`

This means a separate `juliaPerturbationChunk` with the same structure but no δc term.

### 4.3 MRT glitch detection output

Provisioned from step 5 (shader creation), activated at step 8 (glitch pipeline).

```glsl
// In headerChunk extension:
layout(location = 0) out vec4 fragColor;
layout(location = 1) out float glitchFlag;

// In iterate(), after computing z:
float deltaSq = u*u + v*v;
float refSq = O.x*O.x + O.y*O.y;
// Flag if delta magnitude exceeds reference magnitude
glitchFlag = step(refSq, deltaSq);  // 1.0 = glitch, 0.0 = ok
```

The FBO is configured with `gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])` — one RGBA8 for color, one R8 for glitch flags.

### 4.4 Orbit texture format

| Property | Value |
|---|---|
| Internal format | `gl.RGBA32F` |
| Format | `gl.RGBA` |
| Type | `gl.FLOAT` |
| Filtering | `gl.NEAREST` (no interpolation between orbit steps) |
| Wrap | `gl.CLAMP_TO_EDGE` |
| Layout | `[x, y, dx, dy]` per texel, row-major |
| Size | `ceil(sqrt(orbitLength))` × `ceil(orbitLength / width)` |

Requires `EXT_color_buffer_float` extension (widely supported on WebGL 2).

### 4.5 Shader assembly integration

`assembleFragmentSource` gains a new code path:

```typescript
// Precision switching logic
const usePerturbation = fractal === 'mandelbrot' && zoomDepth > 1e13;
const useDS = fractal === 'mandelbrot' && !usePerturbation;

const iteration = usePerturbation
    ? mandelbrotPerturbationChunk
    : useDS ? mandelbrotDSIterationChunk
    : getIterationChunk(fractal);
```

The `ShaderKey` type extends to include the precision mode:
```typescript
type ShaderKey = `${FractalType}_${ColoringMode}_${number}_${boolean}_${'f32'|'ds'|'perturbation'}`;
```

---

## 5. Orbit Texture Upload

### 5.1 CPU → GPU bridge

```typescript
function uploadOrbitTexture(
    gl: WebGL2RenderingContext,
    orbitData: Float32Array,  // from WASM: [x,y,dx,dy, x,y,dx,dy, ...]
    orbitLength: number
): WebGLTexture {
    const texWidth = Math.ceil(Math.sqrt(orbitLength));
    const texHeight = Math.ceil(orbitLength / texWidth);

    // Pad to fill texture rectangle
    const padded = new Float32Array(texWidth * texHeight * 4);
    padded.set(orbitData);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F,
                  texWidth, texHeight, 0,
                  gl.RGBA, gl.FLOAT, padded);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return tex;
}
```

### 5.2 Texture binding

The orbit texture binds to `TEXTURE1` (palette is on `TEXTURE0`).

---

## 6. Integration into Rendering Pipeline

### 6.1 Renderer facade extension

The existing `renderer.ts` facade gains a perturbation path:

```
User zooms → viewport.scale < PERTURBATION_THRESHOLD
  → WASM: find_reference_point() [Workers, parallel]
  → WASM: compute_reference_orbit() [single thread, sequential]
  → GPU: upload orbit texture
  → GPU: render with mandelbrotPerturbationChunk
  → GPU: read glitch flags (if MRT active)
  → WASM: analyze glitches, pick new references
  → GPU: re-render glitched regions
```

### 6.2 Coordinate handling at extreme zoom

At zoom 10^-40, viewport coordinates have 40+ significant digits. JavaScript `number` (float64) only has 15. Coordinates must be stored and transmitted as **decimal strings** beyond the DS threshold.

```typescript
interface DeepViewport extends Viewport {
    // String representation for arbitrary precision
    centerReStr: string;   // e.g. "-0.7436438885706986854578163655..."
    centerImStr: string;
    scaleStr: string;
}
```

URL state encoding at deep zoom: base64-encoded decimal strings in the hash.

### 6.3 WASM loading

```typescript
// Next.js dynamic import of WASM module
const wasmModule = await import('../wasm/pkg/fractalnaute_wasm');
await wasmModule.default();  // init WASM
```

Next.js config: `webpack.experiments.asyncWebAssembly = true` or manual `.wasm` file serving.

---

## 7. Fractal Coverage & Limitations

### 7.1 Supported fractals

| Fractal | Perturbation support | Justification |
|---|---|---|
| **Mandelbrot** | Full | Standard perturbation theory (K.I. Martin, 2013) |
| **Julia** | Full | Same recurrence, δc = 0, well-established |
| **BurningShip** | Not supported | Non-holomorphic (abs before squaring). Perturbation requires specialized techniques (ABS variation). Research-level, uncertain quality. |
| **Tricorn** | Not supported | Anti-holomorphic (conjugation). Perturbation breaks smoothness assumptions. |
| **Multibrot** | Not supported | Higher-order derivatives make perturbation numerically unstable for n>2. |

### 7.2 Fallback behavior

Unsupported fractals at deep zoom (scale < 10^-13) continue to use DS emulation (zoom 10^-15 max). The UI should indicate when the user has reached the precision limit for these fractals.

### 7.3 Future work

BurningShip perturbation is possible with the "ABS variation" technique (Claude Heiland-Allen, mathr.co.uk). Tricorn perturbation exists in some desktop implementations. These can be added as separate efforts without architectural changes — the WASM module and orbit texture pipeline are fractal-agnostic.

---

## 8. ISO Compliance

### 8.1 IEEE 754-2019

The entire perturbation pipeline depends on IEEE 754 guarantees:
- **twoSum/twoProd correctness** relies on IEEE 754 round-to-nearest-even
- **`astro-float`** is built on IEEE 754 floating-point semantics
- **GPU float32** follows IEEE 754 for basic operations (add, mul, div) per OpenGL ES 3.0 spec
- **Document**: any deviation from IEEE 754 in WebGL implementations is a known risk (some mobile GPUs). Mitigated by the glitch detection system.

### 8.2 ISO 25010 — Quality model validation

| Characteristic | How addressed |
|---|---|
| **Functional suitability** | Zoom to 10^-60+ (exceeds all browser competitors except Ambrose POC) |
| **Performance efficiency** | GPU delta iteration (<1ms), WASM orbit computation (~50-200ms for 10K iter) |
| **Compatibility** | WebGL 2 + WASM required; fallback to DS/float32 for unsupported browsers |
| **Usability** | Automatic precision switching, no user configuration needed |
| **Reliability** | Glitch detection + re-render ensures correct output |
| **Security** | No unsafe Rust, cargo audit, CSP headers for WASM, COOP/COEP maintained |
| **Maintainability** | SRP (Rust precision ↔ GPU render ↔ JS orchestration), DRY (@mirror tags) |
| **Portability** | WASM = cross-platform, same binary on all OS/browsers |

### 8.3 ISO 9241-110 — Interaction ergonomics

| Principle | Implementation |
|---|---|
| **Controllability** | User can cancel orbit computation (Atomics flag), zoom out returns to fast path instantly |
| **Error tolerance** | Glitch detection auto-corrects; GPU fallback to CPU if WebGL fails |
| **Conformity to expectations** | Zoom "just works" deeper — no mode switches, no dialogs, no settings |
| **Self-descriptiveness** | InfoPanel shows precision mode (DS/Perturbation), orbit computation progress |

### 8.4 ISO 80000-2 — Mathematical notation

All formulas in code comments and documentation use standard notation:
- `z_{n+1} = z_n² + c` (Mandelbrot recurrence)
- `δ_{n+1} = 2·R_n·δ_n + δ_n²` (perturbation recurrence)
- `d ≈ |z|·log|z| / |z'|` (Hubbard-Douady distance estimate)
- Greek letters for perturbation variables: δ (delta), ε (epsilon for glitch threshold)

---

## 9. Testing Strategy

### 9.1 Rust unit tests (`cargo test`)

- Precision arithmetic: verify `twoSum`, `twoProd` error-free properties
- Orbit computation: compare with known orbits at specific coordinates
- Reference point selection: verify convergence on known deep zoom locations
- BLA coefficients: verify approximation error bounds

### 9.2 TypeScript unit tests (`npm test`)

- Shader assembly: `assembleFragmentSource` with perturbation mode produces valid GLSL
- Orbit texture upload: correct dimensions, padding, format
- Precision switching: correct threshold logic
- Coordinate string handling: encode/decode round-trip

### 9.3 GPU parity tests

- **Overlap zone** (10^-12 to 10^-14): DS and perturbation should produce identical output. Pixel-diff test.
- **Known deep zoom coordinates**: compare with deep-mandelbrot screenshots at documented locations

### 9.4 Playwright benchmarks

- Orbit computation time at various zoom depths (10^-20, 10^-40, 10^-60)
- Total render time (orbit + GPU) at various zoom depths
- Glitch detection pass time
- Progressive orbit: time to first visual

---

## 10. Development Steps

| # | Step | Deliverable | Test |
|---|---|---|---|
| 1 | Rust toolchain + WASM bridge | wasm-pack, Next.js loader, TS types | `add(a,b)` callable from browser |
| 2 | astro-float precision lib | Wrapper with auto-scaling, basic arithmetic | Rust unit tests: 60+ digit precision verified |
| 3 | Reference orbit computation | `compute_reference_orbit()` → `Float32Array` | Orbit at zoom 10^-40 matches known values |
| 4 | Reference point selection | `find_reference_point()` with grid search | Finds point with >90% maxIter convergence |
| 5 | GPU perturbation shader | `mandelbrotPerturbationChunk` + MRT output provisioned | Renders identically to DS at zoom 10^-13 (overlap zone) |
| 6 | Pipeline integration | Selection → orbit → texture → shader → render | First deep zoom 10^-40 functional |
| 7 | Julia perturbation | `juliaPerturbationChunk` (δc = 0 variant) | Deep zoom Julia at 10^-40 |
| 8 | Glitch detection pipeline | MRT read → new reference → partial re-render | No artefacts on mini-Mandelbrot satellites |
| 9 | Series Approximation (BLA) | Iteration skip via precomputed coefficients | Benchmark: 10x+ speedup on deep zoom |
| 10 | Progressive orbit | Partial render during computation + re-render on complete | Result visible in <200ms at zoom 10^-60 |

---

## 11. Performance Expectations

| Metric | DS (current) | Perturbation (target) |
|---|---|---|
| Max zoom | 10^-15 | **10^-60+** (unlimited) |
| GPU render time @256iter | 0.03ms | ~0.05ms (orbit texture fetch overhead) |
| GPU render time @10Kiter | — | ~1ms |
| Orbit computation (10K iter, 10^-40) | — | ~100-200ms (WASM) |
| Orbit computation (100K iter, 10^-60) | — | ~2-5s (WASM) |
| With BLA (100K nominal → ~5K actual) | — | ~200-500ms |
| Reference point selection | — | ~50ms (parallel Workers) |

### Competitive positioning after implementation

| Feature | mandelbrot.page | deep-mandelbrot | Ambrose | **Fractalnaute** |
|---|---|---|---|---|
| Zoom depth | 10^-60+ | 10^-31 | 10^-238 | **10^-60+ (v1)** |
| Multi-fractal deep zoom | No | No | No | **Mandelbrot + Julia** |
| GPU rendering | Yes | WebGL 1 | WebGL | **WebGL 2** |
| Coloring modes (deep) | Histogram | Cosine stripe | Basic | **5 modes** |
| BLA/Series Approx | No | No | No | **Yes** |
| Glitch detection | ? | No | No | **Yes (GPU MRT)** |
| Touch mobile | ? | No | No | **Yes** |
| SSAA | No | DE-adaptive | No | **2x2 toggle** |

---

## 12. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `astro-float` WASM compilation issues | Blocks step 1 | Fallback: `dashu` crate, or handwritten FP expansion in Rust |
| WASM binary size too large | Slow initial load | Tree-shaking, wasm-opt -O3, lazy loading (only fetch when zoom > threshold) |
| `EXT_color_buffer_float` not available | No orbit texture | Fallback: encode orbit as RGBA8 with manual float→byte packing (4 bytes per float) |
| Orbit computation >5s at extreme zoom | Poor UX | Progressive orbit (step 10), spinner with cancel button |
| Glitch artefacts not fully eliminated | Visual quality | Multi-reference (re-render glitched regions with new reference, iterate until clean) |
| Next.js WASM loading complexity | Build issues | Manual `.wasm` file in `public/`, loaded via `fetch()` + `WebAssembly.instantiateStreaming()` |

---

## 13. Academic References

1. K.I. Martin — "Superfractalthing math" (perturbation theory for Mandelbrot)
2. Phil Thompson — "Perturbation Theory and the Mandelbrot set" (philthompson.me/2022)
3. Phil Thompson — "Faster Mandelbrot with BLA" (philthompson.me/2022)
4. Claude Heiland-Allen — "Deep zoom theory and practice" (mathr.co.uk/blog/2021-05-14)
5. Joldes, Marty, Muller & Popescu (2015) — "Arithmetic algorithms for extended precision using floating-point expansions"
6. Linas Vepstas — "Renormalized iteration count" (smooth coloring)
7. Inigo Quilez — "Cosine palettes" (iquilezles.org)
8. Claude Heiland-Allen — "Adaptive super-sampling using distance estimate"
