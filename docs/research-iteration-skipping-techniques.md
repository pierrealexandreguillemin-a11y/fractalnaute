# Exhaustive Research: Iteration-Skipping & GPU Render Cost Reduction Techniques

**Date:** 2026-03-28
**Goal:** Reduce GPU perturbation render from ~50-60ms to <5ms (10x improvement)
**Current bottleneck:** Perturbation shader at deep zoom (256 iter, 1280x720) = 50-60ms

---

## Problem Analysis

At @256 iterations with standard (non-perturbation) rendering, GPU time is 0.03-0.05ms.
With perturbation enabled (deep zoom), GPU time jumps to 50-60ms. The 1000x slowdown comes from:

1. **Per-pixel texture fetch per iteration** — `texelFetch(u_orbitTexture, ...)` on every iteration for every pixel
2. **No iteration skipping** — every pixel iterates from 0 to escape/maxIter
3. **Rebasing overhead** — glitch detection + orbit restart adds branch divergence
4. **No spatial coherence exploitation** — neighboring pixels share orbits but don't cooperate

---

## MASTER TABLE: All Techniques Ranked by Impact x Feasibility

| # | Technique | Category | Iterations Reduced | Measured Speedup | GPU Feasible? | WebGL 2 Compatible? | Impl. Effort | Impact x Feasibility Score |
|---|---|---|---|---|---|---|---|---|
| 1 | **BLA (Bivariate Linear Approximation)** | Mandelbrot-specific | Skip 80-99% of iterations | 10-36x (vs SA), measured | YES (precompute on CPU, lookup on GPU) | YES (texture lookup) | 3-4 weeks | **10/10** |
| 2 | **Series Approximation (SA)** | Mandelbrot-specific | Skip 81% iterations (measured) | 2.3x (measured) | Partial (coefficients on CPU, eval on GPU) | YES | 2-3 weeks | **8/10** |
| 3 | **Ping-Pong Multi-Frame** | GPU rendering | Split iterations across N frames | N frames = Nx budget | YES (native GPU pattern) | YES (FBO ping-pong) | 1 week | **8/10** |
| 4 | **Progressive Iteration Refinement** | GPU rendering | Start at 64 iter, double each frame | Perceived instant (<100ms) | YES | YES | 1 week | **8/10** |
| 5 | **Hierarchical/Mariani-Silver** | Spatial coherence | Skip 93% of pixels (measured) | 1.3-6x (measured CUDA) | YES (dynamic parallelism) | PARTIAL (no compute shaders) | 2-3 weeks | **7/10** |
| 6 | **Orbit Compression** | Memory optimization | N/A (reduces bandwidth) | 2-5x (texture fetch reduction) | YES | YES (texture compression) | 1-2 weeks | **7/10** |
| 7 | **XaoS Pixel Reuse** | Frame coherence | Skip 99.5% of pixels on zoom | 200x (measured) | YES (texture copy + partial render) | YES | 1-2 weeks | **7/10** |
| 8 | **Adaptive DE Supersampling** | Spatial coherence | Skip 80-95% supersample pixels | 3-5x (for AA cost) | YES | YES | 1 week | **6/10** |
| 9 | **NanoMB1 (Biseries)** | Mandelbrot-specific | Skip entire period of iterations | >>10x near minibrots | CPU only (preprocessing) | N/A (CPU precompute) | 4-6 weeks | **6/10** |
| 10 | **Parareal (Parallel-in-Time)** | General numerical | Coarse+fine parallel solve | 5-10x theoretical | Requires compute shaders | NO (needs WebGPU) | 4-6 weeks | **5/10** |
| 11 | **Matrix Exponentiation** | General recurrence | O(log n) for linear recurrences | Massive for linear systems | NOT applicable (nonlinear z^2+c) | N/A | N/A | **2/10** |
| 12 | **Neural Surrogate** | ML/neural | Replace iteration with NN inference | 10-100x theoretical | YES (texture-based NN) | PARTIAL | 8+ weeks | **3/10** |
| 13 | **Chebyshev/Taylor Approximation** | General numerical | Polynomial approximation of orbit | Moderate | CPU only (coefficient growth) | N/A | 4+ weeks | **3/10** |
| 14 | **Transfer Matrix Composition** | General numerical | O(log n) via matrix power | Only for linear maps | NOT applicable (nonlinear) | N/A | N/A | **1/10** |
| 15 | **PINN/DeepONet** | ML/neural | Learned operator | Unknown for fractals | Inference only | NO | 12+ weeks | **1/10** |

---

## DETAILED ANALYSIS OF EACH TECHNIQUE

---

### 1. BLA (Bivariate Linear Approximation) — **TOP PRIORITY**

**Source:** Zhuoran (FractalForums, 2021), Phil Thompson (2023 blog)

**Mathematical basis:**
The standard perturbation formula is:
```
delta_{n+1} = 2*Z_n*delta_n + delta_n^2 + delta_c
```
When `|delta_n|^2 << |2*Z_n*delta_n|`, the squared term is negligible, yielding the linear approximation:
```
delta_{n+1} ~= 2*Z_n*delta_n + delta_c
```
This is bilinear (linear in both delta_z and delta_c), hence "BLA."

**Iteration skipping mechanism:**
- Level-1 BLA: skip 1 iteration (trivial)
- Merge adjacent BLAs: L1+L1 -> L2 (skip 2 iters), L2+L2 -> L3 (skip 4), ...
- Merge formula: A_merged = A_y * A_x, B_merged = A_y * B_x + B_y
- Validity radius: r = min(r_x, max(0, r_y - |B|*|delta_c|/|A|))
- Each pixel tests largest BLA first, descends if invalid

**Measured speedup:**
- 10.2x faster than SA at one location (99s vs 1009s)
- 36.2x faster than SA at deeper location (358s vs 12,958s)
- Average: skips 989,000 iterations per pixel (measured)
- At some locations SA is faster (0.6-0.8x)

**Memory after merge-and-cull:**
- O(n) storage: ~500 BLAs for 1000-iteration orbit
- Each BLA: 2 complex coefficients (A, B) + 1 radius = 5 floats

**GPU implementation strategy:**
- CPU: precompute BLA table from reference orbit (O(n log n))
- Upload BLA table as texture (small: ~500 entries for 1000 iter)
- GPU: per-pixel, binary search for largest valid BLA, apply, continue with perturbation
- Key: BLA reduces iterations from N to ~log(N) in best case

**Applicability:**
- Mandelbrot z^2+c: PERFECT (bilinear structure)
- Burning Ship, Tricorn: applicable (Zhuoran designed it for these too)
- Multibrot z^d+c: applicable with modified coefficients
- Julia: applicable with different delta_c handling

**Complexity:** 3-4 weeks. BLA table precomputation is straightforward. GPU lookup requires careful validity testing to avoid warp divergence.

**Key insight for our case:** At 256 maxIter, BLA could skip 200+ iterations per pixel, reducing effective iteration count to ~50 or less. At higher maxIter (1024+), the gain would be even more dramatic.

---

### 2. Series Approximation (SA) — Classical Approach

**Source:** K.I. Martin (SuperFractalThing), Phil Thompson (2022 blog), mathr

**Mathematical basis:**
Express the perturbed orbit as a Taylor series in delta_c:
```
delta_z_n = A_n * delta_c + B_n * delta_c^2 + C_n * delta_c^3 + ...
```
Coefficient recurrence (first 3 terms):
```
A_{n+1} = 2*Z_n*A_n + 1
B_{n+1} = 2*Z_n*B_n + A_n^2
C_{n+1} = 2*Z_n*C_n + 2*A_n*B_n
```

**Iteration skipping mechanism:**
- Compute SA coefficients along reference orbit (one-time CPU cost)
- For each pixel: evaluate polynomial at its delta_c to get starting delta_z at iteration K
- Skip iterations 0 through K-1 entirely
- K determined by when coefficients grow too large (validity check)

**Measured performance:**
- 16 terms: skipped 24,961 iterations per pixel (81% of 30,691 total)
- Speedup: 2.3x (293s -> 129s) at "Flake" location on M1 Mac (CPU)

**GPU implementation strategy:**
- CPU: compute SA coefficient arrays (complex arrays, one per term)
- GPU: evaluate polynomial per-pixel (16 complex multiplies + adds)
- Then continue with standard perturbation from iteration K

**Limitations:**
- Coefficients grow rapidly, limiting skip depth
- More terms = more computation for coefficients (diminishing returns)
- Less effective than BLA at very deep zooms
- SA incompatible with stripe average coloring in some implementations

**Complexity:** 2-3 weeks. Simpler math than BLA, but less powerful.

---

### 3. Ping-Pong Multi-Frame Rendering

**Source:** Standard GPU technique, used by deep-mandelbrot.js.org

**Mathematical basis:** None (engineering pattern). Split iteration budget across frames.

**How it works:**
- Frame 1: iterate 0-64, store (z, iter) in FBO A
- Frame 2: read FBO A, continue 64-128, write to FBO B
- Frame 3: read FBO B, continue 128-192, write to FBO A
- Continue until maxIter reached

**Impact on our 50ms problem:**
- If maxIter=256 and we split into 4 frames: each frame = 64 iterations = ~12ms
- Each frame is under the 16ms vsync budget
- Total time unchanged, but perceived latency is 12ms (first frame visible in 12ms)
- Progressive refinement: user sees partial result immediately

**WebGL 2 implementation:**
- Two FBOs with RGBA32F textures (store z_re, z_im, iter, accum)
- Alternating read/write each frame
- Fragment shader reads previous state from texture, continues iteration
- Already have FBO infrastructure (gpuFramebuffer.ts)

**Complexity:** 1 week. We already have FBO infrastructure. Need state texture and multi-frame dispatch.

---

### 4. Progressive Iteration Refinement (mandelbrot.page style)

**Source:** davidbau/mandelbrot.page

**How it works:**
- Render at maxIter=64, display immediately (<5ms GPU)
- Background: re-render at 128, 256, 512, 1024...
- Converged pixels (escaped early) don't change — only boundary pixels refine
- Combined with cycle detection for early termination

**Impact:**
- First visible result in <5ms (low maxIter is fast)
- Deep detail appears progressively
- User perceives instant response

**Complexity:** 1 week. Simple loop with increasing maxIter. Need pixel state tracking to avoid re-computing escaped pixels.

---

### 5. Hierarchical Mariani-Silver (Spatial Coherence)

**Source:** Wikipedia, NVIDIA CUDA Dynamic Parallelism blog

**Mathematical basis:**
- If all border pixels of a rectangle have the same iteration count, fill interior with same value
- Recursively subdivide non-uniform rectangles

**Measured performance:**
- Skips 93% of pixel computations (measured at 1000 maxIter)
- CUDA dynamic parallelism: 1.3-6x speedup depending on resolution and maxIter
- Higher speedup at higher maxIter (more computation saved per pixel)

**GPU implementation challenge:**
- WebGL 2 has NO compute shaders or dynamic parallelism
- Would need multi-pass approach: render borders at each subdivision level
- Or: CPU decides subdivision, GPU fills uniform regions
- WebGPU would be ideal (compute shaders with workgroup shared memory)

**Complexity:** 2-3 weeks. Multi-pass rendering with CPU-driven subdivision decisions.

---

### 6. Orbit Compression (Reduce Texture Fetch Cost)

**Source:** FractalShark (Zhuoran reference compression), mathr

**Rationale:**
Our perturbation shader does `texelFetch` on every iteration for every pixel. At 256 iterations, 1280x720 = 921,600 pixels, that's 236M texture fetches. This is likely the #1 bottleneck for the 50ms GPU time.

**Techniques:**
a) **Downsampled orbit**: Store every 4th orbit point, interpolate between.
   - 4x fewer fetches, slight accuracy loss

b) **Orbit chunking**: Pack 4 orbit points per texel (RGBA32F = 4 floats)
   - Reduce fetch count by rearranging data layout

c) **Shared memory tiling** (WebGPU only): Load orbit chunk into workgroup shared memory
   - All pixels in tile share the same orbit data
   - Eliminates redundant global memory reads

d) **Orbit in shader constants**: For short orbits (<256), upload as uniform arrays
   - Uniform access is faster than texture fetch
   - WebGL 2 limit: 4096 uniform components = 1024 vec4s = 256 orbit points with (x,y,dx,dy)

**Impact:** If texture fetch is the bottleneck, moving orbit to uniform array could give 5-10x speedup for short orbits. For long orbits, tiling via WebGPU shared memory would be transformative.

**Complexity:** 1-2 weeks for uniform array approach. Trivial to test.

---

### 7. XaoS Pixel Reuse (Frame-to-Frame Coherence)

**Source:** Jan Hubicka (XaoS algorithm, 1996)

**How it works:**
- When zooming/panning, reuse pixels from previous frame
- Compute coordinate mapping: which old pixels correspond to which new positions
- Copy reusable pixels, only compute new/exposed ones
- Measured: 99.5% pixel reuse during smooth zoom

**Already partially implemented:** CSS transform for instant feedback, strip rendering for exposed regions during pan.

**Additional optimization:** After CSS transform, GPU only renders the ~0.5% of pixels that changed. At 1280x720, that's ~4,600 pixels instead of 921,600 — a 200x reduction.

**GPU implementation:**
- Render to FBO with (z, iter, accum) state
- On zoom: copy+transform previous FBO, render only new regions
- On pan: shift FBO, render only exposed strips

**Complexity:** 1-2 weeks. Extension of existing viewport feedback system.

---

### 8. Adaptive Distance-Estimation Supersampling

**Source:** Claude Heiland-Allen (mathr), deep-mandelbrot (munrocket)

**How it works:**
- Compute distance estimation (DE) as byproduct of iteration (already tracked via dz)
- DE tells you distance to Mandelbrot boundary in pixel units
- Only supersample pixels where DE < pixel_size (near boundary)
- Use RGSS 5-point pattern for selected pixels

**Impact:**
- Typically 80-95% of pixels are far from boundary — skip supersampling
- For SSAA 2x2 (current): saves 75-95% of supersample cost
- Not directly reducing iteration count, but reducing total pixel count

**Already relevant:** We have SSAA 2x2 toggle. This makes it adaptive.

**Complexity:** 1 week. DE is already computed in the shader (acc.dz). Add threshold test.

---

### 9. NanoMB1 (Biseries for Periodic Points)

**Source:** Claude Heiland-Allen (mathr), Kalles Fraktaler

**How it works:**
- When reference point is periodic (center of a minibrot) with period P
- Biseries approximation in (z, c) skips entire period P per step
- Multiple periods skipped by repeating biseries

**Impact:**
- Near minibrots: skip P iterations per biseries step
- If P=100 and maxIter=1000: 10 biseries steps instead of 1000 iterations
- Massive speedup at deep zoom near minibrots

**Limitation:**
- Only works near periodic points
- NanoMB2 (chained minibrots) is "highly experimental, fails for many locations"
- CPU preprocessing required (find period, compute biseries coefficients)

**Complexity:** 4-6 weeks. Complex math, experimental, fragile.

---

### 10. Parareal (Parallel-in-Time Integration)

**Source:** Lions, Maday, Turinici (2001)

**Mathematical basis:**
Treat iteration as time-stepping ODE. Use coarse integrator (few iterations, low accuracy) to predict, then fine integrator (full iterations) in parallel across time windows, then correct.

**Applicability to Mandelbrot:**
- Coarse: iterate with large step (skip every other iteration?)
- Fine: standard iteration in parallel windows
- Problem: z^2+c is chaotic — coarse predictor may be wildly wrong
- Convergence not guaranteed for chaotic maps

**Verdict:** Theoretically interesting but practically inapplicable to Mandelbrot. The chaotic nature of the iteration means the coarse solver provides no useful prediction. **NOT RECOMMENDED.**

---

### 11. Matrix Exponentiation for Recurrences

**Mathematical basis:**
For linear recurrences x_{n+1} = Ax_n, compute x_N = A^N * x_0 in O(log N) via repeated squaring.

**Applicability to Mandelbrot:**
- z_{n+1} = z_n^2 + c is NONLINEAR (quadratic)
- Cannot be expressed as matrix multiplication
- **NOT APPLICABLE.** Period.

---

### 12. Neural Surrogate Models

**How it would work:**
- Train neural network to predict (iteration_count, smooth_value) from (c_re, c_im)
- Replace iteration loop with single NN forward pass
- NN as texture: weights stored in textures, matmul in shader

**Challenges:**
- Mandelbrot boundary is fractal — NN struggles with high-frequency detail
- Would need Fourier features (positional encoding) for fine detail
- Training data = rendered images (chicken-and-egg)
- Accuracy at boundary would be poor
- Different NN needed for each zoom level

**Existing work:**
- Wolfram Community: NN learns Mandelbrot (crude, low resolution)
- "Teaching a NN the Mandelbrot Set" (Towards Data Science): NN captures low-frequency structure but fails at boundary
- Fourier feature encoding helps but doesn't eliminate the problem

**Verdict:** 10-100x potential speedup for interior/exterior classification, but boundary quality would be unacceptable for a quality fractal explorer. **NOT RECOMMENDED** as primary technique. Possibly useful as coarse predictor for adaptive iteration (tell which pixels need more iterations).

---

### 13. Chebyshev/Taylor Polynomial Approximation

**How it would work:**
- Approximate the iteration map z^2+c with a Chebyshev polynomial
- Evaluate polynomial instead of iterating

**Problem:**
- The iteration map is simple (z^2+c) — polynomial approximation doesn't simplify it
- What matters is the NUMBER of times you iterate, not the cost per iteration
- Chebyshev is useful for approximating expensive functions, not for reducing iteration count
- The orbit IS a polynomial in c (that's what SA already exploits)

**Verdict:** SA already IS the Taylor/polynomial approach applied optimally. Chebyshev adds nothing beyond SA. **REDUNDANT.**

---

### 14. Transfer Matrix Composition

Same as #11 — only works for linear maps. z^2+c is nonlinear. **NOT APPLICABLE.**

---

### 15. PINN/DeepONet/Fourier Neural Operator

**How it would work:**
- Learn the operator mapping c -> escape_time as a neural operator
- FNO could learn spectral structure of the iteration map

**Challenges:**
- Same boundary accuracy problem as #12
- Training is extremely expensive (need many zoom levels)
- Inference cost in WebGL shader would be significant
- No existing work on fractal-specific neural operators

**Verdict:** Academically interesting, practically infeasible for quality rendering. **NOT RECOMMENDED.**

---

## PRACTICAL RECOMMENDATIONS FOR 50ms -> <5ms

### Strategy: Combine BLA + Orbit Uniforms + Ping-Pong

**Phase 1 (1-2 weeks): Orbit as Uniform Array — Expected: 50ms -> 10-15ms**
- Current bottleneck is likely per-iteration texelFetch (236M fetches at 256 iter)
- Upload orbit as `uniform vec4 u_orbit[256]` — uniform access is register-speed
- WebGL 2 guarantees at least 4096 uniform components = 1024 vec4 = 256 orbit entries
- For orbits > 256: fall back to texture, or use UBO (WebGL 2 UBOs support 16KB+)
- Test immediately — this alone may solve the problem

**Phase 2 (3-4 weeks): BLA Iteration Skipping — Expected: 10ms -> 1-3ms**
- Precompute BLA table on CPU from reference orbit (O(n log n))
- Upload BLA table as small texture (~500 entries)
- GPU per-pixel: test largest BLA, apply if valid, skip iterations
- At 256 maxIter: skip ~200 iterations, iterate only ~50
- At 1024 maxIter: skip ~900 iterations, iterate only ~100
- Combined with perturbation rebasing (already implemented)

**Phase 3 (1 week): Ping-Pong Progressive — Expected: <1ms first frame**
- Split remaining iterations across 4 frames
- First frame: BLA skip + 16 iterations = <1ms
- Progressive refinement to full quality in 4 frames

**Phase 4 (1 week): Adaptive DE Supersampling — Save 75-95% of SSAA cost**
- Already have distance estimation (dz tracking)
- Only supersample boundary pixels
- Replace 2x2 brute-force SSAA with 5-point adaptive RGSS

### Expected combined result:
- **Shallow zoom (standard rendering):** 0.03ms (unchanged, already fast)
- **Deep zoom (perturbation), first visible:** <1ms (BLA + ping-pong first frame)
- **Deep zoom, full quality @256:** 1-3ms (BLA skips 80%+ iterations)
- **Deep zoom, full quality @1024:** 3-8ms (BLA skips 90%+ iterations)
- **Deep zoom with SSAA:** +20% (adaptive DE supersampling)

---

## TECHNIQUES ALREADY IMPLEMENTED (for reference)

| Technique | Status | Impact |
|---|---|---|
| Cardioid/bulb pre-test | DONE | Skips interior pixels (Mandelbrot only) |
| Brent's periodicity checking | DONE (CPU workers) | Not on GPU (warp divergence) |
| Perturbation theory | DONE | Enables deep zoom with float32 GPU |
| Rebasing (Zhuoran 2021) | DONE | Avoids glitches in perturbation |
| Double-Single emulation | DONE | Extends precision to ~15 digits |
| Progressive stride rendering | DONE | Fast preview (stride 4) |
| XaoS-style CSS transform | DONE | <2ms visual feedback |
| Strip rendering (pan) | DONE | Only render exposed strips |
| SSAA 2x2 toggle | DONE | Quality AA, brute-force |
| Precision ladder (DD/QD/Arb) | DONE | Orbit <1ms at all zoom depths |

---

## TECHNIQUES NOT APPLICABLE (with reasons)

| Technique | Why Not |
|---|---|
| Matrix exponentiation | z^2+c is nonlinear — cannot express as matrix |
| Transfer matrix | Same — only works for linear recurrences |
| Periodicity on GPU | Warp divergence kills performance (established in CLAUDE.md) |
| Adams-Bashforth multistep | ODE method — not applicable to discrete iteration map |
| CUDA persistent threads | WebGL 2 has no thread model (fragment shader only) |
| Workgroup shared memory | WebGL 2 has no compute shaders (need WebGPU) |
| Neural surrogate | Boundary accuracy unacceptable for quality rendering |

---

## FUTURE CONSIDERATIONS (WebGPU era)

When WebGPU is available, additional techniques become feasible:

1. **Compute shader histogram coloring** — atomic operations for two-pass histogram equalization
2. **Workgroup shared orbit** — load orbit chunk into shared memory, all pixels in tile read from it (eliminates per-pixel global memory access)
3. **Dynamic resolution tiles** — compute shaders can adaptively allocate work per tile
4. **Mariani-Silver on GPU** — compute shader dynamic parallelism equivalent
5. **Subgroup operations** — ballot/shuffle for cooperative iteration (threads share escape info)

---

## SOURCES

### Mandelbrot-Specific
- [Series Approximation — Phil Thompson](https://philthompson.me/2022/Series-Approximation-and-the-Mandelbrot-set.html)
- [BLA — Phil Thompson](https://philthompson.me/2023/Faster-Mandelbrot-Set-Rendering-with-BLA-Bivariate-Linear-Approximation.html)
- [Deep Zoom Theory and Practice — mathr (2021)](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html)
- [Deep Zoom Theory and Practice (again) — mathr (2022)](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html)
- [Series Approximation — mathr](https://mathr.co.uk/web/m-series-approximation.html)
- [Perturbation Theory — Phil Thompson](https://philthompson.me/2022/Perturbation-Theory-and-the-Mandelbrot-set.html)
- [Perturbation Theory — DeepDrill docs](https://dirkwhoffmann.github.io/DeepDrill/docs/Theory/Perturbation.html)
- [Perturbation Theory — Wikibooks](https://en.wikibooks.org/wiki/Fractals/perturbation)
- [Perturbation calculations — UltraFractal](https://www.ultrafractal.com/help/formulas/perturbationcalculations.html)
- [Plotting algorithms — Wikipedia](https://en.wikipedia.org/wiki/Plotting_algorithms_for_the_Mandelbrot_set)
- [Adaptive supersampling using DE — mathr](https://mathr.co.uk/blog/2014-11-22_adaptive_supersampling_using_distance_estimate.html)
- [Cardioid/bulb checking — mathr](https://mathr.co.uk/blog/2022-11-19_cardioid_and_bulb_checking.html)
- [Smooth iteration count — Ruben van Nieuwpoort](https://rubenvannieuwpoort.nl/posts/smooth-iteration-count-for-the-mandelbrot-set)
- [Smooth Shading — Linas Vepstas](https://linas.org/art-gallery/escape/smooth.html)
- [Mandelbrot perturbation — Shadertoy](https://www.shadertoy.com/view/ttVSDW)
- [New deep zoom algorithms — Microfractal](https://www.deviantart.com/microfractal/journal/New-deep-zoom-algorithms-for-fractals-933730336)
- [Perturbation Rendering — Mandelbrot Metal](https://mandelbrot-metal.com/perturbation-rendering)

### Implementations
- [FractalShark — CUDA GPU (GitHub)](https://github.com/mattsaccount364/FractalShark)
- [deep-mandelbrot — munrocket (GitHub)](https://github.com/munrocket/deep-fractal)
- [rust-fractal-core — Rust perturbation+SA (GitHub)](https://github.com/rust-fractal/rust-fractal-core)
- [MandelbrotPerturbation — SA example (GitHub)](https://github.com/ShiromMakkad/MandelbrotPerturbation)
- [Ambrose Cavalier GPU Deep Zoom](https://ambrosecavalier.com/projects/gpu-deep-zoom/about/)
- [WebGPU Mandelbrot — BenjaminAster](https://github.com/BenjaminAster/WebGPU-Mandelbrot)
- [mandelbrot.page — davidbau](https://github.com/davidbau/mandelbrot)
- [XaoS — Real-time zoom (GitHub)](https://github.com/xaos-project/XaoS)
- [Mariani-Silver CUDA — canonizer (GitHub)](https://github.com/canonizer/mandelbrot-dyn)
- [Log scale map — cuda-benoit (GitHub)](https://github.com/rogerdahl/cuda-benoit)

### General GPU/Numerical Techniques
- [CUDA Warp Divergence — Aussie AI](https://www.aussieai.com/blog/cuda-thread-divergence)
- [Parareal — Wikipedia](https://en.wikipedia.org/wiki/Parareal)
- [GPU Matrix Exponentiation (arXiv)](https://arxiv.org/pdf/1204.3052)
- [CUDA Dynamic Parallelism — NVIDIA Blog](https://developer.nvidia.com/blog/introduction-cuda-dynamic-parallelism/)
- [Fragment Shader Memoization — ACM](https://dl.acm.org/doi/10.1145/2678373.2665748)
- [WebGL2 GPGPU — webgl2fundamentals](https://webgl2fundamentals.org/webgl/lessons/webgl-gpgpu.html)
- [WebGPU Compute Histogram — webgpufundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html)
- [Ping-Pong Rendering — Olha Stefanishyna](https://ostefani.dev/tech-notes/ping-pong-technique)
- [Successive Refinement — MROB](http://www.mrob.com/pub/muency/successiverefinement.html)
- [XaoS Algorithm — Wikipedia](https://en.wikipedia.org/wiki/XaoS)
- [Mariani-Silver Algorithm — Rico Mariani](https://ricomariani.medium.com/the-mariani-silver-algorithm-for-drawing-the-mandelbrot-set-a71e31bc20b6)

### Neural/ML Approaches
- [Neural Operators — Wikipedia](https://en.wikipedia.org/wiki/Neural_operators)
- [Teaching NN the Mandelbrot Set — TDS](https://towardsdatascience.com/teaching-a-neural-network-the-mandelbrot-set/)
- [PINNs as Surrogate Models — Medium](https://shuaiguo.medium.com/using-physics-informed-neural-networks-as-surrogate-models-from-promise-to-practicality-3ff13c1320fc)
- [Fractal Boundary of NN Training (arXiv)](https://arxiv.org/abs/2402.06184)
