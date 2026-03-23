import { describe, it, expect } from 'vitest';
import { isWebGL2Available } from '../gpuDetector';

describe('gpuDetector', () => {
  it('returns false when document is unavailable (SSR/test)', () => {
    expect(isWebGL2Available()).toBe(false);
  });

  it('caches the result across calls', () => {
    const a = isWebGL2Available();
    const b = isWebGL2Available();
    expect(a).toBe(b);
  });
});
