//! Nucleus finder — Newton's method for mini-Mandelbrot centers.
//!
//! Given an approximate center c₀ and a period p, refines the nucleus
//! (exact center of a mini-Mandelbrot) to arbitrary precision.
//!
//! Algorithm: c_{m+1} = c_m - F^p(0, c_m) / (∂/∂c)F^p(0, c_m)
//! where F^p(0,c) iterates z = z² + c for p steps starting at z=0.
//!
//! @see <https://mathr.co.uk/web/m-nucleus.html>
//! @see <https://en.wikibooks.org/wiki/Fractals/mandelbrot-numerics>

use crate::arb::ArbFloat;
use crate::orbit::OrbitFloat;

/// Find the nucleus of a mini-Mandelbrot at the given period.
///
/// Returns `(re_string, im_string)` with `precision_digits` of accuracy.
///
/// # Errors
///
/// Returns an error if coordinate parsing fails.
/// Convert decimal digits to binary precision bits (ceil(digits / log10(2)) + margin).
fn digits_to_bits(digits: usize) -> usize {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let bits = (digits as f64 / std::f64::consts::LOG10_2).ceil() as usize;
    bits + 32 // safety margin
}

pub fn find_nucleus(
    c0_re: &str,
    c0_im: &str,
    period: u32,
    precision_digits: usize,
    newton_iters: u32,
) -> Result<(String, String), String> {
    let bits = digits_to_bits(precision_digits);
    let mut c_re = ArbFloat::parse_decimal(c0_re, bits)
        .map_err(|e| format!("parse c0_re: {e}"))?;
    let mut c_im = ArbFloat::parse_decimal(c0_im, bits)
        .map_err(|e| format!("parse c0_im: {e}"))?;

    let zero = ArbFloat::parse_decimal("0", bits)
        .map_err(|e| format!("parse zero: {e}"))?;
    let one = ArbFloat::parse_decimal("1", bits)
        .map_err(|e| format!("parse one: {e}"))?;
    let two = ArbFloat::parse_decimal("2", bits)
        .map_err(|e| format!("parse two: {e}"))?;

    for _ in 0..newton_iters {
        // Iterate F^p(0, c) and compute dF^p/dc simultaneously
        let mut z_re = zero.clone();
        let mut z_im = zero.clone();
        let mut dc_re = zero.clone();
        let mut dc_im = zero.clone();

        for _ in 0..period {
            // dc = 2*z*dc + 1  (complex multiplication)
            let zr_dcr = &z_re * &dc_re;
            let zi_dci = &z_im * &dc_im;
            let zr_dci = &z_re * &dc_im;
            let zi_dcr = &z_im * &dc_re;
            let t1 = &two * &zr_dcr;
            let t2 = &two * &zi_dci;
            let t3 = &two * &zr_dci;
            let t4 = &two * &zi_dcr;
            dc_re = &(&t1 - &t2) + &one;
            dc_im = &t3 + &t4;

            // z = z² + c
            let zr2 = &z_re * &z_re;
            let zi2 = &z_im * &z_im;
            let zri = &z_re * &z_im;
            let tzri = &two * &zri;
            z_re = &(&zr2 - &zi2) + &c_re;
            z_im = &tzri + &c_im;
        }

        // c = c - z/dc  (complex division: (a+bi)/(c+di))
        let dc2 = &(&dc_re * &dc_re) + &(&dc_im * &dc_im);
        if dc2.to_f64().abs() < 1e-100 {
            break; // dc too small — convergence stalled
        }
        let nr = &(&z_re * &dc_re) + &(&z_im * &dc_im);
        let ni = &(&z_im * &dc_re) - &(&z_re * &dc_im);
        let sr = &nr / &dc2;
        let si = &ni / &dc2;
        c_re = &c_re - &sr;
        c_im = &c_im - &si;
    }

    Ok((c_re.to_string(), c_im.to_string()))
}

/// Estimate the dominant period at a location (f64 precision).
///
/// Iterates z = z² + c and returns the first iteration where |z| < epsilon.
/// Returns `None` if no period found within `max_period` iterations.
pub fn estimate_period(c_re: f64, c_im: f64, max_period: u32) -> Option<u32> {
    let mut z_re = 0.0_f64;
    let mut z_im = 0.0_f64;
    let epsilon = 1e-6;

    for i in 1..=max_period {
        let new_re = z_re * z_re - z_im * z_im + c_re;
        let new_im = 2.0 * z_re * z_im + c_im;
        z_re = new_re;
        z_im = new_im;

        if z_re * z_re + z_im * z_im < epsilon * epsilon {
            return Some(i);
        }

        // Bail if escaping
        if z_re * z_re + z_im * z_im > 1e20 {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_1_nucleus_at_origin() {
        let (re, im) = find_nucleus("0.0", "0.0", 1, 30, 20).unwrap();
        let re_f64: f64 = re.parse().unwrap();
        let im_f64: f64 = im.parse().unwrap();
        assert!(re_f64.abs() < 1e-20, "re={re_f64}");
        assert!(im_f64.abs() < 1e-20, "im={im_f64}");
    }

    #[test]
    fn period_2_nucleus_at_minus_one() {
        let (re, im) = find_nucleus("-1.0", "0.0", 2, 30, 20).unwrap();
        let re_f64: f64 = re.parse().unwrap();
        let im_f64: f64 = im.parse().unwrap();
        assert!((re_f64 - (-1.0)).abs() < 1e-20, "re={re_f64}");
        assert!(im_f64.abs() < 1e-20, "im={im_f64}");
    }

    #[test]
    fn period_3_nucleus_near_antenna() {
        let (re, im) = find_nucleus("-1.76", "0.0", 3, 30, 20).unwrap();
        let re_f64: f64 = re.parse().unwrap();
        let im_f64: f64 = im.parse().unwrap();
        assert!(
            (re_f64 - (-1.754_877_666_246_693)).abs() < 1e-12,
            "re={re_f64}"
        );
        assert!(im_f64.abs() < 1e-12, "im={im_f64}");
    }

    #[test]
    fn high_precision_50_digits() {
        let (re, _) = find_nucleus("-1.76", "0.0", 3, 50, 30).unwrap();
        assert!(re.len() > 30, "re len={} val={re}", re.len());
    }

    #[test]
    fn estimate_period_1() {
        assert_eq!(estimate_period(0.0, 0.0, 1000), Some(1));
    }

    #[test]
    fn estimate_period_2() {
        assert_eq!(estimate_period(-1.0, 0.0, 1000), Some(2));
    }

    #[test]
    fn estimate_period_3() {
        assert_eq!(estimate_period(-1.754_877_666, 0.0, 1000), Some(3));
    }

    #[test]
    fn estimate_period_outside_set() {
        assert_eq!(estimate_period(2.0, 0.0, 1000), None);
    }

    #[test]
    fn high_precision_returns_many_digits() {
        let (re, _) = find_nucleus("-1.76", "0.0", 3, 50, 30).unwrap();
        // 50-digit precision → string with 30+ significant digits
        assert!(re.len() > 30, "re len={} val={re}", re.len());
    }
}
