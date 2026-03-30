/**
 * GLSL chunks for BLA (Bivariate Linear Approximation).
 * Lookup + apply BLA entries to skip iterations in perturbation shader.
 * @see docs/superpowers/specs/2026-03-29-bla-design.md
 */

/** BLA uniforms: texture, dimensions, level info. */
export const blaHeaderChunk = /* glsl */ `
uniform sampler2D u_blaTexture;
uniform vec2 u_blaTexSize;
uniform int u_blaNumLevels;
uniform int u_blaFirstLevel;
uniform int u_blaLevelOffsets[16]; // max 16 levels = 2^16 = 65536 max iter
`;

/** BLA lookup + apply. Entry = 2 RGBA32F texels. */
export const blaLookupChunk = /* glsl */ `
struct BLAEntry {
  vec2 A;
  vec2 B;
  float r2;
  int l;
};

BLAEntry getBlaEntry(int entryIndex) {
  int texW = int(u_blaTexSize.x);
  int t0 = entryIndex * 2;
  int t1 = t0 + 1;
  vec4 d0 = texelFetch(u_blaTexture, ivec2(t0 % texW, t0 / texW), 0);
  vec4 d1 = texelFetch(u_blaTexture, ivec2(t1 % texW, t1 / texW), 0);
  return BLAEntry(d0.xy, d0.zw, d1.x, int(d1.y));
}

vec2 applyBla(BLAEntry b, vec2 dz, vec2 dc) {
  return vec2(
    b.A.x * dz.x - b.A.y * dz.y + b.B.x * dc.x - b.B.y * dc.y,
    b.A.x * dz.y + b.A.y * dz.x + b.B.x * dc.y + b.B.y * dc.x
  );
}

int blaLookup(int m, float dz2, out BLAEntry result) {
  if (m <= 0) return 0;
  int k = m - 1;
  int maxLevel = (k == 0) ? (u_blaNumLevels - 1) : min(findLSB(k), u_blaNumLevels - 1);
  int ix = k >> maxLevel;

  for (int level = maxLevel; level >= u_blaFirstLevel; level--) {
    int entryIdx = u_blaLevelOffsets[level] + ix;
    BLAEntry entry = getBlaEntry(entryIdx);
    if (dz2 < entry.r2) {
      result = entry;
      return entry.l;
    }
    ix = ix << 1;
  }
  return 0;  // no valid BLA
}
`;

/** Uniform names added by BLA chunks. */
export const BLA_UNIFORM_NAMES = [
  'u_blaTexture', 'u_blaTexSize', 'u_blaNumLevels', 'u_blaFirstLevel',
] as const;
