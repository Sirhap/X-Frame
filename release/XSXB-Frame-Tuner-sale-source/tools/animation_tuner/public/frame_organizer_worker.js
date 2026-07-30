"use strict";

importScripts("frame_organizer_core.js");

const cancelledRequests = new Set();

/**
 * Runs loop analysis away from the UI thread while forwarding progress and cancellation.
 * @param {MessageEvent} event Worker message event.
 * @returns {void}
 */
self.onmessage = (event) => {
  const message = event.data || {};
  const id = Number(message.id);
  if (message.type === "cancel") {
    cancelledRequests.add(id);
    return;
  }
  if (!["jump", "duplicate", "loop"].includes(message.type) || !Number.isSafeInteger(id)) return;
  if (message.protocolVersion !== 1) {
    self.postMessage({ id, type: "result", ok: false, error: "ENGINE_VERSION_MISMATCH" });
    return;
  }
  const buffers = Array.isArray(message.signatureBuffers) ? message.signatureBuffers : [];
  const dimensions = Array.isArray(message.signatureDimensions) ? message.signatureDimensions : [];
  try {
    const samples = buffers.map((buffer, index) => {
      if (!(buffer instanceof ArrayBuffer))
        throw new TypeError("Loop Worker received an invalid signature buffer.");
      const data = new Uint8ClampedArray(buffer);
      const width = Math.max(1, Math.round(Number(dimensions[index]?.width) || data.length / 4));
      const height = Math.max(1, Math.round(Number(dimensions[index]?.height) || 1));
      return data.length === width * height * 4 ? { data, width, height } : data;
    });
    const signatures = samples.map((sample) =>
      self.FrameOrganizerCore.createSignature(sample.data || sample, sample.width, sample.height),
    );
    if (message.type !== "loop") {
      const context = self.FrameOrganizerCore.createSequenceAnalysisContext(signatures);
      const result =
        message.type === "jump"
          ? self.FrameOrganizerCore.analyzeJumpFrames(
              signatures,
              Number(message.options?.threshold || 0),
              context,
            )
          : self.FrameOrganizerCore.analyzeDuplicateFrames(
              signatures,
              Number(message.options?.threshold || 0),
              context,
            );
      self.postMessage({ id, type: "result", ok: true, cancelled: false, result });
      return;
    }
    self.FrameOrganizerCore.findLoopCandidatesAsync(signatures, message.options || {}, {
      onProgress(current, total) {
        self.postMessage({ id, type: "progress", current, total });
      },
      isCancelled() {
        return cancelledRequests.has(id);
      },
    })
      .then((candidates) => {
        const cancelled = cancelledRequests.delete(id);
        self.postMessage({ id, type: "result", ok: true, cancelled, candidates });
      })
      .catch((error) => {
        cancelledRequests.delete(id);
        self.postMessage({
          id,
          type: "result",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  } catch (error) {
    cancelledRequests.delete(id);
    self.postMessage({
      id,
      type: "result",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
