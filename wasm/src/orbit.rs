use crate::control::ControlSignal;
use crate::precision::{
    bits_to_digits, dbig_one, dbig_two, dbig_zero, parse_decimal, to_f32,
    to_f64, trunc,
};

const BAILOUT_SQ: f64 = 4.0;
const CANCEL_CHECK_INTERVAL: u32 = 1024;

/// Result of a reference orbit computation.
pub enum OrbitResult {
    /// Orbit completed normally (data, iteration count).
    Complete(Vec<f32>, u32),
    /// Orbit was cancelled via `cancel_flag` (partial data, iteration count).
    Cancelled(Vec<f32>, u32),
}

/// Compute Mandelbrot reference orbit at arbitrary precision.
///
/// Returns flat `[z_re, z_im, dz_re, dz_im, ...]` as f32 values.
///
/// Mathematical formulas (uppercase Z for reference orbit):
///
/// - `Z_{n+1} = Z_n^2 + C`
/// - `Z'_{n+1} = 2 * Z_n * Z'_n + 1`
///
/// Critical: orbit MUST start at `Z_0 = 0` (Series Approximation
/// depends on complete orbit from origin).
///
/// Cancel/progress via `ControlSignal` trait:
/// - `cancel_flag`: 0 = continue, nonzero = abort
/// - `progress`: updated every `CANCEL_CHECK_INTERVAL` iterations
///
/// # Errors
///
/// Returns `Err` if the center coordinate strings cannot be parsed.
#[allow(clippy::similar_names)]
pub fn compute_mandelbrot_orbit(
    c_re_str: &str,
    c_im_str: &str,
    max_iter: u32,
    precision_bits: usize,
    cancel_flag: &dyn ControlSignal,
    progress: &dyn ControlSignal,
) -> Result<OrbitResult, String> {
    let digits = bits_to_digits(precision_bits);

    let center_re = trunc(parse_decimal(c_re_str)?, digits);
    let center_im = trunc(parse_decimal(c_im_str)?, digits);

    let one = dbig_one();
    let two = dbig_two();

    let mut z_re = dbig_zero();
    let mut z_im = dbig_zero();
    let mut dz_re = dbig_zero();
    let mut dz_im = dbig_zero();

    let capacity = (max_iter as usize)
        .checked_mul(4)
        .ok_or_else(|| format!("max_iter {max_iter} too large for orbit allocation"))?;
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

        orbit.push(to_f32(&z_re));
        orbit.push(to_f32(&z_im));
        orbit.push(to_f32(&dz_re));
        orbit.push(to_f32(&dz_im));
        actual_length += 1;

        let zr_f64 = to_f64(&z_re);
        let zi_f64 = to_f64(&z_im);
        if zr_f64 * zr_f64 + zi_f64 * zi_f64 > BAILOUT_SQ {
            break;
        }

        // Derivative: Z'_{n+1} = 2 * Z_n * Z'_n + 1
        // Real part: 2*(zr*dzr - zi*dzi) + 1
        // Imag part: 2*(zr*dzi + zi*dzr)
        let prod_rr = trunc(&z_re * &dz_re, digits);
        let prod_ii = trunc(&z_im * &dz_im, digits);
        let prod_ri = trunc(&z_re * &dz_im, digits);
        let prod_ir = trunc(&z_im * &dz_re, digits);
        dz_re = trunc(&two * &trunc(&prod_rr - &prod_ii, digits) + &one, digits);
        dz_im = trunc(&two * &trunc(&prod_ri + &prod_ir, digits), digits);

        // Iteration: Z_{n+1} = Z_n^2 + C
        let zr_sq = trunc(&z_re * &z_re, digits);
        let zi_sq = trunc(&z_im * &z_im, digits);
        let two_zr_zi = trunc(&two * &trunc(&z_re * &z_im, digits), digits);
        z_re = trunc(&trunc(&zr_sq - &zi_sq, digits) + &center_re, digits);
        z_im = trunc(&two_zr_zi + &center_im, digits);
    }

    #[allow(clippy::cast_possible_wrap)]
    progress.store(actual_length as i32);
    Ok(OrbitResult::Complete(orbit, actual_length))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI32, Ordering};

    fn no_cancel() -> (AtomicI32, AtomicI32) {
        (AtomicI32::new(0), AtomicI32::new(0))
    }

    fn unwrap_complete(result: OrbitResult) -> (Vec<f32>, u32) {
        match result {
            OrbitResult::Complete(d, l) => (d, l),
            OrbitResult::Cancelled(_, l) => {
                panic!("unexpected cancel at iter {l}")
            }
        }
    }

    #[test]
    fn orbit_at_origin_stays_at_origin() {
        let (cancel, progress) = no_cancel();
        let (orbit, len) = unwrap_complete(
            compute_mandelbrot_orbit("0", "0", 100, 128, &cancel, &progress)
                .unwrap(),
        );
        assert_eq!(len, 100);
        for i in 0..100 {
            assert!(
                orbit[i * 4].abs() < f32::EPSILON,
                "z_re at iter {i}"
            );
            assert!(
                orbit[i * 4 + 1].abs() < f32::EPSILON,
                "z_im at iter {i}"
            );
        }
    }

    #[test]
    fn orbit_first_iteration_equals_c() {
        let (cancel, progress) = no_cancel();
        let (orbit, _) = unwrap_complete(
            compute_mandelbrot_orbit(
                "0.5", "0.25", 10, 128, &cancel, &progress,
            )
            .unwrap(),
        );
        assert!(
            (orbit[4] - 0.5_f32).abs() < 1e-5,
            "z_1 re should be c_re, got {}",
            orbit[4]
        );
        assert!(
            (orbit[5] - 0.25_f32).abs() < 1e-5,
            "z_1 im should be c_im, got {}",
            orbit[5]
        );
    }

    #[test]
    fn orbit_escapes_at_c_2() {
        let (cancel, progress) = no_cancel();
        let (_, len) = unwrap_complete(
            compute_mandelbrot_orbit("2", "0", 100, 128, &cancel, &progress)
                .unwrap(),
        );
        assert!(
            len < 10,
            "should escape quickly, got {len} iterations"
        );
    }

    #[test]
    fn orbit_precision_at_deep_zoom() {
        let (cancel, progress) = no_cancel();
        let result = compute_mandelbrot_orbit(
            "-0.10109636384562",
            "0.95628651080914",
            1000,
            256,
            &cancel,
            &progress,
        )
        .unwrap();
        let (_, len) = unwrap_complete(result);
        assert!(
            len > 100,
            "Misiurewicz point should iterate long, got {len}"
        );
    }

    #[test]
    fn cancel_stops_computation() {
        let cancel = AtomicI32::new(1);
        let progress = AtomicI32::new(0);
        let result = compute_mandelbrot_orbit(
            "0", "0", 100_000, 128, &cancel, &progress,
        )
        .unwrap();
        match result {
            OrbitResult::Cancelled(_, len) => {
                assert!(len < 2048, "should cancel early, got {len}");
            }
            OrbitResult::Complete(_, _) => {
                panic!("should have been cancelled");
            }
        }
    }

    #[test]
    fn progress_updates_during_computation() {
        let (cancel, progress) = no_cancel();
        let _ = compute_mandelbrot_orbit(
            "0", "0", 5000, 128, &cancel, &progress,
        )
        .unwrap();
        let final_progress = AtomicI32::load(&progress, Ordering::Relaxed);
        assert!(
            final_progress >= 4096,
            "progress should reach at least 4096 for 5000-iter orbit, got {final_progress}"
        );
    }

    #[test]
    fn orbit_at_mandelbrot_boundary_should_not_escape_early() {
        let (cancel, progress) = no_cancel();
        let prec = crate::precision::bits_for_scale("1e-14").unwrap();
        assert_eq!(prec, 111, "expected 111 bits for scale 1e-14");
        let result = compute_mandelbrot_orbit(
            "-0.7436438885706",
            "0.1318259043124",
            256,
            prec,
            &cancel,
            &progress,
        )
        .unwrap();
        let (orbit, len) = unwrap_complete(result);
        assert!(
            len > 10,
            "boundary point should not escape early, got len={len}"
        );
        let z1_re = orbit[4];
        let z1_im = orbit[5];
        assert!(
            (z1_re - (-0.7436_f32)).abs() < 0.01,
            "z1_re should be ~c_re, got {z1_re}"
        );
        assert!(
            (z1_im - 0.1318_f32).abs() < 0.01,
            "z1_im should be ~c_im, got {z1_im}"
        );
    }

    #[test]
    fn to_f64_of_parsed_decimal() {
        let val = crate::precision::parse_decimal("-0.7436438885706").unwrap();
        let f = crate::precision::to_f64(&val);
        assert!(
            (f - (-0.7436438885706_f64)).abs() < 1e-10,
            "to_f64 should return ~-0.7436, got {f}"
        );
    }

    #[test]
    fn invalid_input_returns_error() {
        let (cancel, progress) = no_cancel();
        let result = compute_mandelbrot_orbit(
            "not_a_number",
            "0",
            100,
            128,
            &cancel,
            &progress,
        );
        assert!(result.is_err());
    }

    #[test]
    fn orbit_correct_at_very_deep_zoom() {
        let (cancel, progress) = no_cancel();
        let prec = crate::precision::bits_for_scale("1e-40").unwrap();
        assert!(prec >= 196, "expected >=196 bits for 1e-40, got {prec}");
        let result = compute_mandelbrot_orbit(
            "-0.74364388857069515983120689393512312412",
            "0.13182590431243590778813628973715582882",
            256,
            prec,
            &cancel,
            &progress,
        )
        .unwrap();
        let (orbit, len) = unwrap_complete(result);
        assert!(
            len > 10,
            "deep zoom point should iterate, got len={len}"
        );
        let z1_re = orbit[4];
        assert!(
            (z1_re - (-0.7436_f32)).abs() < 0.01,
            "z1_re at deep zoom should be ~c_re, got {z1_re}"
        );
    }
}
