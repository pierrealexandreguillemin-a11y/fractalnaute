/**
 * Orbit/BLA GPU data upload and context assembly for perturbation rendering.
 * Manages texture lifecycle: creates or reuses textures to minimize allocations.
 */

import type { OrbitData } from '../../domain/types';
import type { OrbitContext, OrbitTextureState, BlaTextureState } from './rendererTypes';
import { createOrbitTexture, updateOrbitTexture, destroyOrbitTexture } from './orbitTexture';
import { createBlaTexture, updateBlaTexture, destroyBlaTexture, BLA_TEXELS_PER_ENTRY } from './blaTexture';

/** Upload orbit data, reusing the texture when possible. */
function uploadOrbitData(
  gl: WebGL2RenderingContext,
  state: OrbitTextureState,
  data: OrbitData
): boolean {
  if (state.texture && data.length <= state.width * state.height) {
    updateOrbitTexture(gl, state.texture, data.data, data.length, state.width, state.height);
    return true;
  }
  if (state.texture) destroyOrbitTexture(gl, state.texture);
  const result = createOrbitTexture(gl, data.data, data.length);
  if (!result) { state.texture = null; return false; }
  state.texture = result.texture;
  state.width = result.width;
  state.height = result.height;
  return true;
}

/**
 * Build orbit context for perturbation rendering.
 * Uploads orbit data to GPU texture and returns the context, or null on failure.
 */
export function buildOrbitContext(
  gl: WebGL2RenderingContext,
  state: OrbitTextureState,
  orbitData: OrbitData
): OrbitContext | null {
  if (!uploadOrbitData(gl, state, orbitData)) return null;
  if (!state.texture) return null;
  return {
    orbitData,
    orbitTexture: state.texture,
    orbitTexWidth: state.width,
    orbitTexHeight: state.height,
    blaTexture: null,
    blaTexWidth: 0,
    blaTexHeight: 0,
    blaNumLevels: 0,
    blaLevelOffsetsGpu: null,
    rescaleS: orbitData.rescaleS,
  };
}

/**
 * Upload BLA data to GPU texture. Updates blaState in place.
 * No-op if orbitData has no BLA data.
 */
export function uploadBlaData(
  gl: WebGL2RenderingContext,
  blaState: BlaTextureState,
  orbitData: OrbitData
): void {
  if (!orbitData.blaData || orbitData.blaNumLevels <= 0) return;
  const entryCount = orbitData.blaData.length / 6;
  const texelCount = entryCount * BLA_TEXELS_PER_ENTRY;
  if (blaState.texture && texelCount <= blaState.width * blaState.height) {
    updateBlaTexture(gl, blaState.texture, orbitData.blaData, entryCount, blaState.width, blaState.height);
    return;
  }
  if (blaState.texture) destroyBlaTexture(gl, blaState.texture);
  const blaResult = createBlaTexture(gl, orbitData.blaData, entryCount);
  if (blaResult) {
    blaState.texture = blaResult.texture;
    blaState.width = blaResult.width;
    blaState.height = blaResult.height;
  }
}

/** Pad BLA level offsets to Int32Array(16) for gl.uniform1iv. */
function padBlaOffsets(offsets: number[]): Int32Array | null {
  if (offsets.length === 0) return null;
  const padded = new Int32Array(16);
  for (let i = 0; i < offsets.length && i < 16; i++) {
    padded[i] = offsets[i]!;
  }
  return padded;
}

/** Build orbit context enriched with BLA texture state. */
export function buildOrbitWithBla(
  ctx: OrbitContext,
  blaState: BlaTextureState,
  orbitData: OrbitData
): OrbitContext {
  return {
    ...ctx,
    blaTexture: blaState.texture,
    blaTexWidth: blaState.width,
    blaTexHeight: blaState.height,
    blaNumLevels: orbitData.blaNumLevels,
    blaLevelOffsetsGpu: padBlaOffsets(orbitData.blaLevelOffsets),
    rescaleS: orbitData.rescaleS,
  };
}
