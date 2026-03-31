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

/// Two-pass cascade of `FastTwoSum` to ensure decreasing magnitude invariant.
/// Takes 5 components, produces 4.
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
    if e == 0.0 {
        let (s2, e2) = fast_two_sum(r[1], r[2]);
        r[1] = s2;
        if e2 == 0.0 {
            let (s3, e3) = fast_two_sum(r[2], r[3]);
            r[2] = s3;
            r[3] = e3 + t4;
        } else {
            r[2] = e2;
            r[3] += t4;
        }
    } else {
        r[1] = e;
        let (s2, e2) = fast_two_sum(r[2], r[3]);
        r[2] = s2;
        r[3] = e2 + t4;
    }
    QD(r[0], r[1], r[2], r[3])
}

fn three_sum(a: f64, b: f64, c: f64) -> (f64, f64, f64) {
    let (a, b) = two_sum(a, b);
    let (a, c) = two_sum(a, c);
    let (b, c) = two_sum(b, c);
    (a, b, c)
}

// ── ref-ref impls (canonical) ──────────────────────────────────────────────

impl<'a> Add<&'a QD> for &QD {
    type Output = QD;
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
    fn mul(self, rhs: &'a QD) -> QD {
        let (p0, q0) = two_prod(self.0, rhs.0);
        let (p1, q1) = two_prod(self.0, rhs.1);
        let (p2, q2) = two_prod(self.1, rhs.0);

        let (p1, p2, _q0) = three_sum(p1, p2, q0);

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

// ── owned-LHS impls required by the `OrbitFloat` trait bounds ─────────────
// (`for<'a> Add<&'a Self, Output = Self>` on `Self`, not on `&Self`).
// Bodies inlined to avoid the `clippy::op_ref` lint that fires when doing
// `&self op rhs` inside an owned impl.

impl<'a> Add<&'a QD> for QD {
    type Output = QD;
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

impl<'a> Sub<&'a QD> for QD {
    type Output = QD;
    fn sub(self, rhs: &'a QD) -> QD {
        let neg = QD(-rhs.0, -rhs.1, -rhs.2, -rhs.3);
        self + &neg
    }
}

impl<'a> Mul<&'a QD> for QD {
    type Output = QD;
    fn mul(self, rhs: &'a QD) -> QD {
        let (p0, q0) = two_prod(self.0, rhs.0);
        let (p1, q1) = two_prod(self.0, rhs.1);
        let (p2, q2) = two_prod(self.1, rhs.0);

        let (p1, p2, _q0) = three_sum(p1, p2, q0);

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
        use dashu_float::DBig;
        let exact: DBig = s.parse().map_err(|e| format!("QD parse error '{s}': {e}"))?;
        // Extract 4 f64 components: each captures bits lost by the previous
        let x0: f64 = format!("{exact}").parse().unwrap_or(0.0);
        if !x0.is_finite() { return Err(format!("QD parsed non-finite: {x0}")); }
        let r0: DBig = format!("{x0}").parse()
            .map_err(|e| format!("QD reparse x0 '{x0}' failed: {e}"))?;
        let rem1 = &exact - &r0;
        let x1: f64 = format!("{rem1}").parse().unwrap_or(0.0);
        let r1: DBig = format!("{x1}").parse()
            .map_err(|e| format!("QD reparse x1 '{x1}' failed: {e}"))?;
        let rem2 = &rem1 - &r1;
        let x2: f64 = format!("{rem2}").parse().unwrap_or(0.0);
        let r2: DBig = format!("{x2}").parse()
            .map_err(|e| format!("QD reparse x2 '{x2}' failed: {e}"))?;
        let x3: f64 = format!("{}", &rem2 - &r2).parse().unwrap_or(0.0);
        Ok(QD(x0, x1, x2, x3))
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
        assert!((c.0 - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn qd_sub_basic() {
        let a = QD(5.0, 0.0, 0.0, 0.0);
        let b = QD(3.0, 0.0, 0.0, 0.0);
        let c = &a - &b;
        assert!((c.0 - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn qd_mul_basic() {
        let a = QD(3.0, 0.0, 0.0, 0.0);
        let b = QD(7.0, 0.0, 0.0, 0.0);
        let c = &a * &b;
        assert!((c.0 - 21.0).abs() < f64::EPSILON);
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
    fn qd_parse_invalid() {
        assert!(QD::parse_decimal("not_a_number", 212).is_err());
        assert!(QD::parse_decimal("inf", 212).is_err());
        assert!(QD::parse_decimal("nan", 212).is_err());
    }

    #[test]
    fn qd_zero_one_two() {
        assert_eq!(QD::zero().0, 0.0);
        assert_eq!(QD::one().0, 1.0);
        assert_eq!(QD::two().0, 2.0);
    }

    #[test]
    fn qd_owned_ops_work() {
        let a = QD(2.0, 0.0, 0.0, 0.0);
        let b = QD(3.0, 0.0, 0.0, 0.0);
        let sum = a + &b;
        assert!((sum.0 - 5.0).abs() < f64::EPSILON);
        let prod = a * &b;
        assert!((prod.0 - 6.0).abs() < f64::EPSILON);
    }
}
