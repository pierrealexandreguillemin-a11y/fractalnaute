/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - GPU Framebuffer
 * Scaled FBOs for progressive preview (1/4) and SSAA (2x) rendering.
 * ===============================================================================
 */

/** Preview renders at 1/N of canvas resolution (each dimension). 4 = 1/16 pixels. */
export const PREVIEW_SCALE = 0.25;

/** SSAA renders at Nx canvas resolution (each dimension). 2 = 4x pixels. */
export const SSAA_SCALE = 2;

// ---- Types ------------------------------------------------------------------

export interface GPUFramebuffer {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

// ---- Generic FBO lifecycle --------------------------------------------------

/** Create a framebuffer at `scale` × canvas resolution. Returns null if size exceeds GPU limits. */
export function createScaledFBO(
  gl: WebGL2RenderingContext,
  scale: number
): GPUFramebuffer | null {
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const width = Math.max(1, Math.floor(gl.drawingBufferWidth * scale));
  const height = Math.max(1, Math.floor(gl.drawingBufferHeight * scale));
  if (width > maxSize || height > maxSize) return null;

  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8,
    width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const fbo = gl.createFramebuffer();
  if (!fbo) { gl.deleteTexture(texture); return null; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, texture, 0
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

/** Resize FBO if canvas size changed for given scale, else return existing. Returns null if GPU limits exceeded. */
export function resizeScaledFBO(
  gl: WebGL2RenderingContext,
  existing: GPUFramebuffer,
  scale: number
): GPUFramebuffer | null {
  const newWidth = Math.max(1, Math.floor(gl.drawingBufferWidth * scale));
  const newHeight = Math.max(1, Math.floor(gl.drawingBufferHeight * scale));
  if (newWidth === existing.width && newHeight === existing.height) {
    return existing;
  }
  destroyFBO(gl, existing);
  return createScaledFBO(gl, scale);
}

/** Blit FBO to the default framebuffer (canvas) with GL_LINEAR filtering. */
export function blitFBOToCanvas(
  gl: WebGL2RenderingContext,
  fbo: GPUFramebuffer
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(
    0, 0, fbo.width, fbo.height,
    0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight,
    gl.COLOR_BUFFER_BIT, gl.LINEAR
  );
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
}

/** Release GPU resources for a framebuffer object. */
export function destroyFBO(
  gl: WebGL2RenderingContext,
  fbo: GPUFramebuffer
): void {
  gl.deleteFramebuffer(fbo.fbo);
  gl.deleteTexture(fbo.texture);
}
