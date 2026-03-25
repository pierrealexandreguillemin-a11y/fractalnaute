# GPU v3 — All 5 Coloring Modes in GLSL — Design Spec

**Date**: 2026-03-25
**Scope**: Port stripe, decomposition, orbitTrap, normalMap coloring + real accumulator + interior coloring + distance estimation to GLSL
**Prerequisite**: GPU v2 done (all 5 fractals, Classic only, dz tracking in place)
**Measured**: 0.030-0.050ms all modes @256iter 1920×912 (5200-10000x vs CPU)

---

## 1. Architecture

The composable chunk architecture from v1/v2 is extended with:
- **accumulatorRealChunk**: replaces accumulatorNoopChunk for non-classic modes (or classic + interior coloring)
- **4 new coloring chunks**: stripe, decomposition, orbitTrap, normalMap — each implements `mapToParam()` + `computeLightness()`
- **Updated mainChunk**: interior coloring support + lightness modulation

The `iterate()` contract is UNCHANGED — all 5 fractal chunks already pass `dz` to `updateAccumulator()`.

---

## 2. AccumState struct (unified)

Both noop and real accumulators share the same struct layout so `mainChunk` can access `acc.trapDistSq` for interior coloring regardless of mode:

```glsl
struct AccumState {
  float stripeSum;
  float prevStripeSum;
  float trapDistSq;
  int count;
  vec2 dz;
};
```

**Noop** (classic, no interior): initializes struct, skips per-iteration work (no atan/sin/min). Only stores `dz`.
**Real** (stripe/decomp/orbitTrap/normalMap, OR classic+interior): full per-iteration accumulation.

### Accumulator selection (@mirror renderBand.ts:needsAccum)

```typescript
const needsRealAccum = coloring !== 'classic' || interiorColoring;
```

This is injected at shader assembly time. The `ShaderKey` includes `interiorColoring: boolean` to cache both variants.

---

## 3. Real accumulator chunk

```glsl
// @mirror domain/coloringAccumulator.ts
AccumState initAccumulator() { return AccumState(0.0, 0.0, 1e20, 0, vec2(0.0)); }

void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) {
  float arg = atan(z.y, z.x);
  acc.prevStripeSum = acc.stripeSum;
  acc.stripeSum += 0.5 * sin(STRIPE_DENSITY * arg) + 0.5;
  acc.count++;
  acc.dz = dz;
  float distSq = z.x * z.x + z.y * z.y;
  if (distSq < acc.trapDistSq) { acc.trapDistSq = distSq; }
}
```

---

## 4. Coloring chunks

Each implements two functions:
- `float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter)` — palette parameter t ∈ [0,1]
- `float computeLightness(AccumState acc, vec2 z)` — lightness multiplier (1.0 = no change)

### stripe (@mirror coloringModes.ts:stripeToParam)
- Lerps between prev/current stripe sum using fractional smooth value
- `base + stripeVal * 0.5`

### decomposition (@mirror coloringModes.ts:decompToParam)
- Binary: `atan(z.y, z.x) >= 0 ? 0.15 : 0.65`

### orbitTrap (@mirror coloringModes.ts:trapToParam)
- `log(1 + min(sqrt(trapDistSq), 4)) / log(5)` combined with base iteration

### normalMap (@mirror coloringModes.ts:normalToParam + computeNormalLightness)
- `mapToParam`: base iteration * 0.7 + escape angle * 0.3
- `computeLightness`: distance estimation via `|z|*log(|z|)/|dz|`, directional lighting via `cos(angle - NORMAL_MAP_LIGHT_ANGLE)`, height field via `log(1 + DE*10)`

---

## 5. Main template update

```glsl
void main() {
  // ... iterate ...
  if (!escaped) {
    if (u_interiorColoring > 0) {
      float trapDist = sqrt(acc.trapDistSq);
      float t = min(trapDist, 2.0) / 2.0;
      vec3 color = paletteLookup(t) * INTERIOR_ATTENUATION;
      fragColor = vec4(color, 1.0);
    } else {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
    return;
  }
  float t = mapToParam(smoothVal, acc, z, iter);
  float lightness = computeLightness(acc, z);
  vec3 color = paletteLookup(t) * lightness;
  fragColor = vec4(color, 1.0);
}
```

---

## 6. Domain constants (DRY)

All #defines sourced from domain TypeScript exports:

| #define | Source | Value |
|---|---|---|
| `COLOR_CYCLE_PERIOD` | `coloringModes.ts:COLOR_CYCLE_PERIOD` | 256.0 |
| `STRIPE_DENSITY` | `coloringAccumulator.ts:STRIPE_DENSITY` | 5.0 |
| `ORBIT_TRAP_CYCLE` | `coloringModes.ts:ORBIT_TRAP_CYCLE` | 64.0 |
| `NORMAL_MAP_LIGHT_ANGLE` | `coloringModes.ts:NORMAL_MAP_LIGHT_ANGLE` | -0.7854 |
| `INTERIOR_ATTENUATION` | `coloringModes.ts:INTERIOR_ATTENUATION` | 0.4 |

---

## 7. Uniform addition

`u_interiorColoring` (int, 0 or 1) added to header chunk and UNIFORM_NAMES.

---

## 8. Shader compiler changes

- `ACCUMULATOR_CHUNKS` registry removed — replaced by ternary logic in `assembleFragmentSource`
- `ShaderKey` extended to `${FractalType}_${ColoringMode}_${number}_${boolean}` (includes interiorColoring)
- `COLORING_CHUNKS` expanded to all 5 modes

---

## 9. Additional fixes applied during implementation

- **AccumState struct unified**: noop and real accumulators share the same struct layout (mainChunk uses `acc.trapDistSq`)
- **Export PNG fix**: `getCanvas()` API on WebGLRenderer, `exportImage` uses GPU canvas when active
- **Pre-compile common variants**: `requestIdleCallback` compiles 4 non-default fractal shaders during idle time
- **GPU/CPU parity tests**: 17 mathematical tests verify formula equivalence (screenToComplex, smoothEscape, cardioid, iteration)

---

## 10. Measured benchmarks

| Mode | GPU (ms) | CPU (ms) | Gain |
|---|---|---|---|
| Classic | 0.030 | 228 | ~7600x |
| Stripe | 0.040 | 400 | ~10000x |
| Decomposition | 0.035 | 230 | ~6571x |
| Orbit Trap | 0.035 | 250 | ~7143x |
| Normal Map | 0.050 | 260 | ~5200x |

All 25 fractal×coloring combinations GPU-rendered. Verified via Playwright screenshots.
