(function attachLocalMediaExportClient(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LocalMediaExportClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STORAGE_KEY = "xsxbFrameTuner.mediaExportJob";

  /** Waits without blocking the browser main thread. @param {number} milliseconds Delay. */
  function delay(milliseconds) {
    return new Promise((resolve) => root.setTimeout(resolve, milliseconds));
  }

  /** Reads a JSON response and converts non-success status into a useful error. */
  async function readResponse(response) {
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || `Media export failed with HTTP ${response.status}.`);
      error.status = response.status;
      error.code = payload.errorCode || "";
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /** Returns an available Web Storage adapter without leaking access failures. */
  function resolveStorage(storage) {
    if (storage === null) return null;
    if (storage) return storage;
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  /** Reads the most recent local export job ID. @param {Storage|null} [storage] Storage adapter. */
  function getLastJobId(storage) {
    try {
      const value = resolveStorage(storage)?.getItem(STORAGE_KEY);
      return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(value || "")) ? String(value) : "";
    } catch (_error) {
      return "";
    }
  }

  /** Persists the most recent job ID when storage is available. */
  function rememberJob(jobId, storage) {
    try {
      resolveStorage(storage)?.setItem(STORAGE_KEY, String(jobId));
    } catch (_error) {
      // Private browsing and storage policies must not block media export.
    }
  }

  /** Clears the stored job when it still identifies the supplied job. */
  function clearLastJob(jobId, storage) {
    try {
      const adapter = resolveStorage(storage);
      if (adapter && (!jobId || adapter.getItem(STORAGE_KEY) === String(jobId))) {
        adapter.removeItem(STORAGE_KEY);
      }
    } catch (_error) {
      // Storage cleanup is best effort.
    }
  }

  /** Executes a same-origin JSON request. */
  async function requestJson(fetchImpl, pathname, options = {}) {
    const response = await fetchImpl(pathname, {
      credentials: "same-origin",
      ...options,
    });
    return readResponse(response);
  }

  /** Fetches one persisted export job status. */
  async function getJobStatus(jobId, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") throw new Error("Local media export is unavailable.");
    return requestJson(fetchImpl, `/api/media-export/status?job=${encodeURIComponent(jobId)}`, {
      signal: dependencies.signal || undefined,
    });
  }

  /** Cancels one job and forgets it after server acknowledgement. */
  async function cancelJob(jobId, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") throw new Error("Local media export is unavailable.");
    const result = await requestJson(fetchImpl, "/api/media-export/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
      signal: dependencies.signal || undefined,
    });
    clearLastJob(jobId, dependencies.storage);
    return result;
  }

  /**
   * Restores and optionally follows the most recent local encoding job.
   * Uploading jobs cannot resume because browser frame payloads are intentionally not persisted.
   * @param {{fetchImpl?:typeof fetch,storage?:Storage|null,onStatus?:(status:object)=>void,signal?:AbortSignal,pollMs?:number,poll?:boolean}} [dependencies] Browser adapters.
   */
  async function resumeLastExport(dependencies = {}) {
    const jobId = getLastJobId(dependencies.storage);
    if (!jobId) return null;
    try {
      while (true) {
        const status = await getJobStatus(jobId, dependencies);
        if (status.status === "uploading") {
          const interrupted = {
            ...status,
            serverStatus: "uploading",
            status: "failed",
            errorCode: "upload_interrupted",
            error: "Frame upload was interrupted. Cancel this job and export again.",
          };
          dependencies.onStatus?.(interrupted);
          return interrupted;
        }
        dependencies.onStatus?.(status);
        if (dependencies.poll === false || !["queued", "running"].includes(status.status)) {
          return status;
        }
        if (dependencies.signal?.aborted) {
          throw new DOMException("Media export reconnect cancelled.", "AbortError");
        }
        await delay(Math.max(150, Number(dependencies.pollMs) || 350));
      }
    } catch (error) {
      if (error?.status === 404) {
        clearLastJob(jobId, dependencies.storage);
        return null;
      }
      throw error;
    }
  }

  /**
   * Creates an upload-ready, common-size PNG while preserving top-left frame alignment.
   * @param {CanvasImageSource} image Frame image.
   * @param {number} width Target width.
   * @param {number} height Target height.
   * @param {Document} documentRef DOM adapter.
   */
  function paddedPngDataUrl(image, width, height, documentRef) {
    const canvas = documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Local export canvas is unavailable.");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  /**
   * Uploads frames and waits for the local FFmpeg job.
   * @param {object} metadata Animation metadata.
   * @param {Array<{image:CanvasImageSource,width:number,height:number}>} items Ordered frames.
   * @param {{gif?:boolean,mp4?:boolean,mov?:boolean}} formats Requested local formats.
   * @param {{fetchImpl?:typeof fetch,document?:Document,storage?:Storage|null,onProgress?:(current:number,total:number)=>void,onJobCreated?:(job:object)=>void,onStatus?:(status:object)=>void,signal?:AbortSignal,pollMs?:number}} [dependencies] Browser adapters.
   */
  async function exportMedia(metadata, items, formats, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || root.fetch;
    const documentRef = dependencies.document || root.document;
    if (typeof fetchImpl !== "function" || !documentRef?.createElement) {
      throw new Error("Local media export is unavailable.");
    }
    const requestedFormats = [
      ...(formats?.gif ? ["gif"] : []),
      ...(formats?.mp4 ? ["mp4"] : []),
      ...(formats?.mov ? ["mov"] : []),
    ];
    if (!requestedFormats.length) return { downloads: [] };
    if (!Array.isArray(items) || !items.length || !items.every((item) => item.image)) {
      throw new Error("Local media export requires decoded frame canvases.");
    }
    const rawWidth = Math.max(...items.map((item) => Number(item.width) || Number(item.image.width) || 0));
    const rawHeight = Math.max(...items.map((item) => Number(item.height) || Number(item.image.height) || 0));
    const width = formats?.mp4 && rawWidth % 2 ? rawWidth + 1 : rawWidth;
    const height = formats?.mp4 && rawHeight % 2 ? rawHeight + 1 : rawHeight;
    const request = async (pathname, payload, requestSignal = dependencies.signal) => {
      return requestJson(fetchImpl, pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: requestSignal || undefined,
      });
    };
    const job = await request("/api/media-export/jobs", {
      animationName: metadata?.animationName,
      formats: requestedFormats,
      frameCount: items.length,
      fps: Number(metadata?.fps || 12),
      width,
      height,
      frameDurationsMs: items.map((item) =>
        Math.max(1, Number(item.durationMs) || Math.round(1000 / Number(metadata?.fps || 12))),
      ),
      recipe: metadata?.exportRecipe || null,
    });
    rememberJob(job.id, dependencies.storage);
    dependencies.onJobCreated?.(job);
    let phase = "uploading";
    try {
      for (let index = 0; index < items.length; index += 1) {
        if (dependencies.signal?.aborted) throw new DOMException("Media export cancelled.", "AbortError");
        await request("/api/media-export/frame", {
          jobId: job.id,
          index,
          data: paddedPngDataUrl(items[index].image, width, height, documentRef),
        });
        dependencies.onProgress?.(index + 1, items.length);
      }
      phase = "finishing";
      await request("/api/media-export/finish", { jobId: job.id });
      phase = "polling";
      while (true) {
        if (dependencies.signal?.aborted) throw new DOMException("Media export cancelled.", "AbortError");
        const status = await getJobStatus(job.id, dependencies);
        dependencies.onStatus?.(status);
        if (status.status === "completed") return status;
        if (status.status === "failed" || status.status === "cancelled") {
          const error = new Error(status.error || `Media export ${status.status}.`);
          error.code = status.errorCode || "";
          error.jobStatus = status;
          throw error;
        }
        await delay(Math.max(150, Number(dependencies.pollMs) || 350));
      }
    } catch (error) {
      const shouldCancel = error?.name === "AbortError" || phase === "uploading" || phase === "finishing";
      if (shouldCancel) {
        try {
          await cancelJob(job.id, { fetchImpl, storage: dependencies.storage });
        } catch (_cancelError) {
          // Preserve original failure and stored ID so a later reload can reconnect.
        }
      }
      throw error;
    }
  }

  return Object.freeze({
    STORAGE_KEY,
    cancelJob,
    clearLastJob,
    exportMedia,
    getJobStatus,
    getLastJobId,
    paddedPngDataUrl,
    readResponse,
    rememberJob,
    resumeLastExport,
  });
});
