/**
 * WebGL uniform binding helpers for the fractal renderer.
 * Pure GL state setters — no draw calls, no resource management.
 */

import type { Viewport, FractalParams } from '../../domain/types';
import type { OrbitContext } from './rendererTypes';
import { splitDouble } from './shaders/doubleSingle';

/** Bind center / scale uniforms (hi + DS lo corrections). */
export function setCenterAndScale(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  viewport: Viewport
): void {
  const [reHi, reLo] = splitDouble(viewport.centerRe);
  const [imHi, imLo] = splitDouble(viewport.centerIm);
  const [scaleHi, scaleLo] = splitDouble(viewport.scale);

  const center = locations.get('u_center');
  if (center) gl.uniform2f(center, reHi, imHi);
  const scale = locations.get('u_scale');
  if (scale) gl.uniform1f(scale, scaleHi);

  const centerLo = locations.get('u_centerLo');
  if (centerLo) gl.uniform2f(centerLo, reLo, imLo);
  const scaleLoLoc = locations.get('u_scaleLo');
  if (scaleLoLoc) gl.uniform1f(scaleLoLoc, scaleLo);
}

/** Bind palette sampler uniform. */
export function bindPaletteTexture(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  texture: WebGLTexture
): void {
  const paletteLoc = locations.get('u_palette');
  if (!paletteLoc) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(paletteLoc, 0);
}

/** Bind fractal-specific uniforms (Julia c, Multibrot power). */
export function setFractalParams(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  params: FractalParams
): void {
  const juliaRe = locations.get('u_juliaRe');
  const juliaIm = locations.get('u_juliaIm');
  const power = locations.get('u_power');
  if (juliaRe) gl.uniform1f(juliaRe, params.juliaRe ?? -0.7);
  if (juliaIm) gl.uniform1f(juliaIm, params.juliaIm ?? 0.27015);
  if (power) gl.uniform1i(power, params.power ?? 3);
}

/** Set perturbation-specific uniforms (orbit texture, ref point, orbit length). */
export function setOrbitUniforms(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  orbit: OrbitContext
): void {
  const loc = (name: string) => locations.get(name);

  const lenLoc = loc('u_orbitLength');
  if (lenLoc) gl.uniform1i(lenLoc, orbit.orbitData.length);

  const texSizeLoc = loc('u_orbitTexSize');
  if (texSizeLoc) gl.uniform2f(texSizeLoc, orbit.orbitTexWidth, orbit.orbitTexHeight);

  const refPointLoc = loc('u_refPoint');
  if (refPointLoc) {
    const [reHi] = splitDouble(orbit.orbitData.refPointRe);
    const [imHi] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refPointLoc, reHi, imHi);
  }

  const refPointLoLoc = loc('u_refPointLo');
  if (refPointLoLoc) {
    const [, reLo] = splitDouble(orbit.orbitData.refPointRe);
    const [, imLo] = splitDouble(orbit.orbitData.refPointIm);
    gl.uniform2f(refPointLoLoc, reLo, imLo);
  }

  const orbitTexLoc = loc('u_orbitTexture');
  if (orbitTexLoc) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, orbit.orbitTexture);
    gl.uniform1i(orbitTexLoc, 1);
    gl.activeTexture(gl.TEXTURE0);
  }

  setBlaUniforms(gl, locations, orbit);
}

/** Set BLA-specific uniforms (texture, dimensions, levels). */
function setBlaUniforms(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
  orbit: OrbitContext
): void {
  const loc = (name: string) => locations.get(name);

  const blaTexLoc = loc('u_blaTexture');
  if (blaTexLoc && orbit.blaTexture) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, orbit.blaTexture);
    gl.uniform1i(blaTexLoc, 2);
    gl.activeTexture(gl.TEXTURE0);
  }

  const blaTexSizeLoc = loc('u_blaTexSize');
  if (blaTexSizeLoc && orbit.blaTexWidth > 0) {
    gl.uniform2f(blaTexSizeLoc, orbit.blaTexWidth, orbit.blaTexHeight);
  }

  const blaLevelsLoc = loc('u_blaNumLevels');
  if (blaLevelsLoc) gl.uniform1i(blaLevelsLoc, orbit.blaNumLevels);

  const blaFirstLoc = loc('u_blaFirstLevel');
  // @mirror wasm/src/bla.rs:FIRST_LEVEL — must match Rust constant
  if (blaFirstLoc) gl.uniform1i(blaFirstLoc, 2);

  const blaOffsetsLoc = loc('u_blaLevelOffsets[0]');
  if (blaOffsetsLoc && orbit.blaLevelOffsetsGpu) {
    gl.uniform1iv(blaOffsetsLoc, orbit.blaLevelOffsetsGpu);
  }
}
