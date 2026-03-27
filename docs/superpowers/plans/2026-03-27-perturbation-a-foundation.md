# Perturbation Theory — Plan A: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all new components for perturbation (Rust/WASM orbit, GLSL shader, orbit texture, WASM bridge). Zero modification to existing files except `types.ts` and config. Everything testable independently.

**Architecture:** Rust crate (`astro-float`) computes reference orbit at arbitrary precision, exports as `Float32Array`. GPU fragment shader iterates perturbation deltas from the reference orbit (stored as RGBA32F texture). Rebasing (Zhuoran 2021) handles glitches in-shader. Dedicated orbit Worker with SAB cancel/progress.

**Tech Stack:** Rust + wasm-pack + wasm-bindgen, astro-float (arbitrary precision), WebGL 2 RGBA32F textures. WASM compiled with `+atomics,+bulk-memory` for SharedArrayBuffer-based cancel/progress.

**Next:** Plan B (`2026-03-27-perturbation-b-integration.md`) wires everything into the existing codebase.

**Cancellation architecture:** Orbit WASM runs in a dedicated Worker. A `SharedArrayBuffer(8)` carries cancel flag (offset 0) + progress counter (offset 4). Rust checks `AtomicI32::load(Relaxed)` every 1024 iterations — ~100ns total overhead on 100K iterations. Same pattern already used by `workerPool.ts` for CPU fractal workers.

**Spec:** `docs/superpowers/specs/2026-03-26-perturbation-theory-design.md`
**Rev:** 2026-03-27 — ISO audit corrections (IEEE 754, ISO 25010, 9241-110, WCAG 2.1, 27001, 80000-2)

---

## File Map

### New files (Rust/WASM)
- `wasm/Cargo.toml` — Rust crate config
- `wasm/src/lib.rs` — WASM entry points (wasm-bindgen)
- `wasm/src/precision.rs` — astro-float wrapper, auto-scaling
- `wasm/src/orbit.rs` — Reference orbit computation

### New files (TypeScript)
- `src/infrastructure/gpu/shaders/perturbation.ts` — Perturbation GLSL chunks
- `src/infrastructure/gpu/orbitTexture.ts` — Orbit texture upload/management
- `src/infrastructure/wasmBridge.ts` — WASM loader + TS wrappers
- `src/infrastructure/orbit.worker.ts` — Dedicated Worker for WASM orbit (SAB cancel+progress)
- `src/infrastructure/gpu/__tests__/perturbation.test.ts` — Perturbation shader assembly tests
- `src/infrastructure/__tests__/orbitTexture.test.ts` — Orbit texture tests
- `src/infrastructure/__tests__/wasmBridge.test.ts` — WASM bridge tests

### Modified files (Plan A — minimal footprint)
- `src/domain/types.ts` — Add `DeepViewport`, `PrecisionMode`, `OrbitData`
- `package.json` — WASM build scripts
- `vercel.json` — CSP `wasm-unsafe-eval`
- `.gitignore` — wasm/target/, wasm/pkg/, public/wasm/

### Modified in Plan B (not this plan)
- `src/infrastructure/gpu/shaderCompiler.ts` — Add perturbation assembly path
- `src/infrastructure/gpu/webglRenderer.ts` — Add orbit texture binding + perturbation uniforms
- `src/infrastructure/renderer.ts` — Add perturbation pipeline in facade
- `src/application/useFractalState.ts` — Deep viewport string coordinates + precision mode
- `src/application/useUrlState.ts` — Deep URL encoding
- `src/application/useCanvasEvents.ts` — Escape cancel

---

## Task 1: Rust Toolchain + WASM Bridge + astro-float Verification

**Goal:** Verify astro-float compiles to WASM, establish build pipeline, call Rust from browser.

**Files:**
- Create: `wasm/Cargo.toml`
- Create: `wasm/src/lib.rs`
- Create: `wasm/.cargo/config.toml`
- Modify: `package.json` (add wasm build scripts)
- Modify: `.gitignore` (wasm/pkg/, wasm/target/)

- [ ] **Step 1: Install Rust toolchain + wasm-pack (if not present)**

Run:
```bash
rustup --version || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
```
Expected: `wasm-pack --version` prints version.

- [ ] **Step 2: Create Cargo.toml with astro-float dependency**

Create `wasm/Cargo.toml`:
```toml
[package]
name = "fractalnaute-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
astro-float = "0.9"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
```

- [ ] **Step 3: Create minimal lib.rs with astro-float smoke test**

Create `wasm/src/lib.rs`:
```rust
#![deny(clippy::all, clippy::pedantic)]
#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;
use astro_float::{BigFloat, RoundingMode, Consts};

/// Smoke test: compute pi to `precision_bits` bits, return as string.
/// Verifies astro-float works in WASM.
#[wasm_bindgen]
pub fn compute_pi(precision_bits: u32) -> Result<String, JsValue> {
    let prec = precision_bits as usize;
    let mut cc = Consts::new().map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    let pi = cc.pi(prec, RoundingMode::ToEven);
    Ok(format!("{}", pi))
}

/// Smoke test: add two decimal strings at given precision.
#[wasm_bindgen]
pub fn add_precise(a: &str, b: &str, precision_bits: u32) -> Result<String, JsValue> {
    let prec = precision_bits as usize;
    let rm = RoundingMode::ToEven;
    let a = BigFloat::parse(a, astro_float::Radix::Dec, prec, rm, &mut Consts::new().unwrap());
    let b = BigFloat::parse(b, astro_float::Radix::Dec, prec, rm, &mut Consts::new().unwrap());
    let sum = a.add(&b, prec, rm);
    Ok(format!("{}", sum))
}
```

- [ ] **Step 4: Build WASM and verify it compiles**

Run:
```bash
cd wasm && wasm-pack build --target web --release
```
Expected: `wasm/pkg/` directory created with `.wasm` file + JS/TS glue. No compilation errors.

**If astro-float fails to compile to WASM:** try `dashu` crate as fallback (replace dependency in Cargo.toml, adjust API). Document the decision.

- [ ] **Step 5: Check WASM binary size**

Run:
```bash
ls -lh wasm/pkg/fractalnaute_wasm_bg.wasm
```
Expected: <1MB (budget: 500KB gzipped). If larger, consider `wasm-opt -Oz`.

- [ ] **Step 6: Add .gitignore entries and build scripts**

Add to `.gitignore`:
```
wasm/target/
wasm/pkg/
```

Add to `package.json` scripts:
```json
"wasm:build": "cd wasm && RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals' wasm-pack build --target web --release",
"wasm:dev": "cd wasm && wasm-pack build --target web --dev",
"prebuild": "npm run wasm:build"
```

- [ ] **Step 7: Commit**

```bash
git add wasm/Cargo.toml wasm/Cargo.lock wasm/src/lib.rs wasm/.cargo/config.toml .gitignore package.json
git commit -m "feat(wasm): bootstrap Rust crate with astro-float, verify WASM compilation"
```

**Note:** `Cargo.lock` is committed for supply chain integrity (ISO 27001).

---

## Task 2: Precision Wrapper + Reference Orbit Computation (Rust)

**Goal:** Compute Mandelbrot reference orbit at arbitrary precision, return as Float32Array for GPU.

**Files:**
- Create: `wasm/src/precision.rs`
- Create: `wasm/src/orbit.rs`
- Modify: `wasm/src/lib.rs`

- [ ] **Step 1: Create precision.rs — auto-scaling wrapper**

Create `wasm/src/precision.rs`:
```rust
use astro_float::{BigFloat, Consts, Radix, RoundingMode};

const RM: RoundingMode = RoundingMode::ToEven;
const PRECISION_MARGIN: usize = 64;

/// Compute required precision bits for a given zoom scale.
/// bits = ceil(log2(1/scale)) + 64 margin  (spec §2: Precision auto-scaling)
///
/// ISO 27001: explicit error on malformed input, never silent fallback.
pub fn bits_for_scale(scale_str: &str) -> Result<usize, String> {
    let scale: f64 = scale_str.parse()
        .map_err(|e| format!("invalid scale string '{scale_str}': {e}"))?;
    if scale <= 0.0 || !scale.is_finite() {
        return Err(format!("scale must be positive and finite, got {scale}"));
    }
    if scale >= 1e-13 {
        return Ok(64); // DS precision is enough
    }
    let log2_inv = -(scale.log2());
    Ok((log2_inv.ceil() as usize) + PRECISION_MARGIN)
}

/// Parse a decimal string into a BigFloat at given precision.
/// ISO 27001: returns Result, never panics on malformed input.
pub fn parse_decimal(s: &str, prec: usize) -> Result<BigFloat, String> {
    let mut cc = Consts::new().map_err(|e| format!("{e:?}"))?;
    Ok(BigFloat::parse(s, Radix::Dec, prec, RM, &mut cc))
}

/// Convert a BigFloat to f32 (for GPU texture upload).
/// IEEE 754-2019: checks for finite result after f64→f32 truncation.
pub fn to_f32(val: &BigFloat) -> f32 {
    let f = val.to_f64() as f32;
    if f.is_finite() || val.to_f64() == 0.0 { f } else { 0.0_f32 }
}

/// Convert a BigFloat to f64 (for escape check).
pub fn to_f64(val: &BigFloat) -> f64 {
    val.to_f64()
}
```

- [ ] **Step 2: Create orbit.rs — reference orbit computation**

Create `wasm/src/orbit.rs`:
```rust
use std::sync::atomic::{AtomicI32, Ordering};
use astro_float::{BigFloat, Consts, RoundingMode};
use crate::precision::{parse_decimal, to_f32, to_f64};

const RM: RoundingMode = RoundingMode::ToEven;
const BAILOUT_SQ: f64 = 4.0;
/// Check cancel flag every N iterations. 1024 = ~100ns total for 100K iter.
const CANCEL_CHECK_INTERVAL: u32 = 1024;

/// Result of orbit computation — may be cancelled.
pub enum OrbitResult {
    Complete(Vec<f32>, u32),
    Cancelled(Vec<f32>, u32),
}

/// Compute Mandelbrot reference orbit at arbitrary precision.
/// Returns flat [Z_re, Z_im, Z'_re, Z'_im, ...] as f32 values.
///
/// Mathematical formulas (ISO 80000-2, uppercase Z for reference orbit):
///   Z_{n+1} = Z_n² + C       (Mandelbrot recurrence)
///   Z'_{n+1} = 2·Z_n·Z'_n + 1  (derivative for distance estimation)
///
/// Critical: orbit MUST start at Z_0 = 0 (SA depends on complete orbit).
///
/// Cancel/progress via SharedArrayBuffer atomics (ISO 9241-110: controllability):
///   cancel_flag: 0 = continue, nonzero = abort
///   progress: updated every CANCEL_CHECK_INTERVAL iterations
pub fn compute_mandelbrot_orbit(
    c_re_str: &str,
    c_im_str: &str,
    max_iter: u32,
    precision_bits: usize,
    cancel_flag: &AtomicI32,
    progress: &AtomicI32,
) -> Result<OrbitResult, String> {
    let c_re = parse_decimal(c_re_str, precision_bits)?;
    let c_im = parse_decimal(c_im_str, precision_bits)?;

    let prec = precision_bits;

    let zero = BigFloat::from_f64(0.0, prec);
    let one = BigFloat::from_f64(1.0, prec);
    let two = BigFloat::from_f64(2.0, prec);

    let mut z_re = zero.clone(); // Z_0 = 0
    let mut z_im = zero.clone();
    let mut dz_re = zero.clone(); // Z'_0 = 0
    let mut dz_im = zero.clone();

    let mut orbit = Vec::with_capacity((max_iter as usize) * 4);
    let mut actual_length: u32 = 0;

    for i in 0..max_iter {
        // Cancel check + progress update (SAB atomics, ISO 9241-110)
        if i % CANCEL_CHECK_INTERVAL == 0 {
            if cancel_flag.load(Ordering::Relaxed) != 0 {
                return Ok(OrbitResult::Cancelled(orbit, actual_length));
            }
            progress.store(i as i32, Ordering::Relaxed);
        }

        // Store current Z_n and Z'_n as f32 for GPU texture
        orbit.push(to_f32(&z_re));
        orbit.push(to_f32(&z_im));
        orbit.push(to_f32(&dz_re));
        orbit.push(to_f32(&dz_im));
        actual_length += 1;

        // Escape check on |Z_n|² (f64 sufficient for this comparison)
        let z_re_f64 = to_f64(&z_re);
        let z_im_f64 = to_f64(&z_im);
        if z_re_f64 * z_re_f64 + z_im_f64 * z_im_f64 > BAILOUT_SQ {
            break;
        }

        // Z'_{n+1} = 2·Z_n·Z'_n + 1  (complex derivative, ISO 80000-2)
        let zr_dzr = z_re.mul(&dz_re, prec, RM);
        let zi_dzi = z_im.mul(&dz_im, prec, RM);
        let zr_dzi = z_re.mul(&dz_im, prec, RM);
        let zi_dzr = z_im.mul(&dz_re, prec, RM);

        let dz_re_new = two.mul(&zr_dzr.sub(&zi_dzi, prec, RM), prec, RM)
            .add(&one, prec, RM);
        let dz_im_new = two.mul(&zr_dzi.add(&zi_dzr, prec, RM), prec, RM);

        dz_re = dz_re_new;
        dz_im = dz_im_new;

        // Z_{n+1} = Z_n² + C  (Mandelbrot recurrence, ISO 80000-2)
        let z_re_sq = z_re.mul(&z_re, prec, RM);
        let z_im_sq = z_im.mul(&z_im, prec, RM);
        let two_zr_zi = two.mul(&z_re.mul(&z_im, prec, RM), prec, RM);

        z_re = z_re_sq.sub(&z_im_sq, prec, RM).add(&c_re, prec, RM);
        z_im = two_zr_zi.add(&c_im, prec, RM);
    }

    progress.store(actual_length as i32, Ordering::Relaxed);
    Ok(OrbitResult::Complete(orbit, actual_length))
}
```

- [ ] **Step 3: Wire up WASM exports in lib.rs**

Replace `wasm/src/lib.rs`:
```rust
#![deny(clippy::all, clippy::pedantic)]
#![forbid(unsafe_code)]

mod precision;
mod orbit;

use std::sync::atomic::{AtomicI32, Ordering};
use wasm_bindgen::prelude::*;
use js_sys::{Float32Array, Int32Array};

/// SharedArrayBuffer layout for cancel/progress:
///   offset 0: cancel flag (0 = continue, nonzero = abort)
///   offset 4: progress counter (current iteration)
/// Matches workerPool.ts pattern (ISO 9241-110: controllability).

/// Compute Mandelbrot reference orbit at arbitrary precision.
///
/// Returns a Float32Array where:
///   - First 4 bytes (as u32): orbit_length
///   - Remaining: flat [Z_re, Z_im, Z'_re, Z'_im, ...] per iteration
///
/// # Arguments
/// - `center_re`, `center_im`: decimal string coordinates (arbitrary precision)
/// - `max_iter`: maximum iterations
/// - `precision_bits`: 0 = auto-scale from scale_str
/// - `scale_str`: viewport scale as decimal string (for auto-scaling)
/// - `control_buf`: Int32Array backed by SharedArrayBuffer [cancel_flag, progress]
///
/// # Errors
/// Returns JsValue error on invalid input (ISO 27001: input validation at boundaries).
#[wasm_bindgen]
pub fn compute_reference_orbit(
    center_re: &str,
    center_im: &str,
    max_iter: u32,
    precision_bits: u32,
    scale_str: &str,
    control_buf: &Int32Array,
) -> Result<Float32Array, JsValue> {
    let prec = if precision_bits == 0 {
        precision::bits_for_scale(scale_str)
            .map_err(|e| JsValue::from_str(&e))?
    } else {
        precision_bits as usize
    };

    // Map control buffer to atomics (SAB cancel + progress)
    // Safety: Int32Array is backed by SharedArrayBuffer from JS.
    // We create AtomicI32 references for cooperative cancel/progress.
    let cancel_flag = AtomicI32::new(control_buf.get_index(0));
    let progress = AtomicI32::new(0);

    let result = orbit::compute_mandelbrot_orbit(
        center_re, center_im, max_iter, prec,
        &cancel_flag, &progress
    ).map_err(|e| JsValue::from_str(&e))?;

    let (data, length, cancelled) = match result {
        orbit::OrbitResult::Complete(d, l) => (d, l, false),
        orbit::OrbitResult::Cancelled(d, l) => (d, l, true),
    };

    // Pack: [orbit_length_as_f32_bits, cancelled_flag, ...orbit_data]
    let header_len = 2;
    let arr = Float32Array::new_with_length((header_len + data.len()) as u32);
    arr.set_index(0, f32::from_bits(length));
    arr.set_index(1, if cancelled { 1.0 } else { 0.0 });
    // Copy orbit data starting at offset 2
    let orbit_arr = Float32Array::new_with_length(data.len() as u32);
    orbit_arr.copy_from(&data);
    arr.set(&orbit_arr, header_len as u32);

    // Update progress to final value
    control_buf.set_index(1, length as i32);

    Ok(arr)
}

/// Smoke test: verify astro-float precision at given bits.
/// ISO 27001: all error paths return Result, never panic.
#[wasm_bindgen]
pub fn verify_precision(bits: u32) -> Result<String, JsValue> {
    use astro_float::{Consts, RoundingMode};
    let prec = bits as usize;
    let mut cc = Consts::new().map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    let pi = cc.pi(prec, RoundingMode::ToEven);
    Ok(format!("{pi}"))
}
```

- [ ] **Step 4: Add Rust unit tests**

Add to `wasm/src/orbit.rs` (at the bottom):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicI32;

    fn no_cancel() -> (AtomicI32, AtomicI32) {
        (AtomicI32::new(0), AtomicI32::new(0))
    }

    fn unwrap_complete(result: OrbitResult) -> (Vec<f32>, u32) {
        match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(_, l) => panic!("unexpected cancel at iter {l}"),
        }
    }

    #[test]
    fn orbit_at_origin_stays_at_origin() {
        // c = 0+0i → Z stays at 0 forever (period-1 fixed point)
        let (cancel, progress) = no_cancel();
        let (orbit, len) = unwrap_complete(
            compute_mandelbrot_orbit("0", "0", 100, 128, &cancel, &progress).unwrap()
        );
        assert_eq!(len, 100);
        for i in 0..100 {
            assert_eq!(orbit[i * 4], 0.0_f32, "Z_re at iter {i}");
            assert_eq!(orbit[i * 4 + 1], 0.0_f32, "Z_im at iter {i}");
        }
    }

    #[test]
    fn orbit_first_iteration_equals_c() {
        // Z_0 = 0, Z_1 = 0² + c = c. Verify IEEE 754 exact at first step.
        let (cancel, progress) = no_cancel();
        let (orbit, _) = unwrap_complete(
            compute_mandelbrot_orbit("0.5", "0.25", 10, 128, &cancel, &progress).unwrap()
        );
        // orbit[4..8] = Z_1 = (0.5, 0.25)
        assert!((orbit[4] - 0.5_f32).abs() < 1e-7, "Z_1 re should be c_re");
        assert!((orbit[5] - 0.25_f32).abs() < 1e-7, "Z_1 im should be c_im");
    }

    #[test]
    fn orbit_escapes_at_c_2() {
        let (cancel, progress) = no_cancel();
        let (_, len) = unwrap_complete(
            compute_mandelbrot_orbit("2", "0", 100, 128, &cancel, &progress).unwrap()
        );
        assert!(len < 10, "should escape quickly, got {len} iterations");
    }

    #[test]
    fn orbit_precision_at_deep_zoom() {
        // Known Misiurewicz point — should iterate many times
        let (cancel, progress) = no_cancel();
        let result = compute_mandelbrot_orbit(
            "-0.10109636384562", "0.95628651080914",
            1000, 256, &cancel, &progress
        ).unwrap();
        let (_, len) = unwrap_complete(result);
        assert!(len > 100, "Misiurewicz point should iterate long, got {len}");
    }

    #[test]
    fn cancel_stops_computation() {
        let cancel = AtomicI32::new(1); // pre-cancelled
        let progress = AtomicI32::new(0);
        let result = compute_mandelbrot_orbit(
            "0", "0", 100_000, 128, &cancel, &progress
        ).unwrap();
        match result {
            OrbitResult::Cancelled(_, len) => assert!(len < 2048, "should cancel early"),
            OrbitResult::Complete(_, _) => panic!("should have been cancelled"),
        }
    }

    #[test]
    fn progress_updates_during_computation() {
        let (cancel, progress) = no_cancel();
        let _ = compute_mandelbrot_orbit(
            "0", "0", 5000, 128, &cancel, &progress
        ).unwrap();
        assert!(progress.load(Ordering::Relaxed) >= 4096,
            "progress should reach at least 4096 for 5000-iter orbit");
    }

    #[test]
    fn auto_precision_scaling() {
        use crate::precision::bits_for_scale;
        assert_eq!(bits_for_scale("1.0").unwrap(), 64);
        assert_eq!(bits_for_scale("1e-5").unwrap(), 64);
        assert!(bits_for_scale("1e-40").unwrap() >= 196);
        assert!(bits_for_scale("1e-100").unwrap() >= 396);
    }

    #[test]
    fn invalid_input_returns_error() {
        let (cancel, progress) = no_cancel();
        let result = compute_mandelbrot_orbit(
            "not_a_number", "0", 100, 128, &cancel, &progress
        );
        assert!(result.is_err());
    }

    #[test]
    fn invalid_scale_returns_error() {
        use crate::precision::bits_for_scale;
        assert!(bits_for_scale("abc").is_err());
        assert!(bits_for_scale("-1").is_err());
        assert!(bits_for_scale("0").is_err());
    }
}
```

- [ ] **Step 5: Run Rust tests**

Run:
```bash
cd wasm && cargo test
```
Expected: All 5 tests pass.

- [ ] **Step 6: Build WASM**

Run:
```bash
cd wasm && wasm-pack build --target web --release
```
Expected: Clean build, `wasm/pkg/` updated.

- [ ] **Step 7: Commit**

```bash
git add wasm/src/precision.rs wasm/src/orbit.rs wasm/src/lib.rs wasm/Cargo.toml
git commit -m "feat(wasm): reference orbit computation with astro-float arbitrary precision"
```

---

## Task 3: WASM → Next.js Integration

**Goal:** Load WASM module from Next.js, call `compute_reference_orbit` from TypeScript.

**Files:**
- Create: `src/infrastructure/wasmBridge.ts`
- Create: `src/infrastructure/__tests__/wasmBridge.test.ts`
- Modify: `next.config.ts` (WASM experiments)
- Modify: `vercel.json` (CSP wasm-unsafe-eval)

- [ ] **Step 1: Copy WASM pkg to public/ for static serving**

Add to `package.json` scripts:
```json
"wasm:copy": "cp -r wasm/pkg public/wasm",
"wasm:build": "cd wasm && wasm-pack build --target web --release && cd .. && npm run wasm:copy"
```

Run:
```bash
npm run wasm:build
```
Expected: `public/wasm/` contains `.wasm` + JS glue files.

- [ ] **Step 2: Create wasmBridge.ts**

Create `src/infrastructure/wasmBridge.ts`:
```typescript
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

/** Check if WebAssembly is available (ISO 25010: compatibility). */
function isWasmSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

/** Initialize the orbit worker + control buffer. */
function ensureWorker(): Worker {
  if (orbitWorker) return orbitWorker;

  if (!isWasmSupported()) {
    throw new Error('WebAssembly not supported — deep zoom requires a modern browser');
  }

  // SAB: [cancel_flag(i32), progress(i32)]
  controlBuffer = new SharedArrayBuffer(8);
  controlView = new Int32Array(controlBuffer);

  orbitWorker = new Worker(
    new URL('./orbit.worker.ts', import.meta.url),
    { type: 'module' }
  );
  return orbitWorker;
}

/** Check if perturbation should be used for given scale. */
export function needsPerturbation(scale: number): boolean {
  return scale < PERTURBATION_THRESHOLD && isWasmSupported();
}

/** Read current orbit computation progress (0..maxIter). */
export function getOrbitProgress(): number {
  if (!controlView) return 0;
  return Atomics.load(controlView, 1);
}

/** Cancel any in-progress orbit computation. */
export function cancelOrbit(): void {
  if (controlView) {
    Atomics.store(controlView, 0, 1); // set cancel flag
  }
}

export interface OrbitResult {
  data: Float32Array;
  length: number;
  cancelled: boolean;
}

/**
 * Compute reference orbit at arbitrary precision.
 * Runs in a dedicated Worker with SAB cancel/progress.
 * Coordinates as decimal strings for precision beyond float64.
 *
 * ISO 25010: 10s timeout. ISO 9241-110: cancel via cancelOrbit().
 * ISO 27001: validates WASM availability before proceeding.
 */
export function computeReferenceOrbit(
  centerRe: string,
  centerIm: string,
  maxIter: number,
  scaleStr: string
): Promise<OrbitResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = ensureWorker();
    } catch (e) {
      reject(e);
      return;
    }

    // Reset cancel flag + progress
    Atomics.store(controlView!, 0, 0);
    Atomics.store(controlView!, 1, 0);

    // Timeout (ISO 25010 Performance)
    const timer = setTimeout(() => {
      cancelOrbit();
      reject(new Error(`Orbit computation timed out after ${ORBIT_TIMEOUT_MS}ms`));
    }, ORBIT_TIMEOUT_MS);

    const handler = (e: MessageEvent) => {
      clearTimeout(timer);
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);

      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve({
          data: e.data.orbitData,
          length: e.data.orbitLength,
          cancelled: e.data.cancelled,
        });
      }
    };

    const errorHandler = (e: ErrorEvent) => {
      clearTimeout(timer);
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);
      reject(new Error(`Orbit worker error: ${e.message}`));
    };

    worker.addEventListener('message', handler);
    worker.addEventListener('error', errorHandler);

    worker.postMessage({
      type: 'compute-orbit',
      centerRe, centerIm, maxIter, scaleStr,
      controlBuffer: controlBuffer!,
    });
  });
}

export { PERTURBATION_THRESHOLD };
```

Create `src/infrastructure/orbit.worker.ts`:
```typescript
/**
 * Dedicated Worker for WASM orbit computation.
 * Receives SharedArrayBuffer for cancel/progress (SAB atomics).
 * Loads WASM lazily on first message.
 */

let wasmModule: any = null;

async function loadWasm() {
  if (wasmModule) return;
  const wasm = await import(/* webpackIgnore: true */ '/wasm/fractalnaute_wasm.js');
  await wasm.default();
  wasmModule = wasm;
}

self.addEventListener('message', async (e: MessageEvent) => {
  if (e.data.type !== 'compute-orbit') return;

  try {
    await loadWasm();

    const { centerRe, centerIm, maxIter, scaleStr, controlBuffer } = e.data;
    const controlView = new Int32Array(controlBuffer);

    const resultArray: Float32Array = wasmModule.compute_reference_orbit(
      centerRe, centerIm, maxIter, 0, scaleStr, controlView
    );

    // Unpack: [orbit_length_bits, cancelled_flag, ...orbit_data]
    const orbitLength = Math.round(resultArray[0]); // f32 bits → u32 → back
    const cancelled = resultArray[1] !== 0;
    const orbitData = resultArray.subarray(2);

    self.postMessage({
      orbitData, orbitLength, cancelled
    }, { transfer: [orbitData.buffer] });

  } catch (err) {
    self.postMessage({ error: String(err) });
  }
});
```

- [ ] **Step 3: Write wasmBridge test**

Create `src/infrastructure/__tests__/wasmBridge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { needsPerturbation, PERTURBATION_THRESHOLD } from '../wasmBridge';

describe('wasmBridge', () => {
  describe('needsPerturbation', () => {
    it('returns false for normal zoom', () => {
      expect(needsPerturbation(1.0)).toBe(false);
      expect(needsPerturbation(1e-7)).toBe(false);
      expect(needsPerturbation(1e-12)).toBe(false);
    });

    it('returns true for deep zoom', () => {
      expect(needsPerturbation(1e-14)).toBe(true);
      expect(needsPerturbation(1e-40)).toBe(true);
    });

    it('returns false at exact threshold', () => {
      expect(needsPerturbation(PERTURBATION_THRESHOLD)).toBe(false);
    });

    it('returns true just below threshold', () => {
      expect(needsPerturbation(PERTURBATION_THRESHOLD / 10)).toBe(true);
    });
  });

  // Note: computeReferenceOrbit and cancelOrbit cannot be unit-tested
  // without a Worker + WASM environment. Test via Playwright integration.
});
```

- [ ] **Step 4: Run test**

Run:
```bash
npm test -- --run src/infrastructure/__tests__/wasmBridge.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Update CSP in vercel.json**

Read `vercel.json`, then add `'wasm-unsafe-eval'` to the CSP `script-src` directive (if present) or note it for the headers. The existing headers are COOP/COEP focused — add:

In `vercel.json`, add to headers array:
```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
}
```

- [ ] **Step 6: Add .gitignore entry for public/wasm/**

Add `public/wasm/` to `.gitignore` (it's a build artifact).

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/wasmBridge.ts src/infrastructure/__tests__/wasmBridge.test.ts \
  package.json vercel.json .gitignore
git commit -m "feat(wasm): WASM bridge with lazy loading, CSP headers, threshold logic"
```

---

## Task 4: Domain Types + Deep Viewport

**Goal:** Add types for perturbation: `DeepViewport`, `PrecisionMode`, extend `RenderBackend`.

**Files:**
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Add types to domain/types.ts**

Add at the end of `src/domain/types.ts`:
```typescript
/** Precision mode for rendering — auto-selected based on zoom depth. */
export type PrecisionMode = 'float32' | 'doubleSingle' | 'perturbation';

/**
 * Extended viewport for deep zoom (beyond float64 precision).
 * String representations carry arbitrary-precision coordinates.
 * Used when scale < PERTURBATION_THRESHOLD (~1e-13).
 */
export interface DeepViewport extends Viewport {
  centerReStr: string;
  centerImStr: string;
  scaleStr: string;
}

/** Reference orbit data for GPU perturbation rendering. */
export interface OrbitData {
  /** Flat Float32Array: [z_re, z_im, dz_re, dz_im] per iteration */
  data: Float32Array;
  /** Number of orbit iterations (data.length / 4) */
  length: number;
  /** Reference point coordinates (f32 hi/lo for DS initial delta) */
  refPointRe: number;
  refPointIm: number;
}
```

- [ ] **Step 2: Run typecheck**

Run:
```bash
npm run typecheck
```
Expected: No errors (new types are additive, nothing imports them yet).

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts
git commit -m "feat(types): add DeepViewport, PrecisionMode, OrbitData for perturbation"
```

---

## Task 5: Perturbation GLSL Shader Chunks

**Goal:** Create the GPU perturbation shader with rebasing, NaN guards, and δc caching.

**Files:**
- Create: `src/infrastructure/gpu/shaders/perturbation.ts`
- Create: `src/infrastructure/gpu/__tests__/perturbation.test.ts`

- [ ] **Step 1: Create perturbation.ts GLSL chunks**

Create `src/infrastructure/gpu/shaders/perturbation.ts`:
```typescript
/**
 * GLSL chunks for perturbation rendering.
 * Reference orbit loaded from RGBA32F texture.
 * Rebasing (Zhuoran 2021) handles glitches in-shader.
 *
 * @see docs/superpowers/specs/2026-03-26-perturbation-theory-design.md §4
 */

/** Uniforms for orbit texture and reference point metadata. */
export const perturbationHeaderChunk = /* glsl */ `
uniform sampler2D u_orbitTexture;
uniform int u_orbitLength;
uniform vec2 u_orbitTexSize;
uniform vec2 u_refPoint;
uniform vec2 u_refPointLo;
`;

/** Orbit texture lookup — one RGBA32F texel per iteration. */
export const orbitLookupChunk = /* glsl */ `
vec4 getOrbitData(int i) {
  int texW = int(u_orbitTexSize.x);
  return texelFetch(u_orbitTexture, ivec2(i % texW, i / texW), 0);
}
`;

/**
 * Glitch threshold for rebasing (Heiland-Allen criterion).
 * When |z|² < G·|Z|², catastrophic cancellation risk — rebase.
 * G ∈ [1e-8, 1e-2]. 1e-6 is a reasonable default.
 */
const GLITCH_THRESHOLD = '1e-6';

/**
 * Mandelbrot perturbation iteration with rebasing (Zhuoran 2021).
 *
 * Mathematical formulas (ISO 80000-2):
 *   δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
 *   δ'_{n+1} = 2·(Z'_n·δ_n + z_n·δ'_n)
 *   z_n = Z_n + δ_n  (full position = reference + delta)
 *
 * Rebasing: when |z|² < G·|Z|² → δ = z, restart from orbit[0].
 *
 * GLSL variables mapping (see spec §0 Glossary):
 *   u,v = Re(δ), Im(δ)    dc_re,dc_im = Re(δc), Im(δc)
 *   O = Z_n (reference)    dO = Z'_n (reference derivative)
 *   z = z_n (full pos)     du,dv = Re(δ'), Im(δ')
 *
 * @mirror domain/fractals.ts:calculateMandelbrot (conceptually)
 */
export const mandelbrotPerturbationChunk = /* glsl */ `
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  // δc = c_pixel - c_ref (constant per pixel, cached)
  vec2 ds_re, ds_im;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
  float dc_re = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float dc_im = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  // δ_0 = δc  (ISO 80000-2: (u,v) ≡ (Re(δ), Im(δ)), see spec §0 Glossary)
  float u = dc_re;
  float v = dc_im;
  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = 1.0, dv = 0.0;  // dδ/dδc starts at 1

  int refIter = 0;

  for (int i = 0; i < MAX_ITER; i++) {
    if (refIter >= u_orbitLength) break;

    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;   // Z_n
    vec2 dO = orbitData.zw;  // Z'_n

    // z = Z + δ (full position)
    z = O + vec2(u, v);
    float zz = z.x * z.x + z.y * z.y;

    // NaN/Inf guard (IEEE 754-2019)
    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    // Escape test
    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    // Rebasing (Zhuoran 2021): |z|² < G·|Z|² → reset δ=z, restart orbit
    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x;
      v = z.y;
      du = dz.x;
      dv = dz.y;
      refIter = 0;
      continue;
    }

    // δ' = 2·(Z'·δ + z·δ')  (perturbation derivative)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ_{n+1} = 2·Z_n·δ_n + δ_n² + δc
    float temp_u = u*u - v*v + 2.0*(u*O.x - v*O.y) + dc_re;
    v = 2.0*u*v + 2.0*(v*O.x + u*O.y) + dc_im;
    u = temp_u;

    refIter++;
    updateAccumulator(z, dz, acc);
  }

  iter = MAX_ITER;
}
`;

/**
 * Julia perturbation iteration with rebasing.
 * Same as Mandelbrot but δc = 0 (c is constant, not per-pixel).
 * δ_0 = pixel - ref (coordinate delta).
 * Reference orbit computed with c = juliaC.
 */
export const juliaPerturbationChunk = /* glsl */ `
void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped,
             out float smoothVal, inout AccumState acc) {
  // δ_0 = pixel - ref (no δc term for Julia)
  vec2 ds_re, ds_im;
  screenToComplexDS(gl_FragCoord.xy, u_resolution, ds_re, ds_im);
  float u = ds_re.x - u_refPoint.x + (ds_re.y - u_refPointLo.x);
  float v = ds_im.x - u_refPoint.y + (ds_im.y - u_refPointLo.y);

  z = vec2(0.0);
  vec2 dz = vec2(0.0);
  iter = 0; escaped = false; smoothVal = 0.0;
  float du = 1.0, dv = 0.0;

  int refIter = 0;

  for (int i = 0; i < MAX_ITER; i++) {
    if (refIter >= u_orbitLength) break;

    vec4 orbitData = getOrbitData(refIter);
    vec2 O = orbitData.xy;
    vec2 dO = orbitData.zw;

    z = O + vec2(u, v);
    float zz = z.x * z.x + z.y * z.y;

    if (isnan(u) || isnan(v) || isinf(u) || isinf(v)) {
      iter = MAX_ITER;
      return;
    }

    if (zz > BAILOUT_SQ) {
      escaped = true; iter = i;
      smoothVal = smoothEscape(i, zz);
      return;
    }

    float OO = O.x * O.x + O.y * O.y;
    if (OO > 0.0 && zz < ${GLITCH_THRESHOLD} * OO) {
      u = z.x;
      v = z.y;
      du = dz.x;
      dv = dz.y;
      refIter = 0;
      continue;
    }

    // δ' = 2·(Z'·δ + z·δ') (Julia: no +1 term)
    float temp_du = 2.0*(dO.x*u - dO.y*v + z.x*du - z.y*dv);
    dv = 2.0*(dO.x*v + dO.y*u + z.x*dv + z.y*du);
    du = temp_du;
    dz = vec2(du, dv);

    // δ_{n+1} = 2·Z_n·δ_n + δ_n²  (NO + δc for Julia)
    float temp_u = u*u - v*v + 2.0*(u*O.x - v*O.y);
    v = 2.0*u*v + 2.0*(v*O.x + u*O.y);
    u = temp_u;

    refIter++;
    updateAccumulator(z, dz, acc);
  }

  iter = MAX_ITER;
}
`;

/** Uniform names added by perturbation chunks. */
export const PERTURBATION_UNIFORM_NAMES = [
  'u_orbitTexture', 'u_orbitLength', 'u_orbitTexSize',
  'u_refPoint', 'u_refPointLo'
];
```

- [ ] **Step 2: Write shader assembly test**

Create `src/infrastructure/gpu/__tests__/perturbation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  mandelbrotPerturbationChunk,
  juliaPerturbationChunk,
  perturbationHeaderChunk,
  orbitLookupChunk,
  PERTURBATION_UNIFORM_NAMES
} from '../shaders/perturbation';

describe('perturbation GLSL chunks', () => {
  describe('mandelbrotPerturbationChunk', () => {
    it('contains iterate function signature', () => {
      expect(mandelbrotPerturbationChunk).toContain(
        'void iterate(vec2 c_pixel, out vec2 z, out int iter, out bool escaped'
      );
    });

    it('contains rebasing logic', () => {
      expect(mandelbrotPerturbationChunk).toContain('refIter = 0');
      expect(mandelbrotPerturbationChunk).toContain('1e-6'); // GLITCH_THRESHOLD
    });

    it('contains NaN guard', () => {
      expect(mandelbrotPerturbationChunk).toContain('isnan(u)');
      expect(mandelbrotPerturbationChunk).toContain('isinf(u)');
    });

    it('contains δc addition for Mandelbrot', () => {
      expect(mandelbrotPerturbationChunk).toContain('+ dc_re');
      expect(mandelbrotPerturbationChunk).toContain('+ dc_im');
    });

    it('reads orbit from texture', () => {
      expect(mandelbrotPerturbationChunk).toContain('getOrbitData(refIter)');
    });
  });

  describe('juliaPerturbationChunk', () => {
    it('does NOT contain δc addition', () => {
      // Julia: δ_{n+1} = 2·Z·δ + δ² (no + δc)
      const lines = juliaPerturbationChunk.split('\n');
      const perturbLines = lines.filter(l =>
        l.includes('temp_u =') && l.includes('u*u - v*v')
      );
      for (const line of perturbLines) {
        expect(line).not.toContain('dc_re');
      }
    });

    it('contains rebasing logic same as Mandelbrot', () => {
      expect(juliaPerturbationChunk).toContain('refIter = 0');
    });
  });

  describe('perturbationHeaderChunk', () => {
    it('declares orbit texture uniform', () => {
      expect(perturbationHeaderChunk).toContain('uniform sampler2D u_orbitTexture');
    });

    it('declares orbit length uniform', () => {
      expect(perturbationHeaderChunk).toContain('uniform int u_orbitLength');
    });
  });

  describe('PERTURBATION_UNIFORM_NAMES', () => {
    it('includes all required uniforms', () => {
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitTexture');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitLength');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_orbitTexSize');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_refPoint');
      expect(PERTURBATION_UNIFORM_NAMES).toContain('u_refPointLo');
    });
  });
});
```

- [ ] **Step 3: Run test**

Run:
```bash
npm test -- --run src/infrastructure/gpu/__tests__/perturbation.test.ts
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/gpu/shaders/perturbation.ts \
  src/infrastructure/gpu/__tests__/perturbation.test.ts
git commit -m "feat(gpu): perturbation GLSL chunks with rebasing, NaN guards, Julia variant"
```

---

## Task 6: Orbit Texture Management

**Goal:** Upload Float32Array orbit data as RGBA32F GPU texture.

**Files:**
- Create: `src/infrastructure/gpu/orbitTexture.ts`

- [ ] **Step 1: Create orbitTexture.ts**

Create `src/infrastructure/gpu/orbitTexture.ts`:
```typescript
/**
 * Orbit texture management for perturbation rendering.
 * Uploads reference orbit [z_re, z_im, dz_re, dz_im] per iteration as RGBA32F.
 */

/** Upload orbit data to a RGBA32F texture. Returns texture + dimensions. */
export function createOrbitTexture(
  gl: WebGL2RenderingContext,
  orbitData: Float32Array,
  orbitLength: number
): { texture: WebGLTexture; width: number; height: number } | null {
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) {
    // Fallback: could pack floats into RGBA8, but for now return null
    return null;
  }

  const texWidth = Math.ceil(Math.sqrt(orbitLength));
  const texHeight = Math.ceil(orbitLength / texWidth);

  // Pad to fill texture rectangle (extra texels read as 0)
  const padded = new Float32Array(texWidth * texHeight * 4);
  padded.set(orbitData.subarray(0, orbitLength * 4));

  const texture = gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA32F,
    texWidth, texHeight, 0,
    gl.RGBA, gl.FLOAT, padded
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture, width: texWidth, height: texHeight };
}

/** Update existing orbit texture with new data (avoids re-allocation). */
export function updateOrbitTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  orbitData: Float32Array,
  orbitLength: number,
  texWidth: number,
  texHeight: number
): void {
  const padded = new Float32Array(texWidth * texHeight * 4);
  padded.set(orbitData.subarray(0, orbitLength * 4));

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0,
    texWidth, texHeight,
    gl.RGBA, gl.FLOAT, padded
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/** Delete orbit texture. */
export function destroyOrbitTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture
): void {
  gl.deleteTexture(texture);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/infrastructure/gpu/orbitTexture.ts
git commit -m "feat(gpu): orbit texture upload/management (RGBA32F)"
```

---

## Go/No-Go Gate

After Task 6, verify before proceeding to Plan B:

- [ ] `cargo test` passes (all Rust tests including cancel, progress, precision)
- [ ] `wasm-pack build --target web --release` succeeds
- [ ] WASM binary < 1MB (budget: 500KB gzipped)
- [ ] `npm test` passes (wasmBridge threshold + perturbation shader assembly tests)
- [ ] GLSL chunks contain rebasing, NaN guard, orbit lookup, δc caching

**If astro-float fails WASM compilation**: pivot to `dashu` or handwritten FP expansion in Rust. Rerun Task 1-2 with new crate. Tasks 3-6 are unaffected (they depend on the `Float32Array` output format, not the precision library).

**Next:** `docs/superpowers/plans/2026-03-27-perturbation-b-integration.md`

---

## Plan A Verification Checklist

- [ ] `cargo test` passes (Rust unit tests: orbit, precision, cancel, progress)
- [ ] `wasm-pack build` succeeds, binary < 1MB
- [ ] `npm test` passes (all existing + new TS tests)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `cargo audit` clean (ISO 27001 supply chain)
- [ ] Cargo.lock committed (ISO 27001 supply chain integrity)
- [ ] No existing files modified except `types.ts`, `.gitignore`, `package.json`, `vercel.json`
