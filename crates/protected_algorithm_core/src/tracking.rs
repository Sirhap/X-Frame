//! PCA local-frame and shape-gate algorithms used by subject tracking.

const REFERENCE_PI: f64 = 3.141593;
const REFERENCE_FOUR_PI: f64 = 12.566371;

/// PCA local-coordinate result.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LocalFrame {
    pub(crate) ux: f64,
    pub(crate) uy: f64,
    pub(crate) vx: f64,
    pub(crate) vy: f64,
    pub(crate) cx: f64,
    pub(crate) cy: f64,
    pub(crate) major_len: f64,
    pub(crate) minor_len: f64,
    pub(crate) isotropic: bool,
}

/// Seed statistics accepted by the shape gate.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ShapeSeed {
    pub(crate) area: i32,
    pub(crate) pca_major: f64,
    pub(crate) pca_minor: f64,
    pub(crate) compactness: Option<f64>,
}

/// Layered shape-gate output. `-1` means a layer was not evaluated.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ShapeMatch {
    pub(crate) passed: bool,
    pub(crate) layers: [i8; 3],
    pub(crate) segment: u8,
    pub(crate) ratio_area: Option<f64>,
    pub(crate) ratio_seed: Option<f64>,
    pub(crate) ratio_candidate: Option<f64>,
    pub(crate) ratio_comparison: Option<f64>,
    pub(crate) candidate_area: Option<i32>,
    pub(crate) candidate_perimeter: Option<f64>,
    pub(crate) candidate_compactness: Option<f64>,
}

/// Computes a stable PCA frame from non-zero mask pixels.
pub(crate) fn local_frame(
    mask: &[u8],
    width: usize,
    height: usize,
    previous: Option<(f64, f64)>,
) -> Option<LocalFrame> {
    let mut area = 0_u64;
    let mut sum_x = 0_f64;
    let mut sum_y = 0_f64;
    let mut minimum_x = usize::MAX;
    let mut maximum_x = 0_usize;
    let mut minimum_y = usize::MAX;
    let mut maximum_y = 0_usize;
    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] == 0 {
                continue;
            }
            area += 1;
            sum_x += x as f64;
            sum_y += y as f64;
            minimum_x = minimum_x.min(x);
            maximum_x = maximum_x.max(x);
            minimum_y = minimum_y.min(y);
            maximum_y = maximum_y.max(y);
        }
    }
    if area < 3 {
        return None;
    }
    let center_x = sum_x / area as f64;
    let center_y = sum_y / area as f64;
    let mut covariance_xx = 0_f64;
    let mut covariance_xy = 0_f64;
    let mut covariance_yy = 0_f64;
    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] == 0 {
                continue;
            }
            let delta_x = x as f64 - center_x;
            let delta_y = y as f64 - center_y;
            covariance_xx += delta_x * delta_x;
            covariance_xy += delta_x * delta_y;
            covariance_yy += delta_y * delta_y;
        }
    }
    let trace = covariance_xx + covariance_yy;
    if trace <= 0.0 {
        return None;
    }
    let discriminant = (trace * trace
        - 4.0 * (covariance_xx * covariance_yy - covariance_xy * covariance_xy))
        .max(0.0)
        .sqrt();
    let previous = previous.filter(|(x, y)| x.is_finite() && y.is_finite());
    if discriminant < trace * 0.15 {
        let width_span = (maximum_x - minimum_x) as f64;
        let height_span = (maximum_y - minimum_y) as f64;
        if width_span <= 0.0 || height_span <= 0.0 {
            return None;
        }
        let horizontal = previous
            .map(|(x, y)| x.abs() >= y.abs())
            .unwrap_or(width_span >= height_span);
        let (mut ux, mut uy) = if horizontal { (1.0, 0.0) } else { (0.0, 1.0) };
        if previous.is_some_and(|(x, y)| ux * x + uy * y < 0.0) {
            ux = -ux;
            uy = -uy;
        }
        return Some(LocalFrame {
            ux,
            uy,
            vx: -uy,
            vy: ux,
            cx: center_x,
            cy: center_y,
            major_len: if horizontal { width_span } else { height_span },
            minor_len: if horizontal { height_span } else { width_span },
            isotropic: true,
        });
    }

    let largest_eigenvalue = (trace + discriminant) * 0.5;
    let first = (covariance_xy, largest_eigenvalue - covariance_xx);
    let second = (largest_eigenvalue - covariance_yy, covariance_xy);
    let first_length = first.0.hypot(first.1);
    let second_length = second.0.hypot(second.1);
    let (mut ux, mut uy) = if first_length >= second_length && first_length > f64::EPSILON {
        (first.0 / first_length, first.1 / first_length)
    } else if second_length > f64::EPSILON {
        (second.0 / second_length, second.1 / second_length)
    } else {
        return None;
    };
    if let Some((previous_x, previous_y)) = previous {
        if ux * previous_x + uy * previous_y < 0.0 {
            ux = -ux;
            uy = -uy;
        }
    } else if ux < 0.0 || (ux == 0.0 && uy < 0.0) {
        ux = -ux;
        uy = -uy;
    }
    projected_frame(mask, width, height, center_x, center_y, ux, uy)
}

fn projected_frame(
    mask: &[u8],
    width: usize,
    height: usize,
    center_x: f64,
    center_y: f64,
    ux: f64,
    uy: f64,
) -> Option<LocalFrame> {
    let vx = -uy;
    let vy = ux;
    let mut minimum_major = f64::INFINITY;
    let mut maximum_major = f64::NEG_INFINITY;
    let mut minimum_minor = f64::INFINITY;
    let mut maximum_minor = f64::NEG_INFINITY;
    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] == 0 {
                continue;
            }
            let delta_x = x as f64 - center_x;
            let delta_y = y as f64 - center_y;
            let major = delta_x * ux + delta_y * uy;
            let minor = delta_x * vx + delta_y * vy;
            minimum_major = minimum_major.min(major);
            maximum_major = maximum_major.max(major);
            minimum_minor = minimum_minor.min(minor);
            maximum_minor = maximum_minor.max(minor);
        }
    }
    Some(LocalFrame {
        ux,
        uy,
        vx,
        vy,
        cx: center_x,
        cy: center_y,
        major_len: maximum_major - minimum_major,
        minor_len: maximum_minor - minimum_minor,
        isotropic: false,
    })
}

/// Builds candidate statistics from a binary mask, then applies all shape gates.
pub(crate) fn match_mask(
    mask: &[u8],
    width: usize,
    height: usize,
    seed: Option<ShapeSeed>,
) -> ShapeMatch {
    let Some(seed) = seed else {
        return empty_match(true);
    };
    let mut area = 0_i32;
    let mut perimeter = 0_f64;
    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if mask[index] == 0 {
                continue;
            }
            area += 1;
            if x == 0 || mask[index - 1] == 0 {
                perimeter += 1.0;
            }
            if x + 1 == width || mask[index + 1] == 0 {
                perimeter += 1.0;
            }
            if y == 0 || mask[index - width] == 0 {
                perimeter += 1.0;
            }
            if y + 1 == height || mask[index + width] == 0 {
                perimeter += 1.0;
            }
        }
    }
    let frame = if area >= 3 {
        local_frame(mask, width, height, None)
    } else {
        None
    };
    let compactness = if area > 0 && perimeter > 0.0 {
        perimeter * perimeter / (REFERENCE_FOUR_PI * area as f64)
    } else {
        0.0
    };
    match_stats(
        area,
        perimeter,
        compactness,
        frame.map(|value| value.major_len).unwrap_or(0.0),
        frame.map(|value| value.minor_len).unwrap_or(0.0),
        seed,
    )
}

fn match_stats(
    area: i32,
    perimeter: f64,
    compactness: f64,
    major: f64,
    minor: f64,
    seed: ShapeSeed,
) -> ShapeMatch {
    let mut result = empty_match(false);
    result.layers = [0, -1, -1];
    result.candidate_area = Some(area);
    result.candidate_perimeter = if perimeter > 0.0 {
        Some((compactness * 4.0 * REFERENCE_PI * area as f64).sqrt())
    } else {
        None
    };
    result.candidate_compactness = if perimeter > 0.0 {
        Some(compactness)
    } else {
        None
    };
    if area < 3 || perimeter <= 0.0 || seed.area <= 0 {
        return result;
    }
    let ratio_area = area as f64 / seed.area as f64;
    result.ratio_area = Some(ratio_area);
    result.layers[0] = i8::from((0.769231..=1.3).contains(&ratio_area));
    if result.layers[0] == 0 {
        return result;
    }

    let candidate_major = major.max(minor);
    let candidate_minor = major.min(minor);
    if candidate_major <= 0.0 {
        result.segment = 1;
        result.layers[1] = 0;
        return result;
    }
    if seed.pca_major == 0.0 {
        result.segment = 1;
    } else {
        let ratio_candidate = candidate_minor / candidate_major;
        let ratio_seed = seed.pca_minor / seed.pca_major;
        result.ratio_candidate = Some(ratio_candidate);
        result.ratio_seed = Some(ratio_seed);
        result.layers[1] = if ratio_seed < 0.15 {
            result.segment = 2;
            i8::from(ratio_candidate < 0.25)
        } else {
            let comparison = ratio_candidate / ratio_seed;
            result.ratio_comparison = Some(comparison);
            if ratio_seed < 0.6 {
                result.segment = 3;
                i8::from((0.59988..=1.667).contains(&comparison))
            } else {
                result.segment = 4;
                i8::from((0.69979..=1.429).contains(&comparison))
            }
        };
        if result.layers[1] == 0 {
            return result;
        }
    }
    if area >= 200 {
        if let Some(seed_compactness) = seed.compactness.filter(|value| *value != 0.0) {
            let comparison = compactness / seed_compactness;
            result.ratio_comparison = Some(comparison);
            result.layers[2] = i8::from((0.4..=2.5).contains(&comparison));
            if result.layers[2] == 0 {
                return result;
            }
        }
    }
    result.passed = true;
    result
}

fn empty_match(passed: bool) -> ShapeMatch {
    ShapeMatch {
        passed,
        layers: [-1; 3],
        segment: 0,
        ratio_area: None,
        ratio_seed: None,
        ratio_candidate: None,
        ratio_comparison: None,
        candidate_area: None,
        candidate_perimeter: None,
        candidate_compactness: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{local_frame, match_mask, ShapeSeed};

    #[test]
    fn fp_kernel_05_rejects_fewer_than_three_pixels() {
        assert!(local_frame(&[1, 1], 2, 1, None).is_none());
    }

    #[test]
    fn fp_kernel_05_preserves_previous_direction() {
        let frame = local_frame(&[1, 1, 1], 3, 1, Some((-1.0, 0.0))).expect("frame");
        assert!(frame.ux < 0.0);
        assert_eq!(frame.major_len, 2.0);
    }

    #[test]
    fn fp_kernel_11_applies_area_gate() {
        let result = match_mask(
            &[1, 1, 1],
            3,
            1,
            Some(ShapeSeed {
                area: 10,
                pca_major: 2.0,
                pca_minor: 0.0,
                compactness: None,
            }),
        );
        assert!(!result.passed);
        assert_eq!(result.layers[0], 0);
    }
}
