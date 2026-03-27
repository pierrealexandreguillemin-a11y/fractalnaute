/**
 * Orbit texture management for perturbation rendering.
 * Uploads reference orbit [Z_re, Z_im, Z'_re, Z'_im] per iteration as RGBA32F.
 */

/** Upload orbit data to a RGBA32F texture. Returns texture + dimensions. */
export function createOrbitTexture(
  gl: WebGL2RenderingContext,
  orbitData: Float32Array,
  orbitLength: number
): { texture: WebGLTexture; width: number; height: number } | null {
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    // Fallback: could pack floats into RGBA8, but for now return null
    return null;
  }

  const texWidth = Math.ceil(Math.sqrt(orbitLength));
  const texHeight = Math.ceil(orbitLength / texWidth);

  // Pad to fill texture rectangle (extra texels read as 0)
  const padded = new Float32Array(texWidth * texHeight * 4);
  padded.set(orbitData.subarray(0, orbitLength * 4));

  const texture = gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA32F,
    texWidth, texHeight, 0,
    gl.RGBA, gl.FLOAT, padded
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture, width: texWidth, height: texHeight };
}

/** Update existing orbit texture with new data (avoids re-allocation). */
export function updateOrbitTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  orbitData: Float32Array,
  orbitLength: number,
  texWidth: number,
  texHeight: number
): void {
  const padded = new Float32Array(texWidth * texHeight * 4);
  padded.set(orbitData.subarray(0, orbitLength * 4));

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0,
    texWidth, texHeight,
    gl.RGBA, gl.FLOAT, padded
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/** Delete orbit texture. */
export function destroyOrbitTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture
): void {
  gl.deleteTexture(texture);
}
