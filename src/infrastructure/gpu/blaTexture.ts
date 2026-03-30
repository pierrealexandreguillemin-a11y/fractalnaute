/**
 * BLA texture management for perturbation rendering.
 * Uploads BLA table [A_re, A_im, B_re, B_im, r², l] per entry as RGBA32F.
 * Each entry = 2 texels: texel0=(A_re,A_im,B_re,B_im), texel1=(r²,l,0,0).
 */

/** Pack BLA table (6 floats/entry) into RGBA32F (4 floats/texel, 2 texels/entry). */
function packBlaData(blaData: Float32Array, entryCount: number): Float32Array {
  const texelCount = entryCount * 2;
  const packed = new Float32Array(texelCount * 4);
  for (let i = 0; i < entryCount; i++) {
    const src = i * 6;
    const dst = i * 2 * 4; // 2 texels × 4 floats
    // Texel 0: A_re, A_im, B_re, B_im
    packed[dst] = blaData[src]!;
    packed[dst + 1] = blaData[src + 1]!;
    packed[dst + 2] = blaData[src + 2]!;
    packed[dst + 3] = blaData[src + 3]!;
    // Texel 1: r², l, 0, 0
    packed[dst + 4] = blaData[src + 4]!;
    packed[dst + 5] = blaData[src + 5]!;
    packed[dst + 6] = 0;
    packed[dst + 7] = 0;
  }
  return packed;
}

/** Upload BLA table as RGBA32F texture. Returns texture + dimensions, or null. */
export function createBlaTexture(
  gl: WebGL2RenderingContext,
  blaData: Float32Array,
  entryCount: number
): { texture: WebGLTexture; width: number; height: number } | null {
  if (entryCount === 0) return null;

  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) return null;

  const texelCount = entryCount * 2;
  const texWidth = Math.ceil(Math.sqrt(texelCount));
  const texHeight = Math.ceil(texelCount / texWidth);
  const packed = packBlaData(blaData, entryCount);

  // Pad to fill texture rectangle (extra texels read as 0)
  const padded = new Float32Array(texWidth * texHeight * 4);
  padded.set(packed);

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

/** Delete BLA texture. */
export function destroyBlaTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture
): void {
  gl.deleteTexture(texture);
}
