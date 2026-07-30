//! Reusable working memory for the product cutout pipeline.

use std::sync::{Mutex, MutexGuard};

/// Pixel-sized buffers reused by the edge-recovery pipeline.
pub(super) struct EdgeScratch {
    pub(super) original: Vec<u8>,
    pub(super) visited: Vec<u8>,
    pub(super) frontier: Vec<u8>,
    pub(super) next_frontier: Vec<u8>,
}

impl EdgeScratch {
    /// Creates an allocation-free initial scratch state.
    const fn new() -> Self {
        Self {
            original: Vec::new(),
            visited: Vec::new(),
            frontier: Vec::new(),
            next_frontier: Vec::new(),
        }
    }
}

/// Reusable working memory for one complete product cutout call.
pub(super) struct CutoutScratch {
    pub(super) candidates: Vec<u8>,
    pub(super) selected: Vec<u8>,
    pub(super) traversal: Vec<usize>,
    pub(super) protection: Vec<u8>,
    pub(super) edge: EdgeScratch,
}

impl CutoutScratch {
    /// Creates an allocation-free initial scratch state.
    pub(super) const fn new() -> Self {
        Self {
            candidates: Vec::new(),
            selected: Vec::new(),
            traversal: Vec::new(),
            protection: Vec::new(),
            edge: EdgeScratch::new(),
        }
    }
}

/// One WASM instance runs cutout work serially inside its dedicated Worker.
/// Native callers remain safe because the same scratch state is mutex-guarded.
static CUTOUT_SCRATCH: Mutex<CutoutScratch> = Mutex::new(CutoutScratch::new());

/// Returns the reusable scratch state for one complete cutout call.
pub(super) fn shared_scratch() -> MutexGuard<'static, CutoutScratch> {
    CUTOUT_SCRATCH.lock().expect("product cutout scratch")
}

/// Resizes and clears a reusable byte buffer without releasing its capacity.
pub(super) fn reset_bytes(buffer: &mut Vec<u8>, length: usize) {
    buffer.resize(length, 0);
    buffer.fill(0);
}
