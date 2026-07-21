//! Dependency-free WebAssembly kernels for protected browser-side image processing.
//!
//! The exported ABI deliberately uses only integers, raw byte buffers, and fixed
//! little-endian records. Export names describe product capabilities and do not
//! expose upstream/reference kernel identifiers.

mod distance;
mod edge_restore;
mod memory;
mod product_cutout;
mod protection;
mod status;
mod tracking;

use edge_restore::EdgeRestoreOptions;
use memory::{
    exact_len, pixel_count, ranges_overlap, read_slice, register_allocation, release_allocation,
    reuse_allocation, write_f64, write_slice, MAX_BUFFER_BYTES,
};
use tracking::ShapeSeed;

/// Size in bytes of a local-frame result record.
pub const LOCAL_FRAME_RESULT_BYTES: usize = 72;
/// Size in bytes of a shape-match result record.
pub const SHAPE_MATCH_RESULT_BYTES: usize = 64;
/// Header bytes preceding variable protected-color entries.
pub const PROTECTION_RESULT_HEADER_BYTES: usize = 16;
/// Byte size of the product cutout configuration record.
pub const PRODUCT_CUTOUT_CONFIG_BYTES: usize = product_cutout::CONFIG_BYTES;

/// Reserves a caller-owned byte buffer in the module's linear memory.
///
/// Returns zero for a zero-length or over-limit request. The returned pointer
/// must be released exactly once with [`protected_core_release`] and the same
/// length.
#[no_mangle]
pub extern "C" fn protected_core_reserve(length: usize) -> *mut u8 {
    if length == 0 || length > MAX_BUFFER_BYTES {
        return std::ptr::null_mut();
    }
    if let Some(pointer) = reuse_allocation(length) {
        return pointer;
    }
    let mut buffer = Vec::<u8>::with_capacity(length);
    let pointer = buffer.as_mut_ptr();
    register_allocation(pointer, length, buffer.capacity());
    std::mem::forget(buffer);
    pointer
}

/// Releases a buffer returned by [`protected_core_reserve`].
///
/// A null pointer with zero length is accepted as a no-op. Foreign pointers,
/// wrong lengths, and repeated releases return status 8 without dereferencing or
/// reconstructing caller memory. Released buffers remain module-owned and enter
/// a capacity-aware pool; the WebAssembly instance reclaims the pool on disposal.
#[no_mangle]
pub extern "C" fn protected_core_release(pointer: *mut u8, length: usize) -> i32 {
    if pointer.is_null() {
        return if length == 0 {
            status::OK
        } else {
            status::NULL_POINTER
        };
    }
    if length == 0 || length > MAX_BUFFER_BYTES {
        return status::INVALID_ALLOCATION;
    }
    if !release_allocation(pointer, length) {
        return status::INVALID_ALLOCATION;
    }
    status::OK
}

/// Writes the 3-4-5 chamfer distance of a binary seed mask as little-endian `i16` values.
///
/// Non-zero mask bytes are seeds. Zero dimensions, multiplication overflow,
/// mismatched lengths, buffers above the memory ceiling, and overlapping input
/// and output ranges return a non-zero stable status without writing output.
///
/// # Safety
/// Both pointer ranges must be valid within this module's linear memory for the
/// supplied lengths and remain valid for the duration of the call.
#[no_mangle]
pub unsafe extern "C" fn protected_core_distance_field(
    mask_pointer: *const u8,
    mask_length: usize,
    width: u32,
    height: u32,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(mask_length, count, 1) {
        return code;
    }
    if let Err(code) = exact_len(output_length, count, 2) {
        return if code == status::INVALID_DIMENSIONS {
            status::OUTPUT_TOO_SMALL
        } else {
            code
        };
    }
    if ranges_overlap(mask_pointer, mask_length, output_pointer, output_length) {
        return status::OVERLAPPING_BUFFERS;
    }
    let mask = match read_slice(mask_pointer, mask_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let output = match write_slice(output_pointer, output_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    for (index, value) in distance::transform_seed_mask(mask, width as usize, height as usize)
        .into_iter()
        .enumerate()
    {
        output[index * 2..index * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }
    status::OK
}

/// Computes a PCA local frame and writes a 72-byte versioned little-endian record.
///
/// Byte 0 is version `1`; byte 1 bit 0 reports isotropy; bytes 8..72 contain
/// `ux, uy, vx, vy, cx, cy, majorLength, minorLength` as eight `f64` values.
/// `previous_present=0` ignores the previous direction. Degenerate masks (fewer
/// than three non-zero pixels or zero spatial variance) return status 6.
///
/// # Safety
/// Both pointer ranges must be valid within this module's linear memory for the
/// supplied lengths and must not overlap.
#[no_mangle]
pub unsafe extern "C" fn protected_core_local_frame(
    mask_pointer: *const u8,
    mask_length: usize,
    width: u32,
    height: u32,
    previous_present: u32,
    previous_x: f64,
    previous_y: f64,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(mask_length, count, 1) {
        return code;
    }
    if output_length < LOCAL_FRAME_RESULT_BYTES {
        return status::OUTPUT_TOO_SMALL;
    }
    if previous_present != 0 && (!previous_x.is_finite() || !previous_y.is_finite()) {
        return status::INVALID_PARAMETER;
    }
    if ranges_overlap(
        mask_pointer,
        mask_length,
        output_pointer,
        LOCAL_FRAME_RESULT_BYTES,
    ) {
        return status::OVERLAPPING_BUFFERS;
    }
    let mask = match read_slice(mask_pointer, mask_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let frame = match tracking::local_frame(
        mask,
        width as usize,
        height as usize,
        (previous_present != 0).then_some((previous_x, previous_y)),
    ) {
        Some(value) => value,
        None => return status::DEGENERATE_INPUT,
    };
    let output = match write_slice(output_pointer, LOCAL_FRAME_RESULT_BYTES) {
        Ok(value) => value,
        Err(code) => return code,
    };
    output.fill(0);
    output[0] = 1;
    output[1] = u8::from(frame.isotropic);
    for (index, value) in [
        frame.ux,
        frame.uy,
        frame.vx,
        frame.vy,
        frame.cx,
        frame.cy,
        frame.major_len,
        frame.minor_len,
    ]
    .into_iter()
    .enumerate()
    {
        write_f64(output, 8 + index * 8, value);
    }
    status::OK
}

/// Applies the layered shape gate and writes a 64-byte versioned record.
///
/// Bytes 0..6 contain version, pass bit, three layer states (`255` = nullable),
/// and segment (`0` none, `1` degenerate, `2` elongated, `3` mid, `4` compact).
/// Byte 7 is a presence bitmap. Offsets 8,16,24,32,40,48,56 contain area ratio,
/// seed ratio, candidate ratio, active comparison ratio, candidate area,
/// candidate perimeter, and candidate compactness as little-endian `f64`.
/// `seed_present=0` produces the nullable pass-through result used by the JS core.
///
/// # Safety
/// Both pointer ranges must be valid within this module's linear memory for the
/// supplied lengths and must not overlap.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn protected_core_shape_match(
    mask_pointer: *const u8,
    mask_length: usize,
    width: u32,
    height: u32,
    seed_present: u32,
    seed_area: i32,
    seed_pca_major: f64,
    seed_pca_minor: f64,
    seed_compactness_present: u32,
    seed_compactness: f64,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(mask_length, count, 1) {
        return code;
    }
    if output_length < SHAPE_MATCH_RESULT_BYTES {
        return status::OUTPUT_TOO_SMALL;
    }
    if seed_present != 0
        && (!seed_pca_major.is_finite()
            || !seed_pca_minor.is_finite()
            || (seed_compactness_present != 0 && !seed_compactness.is_finite()))
    {
        return status::INVALID_PARAMETER;
    }
    if ranges_overlap(
        mask_pointer,
        mask_length,
        output_pointer,
        SHAPE_MATCH_RESULT_BYTES,
    ) {
        return status::OVERLAPPING_BUFFERS;
    }
    let mask = match read_slice(mask_pointer, mask_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let seed = (seed_present != 0).then_some(ShapeSeed {
        area: seed_area,
        pca_major: seed_pca_major,
        pca_minor: seed_pca_minor,
        compactness: (seed_compactness_present != 0).then_some(seed_compactness),
    });
    let result = tracking::match_mask(mask, width as usize, height as usize, seed);
    let output = match write_slice(output_pointer, SHAPE_MATCH_RESULT_BYTES) {
        Ok(value) => value,
        Err(code) => return code,
    };
    output.fill(0);
    output[0] = 1;
    output[1] = u8::from(result.passed);
    output[2..5].copy_from_slice(&result.layers.map(|value| value as u8));
    output[5] = result.segment;
    let values = [
        result.ratio_area,
        result.ratio_seed,
        result.ratio_candidate,
        result.ratio_comparison,
        result.candidate_area.map(|value| value as f64),
        result.candidate_perimeter,
        result.candidate_compactness,
    ];
    for (index, value) in values.into_iter().enumerate() {
        if let Some(value) = value {
            output[7] |= 1 << index;
            write_f64(output, 8 + index * 8, value);
        }
    }
    status::OK
}

/// Restores contaminated edge RGB while preserving Alpha and writes RGBA bytes.
///
/// Colors are packed as `0x00BBGGRR`. A null/zero-length mask disables masking;
/// otherwise its length must equal the pixel count. Transparent pixels retain
/// their RGB bytes. A degenerate correct/contaminated color axis returns status 6.
/// Radius parameters must be non-negative and are bounded by the image dimensions.
///
/// # Safety
/// All non-empty pointer ranges must be valid within this module's linear memory.
/// Source, mask, and output ranges must not overlap each other.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn protected_core_restore_edges(
    source_pointer: *const u8,
    source_length: usize,
    width: u32,
    height: u32,
    correct_color: u32,
    contaminated_color: u32,
    tolerance: i32,
    edge_radius: i32,
    background_radius: i32,
    mask_pointer: *const u8,
    mask_length: usize,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(source_length, count, 4) {
        return code;
    }
    if let Err(code) = exact_len(output_length, count, 4) {
        return if code == status::INVALID_DIMENSIONS {
            status::OUTPUT_TOO_SMALL
        } else {
            code
        };
    }
    if edge_radius < 0
        || background_radius < 0
        || edge_radius as usize > (width as usize).max(height as usize)
    {
        return status::INVALID_PARAMETER;
    }
    if mask_length != 0 && mask_length != count {
        return status::INVALID_DIMENSIONS;
    }
    if ranges_overlap(source_pointer, source_length, output_pointer, output_length)
        || (mask_length != 0
            && ranges_overlap(mask_pointer, mask_length, output_pointer, output_length))
        || (mask_length != 0
            && ranges_overlap(source_pointer, source_length, mask_pointer, mask_length))
    {
        return status::OVERLAPPING_BUFFERS;
    }
    let source = match read_slice(source_pointer, source_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let mask = if mask_length == 0 {
        None
    } else {
        match read_slice(mask_pointer, mask_length) {
            Ok(value) => Some(value),
            Err(code) => return code,
        }
    };
    let unpack = |color: u32| {
        [
            (color & 0xff) as u8,
            ((color >> 8) & 0xff) as u8,
            ((color >> 16) & 0xff) as u8,
        ]
    };
    let restored = match edge_restore::restore(
        source,
        width as usize,
        height as usize,
        EdgeRestoreOptions {
            correct: unpack(correct_color),
            contaminated: unpack(contaminated_color),
            tolerance,
            edge_radius: edge_radius as usize,
            background_radius,
            mask,
        },
    ) {
        Some(value) => value,
        None => return status::DEGENERATE_INPUT,
    };
    let output = match write_slice(output_pointer, output_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    output.copy_from_slice(&restored);
    status::OK
}

/// Selects representative protected colors and writes a variable result record.
///
/// The 16-byte header is: version, status, color count, coverage percentage,
/// followed by `sampleCount` as little-endian `u32` and eight reserved bytes.
/// Each selected color then occupies eight bytes: R, G, B, reserved, and its
/// newly covered sample count as little-endian `u32`. `preview_length=0` samples
/// every source pixel; otherwise only partial-Alpha preview pixels are sampled.
/// Existing colors are tightly packed RGB triples and count toward coverage.
/// Optional full-original/full-preview buffers plus their dimensions enable the
/// reference `0.0005` full-image pruning and top-two fallback; both buffers must
/// be present together and have identical RGBA dimensions.
///
/// # Safety
/// Every non-empty range must be valid in module linear memory. Output may not
/// overlap source, preview, existing-color, or full-image storage. Calls must
/// not race `protected_core_release` for any referenced allocation.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn protected_core_select_protection_colors(
    source_pointer: *const u8,
    source_length: usize,
    preview_pointer: *const u8,
    preview_length: usize,
    width: u32,
    height: u32,
    background_color: u32,
    maximum_colors: u32,
    coverage_threshold: u32,
    existing_pointer: *const u8,
    existing_length: usize,
    full_original_pointer: *const u8,
    full_original_length: usize,
    full_preview_pointer: *const u8,
    full_preview_length: usize,
    full_width: u32,
    full_height: u32,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(source_length, count, 4) {
        return code;
    }
    if preview_length != 0 && preview_length != source_length {
        return status::INVALID_DIMENSIONS;
    }
    if existing_length % 3 != 0 || existing_length > 32 * 3 {
        return status::INVALID_DIMENSIONS;
    }
    let has_full_image = full_original_length != 0 || full_preview_length != 0;
    let full_count = if has_full_image {
        if full_original_length == 0 || full_preview_length == 0 {
            return status::INVALID_DIMENSIONS;
        }
        let value = match pixel_count(full_width, full_height) {
            Ok(value) => value,
            Err(code) => return code,
        };
        if let Err(code) = exact_len(full_original_length, value, 4) {
            return code;
        }
        if full_preview_length != full_original_length {
            return status::INVALID_DIMENSIONS;
        }
        value
    } else {
        0
    };
    if !(1..=32).contains(&maximum_colors) || coverage_threshold > 100 {
        return status::INVALID_PARAMETER;
    }
    let required_output =
        match PROTECTION_RESULT_HEADER_BYTES.checked_add(maximum_colors as usize * 8) {
            Some(value) => value,
            None => return status::SIZE_LIMIT,
        };
    if output_length < required_output {
        return status::OUTPUT_TOO_SMALL;
    }
    for (pointer, length) in [
        (source_pointer, source_length),
        (preview_pointer, preview_length),
        (existing_pointer, existing_length),
        (full_original_pointer, full_original_length),
        (full_preview_pointer, full_preview_length),
    ] {
        if length != 0 && ranges_overlap(pointer, length, output_pointer, required_output) {
            return status::OVERLAPPING_BUFFERS;
        }
    }
    let source = match read_slice(source_pointer, source_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let preview = if preview_length == 0 {
        None
    } else {
        match read_slice(preview_pointer, preview_length) {
            Ok(value) => Some(value),
            Err(code) => return code,
        }
    };
    let existing_bytes = if existing_length == 0 {
        &[][..]
    } else {
        match read_slice(existing_pointer, existing_length) {
            Ok(value) => value,
            Err(code) => return code,
        }
    };
    let full_original = if full_count == 0 {
        None
    } else {
        match read_slice(full_original_pointer, full_original_length) {
            Ok(value) => Some(value),
            Err(code) => return code,
        }
    };
    let full_preview = if full_count == 0 {
        None
    } else {
        match read_slice(full_preview_pointer, full_preview_length) {
            Ok(value) => Some(value),
            Err(code) => return code,
        }
    };
    let existing = existing_bytes
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect::<Vec<_>>();
    let unpack = |color: u32| {
        [
            (color & 0xff) as u8,
            ((color >> 8) & 0xff) as u8,
            ((color >> 16) & 0xff) as u8,
        ]
    };
    let full_image = full_original
        .zip(full_preview)
        .map(|(original, preview)| (original, preview, full_width as usize, full_height as usize));
    let result = protection::select(
        source,
        preview,
        width as usize,
        height as usize,
        unpack(background_color),
        maximum_colors as usize,
        coverage_threshold as u8,
        &existing,
        full_image,
    );
    let output = match write_slice(output_pointer, required_output) {
        Ok(value) => value,
        Err(code) => return code,
    };
    output.fill(0);
    output[0] = 1;
    output[1] = result.status;
    output[2] = result.colors.len() as u8;
    output[3] = result.coverage;
    output[4..8].copy_from_slice(&result.sample_count.to_le_bytes());
    for (index, color) in result.colors.iter().enumerate() {
        let offset = PROTECTION_RESULT_HEADER_BYTES + index * 8;
        output[offset..offset + 3].copy_from_slice(&[color.r, color.g, color.b]);
        output[offset + 4..offset + 8].copy_from_slice(&color.count.to_le_bytes());
    }
    status::OK
}

/// Applies global replacement or connected selection repair through one product pipeline.
///
/// The 64-byte configuration record uses: byte 0 version `1`; byte 1 selection
/// (`0` global, `1` connected); byte 2 blend mode 0..3; byte 3 edge mode 0..2;
/// byte 4 flags (bit 0 explicit reference, bit 1 explicit despill); bytes 6/7
/// Alpha high/low; offsets 8/12 seed X/Y `i32`; offsets 16/20 reference and
/// replacement RGBA; offset 24 despill RGB; offsets 28/32/36/40/44 contain
/// tolerance, edge enhancement, blend strength, directional despill strength,
/// and edge radius as little-endian `i32`. A zero-length mask disables masking;
/// otherwise enabled bytes must equal 255. Protected colors are RGB triples.
/// Global mode provides the complete replacement pipeline. Connected mode uses
/// four-neighbor seed selection and deliberately ignores protection colors,
/// Alpha thresholds, and directional-despill strength to preserve selection
/// repair semantics; blend and edge recovery remain active.
///
/// # Safety
/// All non-empty ranges must be valid module memory. Output cannot overlap any
/// input range. Source and output are exact `width * height * 4` byte buffers.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn protected_core_apply_cutout(
    source_pointer: *const u8,
    source_length: usize,
    width: u32,
    height: u32,
    configuration_pointer: *const u8,
    configuration_length: usize,
    mask_pointer: *const u8,
    mask_length: usize,
    protected_colors_pointer: *const u8,
    protected_colors_length: usize,
    output_pointer: *mut u8,
    output_length: usize,
) -> i32 {
    let count = match pixel_count(width, height) {
        Ok(value) => value,
        Err(code) => return code,
    };
    if let Err(code) = exact_len(source_length, count, 4) {
        return code;
    }
    if let Err(code) = exact_len(output_length, count, 4) {
        return if code == status::INVALID_DIMENSIONS {
            status::OUTPUT_TOO_SMALL
        } else {
            code
        };
    }
    if configuration_length != PRODUCT_CUTOUT_CONFIG_BYTES
        || (mask_length != 0 && mask_length != count)
    {
        return status::INVALID_DIMENSIONS;
    }
    for (pointer, length) in [
        (source_pointer, source_length),
        (configuration_pointer, configuration_length),
        (mask_pointer, mask_length),
    ] {
        if length != 0 && ranges_overlap(pointer, length, output_pointer, output_length) {
            return status::OVERLAPPING_BUFFERS;
        }
    }
    let source = match read_slice(source_pointer, source_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let configuration_bytes = match read_slice(configuration_pointer, configuration_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    let configuration = match product_cutout::parse_configuration(configuration_bytes) {
        Some(value) => value,
        None => return status::INVALID_PARAMETER,
    };
    if configuration.edge_radius > 600
        || configuration.tolerance < -1
        || configuration.tolerance > 100
        || configuration.edge_enhance < 0
        || configuration.edge_enhance > 100
        || configuration.blend_strength < 0
        || configuration.blend_strength > 100
        || (!configuration.connected
            && (configuration.despill_strength < 0 || configuration.despill_strength > 100))
    {
        return status::INVALID_PARAMETER;
    }
    let mask = if mask_length == 0 {
        None
    } else {
        match read_slice(mask_pointer, mask_length) {
            Ok(value) => Some(value),
            Err(code) => return code,
        }
    };
    let protected_colors = if configuration.connected {
        Vec::new()
    } else {
        if protected_colors_length % 3 != 0 || protected_colors_length > 32 * 3 {
            return status::INVALID_DIMENSIONS;
        }
        if protected_colors_length != 0
            && ranges_overlap(
                protected_colors_pointer,
                protected_colors_length,
                output_pointer,
                output_length,
            )
        {
            return status::OVERLAPPING_BUFFERS;
        }
        let protected_bytes = if protected_colors_length == 0 {
            &[][..]
        } else {
            match read_slice(protected_colors_pointer, protected_colors_length) {
                Ok(value) => value,
                Err(code) => return code,
            }
        };
        protected_bytes
            .chunks_exact(3)
            .map(|value| [value[0], value[1], value[2]])
            .collect::<Vec<_>>()
    };
    let result = product_cutout::apply(
        source,
        width as usize,
        height as usize,
        mask,
        &protected_colors,
        configuration,
    );
    let output = match write_slice(output_pointer, output_length) {
        Ok(value) => value,
        Err(code) => return code,
    };
    output.copy_from_slice(&result);
    status::OK
}
