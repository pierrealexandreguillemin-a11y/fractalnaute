/* tslint:disable */
/* eslint-disable */

/**
 * Compute BLA table from reference orbit data.
 *
 * Returns `Float32Array`:
 *   `[num_levels (f32), level_offsets x num_levels, bla_table_data...]`
 *
 * # Errors
 *
 * Returns `JsValue` error if orbit data is invalid.
 */
export function compute_bla_table(orbit_data: Float32Array, orbit_length: number, max_dc: number, epsilon: number): Float32Array;

/**
 * Compute Mandelbrot reference orbit at arbitrary precision.
 *
 * Returns `Float32Array`:
 *   `[orbit_length (as f32), cancelled_flag (0.0/1.0),`
 *   `Z_re, Z_im, Z'_re, Z'_im, ...]`
 *
 * **Cancel/progress** (ISO 9241-110: controllability):
 * `control_buf` is an `Int32Array` backed by `SharedArrayBuffer(8)`:
 *   - offset 0: cancel flag (main thread writes 1 → Rust reads and aborts)
 *   - offset 1: progress counter (Rust writes current iteration → main reads)
 *
 * # Errors
 *
 * Returns `JsValue` error if coordinate parsing or precision scaling fails.
 */
export function compute_reference_orbit(center_re: string, center_im: string, max_iter: number, precision_bits: number, scale_str: string, control_buf: Int32Array): Float32Array;

/**
 * Estimate the dominant period at a location (f64 precision).
 *
 * Returns the period as i32, or -1 if not found.
 */
export function estimate_period(c_re: number, c_im: number, max_period: number): number;

/**
 * Find the nucleus (center) of a mini-Mandelbrot at the given period.
 *
 * Uses Newton's method with arbitrary-precision arithmetic.
 * Returns a JS string `"re\nim"` with high-precision coordinates.
 *
 * @see <https://mathr.co.uk/web/m-nucleus.html>
 *
 * # Errors
 *
 * Returns `JsValue` error if coordinate parsing fails.
 */
export function find_nucleus(c0_re: string, c0_im: string, period: number, precision_digits: number, newton_iters: number): string;

/**
 * Smoke test: verify `ArbFloat` precision at given bits.
 *
 * Parses a known value of π and returns its f64 representation.
 *
 * # Errors
 *
 * Returns `JsValue` error if parsing fails.
 */
export function verify_precision(bits: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_bla_table: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly compute_reference_orbit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly estimate_period: (a: number, b: number, c: number) => number;
    readonly find_nucleus: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly verify_precision: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
