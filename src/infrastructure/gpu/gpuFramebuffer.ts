/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - GPU Framebuffer
 * Quarter-resolution FBO for progressive GPU rendering (preview pass)
 * ===============================================================================
 */

/** Preview renders at 1/N of canvas resolution (each dimension). 4 = 1/16 pixels. */
const PREVIEW_SCALE_DIVISOR = 4;

// ---- Types ------------------------------------------------------------------

export interface GPUFramebuffer {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

// ---- FBO lifecycle ----------------------------------------------------------

/** Create a quarter-resolution framebuffer object for preview rendering. */
export function createQuarterFBO(
  gl: WebGL2RenderingContext
): GPUFramebuffer {
  const width = Math.max(1, Math.floor(gl.drawingBufferWidth / PREVIEW_SCALE_DIVISOR));
  const height = Math.max(1, Math.floor(gl.drawingBufferHeight / PREVIEW_SCALE_DIVISOR));

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8,
    width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, texture, 0
  );

  // Restore default bindings
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { fbo, texture, width, height };
}

/** Resize the quarter FBO if the canvas size changed, else return existing. */
export function resizeQuarterFBO(
  gl: WebGL2RenderingContext,
  existing: GPUFramebuffer
): GPUFramebuffer {
  const newWidth = Math.max(1, Math.floor(gl.drawingBufferWidth / PREVIEW_SCALE_DIVISOR));
  const newHeight = Math.max(1, Math.floor(gl.drawingBufferHeight / PREVIEW_SCALE_DIVISOR));
  if (newWidth === existing.width && newHeight === existing.height) {
    return existing;
  }
  destroyFBO(gl, existing);
  return createQuarterFBO(gl);
}

/** Blit a quarter-res FBO to the full-size default framebuffer (canvas). */
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
