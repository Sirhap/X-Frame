(function attachBatchCutoutProtectionPreview(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BatchCutoutProtectionPreview = api;
})(globalThis, function createBatchCutoutProtectionPreviewModule() {
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
      const latestRepair = [...(item.repairs || [])]
        .reverse()
        .find((repair) => ["protect-color", "protect-range"].includes(repair.mode));
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
        .find((repair) => ["protect-color", "protect-range"].includes(repair.mode));
      if (
        currentRepair?.id !== latestRepair.id ||
        Number(item.processingRevision || 0) !== processingRevision
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
     * Draws a compact label inside the protection overlay.
     * @param {CanvasRenderingContext2D} context Canvas context.
     * @param {string} label Label text.
     * @param {number} x Canvas x coordinate.
     * @param {number} y Canvas y coordinate.
     * @param {string} color Accent color.
     * @returns {void}
     */
    function drawProtectionOverlayLabel(context, label, x, y, color) {
      if (!context) return;
      context.save();
      context.font = "900 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      const padding = 6;
      const metrics = context.measureText(label);
      const width = metrics.width + padding * 2;
      const height = 22;
      const labelX = Math.max(4, Math.min(elements.cutoutResult.width - width - 4, x));
      const labelY = Math.max(height + 4, Math.min(elements.cutoutResult.height - 4, y));
      context.fillStyle = "rgba(10, 17, 22, .9)";
      context.fillRect(labelX, labelY - height, width, height);
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(labelX, labelY - height, width, height);
      context.fillStyle = color;
      context.fillText(label, labelX + padding, labelY - 7);
      context.restore();
    }

    /**
     * Draws coarse and recognized protection layers over the result canvas.
     * @returns {void}
     */
    function drawProtectionPreview() {
      if (state.previewMode !== "result" || state.repairMode !== "protect") return;
      const canvas = elements.cutoutResult;
      const view = canvas._cutoutView;
      if (!view) return;
      if (state.repairDrag) {
        const dragSourceRectangle = normalizeProtectionRectangle(
          {
            x1: state.repairDrag.sourceStartX,
            y1: state.repairDrag.sourceStartY,
            x2: state.repairDrag.sourceCurrentX,
            y2: state.repairDrag.sourceCurrentY,
          },
          view.sourceWidth,
          view.sourceHeight,
        );
        if (!dragSourceRectangle) return;
        const dragRectangle = protectionCanvasRectangle(dragSourceRectangle, view);
        drawProtectionOverlayLabel(
          canvas.getContext("2d"),
          text("protectionPreviewDragging"),
          dragRectangle.x,
          dragRectangle.y,
          "#ffd43d",
        );
        return;
      }
      const item = selectedItem();
      const preview = state.protectionPreview;
      if (!item || !preview || preview.itemId !== item.id) return;
      const context = canvas.getContext("2d");
      if (
        !context ||
        !preview.mask ||
        !Number.isInteger(preview.width) ||
        !Number.isInteger(preview.height)
      ) {
        return;
      }
      const coarse = protectionCanvasRectangle(preview.rectangle, view);
      const accent = preview.count ? "#2bdcc4" : "#ff5245";
      const fill = preview.count ? "rgba(43, 220, 196, .12)" : "rgba(255, 82, 69, .14)";
      context.save();
      context.fillStyle = fill;
      context.fillRect(coarse.x, coarse.y, coarse.width, coarse.height);
      context.strokeStyle = "#ffd43d";
      context.lineWidth = 3;
      context.setLineDash([9, 6]);
      context.strokeRect(coarse.x, coarse.y, coarse.width, coarse.height);

      if (preview.count && preview.mask) {
        const bounds = preview.bounds || preview.rectangle;
        const step = Math.max(
          1,
          Math.ceil(Math.sqrt(((bounds.x2 - bounds.x1 + 1) * (bounds.y2 - bounds.y1 + 1)) / 50000)),
        );
        context.fillStyle = "rgba(43, 220, 196, .58)";
        context.setLineDash([]);
        for (let y = bounds.y1; y <= bounds.y2; y += step) {
          for (let x = bounds.x1; x <= bounds.x2; x += step) {
            let matched = false;
            for (let blockY = y; blockY <= Math.min(bounds.y2, y + step - 1) && !matched; blockY += 1) {
              for (let blockX = x; blockX <= Math.min(bounds.x2, x + step - 1); blockX += 1) {
                if (
                  blockX >= preview.width ||
                  blockY >= preview.height ||
                  !preview.mask[blockY * preview.width + blockX]
                )
                  continue;
                matched = true;
                break;
              }
            }
            if (!matched) continue;
            context.fillRect(
              view.offsetX + x * view.scale,
              view.offsetY + y * view.scale,
              Math.max(1, step * view.scale + 0.5),
              Math.max(1, step * view.scale + 0.5),
            );
          }
        }
        if (preview.bounds) {
          const recognized = protectionCanvasRectangle(preview.bounds, view);
          context.strokeStyle = "#2bdcc4";
          context.lineWidth = 2;
          context.setLineDash([4, 4]);
          context.strokeRect(recognized.x, recognized.y, recognized.width, recognized.height);
        }
      }
      context.restore();
      drawProtectionOverlayLabel(
        context,
        preview.count
          ? preview.mode === "protect-range"
            ? text("protectionPreviewRange", { pixels: preview.count, coverage: preview.coverage })
            : text("protectionPreviewColors", {
                colors: preview.colorCount,
                pixels: preview.count,
                coverage: preview.coverage,
              })
          : text("protectionPreviewEmpty"),
        coarse.x,
        coarse.y,
        accent,
      );
    }

    /**
     * Renders the textual legend for the protection overlay.
     * @returns {void}
     */
    function renderProtectionPreviewInfo() {
      const previewPanel = elements.cutoutProtectionPreview;
      if (!previewPanel) return;
      const visible = state.repairMode === "protect";
      previewPanel.hidden = !visible;
      if (!visible) return;
      previewPanel.dataset.state = "ready";
      if (state.repairDrag) {
        elements.cutoutProtectionPreviewStatus.textContent = text("protectionPreviewDragging");
        return;
      }
      const item = selectedItem();
      const preview = state.protectionPreview;
      if (!item || !preview || preview.itemId !== item.id) {
        elements.cutoutProtectionPreviewStatus.textContent = text("protectionPreviewWaiting");
        return;
      }
      if (!preview.count) previewPanel.dataset.state = "empty";
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
      createColorProtectionPreview,
      createProtectionPreviewForRepair,
      syncProtectionPreview,
      protectionCanvasRectangle,
      drawProtectionOverlayLabel,
      drawProtectionPreview,
      renderProtectionPreviewInfo,
    };
  }

  return { createController };
});
