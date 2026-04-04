/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INFRASTRUCTURE LAYER - Public API
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { renderFractal } from './renderer';
export { renderBand } from './renderBand';
export { resizeCanvas, exportCanvas, downloadCanvas } from './canvasUtils';
export { useRenderer } from './useRenderer';
export { WorkerPool, createWorkerPool, isSharedArrayBufferAvailable } from './workerPool';
export { cancelOrbit, needsPerturbation, getOrbitProgress } from './wasmBridge';
export { findNearestNucleus } from './nucleusFinder';
export type { NucleusResult } from './nucleusFinder';
