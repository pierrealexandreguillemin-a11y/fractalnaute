/**
 * GLSL chunks for perturbation rendering.
 * Reference orbit loaded from RGBA32F texture.
 * Rebasing (Zhuoran 2021) handles glitches in-shader.
 *
 * @see docs/superpowers/specs/2026-03-26-perturbation-theory-design.md §4
 */

/** Uniforms for orbit texture and reference point metadata. */
export const perturbationHeaderChunk = /* glsl */ `
uniform sampler2D u_orbitTexture;
uniform int u_orbitLength;
uniform vec2 u_orbitTexSize;
uniform vec2 u_refPoint;
uniform vec2 u_refPointLo;
uniform float u_rescaleS;
`;

/** Orbit texture lookup — one RGBA32F texel per iteration. */
export const orbitLookupChunk = /* glsl */ `
vec4 getOrbitData(int i) {
  int texW = int(u_orbitTexSize.x);
  return texelFetch(u_orbitTexture, ivec2(i % texW, i / texW), 0);
}
`;

/**
 * Glitch threshold for rebasing (Heiland-Allen criterion).
 * When |z|² < G·|Z|², catastrophic cancellation risk — rebase.
 * G ∈ [1e-8, 1e-2]. 1e-6 is a reasonable default.
 */
const GLITCH_THRESHOLD = '1e-6';

/**
 * Mandelbrot perturbation iteration with rebasing (Zhuoran 2021).
 *
 * Mathematical formulas (ISO 80000-2), rescaled (spec F1):
 *   δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c  where δ̃ = δ×S, S = u_rescaleS
 *   δ'_{n+1} = 2·(Z'_n·δ_n + z_n·δ'_n)   (unchanged, S cancels)
 *   z_n = Z_n + δ̃_n/S  (full position = reference + delta/S)
 *
 * Rebasing: when |z|² < G·|Z|² → δ̃ = z×S, restart from orbit[0].
 *
 * GLSL variables mapping (see spec §0 Glossary):
 *   u,v = Re(δ̃), Im(δ̃)   dc_re,dc_im = Re(δ̃c), Im(δ̃c)
 *   O = Z_n (reference)    dO = Z'_n (reference derivative)
 *   z = z_n (full pos)     du,dv = Re(δ̃'), Im(δ̃')
 *
 * @mirror domain/fractals.ts:calculateMandelbrot (conceptually)
 */
export const mandelbrotPerturbationChunk = /* glsl */ `
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  // δc = c_pixel - c_ref (constant per pixel, cached)
  // ISO 80000-2: (u,v) ≡ (Re(δ̃), Im(δ̃)), see spec §0 Glossary
  vec2 ds_re, ds_im;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
  float dc_re = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float dc_im = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  // Rescale deltas: δ̃ = δ × S (spec F1)
  float invS = 1.0 / u_rescaleS;
  dc_re *= u_rescaleS;
  dc_im *= u_rescaleS;

  // δ̃_0 = δ̃c
  float u = dc_re;
  float v = dc_im;
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = u_rescaleS, dv = 0.0;  // dδ̃/dδc starts at S (rescaled)

  int refIter = 0;

  for (int i = 0; i < MAX_ITER; i++) {
    #ifdef USE_BLA
    if (tryBlaSkip(u, v, refIter, i, vec2(dc_re, dc_im), z, escaped, iter, smoothVal)) {
      if (escaped) return;
      continue;
    }
    #endif
    if (refIter >= u_orbitLength) break;

    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;   // Z_n
    vec2 dO = orbitData.zw;  // Z'_n

    // z = Z + δ̃/S (full position in real coordinates)
    z = O + vec2(u, v) * invS;
    float zz = z.x * z.x + z.y * z.y;

    // NaN/Inf guard (IEEE 754-2019)
    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    // Escape test
    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    // Rebasing (Zhuoran 2021): |z|² < G·|Z|² → δ̃ = z×S, restart orbit
    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x * u_rescaleS;
      v = z.y * u_rescaleS;
      du = dz.x * u_rescaleS;
      dv = dz.y * u_rescaleS;
      refIter = 0;
      continue;
    }

    // δ' = 2·(Z'·δ + z·δ')  (perturbation derivative)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c
    float temp_u = u*u*invS - v*v*invS + 2.0*(u*O.x - v*O.y) + dc_re;
    v = 2.0*u*v*invS + 2.0*(v*O.x + u*O.y) + dc_im;
    u = temp_u;

    refIter++;

    // Recompute full position and derivative for accumulator
    // z_{n+1} = Z_{n+1} + δ̃_{n+1}/S (need next orbit entry)
    if (refIter < u_orbitLength) {
      vec4 nextOrbit = getOrbitData(refIter);
      z = nextOrbit.xy + vec2(u, v) * invS;
      dz = nextOrbit.zw + vec2(du, dv) * invS;
    }
    updateAccumulator(z, dz, acc);
  }

  iter = MAX_ITER;
}
`;

/**
 * Julia perturbation iteration with rebasing.
 * Same as Mandelbrot but δc = 0 (c is constant, not per-pixel).
 * δ_0 = pixel - ref (coordinate delta).
 * Reference orbit computed with c = juliaC.
 */
export const juliaPerturbationChunk = /* glsl */ `
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  // δ_0 = pixel - ref (no δc term for Julia)
  // ISO 80000-2: (u,v) ≡ (Re(δ), Im(δ)), see spec §0 Glossary
  vec2 ds_re, ds_im;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
  float u = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float v = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = 1.0, dv = 0.0;

  int refIter = 0;

  for (int i = 0; i < MAX_ITER; i++) {
    #ifdef USE_BLA
    // Julia: dc = 0 (c is constant, not per-pixel)
    if (tryBlaSkip(u, v, refIter, i, vec2(0.0, 0.0), z, escaped, iter, smoothVal)) {
      if (escaped) return;
      continue;
    }
    #endif
    if (refIter >= u_orbitLength) break;

    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;
    vec2 dO = orbitData.zw;

    z = O + vec2(u, v);
    float zz = z.x * z.x + z.y * z.y;

    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x;
      v = z.y;
      du = dz.x;
      dv = dz.y;
      refIter = 0;
      continue;
    }

    // δ' = 2·(Z'·δ + z·δ') (Julia: no +1 term)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ_{n+1} = 2·Z_n·δ_n + δ_n²  (NO + δc for Julia)
    float temp_u = u*u - v*v + 2.0*(u*O.x - v*O.y);
    v = 2.0*u*v + 2.0*(v*O.x + u*O.y);
    u = temp_u;

    refIter++;

    // Recompute full position and derivative for accumulator
    // z_{n+1} = Z_{n+1} + δ_{n+1} (need next orbit entry)
    if (refIter < u_orbitLength) {
      vec4 nextOrbit = getOrbitData(refIter);
      z = nextOrbit.xy + vec2(u, v);
      dz = nextOrbit.zw + vec2(du, dv);  // full derivative = Z' + δ'
    }
    updateAccumulator(z, dz, acc);
  }

  iter = MAX_ITER;
}
`;

/** Uniform names added by perturbation chunks. */
export const PERTURBATION_UNIFORM_NAMES = [
  'u_orbitTexture', 'u_orbitLength', 'u_orbitTexSize',
  'u_refPoint', 'u_refPointLo', 'u_rescaleS'
];
