/**
 * Multi-frame ping-pong FBO management.
 * 4× RGBA32F textures store per-pixel iteration state between GPU batches.
 * Requires EXT_color_buffer_float (checked at creation time).
 * @see docs/superpowers/plans/2026-04-02-multiframe-ping-pong.md
 */

import type { MultiFrameFBO } from './rendererTypes';

/** Create a RGBA32F texture with NEAREST filtering and CLAMP_TO_EDGE wrapping. */
function createFloat32Texture(
  gl: WebGL2RenderingContext, width: number, height: number
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Delete an array of textures that may include null entries (partial creation). */
function deleteTextures(gl: WebGL2RenderingContext, textures: (WebGLTexture | null)[]): void {
  for (const tex of textures) {
    if (tex) gl.deleteTexture(tex);
  }
}

/** Create a 4-MRT FBO for multi-frame state storage. Returns null if unsupported. */
export function createMultiFrameFBO(
  gl: WebGL2RenderingContext, width: number, height: number
): MultiFrameFBO | null {
  // @mirror orbitTexture.ts:12 — EXT_color_buffer_float required for RGBA32F render targets
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) return null;

  const fbo = gl.createFramebuffer();
  if (!fbo) return null;

  const texZ = createFloat32Texture(gl, width, height);
  const texInfo = createFloat32Texture(gl, width, height);
  const texAcc = createFloat32Texture(gl, width, height);
  const texHist = createFloat32Texture(gl, width, height);

  if (!texZ || !texInfo || !texAcc || !texHist) {
    gl.deleteFramebuffer(fbo);
    deleteTextures(gl, [texZ, texInfo, texAcc, texHist]);
    return null;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texZ, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texInfo, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, texAcc, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, texHist, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    deleteTextures(gl, [texZ, texInfo, texAcc, texHist]);
    return null;
  }

  return { fbo, texZ, texInfo, texAcc, texHist, width, height };
}

/** Destroy a multi-frame FBO and all its textures. */
export function destroyMultiFrameFBO(
  gl: WebGL2RenderingContext, mf: MultiFrameFBO
): void {
  deleteTextures(gl, [mf.texZ, mf.texInfo, mf.texAcc, mf.texHist]);
  gl.deleteFramebuffer(mf.fbo);
}
