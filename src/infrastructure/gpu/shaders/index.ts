// src/infrastructure/gpu/shaders/index.ts

// ---- Vertex shader (shared) ------------------------------------------------

export const fullscreenVert = /* glsl */ `#version 300 es
// Fullscreen triangle: 3 vertices, oversized to cover viewport
// Industry standard (Three.js) — more efficient than 2-triangle quad
// gl_VertexID arithmetic — zero buffer/attribute setup, only needs empty VAO
void main() {
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

// ---- Fragment shader chunks -------------------------------------------------

export const headerChunk = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_center;
uniform float u_scale;
uniform vec2 u_resolution;
uniform sampler2D u_palette;
uniform float u_juliaRe;
uniform float u_juliaIm;
uniform int u_power;
uniform int u_interiorColoring;
uniform int u_maxIter;
// GPU drivers need a compile-time loop cap. 32768 is safe on all WebGL2 GPUs.
// Actual iteration count is controlled by u_maxIter uniform (breaks early).
const int MAX_ITER_CAP = 32768;

out vec4 fragColor;
`;

/**
 * @mirror domain/coordinates.ts:screenToComplex
 * CPU: re = centerRe + (x/width - 0.5) * scale * aspect
 *      im = centerIm + (y/height - 0.5) * scale
 * where scale = visible height in complex-plane units
 * Y negated: WebGL y=0 is bottom of viewport, canvas y=0 is top
 */
export const screenToComplexChunk = /* glsl */ `
vec2 screenToComplex(vec2 fragCoord, vec2 center, float scale, vec2 resolution) {
  float aspect = resolution.x / resolution.y;
  vec2 uv = fragCoord / resolution - 0.5;
  // Negate Y: WebGL gl_FragCoord.y=0 is bottom, but canvas y=0 is top
  return center + vec2(uv.x * scale * aspect, -uv.y * scale);
}
`;

/**
 * @mirror domain/fractals.ts:smoothEscape (logBase=2 specialization)
 * CPU: iter + 1 - log(log(zRe2+zIm2)/2 / ln2) / ln2
 * Simplified: iter + 1 - log2(0.5 * log2(mod2))
 * Uses native log2() for clarity and GPU efficiency
 */
export const smoothEscapeChunk = /* glsl */ `
float smoothEscape(int iter, float mod2) {
  return float(iter) + 1.0 - log2(0.5 * log2(mod2));
}

float smoothEscapeGeneral(int iter, float mod2, float logBase) {
  float lnBase = log(logBase);
  float logZn = log(mod2) * 0.5;
  return float(iter) + 1.0 - log(logZn / lnBase) / lnBase;
}
`;

export const paletteLookupChunk = /* glsl */ `
vec3 paletteLookup(float t) {
  return texture(u_palette, vec2(t, 0.5)).rgb;
}
`;

/**
 * Cosine palette for stripe mode — Inigo Quilez style.
 * Produces iridescent/metallic colors without texture lookup.
 * Phase offsets (4.0, 4.6, 5.2) tuned for copper/bronze metallic.
 * @see https://iquilezles.org/articles/palettes/
 * @see https://github.com/munrocket/deep-fractal (color_scheme 0)
 */
export const cosinePaletteLookupChunk = /* glsl */ `
vec3 paletteLookup(float t) {
  // @mirror deep-mandelbrot: sin(t + offsets), NO 2π multiplier.
  // The amplitude+frequency from mapToParam already provides sufficient phase range.
  return 0.5 + 0.5 * sin(t + vec3(4.0, 4.6, 5.2));
}
`;

// AccumState struct must match accumulatorRealChunk so main.glsl can use acc.trapDistSq etc.
// The noop version just skips the per-iteration work (no atan, no sin, no min).
export const accumulatorNoopChunk = /* glsl */ `
struct AccumState {
  float stripeSum;
  float stripePrev1;
  float stripePrev2;
  float stripePrev3;
  float trapDistSq;
  int count;
  vec2 dz;
};
AccumState initAccumulator() { return AccumState(0.0, 0.0, 0.0, 0.0, 1e20, 0, vec2(0.0)); }
void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) { acc.dz = dz; }
`;

/**
 * @mirror domain/coloringAccumulator.ts
 * Real accumulator: stripe Re(z)·Im(z)/|z|² + orbit trap + derivative.
 * 4-point history for Catmull-Rom interpolation at escape.
 * @see https://github.com/munrocket/deep-fractal
 */
export const accumulatorRealChunk = /* glsl */ `
struct AccumState {
  float stripeSum;
  float stripePrev1;
  float stripePrev2;
  float stripePrev3;
  float trapDistSq;
  int count;
  vec2 dz;
};

AccumState initAccumulator() {
  return AccumState(0.0, 0.0, 0.0, 0.0, 1e20, 0, vec2(0.0));
}

void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) {
  // @mirror domain/coloringAccumulator.ts:updateAccumulator
  // Shift history for Catmull-Rom
  acc.stripePrev3 = acc.stripePrev2;
  acc.stripePrev2 = acc.stripePrev1;
  acc.stripePrev1 = acc.stripeSum;
  // Stripe: Re(z)·Im(z)/|z|² (deep-mandelbrot formula, 2-fold metallic)
  float zz = z.x * z.x + z.y * z.y;
  if (zz > 0.0) {
    acc.stripeSum += z.x * z.y / zz;
  }
  acc.count++;
  acc.dz = dz;

  if (zz < acc.trapDistSq) {
    acc.trapDistSq = zz;
  }
}
`;

// ---- Iteration chunks -------------------------------------------------------

/** @mirror domain/fractals.ts:mandelbrotFastPath */
export const mandelbrotIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0;
  escaped = false;
  smoothVal = 0.0;

  // @mirror domain/periodicity.ts:isInCardioid + isInBulb
  float x_minus_quarter = c.x - 0.25;
  float y2 = c.y * c.y;
  float q = x_minus_quarter * x_minus_quarter + y2;
  if (q * (q + x_minus_quarter) <= 0.25 * y2) { iter = u_maxIter; return; }

  float x_plus_one = c.x + 1.0;
  if (x_plus_one * x_plus_one + y2 <= 0.0625) { iter = u_maxIter; return; }

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    float x2 = z.x * z.x;
    float y2_iter = z.y * z.y;
    if (x2 + y2_iter > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2_iter);
      return;
    }
    // dz = 2*z*dz + 1 (complex multiply)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2_iter, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }

  iter = u_maxIter;
}
`;

/** @mirror domain/fractals.ts:juliaFastPath */
export const juliaIterationChunk = /* glsl */ `
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = c_pixel;
  vec2 c = vec2(u_juliaRe, u_juliaIm);
  vec2 dz = vec2(1.0, 0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    // dz = 2*z*dz (Julia: dc/dc_pixel = 0, no +1)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y), 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = u_maxIter;
}
`;

/** @mirror domain/fractals.ts:burningShipFastPath */
export const burningshipIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    z = abs(z);
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    // dz = 2*abs(z)*dz + 1 (derivative uses folded z)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = u_maxIter;
}
`;

/** @mirror domain/fractals.ts:tricornFastPath */
export const tricornIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    // dz = 2*conj(z)*dz + 1 (anti-holomorphic, approximate)
    dz = vec2(2.0*(z.x*dz.x + z.y*dz.y) + 1.0, 2.0*(-z.x*dz.y + z.y*dz.x));
    z.y = -z.y;
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = u_maxIter;
}
`;

/** @mirror domain/fractals.ts:multibrotFastPath */
export const multibrotIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    float mod2 = z.x * z.x + z.y * z.y;
    if (mod2 > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscapeGeneral(i, mod2, float(u_power));
      return;
    }
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
  iter = u_maxIter;
}
`;

// ---- DS iteration chunks (double-single precision) -------------------------

/**
 * Mandelbrot iteration in double-single precision.
 * z and c carried as vec2(hi,lo) pairs for ~15 digit precision.
 * Escape test + accumulator use float32 (hi part only).
 * @mirror mandelbrotIterationChunk (float32 version)
 */
export const mandelbrotDSIterationChunk = /* glsl */ `
void iterate(vec2 c_unused, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  // Compute c in double-single from DS uniforms
  vec2 ds_cre, ds_cim;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_cre, ds_cim);

  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  // Cardioid/bulb pre-test (float32 — c.hi is sufficient)
  float cx = ds_cre.x, cy = ds_cim.x;
  float xmq = cx - 0.25;
  float cy2 = cy * cy;
  float q = xmq * xmq + cy2;
  if (q * (q + xmq) <= 0.25 * cy2) { iter = u_maxIter; return; }
  float xp1 = cx + 1.0;
  if (xp1 * xp1 + cy2 <= 0.0625) { iter = u_maxIter; return; }

  // DS iteration: z = z² + c
  vec2 ds_zre = vec2(0.0);
  vec2 ds_zim = vec2(0.0);

  for (int i = 0; i < MAX_ITER_CAP; i++) { if (i >= u_maxIter) break;
    // Escape test on float32 hi parts
    float x2 = ds_zre.x * ds_zre.x;
    float y2 = ds_zim.x * ds_zim.x;
    if (x2 + y2 > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      z = vec2(ds_zre.x, ds_zim.x);
      return;
    }
    // dz = 2*z*dz + 1 (float32 — sufficient for distance estimation)
    dz = vec2(2.0*(ds_zre.x*dz.x - ds_zim.x*dz.y) + 1.0,
              2.0*(ds_zre.x*dz.y + ds_zim.x*dz.x));
    // z_new = z² + c in DS
    vec2 ds_x2 = ds_sq(ds_zre);
    vec2 ds_y2 = ds_sq(ds_zim);
    vec2 ds_xy = ds_mul(ds_zre, ds_zim);
    ds_zre = ds_add(ds_sub(ds_x2, ds_y2), ds_cre);
    ds_zim = ds_add(ds_mul_float(ds_xy, 2.0), ds_cim);
    // Accumulator uses float32 hi parts
    z = vec2(ds_zre.x, ds_zim.x);
    updateAccumulator(z, dz, acc);
  }

  z = vec2(ds_zre.x, ds_zim.x);
  iter = u_maxIter;
}
`;

// ---- Coloring chunks --------------------------------------------------------

/**
 * @mirror domain/coloringModes.ts:mapToColorParam (classic case)
 * COLOR_CYCLE_PERIOD injected as #define from domain constant (DRY)
 */
export const classicColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  return mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
}
float computeLightness(AccumState acc, vec2 z) { return 1.0; }
`;

/**
 * @mirror domain/coloringModes.ts:stripeToParam
 * Stripe coloring: Re(z)·Im(z)/|z|² with Catmull-Rom interpolation.
 * Stripe is the PRIMARY color signal (deep-mandelbrot style).
 * @see https://github.com/munrocket/deep-fractal
 */
export const stripeColoringChunk = /* glsl */ `
// Catmull-Rom cubic interpolation — C1 continuous across iteration boundaries
// Standard: catmullRom(P0, P1, P2, P3, d) → d=0→P1, d=1→P2.
float catmullRom(float s0, float s1, float s2, float s3, float d) {
  float d2 = d * d, d3 = d * d2;
  return 0.5 * (
    s0 * (-d + 2.0 * d2 - d3) +
    s1 * (2.0 - 5.0 * d2 + 3.0 * d3) +
    s2 * (d + 4.0 * d2 - 3.0 * d3) +
    s3 * (d3 - d2)
  );
}

float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  float frac = smoothVal - floor(smoothVal);
  // P1=stripeSum (escape iter), P2=ext (next), P0=stripePrev1, P3=tangent after.
  float ext = 2.0 * acc.stripeSum - acc.stripePrev1;
  float interpolated = acc.count >= 3
    ? catmullRom(acc.stripePrev1, acc.stripeSum, ext, 2.0 * ext - acc.stripeSum, frac)
    : acc.stripeSum + frac * (ext - acc.stripeSum);
  float stripeRatio = acc.count > 0 ? interpolated / float(acc.count) : 0.0;
  // @mirror deep-mandelbrot: stripe amplitude + iteration-dependent frequency
  // Produces metallic depth banding instead of flat single-cycle color.
  float amplitude = 0.7 + 2.5 * stripeRatio;
  float frequency = 50.0 * smoothVal / COLOR_CYCLE_PERIOD;
  return amplitude + frequency;
}
float computeLightness(AccumState acc, vec2 z) { return 1.0; }
`;

/**
 * @mirror domain/coloringModes.ts:decompToParam
 * Binary decomposition — two-tone based on escape angle sign.
 */
export const decompositionColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  float angle = atan(z.y, z.x);
  return angle >= 0.0 ? 0.15 : 0.65;
}
float computeLightness(AccumState acc, vec2 z) { return 1.0; }
`;

/**
 * @mirror domain/coloringModes.ts:trapToParam
 * Orbit trap coloring — log-scaled minimum distance to origin.
 */
export const orbitTrapColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  float d = min(sqrt(acc.trapDistSq), 4.0);
  float logMapped = log(1.0 + d) / log(5.0);
  float base = mod(smoothVal, ORBIT_TRAP_CYCLE) / ORBIT_TRAP_CYCLE;
  return mod(logMapped * 0.6 + base * 0.4, 1.0);
}
float computeLightness(AccumState acc, vec2 z) { return 1.0; }
`;

/**
 * @mirror domain/coloringModes.ts:normalToParam + computeNormalLightness
 * Normal map / 3D lighting — directional light + distance estimation height.
 */
export const normalMapColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  float base = mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  float angle = atan(z.y, z.x);
  float angleNorm = (angle + 3.14159265) / (2.0 * 3.14159265);
  return mod(base * 0.7 + angleNorm * 0.3, 1.0);
}

float computeLightness(AccumState acc, vec2 z) {
  // @mirror domain/coloringModes.ts:computeNormalLightness
  float zMod = length(z);
  float dzMod = length(acc.dz);
  float de = dzMod > 0.0 ? zMod * log(zMod) / dzMod : 0.0;
  if (de <= 0.0) return 0.5;
  float dotL = cos(atan(z.y, z.x) - NORMAL_MAP_LIGHT_ANGLE);
  float logDE = log(1.0 + de * 10.0);
  float height = min(logDE / 3.0, 1.0);
  return 0.2 + 1.2 * (dotL * 0.5 + 0.5) * (0.3 + 0.7 * height);
}
`;

// ---- Main template ----------------------------------------------------------

export const mainChunk = /* glsl */ `
void main() {
  vec2 c = screenToComplex(gl_FragCoord.xy, u_center, u_scale, u_resolution);

  vec2 z;
  int iter;
  bool escaped;
  float smoothVal;
  AccumState acc = initAccumulator();

  iterate(c, z, iter, escaped, smoothVal, acc);

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
`;
