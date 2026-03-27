/**
 * WASM Bridge — thin layer between JS and Rust perturbation module.
 * Lazy-loads WASM only when deep zoom is needed (scale < PERTURBATION_THRESHOLD).
 * Orbit computation runs in a dedicated Worker.
 *
 * Cancel architecture: Worker.terminate() for immediate cancel.
 * Progress: polled via postMessage between render cycles.
 */

const PERTURBATION_THRESHOLD = 1e-13;
const ORBIT_TIMEOUT_MS = 10_000;

let orbitWorker: Worker | null = null;

function isWasmSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

function createOrbitWorker(): Worker {
  if (!isWasmSupported()) {
    throw new Error('WebAssembly not supported — deep zoom requires a modern browser');
  }
  return new Worker(
    new URL('./orbit.worker.ts', import.meta.url),
    { type: 'module' }
  );
}

export function needsPerturbation(scale: number): boolean {
  return scale < PERTURBATION_THRESHOLD && isWasmSupported();
}

export function cancelOrbit(): void {
  if (orbitWorker) {
    orbitWorker.terminate();
    orbitWorker = null;
  }
}

export interface OrbitResult {
  data: Float32Array;
  length: number;
  cancelled: boolean;
}

export function computeReferenceOrbit(
  centerRe: string,
  centerIm: string,
  maxIter: number,
  scaleStr: string
): Promise<OrbitResult> {
  return new Promise((resolve, reject) => {
    cancelOrbit();

    let worker: Worker;
    try {
      worker = createOrbitWorker();
      orbitWorker = worker;
    } catch (e) {
      reject(e);
      return;
    }

    const timer = setTimeout(() => {
      cancelOrbit();
      reject(new Error(`Orbit computation timed out after ${ORBIT_TIMEOUT_MS}ms`));
    }, ORBIT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);
    };

    const handler = (e: MessageEvent) => {
      cleanup();
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve({
          data: e.data.orbitData,
          length: e.data.orbitLength,
          cancelled: e.data.cancelled ?? false,
        });
      }
    };

    const errorHandler = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(`Orbit worker error: ${e.message}`));
    };

    worker.addEventListener('message', handler);
    worker.addEventListener('error', errorHandler);

    worker.postMessage({
      type: 'compute-orbit',
      centerRe, centerIm, maxIter, scaleStr,
    });
  });
}

export { PERTURBATION_THRESHOLD };
