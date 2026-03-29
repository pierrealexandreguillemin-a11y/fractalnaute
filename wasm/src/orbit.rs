use std::ops::{Add, Mul, Sub};

use crate::control::ControlSignal;

/// Result of a reference orbit computation.
pub enum OrbitResult {
    /// Orbit completed normally (data, iteration count).
    Complete(Vec<f32>, u32),
    /// Orbit was cancelled via `cancel_flag` (partial data, iteration count).
    Cancelled(Vec<f32>, u32),
}

/// Numeric type used for orbit iteration.
///
/// Implementations: `DD` (double-double, ~10^-15 zoom), `QD` (~10^-30),
/// `ArbFloat` (arbitrary precision via dashu, 10^-60+).
///
/// All arithmetic operations take references (`&Self`) so that non-`Copy`
/// arbitrary-precision types (e.g. `dashu::DBig`) can implement the trait
/// without cloning on every operator.
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

const BAILOUT_SQ: f64 = 4.0;
const CANCEL_CHECK_INTERVAL: u32 = 1024;

/// Compute Mandelbrot reference orbit, generic over precision type.
/// ONE implementation for DD, QD, `ArbFloat` (DRY — ISO 5055).
///
/// Formulas:
/// - `Z_{n+1} = Z_n^2 + C`
/// - `Z'_{n+1} = 2 * Z_n * Z'_n + 1`
///
/// Critical: orbit starts at `Z_0 = 0`.
///
/// # Errors
///
/// Returns `Err` if the center coordinate strings cannot be parsed.
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
        // Real part: 2*(zr*dzr - zi*dzi) + 1
        // Imag part: 2*(zr*dzi + zi*dzr)
        let prod_rr = z_re.clone() * &dz_re;
        let prod_ii = z_im.clone() * &dz_im;
        let prod_ri = z_re.clone() * &dz_im;
        let prod_ir = z_im.clone() * &dz_re;
        dz_re = (two.clone() * &(prod_rr - &prod_ii)) + &one;
        dz_im = two.clone() * &(prod_ri + &prod_ir);

        // Iteration: Z_{n+1} = Z_n^2 + C
        let zr_sq = z_re.clone() * &z_re;
        let zi_sq = z_im.clone() * &z_im;
        let two_zr_zi = two.clone() * &(z_re.clone() * &z_im);
        z_re = (zr_sq - &zi_sq) + &center_re;
        z_im = two_zr_zi + &center_im;
    }

    #[allow(clippy::cast_possible_wrap)]
    progress.store(actual_length as i32);
    Ok(OrbitResult::Complete(orbit, actual_length))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicI32;

    use super::*;
    use crate::dd::DD;

    fn no_cancel() -> AtomicI32 { AtomicI32::new(0) }
    fn cancelled() -> AtomicI32 { AtomicI32::new(1) }
    fn progress_sink() -> AtomicI32 { AtomicI32::new(0) }

    /// Origin (0+0i) is in the Mandelbrot set — orbit should never escape.
    #[test]
    fn dd_orbit_origin_stays() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result =
            compute_orbit::<DD>("0", "0", 100, 106, &cancel, &prog).unwrap();
        let (data, length) = match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        assert_eq!(length, 100, "origin should run full 100 iterations");
        assert_eq!(data.len(), 400); // 100 * 4 floats
        // All orbit points at origin should be (0,0)
        assert!(data[0].abs() < 1e-7, "z_re at step 0 should be 0");
        assert!(data[1].abs() < 1e-7, "z_im at step 0 should be 0");
    }

    /// After 1 iteration at c=(0.5, 0.25): Z_1 should equal C.
    #[test]
    fn dd_orbit_z1_equals_c() {
        let cancel = no_cancel();
        let prog = progress_sink();
        // Z_0 = 0, so Z_1 = Z_0^2 + C = C
        let result =
            compute_orbit::<DD>("0.5", "0.25", 5, 106, &cancel, &prog).unwrap();
        let (data, _) = match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        // Index 0 = z_re at iter 0 (=0), index 4 = z_re at iter 1 (=c_re)
        assert!(
            (f64::from(data[4]) - 0.5).abs() < 1e-6,
            "z1_re should equal c_re=0.5, got {}",
            data[4]
        );
        assert!(
            (f64::from(data[5]) - 0.25).abs() < 1e-6,
            "z1_im should equal c_im=0.25, got {}",
            data[5]
        );
    }

    /// c=(2, 0) should escape almost immediately (|Z_1|=4 > bailout).
    #[test]
    fn dd_orbit_escapes_at_c2() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result =
            compute_orbit::<DD>("2", "0", 1000, 106, &cancel, &prog).unwrap();
        let (_, length) = match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        // Z_0=0, Z_1=0+2=2, Z_2=4+2=6 > bailout → should escape at iter 2
        assert!(length <= 3, "c=2 should escape quickly, got {length} iters");
    }

    /// Cancel flag stops computation and returns Cancelled variant.
    #[test]
    fn dd_orbit_cancel() {
        let cancel = cancelled(); // already set to 1
        let prog = progress_sink();
        let result =
            compute_orbit::<DD>("0", "0", 10_000, 106, &cancel, &prog).unwrap();
        match result {
            OrbitResult::Cancelled(_, length) => {
                assert_eq!(length, 0, "cancelled before first iteration");
            }
            OrbitResult::Complete(..) => panic!("should have been cancelled"),
        }
    }

    /// Progress counter is updated during computation.
    #[test]
    fn dd_orbit_progress() {
        use std::sync::atomic::Ordering;

        let cancel = no_cancel();
        let prog = AtomicI32::new(0);
        // Use enough iterations that at least one progress store fires
        let result =
            compute_orbit::<DD>("0", "0", 2048, 106, &cancel, &prog).unwrap();
        match result {
            OrbitResult::Complete(_, length) => {
                let stored = prog.load(Ordering::Relaxed);
                // Final store = actual_length cast to i32
                assert_eq!(
                    stored,
                    i32::try_from(length).unwrap(),
                    "progress should equal final length"
                );
            }
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        }
    }

    /// A point on the Mandelbrot boundary (-0.75, 0) should NOT escape early.
    #[test]
    fn dd_orbit_boundary_point() {
        let cancel = no_cancel();
        let prog = progress_sink();
        // c = -0.75 is on the real axis boundary — runs full iteration count
        let result =
            compute_orbit::<DD>("-0.75", "0", 200, 106, &cancel, &prog).unwrap();
        let (_, length) = match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        assert!(length > 100, "boundary point should run many iterations, got {length}");
    }

    /// Invalid coordinate string returns Err.
    #[test]
    fn dd_orbit_invalid_input() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result = compute_orbit::<DD>("not_a_number", "0", 100, 106, &cancel, &prog);
        assert!(result.is_err(), "invalid input should return Err");
    }
}
