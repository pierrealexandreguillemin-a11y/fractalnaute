#![deny(clippy::all, clippy::pedantic)]
#![deny(clippy::unwrap_used)]
#![deny(clippy::print_stdout, clippy::print_stderr)]
#![forbid(unsafe_code)]

mod arb;
mod bla;
mod control;
mod dd;
mod nucleus;
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

/// Find the nucleus (center) of a mini-Mandelbrot at the given period.
///
/// Uses Newton's method with arbitrary-precision arithmetic.
/// Returns a JS string `"re\nim"` with high-precision coordinates.
///
/// @see <https://mathr.co.uk/web/m-nucleus.html>
///
/// # Errors
///
/// Returns `JsValue` error if coordinate parsing fails.
#[wasm_bindgen]
pub fn find_nucleus(
    c0_re: &str,
    c0_im: &str,
    period: u32,
    precision_digits: u32,
    newton_iters: u32,
) -> Result<String, JsValue> {
    let (re, im) = nucleus::find_nucleus(
        c0_re, c0_im, period,
        precision_digits as usize, newton_iters,
    ).map_err(|e| JsValue::from_str(&e))?;
    Ok(format!("{re}\n{im}"))
}

/// Estimate the dominant period at a location (f64 precision).
///
/// Returns the period as i32, or -1 if not found.
#[wasm_bindgen]
pub fn estimate_period(c_re: f64, c_im: f64, max_period: u32) -> i32 {
    nucleus::estimate_period(c_re, c_im, max_period)
        .map_or(-1, |p| p as i32)
}

/// Compute BLA table from reference orbit data.
///
/// Returns `Float32Array`:
///   `[num_levels (f32), level_offsets x num_levels, bla_table_data...]`
///
/// # Errors
///
/// Returns `JsValue` error if orbit data is invalid.
#[wasm_bindgen]
#[allow(clippy::cast_possible_truncation)]
pub fn compute_bla_table(
    orbit_data: &Float32Array,
    orbit_length: u32,
    max_dc: f32,
    epsilon: f32,
) -> Result<Float32Array, JsValue> {
    let data: Vec<f32> = orbit_data.to_vec();
    let (table, offsets, num_levels) =
        bla::compute_bla_table(&data, orbit_length as usize, max_dc, epsilon);

    // Pack: [num_levels, offsets..., table...]
    let header_len = 1 + offsets.len();
    let total = header_len + table.len();
    let arr = Float32Array::new_with_length(total as u32);

    #[allow(clippy::cast_precision_loss)]
    arr.set_index(0, num_levels as f32);
    for (i, &off) in offsets.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        arr.set_index((1 + i) as u32, off as f32);
    }

    if !table.is_empty() {
        let table_arr = Float32Array::new_with_length(table.len() as u32);
        table_arr.copy_from(&table);
        arr.set(&table_arr, header_len as u32);
    }

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
