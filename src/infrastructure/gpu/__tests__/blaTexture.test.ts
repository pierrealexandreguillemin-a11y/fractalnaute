import { describe, it, expect } from 'vitest';

// Test the pure math logic used by blaTexture.ts
// (WebGL calls can't be unit-tested without a GL context)
describe('blaTexture dimension and packing', () => {
  /** Mirror of blaTexture.ts dimension calculation */
  function calcDimensions(entryCount: number) {
    const texelCount = entryCount * 2; // 2 texels per BLA entry
    const texWidth = Math.ceil(Math.sqrt(texelCount));
    const texHeight = Math.ceil(texelCount / texWidth);
    return { texWidth, texHeight, texelCount };
  }

  /** Mirror of blaTexture.ts packBlaData */
  function packBlaData(blaData: Float32Array, entryCount: number): Float32Array {
    const texelCount = entryCount * 2;
    const packed = new Float32Array(texelCount * 4);
    for (let i = 0; i < entryCount; i++) {
      const src = i * 6;
      const dst = i * 2 * 4;
      packed[dst] = blaData[src]!;
      packed[dst + 1] = blaData[src + 1]!;
      packed[dst + 2] = blaData[src + 2]!;
      packed[dst + 3] = blaData[src + 3]!;
      packed[dst + 4] = blaData[src + 4]!;
      packed[dst + 5] = blaData[src + 5]!;
      packed[dst + 6] = 0;
      packed[dst + 7] = 0;
    }
    return packed;
  }

  it('dimensions fit all texels for small entry count', () => {
    const { texWidth, texHeight, texelCount } = calcDimensions(4);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(texelCount);
    expect(texelCount).toBe(8); // 4 entries × 2 texels
  });

  it('dimensions fit all texels for large entry count', () => {
    const { texWidth, texHeight, texelCount } = calcDimensions(5000);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(texelCount);
    expect(texelCount).toBe(10000);
  });

  it('dimensions fit single entry', () => {
    const { texWidth, texHeight, texelCount } = calcDimensions(1);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(texelCount);
    expect(texelCount).toBe(2);
  });

  it('packs BLA data into correct texel layout', () => {
    // One BLA entry: A=(1,2), B=(3,4), r²=5, l=6
    const blaData = new Float32Array([1, 2, 3, 4, 5, 6]);
    const packed = packBlaData(blaData, 1);

    // Texel 0: A_re, A_im, B_re, B_im
    expect(packed[0]).toBe(1);
    expect(packed[1]).toBe(2);
    expect(packed[2]).toBe(3);
    expect(packed[3]).toBe(4);
    // Texel 1: r², l, 0, 0
    expect(packed[4]).toBe(5);
    expect(packed[5]).toBe(6);
    expect(packed[6]).toBe(0);
    expect(packed[7]).toBe(0);
  });

  it('packs multiple entries correctly', () => {
    const blaData = new Float32Array([
      1, 2, 3, 4, 5, 1,   // entry 0
      10, 20, 30, 40, 50, 2, // entry 1
    ]);
    const packed = packBlaData(blaData, 2);

    // Entry 0, texel 0
    expect(packed[0]).toBe(1);
    expect(packed[3]).toBe(4);
    // Entry 0, texel 1
    expect(packed[4]).toBe(5);
    expect(packed[5]).toBe(1);
    // Entry 1, texel 0 (offset = 2 * 4 = 8)
    expect(packed[8]).toBe(10);
    expect(packed[11]).toBe(40);
    // Entry 1, texel 1
    expect(packed[12]).toBe(50);
    expect(packed[13]).toBe(2);
    expect(packed[14]).toBe(0);
    expect(packed[15]).toBe(0);
  });

  it('total packed size = entryCount × 2 texels × 4 floats', () => {
    const entryCount = 100;
    const blaData = new Float32Array(entryCount * 6);
    const packed = packBlaData(blaData, entryCount);
    expect(packed.length).toBe(entryCount * 2 * 4);
  });
});

describe('BLA lookup simulation (mirrors GLSL blaLookup)', () => {
  const EPSILON = 1.192093e-7; // 2^-23
  const FIRST_LEVEL = 2;

  /** Create a single-step BLA entry for orbit iteration m. @mirror wasm/src/bla.rs */
  function createOneStep(orbitRe: number, orbitIm: number): { A_re: number; A_im: number; B_re: number; B_im: number; r2: number; l: number } {
    const A_re = 2 * orbitRe;
    const A_im = 2 * orbitIm;
    const aMag = Math.sqrt(A_re * A_re + A_im * A_im);
    const r = EPSILON * aMag;
    return { A_re, A_im, B_re: 1, B_im: 0, r2: r * r, l: 1 };
  }

  /** Merge two BLA entries. @mirror wasm/src/bla.rs:merge_two */
  function mergeBla(
    x: { A_re: number; A_im: number; B_re: number; B_im: number; r2: number; l: number },
    y: { A_re: number; A_im: number; B_re: number; B_im: number; r2: number; l: number },
    maxDc: number
  ) {
    const mA_re = y.A_re * x.A_re - y.A_im * x.A_im;
    const mA_im = y.A_re * x.A_im + y.A_im * x.A_re;
    const mB_re = (y.A_re * x.B_re - y.A_im * x.B_im) + y.B_re;
    const mB_im = (y.A_re * x.B_im + y.A_im * x.B_re) + y.B_im;
    const magA = Math.sqrt(x.A_re * x.A_re + x.A_im * x.A_im);
    const magB = Math.sqrt(x.B_re * x.B_re + x.B_im * x.B_im);
    const rY = Math.sqrt(y.r2);
    const rX = Math.sqrt(x.r2);
    const candidate = magA > 0 ? (rY - magB * maxDc) / magA : 0;
    const r = Math.min(rX, Math.max(0, candidate));
    return { A_re: mA_re, A_im: mA_im, B_re: mB_re, B_im: mB_im, r2: r * r, l: x.l + y.l };
  }

  /** Build a realistic BLA table from a simple orbit. */
  function buildBlaTable(orbitLength: number, maxDc: number) {
    const tree: Array<Array<{ A_re: number; A_im: number; B_re: number; B_im: number; r2: number; l: number }>> = [];

    // Level 0: single-step BLAs (skip iter 0, Z_0=0)
    const base = [];
    for (let m = 1; m < orbitLength; m++) {
      // Simulate simple Mandelbrot orbit near c=-1: Z oscillates ~[-1, 0, -1, 0, ...]
      const re = m % 2 === 0 ? -1.0 : 0.0;
      const im = 0.1 * Math.sin(m * 0.3);
      base.push(createOneStep(re, im));
    }
    tree.push(base);

    // Build higher levels by merging pairs
    while (tree[tree.length - 1]!.length >= 2) {
      const prev = tree[tree.length - 1]!;
      const next = [];
      for (let j = 0; j < Math.floor(prev.length / 2); j++) {
        next.push(mergeBla(prev[j * 2]!, prev[j * 2 + 1]!, maxDc));
      }
      tree.push(next);
    }

    // Flatten levels >= FIRST_LEVEL
    const offsets: number[] = [];
    const entries: Array<{ r2: number; l: number }> = [];
    let numLevels = 0;
    for (let lev = 0; lev < tree.length; lev++) {
      if (lev < FIRST_LEVEL) { offsets.push(0); continue; }
      offsets.push(entries.length);
      for (const e of tree[lev]!) entries.push({ r2: e.r2, l: e.l });
      numLevels = lev + 1;
    }
    return { entries, offsets, numLevels, tree };
  }

  /** Mirror of GLSL blaLookup — find largest valid skip. */
  function blaLookup(
    m: number, dz2: number,
    entries: Array<{ r2: number; l: number }>,
    offsets: number[], numLevels: number
  ): number {
    if (m <= 0) return 0;
    const k = m - 1;
    let lsb = 0;
    if (k !== 0) {
      let tmp = k;
      for (let b = 0; b < 20; b++) {
        if ((tmp & 1) !== 0) break;
        lsb++;
        tmp >>= 1;
      }
    }
    const limit = numLevels - 1;
    const maxLevel = k === 0 ? limit : Math.min(lsb, limit);
    let ix = k >> maxLevel;

    for (let level = maxLevel; level >= FIRST_LEVEL; level--) {
      const entryIdx = offsets[level]! + ix;
      const entry = entries[entryIdx];
      if (entry && dz2 < entry.r2) {
        return entry.l;
      }
      ix = ix << 1;
    }
    return 0;
  }

  it('BLA table has entries with non-zero r² at level >= 2', () => {
    const { entries } = buildBlaTable(256, 1e-13);
    const nonZero = entries.filter(e => e.r2 > 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it('BLA lookup finds valid entries for small delta (deep zoom)', () => {
    const { entries, offsets, numLevels } = buildBlaTable(256, 1e-13);
    // At deep zoom, |δ|² ≈ 10^-34 (much smaller than any r²)
    const dz2 = 1e-34;
    let totalSkipped = 0;
    let refIter = 1;
    for (let i = 0; i < 256 && refIter < 255; i++) {
      const skipped = blaLookup(refIter, dz2, entries, offsets, numLevels);
      if (skipped > 0) {
        totalSkipped += skipped;
        refIter += skipped;
      } else {
        refIter++;
      }
    }
    // BLA should skip a significant portion of 255 iterations
    expect(totalSkipped).toBeGreaterThan(100);
  });

  it('BLA lookup skips nothing when delta is too large', () => {
    const { entries, offsets, numLevels } = buildBlaTable(256, 1e-13);
    // |δ|² = 1.0 (standard zoom, much larger than any r²)
    const dz2 = 1.0;
    const skipped = blaLookup(1, dz2, entries, offsets, numLevels);
    expect(skipped).toBe(0);
  });

  it('BLA lookup with rescaling: de-rescaled dz2 matches non-rescaled', () => {
    const { entries, offsets, numLevels } = buildBlaTable(256, 1e-13);
    const S = 2 ** 51; // rescaling factor at zoom 10^-14
    const delta_real = 1e-17; // real delta
    const dz2_real = delta_real * delta_real;
    const delta_tilde = delta_real * S;
    const dz2_tilde = delta_tilde * delta_tilde;
    const dz2_derescaled = dz2_tilde / (S * S);

    // De-rescaled lookup should match non-rescaled
    const skip1 = blaLookup(1, dz2_real, entries, offsets, numLevels);
    const skip2 = blaLookup(1, dz2_derescaled, entries, offsets, numLevels);
    expect(skip2).toBe(skip1);
    expect(skip1).toBeGreaterThan(0);
  });
});
