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
