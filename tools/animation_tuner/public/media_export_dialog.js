(function attachMediaExportDialog(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MediaExportDialog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the organizer media-export dialog.
   * @param {{elements:Record<string,Element>,getLanguage:()=>string,getSummary:()=>object,onExport:(options:object)=>Promise<object|null>,fetchImpl?:typeof fetch,resumeLastExport?:(options:object)=>Promise<object|null>,cancelRecoveredExport?:(jobId:string)=>Promise<object>,onRecoveryChange?:(status:object|null)=>void}} dependencies UI adapters.
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
    const localClient = root.LocalMediaExportClient;
    const resumeLastExport = dependencies.resumeLastExport || localClient?.resumeLastExport;
    const cancelRecoveredExport =
      dependencies.cancelRecoveredExport ||
      (typeof localClient?.cancelJob === "function"
        ? (jobId) => localClient.cancelJob(jobId, { fetchImpl })
        : null);

    /** Returns true when English strings should be shown. */
    const english = () => getLanguage?.() === "en";

    /** Sets a visible status and semantic tone. */
    function setStatus(message, tone = "idle") {
      elements.mediaExportStatus.textContent = message;
      elements.mediaExportStatus.dataset.tone = tone;
    }

    /** Locks format choices during export while preserving local capability state. */
    function renderSubmittingState() {
      const busy = submitting || recoveringActive;
      elements.mediaExportFrames.disabled = busy;
      elements.mediaExportSheet.disabled = busy;
      elements.mediaExportGif.disabled = busy || !localExportAvailable;
      elements.mediaExportMov.disabled = busy || !localExportAvailable;
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
      [elements.mediaExportGif, elements.mediaExportMov].forEach((input) => {
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

    /** Opens the dialog with a fresh summary and capability check. */
    function open() {
      returnFocus = root.document?.activeElement;
      const summary = getSummary?.() || {};
      elements.mediaExportFrameCount.textContent = String(summary.frameCount || 0);
      elements.mediaExportFps.textContent = String(summary.fps || 12);
      elements.mediaExportCanvas.textContent = summary.canvas || "—";
      elements.mediaExportDialog.hidden = false;
      root.document?.body.classList.add("mediaExportOpen");
      renderDownloads([]);
      setStatus(english() ? "Choose at least one output." : "选择至少一种输出格式。");
      elements.mediaExportFrames.focus();
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
      recoveryController = null;
      capabilityRequest += 1;
      elements.mediaExportDialog.hidden = true;
      root.document?.body.classList.remove("mediaExportOpen");
      returnFocus?.focus?.();
    }

    /** Keeps keyboard focus inside the dialog and supports Escape. @param {KeyboardEvent} event */
    function handleKeydown(event) {
      if (elements.mediaExportDialog.hidden) return;
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
        mov: elements.mediaExportMov.checked && !elements.mediaExportMov.disabled,
      };
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
        const result = await onExport({ confirmed: true, formats, signal: activeController?.signal });
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
      return currentElements.mediaExportGif.checked || currentElements.mediaExportMov.checked;
    }

    elements.mediaExportClose.addEventListener("click", close);
    elements.mediaExportCancel.addEventListener("click", handleCancel);
    elements.mediaExportSubmit.addEventListener("click", () => void submit());
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
      restoreLastJob,
      submit,
    });
  }

  return Object.freeze({ createController });
});
