//! Directional color clustering and greedy protected-color coverage.

use std::cmp::Ordering;

#[derive(Clone, Copy, Debug)]
struct Descriptor {
    r: u8,
    g: u8,
    b: u8,
    y: f64,
    chroma: f64,
    dir_cb: f64,
    dir_cr: f64,
    achromatic: bool,
}

#[derive(Clone, Debug)]
struct Sample {
    descriptor: Descriptor,
    radius_squared: f64,
    bucket: usize,
    weight: f64,
}

#[derive(Clone, Debug)]
struct Candidate {
    sample: Sample,
    excluded: bool,
    full_coverage: f64,
}

/// One protected color and the number of newly covered samples.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProtectedColor {
    pub(crate) r: u8,
    pub(crate) g: u8,
    pub(crate) b: u8,
    pub(crate) count: u32,
}

/// Product-level protected-color selection result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProtectionSelection {
    pub(crate) colors: Vec<ProtectedColor>,
    pub(crate) coverage: u8,
    pub(crate) status: u8,
    pub(crate) sample_count: u32,
}

/// Selects direction-cluster representatives using greedy sample coverage.
pub(crate) fn select(
    source: &[u8],
    preview: Option<&[u8]>,
    width: usize,
    height: usize,
    background: [u8; 3],
    maximum_colors: usize,
    coverage_threshold: u8,
    existing_colors: &[[u8; 3]],
    full_image: Option<(&[u8], &[u8], usize, usize)>,
) -> ProtectionSelection {
    let background = descriptor(background[0], background[1], background[2]);
    let pixel_count = width * height;
    let step = if pixel_count >= 5001 {
        ((pixel_count as f64 / 5000.0).sqrt().ceil() as usize).max(1)
    } else {
        1
    };
    let mut bucket_counts = [0_u32; 4096];
    let mut samples = Vec::new();
    let center_x = if width > 1 {
        (width - 1) as f64 * 0.5
    } else {
        0.0
    };
    let center_y = if height > 1 {
        (height - 1) as f64 * 0.5
    } else {
        0.0
    };
    for y in (0..height).step_by(step) {
        for x in (0..width).step_by(step) {
            let offset = (y * width + x) * 4;
            if preview.is_some_and(|value| value[offset + 3] == 0 || value[offset + 3] == 255) {
                continue;
            }
            let value = descriptor(source[offset], source[offset + 1], source[offset + 2]);
            let bucket = ((value.r as usize >> 4) << 8)
                | ((value.g as usize >> 4) << 4)
                | (value.b as usize >> 4);
            bucket_counts[bucket] += 1;
            samples.push(Sample {
                descriptor: value,
                radius_squared: (x as f64 - center_x).powi(2) + (y as f64 - center_y).powi(2),
                bucket,
                weight: 0.0,
            });
        }
    }
    if samples.is_empty() {
        return ProtectionSelection {
            colors: Vec::new(),
            coverage: 100,
            status: 0,
            sample_count: 0,
        };
    }
    let sample_count = samples.len();
    for sample in &mut samples {
        sample.weight = bucket_counts[sample.bucket] as f64 / sample_count as f64;
        if !sample.descriptor.achromatic && direction_dot(sample.descriptor, background) >= 0.9 {
            sample.weight *= 0.1;
        }
    }
    samples.sort_by(|left, right| {
        if left.descriptor.achromatic != right.descriptor.achromatic {
            return if left.descriptor.achromatic {
                Ordering::Greater
            } else {
                Ordering::Less
            };
        }
        if left.descriptor.achromatic {
            total_cmp(left.descriptor.y, right.descriptor.y)
        } else {
            total_cmp(
                left.descriptor.dir_cr.atan2(left.descriptor.dir_cb),
                right.descriptor.dir_cr.atan2(right.descriptor.dir_cb),
            )
        }
    });

    let mut candidates = Vec::new();
    let mut group_start = 0;
    for index in 1..=samples.len() {
        let same_direction = index < samples.len() && {
            let previous = &samples[index - 1].descriptor;
            let current = &samples[index].descriptor;
            (previous.achromatic && current.achromatic)
                || (!previous.achromatic
                    && !current.achromatic
                    && direction_dot(*previous, *current) >= 0.9)
        };
        if same_direction {
            continue;
        }
        append_group_candidates(
            &samples,
            &samples[group_start..index],
            background,
            &mut candidates,
        );
        group_start = index;
    }

    if let Some((full_original, full_preview, full_width, full_height)) = full_image {
        filter_by_full_image(
            &mut candidates,
            background,
            full_original,
            full_preview,
            full_width,
            full_height,
        );
    }

    let existing = existing_colors
        .iter()
        .take(32)
        .map(|color| descriptor(color[0], color[1], color[2]))
        .collect::<Vec<_>>();
    let mut covered = vec![false; samples.len()];
    let mut covered_count = 0_usize;
    for (index, sample) in samples.iter().enumerate() {
        if existing
            .iter()
            .any(|candidate| matches(background, *candidate, sample.descriptor))
        {
            covered[index] = true;
            covered_count += 1;
        }
    }
    let mut colors = Vec::new();
    while colors.len() < maximum_colors
        && covered_count * 100 < samples.len() * coverage_threshold as usize
    {
        let mut best_index = None;
        let mut best_coverage = 0_usize;
        for (candidate_index, candidate) in candidates.iter().enumerate() {
            if candidate.excluded {
                continue;
            }
            let coverage = samples
                .iter()
                .enumerate()
                .filter(|(index, sample)| {
                    !covered[*index]
                        && matches(background, candidate.sample.descriptor, sample.descriptor)
                })
                .count();
            if coverage > best_coverage {
                best_index = Some(candidate_index);
                best_coverage = coverage;
            }
        }
        let Some(best_index) = best_index else { break };
        if best_coverage == 0 {
            break;
        }
        let selected = candidates[best_index].sample.descriptor;
        colors.push(ProtectedColor {
            r: selected.r,
            g: selected.g,
            b: selected.b,
            count: best_coverage as u32,
        });
        for (index, sample) in samples.iter().enumerate() {
            if !covered[index] && matches(background, selected, sample.descriptor) {
                covered[index] = true;
                covered_count += 1;
            }
        }
        candidates[best_index].excluded = true;
    }
    let coverage = ((covered_count * 100) / samples.len()) as u8;
    let status = if coverage >= coverage_threshold {
        0
    } else if colors.len() < maximum_colors {
        2
    } else {
        1
    };
    ProtectionSelection {
        colors,
        coverage,
        status,
        sample_count: samples.len() as u32,
    }
}

fn filter_by_full_image(
    candidates: &mut [Candidate],
    background: Descriptor,
    original: &[u8],
    preview: &[u8],
    width: usize,
    height: usize,
) {
    let partial_pixels = preview
        .chunks_exact(4)
        .filter(|rgba| rgba[3] > 0 && rgba[3] < 255)
        .count();
    let step = if partial_pixels > 200_000 { 2 } else { 1 };
    for candidate in candidates
        .iter_mut()
        .filter(|candidate| !candidate.excluded)
    {
        let mut match_count = 0_usize;
        for y in (0..height).step_by(step) {
            for x in (0..width).step_by(step) {
                let offset = (y * width + x) * 4;
                if preview[offset + 3] == 0 || preview[offset + 3] == 255 {
                    continue;
                }
                let pixel =
                    descriptor(original[offset], original[offset + 1], original[offset + 2]);
                if matches(background, candidate.sample.descriptor, pixel) {
                    match_count += 1;
                }
            }
        }
        candidate.full_coverage = (match_count * step * step) as f64 / (width * height) as f64;
    }
    let visible = candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| !candidate.excluded)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if visible
        .iter()
        .filter(|index| candidates[**index].full_coverage >= 0.0005)
        .count()
        >= 2
    {
        for index in visible {
            if candidates[index].full_coverage < 0.0005 {
                candidates[index].excluded = true;
            }
        }
        return;
    }
    let mut retained = visible.clone();
    retained.sort_by(|left, right| {
        total_cmp(
            candidates[*right].full_coverage,
            candidates[*left].full_coverage,
        )
    });
    retained.truncate(2);
    for index in visible {
        if !retained.contains(&index) {
            candidates[index].excluded = true;
        }
    }
}

/// Fills a reusable one-byte directional protection mask for at most 32 colors.
///
/// Returns `false` and clears the output when no protection colors are supplied.
/// Reusing the caller-owned buffer avoids allocating one pixel-sized mask for
/// every preview and exported frame.
pub(crate) fn fill_protection_mask(
    source: &[u8],
    background: [u8; 3],
    colors: &[[u8; 3]],
    result: &mut Vec<u8>,
) -> bool {
    if colors.is_empty() {
        result.clear();
        return false;
    }
    let background = descriptor(background[0], background[1], background[2]);
    let candidates = colors
        .iter()
        .take(32)
        .map(|color| descriptor(color[0], color[1], color[2]))
        .collect::<Vec<_>>();
    result.resize(source.len() / 4, 0);
    result.fill(0);
    for (pixel, rgba) in source.chunks_exact(4).enumerate() {
        if rgba[3] == 0 {
            continue;
        }
        let value = descriptor(rgba[0], rgba[1], rgba[2]);
        if candidates
            .iter()
            .any(|candidate| matches(background, *candidate, value))
        {
            result[pixel] = 1;
        }
    }
    true
}

fn append_group_candidates(
    all_samples: &[Sample],
    group: &[Sample],
    background: Descriptor,
    candidates: &mut Vec<Candidate>,
) {
    let mut selected = Vec::<Sample>::new();
    if group.len() < 5 {
        let representative = group
            .iter()
            .max_by(|left, right| {
                total_cmp(left.weight, right.weight)
                    .then_with(|| total_cmp(right.descriptor.y, left.descriptor.y))
                    .then_with(|| total_cmp(left.radius_squared, right.radius_squared))
            })
            .expect("non-empty direction group");
        let chosen = group
            .iter()
            .filter(|sample| sample.bucket == representative.bucket)
            .min_by(|left, right| {
                (left.descriptor.r, left.descriptor.g, left.descriptor.b).cmp(&(
                    right.descriptor.r,
                    right.descriptor.g,
                    right.descriptor.b,
                ))
            })
            .expect("representative bucket");
        selected.push(chosen.clone());
    } else {
        let minimum_weight = group
            .iter()
            .map(|value| value.weight)
            .fold(f64::INFINITY, f64::min);
        let maximum_weight = group
            .iter()
            .map(|value| value.weight)
            .fold(f64::NEG_INFINITY, f64::max);
        if maximum_weight < minimum_weight * 3.0 {
            let mut by_lightness = group.to_vec();
            by_lightness.sort_by(|left, right| {
                total_cmp(left.descriptor.y, right.descriptor.y)
                    .then_with(|| total_cmp(right.radius_squared, left.radius_squared))
            });
            let neighborhood = (group.len() / 6).max(1);
            for quantile in [0.25_f64, 0.5, 0.75] {
                let center =
                    (((group.len() - 1) as f64 * quantile).trunc() as usize).min(group.len() - 1);
                let start = center.saturating_sub(neighborhood);
                let end = center.saturating_add(neighborhood).min(group.len() - 1);
                let mut representative = by_lightness[center].clone();
                for sample in &by_lightness[start..=end] {
                    if sample.weight > representative.weight {
                        representative = sample.clone();
                    }
                }
                selected.push(representative);
            }
        } else {
            let mut by_weight = group.to_vec();
            by_weight.sort_by(|left, right| {
                total_cmp(right.weight, left.weight)
                    .then_with(|| total_cmp(left.descriptor.y, right.descriptor.y))
                    .then_with(|| total_cmp(right.radius_squared, left.radius_squared))
            });
            selected.push(by_weight[0].clone());
            if let Some(separated) = by_weight
                .iter()
                .find(|sample| (sample.descriptor.y - by_weight[0].descriptor.y).abs() >= 15.0)
            {
                selected.push(separated.clone());
            }
        }
    }
    let global_coverage = |sample: &Sample| {
        all_samples
            .iter()
            .filter(|value| matches(background, sample.descriptor, value.descriptor))
            .count()
    };
    let mut best_coverage = selected
        .iter()
        .map(|sample| global_coverage(sample))
        .max()
        .unwrap_or(0);
    let mut best_radius = f64::INFINITY;
    let mut medoid = None;
    for sample in group {
        let coverage = global_coverage(sample);
        let separated = selected
            .iter()
            .filter(|candidate| global_coverage(candidate) == best_coverage)
            .all(|candidate| (candidate.descriptor.y - sample.descriptor.y).abs() >= 15.0);
        if coverage > best_coverage
            || (coverage == best_coverage
                && separated
                && (medoid.is_none() || sample.radius_squared < best_radius))
        {
            medoid = Some(sample.clone());
            best_coverage = coverage;
            best_radius = sample.radius_squared;
        }
    }
    if let Some(medoid) = medoid {
        selected.insert(0, medoid);
    }
    for sample in selected {
        let aligned = !sample.descriptor.achromatic
            && sample.descriptor.chroma >= 3.0
            && direction_dot(sample.descriptor, background) >= 0.9;
        candidates.push(Candidate {
            sample,
            excluded: aligned,
            full_coverage: 0.0,
        });
    }
}

fn descriptor(r: u8, g: u8, b: u8) -> Descriptor {
    let y = r as f64 * 0.299 + g as f64 * 0.587 + b as f64 * 0.114;
    let centered_cb = r as f64 * -0.168736 + g as f64 * -0.331264 + b as f64 * 0.5;
    let centered_cr = r as f64 * 0.5 + g as f64 * -0.418688 + b as f64 * -0.081312;
    let chroma = centered_cb.hypot(centered_cr);
    Descriptor {
        r,
        g,
        b,
        y,
        chroma,
        dir_cb: if chroma < 3.0 {
            0.0
        } else {
            centered_cb / chroma
        },
        dir_cr: if chroma < 3.0 {
            0.0
        } else {
            centered_cr / chroma
        },
        achromatic: chroma < 3.0,
    }
}

fn direction_dot(left: Descriptor, right: Descriptor) -> f64 {
    left.dir_cb * right.dir_cb + left.dir_cr * right.dir_cr
}

fn matches(background: Descriptor, candidate: Descriptor, pixel: Descriptor) -> bool {
    let red_delta = pixel.r as f64 - candidate.r as f64;
    let green_delta = pixel.g as f64 - candidate.g as f64;
    let blue_delta = pixel.b as f64 - candidate.b as f64;
    let direct_distance_squared =
        red_delta * red_delta + green_delta * green_delta + blue_delta * blue_delta;
    if pixel.achromatic {
        return candidate.achromatic && direct_distance_squared < 145.0;
    }
    if candidate.achromatic {
        let candidate_linear = [
            linear(candidate.r),
            linear(candidate.g),
            linear(candidate.b),
        ];
        let background_linear = [
            linear(background.r),
            linear(background.g),
            linear(background.b),
        ];
        let pixel_linear = [linear(pixel.r), linear(pixel.g), linear(pixel.b)];
        let axis = [
            background_linear[0] - candidate_linear[0],
            background_linear[1] - candidate_linear[1],
            background_linear[2] - candidate_linear[2],
        ];
        let length = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
        if length < 0.0001 {
            return false;
        }
        let projection = ((pixel_linear[0] - candidate_linear[0]) * axis[0]
            + (pixel_linear[1] - candidate_linear[1]) * axis[1]
            + (pixel_linear[2] - candidate_linear[2]) * axis[2])
            / length;
        return projection <= 0.1 && direct_distance_squared < 301.0;
    }
    let direction = direction_dot(pixel, candidate);
    if direction < 0.9 {
        return false;
    }
    if direction >= 0.97
        && (pixel.y - candidate.y).abs() <= 5.0
        && (pixel.chroma - candidate.chroma).abs() <= 8.0
    {
        return true;
    }
    let cross_axis = background.chroma
        * (background.dir_cb * candidate.dir_cr - background.dir_cr * candidate.dir_cb);
    if cross_axis.abs() < 1.0 {
        return false;
    }
    let chroma_position = pixel.chroma
        * (pixel.dir_cb * candidate.dir_cr - pixel.dir_cr * candidate.dir_cb)
        / cross_axis;
    if pixel.chroma > candidate.chroma * 1.3 {
        return false;
    }
    let lightness_axis = background.y - candidate.y;
    if lightness_axis.abs() > 2.0
        && chroma_position + 0.2 < (pixel.y - candidate.y) / lightness_axis
    {
        return false;
    }
    chroma_position <= 0.1
}

fn linear(channel: u8) -> f64 {
    let value = channel as f64 / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn total_cmp(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::select;

    #[test]
    fn fp_kernel_14_empty_partial_alpha_set_is_complete() {
        let source = [0, 255, 0, 255];
        let preview = [0, 255, 0, 255];
        let result = select(&source, Some(&preview), 1, 1, [0, 255, 0], 5, 95, &[], None);
        assert_eq!(result.coverage, 100);
        assert_eq!(result.status, 0);
        assert!(result.colors.is_empty());
    }
}
