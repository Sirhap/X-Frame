//! Stable numeric status values shared by every exported operation.

/// Operation completed successfully.
pub(crate) const OK: i32 = 0;
/// A pointer was null for a non-empty buffer.
pub(crate) const NULL_POINTER: i32 = 1;
/// Dimensions or buffer lengths do not describe the same image.
pub(crate) const INVALID_DIMENSIONS: i32 = 2;
/// Arithmetic overflow or the configured memory ceiling was reached.
pub(crate) const SIZE_LIMIT: i32 = 3;
/// An output buffer is shorter than the documented result layout.
pub(crate) const OUTPUT_TOO_SMALL: i32 = 4;
/// Input and output memory ranges overlap.
pub(crate) const OVERLAPPING_BUFFERS: i32 = 5;
/// The input is valid but cannot produce a geometric descriptor.
pub(crate) const DEGENERATE_INPUT: i32 = 6;
/// A numeric option is non-finite or outside its accepted domain.
pub(crate) const INVALID_PARAMETER: i32 = 7;
/// A pointer range is not owned by a currently active module allocation.
pub(crate) const INVALID_ALLOCATION: i32 = 8;
