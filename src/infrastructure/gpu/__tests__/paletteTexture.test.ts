import { describe, it, expect } from 'vitest';
import { createPaletteData } from '../paletteTexture';

describe('paletteTexture', () => {
  it('produces a 256*4 = 1024 byte Uint8Array', () => {
    const data = createPaletteData('classic');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(256 * 4);
  });

  it('all alpha values are 255', () => {
    const data = createPaletteData('classic');
    for (let i = 0; i < 256; i++) {
      expect(data[i * 4 + 3]).toBe(255);
    }
  });

  it('RGB values are in [0, 255] range', () => {
    const data = createPaletteData('fire');
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });

  it('different palettes produce different data', () => {
    const classic = createPaletteData('classic');
    const fire = createPaletteData('fire');
    expect(classic).not.toEqual(fire);
  });
});
