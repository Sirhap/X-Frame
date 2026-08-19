(function attachMediaExportDialog(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MediaExportDialog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the organizer media-export dialog.
   * @param {{elements:Record<string,Element>,getLanguage:()=>string,getSummary:()=>object,getPreviewItems?:()=>Array<object>,onExport:(options:object)=>Promise<object|null>,fetchImpl?:typeof fetch,resumeLastExport?:(options:object)=>Promise<object|null>,cancelRecoveredExport?:(jobId:string)=>Promise<object>,onRecoveryChange?:(status:object|null)=>void}} dependencies UI adapters.
   */
  function createController(dependencies) {
    const { elements, getLanguage, getSummary, onExport, fetchImpl = root.fetch } = dependencies || {};
    if (!elements?.mediaExportDialog || typeof onExport !== "function") {
      throw new TypeError("Media export dialog dependencies are required.");
    }
    let returnFocus = null;
    let capabilityRequest = 0;
    let localExportAvailable = false;
    let submitting = false;
    let activeController = null;
    let recoveryController = null;
    let recoveredJob = null;
    let recoveringActive = false;
    let previewMode = "frame";
    let previewIndex = 0;
    let previewRenderToken = 0;
    let previewAnimationTimer = 0;
    let recipeHistoryTimer = 0;
    let recipeHistoryIndex = -1;
    let restoringRecipeHistory = false;
    let recipeHistory = [];
    let exportSummary = {};
    const localClient = root.LocalMediaExportClient;
    const recipeCore = root.ExportRecipeCore;
    const resumeLastExport = dependencies.resumeLastExport || localClient?.resumeLastExport;
    const cancelRecoveredExport =
      dependencies.cancelRecoveredExport ||
      (typeof localClient?.cancelJob === "function"
        ? (jobId) => localClient.cancelJob(jobId, { fetchImpl })
        : null);

    /** Returns the selected value from a reference-style segmented control. */
    function checkedValue(name, fallback) {
      return elements.mediaExportDialog.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
    }

    /** Returns the single selected output format. */
    function currentFormat() {
      return checkedValue("mediaExportFormat", "spritesheet");
    }

    /** Stops the transient animation preview without changing export data. */
    function stopPreviewAnimation() {
      root.clearTimeout(previewAnimationTimer);
      previewAnimationTimer = 0;
    }

    /** Selects one preview surface and updates its segmented control. */
    function setPreviewMode(mode) {
      previewMode = ["frame", "animation", "sheet"].includes(mode) ? mode : "frame";
      ["Frame", "Animation", "Sheet"].forEach((suffix) => {
        const value = suffix.toLowerCase();
        elements[`mediaExportPreview${suffix}`].setAttribute("aria-pressed", String(value === previewMode));
      });
      stopPreviewAnimation();
      schedulePreview();
    }

    /** Draws a logical export canvas into the fixed preview viewport. */
    function drawPreviewSource(source, logicalWidth, logicalHeight) {
      const canvas = elements.mediaExportPreviewCanvas;
      const maximumPreviewEdge = 1024;
      const scale = Math.min(1, maximumPreviewEdge / Math.max(logicalWidth, logicalHeight));
      canvas.width = Math.max(1, Math.round(logicalWidth * scale));
      canvas.height = Math.max(1, Math.round(logicalHeight * scale));
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Export preview canvas is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = checkedValue("mediaExportInterpolation", "smooth") !== "nearest";
      context.drawImage(source, 0, 0, logicalWidth, logicalHeight, 0, 0, canvas.width, canvas.height);
    }

    /** Formats a conservative RGBA-based output estimate without implying an exact encoded size. */
    function estimatedFileSize(width, height, pages = 1) {
      const bytes = Math.max(1, width * height * 4 * pages * 0.35);
      const size =
        bytes >= 1024 * 1024
          ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return english() ? `about ${size}` : `约 ${size}`;
    }

    /** Renders frame, animation, or atlas preview through the actual export recipe. */
    async function renderPreview() {
      const token = ++previewRenderToken;
      stopPreviewAnimation();
      const items = dependencies.getPreviewItems?.() || [];
      if (!items.length || typeof recipeCore?.renderRecipe !== "function") {
        elements.mediaExportPreviewMeta.textContent = english()
          ? "Import frames to preview the export."
          : "导入帧后可预览导出结果。";
        return;
      }
      try {
        const recipe = readRecipe();
        const rendered = recipeCore.renderRecipe(items, recipe, { document: root.document });
        if (token !== previewRenderToken) return;
        if (previewMode === "sheet") {
          const core = root.MediaExportCore;
          const plan = core.planSpriteSheets(rendered, {
            columns: recipe.sheetColumns,
            gap: recipe.sheetGap,
            maxTextureSize: recipe.maxTextureSize,
            fixedPageSize: recipe.sheetFixedSize,
            powerOfTwo: recipe.sheetPowerOfTwo,
          });
          const page = plan.pages[Math.min(previewIndex, plan.pages.length - 1)] || plan.pages[0];
          previewIndex = page.index;
          const sheet = root.document.createElement("canvas");
          sheet.width = page.width;
          sheet.height = page.height;
          const context = sheet.getContext("2d", { alpha: true });
          plan.placements
            .filter((entry) => entry.page === page.index)
            .forEach((entry) =>
              context.drawImage(rendered[entry.index].image, entry.x, entry.y, entry.width, entry.height),
            );
          drawPreviewSource(sheet, page.width, page.height);
          elements.mediaExportPreviewTitle.textContent = english()
            ? "Sprite Sheet preview"
            : "Sprite Sheet 预览";
          elements.mediaExportPreviewSize.textContent = `${page.width} × ${page.height}`;
          elements.mediaExportPreviewPage.textContent = `${page.index + 1} / ${plan.pages.length}`;
          const fileSize = estimatedFileSize(page.width, page.height, plan.pages.length);
          elements.mediaExportPreviewMeta.textContent = english()
            ? `${page.count} frames · ${plan.gap}px gap · ${fileSize}`
            : `本页 ${page.count} 帧 · 间距 ${plan.gap}px · ${fileSize}`;
          elements.mediaExportEstimate.textContent = english()
            ? `Estimate: ${page.width} × ${page.height} px · ${plan.pages.length} pages · ${rendered.length} frames · ${fileSize}`
            : `预估：${page.width} × ${page.height} px · ${plan.pages.length} 张 · ${rendered.length} 帧 · ${fileSize}`;
          if (elements.mediaExportColumnsAuto.checked)
            elements.mediaExportColumns.value = String(page.columns);
          elements.mediaExportColumnsTotal.textContent = `/ ${page.columns}`;
          return;
        }
        previewIndex = ((previewIndex % rendered.length) + rendered.length) % rendered.length;
        const frame = rendered[previewIndex];
        drawPreviewSource(frame.image, frame.width, frame.height);
        elements.mediaExportPreviewTitle.textContent =
          previewMode === "animation"
            ? english()
              ? "Animation preview"
              : "动画预览"
            : english()
              ? "Frame preview"
              : "单帧预览";
        elements.mediaExportPreviewSize.textContent = `${frame.width} × ${frame.height}`;
        elements.mediaExportPreviewPage.textContent = `${previewIndex + 1} / ${rendered.length}`;
        elements.mediaExportPreviewMeta.textContent = `${frame.name || `Frame ${previewIndex + 1}`} · ${frame.durationMs}ms · ${recipe.anchor} · ${estimatedFileSize(frame.width, frame.height)}`;
        if (previewMode === "animation") {
          previewAnimationTimer = root.setTimeout(() => {
            previewIndex = (previewIndex + 1) % rendered.length;
            void renderPreview();
          }, frame.durationMs);
        }
      } catch (error) {
        elements.mediaExportPreviewMeta.textContent =
          error?.message || (english() ? "Preview failed." : "预览生成失败。");
      }
    }

    /** Coalesces rapid slider and select changes into one preview render. */
    function schedulePreview() {
      const token = ++previewRenderToken;
      const enqueue = root.requestAnimationFrame || ((callback) => root.setTimeout(callback, 0));
      enqueue(() => {
        if (token !== previewRenderToken) return;
        void renderPreview();
      });
    }

    /** Returns true when English strings should be shown. */
    const english = () => getLanguage?.() === "en";

    /** Sets a visible status and semantic tone. */
    function setStatus(message, tone = "idle") {
      elements.mediaExportStatus.textContent = message;
      elements.mediaExportStatus.dataset.tone = tone;
    }

    /** Returns the transient recipe controls which participate in undo and redo. */
    function recipeControls() {
      return Array.from(
        elements.mediaExportDialog.querySelectorAll(".mediaExportRecipe input, .mediaExportRecipe select"),
      );
    }

    /** Captures the visible recipe controls without persisting them to the project. */
    function captureRecipeSnapshot() {
      return recipeControls().map((control, index) => ({
        key: control.id || `${control.name || "control"}:${control.value}:${index}`,
        checked: ["checkbox", "radio"].includes(control.type) ? control.checked === true : undefined,
        value: control.value,
      }));
    }

    /** Restores one recipe snapshot and refreshes the shared export preview. */
    function restoreRecipeSnapshot(snapshot) {
      restoringRecipeHistory = true;
      const values = new Map(snapshot.map((entry) => [entry.key, entry]));
      recipeControls().forEach((control, index) => {
        const key = control.id || `${control.name || "control"}:${control.value}:${index}`;
        const entry = values.get(key);
        if (!entry) return;
        if (["checkbox", "radio"].includes(control.type)) control.checked = entry.checked === true;
        else control.value = String(entry.value);
      });
      restoringRecipeHistory = false;
      syncReferenceControls();
      schedulePreview();
    }

    /** Commits a changed recipe state while discarding an invalidated redo branch. */
    function commitRecipeHistory() {
      root.clearTimeout(recipeHistoryTimer);
      recipeHistoryTimer = 0;
      if (restoringRecipeHistory) return;
      const serialized = JSON.stringify(captureRecipeSnapshot());
      if (recipeHistory[recipeHistoryIndex] === serialized) return;
      recipeHistory.splice(recipeHistoryIndex + 1);
      recipeHistory.push(serialized);
      if (recipeHistory.length > 100) recipeHistory.shift();
      recipeHistoryIndex = recipeHistory.length - 1;
    }

    /** Coalesces continuous slider input into one undo step. */
    function scheduleRecipeHistory() {
      if (restoringRecipeHistory) return;
      root.clearTimeout(recipeHistoryTimer);
      recipeHistoryTimer = root.setTimeout(commitRecipeHistory, 180);
    }

    /** Starts a fresh, dialog-local undo history. */
    function resetRecipeHistory() {
      root.clearTimeout(recipeHistoryTimer);
      recipeHistoryTimer = 0;
      recipeHistory = [JSON.stringify(captureRecipeSnapshot())];
      recipeHistoryIndex = 0;
    }

    /** Undoes the most recent export-recipe adjustment. */
    function undoRecipe() {
      commitRecipeHistory();
      if (recipeHistoryIndex <= 0) return false;
      recipeHistoryIndex -= 1;
      restoreRecipeSnapshot(JSON.parse(recipeHistory[recipeHistoryIndex]));
      setStatus(english() ? "Export adjustment undone." : "已撤销上一步导出调整。", "idle");
      return true;
    }

    /** Redoes one previously undone export-recipe adjustment. */
    function redoRecipe() {
      root.clearTimeout(recipeHistoryTimer);
      recipeHistoryTimer = 0;
      if (recipeHistoryIndex >= recipeHistory.length - 1) return false;
      recipeHistoryIndex += 1;
      restoreRecipeSnapshot(JSON.parse(recipeHistory[recipeHistoryIndex]));
      setStatus(english() ? "Export adjustment redone." : "已重做导出调整。", "idle");
      return true;
    }

    /** @returns {string} Why GIF/MP4 stay disabled in the web build. */
    function localEncodeUnavailableReason() {
      return english()
        ? "GIF/MP4/MOV need the local app with FFmpeg. This web page cannot encode them."
        : "网页版不能编码 GIF/MP4。请使用安装了 FFmpeg 的本地版。";
    }

    /** Applies the current local-encoder availability to GIF/MP4/MOV controls. */
    function applyLocalFormatAvailability(busy) {
      const unavailable = !localExportAvailable;
      const reason = unavailable ? localEncodeUnavailableReason() : "";
      [elements.mediaExportGif, elements.mediaExportMp4, elements.mediaExportMov]
        .filter(Boolean)
        .forEach((input) => {
          input.disabled = busy || unavailable;
          input.title = input.disabled && unavailable ? reason : "";
        });
    }

    /** Locks format choices during export while preserving local capability state. */
    function renderSubmittingState() {
      const busy = submitting || recoveringActive;
      elements.mediaExportFrames.disabled = busy;
      elements.mediaExportSheet.disabled = busy;
      applyLocalFormatAvailability(busy);
      elements.mediaExportSubmit.disabled = busy;
      elements.mediaExportDialog.setAttribute("aria-busy", String(busy));
      elements.mediaExportCancel.textContent = busy
        ? english()
          ? "Cancel export"
          : "取消导出"
        : english()
          ? "Cancel"
          : "取消";
    }

    /** Updates local-only cards from the local server capability response. */
    async function refreshCapabilities() {
      const request = ++capabilityRequest;
      [elements.mediaExportGif, elements.mediaExportMp4, elements.mediaExportMov]
        .filter(Boolean)
        .forEach((input) => {
          input.disabled = true;
          input.checked = false;
        });
      localExportAvailable = false;
      elements.mediaExportLocalHint.textContent = english()
        ? "Checking local FFmpeg…"
        : "正在检查本地 FFmpeg…";
      try {
        const response = await fetchImpl("/api/media-export/capabilities", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("LOCAL_EXPORT_UNAVAILABLE");
        const payload = await response.json();
        if (request !== capabilityRequest) return;
        const available = payload?.ffmpeg?.available === true;
        localExportAvailable = available;
        renderSubmittingState();
        elements.mediaExportLocalHint.textContent = available
          ? english()
            ? `FFmpeg ${payload.ffmpeg.version || "ready"} · local encoding available`
            : `FFmpeg ${payload.ffmpeg.version || "已就绪"} · 可使用本地编码`
          : english()
            ? "Install FFmpeg and use the local app for GIF or transparent MOV."
            : "GIF 和透明 MOV 需要在本地版安装 FFmpeg。";
      } catch (_error) {
        if (request !== capabilityRequest) return;
        localExportAvailable = false;
        renderSubmittingState();
        elements.mediaExportLocalHint.textContent = english()
          ? "GIF and transparent MOV require the local app with FFmpeg."
          : "GIF 和透明 MOV 需要本地版与 FFmpeg。";
      }
    }

    /** Opens the export workbench in a modal or an in-page delivery mount. */
    function open(options = {}) {
      returnFocus = root.document?.activeElement;
      const mount = options.mount || null;
      if (mount?.replaceChildren) mount.replaceChildren(elements.mediaExportDialog);
      else root.document?.body?.append?.(elements.mediaExportDialog);
      elements.mediaExportDialog.dataset.presentation = mount ? "embedded" : "dialog";
      elements.mediaExportDialog.setAttribute("role", mount ? "region" : "dialog");
      if (mount) elements.mediaExportDialog.removeAttribute("aria-modal");
      else elements.mediaExportDialog.setAttribute("aria-modal", "true");
      exportSummary = getSummary?.() || {};
      elements.mediaExportFrameCount.textContent = String(exportSummary.frameCount || 0);
      elements.mediaExportCanvas.textContent = exportSummary.canvas || "—";
      const sourceName = String(exportSummary.name || "animation").replace(/\.[^.]+$/, "");
      elements.mediaExportFilename.value = sourceName;
      elements.mediaExportImageName.value = sourceName;
      elements.mediaExportZipImageName.value = sourceName;
      delete elements.mediaExportImageName.dataset.edited;
      delete elements.mediaExportZipImageName.dataset.edited;
      elements.mediaExportOriginalResolution.textContent = `原始 (${exportSummary.canvas || "—"})`;
      elements.mediaExportGifFps.value = String(Math.max(1, Math.min(50, Number(exportSummary.fps) || 12)));
      elements.mediaExportGifFpsRange.value = elements.mediaExportGifFps.value;
      elements.mediaExportDialog.hidden = false;
      elements.mediaExportCancel.hidden = Boolean(mount);
      if (mount) root.document?.body.classList.remove("mediaExportOpen");
      else root.document?.body.classList.add("mediaExportOpen");
      renderDownloads([]);
      setStatus(english() ? "Choose at least one output." : "选择至少一种输出格式。");
      if (!mount) elements.mediaExportFrames.focus();
      syncReferenceControls();
      resetRecipeHistory();
      previewIndex = 0;
      setPreviewMode(elements.mediaExportSheet.checked ? "sheet" : "animation");
      void refreshCapabilities();
      void restoreLastJob();
    }

    /** Closes the dialog and returns focus to the organizer export button. */
    function close() {
      if (submitting) {
        activeController?.abort();
        setStatus(english() ? "Cancelling export…" : "正在取消导出…", "busy");
        return;
      }
      recoveryController?.abort();
      stopPreviewAnimation();
      root.clearTimeout(recipeHistoryTimer);
      previewRenderToken += 1;
      recoveryController = null;
      capabilityRequest += 1;
      elements.mediaExportDialog.hidden = true;
      elements.mediaExportCancel.hidden = false;
      root.document?.body.classList.remove("mediaExportOpen");
      returnFocus?.focus?.();
    }

    /** Keeps keyboard focus inside the dialog and supports Escape. @param {KeyboardEvent} event */
    function handleKeydown(event) {
      if (elements.mediaExportDialog.hidden) return;
      if (elements.mediaExportDialog.dataset.presentation === "embedded") return;
      const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
      const key = String(event.key || "").toLowerCase();
      if (shortcut && (key === "z" || key === "y")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === "y" || (key === "z" && event.shiftKey)) redoRecipe();
        else undoRecipe();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        elements.mediaExportDialog.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && root.document?.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && root.document?.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /** Renders local file download links without forcing multiple browser downloads. */
    function renderDownloads(downloads) {
      elements.mediaExportDownloads.replaceChildren();
      const entries = Array.isArray(downloads) ? downloads : [];
      elements.mediaExportDownloads.hidden = entries.length === 0;
      entries.forEach((download) => {
        const link = root.document.createElement("a");
        link.href = download.url;
        link.download = download.filename || "";
        link.textContent = download.label || download.filename || "Download";
        elements.mediaExportDownloads.append(link);
      });
    }

    /** Renders a recovered local job into existing status and download regions. */
    function renderRecoveredJob(status) {
      recoveredJob = status || null;
      recoveringActive = ["queued", "running"].includes(status?.status);
      renderSubmittingState();
      dependencies.onRecoveryChange?.(recoveredJob);
      if (!status) return;
      renderDownloads(status.downloads);
      const progress = Math.max(0, Math.min(100, Math.round(Number(status.progress || 0) * 100)));
      if (recoveringActive) {
        setStatus(
          english() ? `Restored local export · ${progress}%` : `已恢复本地导出任务 · ${progress}%`,
          "busy",
        );
      } else if (status.status === "completed") {
        setStatus(
          english()
            ? "Previous local export restored. Downloads are ready below."
            : "已恢复上次本地导出结果，可在下方下载。",
          "success",
        );
      } else if (status.status === "failed") {
        const restarted = status.errorCode === "server_restarted";
        const uploadInterrupted = status.errorCode === "upload_interrupted";
        setStatus(
          restarted
            ? english()
              ? "Local service restarted during export. Cancel this task and export again."
              : "本地服务在导出时重启。请取消此任务后重新导出。"
            : uploadInterrupted
              ? english()
                ? "Frame upload was interrupted. Cancel this task and export again."
                : "帧上传已中断。请取消此任务后重新导出。"
              : status.error || (english() ? "Previous export failed." : "上次导出失败。"),
          "error",
        );
      }
    }

    /** Reconnects to the most recent local export without restarting frame upload. */
    async function restoreLastJob(options = {}) {
      if (typeof resumeLastExport !== "function" || submitting) return null;
      recoveryController?.abort();
      recoveryController = typeof root.AbortController === "function" ? new root.AbortController() : null;
      try {
        const status = await resumeLastExport({
          fetchImpl,
          poll: options.poll !== false,
          signal: recoveryController?.signal,
          onStatus: renderRecoveredJob,
        });
        renderRecoveredJob(status);
        return status;
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(error?.message || (english() ? "Task recovery failed." : "任务恢复失败。"), "error");
        }
        return null;
      } finally {
        recoveryController = null;
      }
    }

    /** Cancels and forgets the recovered local task while preserving generated browser files. */
    async function cancelRecoveredJob() {
      if (!recoveredJob?.id || typeof cancelRecoveredExport !== "function") return null;
      setStatus(english() ? "Cancelling recovered export…" : "正在取消已恢复任务…", "busy");
      try {
        const result = await cancelRecoveredExport(recoveredJob.id);
        recoveredJob = null;
        recoveringActive = false;
        renderDownloads([]);
        renderSubmittingState();
        dependencies.onRecoveryChange?.(null);
        setStatus(english() ? "Recovered export cancelled." : "已取消恢复的导出任务。");
        return result;
      } catch (error) {
        setStatus(error?.message || (english() ? "Cancellation failed." : "取消失败。"), "error");
        return null;
      }
    }

    /** Handles the semantic cancel action separately from dismissing the dialog. */
    function handleCancel() {
      if (submitting) {
        close();
      } else if (
        ["queued", "running", "failed"].includes(recoveredJob?.status) &&
        typeof cancelRecoveredExport === "function"
      ) {
        void cancelRecoveredJob();
      } else {
        close();
      }
    }

    /** Starts the selected export formats. */
    async function submit() {
      const formats = {
        frames: elements.mediaExportFrames.checked,
        spritesheet: elements.mediaExportSheet.checked,
        gif: elements.mediaExportGif.checked && !elements.mediaExportGif.disabled,
        mp4: elements.mediaExportMp4?.checked === true && !elements.mediaExportMp4.disabled,
        mov: elements.mediaExportMov.checked && !elements.mediaExportMov.disabled,
      };
      const recipe = readRecipe();
      if (formats.mp4 && recipe.background !== "color") {
        setStatus(english() ? "MP4 requires a solid background." : "MP4 必须选择纯色背景。", "error");
        return;
      }
      if (!Object.values(formats).some(Boolean)) {
        setStatus(english() ? "Select at least one output format." : "请至少选择一种输出格式。", "error");
        return;
      }
      submitting = true;
      recoveryController?.abort();
      activeController = typeof root.AbortController === "function" ? new root.AbortController() : null;
      renderSubmittingState();
      setStatus(english() ? "Preparing export…" : "正在准备导出…", "busy");
      try {
        const result = await onExport({ confirmed: true, formats, recipe, signal: activeController?.signal });
        if (!result) {
          setStatus(english() ? "Export cancelled." : "已取消导出。");
          return;
        }
        renderDownloads(result?.downloads);
        setStatus(
          english()
            ? "Export complete. Browser files were downloaded; local files are listed below."
            : "导出完成。浏览器文件已下载，本地媒体可在下方单独下载。",
          "success",
        );
      } catch (error) {
        const cancelled = error?.name === "AbortError" || activeController?.signal.aborted;
        setStatus(
          cancelled
            ? english()
              ? "Export cancelled."
              : "已取消导出。"
            : error?.message || (english() ? "Export failed." : "导出失败。"),
          cancelled ? "idle" : "error",
        );
      } finally {
        submitting = false;
        activeController = null;
        renderSubmittingState();
        if (resultHasLocalFormats(elements)) void restoreLastJob({ poll: false });
      }
    }

    /** Returns true when current choices include an FFmpeg-backed format. */
    function resultHasLocalFormats(currentElements) {
      return (
        currentElements.mediaExportGif.checked ||
        currentElements.mediaExportMp4?.checked ||
        currentElements.mediaExportMov.checked
      );
    }

    /** Synchronizes reference-style controls with the renderer-facing recipe fields. */
    function syncReferenceControls() {
      const format = currentFormat();
      elements.mediaExportSheetSettings.hidden = format !== "spritesheet";
      elements.mediaExportZipSettings.hidden = format !== "frames";
      elements.mediaExportGifSettings.hidden = format !== "gif";
      elements.mediaExportMp4Settings.hidden = format !== "mp4";
      if (format === "spritesheet" && previewMode !== "sheet") setPreviewMode("sheet");
      if (format !== "spritesheet" && previewMode === "sheet") setPreviewMode("animation");

      const resolution = checkedValue("mediaExportResolution", "512");
      const custom = resolution === "custom";
      elements.mediaExportCustomSize.hidden = !custom;
      if (resolution === "original") {
        elements.mediaExportCanvasMode.value = "original";
      } else {
        elements.mediaExportCanvasMode.value = "custom";
        if (!custom) {
          elements.mediaExportWidth.value = resolution;
          elements.mediaExportHeight.value = resolution;
        }
      }
      const width = Math.max(
        1,
        Number(elements.mediaExportWidth.value) || Number(exportSummary.width) || 512,
      );
      const height = Math.max(
        1,
        Number(elements.mediaExportHeight.value) || Number(exportSummary.height) || 512,
      );
      const horizontal = Math.round(width / 2);
      const vertical = Math.round(height / 2);
      elements.mediaExportOffsetXRange.min = String(-width);
      elements.mediaExportOffsetXRange.max = String(width);
      elements.mediaExportOffsetYRange.min = String(-height);
      elements.mediaExportOffsetYRange.max = String(height);
      elements.mediaExportOffsetXMin.textContent = `−${horizontal}`;
      elements.mediaExportOffsetXMax.textContent = String(horizontal);
      elements.mediaExportOffsetYMin.textContent = `−${vertical}`;
      elements.mediaExportOffsetYMax.textContent = String(vertical);

      if (format === "mp4" && checkedValue("mediaExportBackground", "edge") !== "color") {
        elements.mediaExportDialog.querySelector(
          'input[name="mediaExportBackground"][value="color"]',
        ).checked = true;
      }
      const background = checkedValue("mediaExportBackground", "edge");
      elements.mediaExportFillColorRow.hidden = background !== "color";
      elements.mediaExportBackgroundColor.value = elements.mediaExportFillColor.value;
      elements.mediaExportExtrude.value = background === "edge" ? "1" : "0";
      elements.mediaExportPadding.value = "0";

      elements.mediaExportColumns.disabled = elements.mediaExportColumnsAuto.checked;
      const imageName =
        elements.mediaExportImageName.value || elements.mediaExportFilename.value || "animation";
      const zipName =
        elements.mediaExportZipImageName.value || elements.mediaExportFilename.value || "animation";
      elements.mediaExportImageNameHint.textContent = `${imageName}1.png，${imageName}2.png，…`;
      elements.mediaExportZipImageNameHint.textContent = `${zipName}1.png，${zipName}2.png，…`;
      elements.mediaExportFillColorValue.textContent = elements.mediaExportFillColor.value.toUpperCase();
    }

    /** Builds a validated recipe which is deliberately not persisted into the project. */
    function readRecipe() {
      const value = (name, fallback) => elements[name]?.value ?? fallback;
      const speed = value("mediaExportSpeed", "1");
      const textureSize = checkedValue("mediaExportTextureSize", "2048");
      const background = checkedValue("mediaExportBackground", "edge");
      const format = currentFormat();
      const raw = {
        preset: value("mediaExportPreset", "atlas"),
        canvasMode: value("mediaExportCanvasMode", "union"),
        width: value("mediaExportWidth", 512),
        height: value("mediaExportHeight", 512),
        fit: checkedValue("mediaExportFit", "contain"),
        anchor: value("mediaExportAnchor", "bottom-center"),
        scaleX: value("mediaExportScaleX", 100),
        scaleY: value("mediaExportScaleY", 100),
        offsetX: value("mediaExportOffsetX", 0),
        offsetY: value("mediaExportOffsetY", 0),
        padding: 0,
        extrude: background === "edge" ? 1 : 0,
        interpolation: checkedValue("mediaExportInterpolation", "smooth"),
        background,
        backgroundColor: value("mediaExportFillColor", "#f0f0f0"),
        trim: elements.mediaExportTrimTransparent.checked ? "union" : "none",
        speed,
        timing: speed === "1" ? "keep" : "speed",
        sheetColumns: elements.mediaExportColumnsAuto.checked ? 0 : value("mediaExportColumns", 4),
        sheetGap: value("mediaExportGap", 0),
        maxTextureSize: textureSize === "max" ? 8192 : textureSize,
        sheetFixedSize: textureSize !== "max",
        sheetPowerOfTwo: elements.mediaExportPowerOfTwo.checked,
        outputName: value("mediaExportFilename", "animation"),
        imageName:
          format === "frames"
            ? value("mediaExportZipImageName", "animation")
            : value("mediaExportImageName", "animation"),
        sheetQuality:
          format === "frames"
            ? checkedValue("mediaExportZipQuality", "png32")
            : checkedValue("mediaExportQuality", "png32"),
        metadataJson: elements.mediaExportMetadataJson.checked,
        metadataGodot: elements.mediaExportMetadataGodot.checked,
        metadataUnity: elements.mediaExportMetadataUnity.checked,
        metadataPlist: elements.mediaExportMetadataPlist.checked,
        gifLoop: elements.mediaExportGifLoop.checked,
        gifFps: value("mediaExportGifFps", 12),
        gifAlphaThreshold: value("mediaExportGifAlpha", 128),
        gifPalette: checkedValue("mediaExportGifPalette", "stable"),
        gifDenoise: checkedValue("mediaExportGifDenoise", "standard"),
        gifCompression: checkedValue("mediaExportGifCompression", "light"),
        gifSoften: checkedValue("mediaExportGifSoften", "off"),
        mp4Fps: value("mediaExportMp4Fps", 30),
        mp4Quality: checkedValue("mediaExportMp4Quality", "medium"),
        outputFormat: format,
      };
      return typeof recipeCore?.normalizeRecipe === "function" ? recipeCore.normalizeRecipe(raw) : raw;
    }

    /** Applies a built-in recipe preset to the visible transient controls. */
    function applyPreset() {
      const preset = recipeCore?.PRESETS?.[elements.mediaExportPreset.value];
      if (!preset) return;
      Object.entries(preset).forEach(([key, value]) => {
        const element = elements[`mediaExport${key[0].toUpperCase()}${key.slice(1)}`];
        if (element) element.value = String(value);
      });
      schedulePreview();
      scheduleRecipeHistory();
    }

    /** Moves one frame or atlas page while keeping the current preview mode. */
    function movePreview(delta) {
      previewIndex = Math.max(0, previewIndex + delta);
      schedulePreview();
    }

    /** Keeps a range and numeric field synchronized, including optional linked-axis scaling. */
    function bindTransformPair(rangeElement, numberElement, linkedRange, linkedNumber) {
      if (!rangeElement || !numberElement) return;
      const update = (source, target) => {
        target.value = source.value;
        if (elements.mediaExportScaleLinked?.checked && linkedRange && linkedNumber) {
          linkedRange.value = source.value;
          linkedNumber.value = source.value;
        }
        schedulePreview();
        scheduleRecipeHistory();
      };
      rangeElement.addEventListener("input", () => update(rangeElement, numberElement));
      numberElement.addEventListener("input", () => update(numberElement, rangeElement));
    }

    elements.mediaExportClose.addEventListener("click", close);
    elements.mediaExportCancel.addEventListener("click", handleCancel);
    elements.mediaExportSubmit.addEventListener("click", () => void submit());
    elements.mediaExportPreset?.addEventListener("change", applyPreset);
    elements.mediaExportPreviewRefresh.addEventListener("click", schedulePreview);
    elements.mediaExportPreviewPrevious.addEventListener("click", () => movePreview(-1));
    elements.mediaExportPreviewNext.addEventListener("click", () => movePreview(1));
    elements.mediaExportPreviewFrame.addEventListener("click", () => setPreviewMode("frame"));
    elements.mediaExportPreviewAnimation.addEventListener("click", () => setPreviewMode("animation"));
    elements.mediaExportPreviewSheet.addEventListener("click", () => setPreviewMode("sheet"));
    elements.mediaExportDialog
      .querySelectorAll(".mediaExportRecipe input, .mediaExportRecipe select")
      .forEach((control) => {
        control.addEventListener("input", syncReferenceControls);
        control.addEventListener("input", schedulePreview);
        control.addEventListener("input", scheduleRecipeHistory);
        control.addEventListener("change", commitRecipeHistory);
      });
    elements.mediaExportDialog.querySelectorAll('input[name="mediaExportFormat"]').forEach((control) => {
      control.addEventListener("change", () => {
        syncReferenceControls();
        commitRecipeHistory();
        schedulePreview();
      });
    });
    elements.mediaExportFilename.addEventListener("input", () => {
      if (!elements.mediaExportImageName.dataset.edited)
        elements.mediaExportImageName.value = elements.mediaExportFilename.value;
      if (!elements.mediaExportZipImageName.dataset.edited)
        elements.mediaExportZipImageName.value = elements.mediaExportFilename.value;
      syncReferenceControls();
    });
    elements.mediaExportUseSourceName.addEventListener("change", () => {
      elements.mediaExportFilename.disabled = elements.mediaExportUseSourceName.checked;
      if (elements.mediaExportUseSourceName.checked)
        elements.mediaExportFilename.value = exportSummary.name || "animation";
      syncReferenceControls();
    });
    elements.mediaExportImageName.addEventListener("input", () => {
      elements.mediaExportImageName.dataset.edited = "true";
    });
    elements.mediaExportZipImageName.addEventListener("input", () => {
      elements.mediaExportZipImageName.dataset.edited = "true";
    });
    elements.mediaExportFillColorReset.addEventListener("click", () => {
      elements.mediaExportFillColor.value = "#f0f0f0";
      syncReferenceControls();
      commitRecipeHistory();
      schedulePreview();
    });
    elements.mediaExportFitComplete.addEventListener("click", () => {
      elements.mediaExportScaleX.value = elements.mediaExportScaleXRange.value = "100";
      elements.mediaExportScaleY.value = elements.mediaExportScaleYRange.value = "100";
      commitRecipeHistory();
      schedulePreview();
    });
    elements.mediaExportFillCanvas.addEventListener("click", () => {
      const sourceWidth = Math.max(1, Number(exportSummary.width) || 1);
      const sourceHeight = Math.max(1, Number(exportSummary.height) || 1);
      const targetWidth = Math.max(1, Number(elements.mediaExportWidth.value) || sourceWidth);
      const targetHeight = Math.max(1, Number(elements.mediaExportHeight.value) || sourceHeight);
      const containScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
      const coverScale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
      const percent = String(Math.max(1, Math.min(300, Math.round((coverScale / containScale) * 100))));
      elements.mediaExportScaleX.value = elements.mediaExportScaleXRange.value = percent;
      elements.mediaExportScaleY.value = elements.mediaExportScaleYRange.value = percent;
      commitRecipeHistory();
      schedulePreview();
    });
    bindTransformPair(
      elements.mediaExportScaleXRange,
      elements.mediaExportScaleX,
      elements.mediaExportScaleYRange,
      elements.mediaExportScaleY,
    );
    bindTransformPair(
      elements.mediaExportScaleYRange,
      elements.mediaExportScaleY,
      elements.mediaExportScaleXRange,
      elements.mediaExportScaleX,
    );
    bindTransformPair(elements.mediaExportOffsetXRange, elements.mediaExportOffsetX);
    bindTransformPair(elements.mediaExportOffsetYRange, elements.mediaExportOffsetY);
    bindTransformPair(elements.mediaExportGifFpsRange, elements.mediaExportGifFps);
    bindTransformPair(elements.mediaExportGifAlphaRange, elements.mediaExportGifAlpha);
    bindTransformPair(elements.mediaExportMp4FpsRange, elements.mediaExportMp4Fps);
    elements.mediaExportDialog.addEventListener("pointerdown", (event) => {
      if (event.target === elements.mediaExportDialog) close();
    });
    root.document?.addEventListener("keydown", handleKeydown);
    return Object.freeze({
      cancelRecoveredJob,
      close,
      getRecoveredJob: () => recoveredJob,
      open,
      refreshCapabilities,
      renderRecoveredJob,
      renderPreview,
      redoRecipe,
      restoreLastJob,
      submit,
      undoRecipe,
    });
  }

  return Object.freeze({ createController });
});
