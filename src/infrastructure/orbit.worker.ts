/**
 * Dedicated Worker for WASM orbit computation.
 * Loads WASM lazily on first message.
 * Cancel = Worker.terminate() from main thread (wasmBridge.cancelOrbit).
 */

interface WasmModule {
  default: () => Promise<void>;
  compute_reference_orbit(
    centerRe: string, centerIm: string,
    maxIter: number, precisionBits: number, scaleStr: string,
    controlBuf: Int32Array
  ): Float32Array;
}

let wasmModule: WasmModule | null = null;

/** Runtime path — served from public/wasm/ (not a bundled module) */
const WASM_PATH = '/wasm/fractalnaute_wasm.js';

async function loadWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  // Dynamic import with runtime string — webpackIgnore prevents bundling
  const wasm = await (import(/* webpackIgnore: true */ WASM_PATH) as Promise<WasmModule>);
  await wasm.default();
  wasmModule = wasm;
  return wasm;
}

self.addEventListener('message', (e: MessageEvent) => {
  if (e.data.type !== 'compute-orbit') return;

  const { centerRe, centerIm, maxIter, scaleStr } = e.data;

  loadWasm().then((wasm) => {
    const controlBuf = new Int32Array(2);

    const resultArray = wasm.compute_reference_orbit(
      centerRe, centerIm, maxIter, 0, scaleStr, controlBuf
    );

    const orbitLength = Math.round(resultArray[0]!);
    const cancelled = resultArray[1] !== 0;
    // .slice() copies data (vs .subarray() which shares buffer).
    // Necessary because WASM linear memory may be detached after worker terminates.
    const orbitData = resultArray.slice(2);

    self.postMessage({ orbitData, orbitLength, cancelled });
  }).catch((err: unknown) => {
    self.postMessage({ error: String(err) });
  });
});
