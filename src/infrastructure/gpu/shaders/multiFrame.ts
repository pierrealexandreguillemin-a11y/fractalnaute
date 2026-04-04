/**
 * Multi-frame batch GLSL chunks for ping-pong rendering.
 * Each chunk is a complete void main() that:
 * 1. Reads previous state from 4 input textures (texelFetch)
 * 2. If pixel already escaped or hit max iter -> pass through
 * 3. Iterates BATCH_SIZE (256) more times
 * 4. Writes new state to 4 MRT outputs (RGBA32F)
 *
 * State layout (4 MRT x RGBA32F):
 *   T_Z    (loc=0): z.x|ds_zre.hi, z.y|ds_zre.lo, 0|ds_zim.hi, 0|ds_zim.lo
 *   T_Info (loc=1): float(iter), float(escaped), smoothVal, float(count)
 *   T_Acc  (loc=2): dz.x, dz.y, stripeSum, trapDistSq
 *   T_Hist (loc=3): stripePrev1, stripePrev2, stripePrev3, 0
 *
 * @see multiFrameRenderer.ts for FBO management
 * @see shaders/index.ts for single-pass equivalents
 */

// ---- Shared GLSL string fragments (DRY: sonarjs/no-duplicate-string) --------

const PRECISION_HEADER = `precision highp float;
precision highp int;`;

const MRT_OUTPUTS = `layout(location = 0) out vec4 outZ;
layout(location = 1) out vec4 outInfo;
layout(location = 2) out vec4 outAcc;
layout(location = 3) out vec4 outHist;`;

const PREV_TEXTURE_UNIFORMS = `uniform sampler2D u_prevZ;
uniform sampler2D u_prevInfo;
uniform sampler2D u_prevAcc;
uniform sampler2D u_prevHist;`;

const COMMON_UNIFORMS = `uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_resolution;
uniform int u_totalMaxIter;
uniform float u_bailoutSq;`;

/** texelFetch from 4 previous-state textures + variable declarations. */
const READ_PREV_STATE = `  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec4 pZ = texelFetch(u_prevZ, fc, 0);
  vec4 pInfo = texelFetch(u_prevInfo, fc, 0);
  vec4 pAcc = texelFetch(u_prevAcc, fc, 0);
  vec4 pHist = texelFetch(u_prevHist, fc, 0);

  int prevIter = int(pInfo.r);
  float prevEscaped = pInfo.g;
  float smoothVal = pInfo.b;
  int count = int(pInfo.a);`;

/** Early-exit passthrough when pixel is already done. */
const PASSTHROUGH_CHECK = `  if (prevEscaped > 0.5 || prevIter >= u_totalMaxIter) {
    outZ = pZ; outInfo = pInfo; outAcc = pAcc; outHist = pHist;
    return;
  }`;

/** Restore accumulator state from previous textures. */
const RESTORE_ACCUMULATOR = `  vec2 dz = pAcc.xy;
  float stripeSum = pAcc.z;
  float trapDistSq = pAcc.w;
  float sp1 = pHist.x;
  float sp2 = pHist.y;
  float sp3 = pHist.z;`;

/**
 * @mirror shaders/index.ts:accumulatorRealChunk — updateAccumulator body.
 * Inlined in every batch loop for MRT compatibility (no AccumState struct).
 */
const ACCUMULATOR_UPDATE = `    // @mirror shaders/index.ts:accumulatorRealChunk
    sp3 = sp2; sp2 = sp1; sp1 = stripeSum;
    float zz = z.x * z.x + z.y * z.y;
    if (zz > 0.0) stripeSum += z.x * z.y / zz;
    count++;
    if (zz < trapDistSq) trapDistSq = zz;`;

/** Write final MRT state (escaped path). */
const WRITE_ESCAPED = `      outZ = vec4(z, 0.0, 0.0);
      outInfo = vec4(float(prevIter + i + 1), 1.0, smoothVal, float(count));
      outAcc = vec4(dz, stripeSum, trapDistSq);
      outHist = vec4(sp1, sp2, sp3, 0.0);
      return;`;

/** Write final MRT state (continue path — batch exhausted, not escaped). */
const WRITE_CONTINUE = `  outZ = vec4(z, 0.0, 0.0);
  outInfo = vec4(float(prevIter + BATCH_SIZE), 0.0, 0.0, float(count));
  outAcc = vec4(dz, stripeSum, trapDistSq);
  outHist = vec4(sp1, sp2, sp3, 0.0);`;

/** smoothEscape for logBase=2 (Mandelbrot, Julia, BurningShip, Tricorn). */
const SMOOTH_ESCAPE_FN = `
// @mirror shaders/index.ts:smoothEscapeChunk
float smoothEscape(int iter, float mod2) {
  return float(iter) + 1.0 - log2(0.5 * log2(mod2));
}`;

/** smoothEscapeGeneral for arbitrary power (Multibrot). */
const SMOOTH_ESCAPE_GENERAL_FN = `
// @mirror shaders/index.ts:smoothEscapeChunk (general form)
float smoothEscapeGeneral(int iter, float mod2, float logBase) {
  float lnBase = log(logBase);
  float logZn = log(mod2) * 0.5;
  return float(iter) + 1.0 - log(logZn / lnBase) / lnBase;
}`;

/**
 * @mirror domain/coordinates.ts:screenToComplex
 * @mirror shaders/index.ts:screenToComplexChunk
 */
const SCREEN_TO_COMPLEX_FN = `
vec2 screenToComplex(vec2 fragCoord, vec2 center, float scale, vec2 resolution) {
  float aspect = resolution.x / resolution.y;
  vec2 uv = fragCoord / resolution - 0.5;
  return center + vec2(uv.x * scale * aspect, -uv.y * scale);
}`;

/**
 * IEEE 754-2019 NaN/Inf guard template.
 * @mirror shaders/perturbation.ts:95
 * zVal must be a vec2 variable in scope.
 */
const makeNanInfGuard = (zExpr: string): string => `    // @mirror shaders/perturbation.ts:95 — IEEE 754-2019 NaN/Inf guard
    if (isnan(${zExpr}.x) || isnan(${zExpr}.y) || isinf(${zExpr}.x) || isinf(${zExpr}.y)) {
      outZ = pZ;
      outInfo = vec4(float(u_totalMaxIter), 0.0, 0.0, float(count));
      outAcc = vec4(dz, stripeSum, trapDistSq);
      outHist = vec4(sp1, sp2, sp3, 0.0);
      return;
    }`;

// ---- Header chunks ----------------------------------------------------------

/** Shared batch header (all 5 fractals). BATCH_SIZE injected as #define by assembler. */
export const multiFrameBatchHeaderChunk = /* glsl */ `#version 300 es
${PRECISION_HEADER}

${COMMON_UNIFORMS}
${PREV_TEXTURE_UNIFORMS}

${MRT_OUTPUTS}
`;


/** Julia header extension: adds Julia c constant uniforms. */
export const multiFrameJuliaHeaderChunk = /* glsl */ `
uniform float u_juliaRe;
uniform float u_juliaIm;
`;

/** Multibrot header extension: adds power uniform. */
export const multiFrameMultibrotHeaderChunk = /* glsl */ `
uniform int u_power;
`;

// ---- Batch main() chunks ----------------------------------------------------

/**
 * Mandelbrot DS (double-single precision) batch shader.
 * @mirror shaders/index.ts:mandelbrotDSIterationChunk
 * @mirror shaders/doubleSingle.ts — ds_sq, ds_mul, ds_add, ds_sub, ds_mul_float
 */
export const mandelbrotDSBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}
${RESTORE_ACCUMULATOR}

  // Read DS z state from T_Z: (ds_zre.hi, ds_zre.lo, ds_zim.hi, ds_zim.lo)
  vec2 ds_zre = pZ.xy;
  vec2 ds_zim = pZ.zw;

  // Compute c in double-single from DS uniforms
  // @mirror shaders/doubleSingle.ts:screenToComplexDSChunk
  vec2 ds_cre, ds_cim;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_cre, ds_cim);

  // @mirror shaders/index.ts:mandelbrotIterationChunk — cardioid/bulb pre-test
  if (prevIter == 0) {
    float cx = ds_cre.x, cy = ds_cim.x;
    float xmq = cx - 0.25;
    float cy2 = cy * cy;
    float q = xmq * xmq + cy2;
    if (q * (q + xmq) <= 0.25 * cy2) {
      outZ = pZ;
      outInfo = vec4(float(u_totalMaxIter), 0.0, 0.0, 0.0);
      outAcc = pAcc; outHist = pHist;
      return;
    }
    float xp1 = cx + 1.0;
    if (xp1 * xp1 + cy2 <= 0.0625) {
      outZ = pZ;
      outInfo = vec4(float(u_totalMaxIter), 0.0, 0.0, 0.0);
      outAcc = pAcc; outHist = pHist;
      return;
    }
  }

  vec2 z = vec2(ds_zre.x, ds_zim.x);

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    // Escape test on float32 hi parts
    // @mirror shaders/index.ts:mandelbrotDSIterationChunk
    float x2 = ds_zre.x * ds_zre.x;
    float y2 = ds_zim.x * ds_zim.x;
    if (x2 + y2 > u_bailoutSq) {
      smoothVal = smoothEscape(prevIter + i, x2 + y2);
      z = vec2(ds_zre.x, ds_zim.x);
      outZ = vec4(ds_zre, ds_zim);
      outInfo = vec4(float(prevIter + i + 1), 1.0, smoothVal, float(count));
      outAcc = vec4(dz, stripeSum, trapDistSq);
      outHist = vec4(sp1, sp2, sp3, 0.0);
      return;
    }

    // @mirror shaders/index.ts:mandelbrotDSIterationChunk — dz = 2*z*dz + 1
    dz = vec2(2.0*(ds_zre.x*dz.x - ds_zim.x*dz.y) + 1.0,
              2.0*(ds_zre.x*dz.y + ds_zim.x*dz.x));

    // z_new = z^2 + c in DS arithmetic
    // @mirror shaders/doubleSingle.ts — ds_sq, ds_mul, ds_add, ds_sub
    vec2 ds_x2 = ds_sq(ds_zre);
    vec2 ds_y2 = ds_sq(ds_zim);
    vec2 ds_xy = ds_mul(ds_zre, ds_zim);
    ds_zre = ds_add(ds_sub(ds_x2, ds_y2), ds_cre);
    ds_zim = ds_add(ds_mul_float(ds_xy, 2.0), ds_cim);

    // Accumulator uses float32 hi parts
    z = vec2(ds_zre.x, ds_zim.x);

${makeNanInfGuard('z')}
${ACCUMULATOR_UPDATE}
  }

  // Continue: write DS state back
  outZ = vec4(ds_zre, ds_zim);
  outInfo = vec4(float(prevIter + BATCH_SIZE), 0.0, 0.0, float(count));
  outAcc = vec4(dz, stripeSum, trapDistSq);
  outHist = vec4(sp1, sp2, sp3, 0.0);
}
`;

/**
 * Julia batch shader (float32).
 * @mirror shaders/index.ts:juliaIterationChunk
 * Key differences from Mandelbrot: z0=pixel (not 0), dz0=1 (not 0), dz=2z*dz (no +1).
 */
export const juliaBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}
${SCREEN_TO_COMPLEX_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}
${RESTORE_ACCUMULATOR}

  vec2 z = pZ.xy;
  vec2 c = vec2(u_juliaRe, u_juliaIm);

  // @mirror shaders/index.ts:juliaIterationChunk — z0=pixel, dz0=(1,0)
  if (prevIter == 0) {
    z = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);
    dz = vec2(1.0, 0.0);
  }

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > u_bailoutSq) {
      smoothVal = smoothEscape(prevIter + i, x2 + y2);
${WRITE_ESCAPED}
    }

    // @mirror shaders/index.ts:juliaIterationChunk — dz = 2*z*dz (NO +1)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y), 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;

${makeNanInfGuard('z')}
${ACCUMULATOR_UPDATE}
  }

${WRITE_CONTINUE}
}
`;

/**
 * BurningShip batch shader (float32).
 * @mirror shaders/index.ts:burningshipIterationChunk
 * Key: abs(z) BEFORE squaring; dz uses folded (abs) z.
 */
export const burningshipBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}
${SCREEN_TO_COMPLEX_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}
${RESTORE_ACCUMULATOR}

  vec2 z = pZ.xy;
  vec2 c = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    // @mirror shaders/index.ts:burningshipIterationChunk — abs(z) BEFORE squaring
    z = abs(z);
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > u_bailoutSq) {
      smoothVal = smoothEscape(prevIter + i, x2 + y2);
${WRITE_ESCAPED}
    }

    // @mirror shaders/index.ts:burningshipIterationChunk — dz uses folded z
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;

${makeNanInfGuard('z')}
${ACCUMULATOR_UPDATE}
  }

${WRITE_CONTINUE}
}
`;

/**
 * Tricorn batch shader (float32).
 * @mirror shaders/index.ts:tricornIterationChunk
 * Key: z.y = -z.y (conjugate) BEFORE squaring; dz = 2*conj(z)*dz + 1.
 */
export const tricornBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}
${SCREEN_TO_COMPLEX_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}
${RESTORE_ACCUMULATOR}

  vec2 z = pZ.xy;
  vec2 c = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > u_bailoutSq) {
      smoothVal = smoothEscape(prevIter + i, x2 + y2);
${WRITE_ESCAPED}
    }

    // @mirror shaders/index.ts:tricornIterationChunk — dz = 2*conj(z)*dz + 1
    dz = vec2(2.0*(z.x*dz.x + z.y*dz.y) + 1.0, 2.0*(-z.x*dz.y + z.y*dz.x));
    // Conjugate z AFTER dz (same order as single-pass)
    z.y = -z.y;
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;

${makeNanInfGuard('z')}
${ACCUMULATOR_UPDATE}
  }

${WRITE_CONTINUE}
}
`;

/**
 * Multibrot batch shader (float32).
 * @mirror shaders/index.ts:multibrotIterationChunk
 * Key: z^n via repeated complex multiplication; smoothEscapeGeneral.
 */
export const multibrotBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}
${SMOOTH_ESCAPE_GENERAL_FN}
${SCREEN_TO_COMPLEX_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}
${RESTORE_ACCUMULATOR}

  vec2 z = pZ.xy;
  vec2 c = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    float mod2 = z.x * z.x + z.y * z.y;
    if (mod2 > u_bailoutSq) {
      smoothVal = smoothEscapeGeneral(prevIter + i, mod2, float(u_power));
${WRITE_ESCAPED}
    }

    // @mirror shaders/index.ts:multibrotIterationChunk — z^n via repeated complex mul
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

${makeNanInfGuard('z')}
${ACCUMULATOR_UPDATE}
  }

${WRITE_CONTINUE}
}
`;

// ---- Perturbation batch header & chunks ------------------------------------

/**
 * Perturbation batch header: orbit texture uniforms + getOrbitData lookup.
 * Used as header extension for perturbation multi-frame batch shaders.
 * @mirror perturbation.ts:10-18 — perturbationHeaderChunk (orbit uniforms)
 * @mirror perturbation.ts:21-26 — orbitLookupChunk (getOrbitData)
 */
export const perturbationBatchHeaderChunk = /* glsl */ `
uniform sampler2D u_orbitTexture;
uniform int u_orbitLength;
uniform vec2 u_orbitTexSize;
uniform vec2 u_refPoint;
uniform vec2 u_refPointLo;
uniform float u_rescaleS;

// @mirror perturbation.ts:21-26 — orbit texture lookup
vec4 getOrbitData(int i) {
  int texW = int(u_orbitTexSize.x);
  return texelFetch(u_orbitTexture, ivec2(i % texW, i / texW), 0);
}
`;

/**
 * Glitch threshold for rebasing (Heiland-Allen criterion).
 * @mirror perturbation.ts:33 — GLITCH_THRESHOLD
 */
const PERTURB_GLITCH_THRESHOLD = '1e-6';

/**
 * Mandelbrot perturbation batch shader (multi-frame ping-pong).
 *
 * State layout (different from DS batch):
 *   T_Z    (loc=0): u (δ̃.re), v (δ̃.im), du (δ̃'.re), dv (δ̃'.im)
 *   T_Info (loc=1): float(iter), float(escaped), smoothVal, float(count)
 *   T_Acc  (loc=2): z.x, z.y, stripeSum, trapDistSq
 *   T_Hist (loc=3): stripePrev1, stripePrev2, stripePrev3, float(refIter)
 *
 * Mathematical formulas (ISO 80000-2), rescaled (spec F1):
 *   δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c
 *   δ'_{n+1} = 2·(Z'_n·δ_n + z_n·δ'_n)
 *   z_n = Z_n + δ̃_n/S
 *   Rebasing: |z|² < G·|Z|² → δ̃ = z×S, refIter=0
 *
 * @mirror perturbation.ts:52-143 — mandelbrotPerturbationChunk
 */
export const mandelbrotPerturbationBatchChunk = /* glsl */ `
${SMOOTH_ESCAPE_FN}

void main() {
${READ_PREV_STATE}
${PASSTHROUGH_CHECK}

  // Restore perturbation state from previous batch
  float u = pZ.x;       // δ̃.re
  float v = pZ.y;       // δ̃.im
  float du = pZ.z;      // δ̃'.re
  float dv = pZ.w;      // δ̃'.im
  float stripeSum = pAcc.z;
  float trapDistSq = pAcc.w;
  float sp1 = pHist.x;
  float sp2 = pHist.y;
  float sp3 = pHist.z;
  int refIter = int(pHist.w);

  // @mirror shaders/doubleSingle.ts:screenToComplexDSChunk — c_pixel in DS
  vec2 ds_cre, ds_cim;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_cre, ds_cim);

  // @mirror perturbation.ts:59-65 — δc = c_pixel - refPoint, δ̃c = δc × S
  float invS = 1.0 / u_rescaleS;
  float dc_re = (ds_cre.x - u_refPoint.x + (ds_cre.y - u_refPointLo.x)) * u_rescaleS;
  float dc_im = (ds_cim.x - u_refPoint.y + (ds_cim.y - u_refPointLo.y)) * u_rescaleS;

  // @mirror perturbation.ts:68-75 — init at first batch
  if (prevIter == 0) {
    u = dc_re;
    v = dc_im;
    du = u_rescaleS;
    dv = 0.0;
    refIter = 0;
  }

  vec2 z = vec2(0.0);
  vec2 dz = vec2(du, dv);

  for (int i = 0; i < BATCH_SIZE; i++) {
    if (prevIter + i >= u_totalMaxIter) break;

    // @mirror perturbation.ts:84 — orbit bounds check
    if (refIter >= u_orbitLength) break;

    // @mirror perturbation.ts:86-88 — orbit lookup
    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;   // Z_n (reference)
    vec2 dO = orbitData.zw;  // Z'_n (reference derivative)

    // @mirror perturbation.ts:90-91 — z = Z + δ̃/S (full position)
    z = O + vec2(u, v) * invS;
    float zz = z.x * z.x + z.y * z.y;

    // @mirror perturbation.ts:100-105 — escape test
    if (zz > u_bailoutSq) {
      float smoothV = smoothEscape(prevIter + i, zz);
      outZ = vec4(u, v, du, dv);
      outInfo = vec4(float(prevIter + i + 1), 1.0, smoothV, float(count));
      outAcc = vec4(z, stripeSum, trapDistSq);
      outHist = vec4(sp1, sp2, sp3, float(refIter));
      return;
    }

${makeNanInfGuard('z')}

    // @mirror perturbation.ts:107-116 — rebasing (Zhuoran 2021)
    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${PERTURB_GLITCH_THRESHOLD} * OO) {
      u = z.x * u_rescaleS;
      v = z.y * u_rescaleS;
      du = dz.x * u_rescaleS;
      dv = dz.y * u_rescaleS;
      refIter = 0;
      // skip iteration update — continue with rebased state
      continue;
    }

    // @mirror perturbation.ts:118-122 — δ' = 2·(Z'·δ + z·δ')
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // @mirror perturbation.ts:124-127 — δ̃_{n+1} = 2·Z_n·δ̃_n + δ̃_n²/S + δ̃c
    float temp_u = u*u*invS - v*v*invS + 2.0*(u*O.x - v*O.y) + dc_re;
    v = 2.0*u*v*invS + 2.0*(v*O.x + u*O.y) + dc_im;
    u = temp_u;

    // @mirror perturbation.ts:129 — advance orbit index
    refIter++;

    // Recompute full z for accumulator (@mirror perturbation.ts:133-137)
    if (refIter < u_orbitLength) {
      vec4 nextOrbit = getOrbitData(refIter);
      z = nextOrbit.xy + vec2(u, v) * invS;
      dz = nextOrbit.zw + vec2(du, dv) * invS;
    }

${ACCUMULATOR_UPDATE}
  }

  // Continue: write perturbation state back for next batch
  outZ = vec4(u, v, du, dv);
  outInfo = vec4(float(prevIter + BATCH_SIZE), 0.0, 0.0, float(count));
  outAcc = vec4(z, stripeSum, trapDistSq);
  outHist = vec4(sp1, sp2, sp3, float(refIter));
}
`;

// ---- Resolve GLSL chunks ----------------------------------------------------
// Each resolve shader is a complete void main() that reads final iteration
// state from 4 textures (batch output) and maps to a color via fragColor.
// @see shaders/index.ts for single-pass equivalents (coloring chunks + mainChunk)

// ---- Shared resolve GLSL fragments (DRY: sonarjs/no-duplicate-string) -------

/** #version + precision for all resolve shaders. */
export const resolveHeaderChunk = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_stateZ;
uniform sampler2D u_stateInfo;
uniform sampler2D u_stateAcc;
uniform sampler2D u_stateHist;
uniform sampler2D u_palette;
uniform int u_interiorColoring;

out vec4 fragColor;
`;

/**
 * #define constants shared by all resolve shaders.
 * Values imported from domain layer by the assembler (Task 4).
 * Provided as a raw string here; the assembler will prepend after the header.
 */
export const RESOLVE_DEFINES = `#define COLOR_CYCLE_PERIOD 256.0
#define ORBIT_TRAP_CYCLE 64.0
#define NORMAL_MAP_LIGHT_ANGLE (-0.7854)
#define INTERIOR_ATTENUATION 0.4`;

/** Read final state from 4 textures — shared by all 5 resolve shaders. */
const RESOLVE_READ_STATE = `  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec4 sZ    = texelFetch(u_stateZ,    fc, 0);
  vec4 sInfo = texelFetch(u_stateInfo,  fc, 0);
  vec4 sAcc  = texelFetch(u_stateAcc,  fc, 0);

  vec2 z          = sZ.xy;
  float smoothVal = sInfo.b;
  int count       = int(sInfo.a);
  bool escaped    = sInfo.g > 0.5;
  vec2 dz         = sAcc.xy;
  float stripeSum = sAcc.z;
  float trapDistSq = sAcc.w;`;

/**
 * Interior path — shared by all 5 resolve shaders.
 * @mirror shaders/index.ts:mainChunk — interior path
 * Stripe resolve passes texture lookup (not cosine) for interior — see note below.
 */
const RESOLVE_INTERIOR_TEXTURE = `  // @mirror shaders/index.ts:mainChunk — interior path
  if (!escaped) {
    if (u_interiorColoring > 0) {
      float trapDist = sqrt(trapDistSq);
      float t = min(trapDist, 2.0) / 2.0;
      vec3 color = texture(u_palette, vec2(t, 0.5)).rgb * INTERIOR_ATTENUATION;
      fragColor = vec4(color, 1.0);
    } else {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
    return;
  }`;

// ---- Per-coloring resolve shaders -------------------------------------------

/**
 * Classic resolve: mod(smoothVal, 256) / 256 -> texture palette.
 * @mirror shaders/index.ts:classicColoringChunk — mapToParam
 * @mirror shaders/index.ts:mainChunk — escape dispatch
 */
export const resolveClassicChunk = /* glsl */ `
void main() {
${RESOLVE_READ_STATE}
${RESOLVE_INTERIOR_TEXTURE}

  // @mirror shaders/index.ts:classicColoringChunk — mapToParam
  float t = mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  vec3 color = texture(u_palette, vec2(t, 0.5)).rgb;
  fragColor = vec4(color, 1.0);
}
`;

/**
 * Stripe resolve: Catmull-Rom interpolation + cosine palette.
 * Interior uses texture palette (not cosine) for perceptual consistency.
 * @mirror shaders/index.ts:stripeColoringChunk — catmullRom + mapToParam
 * @mirror shaders/index.ts:mainChunk — escape dispatch
 */
export const resolveStripeChunk = /* glsl */ `
// @mirror shaders/index.ts:stripeColoringChunk — Catmull-Rom cubic interpolation
float catmullRom(float s0, float s1, float s2, float s3, float d) {
  float d2 = d * d, d3 = d * d2;
  return 0.5 * (
    s0 * (-d + 2.0 * d2 - d3) +
    s1 * (2.0 - 5.0 * d2 + 3.0 * d3) +
    s2 * (d + 4.0 * d2 - 3.0 * d3) +
    s3 * (d3 - d2)
  );
}

void main() {
${RESOLVE_READ_STATE}
  vec4 sHist = texelFetch(u_stateHist, fc, 0);
  float sp1 = sHist.x;
${RESOLVE_INTERIOR_TEXTURE}

  // @mirror shaders/index.ts:stripeColoringChunk — mapToParam
  float frac = smoothVal - floor(smoothVal);
  float ext = 2.0 * stripeSum - sp1;
  float interpolated = count >= 3
    ? catmullRom(sp1, stripeSum, ext, 2.0 * ext - stripeSum, frac)
    : stripeSum + frac * (ext - stripeSum);
  float stripeRatio = count > 0 ? interpolated / float(count) : 0.0;
  float amplitude = 0.7 + 2.5 * stripeRatio;
  float frequency = 50.0 * smoothVal / COLOR_CYCLE_PERIOD;
  float t = amplitude + frequency;
  // @mirror shaders/index.ts:cosinePaletteLookupChunk — Inigo Quilez cosine palette
  vec3 color = 0.5 + 0.5 * sin(t + vec3(4.0, 4.6, 5.2));
  fragColor = vec4(color, 1.0);
}
`;

/**
 * Decomposition resolve: binary angle -> texture palette.
 * @mirror shaders/index.ts:decompositionColoringChunk — mapToParam
 * @mirror shaders/index.ts:mainChunk — escape dispatch
 */
export const resolveDecompositionChunk = /* glsl */ `
void main() {
${RESOLVE_READ_STATE}
${RESOLVE_INTERIOR_TEXTURE}

  // @mirror shaders/index.ts:decompositionColoringChunk — mapToParam
  float angle = atan(z.y, z.x);
  float t = angle >= 0.0 ? 0.15 : 0.65;
  vec3 color = texture(u_palette, vec2(t, 0.5)).rgb;
  fragColor = vec4(color, 1.0);
}
`;

/**
 * OrbitTrap resolve: log-scaled trap distance + smoothVal blend -> texture palette.
 * @mirror shaders/index.ts:orbitTrapColoringChunk — mapToParam
 * @mirror shaders/index.ts:mainChunk — escape dispatch
 */
export const resolveOrbitTrapChunk = /* glsl */ `
void main() {
${RESOLVE_READ_STATE}
${RESOLVE_INTERIOR_TEXTURE}

  // @mirror shaders/index.ts:orbitTrapColoringChunk — mapToParam
  float d = min(sqrt(trapDistSq), 4.0);
  float logMapped = log(1.0 + d) / log(5.0);
  float base = mod(smoothVal, ORBIT_TRAP_CYCLE) / ORBIT_TRAP_CYCLE;
  float t = mod(logMapped * 0.6 + base * 0.4, 1.0);
  vec3 color = texture(u_palette, vec2(t, 0.5)).rgb;
  fragColor = vec4(color, 1.0);
}
`;

/**
 * NormalMap resolve: DE lightness + angle-blended palette -> texture palette.
 * @mirror shaders/index.ts:normalMapColoringChunk — mapToParam + computeLightness
 * @mirror shaders/index.ts:mainChunk — escape dispatch
 */
export const resolveNormalMapChunk = /* glsl */ `
void main() {
${RESOLVE_READ_STATE}
${RESOLVE_INTERIOR_TEXTURE}

  // @mirror shaders/index.ts:normalMapColoringChunk — mapToParam
  float base = mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  float angle = atan(z.y, z.x);
  float angleNorm = (angle + 3.14159265) / (2.0 * 3.14159265);
  float t = mod(base * 0.7 + angleNorm * 0.3, 1.0);
  vec3 color = texture(u_palette, vec2(t, 0.5)).rgb;

  // @mirror shaders/index.ts:normalMapColoringChunk — computeLightness (DE)
  float zMod = length(z);
  float dzMod = length(dz);
  float de = dzMod > 0.0 ? zMod * log(zMod) / dzMod : 0.0;
  float dotL = cos(atan(z.y, z.x) - NORMAL_MAP_LIGHT_ANGLE);
  float logDE = log(1.0 + de * 10.0);
  float height = min(logDE / 3.0, 1.0);
  float lightness = de <= 0.0 ? 0.5 : 0.2 + 1.2 * (dotL * 0.5 + 0.5) * (0.3 + 0.7 * height);
  color *= lightness;

  fragColor = vec4(color, 1.0);
}
`;
