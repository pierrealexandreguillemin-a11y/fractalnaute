/**
 * GPU canvas creation, idle-time shader precompilation, context loss handlers,
 * and resource teardown.
 */

import type { FractalType, PaletteName } from '../../domain/types';
import type { OrbitTextureState, BlaTextureState } from './rendererTypes';
import type { ProgressiveController } from './progressiveController';
import { initCompiler, getOrCompile, destroyAllPrograms } from './shaderCompiler';
import { createPaletteTexture } from './paletteTexture';
import { destroyOrbitTexture } from './orbitTexture';
import { destroyBlaTexture } from './blaTexture';

export const DEFAULT_PALETTE: PaletteName = 'classic';
/** Default iteration count for eager pre-compilation. */
export const PRECOMPILE_MAX_ITER = 1024;

/** Fractal variants to pre-compile (classic coloring covers the default). */
const PRECOMPILE_FRACTALS: FractalType[] = [
  'julia', 'burningship', 'tricorn', 'multibrot3'
];

/** Perturbation variants to pre-compile (needed before deep zoom). */
type PrecompileEntry = { fractal: FractalType; precision: 'doubleSingle' | 'perturbation' };
const PRECOMPILE_PERTURBATION: PrecompileEntry[] = [
  { fractal: 'mandelbrot', precision: 'perturbation' },
];

/**
 * Create an overlay canvas for WebGL 2 rendering.
 * Separate canvas avoids the one-context-per-canvas browser restriction.
 */
export function createGpuCanvas(
  container: HTMLElement
): { gpuCanvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  const gpuCanvas = document.createElement('canvas');
  gpuCanvas.style.position = 'absolute';
  gpuCanvas.style.top = '0';
  gpuCanvas.style.left = '0';
  gpuCanvas.style.width = '100%';
  gpuCanvas.style.height = '100%';
  gpuCanvas.style.pointerEvents = 'none';
  gpuCanvas.style.display = 'none';

  const maybeGl = gpuCanvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!maybeGl) return null;

  container.appendChild(gpuCanvas);
  return { gpuCanvas, gl: maybeGl };
}

/**
 * Pre-compile common shader variants during browser idle time.
 * mandelbrot+classic is compiled eagerly; this covers the rest.
 */
export function precompileCommonVariants(
  gl: WebGL2RenderingContext,
  isDestroyed: () => boolean
): void {
  const total = PRECOMPILE_FRACTALS.length + PRECOMPILE_PERTURBATION.length;
  let index = 0;

  function step(): void {
    if (isDestroyed() || index >= total) return;
    if (index < PRECOMPILE_FRACTALS.length) {
      const fractal = PRECOMPILE_FRACTALS[index]!;
      getOrCompile(gl, fractal, 'classic', PRECOMPILE_MAX_ITER);
    } else {
      const entry = PRECOMPILE_PERTURBATION[index - PRECOMPILE_FRACTALS.length]!;
      getOrCompile(gl, entry.fractal, 'classic', PRECOMPILE_MAX_ITER, false, entry.precision);
    }
    index++;
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(step);
    } else {
      setTimeout(step, 50);
    }
  }

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(step);
  } else {
    setTimeout(step, 50);
  }
}

/** Set up webglcontextlost/restored event handlers. */
export function setupContextHandlers(
  gl: WebGL2RenderingContext,
  gpuCanvas: HTMLCanvasElement,
  progressive: ProgressiveController,
  getCurrentPalette: () => PaletteName,
  setPaletteTexture: (tex: WebGLTexture) => void,
  setContextLost: (v: boolean) => void,
  resetTextureState?: () => void
): { onContextLost: (e: Event) => void; onContextRestored: () => void } {
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    setContextLost(true);
  };
  const onContextRestored = (): void => {
    setContextLost(false);
    progressive.resetState();
    resetTextureState?.();
    initCompiler(gl);
    setPaletteTexture(createPaletteTexture(gl, getCurrentPalette()));
    getOrCompile(gl, 'mandelbrot', 'classic', PRECOMPILE_MAX_ITER);
  };
  gpuCanvas.addEventListener('webglcontextlost', onContextLost);
  gpuCanvas.addEventListener('webglcontextrestored', onContextRestored);
  return { onContextLost, onContextRestored };
}

/** Clean up all renderer GL resources. */
export function destroyRendererResources(
  gl: WebGL2RenderingContext,
  progressive: ProgressiveController,
  paletteTexture: WebGLTexture,
  orbitState: OrbitTextureState,
  blaState: BlaTextureState,
  emptyVAO: WebGLVertexArrayObject | null
): void {
  progressive.destroy();
  destroyAllPrograms(gl);
  gl.deleteTexture(paletteTexture);
  if (orbitState.texture) { destroyOrbitTexture(gl, orbitState.texture); orbitState.texture = null; }
  if (blaState.texture) { destroyBlaTexture(gl, blaState.texture); blaState.texture = null; }
  gl.deleteVertexArray(emptyVAO);
}
