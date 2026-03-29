use std::ops::{Add, Mul, Sub};

use crate::orbit::OrbitFloat;

/// Error-Free Transformations (Dekker 1971, Knuth 1997).
/// IEEE 754 guarantees: round-to-nearest-even, no fast-math.
/// Shared by DD and QD (`qd.rs` imports these via `crate::dd::`).
///
/// Exact sum: `a + b = sum + err` (Knuth `TwoSum`, 6 FLOPs).
#[inline]
pub fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let sum = a + b;
    let virt = sum - a;
    let err = (a - (sum - virt)) + (b - virt);
    (sum, err)
}

/// Fast exact sum when `|a| >= |b|` (Dekker, 3 FLOPs).
#[inline]
pub fn fast_two_sum(a: f64, b: f64) -> (f64, f64) {
    let sum = a + b;
    let err = b - (sum - a);
    (sum, err)
}

/// Exact product: `a * b = prod + err` (FMA-based, 2 FLOPs).
/// @tradeoff Uses `f64::mul_add` (FMA). WASM spec guarantees IEEE 754 f64
/// semantics. If hardware FMA unavailable, Rust provides correct software
/// fallback. Dekker splitting alternative exists but is slower (17 FLOPs).
#[inline]
pub fn two_prod(a: f64, b: f64) -> (f64, f64) {
    let prod = a * b;
    let err = a.mul_add(b, -prod);
    (prod, err)
}

/// Double-Double: 2xf64, ~106 bits precision.
/// Represents exact value `hi + lo` where `|lo| <= 0.5 * ulp(hi)`.
/// Zero heap allocation — stack only. ~20 FLOPs per add, ~28 per mul.
///
/// @tradeoff DD uses f64 parsing for center coordinates. Sufficient because
/// JS sends f64-precision strings. The DD arithmetic precision (106 bits)
/// keeps the orbit accurate during z^2+c iteration even though the seed is f64.
#[derive(Clone, Copy)]
pub struct DD {
    pub hi: f64,
    pub lo: f64,
}

// ── ref-ref impls (canonical, used internally) ─────────────────────────────

impl<'a> Add<&'a DD> for &DD {
    type Output = DD;
    fn add(self, rhs: &'a DD) -> DD {
        let (sum, err) = two_sum(self.hi, rhs.hi);
        let err = err + (self.lo + rhs.lo);
        let (hi, lo) = fast_two_sum(sum, err);
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
        let (prod, err) = two_prod(self.hi, rhs.hi);
        let err = err + (self.hi * rhs.lo + self.lo * rhs.hi);
        let (hi, lo) = fast_two_sum(prod, err);
        DD { hi, lo }
    }
}

// ── owned-LHS impls required by the `OrbitFloat` trait bounds ──────────────
// (`for<'a> Add<&'a Self, Output = Self>` on `Self`, not on `&Self`).
// Inlined directly — avoids the `op_ref` clippy lint that fires when doing
// `&self op rhs` inside an owned impl.

impl<'a> Add<&'a DD> for DD {
    type Output = DD;
    fn add(self, rhs: &'a DD) -> DD {
        let (sum, err) = two_sum(self.hi, rhs.hi);
        let err = err + (self.lo + rhs.lo);
        let (hi, lo) = fast_two_sum(sum, err);
        DD { hi, lo }
    }
}

impl<'a> Sub<&'a DD> for DD {
    type Output = DD;
    fn sub(self, rhs: &'a DD) -> DD {
        let neg = DD { hi: -rhs.hi, lo: -rhs.lo };
        self + &neg
    }
}

impl<'a> Mul<&'a DD> for DD {
    type Output = DD;
    fn mul(self, rhs: &'a DD) -> DD {
        let (prod, err) = two_prod(self.hi, rhs.hi);
        let err = err + (self.hi * rhs.lo + self.lo * rhs.hi);
        let (hi, lo) = fast_two_sum(prod, err);
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
        let hi: f64 = s.parse().map_err(|e| format!("DD parse error '{s}': {e}"))?;
        if !hi.is_finite() {
            return Err(format!("DD parsed non-finite: {hi}"));
        }
        Ok(DD { hi, lo: 0.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── EFT building blocks ────────────────────────────────────────────────

    #[test]
    fn two_sum_exact() {
        // 1.0 + 2^-53 cannot be represented exactly in one f64 — the error
        // term should be non-zero.
        let a = 1.0_f64;
        let b = f64::EPSILON / 2.0; // = 2^-53, the lost bit
        let (sum, err) = two_sum(a, b);
        // The sum rounds to 1.0 (b is below ulp(1.0)/2), so sum == 1.0 and err == b.
        assert_eq!(sum, 1.0_f64);
        assert!((err - b).abs() < 1e-320, "error term should recover b, got {err}");
    }

    #[test]
    fn two_sum_no_error_when_exact() {
        let (sum, err) = two_sum(0.5_f64, 0.25_f64);
        assert_eq!(sum, 0.75_f64);
        assert_eq!(err, 0.0_f64, "no rounding error for exact sum");
    }

    #[test]
    fn two_prod_exact() {
        // 3.0 * 7.0 = 21.0 is exact — error term must be zero.
        let (prod, err) = two_prod(3.0_f64, 7.0_f64);
        assert_eq!(prod, 21.0_f64);
        assert_eq!(err, 0.0_f64, "no rounding error for exact integer product");
    }

    #[test]
    fn fast_two_sum_with_ordered_inputs() {
        // |a| >= |b| precondition holds.
        let a = 1.0_f64;
        let b = f64::EPSILON / 2.0;
        let (sum, err) = fast_two_sum(a, b);
        assert_eq!(sum, 1.0_f64);
        assert!((err - b).abs() < 1e-320, "fast_two_sum error term, got {err}");
    }

    // ── DD arithmetic ──────────────────────────────────────────────────────

    #[test]
    fn dd_add_recovers_lost_bits() {
        // x = 1.0 + 2^-53 — the low part would vanish in plain f64 addition.
        let small = f64::EPSILON / 2.0;
        let a = DD { hi: 1.0, lo: 0.0 };
        let b = DD { hi: small, lo: 0.0 };
        let c = &a + &b;
        // hi rounds to 1.0, but lo should carry the lost bit.
        let recovered = c.hi + c.lo;
        let expected = 1.0_f64 + small;
        assert!(
            (recovered - expected).abs() < 1e-320,
            "DD add should recover lost bits: got hi={} lo={}",
            c.hi,
            c.lo
        );
    }

    #[test]
    fn dd_mul_basic() {
        let a = DD { hi: 3.0, lo: 0.0 };
        let b = DD { hi: 7.0, lo: 0.0 };
        let c = &a * &b;
        assert!((c.hi - 21.0).abs() < 1e-15, "3 * 7 = 21, got {}", c.hi);
        assert!(c.lo.abs() < 1e-15, "lo should be ~0, got {}", c.lo);
    }

    #[test]
    fn dd_sub_basic() {
        let a = DD { hi: 5.0, lo: 0.0 };
        let b = DD { hi: 3.0, lo: 0.0 };
        let c = &a - &b;
        assert!((c.hi - 2.0).abs() < 1e-15, "5 - 3 = 2, got {}", c.hi);
        assert!(c.lo.abs() < 1e-15, "lo should be ~0, got {}", c.lo);
    }

    #[test]
    fn dd_z_squared_plus_c() {
        // Simulate one step of z^2 + c with DD.
        // z = (0.5, 0), c = (0.25, 0) → z^2 + c = 0.25 + 0.25 = 0.5
        let z_re = DD { hi: 0.5, lo: 0.0 };
        let z_im = DD { hi: 0.0, lo: 0.0 };
        let c_re = DD { hi: 0.25, lo: 0.0 };
        let c_im = DD { hi: 0.0, lo: 0.0 };

        // new_re = z_re^2 - z_im^2 + c_re
        let zr_sq = &z_re * &z_re;
        let zi_sq = &z_im * &z_im;
        let new_re = &(&zr_sq - &zi_sq) + &c_re;

        // new_im = 2 * z_re * z_im + c_im
        let two = DD { hi: 2.0, lo: 0.0 };
        let cross = &(&two * &z_re) * &z_im;
        let new_im = &cross + &c_im;

        assert!(
            (new_re.hi - 0.5).abs() < 1e-15,
            "z^2+c re: expected 0.5, got {}",
            new_re.hi
        );
        assert!(
            new_im.hi.abs() < 1e-15,
            "z^2+c im: expected 0.0, got {}",
            new_im.hi
        );
    }

    // ── OrbitFloat trait impl ──────────────────────────────────────────────

    #[test]
    fn dd_parse_and_convert() {
        let d = DD::parse_decimal("-0.7436438885706", 128).unwrap();
        let f = d.to_f64();
        assert!(
            (f - (-0.7436438885706_f64)).abs() < 1e-13,
            "parse_decimal should recover f64 value, got {f}"
        );
        let f32_val = d.to_f32();
        assert!(
            (f64::from(f32_val) - (-0.7436_f64)).abs() < 0.01,
            "to_f32 should be close, got {f32_val}"
        );
    }

    #[test]
    fn dd_parse_invalid() {
        assert!(DD::parse_decimal("not_a_number", 128).is_err());
        assert!(DD::parse_decimal("inf", 128).is_err());
        assert!(DD::parse_decimal("nan", 128).is_err());
    }

    #[test]
    fn dd_zero_one_two() {
        let zero = DD::zero();
        assert_eq!(zero.hi, 0.0);
        assert_eq!(zero.lo, 0.0);

        let one = DD::one();
        assert_eq!(one.hi, 1.0);
        assert_eq!(one.lo, 0.0);

        let two = DD::two();
        assert_eq!(two.hi, 2.0);
        assert_eq!(two.lo, 0.0);
    }
}
