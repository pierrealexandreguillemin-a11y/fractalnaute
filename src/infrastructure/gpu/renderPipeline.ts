/**
 * Core render pipeline — binds state and issues the single draw call.
 * The only module that calls gl.drawArrays.
 */

import type { Viewport, FractalParams } from '../../domain/types';
import type { DrawTarget, CompiledRef, OrbitContext } from './rendererTypes';
import { setCenterAndScale, setOrbitUniforms, setFractalParams, bindPaletteTexture } from './uniformBindings';

/** Render the fractal to a specific target (FBO or canvas). */
export function renderToTarget(
  gl: WebGL2RenderingContext,
  target: DrawTarget,
  compiled: CompiledRef,
  viewport: Viewport,
  paletteTexture: WebGLTexture,
  fractalParams: FractalParams,
  interiorColoring: boolean = false,
  orbit?: OrbitContext
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.width, target.height);
  gl.useProgram(compiled.program);
  setCenterAndScale(gl, compiled.uniformLocations, viewport);
  if (orbit) setOrbitUniforms(gl, compiled.uniformLocations, orbit);
  const res = compiled.uniformLocations.get('u_resolution');
  if (res) gl.uniform2f(res, target.width, target.height);
  // MAX_ITER is now a #define — no uniform to set.
  setFractalParams(gl, compiled.uniformLocations, fractalParams);
  const intColor = compiled.uniformLocations.get('u_interiorColoring');
  if (intColor) gl.uniform1i(intColor, interiorColoring ? 1 : 0);
  bindPaletteTexture(gl, compiled.uniformLocations, paletteTexture);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
