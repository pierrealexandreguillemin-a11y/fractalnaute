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

out vec4 fragColor;
`;

/**
 * @mirror domain/coordinates.ts:screenToComplex
 * CPU: re = centerRe + (x/width - 0.5) * scale * aspect
 *      im = centerIm + (y/height - 0.5) * scale
 * where scale = visible height in complex-plane units
 */
export const screenToComplexChunk = /* glsl */ `
vec2 screenToComplex(vec2 fragCoord, vec2 center, float scale, vec2 resolution) {
  float aspect = resolution.x / resolution.y;
  vec2 uv = fragCoord / resolution - 0.5;
  return center + vec2(uv.x * scale * aspect, uv.y * scale);
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

export const accumulatorNoopChunk = /* glsl */ `
struct AccumState { float _unused; };
AccumState initAccumulator() { return AccumState(0.0); }
void updateAccumulator(vec2 z, inout AccumState acc) {}
`;

// ---- Iteration chunks -------------------------------------------------------

/** @mirror domain/fractals.ts:mandelbrotFastPath */
export const mandelbrotIterationChunk = /* glsl */ `
void iterate(vec2 c, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  z = vec2(0.0);
  iter = 0;
  escaped = false;

  for (int i = 0; i < MAX_ITER; i++) {
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > 4.0) {
      escaped = true;
      iter = i;
      smoothVal = smoothEscape(i, x2 + y2);
      return;
    }
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    updateAccumulator(z, acc);
  }

  iter = MAX_ITER;
  smoothVal = 0.0;
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
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float t = mapToParam(smoothVal, acc, z, iter);
  fragColor = vec4(paletteLookup(t), 1.0);
}
`;
