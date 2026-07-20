(function attachBatchCutoutResultCacheCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutResultCacheCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_MAXIMUM_BYTES = 96 * 1024 * 1024;

  /**
   * Estimates decoded bytes represented by a base64 data URL without materializing another buffer.
   * @param {string} dataUrl PNG data URL.
   * @returns {number} Estimated binary byte count.
   */
  function dataUrlByteLength(dataUrl) {
    const payload = String(dataUrl || "").split(",", 2)[1] || "";
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }

  /**
   * Creates a revision-aware, byte-bounded cache of encoded cutout results.
   * @param {{maximumBytes?:number}} [options] Cache memory policy.
   * @returns {{get:(itemId:string,revision:string)=>string,put:(itemId:string,revision:string,dataUrl:string)=>void,delete:(itemId:string)=>void,clear:()=>void,bytes:()=>number}}
   */
  function createResultArtifactCache(options = {}) {
    const maximumBytes = Math.max(1, Number(options.maximumBytes) || DEFAULT_MAXIMUM_BYTES);
    const entries = new Map();
    let usedBytes = 0;
    let accessSerial = 0;

    /**
     * Removes least-recently-used data until the configured memory budget is met.
     * @returns {void}
     */
    function evictOverflow() {
      while (usedBytes > maximumBytes && entries.size > 0) {
        let oldestKey = "";
        let oldestAccess = Number.POSITIVE_INFINITY;
        for (const [key, entry] of entries) {
          if (entry.access < oldestAccess) {
            oldestKey = key;
            oldestAccess = entry.access;
          }
        }
        if (!oldestKey) break;
        const evicted = entries.get(oldestKey);
        usedBytes -= evicted?.bytes || 0;
        entries.delete(oldestKey);
      }
    }

    return {
      /**
       * Returns the current artifact only when its source processing revision matches.
       * @param {string} itemId Stable queue-item id.
       * @param {string} revision Current result revision.
       * @returns {string} Encoded PNG data URL or an empty string.
       */
      get(itemId, revision) {
        const key = String(itemId || "");
        const entry = entries.get(key);
        if (!entry) return "";
        if (entry.revision !== String(revision || "")) {
          usedBytes -= entry.bytes;
          entries.delete(key);
          return "";
        }
        entry.access = ++accessSerial;
        return entry.dataUrl;
      },

      /**
       * Stores one encoded PNG and evicts stale least-recently-used artifacts as needed.
       * @param {string} itemId Stable queue-item id.
       * @param {string} revision Current result revision.
       * @param {string} dataUrl Encoded PNG data URL.
       * @returns {void}
       */
      put(itemId, revision, dataUrl) {
        const key = String(itemId || "");
        const normalizedDataUrl = String(dataUrl || "");
        if (!key || !normalizedDataUrl.startsWith("data:image/png;base64,")) return;
        const bytes = dataUrlByteLength(normalizedDataUrl);
        const previous = entries.get(key);
        if (previous) {
          usedBytes -= previous.bytes;
          entries.delete(key);
        }
        if (bytes > maximumBytes) return;
        const entry = {
          revision: String(revision || ""),
          dataUrl: normalizedDataUrl,
          bytes,
          access: ++accessSerial,
        };
        entries.set(key, entry);
        usedBytes += entry.bytes;
        evictOverflow();
      },

      /**
       * Removes every revision of one queue item.
       * @param {string} itemId Stable queue-item id.
       * @returns {void}
       */
      delete(itemId) {
        const key = String(itemId || "");
        const previous = entries.get(key);
        if (!previous) return;
        usedBytes -= previous.bytes;
        entries.delete(key);
      },

      /**
       * Releases every encoded artifact at the end of a cutout session.
       * @returns {void}
       */
      clear() {
        entries.clear();
        usedBytes = 0;
      },

      /**
       * Returns the currently retained encoded byte count.
       * @returns {number} Cached binary byte estimate.
       */
      bytes() {
        return usedBytes;
      },
    };
  }

  return {
    DEFAULT_MAXIMUM_BYTES,
    createResultArtifactCache,
    dataUrlByteLength,
  };
});
