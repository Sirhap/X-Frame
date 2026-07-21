//! Linear-light edge contamination restoration.

/// Edge restoration options passed through the product-neutral ABI.
pub(crate) struct EdgeRestoreOptions<'a> {
    pub(crate) correct: [u8; 3],
    pub(crate) contaminated: [u8; 3],
    pub(crate) tolerance: i32,
    pub(crate) edge_radius: usize,
    pub(crate) background_radius: i32,
    pub(crate) mask: Option<&'a [u8]>,
}

/// Restores colors along a validated RGBA image and returns `None` for a degenerate color axis.
pub(crate) fn restore(
    source: &[u8],
    width: usize,
    height: usize,
    options: EdgeRestoreOptions<'_>,
) -> Option<Vec<u8>> {
    let pixel_count = width * height;
    let correct = options.correct.map(linear_f32);
    let contaminated = options.contaminated.map(linear_f32);
    let axis = [
        contaminated[0] - correct[0],
        contaminated[1] - correct[1],
        contaminated[2] - correct[2],
    ];
    let axis_length_squared = dot(axis, axis);
    if axis_length_squared < 0.0001 {
        return None;
    }
    let edge_mask = if options.edge_radius > 0 {
        Some(build_edge_mask(
            source,
            width,
            height,
            contaminated,
            correct,
            axis,
            axis_length_squared,
            options.edge_radius,
            options.background_radius,
        ))
    } else {
        None
    };
    let residual_limit = options.tolerance as f64 / 1000.0;
    let residual_limit_squared = residual_limit * residual_limit;
    let mut output = source.to_vec();
    for pixel in 0..pixel_count {
        if options.mask.is_some_and(|mask| mask[pixel] == 0)
            || edge_mask.as_ref().is_some_and(|mask| mask[pixel] == 0)
        {
            continue;
        }
        let offset = pixel * 4;
        if source[offset + 3] == 0 {
            continue;
        }
        let pixel_linear = [
            linear_f32(source[offset]),
            linear_f32(source[offset + 1]),
            linear_f32(source[offset + 2]),
        ];
        let projection = dot(subtract(pixel_linear, correct), axis) / axis_length_squared;
        if !(0.0..0.85).contains(&projection) {
            continue;
        }
        let residual = subtract(subtract(pixel_linear, correct), scale(axis, projection));
        if dot(residual, residual) >= residual_limit_squared {
            continue;
        }
        let mut restored = options.correct;
        if projection > 0.5 {
            let correction_weight = (0.9 - projection) / 0.4;
            if correction_weight <= 0.0 {
                continue;
            }
            if correction_weight < 1.0 {
                let source_weight = 1.0 - correction_weight;
                for channel in 0..3 {
                    restored[channel] = round_byte(
                        source[offset + channel] as f64 * source_weight
                            + options.correct[channel] as f64 * correction_weight,
                    );
                }
            }
        }
        output[offset..offset + 3].copy_from_slice(&restored);
    }
    Some(output)
}

#[allow(clippy::too_many_arguments)]
fn build_edge_mask(
    source: &[u8],
    width: usize,
    height: usize,
    contaminated: [f64; 3],
    correct: [f64; 3],
    axis: [f64; 3],
    axis_length_squared: f64,
    edge_radius: usize,
    background_radius: i32,
) -> Vec<u8> {
    let pixel_count = width * height;
    let mut candidates = vec![0_u8; pixel_count];
    let color_radius = background_radius as f64 / 255.0 * 1.2;
    let color_radius_squared = color_radius * color_radius;
    for pixel in 0..pixel_count {
        let offset = pixel * 4;
        if source[offset + 3] == 0 {
            continue;
        }
        let pixel_linear = [
            linear_f32(source[offset]),
            linear_f32(source[offset + 1]),
            linear_f32(source[offset + 2]),
        ];
        let delta = subtract(pixel_linear, contaminated);
        if dot(delta, delta) >= color_radius_squared {
            continue;
        }
        let projection = dot(subtract(pixel_linear, correct), axis) / axis_length_squared;
        if projection >= 0.7 {
            candidates[pixel] = 1;
        }
    }
    let mut horizontal = vec![0_u8; pixel_count];
    for y in 0..height {
        for x in 0..width {
            let minimum_x = x.saturating_sub(edge_radius);
            let maximum_x = x.saturating_add(edge_radius).min(width - 1);
            if (minimum_x..=maximum_x).any(|sample_x| candidates[y * width + sample_x] != 0) {
                horizontal[y * width + x] = 1;
            }
        }
    }
    let mut result = vec![0_u8; pixel_count];
    for x in 0..width {
        for y in 0..height {
            let minimum_y = y.saturating_sub(edge_radius);
            let maximum_y = y.saturating_add(edge_radius).min(height - 1);
            if (minimum_y..=maximum_y).any(|sample_y| horizontal[sample_y * width + x] != 0) {
                result[y * width + x] = 1;
            }
        }
    }
    result
}

fn linear_f32(channel: u8) -> f64 {
    let normalized = channel as f64 / 255.0;
    let linear = if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    };
    (linear as f32) as f64
}

fn dot(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn subtract(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale(value: [f64; 3], factor: f64) -> [f64; 3] {
    [value[0] * factor, value[1] * factor, value[2] * factor]
}

fn round_byte(value: f64) -> u8 {
    value.clamp(0.0, 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::{restore, EdgeRestoreOptions};

    #[test]
    fn fp_kernel_08_leaves_transparent_rgb_unchanged() {
        let source = [20, 200, 20, 0];
        let output = restore(
            &source,
            1,
            1,
            EdgeRestoreOptions {
                correct: [200, 20, 20],
                contaminated: [20, 200, 20],
                tolerance: 30,
                edge_radius: 0,
                background_radius: 30,
                mask: None,
            },
        )
        .expect("axis");
        assert_eq!(output, source);
    }
}
