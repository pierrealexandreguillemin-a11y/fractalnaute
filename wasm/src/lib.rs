#![deny(clippy::all, clippy::pedantic)]
#![forbid(unsafe_code)]

use astro_float::{BigFloat, Consts, RoundingMode};
use wasm_bindgen::prelude::*;

/// Smoke test: compute pi to `precision_bits` bits, return as string.
#[wasm_bindgen]
pub fn compute_pi(precision_bits: u32) -> Result<String, JsValue> {
    let prec = precision_bits as usize;
    let mut cc = Consts::new().map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    let pi = cc.pi(prec, RoundingMode::ToEven);
    Ok(format!("{pi}"))
}

/// Smoke test: multiply two big floats at given precision.
#[wasm_bindgen]
pub fn verify_precision(bits: u32) -> Result<String, JsValue> {
    let prec = bits as usize;
    let rm = RoundingMode::ToEven;

    // Create two BigFloats and multiply them
    let a = BigFloat::from_f64(core::f64::consts::PI, prec);
    let b = BigFloat::from_f64(core::f64::consts::E, prec);
    let product = a.mul(&b, prec, rm);

    Ok(format!("{product}"))
}
