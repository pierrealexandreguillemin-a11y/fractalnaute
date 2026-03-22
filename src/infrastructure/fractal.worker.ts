/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Fractal Worker
 * Thin entry point: message protocol + cancel flag
 * Computation delegated to renderBand (DRY)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { renderBand, buildMergedParams } from './renderBand';
import type {
  FractalType, PaletteName, FractalParams, Viewport
} from '../domain/types';

interface WorkerInput {
  band: { startY: number; endY: number };
  renderId: number;
  stride: number;
  width: number;
  height: number;
  viewport: Viewport;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  params: FractalParams;
  pixelBuffer: SharedArrayBuffer;
  cancelFlag: SharedArrayBuffer;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { band, renderId, stride, pixelBuffer, cancelFlag, ...renderParams } = e.data;

  const pixels = new Uint8ClampedArray(pixelBuffer);
  const cancel = new Int32Array(cancelFlag);

  const mergedParams = buildMergedParams(renderParams.fractalType, renderParams.params);

  const completed = renderBand(pixels, {
    startY: band.startY,
    endY: band.endY,
    ...renderParams,
    params: mergedParams,
    stride
  }, () => Atomics.load(cancel, 0) === 1);

  if (completed) {
    self.postMessage({
      type: 'band-done',
      renderId,
      startY: band.startY,
      endY: band.endY
    });
  }
};
