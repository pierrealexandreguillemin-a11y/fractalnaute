/**
 * ===============================================================================
 * GLSL Double-Single Emulation Library
 * Extends float32 precision from ~7 to ~15 decimal digits using vec2(hi, lo).
 * Based on DSFUN90 (David Bailey) and Thasler's GLSL adaptation.
 *
 * Each DS number = vec2(hi, lo) where hi + lo ≈ true value.
 * hi = Math.fround(value), lo = value - hi (computed on CPU).
 * Veltkamp splitting for error-free products (no FMA required).
 *
 * @see https://blog.cyclemap.link/2011-06-09-glsl-part2-emu/
 * ===============================================================================
 */

/**
 * Veltkamp split constant for float32 (24 significant bits).
 * SPLIT = 2^12 + 1 = 4097. Splits a float into two non-overlapping parts.
 */
const DS_SPLIT = '4097.0';

export const doubleSingleChunk = /* glsl */ `
// ---- Double-single arithmetic (vec2 = hi + lo) -----------------------------

vec2 ds_add(vec2 a, vec2 b) {
  float t1 = a.x + b.x;
  float e = t1 - a.x;
  float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;
  float s = t1 + t2;
  return vec2(s, t2 - (s - t1));
}

vec2 ds_sub(vec2 a, vec2 b) {
  return ds_add(a, vec2(-b.x, -b.y));
}

vec2 ds_mul(vec2 a, vec2 b) {
  // Veltkamp split
  float ca = ${DS_SPLIT} * a.x;
  float cb = ${DS_SPLIT} * b.x;
  float a1 = ca - (ca - a.x);
  float b1 = cb - (cb - b.x);
  float a2 = a.x - a1;
  float b2 = b.x - b1;

  float p = a.x * b.x;
  float e = ((a1 * b1 - p) + a1 * b2 + a2 * b1) + a2 * b2;
  e += a.x * b.y + a.y * b.x;

  float s = p + e;
  return vec2(s, e - (s - p));
}

vec2 ds_sq(vec2 a) {
  // Optimized a*a — avoids redundant split
  float ca = ${DS_SPLIT} * a.x;
  float a1 = ca - (ca - a.x);
  float a2 = a.x - a1;

  float p = a.x * a.x;
  float e = ((a1 * a1 - p) + 2.0 * a1 * a2) + a2 * a2;
  e += 2.0 * a.x * a.y;

  float s = p + e;
  return vec2(s, e - (s - p));
}

vec2 ds_mul_float(vec2 a, float b) {
  float cb = ${DS_SPLIT} * b;
  float b1 = cb - (cb - b);
  float b2 = b - b1;
  float ca = ${DS_SPLIT} * a.x;
  float a1 = ca - (ca - a.x);
  float a2 = a.x - a1;

  float p = a.x * b;
  float e = ((a1 * b1 - p) + a1 * b2 + a2 * b1) + a2 * b2;
  e += a.y * b;

  float s = p + e;
  return vec2(s, e - (s - p));
}

vec2 ds_set(float f) {
  return vec2(f, 0.0);
}
`;

/**
 * DS-aware header: adds lo-part correction uniforms for center and scale.
 * The hi parts reuse existing u_center and u_scale uniforms.
 */
export const dsHeaderChunk = /* glsl */ `
uniform vec2 u_centerLo;
uniform float u_scaleLo;
`;

/**
 * DS screenToComplex: computes pixel c in double-single precision,
 * returns float32 pair (re, im) for float32 iteration paths,
 * OR outputs DS components for DS iteration via out params.
 *
 * @mirror domain/coordinates.ts:screenToComplex
 */
export const screenToComplexDSChunk = /* glsl */ `
void screenToComplexDS(vec2 fragCoord, vec2 resolution,
                       out vec2 ds_re, out vec2 ds_im) {
  float aspect = resolution.x / resolution.y;
  vec2 uv = fragCoord / resolution - 0.5;
  // scale * uv.x * aspect (DS × float)
  ds_re = ds_add(vec2(u_center.x, u_centerLo.x),
                 ds_mul_float(vec2(u_scale, u_scaleLo), uv.x * aspect));
  // scale * (-uv.y) (DS × float, Y negated for WebGL)
  ds_im = ds_add(vec2(u_center.y, u_centerLo.y),
                 ds_mul_float(vec2(u_scale, u_scaleLo), -uv.y));
}
`;

/** DS uniform names to add to the cache list */
export const DS_UNIFORM_NAMES = ['u_centerLo', 'u_scaleLo'];
