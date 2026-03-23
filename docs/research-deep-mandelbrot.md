# DeepMandelbrot Technical Analysis

**Source:** https://github.com/munrocket/deep-fractal
**Live:** https://deep-mandelbrot.js.org/
**Author:** munrocket
**Research date:** 2026-03-22

---

## 1. Architecture Overview

- **Stack:** Svelte 3 + Rollup + TWGL.js (WebGL utility) + Jampary (arbitrary precision)
- **WebGL version:** WebGL 1.0 (no `#version 300 es`, uses `gl_FragColor`, `attribute`/`varying`)
- **Shader code:** ~94 lines of GLSL (vertex + fragment combined) in `src/old-src/shaders.js`
- **Languages:** JavaScript 49.4%, HTML 31.7%, Svelte 18.9%
- **Two versions exist in the repo:**
  - `src/old-src/` — the full-featured version (shaders.js, render.js, events.js) loaded as separate scripts
  - `src/Viewer.svelte` — a simplified Svelte rewrite that is **missing** perturbation theory, distance estimation, stripe coloring, and supersampling. Appears to be a WIP migration.
- The **live site** uses the old-src version (the index.html at root loads render.js, shaders.js, events.js directly).

---

## 2. Precision: Jampary Library

**Package:** `jampary@0.0.2` (devDependency, authored by munrocket himself)
**Full name:** JAvascript Multiple Precision Arithmetic libraRY

### How it works

Jampary uses **floating-point expansions** — representing a high-precision number as an array (Vec) of standard IEEE 754 doubles. Each element captures successively finer correction terms.

Core primitives:
- **`twoSum(a, b)`** — Error-Free Transformation: computes `s = a + b` and captures the rounding error `e` such that `a + b = s + e` exactly.
- **`twoProd(a, b)`** — Error-Free Transformation for multiplication using the Dekker splitting technique (`splitter = 2^27 + 1`).
- **`quickSum(a, b)`** — Fast sum when `|a| >= |b|`.
- **`renormalize(A, n)`** — Normalizes an expansion to n components, cascading carries.

Exported operations: `add(A, B)`, `sub(A, B)`, `mul(A, B)`, `div(A, B)`.

**Default precision:** 4 components per number (visible in the `mandelbrot()` function: `[0.,0.,0.,0.]`), giving approximately **60+ significant decimal digits** — enough for zoom depths around 10^-60.

**Academic references:**
- Joldes, Marty, Muller & Popescu (2015): "Arithmetic algorithms for extended precision using floating-point expansions"
- Muller, Popescu & Tang (2016): "A new multiplication algorithm for extended precision using floating-point expansions"

**Status:** Early stage, no FMA support. The old version of the site uses a separate `double.js` library (double-double, ~31 digits) instead.

### How precision is used in the rendering pipeline

Jampary runs on the **CPU only** — it computes the reference orbit at arbitrary precision. The GPU shader then works with standard `highp float` (mediump for the fragment shader) using perturbation deltas that remain small enough for single/half precision.

---

## 3. Perturbation Theory (the key to deep zoom)

This is **the** technique that enables deep zooming without GPU arbitrary precision.

### Reference orbit approach

1. **CPU side** (`searchOrigin()` in render.js): A logarithmic grid search finds the "best" reference point — the point that iterates the longest before escaping. It searches a 12x12 grid, narrows to the best region, and repeats 15 times.

2. **CPU side** (`calcOrbit()` in render.js): Computes the full orbit of the reference point at arbitrary precision using the `Double` class. Stores `[x, y, dx, dy]` per iteration (position + derivative) into a flat Float32 array.

3. **GPU side**: The orbit is uploaded as a **floating-point texture** (`gl.FLOAT` format, `NEAREST` filtering). The texture size is `ceil(sqrt(orbitLength/4))` squared.

4. **Fragment shader** (`calculator()` function): Each pixel computes only its **delta** from the reference orbit:
   ```glsl
   // delta = screen-space offset from reference point
   // O = reference orbit position at iteration i (from texture)
   // u,v = perturbation delta (starts as screen coordinate offset)

   z = O + vec2(u, v);        // full position = reference + delta

   // Perturbation iteration (avoiding catastrophic cancellation):
   temp = u*u - v*v + 2*(u*O.x - v*O.y);
   v = 2*u*v + 2*(v*O.x + u*O.y);
   u = temp;
   u += delta.x;  // add c-delta for Mandelbrot (not for Julia)
   v += delta.y;
   ```

The key insight: `u` and `v` stay small (they're differences from the reference), so standard `float` precision suffices even at extreme zoom depths.

### Derivative tracking

The shader also tracks the derivative `dz` using perturbation:
```glsl
// dO = reference derivative at iteration i (from texture)
temp = 2.*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
dv   = 2.*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
du = temp;
```

This derivative is used for both **distance estimation** and the **smooth iteration count**.

---

## 4. Coloring System

### Color scheme 0: Stripe Average Coloring + Cosine Palette

This is the default and produces the distinctive metallic/copper look.

**Step 1 — Stripe accumulation during iteration:**
```glsl
stripe += z.x * z.y / zz * step(0.0, time);
s3 = s2; s2 = s1; s1 = stripe;
```
This accumulates `Re(z) * Im(z) / |z|^2` at each iteration — effectively tracking the argument/phase of z. The `step(0.0, time)` skips the first iteration. The three history values `s1, s2, s3` are kept for interpolation.

**Step 2 — Smooth iteration count:**
```glsl
time += clamp(1.0 + logLogRR - log2(log2(zz)), 0., 1.);
```
Where `logLogRR = log2(log2(square_radius))`. This is the standard **renormalized iteration count** (Linas Vepstas). It adds a fractional part to the integer iteration count, eliminating color banding.

**Step 3 — Catmull-Rom interpolation of stripe:**
```glsl
stripe = interpolate(stripe, s1, s2, s3, fract(time));
```
The stripe value is interpolated using a **Catmull-Rom spline** with the fractional part of the smooth iteration count, ensuring the stripe pattern transitions smoothly between iterations.

**Step 4 — Final color computation:**
```glsl
color += 0.7 + 2.5 * (R.stripe / clamp(R.time, 0., 200.))
       * (1. - 0.6 * step(float(imax), 1. + R.time));

color = 0.5 + 0.5 * sin(color + vec3(4.0, 4.6, 5.2) + 50.0 * R.time / float(imax));
```

This is a **cosine/sine palette** (Inigo Quilez technique). The `vec3(4.0, 4.6, 5.2)` are **phase offsets per RGB channel** — they control the hue. These specific values produce warm copper/bronze tones because:
- R channel (phase 4.0) and G channel (phase 4.6) are close together → warm amber
- B channel (phase 5.2) is offset further → suppressed blue → metallic warmth

The `50.0 * R.time / float(imax)` term creates the **frequency** of color cycling relative to iteration depth.

The `0.7 + 2.5 * stripe/time` term modulates the **base brightness** using the stripe average, creating the characteristic metallic sheen with directional lighting appearance.

The `(1. - 0.6 * step(float(imax), 1. + R.time))` factor **darkens interior points** (those that reached max iterations) by 60%, making the set interior appear as dark copper rather than pure black.

### Color scheme 1: Texture-mapped coloring
```glsl
vec2 texcoord = vec2(R.argZ / 2. / PI, log2(R.zz) / log2(square_radius) - 1.0);
color = texture2D(exteriortex, texcoord).xyz;
```
Maps the **argument of z** (angle) and **log of escape magnitude** to a 2D texture lookup. Three joke textures are available: doge, loli, rick.

### Interior handling

The set interior is **NOT left black**. The formula `(1. - 0.6 * step(float(imax), 1. + R.time))` reduces brightness by 60% for interior points, resulting in a **dark copper/bronze** color rather than pure black. This is a subtle but important visual choice — it gives the interior a warm, integrated look rather than the harsh black holes typical of simpler renderers.

---

## 5. Distance Estimation

The shader computes the **Hubbard-Douady distance estimate**:
```glsl
float dem = sqrt(R.zz / R.dzdz) * log2(R.zz);
```

Where:
- `R.zz = |z|^2` at escape
- `R.dzdz = |dz|^2` (derivative magnitude squared)

This is equivalent to `d ≈ |z| * log|z| / |z'|`, the standard distance from the point to the Mandelbrot set boundary.

The distance estimate is used for **two purposes:**
1. Triggering adaptive supersampling (see below)
2. Could be used for exterior coloring weight (the dem_weight variable), though in color_scheme 0 it's only used for the supersampling decision

---

## 6. Adaptive Supersampling

```glsl
float dem_weight = 800. / min(size.x, size.y);

if (-log2(dem * dem_weight) > 0.5) {
    // supersample this pixel with 5 samples (center + 4 rotated-grid)
    R.time /= 5.; R.zz /= 5.; R.dzdz /= 5.; R.stripe /= 5.;
    for (int i = 0; i < 4; i++) {
        vec2 offset = pixelsize * vec2(
            vec4(-1., 3., 3., 1.)[i],
            vec4(-3., -1., 1., 3.)[i]
        ) / 4.;
        offset = vec2(offset.x * rotator.y - offset.y * rotator.x, dot(offset, rotator));
        result RI = calculator(offset);
        R.time += RI.time / 5.;
        // ... average all components
    }
}
```

**Technique:** Selective 5x supersampling using distance estimation as a trigger.

Key details:
- **Trigger condition:** `dem * 800/viewport_size < 2^(-0.5)` — i.e., when the estimated distance to the set boundary is less than ~0.7 pixels. This means only pixels **near the fractal boundary** get supersampled.
- **Sample pattern:** 1 center + 4 offset samples in a **rotated grid** pattern: `(-1,-3), (3,-1), (3,1), (1,3)` divided by 4. This is a standard RGSS (Rotated Grid Super Sampling) pattern, optimal for catching diagonal features.
- **Rotation-aware:** Offsets are rotated by the viewport's rotation angle, maintaining correct subpixel positioning even when the view is rotated.
- **Weighted average:** All 5 samples are equally weighted (1/5 each).
- **What gets averaged:** Not just color — `time`, `zz`, `dzdz`, and `stripe` are all averaged before the final color computation. This produces smoother results than averaging final colors.

**Reference:** Claude Heiland-Allen's technique: "Adaptive super-sampling using distance estimate" — only subdivide pixels where the fractal boundary is nearby, saving massive computation in smooth exterior/interior regions.

---

## 7. Ping-Pong Rendering

Marked as ✓ (done) in the TODO list, but **NOT visible in the current source code**. The old-src/render.js shows a single-pass draw call with no framebuffer management.

The typical ping-pong technique for fractal rendering involves:
- Two framebuffers alternating as read/write targets
- Progressive refinement: each frame computes a few more iterations, reading the previous state from one FBO and writing to the other
- Allows rendering extremely deep zooms (high iteration counts) without GPU timeout, by spreading computation across multiple frames

This was likely implemented and then removed or exists in an unreleased branch. The current live site does **single-pass rendering**.

---

## 8. Why It Looks Good — Visual Quality Breakdown

### Primary factors (in order of impact):

1. **Stripe Average Coloring** — This is the single biggest visual differentiator. By accumulating `Re(z)*Im(z)/|z|^2` across iterations and smoothly interpolating it, the shader creates **directional, almost holographic surface detail** that responds to the fractal structure. This is what gives the metallic/brushed-metal appearance. Simple smooth iteration coloring cannot achieve this.

2. **Cosine palette with carefully chosen phase offsets** — The `vec3(4.0, 4.6, 5.2)` phases produce a warm amber-copper palette with subtle blue undertones. The sine function naturally creates smooth gradients with no hard edges. The stripe modulation makes the palette appear to "wrap around" the fractal structure.

3. **Adaptive supersampling at boundary** — By concentrating anti-aliasing samples exactly where the fractal boundary creates fine detail, the image appears sharp and clean even where the set has infinitely complex structure. The RGSS pattern is particularly effective at reducing Moire artifacts.

4. **Smooth iteration count with Catmull-Rom interpolation** — The combination of renormalized iteration count AND Catmull-Rom interpolation of the stripe value eliminates both iteration banding AND stripe discontinuities. Most implementations only do smooth iteration; this does smooth everything.

5. **Warm interior treatment** — Instead of harsh black, interior points get a 60% darkened version of the copper palette. This makes the set interior feel "part of" the image rather than a void.

6. **High escape radius** — `squareRadius = 3e5` (so escape radius ≈ 548). Most implementations use 2 or 4. The high escape radius improves the accuracy of the smooth iteration count and distance estimate, reducing artifacts near the boundary.

7. **High max iterations** — `imax = 1024` default (shader allows up to 3000). More iterations reveal more detail in the boundary and prevent premature "fake interior" pixels.

### Secondary factors:

8. **Large orbit texture** — The reference orbit is stored as a float texture with full (x,y,dx,dy) per iteration, enabling both perturbation rendering and distance estimation in a single pass.

9. **Perturbation theory** — Not directly a visual quality factor, but enables the deep zoom levels where the fractal structure is most interesting and visually striking.

10. **Rotation support** — The vertex shader applies a rotor (rotation matrix), and supersampling offsets are rotation-aware. This allows viewing the fractal at arbitrary angles, revealing structures not visible in axis-aligned views.

---

## 9. Academic References (from README)

1. Bruce Dawson — "Faster Fractals Through Algebra"
2. **Jussi Harkonen — "On Smooth Fractal Coloring Techniques"** ← stripe average coloring theory
3. **Javier Barrallo & Damien Jones — "Coloring algorithms for dynamical systems in the complex plane"** ← general coloring
4. **K.I. Martin — "Superfractalthing math"** ← perturbation theory for Mandelbrot
5. Robert Munafo — "Speed Improvements"
6. **Claude Heiland-Allen — "Adaptive super-sampling using distance estimate"** ← the DE-based AA
7. Arnaud Cheritat — "Mandelbrot set"
8. Peitgen, Saupe, Mandelbrot et al. — "The Science of Fractal Images" (Appendix D)

---

## 10. Summary Table

| Aspect | DeepMandelbrot |
|---|---|
| WebGL version | 1.0 |
| Shader lines | ~94 GLSL |
| Precision library | Jampary (floating-point expansions, ~60 digits) |
| Deep zoom technique | Perturbation theory with reference orbit |
| Coloring | Stripe average + cosine palette |
| Smooth coloring | Yes (renormalized iteration count) |
| Distance estimation | Yes (Hubbard-Douady) |
| Orbit traps | No |
| Interior coloring | Darkened copper (not black) |
| Supersampling | Adaptive 5x RGSS, DE-triggered |
| Ping-pong rendering | Listed as done but not in current source |
| Max iterations | 1024 default, 3000 shader limit |
| Escape radius | ~548 (squareRadius = 3e5) |
