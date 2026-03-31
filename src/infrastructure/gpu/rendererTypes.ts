/**
 * Shared types for the WebGL renderer module.
 * Extracted from webglRenderer.ts for single-responsibility compliance.
 */

import type {
  Viewport, FractalType, ColoringMode, PaletteName, FractalParams,
  PrecisionMode, OrbitData
} from '../../domain/types';

export interface GPURenderOptions {
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  fractalParams: FractalParams;
  ssaa?: boolean;
  precision?: PrecisionMode;
  orbitData?: OrbitData;
}

export interface WebGLRenderer {
  render(options: GPURenderOptions): boolean;
  cancelPending(): void;
  updatePalette(palette: PaletteName): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
  isReady(): boolean;
  /** Get the GPU canvas element for export/screenshot. */
  getCanvas(): HTMLCanvasElement;
}

export interface DrawTarget {
  fbo: WebGLFramebuffer | null;
  width: number;
  height: number;
}

export interface CompiledRef {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
}

/** Orbit context for perturbation rendering. */
export interface OrbitContext {
  orbitData: OrbitData;
  orbitTexture: WebGLTexture;
  orbitTexWidth: number;
  orbitTexHeight: number;
  blaTexture: WebGLTexture | null;
  blaTexWidth: number;
  blaTexHeight: number;
  blaNumLevels: number;
  /** Pre-padded Int32Array(16) for gl.uniform1iv — avoids allocation per frame. */
  blaLevelOffsetsGpu: Int32Array | null;
  /** Rescaling factor S = 2^k — passed to GPU as u_rescaleS uniform. */
  rescaleS: number;
}

/** Mutable orbit texture state managed by the renderer closure. */
export interface OrbitTextureState {
  texture: WebGLTexture | null;
  width: number;
  height: number;
}

/** Mutable BLA texture state managed by the renderer closure. */
export interface BlaTextureState {
  texture: WebGLTexture | null;
  width: number;
  height: number;
}
