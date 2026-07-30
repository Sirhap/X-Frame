//! Checked helpers for the raw-pointer WASM boundary.

use crate::status;
use std::sync::Mutex;

/// Maximum byte length accepted by one ABI buffer (128 MiB).
pub(crate) const MAX_BUFFER_BYTES: usize = 128 * 1024 * 1024;
/// Maximum pixel count accepted by an image operation (16 MiPixels).
pub(crate) const MAX_PIXELS: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy)]
struct Allocation {
    pointer: usize,
    requested: usize,
    capacity: usize,
    active: bool,
}

static ALLOCATIONS: Mutex<Vec<Allocation>> = Mutex::new(Vec::new());

/// Reactivates an inactive module-owned buffer when its capacity is sufficient.
pub(crate) fn reuse_allocation(requested: usize) -> Option<*mut u8> {
    let mut allocations = ALLOCATIONS.lock().expect("allocation registry");
    let allocation = allocations
        .iter_mut()
        .find(|allocation| !allocation.active && allocation.capacity >= requested)?;
    allocation.requested = requested;
    allocation.active = true;
    Some(allocation.pointer as *mut u8)
}

/// Registers a module-owned allocation and its actual `Vec` capacity.
pub(crate) fn register_allocation(pointer: *mut u8, requested: usize, capacity: usize) {
    ALLOCATIONS
        .lock()
        .expect("allocation registry")
        .push(Allocation {
            pointer: pointer as usize,
            requested,
            capacity,
            active: true,
        });
}

/// Marks an exact active allocation as reusable without reconstructing raw memory.
pub(crate) fn release_allocation(pointer: *mut u8, requested: usize) -> bool {
    let mut allocations = ALLOCATIONS.lock().expect("allocation registry");
    let Some(allocation) = allocations.iter_mut().find(|allocation| {
        allocation.active
            && allocation.pointer == pointer as usize
            && allocation.requested == requested
    }) else {
        return false;
    };
    allocation.active = false;
    true
}

/// Verifies that a complete non-empty range belongs to one active allocation.
pub(crate) fn validate_allocation(pointer: *const u8, length: usize) -> Result<(), i32> {
    if pointer.is_null() {
        return Err(status::NULL_POINTER);
    }
    if length > MAX_BUFFER_BYTES {
        return Err(status::SIZE_LIMIT);
    }
    let start = pointer as usize;
    let end = start.checked_add(length).ok_or(status::SIZE_LIMIT)?;
    let allocations = ALLOCATIONS.lock().expect("allocation registry");
    let valid = allocations.iter().any(|allocation| {
        let allocation_end = allocation.pointer.checked_add(allocation.requested);
        allocation.active
            && start >= allocation.pointer
            && allocation_end.is_some_and(|value| end <= value)
    });
    if valid {
        Ok(())
    } else {
        Err(status::INVALID_ALLOCATION)
    }
}

/// Validates dimensions and returns their pixel count.
pub(crate) fn pixel_count(width: u32, height: u32) -> Result<usize, i32> {
    if width == 0 || height == 0 {
        return Err(status::INVALID_DIMENSIONS);
    }
    let count = (width as usize)
        .checked_mul(height as usize)
        .ok_or(status::SIZE_LIMIT)?;
    if count > MAX_PIXELS {
        return Err(status::SIZE_LIMIT);
    }
    Ok(count)
}

/// Validates an exact byte length without overflowing.
pub(crate) fn exact_len(actual: usize, elements: usize, stride: usize) -> Result<(), i32> {
    let expected = elements.checked_mul(stride).ok_or(status::SIZE_LIMIT)?;
    if expected > MAX_BUFFER_BYTES {
        return Err(status::SIZE_LIMIT);
    }
    if actual != expected {
        return Err(status::INVALID_DIMENSIONS);
    }
    Ok(())
}

/// Returns whether two non-empty address ranges overlap.
pub(crate) fn ranges_overlap(
    first: *const u8,
    first_len: usize,
    second: *const u8,
    second_len: usize,
) -> bool {
    if first_len == 0 || second_len == 0 {
        return false;
    }
    let first_start = first as usize;
    let second_start = second as usize;
    let Some(first_end) = first_start.checked_add(first_len) else {
        return true;
    };
    let Some(second_end) = second_start.checked_add(second_len) else {
        return true;
    };
    first_start < second_end && second_start < first_end
}

/// Creates an immutable slice after the caller has validated its length.
pub(crate) unsafe fn read_slice<'a>(pointer: *const u8, length: usize) -> Result<&'a [u8], i32> {
    validate_allocation(pointer, length)?;
    Ok(std::slice::from_raw_parts(pointer, length))
}

/// Creates a mutable slice after the caller has validated its length.
pub(crate) unsafe fn write_slice<'a>(pointer: *mut u8, length: usize) -> Result<&'a mut [u8], i32> {
    validate_allocation(pointer, length)?;
    Ok(std::slice::from_raw_parts_mut(pointer, length))
}

/// Writes one little-endian `f64` without imposing alignment on the caller.
pub(crate) fn write_f64(output: &mut [u8], offset: usize, value: f64) {
    output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}
