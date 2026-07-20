(function attachBatchCutoutProcessController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BatchCutoutProcessController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the batch cutout loading, processing, export, and apply coordinator.
   * @param {object} dependencies Process/session dependencies supplied by the host controller.
   * @returns {{loadFiles:Function,loadCurrentGroup:Function,processItem:Function,processAll:Function,downloadAll:Function,applyCurrentGroup:Function}}
   */
  function createController(dependencies = {}) {
    const {
      state,
      elements,
      text,
      setStatus,
      renderStatus,
      renderSessionMode,
      renderQueue,
      renderPreview,
      scheduleBatchThumbnails,
      stopBatchPlayback,
      mapSettledWithConcurrency,
      loadFileImage,
      imagePixelBudget,
      assertImagePixelBudget,
      createItem,
      processingOptions,
      repairReplayCore,
      core,
      cutoutExecutor,
      tracking,
      quality,
      createThumbnailUrl,
      refreshQualityAnalysis,
      resultArtifacts,
      outputCore,
      batchZip,
      updateQueueCard,
      selectedItem,
      requestConfirmation,
      close,
      host = {},
      documentRef = root?.document,
      windowRef = root,
      urlRef = root?.URL,
      imageDataConstructor = root?.ImageData,
      domExceptionConstructor = root?.DOMException,
      maxImageFileBytes = 48 * 1024 * 1024,
    } = dependencies;
    if (!state || !elements || typeof processingOptions !== "function") {
      throw new TypeError("BatchCutoutProcessController dependencies are required.");
    }

    const documentApi = documentRef;
    const windowApi = windowRef;
    const urlApi = urlRef;
    const ImageDataClass = imageDataConstructor;
    const DOMExceptionClass = domExceptionConstructor;

    /**
     * Processes one image and stores its result canvas.
     * @param {object} item Queue item.
     * @returns {Promise<object>}
     */
    async function processItem(item) {
      if (
        item.status === "processed" &&
        item.thumbnailRevision === state.thumbnailRevision &&
        item.resultCanvas
      )
        return item;
      if (item.processingPromise) return item.processingPromise;
      item.status = "processing";
      item.error = "";
      const processingRevision = Number(item.processingRevision || 0);
      const processingPromise = (async () => {
        const { width, height, data } = item.sourceImageData;
        const options = processingOptions(item);
        const automaticKey = repairReplayCore.automaticCacheKey(options);
        const canReplayRepairs = item.automaticImageData?.data && item.automaticCacheKey === automaticKey;
        const result = canReplayRepairs
          ? repairReplayCore.replayAutomaticResult({
              source: data,
              automatic: item.automaticImageData.data,
              width,
              height,
              options,
              repairs: item.repairs,
              applyRepairs: core.applyCutoutRepairs,
            })
          : await cutoutExecutor.process(data, width, height, options, item.repairs || []);
        if (processingRevision !== Number(item.processingRevision || 0)) {
          throw new DOMExceptionClass("Stale cutout result was discarded.", "AbortError");
        }
        item.automaticImageData = new ImageDataClass(result.automaticData, width, height);
        item.automaticCacheKey = automaticKey;
        item.shapeCandidates =
          result.shapeCandidates || tracking.createShapeCandidates(result.automaticData, width, height);
        item.shapeDescriptor =
          result.shapeDescriptor ||
          item.shapeCandidates[0] ||
          tracking.createShapeDescriptor(result.automaticData, width, height);
        item.resultImageData = new ImageDataClass(new Uint8ClampedArray(result.data), width, height);
        item.qualityMetrics =
          result.qualityMetrics ||
          quality.createCutoutQualityMetrics(result.data, width, height, {
            backgroundColors: options.backgroundColors,
            backgroundTolerance: options.tolerance + options.feather,
          });
        item.diagnosticCanvases = {};
        const canvas = documentApi.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.putImageData(new ImageDataClass(result.data, width, height), 0, 0);
        item.resultCanvas = canvas;
        item.statistics = {
          removedPixels: result.removedPixels,
          partialPixels: result.partialPixels,
        };
        item.resultThumbnail = createThumbnailUrl(canvas);
        item.thumbnailRevision = state.thumbnailRevision;
        item.status = "processed";
        refreshQualityAnalysis();
        return item;
      })();
      item.processingPromise = processingPromise;
      try {
        return await processingPromise;
      } catch (error) {
        const ownsItemState =
          item.processingPromise === processingPromise &&
          processingRevision === Number(item.processingRevision || 0);
        if (error?.name === "AbortError") {
          if (ownsItemState) item.status = "ready";
          throw error;
        }
        if (ownsItemState) {
          item.status = "failed";
          item.error = error instanceof Error ? error.message : String(error);
          item.qualityMetrics = null;
          item.quality = null;
        }
        throw error;
      } finally {
        if (item.processingPromise === processingPromise) item.processingPromise = null;
      }
    }

    /**
     * Replaces the queue with validated local files.
     * @param {FileList|File[]} fileList Browser files.
     * @returns {Promise<void>}
     */
    async function loadFiles(fileList) {
      const candidates = Array.from(fileList || []);
      const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
      const supported = candidates.filter(
        (file) =>
          supportedMimeTypes.has(String(file.type || "").toLowerCase()) ||
          /\.(png|jpe?g|webp)$/i.test(file.name || ""),
      );
      const unsupported = candidates.length - supported.length;
      const oversized = supported.filter((file) => file.size > maxImageFileBytes).length;
      const files = supported.filter((file) => file.size <= maxImageFileBytes);
      if (!files.length) {
        setStatus(oversized ? text("oversizedFiles", { count: oversized }) : text("invalidFiles"), "error");
        return;
      }
      if (state.items.length + files.length > 240) {
        setStatus(text("tooMany"), "error");
        return;
      }
      stopBatchPlayback();
      state.busy = true;
      renderStatus();
      try {
        const settled = await mapSettledWithConcurrency(files, loadFileImage);
        const additions = [];
        const failures = [];
        let retainedPixels = imagePixelBudget.totalPixels(state.items.map((item) => item.sourceCanvas));
        settled.forEach((result, index) => {
          if (result.status === "fulfilled") {
            try {
              const budget = assertImagePixelBudget(result.value, retainedPixels);
              additions.push(createItem(result.value, files[index].name));
              retainedPixels = budget.totalPixels;
            } catch (error) {
              failures.push(error.message);
            }
          } else {
            failures.push(files[index].name);
          }
        });
        if (!additions.length) throw new Error(failures.join(", ") || text("invalidFiles"));
        const firstAddedIndex = state.items.length;
        additions.forEach((item) => {
          item.automaticCutoutActivated = false;
          item.processingActivated = false;
        });
        state.items.push(...additions);
        state.sessionMode = "batch";
        state.sourceKind = state.sourceKind && state.sourceKind !== "files" ? "mixed" : "files";
        state.selectedIndex = firstAddedIndex;
        state.selectedIds = new Set([additions[0].id]);
        state.selectionAnchorIndex = firstAddedIndex;
        state.previewScale = null;
        state.previewFitScale = null;
        state.previewPanX = 0;
        state.previewPanY = 0;
        state.previewMode = "result";
        state.qualityOnly = false;
        renderQueue();
        renderPreview();
        scheduleBatchThumbnails();
        const skipped = unsupported + oversized + failures.length;
        setStatus(
          skipped
            ? text("fileImportPartial", { count: additions.length, skipped })
            : text("selected", { count: state.items.length }),
          skipped ? "error" : "success",
        );
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        elements.cutoutFileInput.value = "";
        renderStatus();
      }
    }

    /**
     * Loads the host application's current animation frames.
     * @returns {Promise<void>}
     */
    async function loadCurrentGroup() {
      const animation = host.getCurrentAnimation?.();
      if (!animation?.frames?.length || animation.images?.length !== animation.frames.length) {
        setStatus(text("groupUnavailable"), "error");
        return;
      }
      stopBatchPlayback();
      state.thumbnailJob += 1;
      try {
        let retainedPixels = 0;
        state.items = animation.images.map((image, index) => {
          const budget = assertImagePixelBudget(image, retainedPixels);
          retainedPixels = budget.totalPixels;
          return createItem(
            image,
            animation.frames[index].name || `frame_${String(index + 1).padStart(4, "0")}.png`,
            animation.frames[index],
          );
        });
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
        return;
      }
      state.sourceKind = "group";
      state.sessionMode = "batch";
      state.items.forEach((item) => {
        item.automaticCutoutActivated = false;
        item.processingActivated = false;
      });
      state.selectedIndex = 0;
      state.selectedIds = new Set(state.items[0] ? [state.items[0].id] : []);
      state.selectionAnchorIndex = 0;
      state.previewScale = null;
      state.previewFitScale = null;
      state.previewPanX = 0;
      state.previewPanY = 0;
      state.cancelRequested = false;
      state.previewMode = "result";
      state.qualityOnly = false;
      renderQueue();
      renderPreview();
      scheduleBatchThumbnails();
      setStatus(text("groupLoaded", { name: animation.name, count: state.items.length }), "success");
    }

    /**
     * Processes every queued image while yielding between frames.
     * @param {{applyProgress?:boolean}} [options] Optional apply-to-all progress presentation.
     * @returns {Promise<{outputs:object[],failures:Array<{index:number,name:string,message:string}>,excluded:number,cancelled:boolean}>}
     */
    async function processAll(options = {}) {
      const outputs = [];
      const failures = [];
      const outputNameCounts = new Map();
      let removedPixels = 0;
      const includedItems = state.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.excluded);
      if (!includedItems.length) {
        setStatus(text("noIncluded"), "error");
        return { outputs, failures, excluded: state.items.length, cancelled: false };
      }
      stopBatchPlayback();
      state.thumbnailJob += 1;
      state.cancelRequested = false;
      state.busy = true;
      renderStatus();
      try {
        for (let queueIndex = 0; queueIndex < includedItems.length; queueIndex += 1) {
          if (state.cancelRequested) break;
          const { item, index } = includedItems[queueIndex];
          if (options.applyProgress)
            elements.cutoutRepairBatch.textContent = text("applyingProgress", {
              current: queueIndex + 1,
              total: includedItems.length,
            });
          setStatus(text("processing", { current: queueIndex + 1, total: includedItems.length }), "busy");
          try {
            const artifactRevision = `${state.thumbnailRevision}:${Number(item.processingRevision || 0)}`;
            let outputData = resultArtifacts.get(item.id, artifactRevision);
            if (!outputData) {
              await processItem(item);
              outputData =
                resultArtifacts.get(item.id, artifactRevision) || item.resultCanvas.toDataURL("image/png");
              resultArtifacts.put(item.id, artifactRevision, outputData);
            }
            removedPixels += Number(item.statistics?.removedPixels || 0);
            outputs.push(
              outputCore.createOutput({
                name: outputCore.uniquePngName(item.name, outputNameCounts),
                frame: item.frame,
                data: outputData,
                canvas: item.resultCanvas || null,
              }),
            );
          } catch (error) {
            failures.push({ index, name: item.name, message: error.message });
          }
          updateQueueCard(item);
          await new Promise((resolve) => windowApi.setTimeout(resolve, 0));
        }
        if (state.cancelRequested) {
          setStatus(text("cancelled"), "error");
          return {
            outputs,
            failures,
            excluded: state.items.length - includedItems.length,
            cancelled: true,
          };
        }
        setStatus(
          failures.length
            ? text("partialProcessed", {
                count: outputs.length,
                excluded: state.items.length - includedItems.length,
                failed: failures.length,
              })
            : text("processed", { count: outputs.length, pixels: removedPixels.toLocaleString() }),
          failures.length ? "error" : "success",
        );
        return {
          outputs,
          failures,
          excluded: state.items.length - includedItems.length,
          cancelled: false,
        };
      } finally {
        state.busy = false;
        if (options.applyProgress) renderSessionMode();
        renderStatus();
      }
    }

    /**
     * Downloads every successfully processed image in one ZIP archive.
     * @returns {Promise<void>}
     */
    async function downloadAll() {
      try {
        const { outputs, failures, cancelled } = await processAll();
        if (cancelled || !outputs.length) return;
        state.cancelRequested = false;
        state.busy = true;
        renderStatus();
        const animation = host.getCurrentAnimation?.();
        const manifest = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          animation: animation?.name || "",
          sourceKind: state.sourceKind,
          settings: {
            tolerance: Number(elements.cutoutTolerance.value),
            edgeBoost: Number(elements.cutoutEdgeBoost.value),
            feather: Number(elements.cutoutFeather.value),
            chromaFeather: Number(elements.cutoutChromaFeather.value),
            alphaLow: Number(elements.cutoutAlphaLow.value),
            alphaHigh: Number(elements.cutoutAlphaHigh.value),
            alphaThreshold: Number(elements.cutoutAlphaThreshold.value),
            perceptual: elements.cutoutPerceptual.checked,
            connected: elements.cutoutConnected.checked,
          },
          totals: {
            images: state.items.length,
            exported: outputs.length,
            excluded: state.items.filter((item) => item.excluded).length,
            failed: failures.length,
          },
          frames: state.items.map((item, index) => ({
            index: index + 1,
            name: item.name,
            excluded: item.excluded,
            status: item.status,
            error: item.error || "",
          })),
        };
        const archiveEntries = outputCore.createArchiveEntries(outputs, JSON.stringify(manifest, null, 2));
        const archive = await batchZip.buildZip(archiveEntries, {
          compress: true,
          onProgress(current, total) {
            if (state.cancelRequested) throw new Error("BATCH_CANCELLED");
            setStatus(text("zipping", { current, total }), "busy");
          },
        });
        if (state.cancelRequested) {
          setStatus(text("cancelled"), "error");
          return;
        }
        const stem =
          String(animation?.name || "cutout-batch")
            .replace(/[^\p{L}\p{N}._-]+/gu, "_")
            .replace(/^_+|_+$/g, "") || "cutout-batch";
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}Z$/, "");
        const url = urlApi.createObjectURL(archive);
        const link = documentApi.createElement("a");
        link.download = `${stem}-${timestamp}.zip`;
        link.href = url;
        documentApi.body.appendChild(link);
        link.click();
        link.remove();
        windowApi.setTimeout(() => urlApi.revokeObjectURL(url), 1000);
        setStatus(text("downloaded", { count: outputs.length, failed: failures.length }), "success");
      } catch (error) {
        if (state.cancelRequested || error.message === "BATCH_CANCELLED") {
          setStatus(text("cancelled"), "error");
        } else {
          setStatus(text("failed", { message: error.message }), "error");
        }
      } finally {
        state.busy = false;
        renderStatus();
      }
    }

    /**
     * Applies processed images to the active animation after explicit confirmation.
     * @param {{live?:boolean,publishedCanvases?:HTMLCanvasElement[]}} [options] Live workset publication options.
     * @returns {Promise<void>}
     */
    async function applyCurrentGroup(options = {}) {
      const liveApply = state.worksetResolver?.liveApply;
      if (options.live && typeof liveApply !== "function") return;
      if (state.sourceKind === "workset" && typeof state.worksetResolver === "function") {
        if (!options.live && state.sessionMode === "single" && !selectedItem()?.processingActivated) return;
        const included = state.items.filter((item) => !item.excluded).length;
        if (included !== state.items.length) {
          setStatus(text("worksetMismatch", { included, total: state.items.length }), "error");
          return;
        }
        try {
          const publishedCanvases = Array.isArray(options.publishedCanvases)
            ? options.publishedCanvases
            : null;
          const publishedOutputs = publishedCanvases?.map((canvas, index) => ({
            name: state.items[index]?.name || `frame_${index + 1}.png`,
            frame: state.items[index]?.frame || null,
            canvas,
          }));
          if (publishedOutputs && publishedOutputs.every((output) => output.canvas)) {
            await liveApply(publishedOutputs);
            state.items.forEach((item, index) => {
              item.publishedCanvas = publishedOutputs[index].canvas;
            });
            setStatus(text("worksetApplied", { count: publishedOutputs.length }), "success");
            return;
          }
          const { outputs, failures, cancelled } = await processAll({ applyProgress: options.live });
          if (cancelled) return;
          if (failures.length || outputs.length !== state.items.length) {
            const first = failures[0];
            setStatus(
              text("frameFailed", {
                index: (first?.index ?? 0) + 1,
                message: first?.message || "output mismatch",
              }),
              "error",
            );
            return;
          }
          setStatus(text("worksetApplied", { count: outputs.length }), "success");
          if (options.live) {
            await liveApply(outputs);
            state.items.forEach((item, index) => {
              item.publishedCanvas = outputs[index].canvas;
            });
          } else close(outputs);
        } catch (error) {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      const animation = host.getCurrentAnimation?.();
      if (!animation?.frames?.length) {
        setStatus(text("groupUnavailable"), "error");
        return;
      }
      const includedItems = state.items.filter((item) => !item.excluded);
      if (includedItems.length !== animation.frames.length) {
        setStatus(
          text("applyMismatch", { files: includedItems.length, frames: animation.frames.length }),
          "error",
        );
        return;
      }
      const confirmed = await requestConfirmation(text("applyConfirm"), [
        [text("applyAnimation"), animation.name || "—"],
        [text("applyFrames"), includedItems.length],
        [text("applyExcluded"), state.items.length - includedItems.length],
      ]);
      if (!confirmed) return;
      try {
        const { outputs, failures, cancelled } = await processAll({ applyProgress: options.live });
        if (cancelled) return;
        if (failures.length || outputs.length !== animation.frames.length) {
          const first = failures[0];
          setStatus(
            text("frameFailed", {
              index: (first?.index ?? 0) + 1,
              message: first?.message || "output mismatch",
            }),
            "error",
          );
          return;
        }
        await host.applyToCurrentAnimation?.(outputs);
        setStatus(text("applied", { count: outputs.length }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      }
    }

    return { loadFiles, loadCurrentGroup, processItem, processAll, downloadAll, applyCurrentGroup };
  }

  return { createController };
});
