(function attachFrameOrganizerImageImport(root, factory) {
  "use strict";

  const sequenceOrder =
    root?.FrameSequenceOrder ||
    (typeof module === "object" && module.exports ? require("./frame_sequence_order") : null);
  const api = factory(root, sequenceOrder);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerImageImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root, sequenceOrder) => {
  "use strict";

  if (!sequenceOrder?.orderImageBatch) throw new Error("FrameSequenceOrder is required.");

  const DEFAULT_MAX_WORKSET_FRAMES = 240;
  const DEFAULT_MAX_FILE_BYTES = 48 * 1024 * 1024;
  const DEFAULT_MAX_IMPORT_BYTES = 256 * 1024 * 1024;
  const DEFAULT_CONCURRENCY = 4;
  const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const SUPPORTED_FILE_EXTENSION = /\.(png|jpe?g|webp)$/i;

  /**
   * Converts an unknown rejection value into an Error.
   * @param {unknown} reason Rejection reason.
   * @param {string} fallbackMessage Message used when the reason has no useful text.
   * @returns {Error}
   */
  function normalizeError(reason, fallbackMessage) {
    if (reason instanceof Error) return reason;
    const message = typeof reason === "string" && reason.trim() ? reason : fallbackMessage;
    return new Error(message);
  }

  /**
   * Creates an image importer with bounded decoding concurrency.
   * @param {{
   *   elements:Record<string,HTMLElement>,
   *   state:{busy:boolean,frames:Array<object>},
   *   text:(key:string,variables?:Record<string,string|number>)=>string,
   *   imagePixelBudget:{totalPixels:(sources:Array<CanvasImageSource>)=>number},
   *   assertImagePixelBudget:(source:CanvasImageSource,currentPixels?:number)=>{totalPixels:number},
   *   createFrame:(image:CanvasImageSource,options:object)=>object,
   *   renderCounts:()=>void,
   *   renderGrid:()=>void,
   *   restartPreview:()=>void,
   *   setStatus:(message:string,tone?:string)=>void,
   *   setDefaultAnimationName?:(filename:string)=>void,
   *   imageConstructor?:typeof Image,
   *   urlApi?:typeof URL,
   *   maxWorksetFrames?:number,
   *   maxFileBytes?:number,
   *   maxImportBytes?:number,
   *   concurrency?:number
   * }} dependencies Organizer integration dependencies.
   * @returns {{importFiles:(fileList:FileList|File[])=>Promise<void>}}
   */
  function createController(dependencies) {
    if (!dependencies?.elements || !dependencies.state || !dependencies.text) {
      throw new TypeError("Frame organizer image-import dependencies are required.");
    }
    const imageConstructor = dependencies.imageConstructor || root.Image;
    const urlApi = dependencies.urlApi || root.URL;
    if (!imageConstructor || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
      throw new Error("Browser image decoding APIs are required.");
    }
    const maxWorksetFrames = Math.max(1, Number(dependencies.maxWorksetFrames) || DEFAULT_MAX_WORKSET_FRAMES);
    const maxFileBytes = Math.max(1, Number(dependencies.maxFileBytes) || DEFAULT_MAX_FILE_BYTES);
    const maxImportBytes = Math.max(
      maxFileBytes,
      Number(dependencies.maxImportBytes) || DEFAULT_MAX_IMPORT_BYTES,
    );
    const concurrency = Math.max(1, Number(dependencies.concurrency) || DEFAULT_CONCURRENCY);

    /**
     * Loads one local image while ensuring its object URL is released.
     * @param {File} file Local image file.
     * @returns {Promise<HTMLImageElement>}
     */
    function loadFileImage(file) {
      return new Promise((resolve, reject) => {
        let objectUrl = "";
        try {
          objectUrl = urlApi.createObjectURL(file);
          const image = new imageConstructor();
          const settle = (callback, value) => {
            image.onload = null;
            image.onerror = null;
            if (objectUrl) urlApi.revokeObjectURL(objectUrl);
            callback(value);
          };
          image.onload = () => settle(resolve, image);
          image.onerror = () => settle(reject, new Error(`Cannot read ${file.name}`));
          image.src = objectUrl;
        } catch (error) {
          if (objectUrl) urlApi.revokeObjectURL(objectUrl);
          reject(normalizeError(error, `Cannot read ${file.name}`));
        }
      });
    }

    /**
     * Loads files with bounded concurrency while preserving input order.
     * @param {Array<{item:File,selectionIndex:number,filenameIndex:number}>} entries Ordered file entries.
     * @returns {Promise<Array<{status:"fulfilled",value:HTMLImageElement}|{status:"rejected",reason:Error}>>}
     */
    async function loadImageFiles(entries) {
      const results = new Array(entries.length);
      let cursor = 0;
      async function worker() {
        while (cursor < entries.length) {
          const index = cursor;
          cursor += 1;
          try {
            results[index] = {
              status: "fulfilled",
              value: await loadFileImage(entries[index].item),
            };
          } catch (error) {
            results[index] = {
              status: "rejected",
              reason: normalizeError(error, `Cannot read ${entries[index].item.name}`),
            };
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
      return results;
    }

    /**
     * Imports local images at the end of the organizer frame sequence.
     * @param {FileList|File[]} fileList Local files.
     * @returns {Promise<void>}
     */
    async function importFiles(fileList) {
      const { state, text } = dependencies;
      if (state.busy) {
        dependencies.setStatus(text("importBusy"), "error");
        return;
      }
      const candidates = sequenceOrder.describeImageBatch(Array.from(fileList || []));
      const supported = candidates.filter(
        ({ item: file }) =>
          SUPPORTED_MIME_TYPES.has(String(file.type || "").toLowerCase()) ||
          SUPPORTED_FILE_EXTENSION.test(file.name || ""),
      );
      if (!supported.length) {
        dependencies.setStatus(text("importInvalid"), "error");
        return;
      }
      const remaining = Math.max(0, maxWorksetFrames - state.frames.length);
      if (!remaining) {
        dependencies.setStatus(text("importLimit", { count: 0 }), "error");
        return;
      }
      let totalBytes = 0;
      let skipped = candidates.length - supported.length;
      const sizeAccepted = supported.filter(({ item: file }) => {
        if (file.size > maxFileBytes || totalBytes + file.size > maxImportBytes) {
          skipped += 1;
          return false;
        }
        totalBytes += file.size;
        return true;
      });
      const acceptedEntries = sizeAccepted.slice(0, remaining);
      skipped += Math.max(0, sizeAccepted.length - acceptedEntries.length);
      if (!acceptedEntries.length) {
        dependencies.setStatus(text("importOversized", { count: skipped }), "error");
        return;
      }
      const batchIndex = Number.isInteger(state.nextImportBatchIndex)
        ? state.nextImportBatchIndex
        : sequenceOrder.nextImportBatchIndex(state.frames);
      state.nextImportBatchIndex = batchIndex + 1;
      const orderedEntries = sequenceOrder
        .orderImageBatch(
          acceptedEntries.map((entry) => entry.item),
          state.importOrderStrategy,
        )
        .map((entry) => {
          const originalEntry = acceptedEntries[entry.selectionIndex];
          return {
            item: entry.item,
            selectionIndex: originalEntry.selectionIndex,
            filenameIndex: entry.filenameIndex,
          };
        });
      state.busy = true;
      dependencies.renderCounts();
      dependencies.setStatus(text("importBusy"), "busy");
      try {
        const additions = [];
        let rejectionMessage = "";
        for (let start = 0; start < orderedEntries.length; start += concurrency) {
          const decodeWindow = orderedEntries.slice(start, start + concurrency);
          const results = await loadImageFiles(decodeWindow);
          results.forEach((result, index) => {
            const entry = decodeWindow[index];
            if (result.status === "fulfilled") {
              try {
                // The organizer can hold video-derived worksets above 64MP. Validate the
                // per-image allocation here and leave processing-session totals to the
                // pixel-safe cutout batching boundary.
                dependencies.assertImagePixelBudget(result.value, 0);
                additions.push(
                  dependencies.createFrame(result.value, {
                    sourceType: sequenceOrder.SOURCE_TYPES.IMAGE,
                    importBatchIndex: batchIndex,
                    importSelectionIndex: entry.selectionIndex,
                    importFilenameIndex: entry.filenameIndex,
                    name: entry.item.name,
                    imported: true,
                  }),
                );
              } catch (error) {
                rejectionMessage ||= normalizeError(error, text("importInvalid")).message;
                skipped += 1;
              }
            } else {
              skipped += 1;
            }
          });
        }
        if (!additions.length) {
          dependencies.setStatus(rejectionMessage || text("importInvalid"), "error");
          return;
        }
        state.frames.push(...additions);
        dependencies.setDefaultAnimationName?.(acceptedEntries[0].item.name);
        dependencies.restartPreview();
        dependencies.setStatus(
          skipped
            ? text("importPartial", { count: additions.length, failed: skipped })
            : text("imported", { count: additions.length }),
          skipped ? "error" : "success",
        );
      } catch (error) {
        dependencies.setStatus(normalizeError(error, text("importInvalid")).message, "error");
      } finally {
        state.busy = false;
        dependencies.renderGrid();
        dependencies.elements.organizerGrid.lastElementChild?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      }
    }

    return { importFiles };
  }

  return { createController };
});
