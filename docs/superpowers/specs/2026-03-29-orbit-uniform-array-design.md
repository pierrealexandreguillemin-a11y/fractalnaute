# E2a: Orbit Uniform Array — Design Spec

## Problem

Perturbation GPU render = ~50ms vs ~0.03ms standard render (1600x slower).
Hypothesis: dominated by 236M `texelFetch` calls (256 iter x 921K pixels).
Texture reads have cache/bandwidth overhead vs uniform access (register-speed).

## Goal

Replace orbit `sampler2D` texture with `uniform vec4 u_orbit[N]` array.
Test whether this reduces render time from ~50ms to <15ms.

If confirmed: texelFetch was the bottleneck, uniform array is the fix.
If not confirmed: bottleneck is elsewhere (iteration count, rebasing, etc.) — proceed to BLA.

## Architecture

### Current flow

```
WASM orbit (Float32Array) → orbitTexture.ts (RGBA32F texture) →
  GPU shader: texelFetch(u_orbitTexture, ivec2(...), 0) per iteration per pixel
```

### Target flow

```
WASM orbit (Float32Array) → webglRenderer.ts (gl.uniform4fv) →
  GPU shader: u_orbit[i] per iteration per pixel (register-speed)
```

Fallback: if `orbitLength > MAX_ORBIT_UNIFORMS`, use existing texture path.

### WebGL 2 uniform limits

- `MAX_FRAGMENT_UNIFORM_VECTORS` minimum guaranteed: 224 (spec)
- In practice: 1024+ on desktop, 256+ on mobile
- For 256 iterations: 256 vec4 = 256 uniform vectors — within spec minimum
- Query at init: `gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)`
- Subtract ~30 for other uniforms (viewport, palette, etc.) → safe limit ~190-220

### What changes

| File | Change | SRP |
|---|---|---|
| `perturbation.ts` | New header chunk: `uniform vec4 u_orbit[N]` | Shader data source |
| `shaderCompiler.ts` | Pass max orbit size as `#define` | Shader assembly |
| `webglRenderer.ts` | `gl.uniform4fv` instead of texture bind | GPU data upload |
| `orbitTexture.ts` | Keep for fallback (>N iterations) | Unchanged |

### Shader change (thin layer — same interface)

Before:
```glsl
uniform sampler2D u_orbitTexture;
uniform vec2 u_orbitTexSize;

vec4 getOrbitData(int i) {
  int texW = int(u_orbitTexSize.x);
  return texelFetch(u_orbitTexture, ivec2(i % texW, i / texW), 0);
}
```

After:
```glsl
#ifdef USE_ORBIT_UNIFORMS
uniform vec4 u_orbit[MAX_ORBIT_SIZE];

vec4 getOrbitData(int i) {
  return u_orbit[i];
}
#else
uniform sampler2D u_orbitTexture;
uniform vec2 u_orbitTexSize;

vec4 getOrbitData(int i) {
  int texW = int(u_orbitTexSize.x);
  return texelFetch(u_orbitTexture, ivec2(i % texW, i / texW), 0);
}
#endif
```

`#define USE_ORBIT_UNIFORMS` set by shader compiler when `maxIter <= MAX_ORBIT_SIZE`.

### JS upload change

Before:
```typescript
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, orbit.orbitTexture);
gl.uniform1i(orbitTexLoc, 1);
```

After:
```typescript
if (useUniformOrbit) {
  gl.uniform4fv(orbitLoc, orbitData);
} else {
  // existing texture path
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, orbit.orbitTexture);
  gl.uniform1i(orbitTexLoc, 1);
}
```

## ISO Compliance

### ISO 5055

- **Maintainability**: `getOrbitData(int i)` interface unchanged (SRP).
  Shader code outside the lookup function does not change.
  `#ifdef` keeps both paths for fallback (no dead code removal).
- **Reliability**: Query `MAX_FRAGMENT_UNIFORM_VECTORS` at runtime.
  Fallback to texture if uniform limit insufficient.
- **Performance**: `@tradeoff` on uniform limit constant.

### IEEE 754

No arithmetic change. Orbit data is identical — only the delivery mechanism changes.

### ISO 9241-110

No UX change. Render is faster (or same), no new UI elements.

## Testing

### Functional

- Pixel-perfect regression: uniform path output must match texture path output.
  Test: render same viewport with both paths, compare Float32Array from readPixels.
- Fallback: force orbit length > uniform limit, verify texture path activates.

### Performance

- Playwright benchmark: same 3 coordinates (10^-14, 10^-20, 10^-40).
- Node.js direct timing: not applicable (GPU-only change).
- Compare with baseline 50ms. Success = <15ms.

## Performance Targets

| Metric | Current | Target | Success criteria |
|---|---|---|---|
| Perturbation GPU render @256iter | ~50ms | <15ms | Hypothesis confirmed |
| Standard GPU render @256iter | ~0.03ms | unchanged | No regression |
| Fallback (>256 iter) | ~50ms | ~50ms | Texture path preserved |

## References

- WebGL 2 spec: `MAX_FRAGMENT_UNIFORM_VECTORS` minimum 224
- GLSL ES 3.00: uniform array indexing with non-constant expression allowed
