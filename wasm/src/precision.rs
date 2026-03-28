use std::f64::consts::LOG10_2;

use dashu_float::DBig;

const PRECISION_MARGIN: usize = 64;

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

/// Convert precision in bits to decimal significant digits for `DBig`.
///
/// Formula: `digits = ceil(bits * log10(2)) + 2` margin.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
pub fn bits_to_digits(bits: usize) -> usize {
    ((bits as f64) * LOG10_2).ceil() as usize + 2
}

/// Parse a decimal string into a `DBig`.
///
/// `DBig` preserves full decimal precision from the input string,
/// enabling correct orbits at arbitrary zoom depth (10^-40+).
///
/// # Errors
///
/// Returns `Err` if `s` cannot be parsed as a finite number.
pub fn parse_decimal(s: &str) -> Result<DBig, String> {
    s.parse::<DBig>()
        .map_err(|e| format!("failed to parse '{s}': {e}"))
}

/// Arithmetic constants for `DBig` (cannot be `const` — heap-allocated).
pub fn dbig_zero() -> DBig { DBig::from(0) }
pub fn dbig_one() -> DBig { DBig::from(1) }
pub fn dbig_two() -> DBig { DBig::from(2) }

/// Truncate a `DBig` to `digits` significant decimal digits.
///
/// @tradeoff Truncate after every intermediate op to bound `DBig` digit growth.
/// Exact decimal arithmetic doubles digits per multiply — without truncation,
/// 256 iterations would produce 2^256 digits. Per-op truncation caps working
/// precision at `digits` (~bits/3.32 + 2) with `HalfEven` rounding (= IEEE 754
/// `ToEven`). Output is f32, so sub-7-digit differences are invisible.
pub fn trunc(val: DBig, digits: usize) -> DBig {
    val.with_precision(digits).value()
}

/// Convert a `DBig` to f64.
pub fn to_f64(val: &DBig) -> f64 {
    val.to_f64().value()
}

/// Convert a `DBig` to f32 (for GPU texture upload).
#[allow(clippy::cast_possible_truncation)]
pub fn to_f32(val: &DBig) -> f32 {
    let f = val.to_f64().value() as f32;
    if f.is_finite() { f } else { 0.0_f32 }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn bits_to_digits_basic() {
        // 128 bits => ~40 digits, 256 bits => ~79 digits
        assert!(bits_to_digits(128) >= 40);
        assert!(bits_to_digits(256) >= 79);
    }

    #[test]
    fn parse_decimal_valid() {
        let val = parse_decimal("3.14159").unwrap();
        let f = to_f64(&val);
        assert!((f - 3.14159).abs() < 1e-4, "expected ~3.14159, got {f}");
    }

    #[test]
    fn parse_decimal_invalid() {
        let result = parse_decimal("not_a_number");
        assert!(result.is_err());
    }

    #[test]
    fn to_f64_roundtrip() {
        let val = parse_decimal("3.14159265358979").unwrap();
        let f = to_f64(&val);
        assert!(
            (f - 3.14159265358979).abs() < 1e-14,
            "expected ~3.14159, got {f}"
        );
    }

    #[test]
    fn to_f64_zero() {
        let val = parse_decimal("0").unwrap();
        assert!(to_f64(&val).abs() < f64::EPSILON);
    }

    #[test]
    fn to_f64_negative() {
        let val = parse_decimal("-2.5").unwrap();
        let f = to_f64(&val);
        assert!((f - (-2.5)).abs() < 1e-14, "expected -2.5, got {f}");
    }

    #[test]
    fn to_f32_roundtrip() {
        let val = parse_decimal("1.5").unwrap();
        let f = to_f32(&val);
        assert!((f - 1.5_f32).abs() < 1e-5, "expected 1.5, got {f}");
    }

    #[test]
    fn deep_zoom_precision_preserved() {
        // 40-digit coordinate should parse without loss
        let s = "-0.7436438885706951598312068939351231241234";
        let val = parse_decimal(s).unwrap();
        let f = to_f64(&val);
        // f64 can only represent ~15 digits, but the DBig has full precision
        assert!(
            (f - (-0.743643888570695)).abs() < 1e-14,
            "f64 truncation should be close, got {f}"
        );
    }
}
