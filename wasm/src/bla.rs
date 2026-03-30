//! BLA (Bivariate Linear Approximation) table construction.
//! Pure f32 math — no `OrbitFloat` dependency (SRP).
//!
//! Input: reference orbit `[z_re, z_im, dz_re, dz_im]` x M points.
//! Output: BLA table `[a_re, a_im, b_re, b_im, r_sq, l]` x entries.

/// Floats per BLA entry: A (2) + B (2) + `r_sq` (1) + l (1) = 6.
const BLA_ENTRY_SIZE: usize = 6;

/// Floats per orbit point: 4 (real, imag, deriv real, deriv imag).
const ORBIT_POINT_SIZE: usize = 4;

/// @tradeoff Default epsilon = 2^-23 (float32 mantissa precision).
/// Too large -> artifacts. Too small -> fewer skips. `FractalShark` uses same value.
const DEFAULT_EPSILON: f32 = 1.192_093e-7; // 2^-23

/// Minimum level to store (skip levels 0 and 1 — too small to help).
const FIRST_LEVEL: u32 = 2;

/// Create a single-step BLA for reference iteration m.
/// `A = 2*Z_m`, `B = 1+0i`, `r = eps*|A|`, `l = 1`.
#[allow(clippy::similar_names)]
fn create_one_step(orbit: &[f32], m: usize, epsilon: f32) -> [f32; BLA_ENTRY_SIZE] {
    let base = m * ORBIT_POINT_SIZE;
    let zr = orbit[base];
    let zi = orbit[base + 1];

    // A = 2*Z_m
    let coeff_a_re = 2.0 * zr;
    let coeff_a_im = 2.0 * zi;

    // B = 1 + 0i
    let coeff_b_re = 1.0_f32;
    let coeff_b_im = 0.0_f32;

    // r = eps * |A|, store r^2
    let a_mag = (coeff_a_re * coeff_a_re + coeff_a_im * coeff_a_im).sqrt();
    let radius = epsilon * a_mag;

    [
        coeff_a_re,
        coeff_a_im,
        coeff_b_re,
        coeff_b_im,
        radius * radius,
        1.0,
    ]
}

/// Merge two adjacent BLAs: x (at iter m, skips `l_x`) + y (at iter `m+l_x`, skips `l_y`).
#[allow(clippy::similar_names)]
fn merge_two(
    x: &[f32; BLA_ENTRY_SIZE],
    y: &[f32; BLA_ENTRY_SIZE],
    max_dc: f32,
) -> [f32; BLA_ENTRY_SIZE] {
    let (first_a_re, first_a_im) = (x[0], x[1]);
    let (first_b_re, first_b_im) = (x[2], x[3]);
    let first_r_sq = x[4];
    let first_skip = x[5];

    let (second_a_re, second_a_im) = (y[0], y[1]);
    let (second_b_re, second_b_im) = (y[2], y[3]);
    let second_r_sq = y[4];
    let second_skip = y[5];

    // A = y.A * x.A (complex multiply)
    let merged_a_re = second_a_re * first_a_re - second_a_im * first_a_im;
    let merged_a_im = second_a_re * first_a_im + second_a_im * first_a_re;

    // B = y.A * x.B + y.B (complex multiply + add)
    let merged_b_re =
        (second_a_re * first_b_re - second_a_im * first_b_im) + second_b_re;
    let merged_b_im =
        (second_a_re * first_b_im + second_a_im * first_b_re) + second_b_im;

    let skip_total = first_skip + second_skip;

    // r_merged = min(r_x, max(0, (r_y - |B_x|*maxDc) / |A_x|))
    let mag_first_a =
        (first_a_re * first_a_re + first_a_im * first_a_im).sqrt();
    let mag_first_b =
        (first_b_re * first_b_re + first_b_im * first_b_im).sqrt();
    let radius_second = second_r_sq.sqrt();
    let radius_first = first_r_sq.sqrt();

    let candidate = if mag_first_a > 0.0 {
        (radius_second - mag_first_b * max_dc) / mag_first_a
    } else {
        0.0
    };
    let radius = radius_first.min(candidate.max(0.0));

    [
        merged_a_re,
        merged_a_im,
        merged_b_re,
        merged_b_im,
        radius * radius,
        skip_total,
    ]
}

/// Compute BLA table from reference orbit data.
///
/// Returns flat f32 array: `[a_re, a_im, b_re, b_im, r_sq, l]` x `entry_count`.
/// The table is a flattened binary tree, levels stored contiguously.
/// Level offsets returned in a separate array for GPU lookup.
///
/// # Arguments
/// - `orbit_data`: flat `[z_re, z_im, dz_re, dz_im]` x `orbit_length`
/// - `orbit_length`: number of orbit points
/// - `max_dc`: maximum |dc| across all on-screen pixels
/// - `epsilon`: validity threshold (default 2^-23)
///
/// # Returns
/// `(table_data, level_offsets, num_levels)`
pub fn compute_bla_table(
    orbit_data: &[f32],
    orbit_length: usize,
    max_dc: f32,
    epsilon: f32,
) -> (Vec<f32>, Vec<u32>, u32) {
    if orbit_length < 2 {
        return (Vec::new(), Vec::new(), 0);
    }

    let eps = if epsilon <= 0.0 {
        DEFAULT_EPSILON
    } else {
        epsilon
    };

    // Level 0: single-step BLAs for iterations 1..orbit_length-1
    // (Skip iteration 0: Z_0=0, so A=0, r=0 — no valid BLA)
    let base_count = orbit_length - 1;

    let mut tree: Vec<Vec<[f32; BLA_ENTRY_SIZE]>> = Vec::new();

    let mut base_level = Vec::with_capacity(base_count);
    for m in 1..orbit_length {
        base_level.push(create_one_step(orbit_data, m, eps));
    }
    tree.push(base_level);

    // Build higher levels by merging pairs
    while let Some(prev) = tree.last() {
        if prev.len() < 2 {
            break;
        }
        let count = prev.len() / 2;
        let prev_idx = tree.len() - 1;
        let mut next_level = Vec::with_capacity(count);
        for j in 0..count {
            next_level.push(merge_two(
                &tree[prev_idx][j * 2],
                &tree[prev_idx][j * 2 + 1],
                max_dc,
            ));
        }
        tree.push(next_level);
    }

    // Flatten levels >= FIRST_LEVEL into output array
    let mut table = Vec::new();
    let mut offsets = Vec::new();
    let mut num_levels = 0_u32;

    for (level_idx, level_data) in tree.iter().enumerate() {
        #[allow(clippy::cast_possible_truncation)]
        let idx_u32 = level_idx as u32;
        if idx_u32 < FIRST_LEVEL {
            offsets.push(0); // placeholder for culled levels
            continue;
        }
        #[allow(clippy::cast_possible_truncation)]
        let offset = (table.len() / BLA_ENTRY_SIZE) as u32;
        offsets.push(offset);
        for entry in level_data {
            table.extend_from_slice(entry);
        }
        num_levels = idx_u32 + 1;
    }

    (table, offsets, num_levels)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_orbit(points: &[(f32, f32)]) -> Vec<f32> {
        let mut data = Vec::new();
        for &(re, im) in points {
            data.extend_from_slice(&[re, im, 0.0, 0.0]);
        }
        data
    }

    #[test]
    fn single_step_coefficients() {
        let orbit = make_orbit(&[(0.0, 0.0), (0.5, 0.25)]);
        let entry = create_one_step(&orbit, 1, DEFAULT_EPSILON);
        assert!(
            (entry[0] - 1.0).abs() < 1e-6,
            "A_re = 2*0.5 = 1.0, got {}",
            entry[0]
        );
        assert!(
            (entry[1] - 0.5).abs() < 1e-6,
            "A_im = 2*0.25 = 0.5, got {}",
            entry[1]
        );
        assert!(
            (entry[2] - 1.0).abs() < 1e-6,
            "B_re = 1.0, got {}",
            entry[2]
        );
        assert!(entry[3].abs() < 1e-6, "B_im = 0.0, got {}", entry[3]);
        assert!(entry[4] > 0.0, "r_sq should be positive");
        assert!((entry[5] - 1.0).abs() < 1e-6, "l = 1");
    }

    #[test]
    fn merge_doubles_skip() {
        let orbit = make_orbit(&[(0.0, 0.0), (0.5, 0.0), (0.75, 0.0)]);
        let step_x = create_one_step(&orbit, 1, DEFAULT_EPSILON);
        let step_y = create_one_step(&orbit, 2, DEFAULT_EPSILON);
        let merged = merge_two(&step_x, &step_y, 0.001);
        assert!(
            (merged[5] - 2.0).abs() < 1e-6,
            "merged l = 2, got {}",
            merged[5]
        );
    }

    #[test]
    fn table_from_short_orbit() {
        let orbit = make_orbit(&[
            (0.0, 0.0),
            (0.5, 0.0),
            (0.75, 0.0),
            (0.8, 0.0),
            (0.9, 0.0),
            (0.95, 0.0),
            (0.1, 0.0),
            (0.2, 0.0),
            (0.3, 0.0),
        ]);
        let (table, table_offsets, num_levels) =
            compute_bla_table(&orbit, 9, 0.001, DEFAULT_EPSILON);
        assert!(!table.is_empty(), "table should have entries");
        assert!(
            num_levels >= 3,
            "should have at least 3 levels for 8 entries, got {num_levels}"
        );
        assert!(!table_offsets.is_empty(), "offsets should exist");
    }

    #[test]
    fn empty_orbit_returns_empty() {
        let (table, _, num_levels) =
            compute_bla_table(&[], 0, 0.001, DEFAULT_EPSILON);
        assert!(table.is_empty());
        assert_eq!(num_levels, 0);
    }

    #[test]
    fn bla_apply_matches_one_perturbation_step() {
        let orbit = make_orbit(&[(0.0, 0.0), (1.0, 0.0)]);
        let entry = create_one_step(&orbit, 1, DEFAULT_EPSILON);
        let (coeff_a_re, coeff_a_im) = (entry[0], entry[1]);
        let (coeff_b_re, coeff_b_im) = (entry[2], entry[3]);

        let (delta_z_re, delta_z_im) = (0.1_f32, 0.05_f32);
        let (delta_c_re, delta_c_im) = (0.01_f32, 0.02_f32);

        // Apply: dz_new = A*dz + B*dc
        let new_re = coeff_a_re * delta_z_re - coeff_a_im * delta_z_im
            + coeff_b_re * delta_c_re
            - coeff_b_im * delta_c_im;
        let new_im = coeff_a_re * delta_z_im + coeff_a_im * delta_z_re
            + coeff_b_re * delta_c_im
            + coeff_b_im * delta_c_re;

        assert!((new_re - 0.21).abs() < 1e-5, "got {new_re}");
        assert!((new_im - 0.12).abs() < 1e-5, "got {new_im}");
    }
}
