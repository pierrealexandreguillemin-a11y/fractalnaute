/**
 * ===============================================================================
 * INFRASTRUCTURE LAYER - WebGL Renderer Factory
 * Wires together shader compiler, texture management, progressive rendering,
 * and GPU canvas to expose a single createWebGLRenderer entry point.
 * ===============================================================================
 */

import type { PaletteName } from '../../domain/types';
import { initCompiler, getOrCompile, pollCompilation, hasCompiledProgram } from './shaderCache';
import { createPaletteTexture, updatePaletteTexture } from './paletteTexture';
import { buildOrbitContext, uploadBlaData, buildOrbitWithBla } from './orbitContextBuilder';
import { createProgressiveController } from './progressiveController';
import { createMultiFrameController } from './multiFrameRenderer';
import {
  createGpuCanvas, precompileCommonVariants, setupContextHandlers,
  destroyRendererResources, DEFAULT_PALETTE, PRECOMPILE_MAX_ITER
} from './gpuCanvasFactory';

import type { GPURenderOptions, WebGLRenderer, OrbitContext } from './rendererTypes';
import type { OrbitTextureState, BlaTextureState } from './rendererTypes';

export type { GPURenderOptions, WebGLRenderer } from './rendererTypes';

/** Build orbit context for perturbation, uploading textures to GPU. */
function buildOrbit(
  gl: WebGL2RenderingContext,
  orbitState: OrbitTextureState, blaState: BlaTextureState,
  options: GPURenderOptions
): OrbitContext | false | undefined {
  const precision = options.precision ?? 'doubleSingle';
  if (precision !== 'perturbation' || !options.orbitData) return undefined;
  const ctx = buildOrbitContext(gl, orbitState, options.orbitData);
  if (!ctx) return false;
  uploadBlaData(gl, blaState, options.orbitData);
  return buildOrbitWithBla(ctx, blaState, options.orbitData);
}

/**
 * Create a WebGL 2 renderer with its own dedicated canvas overlay.
 * Returns null if the browser does not support WebGL 2.
 */
export function createWebGLRenderer(
  container: HTMLElement,
  initialPalette?: PaletteName
): WebGLRenderer | null {
  const result = createGpuCanvas(container);
  if (!result) return null;
  const { gpuCanvas, gl } = result;

  const emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  initCompiler(gl);
  const palette = initialPalette ?? DEFAULT_PALETTE;
  let paletteTexture = createPaletteTexture(gl, palette);
  let currentPalette: PaletteName = palette;
  let contextLost = false;
  let destroyed = false;
  const orbitState: OrbitTextureState = { texture: null, width: 0, height: 0 };
  const blaState: BlaTextureState = { texture: null, width: 0, height: 0 };
  const progressive = createProgressiveController(gl);
  const multiFrame = createMultiFrameController(gl);
  getOrCompile(gl, 'mandelbrot', 'classic', PRECOMPILE_MAX_ITER);
  precompileCommonVariants(gl, () => destroyed);
  const resetTextures = (): void => {
    orbitState.texture = null; orbitState.width = 0; orbitState.height = 0;
    blaState.texture = null; blaState.width = 0; blaState.height = 0;
  };
  const { onContextLost, onContextRestored } = setupContextHandlers(
    gl, gpuCanvas, progressive, () => currentPalette,
    (tex: WebGLTexture) => { paletteTexture = tex; },
    (v: boolean) => { contextLost = v; }, resetTextures
  );

  return {
    render(options: GPURenderOptions): boolean {
      if (contextLost) return false;
      progressive.cancelPending();
      progressive.pollTimerQuery();
      pollCompilation(gl);
      const precision = options.precision ?? 'doubleSingle';
      const compiled = getOrCompile(gl, options.fractalType, options.coloringMode,
        options.maxIterations, options.interiorColoring, precision);
      if (!compiled) return false;
      const orbit = buildOrbit(gl, orbitState, blaState, options);
      if (orbit === false) return false;

      if (progressive.shouldUseProgressive(options.maxIterations)) {
        progressive.renderProgressive(compiled, options, emptyVAO, paletteTexture, orbit);
      } else {
        progressive.renderDirect(compiled, options, emptyVAO, paletteTexture, orbit);
      }
      return true;
    },

    renderMultiFrame(options, onBatchProgress, onComplete) {
      if (contextLost || !multiFrame) return null;
      return multiFrame.start(
        options, emptyVAO, paletteTexture,
        onBatchProgress, onComplete, options.orbitData, options.precision
      );
    },

    cancelPending(): void { progressive.cancelPending(); },
    updatePalette(name: PaletteName): void {
      currentPalette = name;
      if (!contextLost) updatePaletteTexture(gl, paletteTexture, name);
    },
    resize(w: number, h: number): void { gpuCanvas.width = w; gpuCanvas.height = h; },
    setVisible(visible: boolean): void { gpuCanvas.style.display = visible ? 'block' : 'none'; },

    destroy(): void {
      destroyed = true;
      gpuCanvas.removeEventListener('webglcontextlost', onContextLost);
      gpuCanvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyRendererResources(gl, progressive, paletteTexture, orbitState, blaState, emptyVAO);
      multiFrame?.destroy();
      gpuCanvas.remove();
    },

    isReady(): boolean {
      if (contextLost) return false;
      pollCompilation(gl); return hasCompiledProgram();
    },
    getCanvas(): HTMLCanvasElement { return gpuCanvas; }
  };
}
