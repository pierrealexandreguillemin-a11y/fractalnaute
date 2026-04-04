/**
 * Nucleus finder — lazy-loads WASM and exposes Newton's method for mini-Mandelbrot centers.
 *
 * Runs on main thread (not worker): Newton iteration is fast (~10ms for period ≤100).
 * Returns high-precision coordinate strings (50+ digits) for deep zoom navigation.
 *
 * @see wasm/src/nucleus.rs for the Rust implementation
 */

interface NucleusWasm {
  default: () => Promise<void>;
  find_nucleus: (
    c0_re: string, c0_im: string,
    period: number, precision_digits: number, newton_iters: number
  ) => string;
  estimate_period: (c_re: number, c_im: number, max_period: number) => number;
}

let wasmModule: NucleusWasm | null = null;

/** Runtime path — served from public/wasm/ (not a bundled module) */
const WASM_PATH = '/wasm/fractalnaute_wasm.js';

async function loadWasm(): Promise<NucleusWasm> {
  if (wasmModule) return wasmModule;
  const wasm = await (import(/* webpackIgnore: true */ WASM_PATH) as Promise<NucleusWasm>);
  await wasm.default();
  wasmModule = wasm;
  return wasm;
}

export interface NucleusResult {
  re: string;
  im: string;
  period: number;
}

/**
 * Find the nearest mini-Mandelbrot nucleus from approximate coordinates.
 *
 * 1. Estimates the dominant period at (centerRe, centerIm) via orbit detection
 * 2. Refines the nucleus to `precisionDigits` via Newton's method
 *
 * Returns null if no period found (point is outside the set or not near a nucleus).
 */
export async function findNearestNucleus(
  centerRe: number,
  centerIm: number,
  precisionDigits: number = 50,
): Promise<NucleusResult | null> {
  const wasm = await loadWasm();

  const period = wasm.estimate_period(centerRe, centerIm, 10_000);
  if (period <= 0) return null;

  const resultStr = wasm.find_nucleus(
    centerRe.toString(), centerIm.toString(),
    period, precisionDigits, 30,
  );

  // find_nucleus returns "re\nim"
  const parts = resultStr.split('\n');
  if (parts.length < 2) return null;

  return { re: parts[0]!, im: parts[1]!, period };
}
