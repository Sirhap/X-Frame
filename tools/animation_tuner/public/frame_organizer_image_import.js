(function attachFrameOrganizerImageImport(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerImageImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

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
     * @param {File[]} files Validated local image files.
     * @returns {Promise<Array<{status:"fulfilled",value:HTMLImageElement}|{status:"rejected",reason:Error}>>}
     */
    async function loadImageFiles(files) {
      const results = new Array(files.length);
      let cursor = 0;
      async function worker() {
        while (cursor < files.length) {
          const index = cursor;
          cursor += 1;
          try {
            results[index] = { status: "fulfilled", value: await loadFileImage(files[index]) };
          } catch (error) {
            results[index] = {
              status: "rejected",
              reason: normalizeError(error, `Cannot read ${files[index].name}`),
            };
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
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
      const candidates = Array.from(fileList || []);
      const supported = candidates.filter(
        (file) =>
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
      const sizeAccepted = supported.filter((file) => {
        if (file.size > maxFileBytes || totalBytes + file.size > maxImportBytes) {
          skipped += 1;
          return false;
        }
        totalBytes += file.size;
        return true;
      });
      const files = sizeAccepted.slice(0, remaining);
      skipped += Math.max(0, sizeAccepted.length - files.length);
      if (!files.length) {
        dependencies.setStatus(text("importOversized", { count: skipped }), "error");
        return;
      }
      state.busy = true;
      dependencies.renderCounts();
      dependencies.setStatus(text("importBusy"), "busy");
      try {
        const results = await loadImageFiles(files);
        const additions = [];
        let rejectionMessage = "";
        let retainedPixels = dependencies.imagePixelBudget.totalPixels(
          state.frames.map((frame) => frame.originalCanvas),
        );
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            try {
              const budget = dependencies.assertImagePixelBudget(result.value, retainedPixels);
              additions.push(
                dependencies.createFrame(result.value, {
                  originalIndex: Number.MAX_SAFE_INTEGER - files.length + index,
                  name: files[index].name,
                  imported: true,
                }),
              );
              retainedPixels = budget.totalPixels;
            } catch (error) {
              rejectionMessage ||= normalizeError(error, text("importInvalid")).message;
              skipped += 1;
            }
          } else {
            skipped += 1;
          }
        });
        if (!additions.length) {
          dependencies.setStatus(rejectionMessage || text("importInvalid"), "error");
          return;
        }
        state.frames.push(...additions);
        dependencies.renderGrid();
        dependencies.restartPreview();
        dependencies.elements.organizerGrid.lastElementChild?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
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
        dependencies.renderCounts();
      }
    }

    return { importFiles };
  }

  return { createController };
});
