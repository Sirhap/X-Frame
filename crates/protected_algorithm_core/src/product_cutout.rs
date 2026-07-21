//! Product-level color replacement and connected selection repair pipeline.

use crate::protection;

/// Fixed byte size of [`CutoutConfiguration`]'s external representation.
pub(crate) const CONFIG_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Color {
    pub(crate) r: u8,
    pub(crate) g: u8,
    pub(crate) b: u8,
    pub(crate) a: u8,
}

/// Validated product pipeline configuration.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CutoutConfiguration {
    pub(crate) connected: bool,
    pub(crate) blend_mode: u8,
    pub(crate) edge_mode: u8,
    pub(crate) explicit_reference: bool,
    pub(crate) explicit_despill: bool,
    pub(crate) alpha_high: u8,
    pub(crate) alpha_low: u8,
    pub(crate) seed_x: i32,
    pub(crate) seed_y: i32,
    pub(crate) reference: Color,
    pub(crate) replacement: Color,
    pub(crate) despill: Color,
    pub(crate) tolerance: i32,
    pub(crate) edge_enhance: i32,
    pub(crate) blend_strength: i32,
    pub(crate) despill_strength: i32,
    pub(crate) edge_radius: usize,
}

/// Parses the stable 64-byte product configuration record.
pub(crate) fn parse_configuration(bytes: &[u8]) -> Option<CutoutConfiguration> {
    if bytes.len() != CONFIG_BYTES || bytes[0] != 1 || bytes[1] > 1 || bytes[2] > 3 || bytes[3] > 2
    {
        return None;
    }
    let i32_at = |offset: usize| {
        i32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .expect("validated record width"),
        )
    };
    Some(CutoutConfiguration {
        connected: bytes[1] == 1,
        blend_mode: bytes[2],
        edge_mode: bytes[3],
        explicit_reference: bytes[4] & 1 != 0,
        explicit_despill: bytes[4] & 2 != 0,
        alpha_high: bytes[6],
        alpha_low: bytes[7],
        seed_x: i32_at(8),
        seed_y: i32_at(12),
        reference: Color {
            r: bytes[16],
            g: bytes[17],
            b: bytes[18],
            a: bytes[19],
        },
        replacement: Color {
            r: bytes[20],
            g: bytes[21],
            b: bytes[22],
            a: bytes[23],
        },
        despill: Color {
            r: bytes[24],
            g: bytes[25],
            b: bytes[26],
            a: 255,
        },
        tolerance: i32_at(28),
        edge_enhance: i32_at(32),
        blend_strength: i32_at(36),
        despill_strength: i32_at(40),
        edge_radius: usize::try_from(i32_at(44)).ok()?,
    })
}

/// Applies global color replacement or connected selection repair as one pipeline.
pub(crate) fn apply(
    source: &[u8],
    width: usize,
    height: usize,
    operation_mask: Option<&[u8]>,
    protected_colors: &[[u8; 3]],
    mut configuration: CutoutConfiguration,
) -> Vec<u8> {
    let pixel_count = width * height;
    if configuration.seed_x < 0
        || configuration.seed_y < 0
        || configuration.seed_x as usize >= width
        || configuration.seed_y as usize >= height
    {
        return source.to_vec();
    }
    if !configuration.explicit_reference {
        let offset = (configuration.seed_y as usize * width + configuration.seed_x as usize) * 4;
        configuration.reference = Color {
            r: source[offset],
            g: source[offset + 1],
            b: source[offset + 2],
            a: source[offset + 3],
        };
    }
    if configuration.reference == configuration.replacement {
        return source.to_vec();
    }
    let threshold = threshold_squared(configuration.tolerance);
    let selected = if configuration.connected {
        connected_candidates(
            source,
            width,
            height,
            operation_mask,
            configuration.seed_x,
            configuration.seed_y,
            configuration.reference,
            threshold,
        )
    } else {
        expanded_candidates(
            source,
            width,
            height,
            operation_mask,
            configuration.reference,
            configuration.tolerance,
            configuration.edge_enhance,
        )
    };
    let protected = if configuration.connected {
        None
    } else {
        protection::protection_mask(
            source,
            [
                configuration.reference.r,
                configuration.reference.g,
                configuration.reference.b,
            ],
            protected_colors,
        )
    };
    let mut output = source.to_vec();
    for pixel in 0..pixel_count {
        if selected[pixel] == 0
            || operation_mask.is_some_and(|mask| mask[pixel] != 255)
            || protected.as_ref().is_some_and(|mask| mask[pixel] != 0)
        {
            continue;
        }
        let offset = pixel * 4;
        output[offset..offset + 4].copy_from_slice(&[
            configuration.replacement.r,
            configuration.replacement.g,
            configuration.replacement.b,
            configuration.replacement.a,
        ]);
    }
    blend_recovery(
        &mut output,
        source,
        &selected,
        operation_mask,
        protected.as_deref(),
        configuration,
    );
    if !configuration.connected {
        alpha_thresholds(
            &mut output,
            operation_mask,
            configuration.alpha_high,
            configuration.alpha_low,
        );
    }
    restore_edges(
        &mut output,
        source,
        width,
        height,
        &selected,
        operation_mask,
        protected.as_deref(),
        configuration,
        threshold,
    );
    let despill_reference = if configuration.explicit_despill {
        configuration.despill
    } else {
        configuration.reference
    };
    if !configuration.connected {
        directional_despill(
            &mut output,
            &selected,
            operation_mask,
            protected.as_deref(),
            despill_reference,
            configuration.despill_strength,
        );
    }
    if let Some(mask) = protected {
        for pixel in 0..pixel_count {
            if mask[pixel] == 0 {
                continue;
            }
            let offset = pixel * 4;
            output[offset..offset + 4].copy_from_slice(&source[offset..offset + 4]);
        }
    }
    output
}

fn threshold_squared(tolerance: i32) -> i32 {
    ((tolerance as f64 * 5.1).powi(2) + 0.5)
        .trunc()
        .clamp(0.0, i32::MAX as f64) as i32
}

fn rgba_matches(source: &[u8], pixel: usize, reference: Color, threshold: i32) -> bool {
    let offset = pixel * 4;
    let values = [reference.r, reference.g, reference.b, reference.a];
    let mut distance = 0_i32;
    for channel in 0..4 {
        let delta = source[offset + channel] as i32 - values[channel] as i32;
        distance += delta * delta;
    }
    distance <= threshold
}

fn expanded_candidates(
    source: &[u8],
    width: usize,
    height: usize,
    mask: Option<&[u8]>,
    reference: Color,
    tolerance: i32,
    edge_enhance: i32,
) -> Vec<u8> {
    let count = width * height;
    let mut candidates = vec![0_u8; count];
    let mut selected = vec![0_u8; count];
    if tolerance < 0 {
        return selected;
    }
    let effective = ((100 - tolerance).max(0) * edge_enhance) as f64 / 100.0 + tolerance as f64;
    let base_threshold = threshold_squared(tolerance);
    let enhanced_threshold = (effective * 5.1)
        .mul_add(effective * 5.1, 0.5)
        .trunc()
        .clamp(0.0, i32::MAX as f64) as i32;
    let mut queue = Vec::<u32>::with_capacity(count);
    for pixel in 0..count {
        if mask.is_some_and(|value| value[pixel] != 255)
            || !rgba_matches(source, pixel, reference, enhanced_threshold)
        {
            continue;
        }
        candidates[pixel] = 1;
        if rgba_matches(source, pixel, reference, base_threshold) {
            selected[pixel] = 1;
            queue.push(pixel as u32);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let pixel = queue[head] as usize;
        head += 1;
        let x = pixel % width;
        let neighbors = [
            if x > 0 { Some(pixel - 1) } else { None },
            if x + 1 < width { Some(pixel + 1) } else { None },
            if pixel >= width {
                Some(pixel - width)
            } else {
                None
            },
            if pixel + width < count {
                Some(pixel + width)
            } else {
                None
            },
        ];
        for neighbor in neighbors.into_iter().flatten() {
            if candidates[neighbor] != 0 && selected[neighbor] == 0 {
                selected[neighbor] = 1;
                queue.push(neighbor as u32);
            }
        }
    }
    selected
}

fn connected_candidates(
    source: &[u8],
    width: usize,
    height: usize,
    mask: Option<&[u8]>,
    seed_x: i32,
    seed_y: i32,
    reference: Color,
    threshold: i32,
) -> Vec<u8> {
    let count = width * height;
    let mut selected = vec![0_u8; count];
    if seed_x < 0 || seed_y < 0 || seed_x as usize >= width || seed_y as usize >= height {
        return selected;
    }
    let seed = seed_y as usize * width + seed_x as usize;
    if mask.is_some_and(|value| value[seed] != 255)
        || !rgba_matches(source, seed, reference, threshold)
    {
        return selected;
    }
    let mut stack = vec![seed];
    selected[seed] = 1;
    while let Some(pixel) = stack.pop() {
        let x = pixel % width;
        let neighbors = [
            if x > 0 { Some(pixel - 1) } else { None },
            if x + 1 < width { Some(pixel + 1) } else { None },
            if pixel >= width {
                Some(pixel - width)
            } else {
                None
            },
            if pixel + width < count {
                Some(pixel + width)
            } else {
                None
            },
        ];
        for neighbor in neighbors.into_iter().flatten() {
            if selected[neighbor] != 0
                || mask.is_some_and(|value| value[neighbor] != 255)
                || !rgba_matches(source, neighbor, reference, threshold)
            {
                continue;
            }
            selected[neighbor] = 1;
            stack.push(neighbor);
        }
    }
    selected
}

fn alpha_thresholds(output: &mut [u8], mask: Option<&[u8]>, high: u8, low: u8) {
    if (high == 0 && low == 0) || high < low || (low == 0 && high == 255) {
        return;
    }
    for pixel in 0..output.len() / 4 {
        if mask.is_some_and(|value| value[pixel] != 255) {
            continue;
        }
        let alpha = &mut output[pixel * 4 + 3];
        if high != 0 && *alpha > high {
            *alpha = 255;
        } else if low != 0 && *alpha < low {
            *alpha = 0;
        }
    }
}

#[derive(Clone, Copy)]
struct BlendConfiguration {
    strength: f64,
    replacement_alpha: f64,
    replacement_alpha_byte: u8,
    reference_alpha_byte: u8,
    replacement_linear: [f64; 3],
    reference_linear: [f64; 3],
    axis: [f64; 3],
    axis_length: f64,
    replacement_cb: f64,
    replacement_cr: f64,
    reference_chroma: f64,
    direction_cb: f64,
    direction_cr: f64,
}

#[derive(Clone, Copy)]
struct Recovery {
    valid: bool,
    linear: [f64; 3],
    alpha: f64,
    confidence: f64,
    magnitude: f64,
    ratio: f64,
    fallback: f64,
}

fn blend_configuration(configuration: CutoutConfiguration) -> BlendConfiguration {
    let fallback = if configuration.explicit_despill
        && (configuration.despill.r != 0
            || configuration.despill.g != 0
            || configuration.despill.b != 0)
    {
        configuration.despill
    } else {
        configuration.reference
    };
    let replacement_linear = rgb_linear(configuration.replacement);
    let reference_linear = rgb_linear(fallback);
    let axis = subtract(reference_linear, replacement_linear);
    let axis_length = dot(axis, axis);
    let replacement_ycbcr = ycbcr(configuration.replacement);
    let reference_ycbcr = ycbcr(fallback);
    let cb = reference_ycbcr.1 - 128.0;
    let cr = reference_ycbcr.2 - 128.0;
    let chroma = cb.hypot(cr);
    BlendConfiguration {
        strength: configuration.blend_strength.clamp(0, 100) as f64 / 100.0,
        replacement_alpha: configuration.replacement.a as f64 / 255.0,
        replacement_alpha_byte: configuration.replacement.a,
        reference_alpha_byte: configuration.reference.a,
        replacement_linear,
        reference_linear,
        axis,
        axis_length,
        replacement_cb: replacement_ycbcr.1,
        replacement_cr: replacement_ycbcr.2,
        reference_chroma: chroma,
        direction_cb: if chroma >= 5.0 { cb / chroma } else { 0.0 },
        direction_cr: if chroma >= 5.0 { cr / chroma } else { 0.0 },
    }
}

fn linear_recovery(config: BlendConfiguration, color: Color, auxiliary: bool) -> Recovery {
    if color.a == 0 {
        return invalid_recovery();
    }
    if config.axis_length < 0.0001 {
        let converted = ycbcr(color);
        let cb = converted.1 - 128.0;
        let cr = converted.2 - 128.0;
        if cb * cb + cr * cr < 9.0 {
            return invalid_recovery();
        }
        let projection = cb * config.direction_cb + cr * config.direction_cr;
        if projection <= 0.0 {
            return invalid_recovery();
        }
        let recovered = ycbcr_to_rgb(
            converted.0,
            cb - config.strength * projection * config.direction_cb + 128.0,
            cr - config.strength * projection * config.direction_cr + 128.0,
        );
        return Recovery {
            valid: true,
            linear: rgb_linear(recovered),
            alpha: color.a as f64 / 255.0,
            confidence: if auxiliary { 1.0 } else { 0.0 },
            magnitude: 0.0,
            ratio: 0.0,
            fallback: 0.0,
        };
    }
    let pixel = rgb_linear(color);
    let relative = subtract(pixel, config.replacement_linear);
    let projection = dot(relative, config.axis) / config.axis_length;
    if projection <= 0.01 {
        return invalid_recovery();
    }
    let residual = subtract(relative, scale(config.axis, projection));
    let half = config.axis_length * 0.5;
    let residual_squared = dot(residual, residual);
    if residual_squared >= half {
        return invalid_recovery();
    }
    let confidence = 1.0 - residual_squared / half;
    if confidence <= 0.0 {
        return invalid_recovery();
    }
    let magnitude = projection.min(1.0) * confidence;
    let color_strength = (config.strength * magnitude).sqrt();
    let converted = ycbcr(color);
    let recovered = ycbcr_to_rgb(
        converted.0,
        converted.1 + color_strength * (config.replacement_cb - converted.1),
        converted.2 + color_strength * (config.replacement_cr - converted.2),
    );
    Recovery {
        valid: true,
        linear: rgb_linear(recovered),
        alpha: (config.strength
            * magnitude
            * (config.replacement_alpha_byte as f64 - config.reference_alpha_byte as f64)
            + color.a as f64)
            / 255.0,
        confidence: if auxiliary { confidence } else { 0.0 },
        magnitude: if auxiliary { magnitude } else { 0.0 },
        ratio: 0.0,
        fallback: 0.0,
    }
}

fn composite_recovery(config: BlendConfiguration, color: Color, auxiliary: bool) -> Recovery {
    if color.a == 0 {
        return invalid_recovery();
    }
    let converted = ycbcr(color);
    let cb = converted.1 - 128.0;
    let cr = converted.2 - 128.0;
    let chroma = cb.hypot(cr);
    let chroma_ratio = chroma / config.reference_chroma;
    let chroma_confidence = if chroma_ratio <= 0.05 {
        0.0
    } else if chroma_ratio >= 0.2 {
        1.0
    } else {
        (chroma_ratio - 0.05) / 0.15
    };
    let direction = cb * config.direction_cb + cr * config.direction_cr;
    if chroma < 3.0 || direction <= 0.0 {
        if chroma < 3.0 {
            return invalid_recovery();
        }
        return Recovery {
            valid: true,
            linear: rgb_linear(color),
            alpha: color.a as f64 / 255.0,
            confidence: if auxiliary { chroma_confidence } else { 0.0 },
            magnitude: 0.0,
            ratio: 0.0,
            fallback: if auxiliary { 1.0 } else { 0.0 },
        };
    }
    let ratio = (direction / config.reference_chroma).clamp(0.0, 0.95);
    let amount = config.strength * ratio;
    let alpha = 1.0 - ratio * config.strength * (1.0 - config.replacement_alpha);
    let pixel = rgb_linear(color);
    let mut recovered = [0.0; 3];
    if alpha > 0.02 {
        for channel in 0..3 {
            recovered[channel] = (amount
                * (config.replacement_alpha * config.replacement_linear[channel]
                    - config.reference_linear[channel])
                + pixel[channel])
                / alpha;
        }
    }
    let negative = recovered
        .iter()
        .map(|value| if *value < 0.0 { -*value } else { 0.0 })
        .sum::<f64>();
    let gamut = if negative >= 0.1 {
        0.0
    } else {
        1.0 - negative / 0.1
    };
    let saturation = if ratio > 0.6 {
        ((ratio - 0.6) / 0.35).min(1.0)
    } else {
        0.0
    };
    Recovery {
        valid: true,
        linear: recovered,
        alpha,
        confidence: if auxiliary {
            chroma_confidence * gamut * (1.0 - saturation * 0.5)
        } else {
            0.0
        },
        magnitude: 0.0,
        ratio: if auxiliary { ratio } else { 0.0 },
        fallback: 0.0,
    }
}

fn blend_recovery(
    output: &mut [u8],
    source: &[u8],
    selected: &[u8],
    mask: Option<&[u8]>,
    protected: Option<&[u8]>,
    configuration: CutoutConfiguration,
) {
    if configuration.blend_strength.clamp(0, 100) == 0 {
        return;
    }
    let config = blend_configuration(configuration);
    for pixel in 0..selected.len() {
        if selected[pixel] != 0
            || mask.is_some_and(|value| value[pixel] != 255)
            || protected.is_some_and(|value| value[pixel] != 0)
        {
            continue;
        }
        let offset = pixel * 4;
        let color = Color {
            r: source[offset],
            g: source[offset + 1],
            b: source[offset + 2],
            a: source[offset + 3],
        };
        let recovered = if configuration.blend_mode == 1 {
            composite_recovery(config, color, false)
        } else if configuration.blend_mode == 2 {
            merge_recovery(
                linear_recovery(config, color, true),
                composite_recovery(config, color, true),
            )
        } else {
            linear_recovery(config, color, false)
        };
        if !recovered.valid {
            continue;
        }
        output[offset] = linear_to_byte(recovered.linear[0]);
        output[offset + 1] = linear_to_byte(recovered.linear[1]);
        output[offset + 2] = linear_to_byte(recovered.linear[2]);
        output[offset + 3] = (recovered.alpha * 255.0 + 0.5).trunc().clamp(0.0, 255.0) as u8;
    }
}

fn merge_recovery(linear: Recovery, composite: Recovery) -> Recovery {
    if !linear.valid {
        return composite;
    }
    if !composite.valid {
        return linear;
    }
    if linear.confidence < 0.1 && composite.confidence < 0.1 {
        return linear;
    }
    if linear.confidence < 0.1 {
        return composite;
    }
    if composite.confidence < 0.1 {
        return linear;
    }
    let inverse = 1.0 - composite.ratio;
    let ratio_weight = if inverse <= 0.15 {
        0.0
    } else if inverse >= 0.4 {
        1.0
    } else {
        (inverse - 0.15) * 4.0
    };
    let delta = linear.magnitude - composite.ratio;
    let abs_delta = delta.abs();
    let delta_weight = if abs_delta <= 0.25 {
        1.0
    } else if abs_delta >= 0.6 {
        0.0
    } else {
        1.0 - (abs_delta - 0.25) / 0.35
    };
    let adjusted = linear.confidence + (1.0 - ratio_weight) * 0.15;
    let share = adjusted / (composite.confidence + adjusted + 0.000001);
    let direction_gate = if composite.fallback > 0.0 && delta > 0.0 {
        1.0
    } else if delta > 0.3 {
        if delta >= 0.5 {
            1.0
        } else {
            (delta - 0.3) / 0.2
        }
    } else {
        0.0
    };
    let confidence_bias = if composite.confidence <= linear.confidence {
        1.0
    } else {
        0.0
    };
    let preliminary =
        share * (delta_weight * 0.5 + 0.5) + confidence_bias * (delta_weight * -0.5 + 0.5);
    let suppression = composite.confidence * ratio_weight * direction_gate;
    let linear_weight = preliminary * (1.0 - suppression);
    let result_linear = [0, 1, 2].map(|channel| {
        linear_weight * linear.linear[channel] + (1.0 - linear_weight) * composite.linear[channel]
    });
    let alpha = if suppression > 0.5 {
        composite.alpha
    } else {
        let weight = ((1.0 - ratio_weight) * (1.0 - share) + share) * (1.0 - suppression);
        if delta_weight > 0.5 {
            weight * linear.alpha + (1.0 - weight) * composite.alpha
        } else {
            (if weight >= 0.5 {
                linear.alpha
            } else {
                composite.alpha
            }) * 0.6
                + linear.alpha.min(composite.alpha) * 0.4
        }
    };
    Recovery {
        valid: true,
        linear: result_linear,
        alpha,
        confidence: 0.0,
        magnitude: 0.0,
        ratio: 0.0,
        fallback: 0.0,
    }
}

fn directional_despill(
    output: &mut [u8],
    selected: &[u8],
    mask: Option<&[u8]>,
    protected: Option<&[u8]>,
    reference: Color,
    strength: i32,
) {
    let strength = strength.clamp(0, 100) as f64 / 100.0;
    if strength == 0.0 {
        return;
    }
    let converted = ycbcr(reference);
    let cb = converted.1 - 128.0;
    let cr = converted.2 - 128.0;
    let chroma = cb.hypot(cr);
    if chroma < 5.0 {
        return;
    }
    let direction_cb = cb / chroma;
    let direction_cr = cr / chroma;
    for pixel in 0..selected.len() {
        if selected[pixel] != 0
            || mask.is_some_and(|value| value[pixel] != 255)
            || protected.is_some_and(|value| value[pixel] != 0)
        {
            continue;
        }
        let offset = pixel * 4;
        if output[offset + 3] == 0 {
            continue;
        }
        let color = Color {
            r: output[offset],
            g: output[offset + 1],
            b: output[offset + 2],
            a: output[offset + 3],
        };
        let converted = ycbcr(color);
        let cb = converted.1 - 128.0;
        let cr = converted.2 - 128.0;
        if cb.hypot(cr) < 3.0 {
            continue;
        }
        let projection = cb * direction_cb + cr * direction_cr;
        if projection <= 0.0 {
            continue;
        }
        let recovered = ycbcr_to_rgb(
            converted.0,
            cb - projection * strength * direction_cb + 128.0,
            cr - projection * strength * direction_cr + 128.0,
        );
        output[offset] = recovered.r;
        output[offset + 1] = recovered.g;
        output[offset + 2] = recovered.b;
    }
}

fn invalid_recovery() -> Recovery {
    Recovery {
        valid: false,
        linear: [0.0; 3],
        alpha: 0.0,
        confidence: 0.0,
        magnitude: 0.0,
        ratio: 0.0,
        fallback: 0.0,
    }
}
fn ycbcr(color: Color) -> (f64, f64, f64) {
    (
        color.r as f64 * 0.299 + color.g as f64 * 0.587 + color.b as f64 * 0.114,
        color.r as f64 * -0.168736 + color.g as f64 * -0.331264 + color.b as f64 * 0.5 + 128.0,
        color.r as f64 * 0.5 + color.g as f64 * -0.418688 + color.b as f64 * -0.081312 + 128.0,
    )
}
fn ycbcr_to_rgb(y: f64, cb: f64, cr: f64) -> Color {
    let cb = cb - 128.0;
    let cr = cr - 128.0;
    Color {
        r: (y + cr * 1.402).round().clamp(0.0, 255.0) as u8,
        g: (y - cb * 0.344136 - cr * 0.714136)
            .round()
            .clamp(0.0, 255.0) as u8,
        b: (y + cb * 1.772).round().clamp(0.0, 255.0) as u8,
        a: 255,
    }
}
fn linear(value: u8) -> f64 {
    let value = value as f64 / 255.0;
    (if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }) as f32 as f64
}
fn linear_to_byte(value: f64) -> u8 {
    if value <= 0.0 {
        0
    } else if value >= 1.0 {
        255
    } else {
        let encoded = if value <= 0.003131 {
            value * 12.92
        } else {
            value.powf(1.0 / 2.4) * 1.055 - 0.055
        };
        (encoded * 255.0 + 0.5).trunc().clamp(0.0, 255.0) as u8
    }
}
fn rgb_linear(color: Color) -> [f64; 3] {
    [linear(color.r), linear(color.g), linear(color.b)]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn subtract(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: [f64; 3], factor: f64) -> [f64; 3] {
    [a[0] * factor, a[1] * factor, a[2] * factor]
}

// Kept separate because the three edge modes are shared by global and connected product paths.
fn restore_edges(
    output: &mut [u8],
    _source: &[u8],
    width: usize,
    height: usize,
    selected: &[u8],
    _mask: Option<&[u8]>,
    _protected: Option<&[u8]>,
    configuration: CutoutConfiguration,
    threshold: i32,
) {
    let radius = configuration.edge_radius.min(600);
    if radius == 0 {
        return;
    }
    let count = width * height;
    let original = output.to_vec();
    let mut visited = vec![0u8; count];
    let mut frontier = vec![0u8; count];
    for pixel in 0..count {
        if selected[pixel] != 1 {
            continue;
        }
        let x = pixel % width;
        let y = pixel / width;
        if (x > 0 && selected[pixel - 1] == 0)
            || (x + 1 < width && selected[pixel + 1] == 0)
            || (y > 0 && selected[pixel - width] == 0)
            || (y + 1 < height && selected[pixel + width] == 0)
        {
            frontier[pixel] = 1;
        }
    }
    let reference_linear = rgb_linear(configuration.reference);
    let replacement_linear = rgb_linear(configuration.replacement);
    let axis = subtract(reference_linear, replacement_linear);
    let axis_length = dot(axis, axis);
    let replacement_ycbcr = ycbcr(configuration.replacement);
    let alpha_delta = configuration.replacement.a as f64 - configuration.reference.a as f64;
    let expanded = (threshold.max(0) * 4).min(260100);
    let range = expanded - threshold.max(0);
    if configuration.edge_mode == 0 && range <= 0 {
        return;
    }
    if configuration.edge_mode != 0 && alpha_delta == 0.0 && axis_length < 0.0001 {
        return;
    }
    let mut minimum_alpha = configuration.replacement.a as i32;
    let mut maximum_alpha = configuration.replacement.a as i32;
    for layer in 1..=radius {
        let mut next = vec![0u8; count];
        for pixel in 0..count {
            if frontier[pixel] == 0 {
                continue;
            }
            let x = pixel % width;
            let neighbors = [
                if x > 0 { Some(pixel - 1) } else { None },
                if x + 1 < width { Some(pixel + 1) } else { None },
                if pixel >= width {
                    Some(pixel - width)
                } else {
                    None
                },
                if pixel + width < count {
                    Some(pixel + width)
                } else {
                    None
                },
            ];
            for neighbor in neighbors.into_iter().flatten() {
                if selected[neighbor] == 0 && visited[neighbor] == 0 {
                    next[neighbor] = 1;
                }
            }
        }
        if !next.iter().any(|v| *v != 0) {
            break;
        }
        let layer_weight = 1.0 - (layer - 1) as f64 / radius as f64;
        let mut changed = false;
        let mut alpha_total = 0i64;
        let mut alpha_count = 0i64;
        for pixel in 0..count {
            if next[pixel] == 0 {
                continue;
            }
            visited[pixel] = 1;
            let offset = pixel * 4;
            if configuration.edge_mode == 0 {
                let dr = original[offset] as i32 - configuration.reference.r as i32;
                let dg = original[offset + 1] as i32 - configuration.reference.g as i32;
                let db = original[offset + 2] as i32 - configuration.reference.b as i32;
                let distance = dr * dr + dg * dg + db * db;
                if distance > expanded {
                    continue;
                }
                let tolerance_weight = if distance > threshold {
                    1.0 - (distance - threshold) as f64 / range as f64
                } else {
                    1.0
                };
                let influence = tolerance_weight
                    * (1.0 - (layer as f64 - 0.5) / radius as f64)
                    * tolerance_weight;
                for channel in 0..4 {
                    let reference = [
                        configuration.reference.r,
                        configuration.reference.g,
                        configuration.reference.b,
                        configuration.reference.a,
                    ][channel] as f64;
                    let replacement = [
                        configuration.replacement.r,
                        configuration.replacement.g,
                        configuration.replacement.b,
                        configuration.replacement.a,
                    ][channel] as f64;
                    output[offset + channel] = (original[offset + channel] as f64
                        + (replacement - reference) * influence
                        + 0.5)
                        .trunc()
                        .clamp(0.0, 255.0) as u8;
                }
                changed = true;
                continue;
            }
            if axis_length < 0.0001 {
                let alpha = constrain_layer_alpha(
                    original[offset + 3] as f64 + layer_weight * alpha_delta,
                    alpha_delta,
                    minimum_alpha,
                    maximum_alpha,
                    output,
                    &visited,
                    width,
                    height,
                    pixel,
                    layer,
                    radius,
                );
                output[offset + 3] = alpha;
                changed = true;
            } else {
                let color = Color {
                    r: original[offset],
                    g: original[offset + 1],
                    b: original[offset + 2],
                    a: original[offset + 3],
                };
                let pixel_linear = rgb_linear(color);
                let relative = subtract(pixel_linear, replacement_linear);
                let projection = dot(relative, axis) / axis_length;
                let confidence = if projection <= 0.01 {
                    0.0
                } else if configuration.edge_mode == 2 {
                    1.0
                } else {
                    let residual = dot(
                        subtract(relative, scale(axis, projection)),
                        subtract(relative, scale(axis, projection)),
                    );
                    if residual < axis_length * 0.5 {
                        1.0 - residual / (axis_length * 0.5)
                    } else {
                        0.0
                    }
                };
                if confidence > 0.0 {
                    let magnitude = projection.min(1.0) * confidence;
                    if configuration.edge_mode == 2 {
                        let influence = layer_weight * projection.min(1.0).sqrt();
                        let converted = ycbcr(color);
                        let recovered = ycbcr_to_rgb(
                            converted.0,
                            converted.1 + influence * (replacement_ycbcr.1 - converted.1),
                            converted.2 + influence * (replacement_ycbcr.2 - converted.2),
                        );
                        output[offset] = recovered.r;
                        output[offset + 1] = recovered.g;
                        output[offset + 2] = recovered.b;
                        let candidate = if projection < 0.3 {
                            255.0
                        } else {
                            original[offset + 3] as f64 + influence * alpha_delta
                        };
                        let alpha = constrain_layer_alpha(
                            candidate,
                            alpha_delta,
                            minimum_alpha,
                            maximum_alpha,
                            output,
                            &visited,
                            width,
                            height,
                            pixel,
                            layer,
                            radius,
                        );
                        output[offset + 3] = alpha;
                    } else {
                        let taper = if radius > 2 && layer as f64 > radius as f64 * 0.7 {
                            ((radius - layer) as f64 / (radius as f64 * 0.3)).clamp(0.2, 1.0)
                        } else {
                            1.0
                        };
                        for channel in 0..3 {
                            output[offset + channel] = linear_to_byte(
                                (pixel_linear[channel] - magnitude * taper * axis[channel])
                                    .clamp(0.0, 1.0),
                            );
                        }
                        let alpha = constrain_layer_alpha(
                            original[offset + 3] as f64 + layer_weight * magnitude * alpha_delta,
                            alpha_delta,
                            minimum_alpha,
                            maximum_alpha,
                            output,
                            &visited,
                            width,
                            height,
                            pixel,
                            layer,
                            radius,
                        );
                        output[offset + 3] = alpha;
                    }
                    changed = true;
                }
            }
            alpha_total += output[offset + 3] as i64;
            alpha_count += 1;
        }
        if configuration.edge_mode != 0 && alpha_count > 0 {
            let average = (alpha_total / alpha_count) as i32;
            if alpha_delta > 0.0 {
                maximum_alpha = maximum_alpha.min((maximum_alpha * 2 + average) / 3);
            } else if alpha_delta < 0.0 {
                minimum_alpha =
                    minimum_alpha.max((configuration.replacement.a as i32 * 2 + average) / 3);
            }
        }
        frontier = next;
        if configuration.edge_mode != 0 && !changed {
            break;
        }
    }
}

fn minimum_visited_neighbor_alpha(
    output: &[u8],
    visited: &[u8],
    width: usize,
    height: usize,
    pixel: usize,
) -> i32 {
    let x = pixel % width;
    let y = pixel / width;
    let mut minimum = 0i32;
    for offset_y in -1isize..=1 {
        for offset_x in -1isize..=1 {
            if offset_x == 0 && offset_y == 0 {
                continue;
            }
            let neighbor_x = x as isize + offset_x;
            let neighbor_y = y as isize + offset_y;
            if neighbor_x < 0
                || neighbor_y < 0
                || neighbor_x >= width as isize
                || neighbor_y >= height as isize
            {
                continue;
            }
            let neighbor = neighbor_y as usize * width + neighbor_x as usize;
            if visited[neighbor] == 0 {
                continue;
            }
            let alpha = output[neighbor * 4 + 3] as i32;
            if minimum == 0 || alpha < minimum {
                minimum = alpha;
            }
        }
    }
    minimum
}

#[allow(clippy::too_many_arguments)]
fn constrain_layer_alpha(
    candidate: f64,
    alpha_delta: f64,
    minimum_alpha: i32,
    maximum_alpha: i32,
    output: &[u8],
    visited: &[u8],
    width: usize,
    height: usize,
    pixel: usize,
    layer: usize,
    radius: usize,
) -> u8 {
    let mut alpha = (candidate + 0.5).trunc().clamp(0.0, 255.0) as i32;
    if alpha_delta > 0.0 {
        alpha = alpha.min(maximum_alpha);
    } else if alpha_delta < 0.0 {
        alpha = alpha.max(minimum_alpha);
        let neighbor = minimum_visited_neighbor_alpha(output, visited, width, height, pixel);
        if neighbor >= 241 {
            let recovered =
                (layer as f64 / radius as f64 * (255 - neighbor) as f64 + neighbor as f64 + 0.5)
                    .trunc() as i32;
            alpha = alpha.max(recovered);
        }
    }
    alpha as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fp_kernel_13_only_replaces_connected_component() {
        let source = [0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255];
        let configuration = CutoutConfiguration {
            connected: true,
            blend_mode: 0,
            edge_mode: 0,
            explicit_reference: true,
            explicit_despill: false,
            alpha_high: 0,
            alpha_low: 0,
            seed_x: 0,
            seed_y: 0,
            reference: Color {
                r: 0,
                g: 255,
                b: 0,
                a: 255,
            },
            replacement: Color {
                r: 0,
                g: 0,
                b: 0,
                a: 0,
            },
            despill: Color {
                r: 0,
                g: 0,
                b: 0,
                a: 255,
            },
            tolerance: 1,
            edge_enhance: 0,
            blend_strength: 0,
            despill_strength: 0,
            edge_radius: 0,
        };
        let result = apply(&source, 3, 1, None, &[], configuration);
        assert_eq!(result, [0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255]);
    }
}
