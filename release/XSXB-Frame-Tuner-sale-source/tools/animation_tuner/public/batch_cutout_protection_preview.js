(function attachBatchCutoutProtectionPreview(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchCutoutProtectionPreview = api;
})(globalThis, function createBatchCutoutProtectionPreviewModule(root) {
  "use strict";

  /**
   * Creates protection-mask previews and their canvas renderer.
   * @param {object} dependencies Preview dependencies supplied by the batch controller.
   * @param {object} dependencies.colorUtils Public display color helpers.
   * @param {object} dependencies.selectionRepairExecutor Protected selection analysis executor.
   * @param {object} dependencies.state Mutable batch controller state.
   * @param {object} dependencies.elements Batch-cutout DOM elements.
   * @param {(key:string,values?:object)=>string} dependencies.text Localized text resolver.
   * @param {()=>object|null} dependencies.selectedItem Selected item resolver.
   * @param {(item:object)=>Array<{r:number,g:number,b:number}>} dependencies.selectedBackgroundColors Background color resolver.
   * @returns {object} Protection preview controller.
   */
  function createController(dependencies) {
    const {
      colorUtils,
      selectionRepairExecutor,
      state,
      elements,
      text,
      selectedItem,
      selectedBackgroundColors,
    } = dependencies || {};
    if (!colorUtils || !selectionRepairExecutor || !state || !elements) {
      throw new Error("BatchCutoutProtectionPreview requires runtime, color, state, and elements.");
    }

    /**
     * Normalizes a protection rectangle to source-image bounds.
     * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source-space rectangle.
     * @param {number} width Source width.
     * @param {number} height Source height.
     * @returns {{x1:number,y1:number,x2:number,y2:number}|null}
     */
    function normalizeProtectionRectangle(rectangle, width, height) {
      if (![rectangle?.x1, rectangle?.y1, rectangle?.x2, rectangle?.y2].every(Number.isFinite)) return null;
      return {
        x1: Math.max(0, Math.min(width - 1, Math.floor(Math.min(rectangle.x1, rectangle.x2)))),
        y1: Math.max(0, Math.min(height - 1, Math.floor(Math.min(rectangle.y1, rectangle.y2)))),
        x2: Math.max(0, Math.min(width - 1, Math.ceil(Math.max(rectangle.x1, rectangle.x2)))),
        y2: Math.max(0, Math.min(height - 1, Math.ceil(Math.max(rectangle.y1, rectangle.y2)))),
      };
    }

    /**
     * Creates the coarse public selection mask consumed by the protected runtime.
     * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source-space rectangle.
     * @param {number} width Source width.
     * @param {number} height Source height.
     * @returns {Uint8Array} Binary selection mask.
     */
    function createSelectionMask(rectangle, width, height) {
      const mask = new Uint8Array(Math.max(0, width * height));
      const bounds = normalizeProtectionRectangle(rectangle, width, height);
      if (!bounds) return mask;
      for (let y = bounds.y1; y <= bounds.y2; y += 1) {
        mask.fill(1, y * width + bounds.x1, y * width + bounds.x2 + 1);
      }
      return mask;
    }

    /** Encodes a rectangular binary mask into a compact base64 bitset. */
    function encodeSubjectMask(mask, rectangle, imageWidth) {
      const width = rectangle.x2 - rectangle.x1 + 1;
      const height = rectangle.y2 - rectangle.y1 + 1;
      const bytes = new Uint8Array(Math.ceil((width * height) / 8));
      let targetIndex = 0;
      for (let y = rectangle.y1; y <= rectangle.y2; y += 1) {
        for (let x = rectangle.x1; x <= rectangle.x2; x += 1) {
          if (mask[y * imageWidth + x]) bytes[targetIndex >> 3] |= 1 << (targetIndex & 7);
          targetIndex += 1;
        }
      }
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      return { width, height, data: root.btoa(binary) };
    }

    /** Decodes a persisted subject bitset into a full-image protection mask. */
    function decodeSubjectMask(subjectMask, rectangle, imageWidth, imageHeight) {
      if (
        !subjectMask?.data ||
        !Number.isInteger(subjectMask.width) ||
        !Number.isInteger(subjectMask.height)
      ) {
        return null;
      }
      try {
        const binary = root.atob(subjectMask.data);
        const bounds = normalizeProtectionRectangle(rectangle, imageWidth, imageHeight);
        if (!bounds || binary.length * 8 < subjectMask.width * subjectMask.height) return null;
        const mask = new Uint8Array(imageWidth * imageHeight);
        let count = 0;
        let minX = imageWidth;
        let minY = imageHeight;
        let maxX = -1;
        let maxY = -1;
        for (let y = bounds.y1; y <= bounds.y2; y += 1) {
          const sourceY = Math.min(
            subjectMask.height - 1,
            Math.floor(((y - bounds.y1) * subjectMask.height) / Math.max(1, bounds.y2 - bounds.y1 + 1)),
          );
          for (let x = bounds.x1; x <= bounds.x2; x += 1) {
            const sourceX = Math.min(
              subjectMask.width - 1,
              Math.floor(((x - bounds.x1) * subjectMask.width) / Math.max(1, bounds.x2 - bounds.x1 + 1)),
            );
            const bitIndex = sourceY * subjectMask.width + sourceX;
            if (!(binary.charCodeAt(bitIndex >> 3) & (1 << (bitIndex & 7)))) continue;
            mask[y * imageWidth + x] = 1;
            count += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        return {
          mask,
          count,
          bounds: maxX >= 0 ? { x1: minX, y1: minY, x2: maxX, y2: maxY } : null,
        };
      } catch {
        return null;
      }
    }

    /** Requests macOS Vision foreground detection for the coarse selection. */
    async function detectNativeSubject(sourceImageData, rectangle) {
      const bounds = normalizeProtectionRectangle(rectangle, sourceImageData.width, sourceImageData.height);
      if (!bounds || !root.document || typeof root.fetch !== "function") return null;
      const width = bounds.x2 - bounds.x1 + 1;
      const height = bounds.y2 - bounds.y1 + 1;
      const sourceCanvas = root.document.createElement("canvas");
      sourceCanvas.width = sourceImageData.width;
      sourceCanvas.height = sourceImageData.height;
      sourceCanvas.getContext("2d").putImageData(sourceImageData, 0, 0);
      const cropCanvas = root.document.createElement("canvas");
      cropCanvas.width = width;
      cropCanvas.height = height;
      cropCanvas
        .getContext("2d")
        .drawImage(sourceCanvas, bounds.x1, bounds.y1, width, height, 0, 0, width, height);
      const response = await root.fetch("/api/segment-subject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: cropCanvas.toDataURL("image/png") }),
      });
      if (!response.ok)
        throw new Error((await response.json().catch(() => null))?.error || "SEGMENTATION_FAILED");
      const payload = await response.json();
      const image = new root.Image();
      image.src = payload.imageDataUrl;
      await image.decode();
      const maskCanvas = root.document.createElement("canvas");
      maskCanvas.width = width;
      maskCanvas.height = height;
      const context = maskCanvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const mask = new Uint8Array(sourceImageData.width * sourceImageData.height);
      let count = 0;
      let minX = sourceImageData.width;
      let minY = sourceImageData.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] < 12) continue;
          const targetX = bounds.x1 + x;
          const targetY = bounds.y1 + y;
          mask[targetY * sourceImageData.width + targetX] = 1;
          count += 1;
          minX = Math.min(minX, targetX);
          minY = Math.min(minY, targetY);
          maxX = Math.max(maxX, targetX);
          maxY = Math.max(maxY, targetY);
        }
      }
      if (!count) return null;
      return {
        mask,
        count,
        bounds: { x1: minX, y1: minY, x2: maxX, y2: maxY },
        coverage: Math.round((count * 100) / (width * height)),
        subjectMask: encodeSubjectMask(mask, bounds, sourceImageData.width),
      };
    }

    /**
     * Creates a mask matching the actual RGB tolerance used by color protection.
     * @param {Uint8ClampedArray|Uint8Array} source Source RGBA pixels.
     * @param {number} width Source width.
     * @param {number} height Source height.
     * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source-space rectangle.
     * @param {Array<{r:number,g:number,b:number}>} colors Protected colors.
     * @param {number} tolerance Protection tolerance.
     * @returns {{mask:Uint8Array,count:number,bounds:object|null,coarseArea:number}}
     */
    function createColorProtectionPreview(source, width, height, rectangle, colors, tolerance) {
      const mask = new Uint8Array(width * height);
      const bounds = normalizeProtectionRectangle(rectangle, width, height);
      if (!bounds) return { mask, count: 0, bounds: null, coarseArea: 0, width, height };
      const coarseArea = (bounds.x2 - bounds.x1 + 1) * (bounds.y2 - bounds.y1 + 1);
      const candidates = Array.isArray(colors)
        ? colors.filter((color) => [color?.r, color?.g, color?.b].every(Number.isFinite))
        : [];
      if (!candidates.length) return { mask, count: 0, bounds: null, coarseArea, width, height };
      const distanceLimit = Math.max(0, Number(tolerance) || 0);
      let count = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = bounds.y1; y <= bounds.y2; y += 1) {
        for (let x = bounds.x1; x <= bounds.x2; x += 1) {
          const index = y * width + x;
          const offset = index * 4;
          if (!source[offset + 3]) continue;
          const matches = candidates.some(
            (color) =>
              colorUtils.colorDistance(source[offset], source[offset + 1], source[offset + 2], color) <=
              distanceLimit,
          );
          if (!matches) continue;
          mask[index] = 1;
          count += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return {
        mask,
        count,
        bounds: maxX >= 0 ? { x1: minX, y1: minY, x2: maxX, y2: maxY } : null,
        coarseArea,
        width,
        height,
      };
    }

    /**
     * Builds a transient visualization model for one persisted protection repair.
     * The mask is intentionally kept outside the serialized repair record.
     * @param {object} item Active queue item.
     * @param {object} repair Protection repair record.
     * @returns {Promise<{mode:string,rectangle:object,mask:Uint8Array,count:number,bounds:object|null,coarseArea:number,coverage:number}|null>}
     */
    async function createProtectionPreviewForRepair(item, repair) {
      const sourceImageData = item?.sourceImageData;
      const width = Number(sourceImageData?.width);
      const height = Number(sourceImageData?.height);
      const data = sourceImageData?.data;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        !data ||
        data.length < width * height * 4
      ) {
        return null;
      }
      const rectangle = normalizeProtectionRectangle(repair, width, height) || repair;
      if (repair.mode === "protect-range") {
        const nativeRegion = decodeSubjectMask(repair.subjectMask, rectangle, width, height);
        if (nativeRegion?.count) {
          const coarseArea = Math.max(
            1,
            (rectangle.x2 - rectangle.x1 + 1) * (rectangle.y2 - rectangle.y1 + 1),
          );
          return {
            mode: repair.mode,
            rectangle,
            ...nativeRegion,
            coarseArea,
            coverage: Math.round((nativeRegion.count * 100) / coarseArea),
            width,
            height,
          };
        }
        const previewData = item.automaticImageData?.data || item.resultImageData?.data || null;
        const region = await selectionRepairExecutor.analyze(
          data,
          width,
          height,
          createSelectionMask(rectangle, width, height),
          {
            mode: "protect-range",
            rectangle,
            previewData,
            options: {
              backgroundColors: selectedBackgroundColors(item),
              boundaryStrength: repair.boundaryStrength,
              padding: repair.padding,
            },
          },
        );
        const coarseArea = Math.max(1, (rectangle.x2 - rectangle.x1 + 1) * (rectangle.y2 - rectangle.y1 + 1));
        return {
          mode: repair.mode,
          rectangle,
          mask: region.mask,
          count: region.count,
          bounds: region.bounds,
          coarseArea,
          coverage: region.coverage,
          width,
          height,
        };
      }
      const protectionTolerance = Number(
        item.processingParameters?.protectionTolerance ?? elements.cutoutProtectionTolerance.value,
      );
      const colorResult = createColorProtectionPreview(
        data,
        width,
        height,
        rectangle,
        repair.colors,
        protectionTolerance,
      );
      return {
        mode: repair.mode,
        rectangle,
        mask: colorResult.mask,
        count: colorResult.count,
        bounds: colorResult.bounds,
        coarseArea: colorResult.coarseArea,
        coverage: colorResult.coarseArea ? Math.round((colorResult.count * 100) / colorResult.coarseArea) : 0,
        colorCount: Array.isArray(repair.colors) ? repair.colors.length : 0,
        width,
        height,
      };
    }

    /**
     * Synchronizes the transient preview with the latest protection repair.
     * @param {object|null} item Active queue item.
     * @returns {Promise<void>}
     */
    async function syncProtectionPreview(item = selectedItem()) {
      if (!item) {
        state.protectionPreview = null;
        return;
      }
      const expectedMode =
        elements.cutoutProtectionType.value === "color" ? "protect-color" : "protect-range";
      const latestRepair = [...(item.repairs || [])].reverse().find((repair) => repair.mode === expectedMode);
      if (!latestRepair) {
        state.protectionPreview = null;
        return;
      }
      const processingRevision = Number(item.processingRevision || 0);
      const previewKey = JSON.stringify({
        itemId: item.id,
        repairId: latestRepair.id,
        processingRevision,
        protectionTolerance: item.processingParameters?.protectionTolerance,
        backgroundColors: selectedBackgroundColors(item),
      });
      if (state.protectionPreview?.previewKey === previewKey) {
        return;
      }
      let preview;
      try {
        preview = await createProtectionPreviewForRepair(item, latestRepair);
      } catch {
        if (item === selectedItem()) state.protectionPreview = null;
        return;
      }
      if (!preview) {
        state.protectionPreview = null;
        return;
      }
      const currentRepair = [...(item.repairs || [])]
        .reverse()
        .find((repair) => repair.mode === expectedMode);
      if (
        currentRepair?.id !== latestRepair.id ||
        Number(item.processingRevision || 0) !== processingRevision ||
        item !== selectedItem()
      ) {
        return;
      }
      state.protectionPreview = {
        itemId: item.id,
        repairId: latestRepair.id,
        previewKey,
        ...preview,
      };
    }

    /**
     * Checks whether a sampled source block contains at least one protected pixel.
     * @param {{mask:Uint8Array,width:number,height:number}} preview Protection preview model.
     * @param {number} startX Block origin X in source pixels.
     * @param {number} startY Block origin Y in source pixels.
     * @param {number} step Sample block size in source pixels.
     * @param {{x2:number,y2:number}} bounds Inclusive selection bounds.
     * @returns {boolean} Whether the block contains protected image content.
     */
    function protectionBlockHasMatch(preview, startX, startY, step, bounds) {
      for (let y = startY; y <= Math.min(bounds.y2, startY + step - 1); y += 1) {
        for (let x = startX; x <= Math.min(bounds.x2, startX + step - 1); x += 1) {
          if (x >= preview.width || y >= preview.height) continue;
          if (preview.mask[y * preview.width + x]) return true;
        }
      }
      return false;
    }

    /**
     * Converts a source-space rectangle into the currently rendered canvas space.
     * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source rectangle.
     * @param {object} view Current canvas view transform.
     * @returns {{x:number,y:number,width:number,height:number}}
     */
    function protectionCanvasRectangle(rectangle, view) {
      return {
        x: view.offsetX + rectangle.x1 * view.scale,
        y: view.offsetY + rectangle.y1 * view.scale,
        width: Math.max(view.scale, (rectangle.x2 - rectangle.x1 + 1) * view.scale),
        height: Math.max(view.scale, (rectangle.y2 - rectangle.y1 + 1) * view.scale),
      };
    }

    /**
     * Builds tightly cropped RGBA pixels for the recognized subject.
     * Pixels outside the recognition mask remain transparent, so the preview
     * follows the subject silhouette instead of the coarse selection box.
     * @param {ImageData|object} sourceImageData Source RGBA image data.
     * @param {{mask:Uint8Array,width:number,height:number,bounds:object|null}} preview Protection preview.
     * @returns {{data:Uint8ClampedArray,width:number,height:number}|null} Cropped subject pixels.
     */
    function createProtectionSubjectPixels(sourceImageData, preview) {
      const source = sourceImageData?.data;
      const sourceWidth = Number(sourceImageData?.width);
      const sourceHeight = Number(sourceImageData?.height);
      const bounds = preview?.bounds;
      if (
        !source ||
        !preview?.mask ||
        !bounds ||
        !Number.isInteger(sourceWidth) ||
        !Number.isInteger(sourceHeight) ||
        sourceWidth !== preview.width ||
        sourceHeight !== preview.height ||
        source.length < sourceWidth * sourceHeight * 4 ||
        preview.mask.length < sourceWidth * sourceHeight
      ) {
        return null;
      }
      const normalizedBounds = normalizeProtectionRectangle(bounds, sourceWidth, sourceHeight);
      if (!normalizedBounds) return null;
      const width = normalizedBounds.x2 - normalizedBounds.x1 + 1;
      const height = normalizedBounds.y2 - normalizedBounds.y1 + 1;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = normalizedBounds.y1; y <= normalizedBounds.y2; y += 1) {
        for (let x = normalizedBounds.x1; x <= normalizedBounds.x2; x += 1) {
          const sourceIndex = y * sourceWidth + x;
          if (!preview.mask[sourceIndex]) continue;
          const sourceOffset = sourceIndex * 4;
          const targetOffset = ((y - normalizedBounds.y1) * width + x - normalizedBounds.x1) * 4;
          data.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        }
      }
      return { data, width, height };
    }

    /**
     * Renders the recognized subject inside the processing-parameters panel.
     * @param {object|null} item Active queue item.
     * @param {object|null} preview Protection preview model.
     * @returns {boolean} Whether a subject image was rendered.
     */
    function renderProtectionSubject(item, preview) {
      const container = elements.cutoutProtectionSubject;
      const canvas = elements.cutoutProtectionSubjectCanvas;
      const context = canvas?.getContext?.("2d");
      const subject = createProtectionSubjectPixels(item?.sourceImageData, preview);
      if (!container || !canvas || !context || !subject) {
        if (container) container.hidden = true;
        return false;
      }
      try {
        canvas.width = subject.width;
        canvas.height = subject.height;
        const imageData = context.createImageData(subject.width, subject.height);
        imageData.data.set(subject.data);
        context.putImageData(imageData, 0, 0);
        container.hidden = false;
        return true;
      } catch {
        container.hidden = true;
        return false;
      }
    }

    /**
     * Keeps the completed recognition off the main result canvas. The shared
     * repair renderer still displays the temporary rectangle while dragging.
     * @returns {void}
     */
    function drawProtectionPreview() {
      return undefined;
    }

    /**
     * Renders the subject preview and its textual recognition status.
     * @returns {void}
     */
    function renderProtectionPreviewInfo() {
      const previewPanel = elements.cutoutProtectionPreview;
      if (!previewPanel) return;
      const visible = state.repairMode === "protect";
      previewPanel.hidden = !visible;
      if (!visible) {
        if (elements.cutoutProtectionSubject) elements.cutoutProtectionSubject.hidden = true;
        return;
      }
      previewPanel.dataset.state = "ready";
      if (state.repairDrag) {
        if (elements.cutoutProtectionSubject) elements.cutoutProtectionSubject.hidden = true;
        elements.cutoutProtectionPreviewStatus.textContent = text("protectionPreviewDragging");
        return;
      }
      const item = selectedItem();
      const preview = state.protectionPreview;
      const expectedMode =
        elements.cutoutProtectionType.value === "color" ? "protect-color" : "protect-range";
      if (!item || !preview || preview.itemId !== item.id || preview.mode !== expectedMode) {
        if (elements.cutoutProtectionSubject) elements.cutoutProtectionSubject.hidden = true;
        elements.cutoutProtectionPreviewStatus.textContent = text("protectionPreviewWaiting");
        return;
      }
      if (!preview.count) previewPanel.dataset.state = "empty";
      renderProtectionSubject(item, preview);
      elements.cutoutProtectionPreviewStatus.textContent = preview.count
        ? preview.mode === "protect-range"
          ? text("protectionPreviewRange", { pixels: preview.count, coverage: preview.coverage })
          : text("protectionPreviewColors", {
              colors: preview.colorCount,
              pixels: preview.count,
              coverage: preview.coverage,
            })
        : text("protectionPreviewEmpty");
    }

    return {
      normalizeProtectionRectangle,
      createSelectionMask,
      encodeSubjectMask,
      detectNativeSubject,
      decodeSubjectMask,
      createColorProtectionPreview,
      createProtectionPreviewForRepair,
      syncProtectionPreview,
      protectionCanvasRectangle,
      protectionBlockHasMatch,
      createProtectionSubjectPixels,
      renderProtectionSubject,
      drawProtectionPreview,
      renderProtectionPreviewInfo,
    };
  }

  return { createController };
});
