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
/// Formula: `bits = ceil(log2(1/scale)) + 64` margin (Precision auto-scaling).
///
/// # Errors
///
/// Returns `Err` if `scale_str` cannot be parsed as a positive finite f64.
pub fn bits_for_scale(scale_str: &str) -> Result<usize, String> {
    let scale: f64 = scale_str
        .parse()
        .map_err(|e| format!("invalid scale string '{scale_str}': {e}"))?;
    if scale <= 0.0 || !scale.is_finite() {
        return Err(format!("scale must be positive and finite, got {scale}"));
    }
    if scale >= 1e-13 {
        return Ok(64);
    }
    let log2_inv = -(scale.log2());
    // Safety: log2_inv is positive and finite here, ceil() returns a
    // non-negative value that fits in usize for any realistic zoom level.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let bits = log2_inv.ceil() as usize;
    Ok(bits + PRECISION_MARGIN)
}

/// Dispatch Mandelbrot reference orbit computation to the appropriate
/// precision type based on required bits.
///
/// Precision ladder:
/// - `precision_bits <= 106` → `DD` (double-double, stack-only, ~5× f64)
/// - `precision_bits <= 212` → `QD` (quad-double, stack-only, ~20× f64)
/// - `precision_bits > 212`  → `ArbFloat` (dashu `DBig`, heap, arbitrary depth)
///
/// @tradeoff Thresholds 106/212 bits match DD/QD precision limits.
///
/// # Errors
///
/// Returns `Err` if coordinate parsing or allocation fails.
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
        orbit::compute_orbit::<ArbFloat>(
            c_re_str,
            c_im_str,
            max_iter,
            precision_bits,
            cancel,
            progress,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicI32;

    use super::*;

    fn no_cancel() -> AtomicI32 { AtomicI32::new(0) }
    fn progress_sink() -> AtomicI32 { AtomicI32::new(0) }

    // ── bits_for_scale ────────────────────────────────────────────────────────

    #[test]
    fn bits_for_scale_large_scale() {
        assert_eq!(bits_for_scale("1.0").unwrap(), 64);
        assert_eq!(bits_for_scale("1e-5").unwrap(), 64);
    }

    #[test]
    fn bits_for_scale_deep_zoom() {
        assert!(bits_for_scale("1e-40").unwrap() >= 196);
        assert!(bits_for_scale("1e-100").unwrap() >= 396);
    }

    #[test]
    fn bits_for_scale_invalid() {
        assert!(bits_for_scale("abc").is_err());
        assert!(bits_for_scale("-1").is_err());
        assert!(bits_for_scale("0").is_err());
    }

    // ── precision ladder dispatch ─────────────────────────────────────────────

    /// DD path: bits <= 106 — escaping point works correctly.
    #[test]
    fn ladder_dd_escapes() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result =
            compute_mandelbrot_orbit("2", "0", 100, 64, &cancel, &prog).unwrap();
        let length = match result {
            OrbitResult::Complete(_, l) => l,
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        assert!(length <= 3, "c=2 should escape quickly via DD, got {length}");
    }

    /// QD path: bits in (106, 212] — orbit runs at higher precision.
    #[test]
    fn ladder_qd_runs() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result =
            compute_mandelbrot_orbit("0", "0", 50, 150, &cancel, &prog).unwrap();
        let length = match result {
            OrbitResult::Complete(_, l) => l,
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        assert_eq!(length, 50, "origin runs full 50 iters via QD");
    }

    /// ArbFloat path: bits > 212 — deep-zoom coordinate parsed and computed.
    #[test]
    fn ladder_arb_runs() {
        let cancel = no_cancel();
        let prog = progress_sink();
        let result =
            compute_mandelbrot_orbit("0", "0", 50, 300, &cancel, &prog).unwrap();
        let length = match result {
            OrbitResult::Complete(_, l) => l,
            OrbitResult::Cancelled(..) => panic!("should not cancel"),
        };
        assert_eq!(length, 50, "origin runs full 50 iters via ArbFloat");
    }

    /// All three paths agree on the escape length for c=(2,0).
    #[test]
    fn ladder_all_paths_agree_on_escape() {
        let cancel = no_cancel();
        let prog = progress_sink();

        let dd_len = match compute_mandelbrot_orbit("2", "0", 100, 64, &cancel, &prog).unwrap() {
            OrbitResult::Complete(_, l) => l,
            OrbitResult::Cancelled(..) => panic!(),
        };
        let qd_len = match compute_mandelbrot_orbit("2", "0", 100, 150, &cancel, &prog).unwrap() {
            OrbitResult::Complete(_, l) => l,
            OrbitResult::Cancelled(..) => panic!(),
        };
        let arb_len =
            match compute_mandelbrot_orbit("2", "0", 100, 300, &cancel, &prog).unwrap() {
                OrbitResult::Complete(_, l) => l,
                OrbitResult::Cancelled(..) => panic!(),
            };

        assert_eq!(dd_len, qd_len, "DD and QD should agree on escape");
        assert_eq!(qd_len, arb_len, "QD and ArbFloat should agree on escape");
    }
}
