use std::f64::consts::LOG10_2;
use std::ops::{Add, Mul, Sub};

use dashu_float::DBig;

use crate::orbit::OrbitFloat;

/// Arbitrary-precision float backed by `dashu_float::DBig`.
///
/// @tradeoff Truncate inside every op to bound `DBig` digit growth.
/// Exact decimal arithmetic doubles digits per multiply — without truncation,
/// 256 iterations would produce 2^256 digits. Per-op truncation caps working
/// precision at `digits` (~bits/3.32 + 2) with `HalfEven` rounding (= IEEE 754
/// `ToEven`). Output is f32, so sub-7-digit differences are invisible.
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

// ── ref-ref impls (canonical, used internally) ─────────────────────────────

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

// ── owned-LHS impls required by the `OrbitFloat` trait bounds ──────────────
// (`for<'a> Add<&'a Self, Output = Self>` on `Self`, not on `&Self`).

impl<'a> Add<&'a ArbFloat> for ArbFloat {
    type Output = ArbFloat;
    fn add(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner + &rhs.inner, self.digits)
    }
}

impl<'a> Sub<&'a ArbFloat> for ArbFloat {
    type Output = ArbFloat;
    fn sub(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner - &rhs.inner, self.digits)
    }
}

impl<'a> Mul<&'a ArbFloat> for ArbFloat {
    type Output = ArbFloat;
    fn mul(self, rhs: &'a ArbFloat) -> ArbFloat {
        ArbFloat::truncated(&self.inner * &rhs.inner, self.digits)
    }
}

/// Convert precision in bits to decimal significant digits for `DBig`.
///
/// Formula: `digits = ceil(bits * log10(2)) + 2` margin.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
fn bits_to_digits(bits: usize) -> usize {
    ((bits as f64) * LOG10_2).ceil() as usize + 2
}

impl OrbitFloat for ArbFloat {
    fn zero() -> Self {
        Self {
            inner: DBig::from(0),
            digits: 10,
        }
    }

    fn one() -> Self {
        Self {
            inner: DBig::from(1),
            digits: 10,
        }
    }

    fn two() -> Self {
        Self {
            inner: DBig::from(2),
            digits: 10,
        }
    }

    fn to_f64(&self) -> f64 {
        // Format as decimal string then parse as f64.
        // Direct DBig::to_f64() has a debug_assert that fires when the
        // decimal significand has more than 53 binary bits (dashu bug on
        // small-exponent base-10→base-2 conversion path).
        // @tradeoff String round-trip is ~200ns but only called at f32 output
        // (once per iteration for orbit pushes); hot path is the arithmetic.
        // parse::<f64> is infallible for well-formed decimal output from DBig.
        // unwrap_or(0.0) handles the impossible case (ISO 5055 reliability:
        // no panic in WASM, deny(clippy::unwrap_used) prevents .unwrap()).
        format!("{}", self.inner)
            .parse::<f64>()
            .unwrap_or(0.0)
    }

    #[allow(clippy::cast_possible_truncation)]
    fn to_f32(&self) -> f32 {
        let f = self.to_f64() as f32;
        if f.is_finite() { f } else { 0.0_f32 }
    }

    fn parse_decimal(s: &str, precision_bits: usize) -> Result<Self, String> {
        let inner = s
            .parse::<DBig>()
            .map_err(|e| format!("ArbFloat parse error '{s}': {e}"))?;
        let digits = bits_to_digits(precision_bits);
        Ok(Self::truncated(inner, digits))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arb_add() {
        let a = ArbFloat::parse_decimal("1.5", 128).unwrap();
        let b = ArbFloat::parse_decimal("2.5", 128).unwrap();
        let c = &a + &b;
        assert!((c.to_f64() - 4.0).abs() < 1e-14, "1.5 + 2.5 = 4.0, got {}", c.to_f64());
    }

    #[test]
    fn arb_sub() {
        let a = ArbFloat::parse_decimal("5.0", 128).unwrap();
        let b = ArbFloat::parse_decimal("3.0", 128).unwrap();
        let c = &a - &b;
        assert!((c.to_f64() - 2.0).abs() < 1e-14, "5 - 3 = 2, got {}", c.to_f64());
    }

    #[test]
    fn arb_mul() {
        let a = ArbFloat::parse_decimal("3.0", 128).unwrap();
        let b = ArbFloat::parse_decimal("7.0", 128).unwrap();
        let c = &a * &b;
        assert!((c.to_f64() - 21.0).abs() < 1e-14, "3 * 7 = 21, got {}", c.to_f64());
    }

    #[test]
    fn arb_deep_zoom_parse() {
        // 40-digit coordinate should parse and preserve f64-visible precision
        let s = "-0.7436438885706951598312068939351231241234";
        let v = ArbFloat::parse_decimal(s, 256).unwrap();
        let f = v.to_f64();
        assert!(
            (f - (-0.743_643_888_570_695)).abs() < 1e-14,
            "f64 truncation should be close, got {f}"
        );
    }

    #[test]
    fn arb_parse_invalid() {
        let result = ArbFloat::parse_decimal("not_a_number", 128);
        assert!(result.is_err());
    }

    // ── Regression tests (lost from old precision.rs) ─────────────────────

    #[test]
    fn arb_to_f64_zero() {
        let v = ArbFloat::parse_decimal("0", 128).expect("parse");
        assert!(v.to_f64().abs() < f64::EPSILON);
    }

    #[test]
    fn arb_to_f64_negative() {
        let v = ArbFloat::parse_decimal("-2.5", 128).expect("parse");
        assert!((v.to_f64() - (-2.5)).abs() < 1e-14, "got {}", v.to_f64());
    }

    #[test]
    fn arb_to_f32_roundtrip() {
        let v = ArbFloat::parse_decimal("1.5", 128).expect("parse");
        let f = v.to_f32();
        assert!((f - 1.5_f32).abs() < 1e-5, "expected 1.5, got {f}");
    }

    #[test]
    fn arb_to_f64_roundtrip() {
        let v = ArbFloat::parse_decimal("3.14159265358979", 128).expect("parse");
        let f = v.to_f64();
        assert!((f - 3.14159265358979).abs() < 1e-14, "got {f}");
    }

    #[test]
    fn arb_zero_one_two() {
        assert!(ArbFloat::zero().to_f64().abs() < f64::EPSILON);
        assert!((ArbFloat::one().to_f64() - 1.0).abs() < f64::EPSILON);
        assert!((ArbFloat::two().to_f64() - 2.0).abs() < f64::EPSILON);
    }
}
