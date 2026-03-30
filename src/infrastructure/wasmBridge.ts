/**
 * WASM Bridge — thin layer between JS and Rust perturbation module.
 * Lazy-loads WASM only when deep zoom is needed (scale < PERTURBATION_THRESHOLD).
 * Orbit computation runs in a dedicated Worker with SAB cancel/progress.
 *
 * Cancel architecture: SharedArrayBuffer(8) = [cancel_flag:i32, progress:i32]
 * Same pattern as workerPool.ts (ISO 9241-110: controllability).
 */

const PERTURBATION_THRESHOLD = 1e-13;
/** ISO 25010 Performance: orbit computation timeout. */
const ORBIT_TIMEOUT_MS = 10_000;

let orbitWorker: Worker | null = null;
let controlBuffer: SharedArrayBuffer | null = null;
let controlView: Int32Array | null = null;

function isWasmSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

function ensureControlBuffer(): void {
  if (!controlBuffer) {
    controlBuffer = new SharedArrayBuffer(8);
    controlView = new Int32Array(controlBuffer);
  }
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

/** Read current orbit computation progress (0..maxIter). */
export function getOrbitProgress(): number {
  if (!controlView) return 0;
  return Atomics.load(controlView, 1);
}

/** Cancel any in-progress orbit computation via SAB flag. */
export function cancelOrbit(): void {
  if (controlView) {
    Atomics.store(controlView, 0, 1);
  }
  if (orbitWorker) {
    orbitWorker.terminate();
    orbitWorker = null;
  }
}

export interface OrbitResult {
  data: Float32Array;
  length: number;
  cancelled: boolean;
  blaData: Float32Array | null;
  blaNumLevels: number;
  blaLevelOffsets: number[];
}

export function computeReferenceOrbit(
  centerRe: string,
  centerIm: string,
  maxIter: number,
  scaleStr: string,
  maxDc: number = 0.01
): Promise<OrbitResult> {
  return new Promise((resolve, reject) => {
    cancelOrbit();
    ensureControlBuffer();

    // Reset control buffer: cancel=0, progress=0
    Atomics.store(controlView!, 0, 0);
    Atomics.store(controlView!, 1, 0);

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
          blaData: e.data.blaData ?? null,
          blaNumLevels: e.data.blaNumLevels ?? 0,
          blaLevelOffsets: e.data.blaLevelOffsets ?? [],
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
      centerRe, centerIm, maxIter, scaleStr, maxDc,
      controlBuffer: controlBuffer!,
    });
  });
}

export { PERTURBATION_THRESHOLD };
