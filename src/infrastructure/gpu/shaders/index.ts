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
 * Note: v2 Multibrot needs logBase=n variant (fractals.ts line 453)
 */
export const smoothEscapeChunk = /* glsl */ `
float smoothEscape(int iter, float mod2) {
  return float(iter) + 1.0 - log2(0.5 * log2(mod2));
}
`;

export const paletteLookupChunk = /* glsl */ `
vec3 paletteLookup(float t) {
  return texture(u_palette, vec2(t, 0.5)).rgb;
}
`;

// AccumState struct must match accumulatorRealChunk so main.glsl can use acc.trapDistSq etc.
// The noop version just skips the per-iteration work (no atan, no sin, no min).
export const accumulatorNoopChunk = /* glsl */ `
struct AccumState {
  float stripeSum;
  float prevStripeSum;
  float trapDistSq;
  int count;
  vec2 dz;
};
AccumState initAccumulator() { return AccumState(0.0, 0.0, 1e20, 0, vec2(0.0)); }
void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) { acc.dz = dz; }
`;

/**
 * @mirror domain/coloringAccumulator.ts
 * Real accumulator: stripe average + orbit trap + derivative tracking.
 * STRIPE_DENSITY injected as #define from domain constant (DRY).
 */
export const accumulatorRealChunk = /* glsl */ `
struct AccumState {
  float stripeSum;
  float prevStripeSum;
  float trapDistSq;
  int count;
  vec2 dz;
};

AccumState initAccumulator() {
  return AccumState(0.0, 0.0, 1e20, 0, vec2(0.0));
}

void updateAccumulator(vec2 z, vec2 dz, inout AccumState acc) {
  // @mirror domain/coloringAccumulator.ts:updateAccumulator
  float arg = atan(z.y, z.x);
  acc.prevStripeSum = acc.stripeSum;
  acc.stripeSum += 0.5 * sin(STRIPE_DENSITY * arg) + 0.5;
  acc.count++;
  acc.dz = dz;

  float distSq = z.x * z.x + z.y * z.y;
  if (distSq < acc.trapDistSq) {
    acc.trapDistSq = distSq;
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
  if (q * (q + x_minus_quarter) <= 0.25 * y2) { iter = MAX_ITER; return; }

  float x_plus_one = c.x + 1.0;
  if (x_plus_one * x_plus_one + y2 <= 0.0625) { iter = MAX_ITER; return; }

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x;
    float y2_iter = z.y * z.y;
    if (x2 + y2_iter > 4.0) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2_iter);
      return;
    }
    // dz = 2*z*dz + 1 (complex multiply)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2_iter, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }

  iter = MAX_ITER;
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

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    // dz = 2*z*dz (Julia: dc/dc_pixel = 0, no +1)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y), 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
`;

/** @mirror domain/fractals.ts:burningShipFastPath */
export const burningshipIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    z = abs(z);
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    // dz = 2*abs(z)*dz + 1 (derivative uses folded z)
    dz = vec2(2.0*(z.x*dz.x - z.y*dz.y) + 1.0, 2.0*(z.x*dz.y + z.y*dz.x));
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, dz, acc);
  }
  iter = MAX_ITER;
}
`;

/** @mirror domain/fractals.ts:tricornFastPath */
export const tricornIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x, y2 = z.y * z.y;
    if (x2 + y2 > 4.0) {
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
  iter = MAX_ITER;
}
`;

/** @mirror domain/fractals.ts:multibrotFastPath */
export const multibrotIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;

  for (int i = 0; i < MAX_ITER; i++) {
    float mod2 = z.x * z.x + z.y * z.y;
    if (mod2 > 4.0) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, mod2);
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
  iter = MAX_ITER;
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
 * Harkonen stripe average coloring — lerps between prev/current stripe sum.
 */
export const stripeColoringChunk = /* glsl */ `
float mapToParam(float smoothVal, AccumState acc, vec2 z, int iter) {
  float frac = smoothVal - floor(smoothVal);
  float rawLerped = acc.prevStripeSum + frac * (acc.stripeSum - acc.prevStripeSum);
  float stripeVal = acc.count > 0 ? rawLerped / float(acc.count) : 0.0;
  float base = mod(smoothVal, COLOR_CYCLE_PERIOD) / COLOR_CYCLE_PERIOD;
  return mod(base + stripeVal * 0.5, 1.0);
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
