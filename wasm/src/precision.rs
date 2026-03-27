use astro_float::{BigFloat, Consts, Radix, RoundingMode, Sign, Word, WORD_BIT_SIZE};

const RM: RoundingMode = RoundingMode::ToEven;
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

/// Parse a decimal string into a `BigFloat` at given precision.
///
/// # Errors
///
/// Returns `Err` if `s` cannot be parsed (astro-float returns NaN for
/// malformed input) or if `Consts` initialization fails.
pub fn parse_decimal(s: &str, prec: usize) -> Result<BigFloat, String> {
    let mut cc = Consts::new().map_err(|e| format!("{e:?}"))?;
    let val = BigFloat::parse(s, Radix::Dec, prec, RM, &mut cc);
    if val.is_nan() {
        return Err(format!("failed to parse '{s}' as BigFloat"));
    }
    Ok(val)
}

/// Convert a `BigFloat` to f64 using raw mantissa extraction.
///
/// Adaptation: astro-float 0.9 has no public `to_f64()` on `BigFloat`.
/// We reconstruct the f64 from `as_raw_parts()` (mantissa words, sign, exponent).
/// On WASM32, `Word` = u32, `WORD_BIT_SIZE` = 32.
#[allow(clippy::cast_possible_wrap)]
pub fn to_f64(val: &BigFloat) -> f64 {
    let Some(parts) = val.as_raw_parts() else {
        return 0.0; // NaN or Inf => 0.0 for safety
    };
    let (mantissa_words, _n_bits, sign, exponent, _inexact) = parts;

    if val.is_zero() {
        return 0.0;
    }

    // Build f64 from mantissa + exponent.
    // BigFloat stores mantissa as array of Words, MSW last.
    // The mantissa represents a value in [0.5, 1.0) with the binary point
    // before the MSB. Exponent is such that value = mantissa * 2^exponent.
    //
    // f64 layout: 1 sign bit + 11 exponent bits + 52 mantissa bits.
    // IEEE 754: value = (-1)^s * 1.fraction * 2^(e-1023)
    // BigFloat: value = 0.1mantissa * 2^exp = 1.mantissa * 2^(exp-1)

    // Extract top 64 bits of mantissa (MSW is at the end of the slice).
    let top_bits: u64 = extract_top_64(mantissa_words);

    // The implicit leading 1 in BigFloat is the MSB of the mantissa.
    // For IEEE 754 f64, we need 52 fraction bits (without the implicit 1).
    // Shift to get fraction bits (remove the leading 1).
    let fraction = (top_bits << 1) >> 12; // remove MSB, then shift to 52-bit position

    // Compute IEEE 754 biased exponent.
    // BigFloat exponent means value = mantissa * 2^exponent where mantissa in [0.5, 1.0)
    // So value = 1.frac * 2^(exponent - 1)
    // IEEE 754: biased_exp = (exponent - 1) + 1023
    let biased_exp = i64::from(exponent) - 1 + 1023;

    if biased_exp >= 2047 {
        return if sign == Sign::Neg {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if biased_exp <= 0 {
        // Underflow/subnormal => return 0.0 for simplicity
        return 0.0;
    }

    let mut bits: u64 = 0;
    if sign == Sign::Neg {
        bits |= 1 << 63;
    }
    // biased_exp is in 1..2047 so cast to u64 is safe
    #[allow(clippy::cast_sign_loss)]
    {
        bits |= (biased_exp as u64) << 52;
    }
    bits |= fraction & 0x000F_FFFF_FFFF_FFFF;

    f64::from_bits(bits)
}

/// Convert a `BigFloat` to f32 (for GPU texture upload).
#[allow(clippy::cast_possible_truncation)]
pub fn to_f32(val: &BigFloat) -> f32 {
    let f = to_f64(val) as f32;
    if f.is_finite() { f } else { 0.0_f32 }
}

/// Extract the top 64 bits from a mantissa word array.
/// In astro-float, the most significant word is at the END of the slice.
#[allow(clippy::useless_conversion)]
fn extract_top_64(words: &[Word]) -> u64 {
    if words.is_empty() {
        return 0;
    }

    let len = words.len();

    if WORD_BIT_SIZE == 64 {
        // On 64-bit: Word = u64, top word is last.
        // u64::from is a no-op here but needed for WASM32 where Word = u32.
        u64::from(words[len - 1])
    } else {
        // On 32-bit (WASM): Word = u32, combine two MSWs
        let hi = u64::from(words[len - 1]);
        let lo = if len >= 2 {
            u64::from(words[len - 2])
        } else {
            0
        };
        (hi << 32) | lo
    }
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
    fn parse_decimal_valid() {
        let val = parse_decimal("3.14159", 128).unwrap();
        assert!(!val.is_nan());
    }

    #[test]
    fn parse_decimal_invalid() {
        let result = parse_decimal("not_a_number", 128);
        assert!(result.is_err());
    }

    #[test]
    fn to_f64_roundtrip() {
        let val = BigFloat::from_f64(3.14159265358979, 128);
        let f = to_f64(&val);
        assert!(
            (f - 3.14159265358979).abs() < 1e-10,
            "expected ~3.14159, got {f}"
        );
    }

    #[test]
    fn to_f64_zero() {
        let val = BigFloat::from_f64(0.0, 128);
        assert!((to_f64(&val)).abs() < f64::EPSILON);
    }

    #[test]
    fn to_f64_negative() {
        let val = BigFloat::from_f64(-2.5, 128);
        let f = to_f64(&val);
        assert!((f - (-2.5)).abs() < 1e-10, "expected -2.5, got {f}");
    }

    #[test]
    fn to_f32_roundtrip() {
        let val = BigFloat::from_f64(1.5, 128);
        let f = to_f32(&val);
        assert!((f - 1.5_f32).abs() < 1e-5, "expected 1.5, got {f}");
    }
}
