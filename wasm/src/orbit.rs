use std::sync::atomic::{AtomicI32, Ordering};

use astro_float::{BigFloat, RoundingMode};

use crate::precision::{parse_decimal, to_f32, to_f64};

const RM: RoundingMode = RoundingMode::ToEven;
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
/// Cancel/progress via `SharedArrayBuffer` atomics:
/// - `cancel_flag`: 0 = continue, nonzero = abort
/// - progress: updated every `CANCEL_CHECK_INTERVAL` iterations
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
    cancel_flag: &AtomicI32,
    progress: &AtomicI32,
) -> Result<OrbitResult, String> {
    let prec = precision_bits;

    let center_re = parse_decimal(c_re_str, prec)?;
    let center_im = parse_decimal(c_im_str, prec)?;

    let zero = BigFloat::from_f64(0.0, prec);
    let one = BigFloat::from_f64(1.0, prec);
    let two = BigFloat::from_f64(2.0, prec);

    let mut z_re = zero.clone();
    let mut z_im = zero.clone();
    let mut dz_re = zero.clone();
    let mut dz_im = zero;

    let mut orbit = Vec::with_capacity((max_iter as usize) * 4);
    let mut actual_length: u32 = 0;

    for i in 0..max_iter {
        if i % CANCEL_CHECK_INTERVAL == 0 {
            if cancel_flag.load(Ordering::Relaxed) != 0 {
                return Ok(OrbitResult::Cancelled(orbit, actual_length));
            }
            #[allow(clippy::cast_possible_wrap)]
            progress.store(i as i32, Ordering::Relaxed);
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
        let prod_rr = z_re.mul(&dz_re, prec, RM);
        let prod_ii = z_im.mul(&dz_im, prec, RM);
        let prod_ri = z_re.mul(&dz_im, prec, RM);
        let prod_ir = z_im.mul(&dz_re, prec, RM);
        let new_dz_re = two
            .mul(&prod_rr.sub(&prod_ii, prec, RM), prec, RM)
            .add(&one, prec, RM);
        let new_dz_im = two.mul(&prod_ri.add(&prod_ir, prec, RM), prec, RM);
        dz_re = new_dz_re;
        dz_im = new_dz_im;

        // Iteration: Z_{n+1} = Z_n^2 + C
        let zr_sq = z_re.mul(&z_re, prec, RM);
        let zi_sq = z_im.mul(&z_im, prec, RM);
        let two_zr_zi = two.mul(&z_re.mul(&z_im, prec, RM), prec, RM);
        z_re = zr_sq
            .sub(&zi_sq, prec, RM)
            .add(&center_re, prec, RM);
        z_im = two_zr_zi.add(&center_im, prec, RM);
    }

    #[allow(clippy::cast_possible_wrap)]
    progress.store(actual_length as i32, Ordering::Relaxed);
    Ok(OrbitResult::Complete(orbit, actual_length))
}

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
        // After iter 0 (Z_0 = 0), iter 1 should be Z_1 = C
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
        let final_progress = progress.load(Ordering::Relaxed);
        assert!(
            final_progress >= 4096,
            "progress should reach at least 4096 for 5000-iter orbit, got {final_progress}"
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
}
