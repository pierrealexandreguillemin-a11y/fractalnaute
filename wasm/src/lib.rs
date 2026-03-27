#![deny(clippy::all, clippy::pedantic)]
#![forbid(unsafe_code)]

mod orbit;
mod precision;

use std::sync::atomic::AtomicI32;

use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

/// Compute Mandelbrot reference orbit at arbitrary precision.
///
/// Returns `Float32Array`:
///   `[orbit_length (as u32 bits in f32), cancelled_flag,`
///   `z_re, z_im, dz_re, dz_im, ...]`
///
/// `control_buf`: `Int32Array` backed by `SharedArrayBuffer`
///   `[cancel_flag, progress]`
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
    control_buf: &js_sys::Int32Array,
) -> Result<Float32Array, JsValue> {
    let prec = if precision_bits == 0 {
        precision::bits_for_scale(scale_str)
            .map_err(|e| JsValue::from_str(&e))?
    } else {
        precision_bits as usize
    };

    let cancel_flag = AtomicI32::new(control_buf.get_index(0));
    let progress = AtomicI32::new(0);

    let result = orbit::compute_mandelbrot_orbit(
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
    // Orbit data length is bounded by max_iter * 4, which fits in u32.
    #[allow(clippy::cast_possible_truncation)]
    let data_len = data.len() as u32;
    let total_len = header_len + data_len;
    let arr = Float32Array::new_with_length(total_len);
    arr.set_index(0, f32::from_bits(length));
    arr.set_index(1, if cancelled { 1.0 } else { 0.0 });

    // Copy orbit data into the Float32Array after the header
    let orbit_arr = Float32Array::new_with_length(data_len);
    orbit_arr.copy_from(&data);
    arr.set(&orbit_arr, header_len);

    // Write final progress back to the control buffer
    #[allow(clippy::cast_possible_wrap)]
    control_buf.set_index(1, length as i32);

    Ok(arr)
}

/// Smoke test: verify astro-float precision at given bits.
///
/// # Errors
///
/// Returns `JsValue` error if constants cache initialization fails.
#[wasm_bindgen]
pub fn verify_precision(bits: u32) -> Result<String, JsValue> {
    use astro_float::{Consts, RoundingMode};
    let prec = bits as usize;
    let mut cc = Consts::new()
        .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    let pi = cc.pi(prec, RoundingMode::ToEven);
    Ok(format!("{pi}"))
}
