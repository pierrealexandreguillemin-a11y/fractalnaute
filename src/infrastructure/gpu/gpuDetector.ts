let cached: boolean | null = null;

/** Detect WebGL 2 availability. Result is cached for the session. */
export function isWebGL2Available(): boolean {
  if (cached !== null) return cached;

  if (typeof document === 'undefined') {
    cached = false;
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    cached = gl !== null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }
  } catch (e: unknown) {
    cached = false;
    console.warn('WebGL 2 detection failed:', e);
  }

  return cached ?? false;
}

/** Reset cache — only for testing */
export function resetGpuDetectorCache(): void {
  cached = null;
}
