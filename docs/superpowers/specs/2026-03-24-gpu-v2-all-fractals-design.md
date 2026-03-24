# GPU v2 — All Fractals in GLSL — Design Spec

**Date**: 2026-03-24
**Scope**: Port Julia, BurningShip, Tricorn, Multibrot iteration chunks to GLSL. Classic coloring only.
**Prerequisite**: GPU v1 done (Mandelbrot + Classic, measured 0.04ms @256iter)
**Forward-compatible**: Signature includes `dz` param for v3 coloring modes (distance estimation)

---

## 1. Changes

### New GLSL chunks (in `shaders/index.ts`)

4 new `iterate()` implementations, each mirroring the CPU fast path in `domain/fractals.ts`:

| Chunk | @mirror | Formula | Pre-test |
|---|---|---|---|
| `juliaIterationChunk` | `fractals.ts:juliaFastPath` | z₀ = c_pixel, c = uniform(juliaRe, juliaIm), z = z² + c | None |
| `burningshipIterationChunk` | `fractals.ts:burningShipFastPath` | z = (abs(Re), abs(Im))² + c | None |
| `tricornIterationChunk` | `fractals.ts:tricornFastPath` | z = conj(z)² + c (negate Im before squaring) | None |
| `multibrotIterationChunk` | `fractals.ts:multibrotFastPath` | z = z^n + c via direct multiplication, n = uniform(power) | None |

No cardioid/bulb pre-test for Julia/BurningShip/Tricorn/Multibrot (only valid for Mandelbrot z²).
No periodicity checking on GPU (research finding: warp divergence negates gains).

### Modified files

| File | Change |
|---|---|
| `shaders/index.ts` | Add 4 iteration chunks + 3 uniforms to headerChunk + update accumulatorNoop signature |
| `shaderCompiler.ts` | Register 4 new entries in `ITERATION_CHUNKS` + `ACCUMULATOR_CHUNKS` + add uniform names |
| `webglRenderer.ts` | Set `u_juliaRe`, `u_juliaIm`, `u_power` uniforms in render |

### Zero changes

renderer.ts, useRenderer.ts, useViewportTransition.ts, paletteTexture.ts, gpuDetector.ts, gpuFramebuffer.ts — all unchanged.

---

## 2. Signature forward-compatible for v3 (coloring modes)

### Current accumulatorNoop

```glsl
struct AccumState { float _unused; };
AccumState initAccumulator() { return AccumState(0.0); }
void updateAccumulator(vec2 z, inout AccumState acc) {}
```

### New accumulatorNoop (v2 — dz-ready)

```glsl
struct AccumState { float _unused; };
AccumState initAccumulator() { return AccumState(0.0); }
void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) {}
```

Added `vec2 dz` param. Noop ignores it. v3 real accumulator will use it for distance estimation.

### iterate() calls updateAccumulator with dz

Each `iterate()` computes `dz` (derivative) even in v2:
- Mandelbrot: `dz = 2*z*dz + 1` (complex multiply)
- Julia: `dz = 2*z*dz` (no +1 because dc/dc_pixel = 0 for Julia)
- BurningShip: `dz = 2*abs(z)*dz + 1`
- Tricorn: `dz = 2*conj(z)*dz + 1`
- Multibrot: `dz = n*z^(n-1)*dz + 1`

Cost: ~2 extra multiplies per iteration. On GPU at 0.04ms baseline, negligible.

---

## 3. Header uniforms

```glsl
uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_resolution;
uniform sampler2D u_palette;
uniform float u_juliaRe;    // Julia: c.re
uniform float u_juliaIm;    // Julia: c.im
uniform int u_power;         // Multibrot: exponent n
```

All uniforms set for all shaders. Unused ones are optimized away by the GPU compiler.

---

## 4. GLSL formulas (must match CPU exactly)

### Julia

```glsl
// @mirror domain/fractals.ts:juliaFastPath
// z₀ = pixel coordinate, c = constant (uniform)
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = c_pixel;                          // z₀ = pixel (not 0)
  vec2 c = vec2(u_juliaRe, u_juliaIm);  // c = fixed param
  vec2 dz = vec2(1.0, 0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) { escaped = true; iter = i; smoothVal = smoothEscape(i, x2 + y2); return; }
    // dz = 2*z*dz (Julia: dc/dc_pixel = 0)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y), 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
```

### BurningShip

```glsl
// @mirror domain/fractals.ts:burningShipFastPath
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);  // dz starts at 0 (z₀=0, dz₀=0)
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    z = abs(z);  // BurningShip: absolute value before squaring
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) { escaped = true; iter = i; smoothVal = smoothEscape(i, x2 + y2); return; }
    // dz = 2*abs(z)*dz + 1 (derivative uses folded z)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
```

### Tricorn

```glsl
// @mirror domain/fractals.ts:tricornFastPath
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);  // dz starts at 0 (z₀=0, dz₀=0)
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) { escaped = true; iter = i; smoothVal = smoothEscape(i, x2 + y2); return; }
    // dz = 2*conj(z)*dz + 1 (anti-holomorphic, approximate)
    dz = vec2(2.0*(z.x*dz.x + z.y*dz.y) + 1.0, 2.0*(-z.x*dz.y + z.y*dz.x));
    z.y = -z.y;  // Tricorn: conjugate z before squaring
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
```

### Multibrot (z^n)

```glsl
// @mirror domain/fractals.ts:multibrotFastPath
// Direct multiplication for z^n (not polar form — avoids atan2/cos/sin)
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);  // dz starts at 0 (z₀=0, dz₀=0)
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    float mod2 = z.x * z.x + z.y * z.y;
    if (mod2 > 4.0) { escaped = true; iter = i; smoothVal = smoothEscape(i, mod2); return; }

    // z^n via repeated complex multiplication, capture z^(n-1) for derivative
    vec2 zn = z;
    vec2 zprev = vec2(1.0, 0.0);
    for (int p = 1; p < u_power; p++) {
      zprev = zn;
      zn = vec2(zprev.x*z.x - zprev.y*z.y, zprev.x*z.y + zprev.y*z.x);
    }
    // dz = n*z^(n-1)*dz + 1
    float nf = float(u_power);
    dz = vec2(
      nf*(zprev.x*dz.x - zprev.y*dz.y) + 1.0,
      nf*(zprev.x*dz.y + zprev.y*dz.x)
    );

    z = zn + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
```

Note: the inner `for (p < u_power)` loop is bounded by uniform. GPU handles this efficiently for small n (3-5). `zprev` captures `z^(n-1)` for the derivative computation.

---

## 5. Uniform cache update

`shaderCompiler.ts` UNIFORM_NAMES:
```typescript
const UNIFORM_NAMES = ['u_center', 'u_scale', 'u_resolution', 'u_palette', 'u_juliaRe', 'u_juliaIm', 'u_power'];
```

`webglRenderer.ts` render() uniform setting:
```typescript
const juliaRe = uniformLocations.get('u_juliaRe');
const juliaIm = uniformLocations.get('u_juliaIm');
const power = uniformLocations.get('u_power');
if (juliaRe) gl.uniform1f(juliaRe, options.fractalParams.juliaRe ?? -0.7);
if (juliaIm) gl.uniform1f(juliaIm, options.fractalParams.juliaIm ?? 0.27015);
if (power) gl.uniform1i(power, options.fractalParams.power ?? 3);
```

Default values match `domain/types.ts:DEFAULT_JULIA_PARAMS` and Multibrot3 convention.

---

## 6. Mandelbrot iterate() update

The existing `mandelbrotIterationChunk` must also be updated to:
1. Add `vec2 dz` tracking
2. Call `updateAccumulator(z, dz, acc)` with the new signature

This is a non-breaking change — the noop accumulator ignores `dz`.

---

## 7. Benchmark plan

After implementation, measure each fractal GPU render time @256iter 1920x912 via Playwright + gl.finish(). Update `docs/performance-history.md` with measured values. No "TBD" or "expected".
