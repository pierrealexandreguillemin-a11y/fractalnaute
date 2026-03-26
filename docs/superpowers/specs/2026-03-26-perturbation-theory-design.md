# Perturbation Theory — Deep Zoom to 10^-∞ — Design Spec

**Date**: 2026-03-26 (rev. 2026-03-27 — audit formules + ISO)
**Scope**: Rust/WASM arbitrary precision + GPU perturbation rendering + rebasing + SA + progressive orbit
**Prerequisite**: GPU v3 done (all 25 fractal×coloring combos), DS emulation (zoom 10^-15), SSAA, URL state, touch mobile
**Target**: Unlimited zoom depth (10^-60+ v1, 10^-∞ with sufficient patience)
**Fractals**: Mandelbrot + Julia (documented limitation for BurningShip/Tricorn/Multibrot)

---

## 0. Glossary (ISO 80000-2)

| Symbol | GLSL name | Meaning |
|---|---|---|
| `Z_n` | `O` | Reference orbit position at iteration n (high precision, from texture) |
| `δ_n` | `u + iv` | Perturbation delta: pixel position minus reference (`Re(δ) = u`, `Im(δ) = v`) |
| `z_n` | `z` | Full pixel position: `z_n = Z_n + δ_n` |
| `δc` | `dc_re, dc_im` | Initial delta (constant per pixel): `c_pixel - c_ref` |
| `Z'_n` | `dO` | Reference orbit derivative at iteration n |
| `δ'_n` | `du + idv` | Perturbation derivative delta |
| `G` | `GLITCH_THRESHOLD` | Glitch detection sensitivity, ∈ [10^-8, 10^-2]. Empirical (Heiland-Allen). |
| `S` | `rescale_s` | Rescaling factor for range extension when `δ` underflows |
| `scale` | `u_scale` | Viewport height in complex-plane units. "Zoom 10^-40" means `scale = 10^-40`. |

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
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│          Rust / WASM             │        │          GPU WebGL 2             │
│                                  │        │                                  │
│  astro-float (arbitrary prec.)   │        │  Perturbation shader (GLSL)     │
│  Reference orbit computation     │──F32──→│  Delta iteration (float32)      │
│  Series Approximation (SA)       │  tex   │  Rebasing (Zhuoran 2021)        │
│  Progressive orbit streaming     │        │  Rescaling (range extension)    │
│                                  │        │  Coloring (5 modes, existing)   │
│                                  │        │  SSAA (existing)                │
└──────────────────────────────────┘        └──────────────────────────────────┘
```

### Key insight: rebasing replaces multi-reference

Classical perturbation (pre-2021) required multiple reference points and complex glitch detection/re-rendering pipelines. **Rebasing** (Zhuoran, 2021; documented by Phil Thompson) eliminates this entirely:

- **One reference point suffices** (the zoom target — mouse/touch pointer position)
- When `|z|² < G·|Z|²` (delta has grown too large relative to reference), **reset** `δ = z` and restart from iteration 0 of the same orbit
- No multi-reference, no MRT glitch flags, no partial re-rendering
- Simpler architecture, fewer GPU resources, same correctness

### Data flow

1. **User zooms** → viewport update with `scale < 10^-13` triggers perturbation path
2. **Reference point**: the zoom target (mouse/touch pointer position in complex plane). No grid search needed.
3. **Reference orbit** (Rust/WASM, single thread, sequential): computes full orbit `[x, y, dx, dy]` at arbitrary precision using `astro-float`, stores into `Float32Array`
4. **Orbit upload** (JS→GPU): `Float32Array` → `gl.FLOAT` 2D texture, `NEAREST` filtering. Each orbit entry = 1 RGBA texel `[x, y, dx, dy]`. Texture size = `ceil(sqrt(orbitLength))²`
5. **GPU perturbation render**: fragment shader reads orbit from texture, computes delta iteration per pixel with rebasing, applies existing coloring pipeline
6. **Progressive orbit** (optional): partial orbit renders intermediate result while full orbit computation continues

### Precision switching (automatic, invisible to user)

| Zoom depth (scale) | Rendering path | Precision |
|---|---|---|
| > 10^-7 | GPU float32 (existing) | ~7 digits |
| 10^-7 → 10^-13 | GPU DS (existing) | ~15 digits |
| < 10^-13 | **GPU perturbation** (new) | Unlimited (auto-scaled) |

The switch is transparent — the user zooms and it just works (ISO 9241-110: conformity to expectations). The `assembleFragmentSource` function selects the appropriate iteration chunk based on zoom depth.

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
│   └── sa.rs               # Series Approximation (SA) coefficients
```

### 3.2 Dependency: `astro-float`

- **Crate**: `astro-float` v0.9.5 (pure Rust, `no_std` compatible, no C dependencies)
- **WASM status**: `no_std` + allocator = should compile to `wasm32-unknown-unknown`. **Must verify at step 1** before committing. Fallback: `dashu` crate or handwritten FP expansion in Rust.
- **Why not MPFR**: GMP/MPFR are C libraries that don't compile to WASM natively
- **Why not our own FP expansion**: `astro-float` uses optimized algorithms for large precision, is maintained (2.8M downloads), has no precision ceiling
- **Precision**: configurable at runtime via `BigFloat::new(precision_bits)`, auto-scaled to zoom depth
- **Rounding**: supports `RoundingMode::ToEven` (IEEE 754 round-to-nearest-even compatible)

### 3.3 Quality standards (ISO 5055 equivalent)

- `#![deny(clippy::all, clippy::pedantic)]` — zero warnings
- `#![forbid(unsafe_code)]` — no unsafe unless justified and documented
- Cognitive complexity limits via Clippy
- `cargo audit` in CI
- `cargo test` with unit tests covering precision edge cases (cancellation, overflow, underflow)
- `#[wasm_bindgen]` only on public API functions (thin layer principle)
- **Input validation**: all string inputs parsed with `Result`, never `unwrap()`. Malformed strings return explicit error, no WASM trap. (ISO 27001: input validation at system boundaries)

### 3.4 WASM bridge (thin layer)

```rust
#[wasm_bindgen]
pub fn compute_reference_orbit(
    center_re: &str,   // decimal string (JS can't pass >f64)
    center_im: &str,
    max_iter: u32,
    precision_bits: u32,
) -> Result<Float32Array, JsValue> {
    // Returns flat [x0, y0, dx0, dy0, x1, y1, dx1, dy1, ...]
    // Each value downcast to f32 for GPU texture upload
    // Returns Err on invalid input or OOM
}

#[wasm_bindgen]
pub fn compute_sa_coefficients(
    orbit_data: &Float32Array,
    orbit_length: u32,
    terms: u32,           // number of polynomial terms (default 4-8)
) -> Result<Float32Array, JsValue> {
    // Returns SA coefficient arrays [A_re, A_im, B_re, B_im, ...] per skip level
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

        // dz = 2·z·dz + 1   (ISO 80000-2: Z'_{n+1} = 2·Z_n·Z'_n + 1)
        let dz_re_new = 2.0*(z_re*dz_re - z_im*dz_im) + 1.0;
        let dz_im_new = 2.0*(z_re*dz_im + z_im*dz_re);
        dz_re = dz_re_new;
        dz_im = dz_im_new;

        // z = z² + c   (ISO 80000-2: Z_{n+1} = Z_n² + C)
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

**Critical requirement** (Phil Thompson): the orbit MUST start at Z_0 = 0. Do not discard early iterations — Series Approximation depends on the complete orbit from the beginning.

### 3.6 Reference point selection

**With rebasing, complex grid search is unnecessary.** The zoom target point (mouse/touch pointer position) is used directly as the reference point.

Why this works: rebasing automatically handles the case where the reference point escapes early. When `Z_n` escapes but a pixel hasn't escaped yet, the shader rebases `δ = z` and restarts from iteration 0. The reference orbit is reused from the beginning, and the pixel continues iterating correctly.

**Fallback**: if the zoom target produces a very short orbit (escapes in <10 iterations), use the viewport center instead. This handles edge cases where the user zooms on the exterior.

### 3.7 Series Approximation (SA)

SA skips iterations by approximating the perturbation as a polynomial in `δc`:

```
δ_n ≈ A_n·δc + B_n·δc² + C_n·δc³ + ...
```

With recursive coefficient computation from the reference orbit:
```
A_{n+1} = 2·Z_n·A_n + 1            (A_1 = 1)
B_{n+1} = 2·Z_n·B_n + A_n²         (B_1 = 0)
C_{n+1} = 2·Z_n·C_n + 2·A_n·B_n    (C_1 = 0)
```

**Validity**: SA is valid while the approximation error is small relative to the pixel spacing. The number of terms (typically 4-8) and the skip depth are determined empirically. Wikibooks notes: "there is no solid theoretical way of finding when too many iterations are skipped" — keep terms ≤50 to minimize risk.

**Implementation**: precompute `(A_n, B_n, C_n, ...)` coefficients in Rust from the reference orbit. For each pixel, evaluate the polynomial to get `δ_skip` and start per-iteration perturbation from iteration `skip` instead of 0.

**Note**: SA is distinct from BLA (Ball Linear Approximation, Zhuoran). SA uses polynomial coefficients; BLA uses linear approximation with ball arithmetic validity radii. Our implementation uses SA (the more established technique). BLA is a future optimization.

**Reference**: Wikipedia "Plotting algorithms for the Mandelbrot set" § Series approximation; Heiland-Allen (mathr.co.uk).

---

## 4. GPU Perturbation Shader

### 4.1 New GLSL chunks

**`perturbationHeaderChunk`**: uniforms for orbit texture and metadata
```glsl
uniform sampler2D u_orbitTexture;   // float texture, RGBA32F
uniform int u_orbitLength;          // number of iterations in orbit
uniform vec2 u_orbitTexSize;        // texture dimensions for texel lookup
uniform vec2 u_refPoint;            // reference point (f32 hi parts)
uniform vec2 u_refPointLo;         // reference point (f32 lo parts, DS precision)

#define GLITCH_THRESHOLD 1e-6       // G: rebasing sensitivity (Heiland-Allen)
```

**`orbitLookupChunk`**: reads orbit data from texture
```glsl
vec4 getOrbitData(int iter) {
    int texW = int(u_orbitTexSize.x);
    ivec2 coord = ivec2(iter % texW, iter / texW);
    return texelFetch(u_orbitTexture, coord, 0);  // NEAREST, no filtering
}
```

**`mandelbrotPerturbationChunk`**: perturbation iteration with rebasing
```glsl
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
    // δc = pixel_c - ref_c (constant per pixel, cached)
    vec2 ds_re, ds_im;
    screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
    float dc_re = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
    float dc_im = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

    // δ_0 = δc (initial perturbation = offset from reference)
    float u = dc_re;
    float v = dc_im;
    z = vec2(0.0);
    vec2 dz = vec2(0.0);
    iter = 0; escaped = false; smoothVal = 0.0;
    float du = 1.0, dv = 0.0;  // perturbation derivative (dδ/dδc), starts at 1

    int refIter = 0;  // current position in reference orbit

    for (int i = 0; i < MAX_ITER; i++) {
        if (refIter >= u_orbitLength) break;  // orbit exhausted

        vec4 orbitData = getOrbitData(refIter);
        vec2 O = orbitData.xy;    // Z_n: reference position
        vec2 dO = orbitData.zw;   // Z'_n: reference derivative

        // Full position: z = Z + δ
        z = O + vec2(u, v);
        float zz = z.x * z.x + z.y * z.y;

        // NaN guard (IEEE 754-2019 compliance)
        if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
            iter = MAX_ITER;
            return;
        }

        // Escape test on full position
        if (zz > BAILOUT_SQ) {
            escaped = true; iter = i;
            smoothVal = smoothEscape(i, zz);
            return;
        }

        // Rebasing (Zhuoran 2021): when |z|² < G·|Z|², delta has grown
        // too large relative to reference — catastrophic cancellation risk.
        // Reset δ = z, restart from orbit beginning.
        float OO = O.x * O.x + O.y * O.y;
        if (zz < GLITCH_THRESHOLD * OO && OO > 0.0) {
            u = z.x;
            v = z.y;
            du = dz.x;  // also rebase derivative
            dv = dz.y;
            refIter = 0;
            continue;
        }

        // Perturbation derivative: δ'_{n+1} = 2·(Z'_n·δ_n + z_n·δ'_n)
        float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
        dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
        du = temp_du;
        dz = vec2(du, dv);

        // Perturbation iteration: δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
        float temp_u = u*u - v*v + 2.0*(u*O.x - v*O.y) + dc_re;
        v = 2.0*u*v + 2.0*(v*O.x + u*O.y) + dc_im;
        u = temp_u;

        refIter++;
        updateAccumulator(z, dz, acc);
    }

    iter = MAX_ITER;
}
```

### 4.2 Julia perturbation variant

For Julia sets, the perturbation recurrence is the same (`δ_{n+1} = 2·Z_n·δ_n + δ_n²`) but:
- `c` is a constant (not per-pixel), so **`δc = 0`** — no per-iteration δc addition
- `δ_0 = pixel - ref` (initial delta is the coordinate difference)
- The reference orbit uses `c = juliaC` (uniform), not `c = refPoint`
- Derivative: `δ'_{n+1} = 2·(Z'_n·δ_n + z_n·δ'_n)` (no +1 term, same as existing Julia derivative)

This means a separate `juliaPerturbationChunk` with the same structure but the `+ dc_re` / `+ dc_im` terms removed from the perturbation iteration.

### 4.3 Rescaling (range extension)

**Problem**: at extreme zoom, even the delta `δ` can underflow in float32 (<10^-38).

**Solution** (Heiland-Allen): substitute `δ = S·w` where S ≈ |δ|:
```glsl
// When |δ| approaches float32 underflow, rescale
float deltaMag = u*u + v*v;
if (deltaMag < 1e-30 && deltaMag > 0.0) {
    float S = sqrt(deltaMag);
    u /= S; v /= S;          // w ≈ 1
    dc_re /= S; dc_im /= S;  // d = δc/S
    // Continue iteration on (w, d) instead of (δ, δc)
    // Perturbation becomes: w_{n+1} = 2·Z_n·w_n + S·w_n² + d
}
```

This extends the effective zoom range beyond float32 limits. The full position `z = Z + S·w` is reconstructed for escape testing and coloring.

**Note**: rescaling adds complexity. For v1, monitor whether float32 underflow actually occurs at zoom depths ≤10^-60. If not, defer rescaling to v2.

### 4.4 Orbit texture format

| Property | Value |
|---|---|
| Internal format | `gl.RGBA32F` |
| Format | `gl.RGBA` |
| Type | `gl.FLOAT` |
| Filtering | `gl.NEAREST` (no interpolation between orbit steps) |
| Wrap | `gl.CLAMP_TO_EDGE` |
| Layout | `[Z_re, Z_im, Z'_re, Z'_im]` per texel, row-major |
| Size | `ceil(sqrt(orbitLength))` × `ceil(orbitLength / texWidth)` |

Requires `EXT_color_buffer_float` extension (widely supported on WebGL 2).

**Fallback** if `EXT_color_buffer_float` unavailable: encode each float32 as 4 bytes in RGBA8 texture, decode in shader with `uintBitsToFloat()`. 4x more texels but works everywhere.

### 4.5 Shader assembly integration

`assembleFragmentSource` gains a new code path:

```typescript
const usePerturbation =
    (fractal === 'mandelbrot' || fractal === 'julia') &&
    zoomDepth > 1e13;
const useDS = fractal === 'mandelbrot' && !usePerturbation;

const iteration = usePerturbation
    ? (fractal === 'julia' ? juliaPerturbationChunk : mandelbrotPerturbationChunk)
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

The orbit texture binds to `TEXTURE1` (palette is on `TEXTURE0`). SA coefficient texture (when implemented) binds to `TEXTURE2`.

---

## 6. Integration into Rendering Pipeline

### 6.1 Renderer facade extension

The existing `renderer.ts` facade gains a perturbation path:

```
User zooms (mouse/touch) → viewport.scale < PERTURBATION_THRESHOLD
  → Reference point = zoom target (mouse/touch pointer in complex plane)
  → WASM: compute_reference_orbit(refPoint, maxIter, precisionBits)
  → GPU: upload orbit texture
  → GPU: render with mandelbrotPerturbationChunk (includes rebasing)
  → Done. No multi-reference, no re-render pass.
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

URL state encoding at deep zoom: base64-encoded decimal strings in the hash. The existing float64 hash format (`#re=&im=&s=`) is used when `scale > 10^-13`; the deep format (`#dre=&dim=&ds=`) is used below.

### 6.3 WASM loading

```typescript
// Next.js dynamic import of WASM module
const wasmModule = await import('../wasm/pkg/fractalnaute_wasm');
await wasmModule.default();  // init WASM
```

Next.js config: `webpack.experiments.asyncWebAssembly = true` or manual `.wasm` file serving via `public/`.

**Lazy loading**: WASM binary is only fetched when the user first zooms past the DS threshold. Bundle size zero-impact for users who don't deep zoom.

---

## 7. Fractal Coverage & Limitations

### 7.1 Supported fractals

| Fractal | Perturbation support | Justification |
|---|---|---|
| **Mandelbrot** | Full | Standard perturbation theory (K.I. Martin, 2013). Rebasing + SA. |
| **Julia** | Full | Same recurrence, δc = 0, well-established. Rebasing applies. |
| **BurningShip** | Not supported | Non-holomorphic (`abs()` before squaring). Requires `diffabs(c,d)` case analysis (Heiland-Allen): `c≥0 ? (c+d≥0 ? d : -(2c+d)) : (c+d>0 ? 2c+d : -d)`. Additional complications near the "needle" (requires floatexp). Documented for future implementation. |
| **Tricorn** | Not supported | Anti-holomorphic (conjugation). Perturbation breaks smoothness. Technique exists in some desktop implementations. |
| **Multibrot** | Not supported | Higher-order derivatives make perturbation numerically unstable for n>2. |

### 7.2 Fallback behavior

Unsupported fractals at deep zoom (scale < 10^-13) continue to use DS emulation (zoom 10^-15 max). The UI indicates when the user has reached the precision limit:
- InfoPanel badge: "DS (max zoom)" instead of "Perturbation"
- Tooltip: "Deep zoom not available for this fractal type" (ISO 9241-110: self-descriptiveness)

### 7.3 Future work — BurningShip perturbation

The `diffabs` function for ABS-variation perturbation is documented by Heiland-Allen:
```
diffabs(c, d) = |c+d| - |c| =
    c ≥ 0 ? (c+d ≥ 0 ? d : -(2c+d))
           : (c+d > 0 ? 2c+d : -d)
```
This can be added as a separate effort without architectural changes — the WASM orbit and texture pipeline are fractal-agnostic. Main challenge: near the BurningShip needle, full floatexp iterations are needed instead of rescaling (Heiland-Allen).

---

## 8. ISO Compliance

### 8.1 IEEE 754-2019

The entire perturbation pipeline depends on IEEE 754 guarantees:
- **twoSum/twoProd correctness** relies on IEEE 754 round-to-nearest-even
- **`astro-float`** provides `RoundingMode::ToEven` (IEEE 754 compatible). To verify: run `cargo test` with precision comparison against known values computed with MPFR.
- **GPU float32** follows IEEE 754 for basic operations (add, mul, div) per OpenGL ES 3.0 spec
- **NaN/Inf handling**: shader includes explicit `isnan()`/`isinf()` guards. NaN pixels are treated as interior (non-escaped).
- **Denormals (subnormals)**: GPU float32 may flush denormals to zero (common on mobile). At extreme zoom, deltas `δ` can be subnormal. Mitigated by rescaling (§4.3). Without rescaling, zoom is limited to ~10^-38 relative to reference.
- **Risk**: some mobile GPUs deviate from IEEE 754 (e.g., fused multiply-add vs separate ops). Mitigated by rebasing (tolerant of small precision errors) and GLITCH_THRESHOLD sensitivity parameter.

### 8.2 ISO 25010 — Quality model validation

| Characteristic | How addressed |
|---|---|
| **Functional suitability** | Zoom to 10^-60+ (exceeds all browser competitors except Ambrose POC) |
| **Performance efficiency** | GPU delta iteration (<1ms), WASM orbit (~50-200ms @10K iter). **Orbit budget**: 10s timeout, after which: cancel + show partial result + message "computation cancelled" (ISO 9241-110: controllability). |
| **Compatibility** | **Minimum**: Chrome 91+, Firefox 89+, Safari 15.2+ (WebGL 2 + WASM). Fallback if WASM unavailable: DS emulation (10^-15 max) with UI message "Deep zoom requires a modern browser" (ISO 9241-110: self-descriptiveness). |
| **Usability** | Automatic precision switching, no user configuration. Zoom target as reference = minimal delta where user is looking. |
| **Reliability** | Rebasing handles glitches automatically. WASM OOM: `try/catch` in JS caller, message "Not enough memory for this zoom depth — try reducing iterations". Orbit timeout: cancel + partial display. |
| **Security** | No unsafe Rust, `cargo audit`, CSP extended with `'wasm-unsafe-eval'` for WASM execution (Chrome 95+; fallback `'unsafe-eval'` for older). COOP/COEP maintained (WASM loader is same-origin). Input validation: decimal strings parsed with `Result`, malformed → explicit error. |
| **Maintainability** | SRP (Rust precision ↔ GPU render ↔ JS orchestration), DRY (@mirror tags), thin WASM layer |
| **Portability** | WASM = cross-platform, same binary on all OS/browsers |

### 8.3 ISO 9241-110 — Interaction ergonomics (7 principles)

| Principle | Implementation |
|---|---|
| **Suitability for task** | Precision switch invisible — user performs same action (zoom) at every depth. No mode change, no dialog. |
| **Controllability** | Cancel orbit computation via button or Escape key. Zoom out instantly returns to fast path (no orbit needed). |
| **Conformity to expectations** | Zoom "just works" deeper. Same mouse/touch gestures at every depth. |
| **Error tolerance** | Rebasing auto-corrects glitches. WASM failure → DS fallback. OOM → message + partial result. |
| **Self-descriptiveness** | InfoPanel shows precision mode badge (Float32 / DS / Perturbation). Progress bar for orbit computation (`role="progressbar"`, `aria-valuenow`, `aria-valuemax`). |
| **Individualization** | maxIterations slider already exists and applies to perturbation. User controls speed/quality trade-off. |
| **Learnability** | Badge tooltip: "Deep zoom powered by perturbation theory — zoom deeper than 10^-15 for fractal structures invisible at lower zoom." |

### 8.4 WCAG 2.1 (via ISO 40500) — Accessibility

- Orbit progress bar: `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax` = maxIter
- Precision mode changes: `aria-live="polite"` region so screen readers announce "Switched to perturbation mode"
- Cancel button: keyboard-accessible (Escape), `aria-label="Cancel orbit computation"`
- Precision badge: text label + shape (not color-only distinction) per WCAG 1.4.1

### 8.5 ISO 27001 / OWASP — Security

- **CSP**: extend `script-src` with `'wasm-unsafe-eval'` (Chrome 95+). Document in `vercel.json` and `next.config.ts`.
- **COOP/COEP**: WASM loaded same-origin, no cross-origin postMessage needed. Existing COOP/COEP headers unchanged.
- **Input validation**: WASM bridge validates all string inputs. Invalid decimal string → `Err(JsValue)`, not a Rust panic/WASM trap.
- **Supply chain**: `cargo audit` on every `cargo build`. `Cargo.lock` committed. `astro-float` is the only non-dev dependency.
- **SRI**: consider Subresource Integrity hash for the `.wasm` bundle in production. Deferred — Vercel handles integrity via immutable deploys.

### 8.6 ISO 80000-2 — Mathematical notation

See §0 (Glossary) for symbol definitions. All formulas in code use:
- Standard notation: `z_{n+1} = z_n² + c`, `δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc`
- Greek letters for perturbation variables: δ (delta), ε (epsilon)
- GLSL variable mapping documented: `(u, v) ≡ (Re(δ), Im(δ))`
- `@mirror` tags link GLSL to mathematical formulas and CPU equivalents

---

## 9. Testing Strategy

### 9.1 Rust unit tests (`cargo test`)

- Precision arithmetic: verify `astro-float` operations match MPFR reference values at 60, 120, 240 bits
- Orbit computation: compare with known orbits at specific coordinates (e.g., Misiurewicz point M_{1,2} = -0.1011+0.9563i)
- SA coefficients: verify `A_{n+1} = 2·Z_n·A_n + 1` and `B_{n+1} = 2·Z_n·B_n + A_n²` recurrences
- Input validation: malformed strings return `Err`, don't panic

### 9.2 TypeScript unit tests (`npm test`)

- Shader assembly: `assembleFragmentSource` with perturbation mode produces valid GLSL
- Orbit texture upload: correct dimensions, padding, format
- Precision switching: correct threshold logic at boundaries (10^-7, 10^-13)
- Coordinate string handling: encode/decode round-trip for deep viewport URLs
- WASM fallback: graceful degradation when WASM unavailable

### 9.3 GPU parity tests

- **Overlap zone** (10^-12 to 10^-14): DS and perturbation should produce identical output. Pixel-diff test with tolerance for float32 rounding.
- **Rebasing correctness**: render known mini-Mandelbrot at deep zoom, verify no glitch artefacts
- **Known deep zoom coordinates**: compare with deep-mandelbrot screenshots at documented locations

### 9.4 Playwright benchmarks

- Orbit computation time at various zoom depths (10^-20, 10^-40, 10^-60)
- Total render time (orbit + GPU) at various zoom depths
- Time to first visual with progressive orbit
- Rebasing frequency (how often rebasing triggers per render)

---

## 10. Development Steps

| # | Step | Deliverable | Test |
|---|---|---|---|
| 1 | Rust toolchain + WASM bridge | wasm-pack, Next.js loader, TS types. **Verify astro-float compiles to WASM.** | `add(a,b)` callable from browser |
| 2 | Precision lib wrapper | `astro-float` wrapper with auto-scaling, BigFloat↔f32↔string conversions | Rust unit tests: 60+ digit precision, round-trip conversions |
| 3 | Reference orbit computation | `compute_reference_orbit()` → `Float32Array` | Orbit at zoom 10^-40 matches known values |
| 4 | GPU perturbation shader | `mandelbrotPerturbationChunk` with rebasing + NaN guard | Renders identically to DS at zoom 10^-13 (overlap zone) |
| 5 | Pipeline integration | Zoom target → orbit → texture → shader → render. Auto-switch at threshold. | First deep zoom 10^-40 functional |
| 6 | Julia perturbation | `juliaPerturbationChunk` (δc = 0 variant, same rebasing) | Deep zoom Julia at 10^-40 |
| 7 | Series Approximation (SA) | Polynomial coefficient computation + iteration skip | Benchmark: 5-10x speedup on deep zoom |
| 8 | Progressive orbit | Partial render during computation + re-render on complete | Result visible in <200ms at zoom 10^-60 |
| 9 | UX polish | Progress bar, cancel (Escape), precision badge, WCAG, deep URL encoding | Accessibility audit pass, URL round-trip at 10^-40 |
| 10 | Rescaling (if needed) | Range extension for `δ` underflow prevention | Zoom beyond 10^-38 relative delta without artefacts |

**Removed from original plan**: reference point grid search (step 4 old), MRT glitch detection (step 8 old). Replaced by rebasing, which is simpler and more effective.

---

## 11. Performance Expectations

| Metric | DS (current) | Perturbation (target) |
|---|---|---|
| Max zoom | 10^-15 | **10^-60+** (unlimited) |
| GPU render time @256iter | 0.03ms | ~0.05ms (orbit texture fetch overhead) |
| GPU render time @10Kiter | — | ~1ms |
| Orbit computation (10K iter, 10^-40) | — | ~100-200ms (WASM) |
| Orbit computation (100K iter, 10^-60) | — | ~2-5s (WASM) |
| With SA (100K nominal → ~5K actual) | — | ~200-500ms |
| Reference point selection | — | ~0ms (zoom target, no search) |

### Competitive positioning after implementation

| Feature | mandelbrot.page | deep-mandelbrot | Ambrose | **Fractalnaute** |
|---|---|---|---|---|
| Zoom depth | 10^-60+ | 10^-31 | 10^-238 | **10^-60+ (v1)** |
| Multi-fractal deep zoom | No | No | No | **Mandelbrot + Julia** |
| GPU rendering | Yes | WebGL 1 | WebGL | **WebGL 2** |
| Coloring modes (deep) | Histogram | Cosine stripe | Basic | **5 modes** |
| Series Approximation | No | No | No | **Yes** |
| Rebasing | ? | No | ? | **Yes (Zhuoran 2021)** |
| Touch mobile | ? | No | No | **Yes** |
| SSAA | No | DE-adaptive | No | **2x2 toggle** |

---

## 12. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `astro-float` doesn't compile to WASM | Blocks step 1 | **Test immediately at step 1.** Fallback: `dashu` crate, or handwritten FP expansion in Rust. |
| WASM binary size too large | Slow initial load | Tree-shaking, `wasm-opt -O3`, lazy loading (only fetch when zoom > threshold). Budget: <500KB gzipped. |
| `EXT_color_buffer_float` not available | No RGBA32F orbit texture | Fallback: encode floats as RGBA8 (4 bytes per float, `uintBitsToFloat()` in shader). |
| Orbit computation >10s at extreme zoom | Poor UX | Progressive orbit (step 8), progress bar with cancel (Escape). Timeout at 10s. |
| Rebasing too frequent (performance) | GPU slowdown | Monitor rebasing frequency. If >10% of iterations rebase, consider using a better reference point (center of densest region). |
| Float32 delta underflow at extreme relative zoom | Artefacts | Rescaling (step 10). Monitor if this actually occurs at ≤10^-60. |
| Next.js WASM loading + CSP issues | Build/security errors | Manual `.wasm` in `public/`, `'wasm-unsafe-eval'` in CSP. Test in CI. |
| `astro-float` v0.9.5 (pre-1.0) API changes | Maintenance burden | Pin version in `Cargo.lock`. Wrapper layer (`precision.rs`) isolates API from our code. |

---

## 13. Academic References

1. K.I. Martin — "Superfractalthing math" (perturbation theory for Mandelbrot)
2. **Zhuoran (2021)** — Rebasing technique (eliminates multi-reference). Documented by Phil Thompson.
3. Phil Thompson — "Perturbation Theory and the Mandelbrot set" (philthompson.me/2022)
4. Claude Heiland-Allen — "Deep zoom theory and practice" (mathr.co.uk/blog/2021-05-14) — glitch detection criterion `|z|² < G·|Z|²`, rescaling, diffabs for BurningShip
5. Wikipedia — "Plotting algorithms for the Mandelbrot set" § Series approximation — SA coefficient recurrences
6. Joldes, Marty, Muller & Popescu (2015) — "Arithmetic algorithms for extended precision using floating-point expansions"
7. Linas Vepstas — "Renormalized iteration count" (smooth coloring)
8. Inigo Quilez — "Cosine palettes" (iquilezles.org)
9. Claude Heiland-Allen — "Adaptive super-sampling using distance estimate"
