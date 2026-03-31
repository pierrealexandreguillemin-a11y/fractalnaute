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
import {
  createGpuCanvas, precompileCommonVariants, setupContextHandlers,
  destroyRendererResources, DEFAULT_PALETTE, PRECOMPILE_MAX_ITER
} from './gpuCanvasFactory';

import type { GPURenderOptions, WebGLRenderer, OrbitContext } from './rendererTypes';
import type { OrbitTextureState, BlaTextureState } from './rendererTypes';

export type { GPURenderOptions, WebGLRenderer } from './rendererTypes';

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

      let orbit: OrbitContext | undefined;
      if (precision === 'perturbation' && options.orbitData) {
        const ctx = buildOrbitContext(gl, orbitState, options.orbitData);
        if (!ctx) return false;
        uploadBlaData(gl, blaState, options.orbitData);
        orbit = buildOrbitWithBla(ctx, blaState, options.orbitData);
      }

      if (progressive.shouldUseProgressive(options.maxIterations)) {
        progressive.renderProgressive(compiled, options, emptyVAO, paletteTexture, orbit);
      } else {
        progressive.renderDirect(compiled, options, emptyVAO, paletteTexture, orbit);
      }
      return true;
    },

    cancelPending(): void { progressive.cancelPending(); },

    updatePalette(name: PaletteName): void {
      currentPalette = name;
      if (!contextLost) updatePaletteTexture(gl, paletteTexture, name);
    },

    resize(width: number, height: number): void {
      gpuCanvas.width = width;
      gpuCanvas.height = height;
    },

    setVisible(visible: boolean): void {
      gpuCanvas.style.display = visible ? 'block' : 'none';
    },

    destroy(): void {
      destroyed = true;
      gpuCanvas.removeEventListener('webglcontextlost', onContextLost);
      gpuCanvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyRendererResources(gl, progressive, paletteTexture, orbitState, blaState, emptyVAO);
      gpuCanvas.remove();
    },

    isReady(): boolean {
      if (contextLost) return false;
      pollCompilation(gl);
      return hasCompiledProgram();
    },

    getCanvas(): HTMLCanvasElement { return gpuCanvas; }
  };
}
