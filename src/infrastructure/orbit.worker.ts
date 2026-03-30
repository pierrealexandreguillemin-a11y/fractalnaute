/**
 * Dedicated Worker for WASM orbit computation.
 * Receives SharedArrayBuffer for cancel/progress (SAB atomics).
 * Loads WASM lazily on first message.
 */

interface WasmModule {
  default: () => Promise<void>;
  compute_reference_orbit(
    centerRe: string, centerIm: string,
    maxIter: number, precisionBits: number, scaleStr: string,
    controlView: Int32Array
  ): Float32Array;
  compute_bla_table(
    orbitData: Float32Array,
    orbitLength: number,
    maxDc: number,
    epsilon: number,
  ): Float32Array;
}

let wasmModule: WasmModule | null = null;

/** Runtime path — served from public/wasm/ (not a bundled module) */
const WASM_PATH = '/wasm/fractalnaute_wasm.js';

async function loadWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;
  const wasm = await (import(/* webpackIgnore: true */ WASM_PATH) as Promise<WasmModule>);
  await wasm.default();
  wasmModule = wasm;
  return wasm;
}

self.addEventListener('message', (e: MessageEvent) => {
  if (e.data.type !== 'compute-orbit') return;

  const { centerRe, centerIm, maxIter, scaleStr, controlBuffer, maxDc } = e.data;
  const controlView = new Int32Array(controlBuffer as SharedArrayBuffer);

  loadWasm().then((wasm) => {
    const resultArray = wasm.compute_reference_orbit(
      centerRe, centerIm, maxIter, 0, scaleStr, controlView
    );

    const orbitLength = Math.round(resultArray[0]!);
    const cancelled = resultArray[1] !== 0;
    // .slice() copies data (vs .subarray() which shares buffer).
    // Necessary because WASM linear memory may be detached after worker terminates.
    const orbitData = resultArray.slice(2);

    // Compute BLA table from orbit data
    let blaData: Float32Array | null = null;
    let blaNumLevels = 0;
    const blaLevelOffsets: number[] = [];

    if (!cancelled && orbitLength > 4) {
      const blaMaxDc = (maxDc as number | undefined) ?? 0.01;
      const blaResult = wasm.compute_bla_table(
        orbitData, orbitLength, blaMaxDc, 0 // epsilon=0 uses default 2^-23
      );
      blaNumLevels = Math.round(blaResult[0]!);
      for (let i = 0; i < blaNumLevels; i++) {
        blaLevelOffsets.push(Math.round(blaResult[1 + i]!));
      }
      const blaHeaderSize = 1 + blaNumLevels;
      blaData = blaResult.slice(blaHeaderSize);
    }

    self.postMessage({
      orbitData, orbitLength, cancelled,
      blaData, blaNumLevels, blaLevelOffsets,
    });
  }).catch((err: unknown) => {
    self.postMessage({ error: String(err) });
  });
});
