# Precision Ladder — Design Spec

## Problem

Reference orbit computation uses `dashu-float DBig` (decimal arbitrary precision).
Measured: **~100-500K iter/s** in WASM. For 256 iterations, that's ~1s — 95% of total render time.

Root cause: decimal arithmetic with per-operation `trunc()` is fundamentally slow.
Binary float expansion (DD/QD) achieves 100-1000x better throughput on IEEE 754 hardware.

## Goal

Replace single-speed `DBig` with a **precision ladder** that auto-selects the fastest
arithmetic for the current zoom depth:

| Level | Type | Precision | Range | Target iter/s (WASM) |
|---|---|---|---|---|
| 0 | `f64` native | 53 bits / 15 digits | zoom < 10^-13 | ~1B (existing GPU path) |
| 1 | DD (2×f64) | 106 bits / 31 digits | 10^-13 → 10^-30 | ~50-100M |
| 2 | QD (4×f64) | 212 bits / 63 digits | 10^-30 → 10^-60 | ~10-20M |
| 3 | malachite `Float` | Arbitrary | 10^-60+ | ~2-5M |

All levels compiled to `wasm32-unknown-unknown`. No `unsafe` code (ISO 5055 / `forbid(unsafe_code)`).

## Architecture

### Current flow

```
JS (scale string) → WASM compute_reference_orbit() → DBig arithmetic → Float32Array
```

### Target flow

```
JS (scale string) → WASM compute_reference_orbit() → bits_for_scale() →
  precision ladder dispatch → generic orbit<T: OrbitFloat> → Float32Array
```

The WASM entry point (`compute_reference_orbit`) stays identical.
The JS bridge, GPU shader, orbit texture — all unchanged.
Only `wasm/src/` internals change.

### Design principles (ISO 5055 maintainability)

- **DRY**: The z^2+c iteration loop is written ONCE, generic over `OrbitFloat` trait.
  DD, QD, malachite are thin arithmetic layers — zero domain logic.
- **SRP**: Each module has exactly one responsibility:
  - `dd.rs` = DD arithmetic
  - `qd.rs` = QD arithmetic
  - `arb.rs` = malachite adapter
  - `orbit.rs` = single generic orbit loop
  - `precision.rs` = ladder dispatch (scale → type)
- **Thin layer**: DD/QD/arb modules only implement the `OrbitFloat` trait.
  No orbit logic, no cancel handling, no progress reporting.

### OrbitFloat trait (the DRY contract)

```rust
use std::ops::{Add, Sub, Mul};

/// Arithmetic type for orbit computation.
/// Implementors: DD, QD, malachite Float wrapper.
pub trait OrbitFloat:
    Clone
    + for<'a> Add<&'a Self, Output = Self>
    + for<'a> Sub<&'a Self, Output = Self>
    + for<'a> Mul<&'a Self, Output = Self>
{
    fn zero() -> Self;
    fn one() -> Self;
    fn two() -> Self;
    fn from_f64(v: f64) -> Self;
    fn to_f64(&self) -> f64;
    fn to_f32(&self) -> f32;

    /// Parse a decimal string at full precision.
    /// DD/QD: parse to f64 then promote (sufficient for their precision range).
    /// Malachite: parse at arbitrary precision.
    fn parse_decimal(s: &str) -> Result<Self, String>;
}
```

### Single orbit loop (DRY)

```rust
/// ONE implementation of z = z^2 + c with derivative tracking.
/// Generic over any OrbitFloat (DD, QD, malachite).
pub fn compute_orbit<T: OrbitFloat>(
    c_re_str: &str, c_im_str: &str,
    max_iter: u32,
    cancel: &dyn ControlSignal,
    progress: &dyn ControlSignal,
) -> Result<OrbitResult, String> {
    let center_re = T::parse_decimal(c_re_str)?;
    let center_im = T::parse_decimal(c_im_str)?;
    // ... identical z^2+c loop for all precision levels
}
```

### File structure

```
wasm/src/
  lib.rs         — WASM entry points (unchanged API)
  control.rs     — ControlSignal trait (unchanged)
  precision.rs   — bits_for_scale, ladder dispatch (scale → compute_orbit<DD|QD|Arb>)
  orbit.rs       — compute_orbit<T: OrbitFloat> — ONE generic orbit loop
  dd.rs          — DD struct + OrbitFloat impl (thin arithmetic layer)
  qd.rs          — QD struct + OrbitFloat impl (thin arithmetic layer, builds on DD)
  arb.rs         — malachite Float wrapper + OrbitFloat impl (thin adapter)
```

### Precision ladder dispatch (in precision.rs)

```rust
pub fn compute_mandelbrot_orbit(
    c_re_str: &str, c_im_str: &str,
    max_iter: u32, precision_bits: usize,
    cancel: &dyn ControlSignal, progress: &dyn ControlSignal,
) -> Result<OrbitResult, String> {
    if precision_bits <= 106 {
        orbit::compute_orbit::<DD>(c_re_str, c_im_str, max_iter, cancel, progress)
    } else if precision_bits <= 212 {
        orbit::compute_orbit::<QD>(c_re_str, c_im_str, max_iter, cancel, progress)
    } else {
        orbit::compute_orbit::<ArbFloat>(c_re_str, c_im_str, max_iter, cancel, progress)
    }
}
```

Thresholds from `bits_for_scale`:
- scale >= 1e-13 → 64 bits → f64 (GPU native, no WASM orbit needed)
- scale 1e-13..1e-30 → 65-106 bits → DD
- scale 1e-30..1e-60 → 107-212 bits → QD
- scale < 1e-60 → 213+ bits → malachite

## DD (Double-Double) — Level 1

### Mathematical basis (IEEE 754)

A DD number `(hi, lo)` represents the exact value `hi + lo` where:
- `hi` carries the leading ~53 bits
- `lo` carries the next ~53 bits (correction term)
- Invariant: `|lo| <= 0.5 * ulp(hi)`

Built on Error-Free Transformations (Dekker 1971, Knuth 1997):

**TwoSum** (6 FLOPs, exact): `a + b = s + e` where `s = fl(a+b)`, `e` captures rounding error
```rust
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let v = s - a;
    let e = (a - (s - v)) + (b - v);
    (s, e)
}
```

**TwoProd** (with FMA, exact): `a * b = p + e`
```rust
fn two_prod(a: f64, b: f64) -> (f64, f64) {
    let p = a * b;
    let e = a.mul_add(b, -p);  // FMA: exact error term
    (p, e)
}
```

### DD operations (cost per operation)

| Operation | FLOPs | Description |
|---|---|---|
| `add(&DD, &DD) -> DD` | ~20 | TwoSum + secondary correction |
| `mul(&DD, &DD) -> DD` | ~25-30 | TwoProd + cross terms |
| `sub(&DD, &DD) -> DD` | ~20 | TwoSum with negation |
| `DD::from_f64(x)` | 0 | `DD { hi: x, lo: 0.0 }` |
| `DD::to_f64()` | 0 | `self.hi` |
| `DD::to_f32()` | 1 | `self.hi as f32` |

### DD z^2+c iteration cost

One `z = z^2 + c` iteration with derivative:
- z iteration: 3 mul + 3 add = ~150 FLOPs
- Derivative: 4 mul + 3 add = ~180 FLOPs
- Total: ~330 FLOPs per iteration

At ~2 GFLOPS in WASM (conservative): **~6M iterations/second**.
256 iterations: **~0.04ms**. 10,000 iterations: **~1.7ms**.

## QD (Quad-Double) — Level 2

### Mathematical basis

A QD number `(x0, x1, x2, x3)` represents `x0 + x1 + x2 + x3` with decreasing magnitude.
~212 bits of precision. Built from DD operations.

### QD operations (cost)

| Operation | FLOPs | Description |
|---|---|---|
| `add(&QD, &QD) -> QD` | ~60-80 | Cascade of TwoSum |
| `mul(&QD, &QD) -> QD` | ~100-150 | Cross-products + renormalization |
| `sub(&QD, &QD) -> QD` | ~60-80 | Cascade of TwoSum with negation |
| `renormalize` | ~20 | Cascade sort for invariant |

### QD z^2+c iteration cost

~7 qd_mul + ~6 qd_add ≈ **1200 FLOPs per iteration**

At ~2 GFLOPS: **~1.7M iterations/second**.
256 iterations: **~0.15ms**. 10,000 iterations: **~6ms**.

## Malachite — Level 3

### Why malachite over dashu

| Benchmark | dashu | malachite | Ratio |
|---|---|---|---|
| e 100k digits | 0.019s | 0.012s | 1.6x |
| e 1M digits | 0.756s | 0.240s | 3.2x |
| fib 100M | 26.2s | 5.2s | 5.0x |

Malachite uses better algorithms (Karatsuba/Toom thresholds, FFT crossover),
is pure Rust, MIT licensed, and compiles to wasm32.

### ArbFloat adapter (thin layer)

```rust
/// Thin wrapper around malachite::Float implementing OrbitFloat.
pub struct ArbFloat {
    inner: malachite_float::Float,
    prec: u64,
}

impl OrbitFloat for ArbFloat {
    fn parse_decimal(s: &str) -> Result<Self, String> { /* malachite parse */ }
    fn to_f64(&self) -> f64 { /* malachite to_f64 */ }
    // ... Add/Sub/Mul delegate to malachite with self.prec rounding
}
```

## ISO Compliance

### ISO 5055 — Source code quality

- **Reliability**: `deny(clippy::unwrap_used)`. All parsing returns `Result`.
  `OrbitFloat::parse_decimal` propagates errors.
- **Security**: `forbid(unsafe_code)`. All arithmetic in safe Rust.
- **Performance**: `clippy::perf`. `@tradeoff` on ladder thresholds (106/212 bits).
  DD/QD: zero heap allocation, stack-only. Malachite: heap for large precision.
- **Maintainability**: `clippy::pedantic`. Single orbit loop (DRY). One trait (SRP).
  DD/QD/arb are thin layers with no domain logic.
  Code duplication: zero (measured: one `compute_orbit` function).
  Module cohesion: each module = one type + one trait impl.

### IEEE 754

DD/QD correctness depends on IEEE 754 guarantees:
- **Round-to-nearest-even** for `+`, `-`, `*` (Rust default, no override)
- **FMA**: `f64::mul_add` for TwoProd. WASM spec guarantees IEEE 754 f64 semantics.
  @tradeoff: Use `mul_add` (assumes FMA or correct software fallback).
- **No `-ffast-math`**: Rust does not enable fast-math by default. Critical for EFT correctness.

### ISO 9241-110

- Cancel/progress signals unchanged (ControlSignal trait, passed through generic orbit).
- Same CANCEL_CHECK_INTERVAL (1024 iterations).

## Testing Strategy

### Unit tests (cargo test)

Per arithmetic module:
- `dd.rs`: TwoSum, TwoProd, add, mul, sub, from_f64, to_f64 roundtrip,
  edge cases (zero, negative, small, large)
- `qd.rs`: same + renormalize, cross-validation against DD at overlapping precision
- `arb.rs`: parse_decimal roundtrip, basic arithmetic, to_f64 precision

Orbit (one test suite, parametrized across all three types):
- origin stays at origin (100 iter)
- z1 = c
- escape at c=2
- deep zoom correctness (DD@10^-20, QD@10^-50, malachite@10^-100)
- cancel stops computation
- progress updates

### Cross-validation

- DD orbit at 10^-20 must match QD orbit at 10^-20 (f32 output identical)
- QD orbit at 10^-50 must match malachite orbit at 10^-50
- All must match current DBig orbit at overlapping ranges (regression)

### WASM32 tests

- `wasm-pack build --target nodejs` + node smoke test at each precision level
- Verify orbit length = max_iter for interior points

### Benchmarks (Playwright)

- Reuse existing coordinates (10^-14, 10^-20, 10^-40)
- Add: 10^-50 (QD range), 10^-80 (malachite range)
- Compare with DBig baseline, record in performance-history.md

## Performance Targets

| Zoom | Current (DBig) | Target (ladder) | Speedup |
|---|---|---|---|
| 10^-14 | ~1000ms | <1ms (DD) | >1000x |
| 10^-20 | ~1000ms | <2ms (DD) | >500x |
| 10^-40 | ~1100ms | <10ms (QD) | >100x |
| 10^-80 | N/A | <50ms (malachite) | new capability |

## Implementation Plans

### Plan 1: DD + QD + OrbitFloat trait + precision ladder

1. Define `OrbitFloat` trait in orbit.rs
2. Implement `dd.rs` (DD struct, TwoSum, TwoProd, Add/Sub/Mul, OrbitFloat impl)
3. Implement `qd.rs` (QD struct built on DD, OrbitFloat impl)
4. Rewrite `orbit.rs` as single generic `compute_orbit<T: OrbitFloat>`
5. Rewrite `precision.rs` with ladder dispatch
6. Keep dashu as temporary `ArbFloat` adapter (>212 bits)
7. Tests: unit, cross-validation, WASM32
8. Benchmarks, update performance-history.md

### Plan 2: Replace dashu with malachite

1. Add `malachite-float` to Cargo.toml
2. Rewrite `arb.rs` adapter: dashu `DBig` → malachite `Float`
3. Remove dashu from dependencies
4. Tests + benchmarks at 10^-80, 10^-100
5. Update performance-history.md

## References

- Bailey, Hida, Li — "QD Library" (2001). DD/QD algorithms and analysis.
- Dekker — "A floating-point technique for extending the available precision" (1971).
- Knuth — "The Art of Computer Programming" vol.2 (1997). EFT foundations.
- Joldes, Muller — "Tight and rigorous error bounds for basic building blocks of DD" (2017).
- deep-mandelbrot (munrocket) — Jampary 4-component float expansion, browser reference.
- mandelbrot.page (davidbau) — DD/QD in JavaScript, progressive refinement.
- malachite — https://www.malachite.rs/ — pure Rust, MIT, wasm32 compatible.
- bigint-benchmark-rs — dashu vs malachite vs rug performance comparison.
