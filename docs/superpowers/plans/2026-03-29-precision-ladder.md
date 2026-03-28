# Precision Ladder — Implementation Plan 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dashu `DBig` (decimal, ~100-500K iter/s) with a precision ladder — DD (2xf64, ~50M iter/s), QD (4xf64, ~10M iter/s), dashu fallback (>10^-60) — using a single generic orbit loop.

**Architecture:** `OrbitFloat` trait defines the arithmetic contract. DD, QD, ArbFloat are thin implementations. One generic `compute_orbit<T: OrbitFloat>` loop (DRY). Precision ladder in `precision.rs` dispatches based on `bits_for_scale` (SRP).

**Tech Stack:** Rust, wasm-bindgen, IEEE 754 error-free transformations (TwoSum/TwoProd), dashu-float (temporary fallback). No `unsafe`. `forbid(unsafe_code)`.

**Spec:** `docs/superpowers/specs/2026-03-29-precision-ladder-design.md`

---

## File Map

```
wasm/src/
  lib.rs          — WASM entry point (unchanged API, update mod declarations)
  control.rs      — ControlSignal trait (UNCHANGED)
  orbit.rs        — REWRITE: OrbitFloat trait + generic compute_orbit<T>
  dd.rs           — NEW: Double-Double (2xf64) + OrbitFloat impl
  qd.rs           — NEW: Quad-Double (4xf64) + OrbitFloat impl
  arb.rs          — NEW: dashu DBig wrapper + OrbitFloat impl
  precision.rs    — REWRITE: ladder dispatch, keep bits_for_scale
```

---

## Task 1: OrbitFloat Trait + EFT Building Blocks

**Goal:** Define the trait contract and IEEE 754 error-free transformations shared by DD and QD.

**Files:**
- Create: `wasm/src/orbit.rs` (rewrite — trait + generic loop)
- Create: `wasm/src/dd.rs` (EFT functions only, no DD struct yet)

- [ ] **Step 1: Create `dd.rs` with EFT building blocks and tests**

```rust
// wasm/src/dd.rs

/// Error-Free Transformations (Dekker 1971, Knuth 1997).
/// IEEE 754 guarantees: round-to-nearest-even, no fast-math.
/// Shared by DD and QD (qd.rs imports these via `crate::dd::`).

/// Exact sum: `a + b = s + e` (Knuth TwoSum, 6 FLOPs).
#[inline]
pub fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let v = s - a;
    let e = (a - (s - v)) + (b - v);
    (s, e)
}

/// Fast exact sum when `|a| >= |b|` (Dekker, 3 FLOPs).
#[inline]
pub fn fast_two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let e = b - (s - a);
    (s, e)
}

/// Exact product: `a * b = p + e` (FMA-based, 2 FLOPs).
/// @tradeoff Uses `f64::mul_add` (FMA). WASM spec guarantees IEEE 754 f64
/// semantics. If hardware FMA unavailable, Rust provides correct software
/// fallback. Dekker splitting alternative exists but is slower (17 FLOPs).
#[inline]
pub fn two_prod(a: f64, b: f64) -> (f64, f64) {
    let p = a * b;
    let e = a.mul_add(b, -p);
    (p, e)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_sum_exact() {
        let (s, e) = two_sum(1.0, 1e-20);
        assert_eq!(s, 1.0); // 1e-20 lost in f64 addition
        assert!((e - 1e-20).abs() < 1e-35, "error term captures lost bits: {e}");
    }

    #[test]
    fn two_sum_no_error_when_exact() {
        let (s, e) = two_sum(1.0, 2.0);
        assert_eq!(s, 3.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn two_prod_exact() {
        let (p, e) = two_prod(1.0 + 1e-15, 1.0 + 1e-15);
        let exact = (1.0 + 1e-15) * (1.0 + 1e-15);
        assert_eq!(p, exact);
        // e captures the rounding error of the multiplication
        assert!(e.abs() < 1e-30, "error should be tiny: {e}");
    }

    #[test]
    fn fast_two_sum_with_ordered_inputs() {
        let (s, e) = fast_two_sum(1.0, 1e-20);
        assert_eq!(s, 1.0);
        assert!((e - 1e-20).abs() < 1e-35, "error: {e}");
    }
}
```

- [ ] **Step 2: Define `OrbitFloat` trait in `orbit.rs`**

```rust
// wasm/src/orbit.rs
use std::ops::{Add, Mul, Sub};

use crate::control::ControlSignal;

const BAILOUT_SQ: f64 = 4.0;
const CANCEL_CHECK_INTERVAL: u32 = 1024;

/// Result of a reference orbit computation.
pub enum OrbitResult {
    /// Orbit completed normally (data, iteration count).
    Complete(Vec<f32>, u32),
    /// Orbit was cancelled via `cancel_flag` (partial data, iteration count).
    Cancelled(Vec<f32>, u32),
}

/// Arithmetic contract for orbit computation (DRY: one orbit loop for all precisions).
///
/// Implementors: DD (2xf64, 106 bits), QD (4xf64, 212 bits), ArbFloat (dashu, arbitrary).
/// Each impl is a thin arithmetic layer — zero domain logic (SRP).
pub trait OrbitFloat:
    Clone
    + for<'a> Add<&'a Self, Output = Self>
    + for<'a> Sub<&'a Self, Output = Self>
    + for<'a> Mul<&'a Self, Output = Self>
{
    fn zero() -> Self;
    fn one() -> Self;
    fn two() -> Self;
    fn to_f64(&self) -> f64;
    #[allow(clippy::wrong_self_convention)]
    fn to_f32(&self) -> f32;
    /// Parse center coordinate. `precision_bits` used by ArbFloat, ignored by DD/QD.
    fn parse_decimal(s: &str, precision_bits: usize) -> Result<Self, String>;
}
```

- [ ] **Step 3: Run `cargo test` on wasm crate**

```bash
cd wasm && cargo test 2>&1
```

Expected: compilation errors (orbit.rs no longer has the old code). This is expected — we'll fix it in Task 5.

- [ ] **Step 4: Commit EFT + trait**

```bash
git add wasm/src/dd.rs wasm/src/orbit.rs
git commit -m "feat(wasm): EFT building blocks (TwoSum/TwoProd) + OrbitFloat trait"
```

---

## Task 2: DD Arithmetic + OrbitFloat Impl

**Goal:** Implement Double-Double (2xf64, ~106 bits) with OrbitFloat.

**Files:**
- Modify: `wasm/src/dd.rs`

- [ ] **Step 1: Add DD struct and arithmetic ops to `dd.rs`**

Append after the EFT functions and before `#[cfg(test)]`:

```rust
use std::ops::{Add, Mul, Sub};
use crate::orbit::OrbitFloat;

/// Double-Double: 2xf64, ~106 bits precision.
/// Represents exact value `hi + lo` where `|lo| <= 0.5 * ulp(hi)`.
/// Zero heap allocation — stack only. ~20 FLOPs per add, ~28 per mul.
///
/// @tradeoff DD uses f64 parsing for center coordinates. Sufficient because
/// JS sends f64-precision strings. The DD arithmetic precision (106 bits)
/// keeps the orbit accurate during z^2+c iteration even though the seed
/// is f64.
#[derive(Clone, Copy)]
pub struct DD {
    pub hi: f64,
    pub lo: f64,
}

impl<'a> Add<&'a DD> for &DD {
    type Output = DD;
    fn add(self, rhs: &'a DD) -> DD {
        let (s, e) = two_sum(self.hi, rhs.hi);
        let e = e + (self.lo + rhs.lo);
        let (hi, lo) = fast_two_sum(s, e);
        DD { hi, lo }
    }
}

impl<'a> Sub<&'a DD> for &DD {
    type Output = DD;
    fn sub(self, rhs: &'a DD) -> DD {
        let neg = DD { hi: -rhs.hi, lo: -rhs.lo };
        self + &neg
    }
}

impl<'a> Mul<&'a DD> for &DD {
    type Output = DD;
    fn mul(self, rhs: &'a DD) -> DD {
        let (p, e) = two_prod(self.hi, rhs.hi);
        let e = e + (self.hi * rhs.lo + self.lo * rhs.hi);
        let (hi, lo) = fast_two_sum(p, e);
        DD { hi, lo }
    }
}

impl OrbitFloat for DD {
    fn zero() -> Self { DD { hi: 0.0, lo: 0.0 } }
    fn one() -> Self { DD { hi: 1.0, lo: 0.0 } }
    fn two() -> Self { DD { hi: 2.0, lo: 0.0 } }

    fn to_f64(&self) -> f64 { self.hi }

    #[allow(clippy::cast_possible_truncation)]
    fn to_f32(&self) -> f32 {
        let f = self.hi as f32;
        if f.is_finite() { f } else { 0.0_f32 }
    }

    fn parse_decimal(s: &str, _precision_bits: usize) -> Result<Self, String> {
        let hi: f64 = s.parse()
            .map_err(|e| format!("DD parse error '{s}': {e}"))?;
        if !hi.is_finite() {
            return Err(format!("DD parsed non-finite: {hi}"));
        }
        Ok(DD { hi, lo: 0.0 })
    }
}
```

- [ ] **Step 2: Add DD arithmetic tests**

Replace the existing `#[cfg(test)]` block in `dd.rs` with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_sum_exact() {
        let (s, e) = two_sum(1.0, 1e-20);
        assert_eq!(s, 1.0);
        assert!((e - 1e-20).abs() < 1e-35, "error: {e}");
    }

    #[test]
    fn two_sum_no_error_when_exact() {
        let (s, e) = two_sum(1.0, 2.0);
        assert_eq!(s, 3.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn two_prod_exact() {
        let (p, e) = two_prod(1.0 + 1e-15, 1.0 + 1e-15);
        let exact = (1.0 + 1e-15) * (1.0 + 1e-15);
        assert_eq!(p, exact);
        assert!(e.abs() < 1e-30, "error: {e}");
    }

    #[test]
    fn dd_add_recovers_lost_bits() {
        let a = DD { hi: 1.0, lo: 0.0 };
        let b = DD { hi: 1e-20, lo: 0.0 };
        let c = &a + &b;
        // DD preserves both 1.0 and 1e-20 without loss
        assert_eq!(c.hi, 1.0);
        assert!((c.lo - 1e-20).abs() < 1e-35, "lo should capture 1e-20: {}", c.lo);
    }

    #[test]
    fn dd_mul_basic() {
        let a = DD { hi: 3.0, lo: 0.0 };
        let b = DD { hi: 7.0, lo: 0.0 };
        let c = &a * &b;
        assert!((c.hi - 21.0).abs() < f64::EPSILON, "3*7=21, got {}", c.hi);
        assert!(c.lo.abs() < f64::EPSILON, "exact mul, lo=0: {}", c.lo);
    }

    #[test]
    fn dd_sub_basic() {
        let a = DD { hi: 5.0, lo: 1e-20 };
        let b = DD { hi: 3.0, lo: 0.0 };
        let c = &a - &b;
        assert!((c.hi - 2.0).abs() < f64::EPSILON, "5-3=2: {}", c.hi);
    }

    #[test]
    fn dd_z_squared_plus_c() {
        // z = 0.5 + 0.25i, c = 0.5 + 0.25i
        // z^2 = (0.5^2 - 0.25^2) + 2*0.5*0.25*i = 0.1875 + 0.25i
        // z^2 + c = 0.6875 + 0.5i
        let zr = DD { hi: 0.5, lo: 0.0 };
        let zi = DD { hi: 0.25, lo: 0.0 };
        let cr = DD { hi: 0.5, lo: 0.0 };
        let ci = DD { hi: 0.25, lo: 0.0 };
        let two = DD::two();

        let zr_sq = &zr * &zr;
        let zi_sq = &zi * &zi;
        let two_zr_zi = &two * &(&zr * &zi);
        let new_re = &(&zr_sq - &zi_sq) + &cr;
        let new_im = &two_zr_zi + &ci;

        assert!((new_re.hi - 0.6875).abs() < 1e-14, "re: {}", new_re.hi);
        assert!((new_im.hi - 0.5).abs() < 1e-14, "im: {}", new_im.hi);
    }

    #[test]
    fn dd_parse_and_convert() {
        let v = DD::parse_decimal("-0.7436438885706", 106).expect("parse");
        assert!((v.to_f64() - (-0.7436438885706)).abs() < 1e-12);
        assert!((v.to_f32() - (-0.7436_f32)).abs() < 0.001);
    }

    #[test]
    fn dd_parse_invalid() {
        assert!(DD::parse_decimal("not_a_number", 106).is_err());
    }

    #[test]
    fn dd_zero_one_two() {
        assert_eq!(DD::zero().hi, 0.0);
        assert_eq!(DD::one().hi, 1.0);
        assert_eq!(DD::two().hi, 2.0);
    }
}
```

- [ ] **Step 3: Temporarily comment out old orbit.rs code so crate compiles**

The old `compute_mandelbrot_orbit` and its tests depend on dashu imports. Comment them out temporarily (below the new trait definition) so `cargo test` can run the DD tests.

- [ ] **Step 4: Add `mod dd;` to `lib.rs` and run tests**

```bash
cd wasm && cargo test dd:: 2>&1
```

Expected: all DD tests pass.

- [ ] **Step 5: Commit**

```bash
git add wasm/src/dd.rs wasm/src/orbit.rs wasm/src/lib.rs
git commit -m "feat(wasm): DD (Double-Double) arithmetic with OrbitFloat impl"
```

---

## Task 3: QD Arithmetic + OrbitFloat Impl

**Goal:** Implement Quad-Double (4xf64, ~212 bits). Built on DD's EFTs.

**Files:**
- Create: `wasm/src/qd.rs`
- Modify: `wasm/src/lib.rs` (add `mod qd;`)

- [ ] **Step 1: Create `qd.rs` with QD struct, renormalize, and arithmetic**

```rust
// wasm/src/qd.rs
//! Quad-Double (4xf64, ~212 bits precision).
//! Algorithms from Bailey, Hida, Li — "QD Library" (2001).

use std::ops::{Add, Mul, Sub};

use crate::dd::{fast_two_sum, two_prod, two_sum};
use crate::orbit::OrbitFloat;

/// Quad-Double: 4xf64, ~212 bits precision.
/// `x0 + x1 + x2 + x3` with decreasing magnitude.
/// Zero heap allocation — stack only.
#[derive(Clone, Copy)]
pub struct QD(pub f64, pub f64, pub f64, pub f64);

/// Renormalize 5 components into 4 (Bailey QD Library algorithm).
/// Two-pass cascade of `FastTwoSum` ensures decreasing magnitude invariant.
fn renormalize5(a0: f64, a1: f64, a2: f64, a3: f64, a4: f64) -> QD {
    // Pass 1: cascade from bottom to top
    let (s, t4) = fast_two_sum(a3, a4);
    let (s, t3) = fast_two_sum(a2, s);
    let (s, t2) = fast_two_sum(a1, s);
    let (s, t1) = fast_two_sum(a0, s);

    // Pass 2: cascade from top to bottom, collecting into result
    let mut r = [s, t1, t2, t3];
    let (s, e) = fast_two_sum(r[0], r[1]);
    r[0] = s;
    if e != 0.0 {
        r[1] = e;
        let (s2, e2) = fast_two_sum(r[2], r[3]);
        r[2] = s2;
        r[3] = e2 + t4;
    } else {
        let (s2, e2) = fast_two_sum(r[1], r[2]);
        r[1] = s2;
        if e2 != 0.0 {
            r[2] = e2;
            r[3] = r[3] + t4;
        } else {
            let (s3, e3) = fast_two_sum(r[2], r[3]);
            r[2] = s3;
            r[3] = e3 + t4;
        }
    }
    QD(r[0], r[1], r[2], r[3])
}

/// Three-sum: sort three values with error tracking.
fn three_sum(a: f64, b: f64, c: f64) -> (f64, f64, f64) {
    let (a, b) = two_sum(a, b);
    let (a, c) = two_sum(a, c);
    let (b, c) = two_sum(b, c);
    (a, b, c)
}

impl<'a> Add<&'a QD> for &QD {
    type Output = QD;
    #[allow(clippy::many_single_char_names)]
    fn add(self, rhs: &'a QD) -> QD {
        let (s0, e0) = two_sum(self.0, rhs.0);
        let (s1, e1) = two_sum(self.1, rhs.1);
        let (s2, e2) = two_sum(self.2, rhs.2);
        let s3 = self.3 + rhs.3;

        let (s1, e0) = two_sum(s1, e0);
        let (s2, e0, e1) = three_sum(s2, e0, e1);
        let s3 = s3 + e0 + e2;

        renormalize5(s0, s1, s2, s3, e1)
    }
}

impl<'a> Sub<&'a QD> for &QD {
    type Output = QD;
    fn sub(self, rhs: &'a QD) -> QD {
        let neg = QD(-rhs.0, -rhs.1, -rhs.2, -rhs.3);
        self + &neg
    }
}

impl<'a> Mul<&'a QD> for &QD {
    type Output = QD;
    #[allow(clippy::many_single_char_names)]
    fn mul(self, rhs: &'a QD) -> QD {
        let (p0, q0) = two_prod(self.0, rhs.0);
        let (p1, q1) = two_prod(self.0, rhs.1);
        let (p2, q2) = two_prod(self.1, rhs.0);

        let (p1, p2, q0) = three_sum(p1, p2, q0);

        let (t0, t1) = two_prod(self.0, rhs.2);
        let (t2, t3) = two_prod(self.1, rhs.1);
        let (t4, t5) = two_prod(self.2, rhs.0);

        let (p2, q3, q4) = three_sum(p2, t0, t2);
        let (p2, q5) = two_sum(p2, t4);

        let q6 = q1 + q2 + q3 + q4 + q5 + t1 + t3 + t5;
        let p3 = self.0 * rhs.3 + self.1 * rhs.2
               + self.2 * rhs.1 + self.3 * rhs.0 + q6;

        renormalize5(p0, p1, p2, p3, 0.0)
    }
}

impl OrbitFloat for QD {
    fn zero() -> Self { QD(0.0, 0.0, 0.0, 0.0) }
    fn one() -> Self { QD(1.0, 0.0, 0.0, 0.0) }
    fn two() -> Self { QD(2.0, 0.0, 0.0, 0.0) }

    fn to_f64(&self) -> f64 { self.0 }

    #[allow(clippy::cast_possible_truncation)]
    fn to_f32(&self) -> f32 {
        let f = self.0 as f32;
        if f.is_finite() { f } else { 0.0_f32 }
    }

    fn parse_decimal(s: &str, _precision_bits: usize) -> Result<Self, String> {
        let hi: f64 = s.parse()
            .map_err(|e| format!("QD parse error '{s}': {e}"))?;
        if !hi.is_finite() {
            return Err(format!("QD parsed non-finite: {hi}"));
        }
        Ok(QD(hi, 0.0, 0.0, 0.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qd_add_basic() {
        let a = QD(1.0, 0.0, 0.0, 0.0);
        let b = QD(2.0, 0.0, 0.0, 0.0);
        let c = &a + &b;
        assert!((c.0 - 3.0).abs() < f64::EPSILON, "1+2=3: {}", c.0);
    }

    #[test]
    fn qd_sub_basic() {
        let a = QD(5.0, 0.0, 0.0, 0.0);
        let b = QD(3.0, 0.0, 0.0, 0.0);
        let c = &a - &b;
        assert!((c.0 - 2.0).abs() < f64::EPSILON, "5-3=2: {}", c.0);
    }

    #[test]
    fn qd_mul_basic() {
        let a = QD(3.0, 0.0, 0.0, 0.0);
        let b = QD(7.0, 0.0, 0.0, 0.0);
        let c = &a * &b;
        assert!((c.0 - 21.0).abs() < f64::EPSILON, "3*7=21: {}", c.0);
    }

    #[test]
    fn qd_z_squared_plus_c() {
        let zr = QD(0.5, 0.0, 0.0, 0.0);
        let zi = QD(0.25, 0.0, 0.0, 0.0);
        let cr = QD(0.5, 0.0, 0.0, 0.0);
        let ci = QD(0.25, 0.0, 0.0, 0.0);
        let two = QD::two();

        let zr_sq = &zr * &zr;
        let zi_sq = &zi * &zi;
        let two_zr_zi = &two * &(&zr * &zi);
        let new_re = &(&zr_sq - &zi_sq) + &cr;
        let new_im = &two_zr_zi + &ci;

        assert!((new_re.0 - 0.6875).abs() < 1e-14, "re: {}", new_re.0);
        assert!((new_im.0 - 0.5).abs() < 1e-14, "im: {}", new_im.0);
    }

    #[test]
    fn qd_parse_and_convert() {
        let v = QD::parse_decimal("-0.7436438885706", 212).expect("parse");
        assert!((v.to_f64() - (-0.7436438885706)).abs() < 1e-12);
    }

    #[test]
    fn qd_zero_one_two() {
        assert_eq!(QD::zero().0, 0.0);
        assert_eq!(QD::one().0, 1.0);
        assert_eq!(QD::two().0, 2.0);
    }
}
```

- [ ] **Step 2: Add `mod qd;` to `lib.rs` and run QD tests**

```bash
cd wasm && cargo test qd:: 2>&1
```

Expected: all QD tests pass.

- [ ] **Step 3: Commit**

```bash
git add wasm/src/qd.rs wasm/src/lib.rs
git commit -m "feat(wasm): QD (Quad-Double) arithmetic with OrbitFloat impl"
```

---

## Task 4: ArbFloat Adapter (dashu DBig Wrapper)

**Goal:** Wrap existing dashu `DBig` as `OrbitFloat` impl. Truncation happens inside ops (SRP).

**Files:**
- Create: `wasm/src/arb.rs`
- Modify: `wasm/src/lib.rs` (add `mod arb;`)

- [ ] **Step 1: Create `arb.rs`**

```rust
// wasm/src/arb.rs
//! Arbitrary precision adapter wrapping dashu DBig.
//! Truncation is internal to ops (SRP — orbit loop doesn't know about digit management).

use std::f64::consts::LOG10_2;
use std::ops::{Add, Mul, Sub};

use dashu_float::DBig;

use crate::orbit::OrbitFloat;

/// @tradeoff Truncate inside every op to bound DBig digit growth.
/// See precision.rs trunc() for rationale.
#[derive(Clone)]
pub struct ArbFloat {
    inner: DBig,
    digits: usize,
}

impl ArbFloat {
    fn truncated(inner: DBig, digits: usize) -> Self {
        let inner = inner.with_precision(digits).value();
        Self { inner, digits }
    }
}

impl<'a> Add<&'a ArbFloat> for &ArbFloat {
    type Output = ArbFloat;
    fn add(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner + &rhs.inner, self.digits)
    }
}

impl<'a> Sub<&'a ArbFloat> for &ArbFloat {
    type Output = ArbFloat;
    fn sub(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner - &rhs.inner, self.digits)
    }
}

impl<'a> Mul<&'a ArbFloat> for &ArbFloat {
    type Output = ArbFloat;
    fn mul(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner * &rhs.inner, self.digits)
    }
}

/// Convert precision bits to decimal digits: `ceil(bits * log10(2)) + 2`.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]
fn bits_to_digits(bits: usize) -> usize {
    ((bits as f64) * LOG10_2).ceil() as usize + 2
}

impl OrbitFloat for ArbFloat {
    fn zero() -> Self { Self { inner: DBig::from(0), digits: 10 } }
    fn one() -> Self { Self { inner: DBig::from(1), digits: 10 } }
    fn two() -> Self { Self { inner: DBig::from(2), digits: 10 } }

    fn to_f64(&self) -> f64 { self.inner.to_f64().value() }

    #[allow(clippy::cast_possible_truncation)]
    fn to_f32(&self) -> f32 {
        let f = self.inner.to_f64().value() as f32;
        if f.is_finite() { f } else { 0.0_f32 }
    }

    fn parse_decimal(s: &str, precision_bits: usize) -> Result<Self, String> {
        let digits = bits_to_digits(precision_bits);
        let inner: DBig = s.parse()
            .map_err(|e| format!("ArbFloat parse error '{s}': {e}"))?;
        Ok(Self::truncated(inner, digits))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arb_add() {
        let a = ArbFloat::parse_decimal("1.5", 128).expect("parse");
        let b = ArbFloat::parse_decimal("2.5", 128).expect("parse");
        let c = &a + &b;
        assert!((c.to_f64() - 4.0).abs() < 1e-10);
    }

    #[test]
    fn arb_mul() {
        let a = ArbFloat::parse_decimal("3.0", 128).expect("parse");
        let b = ArbFloat::parse_decimal("7.0", 128).expect("parse");
        let c = &a * &b;
        assert!((c.to_f64() - 21.0).abs() < 1e-10);
    }

    #[test]
    fn arb_sub() {
        let a = ArbFloat::parse_decimal("5.0", 128).expect("parse");
        let b = ArbFloat::parse_decimal("3.0", 128).expect("parse");
        let c = &a - &b;
        assert!((c.to_f64() - 2.0).abs() < 1e-10);
    }

    #[test]
    fn arb_deep_zoom_parse() {
        let s = "-0.7436438885706951598312068939351231241234";
        let v = ArbFloat::parse_decimal(s, 256).expect("parse");
        assert!((v.to_f64() - (-0.743643888570695)).abs() < 1e-14);
    }

    #[test]
    fn arb_parse_invalid() {
        assert!(ArbFloat::parse_decimal("not_a_number", 128).is_err());
    }
}
```

- [ ] **Step 2: Add `mod arb;` to `lib.rs` and run tests**

```bash
cd wasm && cargo test arb:: 2>&1
```

Expected: all ArbFloat tests pass.

- [ ] **Step 3: Commit**

```bash
git add wasm/src/arb.rs wasm/src/lib.rs
git commit -m "feat(wasm): ArbFloat adapter (dashu DBig wrapper, OrbitFloat impl)"
```

---

## Task 5: Generic Orbit Loop

**Goal:** Rewrite `orbit.rs` with a single generic `compute_orbit<T: OrbitFloat>`. Replace all dashu-specific code.

**Files:**
- Modify: `wasm/src/orbit.rs`

- [ ] **Step 1: Write the generic orbit loop**

Replace the entire `orbit.rs` content (keeping the trait from Task 1) with:

```rust
// wasm/src/orbit.rs
use std::ops::{Add, Mul, Sub};

use crate::control::ControlSignal;

const BAILOUT_SQ: f64 = 4.0;
const CANCEL_CHECK_INTERVAL: u32 = 1024;

/// Result of a reference orbit computation.
pub enum OrbitResult {
    Complete(Vec<f32>, u32),
    Cancelled(Vec<f32>, u32),
}

/// Arithmetic contract for orbit computation (DRY).
pub trait OrbitFloat:
    Clone
    + for<'a> Add<&'a Self, Output = Self>
    + for<'a> Sub<&'a Self, Output = Self>
    + for<'a> Mul<&'a Self, Output = Self>
{
    fn zero() -> Self;
    fn one() -> Self;
    fn two() -> Self;
    fn to_f64(&self) -> f64;
    #[allow(clippy::wrong_self_convention)]
    fn to_f32(&self) -> f32;
    fn parse_decimal(s: &str, precision_bits: usize) -> Result<Self, String>;
}

/// Compute Mandelbrot reference orbit, generic over precision type.
///
/// ONE implementation for DD, QD, ArbFloat (DRY — ISO 5055 maintainability).
///
/// Formulas:
/// - `Z_{n+1} = Z_n^2 + C`
/// - `Z'_{n+1} = 2 * Z_n * Z'_n + 1`
///
/// Critical: orbit starts at `Z_0 = 0`.
///
/// # Errors
///
/// Returns `Err` if coordinate strings cannot be parsed.
#[allow(clippy::similar_names)]
pub fn compute_orbit<T: OrbitFloat>(
    c_re_str: &str,
    c_im_str: &str,
    max_iter: u32,
    precision_bits: usize,
    cancel_flag: &dyn ControlSignal,
    progress: &dyn ControlSignal,
) -> Result<OrbitResult, String> {
    let center_re = T::parse_decimal(c_re_str, precision_bits)?;
    let center_im = T::parse_decimal(c_im_str, precision_bits)?;

    let one = T::one();
    let two = T::two();
    let mut z_re = T::zero();
    let mut z_im = T::zero();
    let mut dz_re = T::zero();
    let mut dz_im = T::zero();

    let capacity = (max_iter as usize)
        .checked_mul(4)
        .ok_or_else(|| format!("max_iter {max_iter} too large"))?;
    let mut orbit = Vec::with_capacity(capacity);
    let mut actual_length: u32 = 0;

    for i in 0..max_iter {
        if i % CANCEL_CHECK_INTERVAL == 0 {
            if cancel_flag.load() != 0 {
                return Ok(OrbitResult::Cancelled(orbit, actual_length));
            }
            #[allow(clippy::cast_possible_wrap)]
            progress.store(i as i32);
        }

        orbit.push(z_re.to_f32());
        orbit.push(z_im.to_f32());
        orbit.push(dz_re.to_f32());
        orbit.push(dz_im.to_f32());
        actual_length += 1;

        let zr_f64 = z_re.to_f64();
        let zi_f64 = z_im.to_f64();
        if zr_f64 * zr_f64 + zi_f64 * zi_f64 > BAILOUT_SQ {
            break;
        }

        // Derivative: Z'_{n+1} = 2 * Z_n * Z'_n + 1
        let prod_rr = &z_re * &dz_re;
        let prod_ii = &z_im * &dz_im;
        let prod_ri = &z_re * &dz_im;
        let prod_ir = &z_im * &dz_re;
        dz_re = &(&two * &(&prod_rr - &prod_ii)) + &one;
        dz_im = &two * &(&prod_ri + &prod_ir);

        // Iteration: Z_{n+1} = Z_n^2 + C
        let zr_sq = &z_re * &z_re;
        let zi_sq = &z_im * &z_im;
        let two_zr_zi = &two * &(&z_re * &z_im);
        z_re = &(&zr_sq - &zi_sq) + &center_re;
        z_im = &two_zr_zi + &center_im;
    }

    #[allow(clippy::cast_possible_wrap)]
    progress.store(actual_length as i32);
    Ok(OrbitResult::Complete(orbit, actual_length))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dd::DD;
    use std::sync::atomic::{AtomicI32, Ordering};

    fn no_cancel() -> (AtomicI32, AtomicI32) {
        (AtomicI32::new(0), AtomicI32::new(0))
    }

    fn unwrap_complete(result: OrbitResult) -> (Vec<f32>, u32) {
        match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(_, l) => panic!("unexpected cancel at {l}"),
        }
    }

    #[test]
    fn dd_orbit_origin_stays() {
        let (c, p) = no_cancel();
        let (orbit, len) = unwrap_complete(
            compute_orbit::<DD>("0", "0", 100, 106, &c, &p).expect("ok"),
        );
        assert_eq!(len, 100);
        for i in 0..100 {
            assert!(orbit[i * 4].abs() < f32::EPSILON, "z_re at {i}");
        }
    }

    #[test]
    fn dd_orbit_z1_equals_c() {
        let (c, p) = no_cancel();
        let (orbit, _) = unwrap_complete(
            compute_orbit::<DD>("0.5", "0.25", 10, 106, &c, &p).expect("ok"),
        );
        assert!((orbit[4] - 0.5_f32).abs() < 1e-5, "z1 re: {}", orbit[4]);
        assert!((orbit[5] - 0.25_f32).abs() < 1e-5, "z1 im: {}", orbit[5]);
    }

    #[test]
    fn dd_orbit_escapes_at_c2() {
        let (c, p) = no_cancel();
        let (_, len) = unwrap_complete(
            compute_orbit::<DD>("2", "0", 100, 106, &c, &p).expect("ok"),
        );
        assert!(len < 10, "should escape quickly: {len}");
    }

    #[test]
    fn dd_orbit_cancel() {
        let cancel = AtomicI32::new(1);
        let progress = AtomicI32::new(0);
        let result = compute_orbit::<DD>("0", "0", 100_000, 106, &cancel, &progress)
            .expect("ok");
        match result {
            OrbitResult::Cancelled(_, len) => assert!(len < 2048, "cancel: {len}"),
            OrbitResult::Complete(_, _) => panic!("should have been cancelled"),
        }
    }

    #[test]
    fn dd_orbit_progress() {
        let (c, p) = no_cancel();
        let _ = compute_orbit::<DD>("0", "0", 5000, 106, &c, &p).expect("ok");
        let final_p = AtomicI32::load(&p, Ordering::Relaxed);
        assert!(final_p >= 4096, "progress: {final_p}");
    }

    #[test]
    fn dd_orbit_boundary_point() {
        let (c, p) = no_cancel();
        let (orbit, len) = unwrap_complete(
            compute_orbit::<DD>("-0.7436438885706", "0.1318259043124", 256, 106, &c, &p)
                .expect("ok"),
        );
        assert!(len > 10, "boundary: {len}");
        assert!((orbit[4] - (-0.7436_f32)).abs() < 0.01, "z1_re: {}", orbit[4]);
    }

    #[test]
    fn dd_orbit_invalid_input() {
        let (c, p) = no_cancel();
        assert!(compute_orbit::<DD>("bad", "0", 10, 106, &c, &p).is_err());
    }
}
```

- [ ] **Step 2: Run orbit tests**

```bash
cd wasm && cargo test orbit:: 2>&1
```

Expected: all orbit tests pass with DD.

- [ ] **Step 3: Commit**

```bash
git add wasm/src/orbit.rs
git commit -m "feat(wasm): generic compute_orbit<T: OrbitFloat> — single DRY loop"
```

---

## Task 6: Precision Ladder Dispatch + Wiring

**Goal:** Rewrite `precision.rs` with ladder dispatch. Update `lib.rs` to wire everything.

**Files:**
- Modify: `wasm/src/precision.rs`
- Modify: `wasm/src/lib.rs`

- [ ] **Step 1: Rewrite `precision.rs`**

```rust
// wasm/src/precision.rs
//! Precision ladder: auto-select DD/QD/ArbFloat based on zoom depth.
//! @tradeoff Thresholds 106/212 bits correspond to DD/QD precision limits.

use crate::arb::ArbFloat;
use crate::control::ControlSignal;
use crate::dd::DD;
use crate::orbit::{self, OrbitResult};
use crate::qd::QD;

const PRECISION_MARGIN: usize = 64;
const DD_MAX_BITS: usize = 106;
const QD_MAX_BITS: usize = 212;

/// Compute required precision bits for a given zoom scale.
///
/// Formula: `bits = ceil(log2(1/scale)) + 64` margin.
///
/// # Errors
///
/// Returns `Err` if `scale_str` cannot be parsed as a positive finite f64.
pub fn bits_for_scale(scale_str: &str) -> Result<usize, String> {
    let scale: f64 = scale_str
        .parse()
        .map_err(|e| format!("invalid scale '{scale_str}': {e}"))?;
    if scale <= 0.0 || !scale.is_finite() {
        return Err(format!("scale must be positive finite, got {scale}"));
    }
    if scale >= 1e-13 {
        return Ok(64);
    }
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let bits = (-(scale.log2())).ceil() as usize;
    Ok(bits + PRECISION_MARGIN)
}

/// Dispatch to the fastest arithmetic for the given precision.
///
/// - bits <= 106: DD (2xf64, ~50M iter/s)
/// - bits <= 212: QD (4xf64, ~10M iter/s)
/// - bits > 212: ArbFloat/dashu (arbitrary, ~0.5M iter/s)
///
/// # Errors
///
/// Returns `Err` if coordinate parsing fails.
pub fn compute_mandelbrot_orbit(
    c_re_str: &str,
    c_im_str: &str,
    max_iter: u32,
    precision_bits: usize,
    cancel: &dyn ControlSignal,
    progress: &dyn ControlSignal,
) -> Result<OrbitResult, String> {
    if precision_bits <= DD_MAX_BITS {
        orbit::compute_orbit::<DD>(c_re_str, c_im_str, max_iter, precision_bits, cancel, progress)
    } else if precision_bits <= QD_MAX_BITS {
        orbit::compute_orbit::<QD>(c_re_str, c_im_str, max_iter, precision_bits, cancel, progress)
    } else {
        orbit::compute_orbit::<ArbFloat>(c_re_str, c_im_str, max_iter, precision_bits, cancel, progress)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_for_scale_large() {
        assert_eq!(bits_for_scale("1.0").expect("ok"), 64);
        assert_eq!(bits_for_scale("1e-5").expect("ok"), 64);
    }

    #[test]
    fn bits_for_scale_deep() {
        let b = bits_for_scale("1e-40").expect("ok");
        assert!(b >= 196, "1e-40: {b}");
    }

    #[test]
    fn bits_for_scale_invalid() {
        assert!(bits_for_scale("abc").is_err());
        assert!(bits_for_scale("-1").is_err());
        assert!(bits_for_scale("0").is_err());
    }

    #[test]
    fn ladder_selects_dd() {
        // 106 bits -> DD
        let (c, p) = (std::sync::atomic::AtomicI32::new(0), std::sync::atomic::AtomicI32::new(0));
        let result = compute_mandelbrot_orbit("0", "0", 10, 106, &c, &p);
        assert!(result.is_ok());
    }

    #[test]
    fn ladder_selects_qd() {
        let (c, p) = (std::sync::atomic::AtomicI32::new(0), std::sync::atomic::AtomicI32::new(0));
        let result = compute_mandelbrot_orbit("0", "0", 10, 200, &c, &p);
        assert!(result.is_ok());
    }

    #[test]
    fn ladder_selects_arb() {
        let (c, p) = (std::sync::atomic::AtomicI32::new(0), std::sync::atomic::AtomicI32::new(0));
        let result = compute_mandelbrot_orbit("0", "0", 10, 300, &c, &p);
        assert!(result.is_ok());
    }
}
```

- [ ] **Step 2: Update `lib.rs`**

```rust
#![deny(clippy::all, clippy::pedantic)]
#![deny(clippy::unwrap_used)]
#![deny(clippy::print_stdout, clippy::print_stderr)]
#![forbid(unsafe_code)]

mod arb;
mod control;
mod dd;
mod orbit;
mod precision;
mod qd;

use js_sys::{Float32Array, Int32Array};
use wasm_bindgen::prelude::*;

/// Compute Mandelbrot reference orbit at arbitrary precision.
///
/// Returns `Float32Array`:
///   `[orbit_length (as f32), cancelled_flag (0.0/1.0),`
///   `Z_re, Z_im, Z'_re, Z'_im, ...]`
///
/// **Cancel/progress** (ISO 9241-110: controllability):
/// `control_buf` is an `Int32Array` backed by `SharedArrayBuffer(8)`:
///   - offset 0: cancel flag
///   - offset 1: progress counter
///
/// # Errors
///
/// Returns `JsValue` error if coordinate parsing or precision scaling fails.
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

    let cancel_flag = control::SabControl::new(control_buf, 0);
    let progress = control::SabControl::new(control_buf, 1);

    let result = precision::compute_mandelbrot_orbit(
        center_re, center_im, max_iter, prec, &cancel_flag, &progress,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    let (data, length, cancelled) = match result {
        orbit::OrbitResult::Complete(d, l) => (d, l, false),
        orbit::OrbitResult::Cancelled(d, l) => (d, l, true),
    };

    let header_len = 2_u32;
    #[allow(clippy::cast_possible_truncation)]
    let data_len = data.len() as u32;
    let total_len = header_len + data_len;
    let arr = Float32Array::new_with_length(total_len);
    #[allow(clippy::cast_precision_loss)]
    let length_f32 = length as f32;
    arr.set_index(0, length_f32);
    arr.set_index(1, if cancelled { 1.0 } else { 0.0 });

    let orbit_arr = Float32Array::new_with_length(data_len);
    orbit_arr.copy_from(&data);
    arr.set(&orbit_arr, header_len);

    Ok(arr)
}

/// Smoke test: verify precision at given bits.
///
/// # Errors
///
/// Returns `JsValue` error if parsing fails.
#[wasm_bindgen]
pub fn verify_precision(bits: u32) -> Result<String, JsValue> {
    use crate::orbit::OrbitFloat;
    let v = arb::ArbFloat::parse_decimal(
        "3.14159265358979323846264338327950288419716939937510",
        bits as usize,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(format!("{}", v.to_f64()))
}
```

- [ ] **Step 3: Run all tests**

```bash
cd wasm && cargo test 2>&1
```

Expected: all tests pass (DD, QD, ArbFloat, orbit, precision).

- [ ] **Step 4: Run clippy**

```bash
cd wasm && cargo clippy -- -D warnings 2>&1
```

Expected: 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add wasm/src/precision.rs wasm/src/lib.rs
git commit -m "feat(wasm): precision ladder dispatch — DD/QD/ArbFloat auto-select"
```

---

## Task 7: Cross-Validation + Regression Tests

**Goal:** Verify DD and QD orbits match ArbFloat (dashu) at overlapping precision ranges.

**Files:**
- Modify: `wasm/src/orbit.rs` (add cross-validation tests)

- [ ] **Step 1: Add cross-validation tests to `orbit.rs`**

Append to the `#[cfg(test)] mod tests` block:

```rust
    use crate::arb::ArbFloat;
    use crate::qd::QD;

    #[test]
    fn dd_matches_arb_at_boundary() {
        let (c, p) = no_cancel();
        let (dd_orbit, dd_len) = unwrap_complete(
            compute_orbit::<DD>("-0.7436438885706", "0.1318259043124", 256, 106, &c, &p)
                .expect("dd"),
        );
        let (c2, p2) = no_cancel();
        let (arb_orbit, arb_len) = unwrap_complete(
            compute_orbit::<ArbFloat>("-0.7436438885706", "0.1318259043124", 256, 106, &c2, &p2)
                .expect("arb"),
        );
        assert_eq!(dd_len, arb_len, "orbit length mismatch");
        for i in 0..(dd_len as usize).min(50) {
            let dd_re = dd_orbit[i * 4];
            let arb_re = arb_orbit[i * 4];
            assert!(
                (dd_re - arb_re).abs() < 1e-5,
                "DD vs ArbFloat mismatch at iter {i}: dd={dd_re}, arb={arb_re}"
            );
        }
    }

    #[test]
    fn qd_matches_arb_at_deep_zoom() {
        let (c, p) = no_cancel();
        let (qd_orbit, qd_len) = unwrap_complete(
            compute_orbit::<QD>(
                "-0.74364388857069515983120689393512312412",
                "0.13182590431243590778813628973715582882",
                256, 200, &c, &p,
            ).expect("qd"),
        );
        let (c2, p2) = no_cancel();
        let (arb_orbit, arb_len) = unwrap_complete(
            compute_orbit::<ArbFloat>(
                "-0.74364388857069515983120689393512312412",
                "0.13182590431243590778813628973715582882",
                256, 200, &c2, &p2,
            ).expect("arb"),
        );
        assert_eq!(qd_len, arb_len, "orbit length mismatch");
        for i in 0..(qd_len as usize).min(50) {
            let qd_re = qd_orbit[i * 4];
            let arb_re = arb_orbit[i * 4];
            assert!(
                (qd_re - arb_re).abs() < 1e-4,
                "QD vs ArbFloat mismatch at iter {i}: qd={qd_re}, arb={arb_re}"
            );
        }
    }

    #[test]
    fn qd_orbit_deep_zoom_10_40() {
        let (c, p) = no_cancel();
        let prec = crate::precision::bits_for_scale("1e-40").expect("scale");
        assert!(prec >= 196);
        let (orbit, len) = unwrap_complete(
            compute_orbit::<QD>(
                "-0.74364388857069515983120689393512312412",
                "0.13182590431243590778813628973715582882",
                256, prec, &c, &p,
            ).expect("ok"),
        );
        assert!(len > 10, "deep zoom: {len}");
        assert!((orbit[4] - (-0.7436_f32)).abs() < 0.01, "z1_re: {}", orbit[4]);
    }
```

- [ ] **Step 2: Run all tests**

```bash
cd wasm && cargo test 2>&1
```

Expected: all tests pass including cross-validation.

- [ ] **Step 3: Commit**

```bash
git add wasm/src/orbit.rs
git commit -m "test(wasm): cross-validation DD vs QD vs ArbFloat orbits"
```

---

## Task 8: WASM32 Build + Smoke Tests

**Goal:** Verify everything works on wasm32-unknown-unknown target.

**Files:**
- No file changes — build + runtime verification

- [ ] **Step 1: Build WASM (nodejs target)**

```bash
cd wasm && RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals" wasm-pack build --target nodejs 2>&1
```

Expected: build succeeds.

- [ ] **Step 2: Node.js smoke test at all 3 precision levels**

```bash
cd wasm && node -e "
const w = require('./pkg/fractalnaute_wasm.js');
const sab = new SharedArrayBuffer(8);
const ctl = new Int32Array(sab);

// DD range (10^-14, bits=111 <= 106+margin? No, 111 > 106 -> QD)
// Actually bits_for_scale('1e-14') = 111 which is > 106, so QD
// Let's test at 1e-20 (bits ~130, QD) and 1e-40 (bits ~196, QD) and 1e-70 (bits ~296, ArbFloat)

// Test DD (force 100 bits)
ctl[0]=0; ctl[1]=0;
const dd = w.compute_reference_orbit('-0.75','0.1',256,100,'1e-13',ctl);
console.log('DD: len=' + dd[0]);

// Test QD (force 200 bits)
ctl[0]=0; ctl[1]=0;
const qd = w.compute_reference_orbit('-0.7436438885706','0.1318259043124',256,200,'1e-40',ctl);
console.log('QD: len=' + qd[0] + ' z1_re=' + qd[6]);

// Test ArbFloat (force 300 bits)
ctl[0]=0; ctl[1]=0;
const arb = w.compute_reference_orbit('-0.7436438885706','0.1318259043124',256,300,'1e-80',ctl);
console.log('ARB: len=' + arb[0] + ' z1_re=' + arb[6]);

const ok = dd[0]>=10 && qd[0]>=10 && arb[0]>=10 && Math.abs(qd[6]-(-0.7436))<0.01;
console.log(ok ? 'ALL WASM PASS' : 'FAIL');
if(!ok) process.exit(1);
" 2>&1
```

Expected: `ALL WASM PASS`.

- [ ] **Step 3: Build web target + copy to public/**

```bash
cd wasm && RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals" wasm-pack build --target web --out-dir ../public/wasm 2>&1
```

- [ ] **Step 4: Verify JS tests still pass**

```bash
npm run typecheck && npm test && npm run lint 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add public/wasm/
git commit -m "build(wasm): precision ladder WASM32 build — DD/QD/ArbFloat verified"
```

---

## Task 9: Playwright Benchmarks + Performance History

**Goal:** Measure speedup vs DBig baseline. Update `docs/performance-history.md`.

**Files:**
- Modify: `e2e/perturbation-benchmark.spec.ts` (add QD/ArbFloat zoom levels)
- Modify: `docs/performance-history.md`

- [ ] **Step 1: Run existing Playwright benchmarks (measures DD/QD)**

```bash
npm run dev &
npx playwright test e2e/perturbation-benchmark.spec.ts --reporter=line
```

Record the orbit/GPU/total times for comparison with DBig baseline.

- [ ] **Step 2: Update performance-history.md with new measurements**

Add a new subsection under the Perturbation Theory section:

```markdown
### + Precision Ladder (DD/QD/ArbFloat)

Replaced dashu DBig (decimal, ~100-500K iter/s) with:
- DD (2xf64, 106 bits): zoom 10^-13 to 10^-30
- QD (4xf64, 212 bits): zoom 10^-30 to 10^-60
- ArbFloat (dashu fallback): zoom 10^-60+

| Zoom | Before (DBig) | After (ladder) | Speedup | Level |
|---|---|---|---|---|
| 10^-14 | ~1000ms | Xms | Xx | DD/QD |
| 10^-20 | ~1050ms | Xms | Xx | QD |
| 10^-40 | ~1100ms | Xms | Xx | QD |
```

Fill in measured values from Playwright output.

- [ ] **Step 3: Commit**

```bash
git add docs/performance-history.md e2e/perturbation-benchmark.spec.ts
git commit -m "perf: precision ladder benchmarks — DD/QD vs DBig baseline"
```

---

## Cleanup: Remove Dead Code

After all tasks pass, remove unused dashu helpers from `precision.rs` that are no longer called:
- `bits_to_digits` (moved into `arb.rs`)
- `dbig_zero`, `dbig_one`, `dbig_two` (replaced by `OrbitFloat::zero/one/two`)
- `parse_decimal` (replaced by `OrbitFloat::parse_decimal`)
- `trunc`, `to_f64`, `to_f32` (internalized in `ArbFloat`)
- `verify_precision` from `lib.rs` (if still using dashu directly, update to use ArbFloat)

Commit: `refactor(wasm): remove dead dashu helpers after precision ladder migration`
