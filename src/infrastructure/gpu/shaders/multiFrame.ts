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

/** DS header extension: adds lo-part correction uniforms. */
export const multiFrameDSHeaderChunk = /* glsl */ `
uniform vec2 u_centerLo;
uniform float u_scaleLo;
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
