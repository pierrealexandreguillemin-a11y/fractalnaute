import { describe, it, expect } from 'vitest';

// Test the pure math logic used by orbitTexture.ts
// (WebGL calls can't be unit-tested without a GL context)
describe('orbitTexture dimension calculation', () => {
  function calcDimensions(orbitLength: number) {
    const texWidth = Math.ceil(Math.sqrt(orbitLength));
    const texHeight = Math.ceil(orbitLength / texWidth);
    return { texWidth, texHeight };
  }

  it('handles small orbits', () => {
    const { texWidth, texHeight } = calcDimensions(4);
    expect(texWidth).toBe(2);
    expect(texHeight).toBe(2);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(4);
  });

  it('handles large orbits', () => {
    const { texWidth, texHeight } = calcDimensions(10000);
    expect(texWidth).toBe(100);
    expect(texHeight).toBe(100);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(10000);
  });

  it('handles non-square orbits', () => {
    const { texWidth, texHeight } = calcDimensions(1000);
    expect(texWidth * texHeight).toBeGreaterThanOrEqual(1000);
  });

  it('handles single iteration', () => {
    const { texWidth, texHeight } = calcDimensions(1);
    expect(texWidth).toBe(1);
    expect(texHeight).toBe(1);
  });
});
