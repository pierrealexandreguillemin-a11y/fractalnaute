#![deny(clippy::all, clippy::pedantic)]
#![deny(clippy::unwrap_used)]
#![deny(clippy::print_stdout, clippy::print_stderr)]
#![forbid(unsafe_code)]

mod arb;
mod control;
mod dd;
mod orbit;
mod precision;
mod qd;

use js_sys::{Float32Array, Int32Array};
use wasm_bindgen::prelude::*;

/// Compute Mandelbrot reference orbit at arbitrary precision.
///
/// Returns `Float32Array`:
///   `[orbit_length (as f32), cancelled_flag (0.0/1.0),`
///   `Z_re, Z_im, Z'_re, Z'_im, ...]`
///
/// **Cancel/progress** (ISO 9241-110: controllability):
/// `control_buf` is an `Int32Array` backed by `SharedArrayBuffer(8)`:
///   - offset 0: cancel flag (main thread writes 1 → Rust reads and aborts)
///   - offset 1: progress counter (Rust writes current iteration → main reads)
///
/// # Errors
///
/// Returns `JsValue` error if coordinate parsing or precision scaling fails.
#[wasm_bindgen]
pub fn compute_reference_orbit(
    center_re: &str,
    center_im: &str,
    max_iter: u32,
    precision_bits: u32,
    scale_str: &str,
    control_buf: &Int32Array,
) -> Result<Float32Array, JsValue> {
    let prec = if precision_bits == 0 {
        precision::bits_for_scale(scale_str)
            .map_err(|e| JsValue::from_str(&e))?
    } else {
        precision_bits as usize
    };

    let cancel_flag = control::SabControl::new(control_buf, 0);
    let progress = control::SabControl::new(control_buf, 1);

    let result = precision::compute_mandelbrot_orbit(
        center_re,
        center_im,
        max_iter,
        prec,
        &cancel_flag,
        &progress,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    let (data, length, cancelled) = match result {
        orbit::OrbitResult::Complete(d, l) => (d, l, false),
        orbit::OrbitResult::Cancelled(d, l) => (d, l, true),
    };

    let header_len = 2_u32;
    #[allow(clippy::cast_possible_truncation)]
    let data_len = data.len() as u32;
    let total_len = header_len + data_len;
    let arr = Float32Array::new_with_length(total_len);
    #[allow(clippy::cast_precision_loss)]
    let length_f32 = length as f32;
    arr.set_index(0, length_f32);
    arr.set_index(1, if cancelled { 1.0 } else { 0.0 });

    let orbit_arr = Float32Array::new_with_length(data_len);
    orbit_arr.copy_from(&data);
    arr.set(&orbit_arr, header_len);

    Ok(arr)
}

/// Smoke test: verify `ArbFloat` precision at given bits.
///
/// Parses a known value of π and returns its f64 representation.
///
/// # Errors
///
/// Returns `JsValue` error if parsing fails.
#[wasm_bindgen]
pub fn verify_precision(bits: u32) -> Result<String, JsValue> {
    use crate::orbit::OrbitFloat;
    let v = arb::ArbFloat::parse_decimal(
        "3.14159265358979323846264338327950288419716939937510",
        bits as usize,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(format!("{}", v.to_f64()))
}
