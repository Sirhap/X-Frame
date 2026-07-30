(function attachBatchCutoutOutputCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchCutoutOutputCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Returns a collision-free PNG name for an archive or mixed-source batch.
   * @param {string} name Requested file name.
   * @param {Map<string,number>} counts Registry of emitted names and base suffixes.
   * @returns {string}
   */
  function uniquePngName(name, counts) {
    if (!(counts instanceof Map)) throw new TypeError("PNG name counts must be a Map.");
    const normalized = String(name || "frame.png").replace(/\.[^.]+$/, "") + ".png";
    if (!counts.has(normalized)) {
      counts.set(normalized, 1);
      return normalized;
    }
    let suffix = Math.max(2, (counts.get(normalized) || 1) + 1);
    let candidate = normalized.replace(/\.png$/i, `_${suffix}.png`);
    while (counts.has(candidate)) {
      suffix += 1;
      candidate = normalized.replace(/\.png$/i, `_${suffix}.png`);
    }
    counts.set(normalized, suffix);
    counts.set(candidate, 1);
    return candidate;
  }

  /**
   * Creates one immutable product output consumed by ZIP, worksets, and group replacement.
   * @param {{name:string,frame?:object|null,data:string,canvas?:object|null}} value Output fields.
   * @returns {{name:string,frame:object|null,data:string,canvas:object|null}}
   */
  function createOutput(value) {
    const data = String(value?.data || "");
    if (!data.startsWith("data:image/png;base64,")) {
      throw new Error("Cutout output must contain a PNG data URL.");
    }
    return Object.freeze({
      name: String(value?.name || "frame.png"),
      frame: value?.frame || null,
      data,
      canvas: value?.canvas || null,
    });
  }

  /**
   * Converts product outputs into ZIP entries without re-encoding image bytes.
   * @param {Array<{name:string,data:string}>} outputs Processed outputs.
   * @param {string} manifestJson Serialized export manifest.
   * @returns {Array<{name:string,data:string}>}
   */
  function createArchiveEntries(outputs, manifestJson) {
    const entries = outputs.map((output) => ({
      name: String(output.name),
      data: String(output.data),
    }));
    entries.push({ name: "cutout-manifest.json", data: String(manifestJson) });
    return entries;
  }

  /**
   * Builds the animation replacement request body using the exact output data URLs.
   * @param {string} projectId Active project identifier.
   * @param {Array<{path:string}>} frames Animation frames in target order.
   * @param {Array<{data:string}>} outputs Processed outputs in the same order.
   * @returns {{projectId:string,frames:Array<{path:string}>,files:Array<{data:string}>}}
   */
  function createAnimationReplacementPayload(projectId, frames, outputs) {
    if (!Array.isArray(frames) || !frames.length || frames.length !== outputs.length) {
      throw new Error(`Expected ${frames?.length || 0} processed frames, received ${outputs?.length || 0}.`);
    }
    return {
      projectId: String(projectId || ""),
      frames: frames.map((frame) => ({ path: String(frame.path || "") })),
      files: outputs.map((output) => ({ data: String(output.data || "") })),
    };
  }

  return {
    createAnimationReplacementPayload,
    createArchiveEntries,
    createOutput,
    uniquePngName,
  };
});
