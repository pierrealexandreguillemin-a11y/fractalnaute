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
  // Manual LSB: findLSB() missing on some WebGL2 drivers (AMD Radeon).
  // k & (-k) isolates lowest set bit; count trailing zeros via shift.
  int lsb = 0;
  if (k != 0) {
    int tmp = k;
    // Unrolled: max 20 levels for maxIter up to 1M
    for (int b = 0; b < 20; b++) {
      if ((tmp & 1) != 0) break;
      lsb++;
      tmp >>= 1;
    }
  }
  int limit = u_blaNumLevels - 1;
  int maxLevel = (k == 0) ? limit : (lsb < limit ? lsb : limit);
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

/// BLA skip phase — shared by Mandelbrot and Julia iterate().
/// @tradeoff du,dv (derivative) NOT updated — BLA only enabled for
/// classic/decomposition which don't use per-iteration derivative.
/// Rebase criterion: |z|^2 < |delta|^2 (differs from Heiland-Allen |z|^2<G*|Z|^2
/// because BLA validity radius encodes the linear approximation bound).
/// Returns true if BLA skipped iterations (caller should continue).
bool tryBlaSkip(inout float u, inout float v, inout int refIter, inout int i,
                vec2 dc, inout vec2 z, out bool escaped, out int iter,
                out float smoothVal) {
  BLAEntry blaEntry;
  int skipped = blaLookup(refIter, u*u + v*v, blaEntry);
  if (skipped <= 0 || refIter + skipped >= u_orbitLength || i + skipped >= MAX_ITER) {
    return false;
  }
  vec2 dz_bla = applyBla(blaEntry, vec2(u, v), dc);
  u = dz_bla.x;
  v = dz_bla.y;
  refIter += skipped;
  i += skipped - 1; // -1 because for loop increments

  vec4 postOrbit = getOrbitData(refIter);
  z = postOrbit.xy + vec2(u, v);
  float zz = z.x * z.x + z.y * z.y;

  if (zz > BAILOUT_SQ) {
    escaped = true; iter = i + 1;
    smoothVal = smoothEscape(i + 1, zz);
    return true;
  }

  // Rebase: |z|^2 < |delta|^2
  float uu_vv = u*u + v*v;
  if (zz < uu_vv) {
    u = z.x; v = z.y;
    refIter = 0;
  }
  return true;
}
`;

/** Uniform names added by BLA chunks. */
export const BLA_UNIFORM_NAMES = [
  'u_blaTexture', 'u_blaTexSize', 'u_blaNumLevels', 'u_blaFirstLevel',
] as const;
