use std::ops::{Add, Mul, Sub};

/// Result of a reference orbit computation.
pub enum OrbitResult {
    /// Orbit completed normally (data, iteration count).
    Complete(Vec<f32>, u32),
    /// Orbit was cancelled via `cancel_flag` (partial data, iteration count).
    Cancelled(Vec<f32>, u32),
}

/// Numeric type used for orbit iteration.
///
/// Implementations: `f64` (fast, standard zoom), `DD` (double-double, ~10^-15
/// zoom), with `QD` planned for 10^-30+.
///
/// All arithmetic operations take references (`&Self`) so that non-`Copy`
/// arbitrary-precision types (e.g. `dashu::DBig`) can implement the trait
/// without cloning on every operator.
#[allow(dead_code)]
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
