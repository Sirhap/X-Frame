import { SmartControls } from "./watermark_smart_controls.js";

const elements = {
  video: document.querySelector("#video"),
  videoShell: document.querySelector("#videoShell"),
  canvas: document.querySelector("#selectionCanvas"),
  emptyState: document.querySelector("#emptyState"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  timeline: document.querySelector("#timeline"),
  duration: document.querySelector("#duration"),
  timecode: document.querySelector("#timecode"),
  fileInput: document.querySelector("#fileInput"),
  clearSourceButton: document.querySelector("#clearSourceButton"),
  clearSourceDialog: document.querySelector("#clearSourceDialog"),
  sourceName: document.querySelector("#sourceName"),
  sourceMeta: document.querySelector("#sourceMeta"),
  maskList: document.querySelector("#maskList"),
  clearButton: document.querySelector("#clearButton"),
  modeInputs: document.querySelectorAll('input[name="repairMode"]'),
  smartPanel: document.querySelector("#smartPanel"),
  qualityOutput: document.querySelector("#qualityOutput"),
  exportButton: document.querySelector("#exportButton"),
  exportLabel: document.querySelector("#exportLabel"),
  exportReason: document.querySelector("#exportReason"),
  exportDuration: document.querySelector("#exportDuration"),
  exportResolution: document.querySelector("#exportResolution"),
  exportRegions: document.querySelector("#exportRegions"),
  exportSize: document.querySelector("#exportSize"),
  workflowSteps: document.querySelectorAll("#watermarkWorkflowSteps li"),
  progressWrap: document.querySelector("#progressWrap"),
  progressBar: document.querySelector("#progressBar"),
  progressText: document.querySelector("#progressText"),
  downloadButton: document.querySelector("#downloadButton"),
  processingBadge: document.querySelector("#processingBadge"),
  cornerButtons: document.querySelectorAll("[data-corner]"),
  toast: document.querySelector("#toast"),
};

const state = {
  metadata: null,
  regions: [],
  selectedId: null,
  draft: null,
  pointerId: null,
  exporting: false,
  uploading: false,
  engineAvailable: false,
  mode: "delogo",
  sourceId: null,
};
const context = elements.canvas.getContext("2d");
const DELOGO_SAFE_BORDER = 1;
const smartControls = new SmartControls({
  root: elements.smartPanel,
  getCurrentTime: () => elements.video.currentTime || 0,
  onChange: invalidateExportResult,
  notify: showToast,
});

initialize().catch((error) => showToast(error.message));

/** Checks local processing capability and wires all editor interactions. */
async function initialize() {
  bindEvents();
  try {
    const response = await fetch("/api/watermark/capabilities");
    const capabilities = await readJsonResponse(response);
    state.engineAvailable = Boolean(capabilities.available);
    elements.processingBadge.lastChild.textContent = state.engineAvailable
      ? "LOCAL / FFMPEG READY"
      : "FFMPEG 不可用";
    elements.processingBadge.classList.toggle("unavailable", !state.engineAvailable);
  } catch (error) {
    elements.processingBadge.lastChild.textContent = "引擎检测失败";
    showToast(error.message);
  }
  updateExportState();
}

/** Registers keyboard, pointer, playback, upload, and export handlers. */
function bindEvents() {
  elements.video.addEventListener("loadedmetadata", syncCanvas);
  elements.video.addEventListener("timeupdate", updateTransport);
  elements.video.addEventListener("play", () => {
    elements.playIcon.innerHTML = '<path d="M9 7v10M15 7v10" />';
    elements.playButton.setAttribute("aria-label", "暂停视频");
    renderLoop();
  });
  elements.video.addEventListener("pause", () => {
    elements.playIcon.innerHTML = '<path d="m9 7 8 5-8 5z" />';
    elements.playButton.setAttribute("aria-label", "播放视频");
    drawCanvas();
  });
  elements.playButton.addEventListener("click", togglePlayback);
  elements.timeline.addEventListener("input", () => {
    if (elements.video.duration)
      elements.video.currentTime = (Number(elements.timeline.value) / 1000) * elements.video.duration;
  });
  elements.canvas.addEventListener("pointerdown", startSelection);
  elements.canvas.addEventListener("pointermove", updateSelection);
  elements.canvas.addEventListener("pointerup", finishSelection);
  elements.canvas.addEventListener("pointercancel", cancelSelection);
  elements.fileInput.addEventListener("change", uploadSelectedFile);
  elements.clearSourceButton.addEventListener("click", requestClearSource);
  elements.clearSourceDialog.addEventListener("click", (event) => {
    if (event.target === elements.clearSourceDialog) elements.clearSourceDialog.close("cancel");
  });
  elements.clearSourceDialog.addEventListener("close", () => {
    if (elements.clearSourceDialog.returnValue === "clear") void clearSource();
  });
  window.ClipboardMedia?.bindPaste({
    target: document,
    accept: ["video"],
    isActive: () => !state.exporting && !state.uploading,
    onPaste: async ({ videos }) => {
      await uploadFile(videos[0]);
      if (videos.length > 1) showToast(`一次处理一个视频，已载入第 1 个并忽略其余 ${videos.length - 1} 个`);
    },
    onUnsupported: () => showToast("视频去水印工具只支持粘贴 MP4、MOV、M4V 或 WebM 视频"),
    onError: (error) => showToast(error instanceof Error ? error.message : String(error)),
  });
  elements.clearButton.addEventListener("click", clearRegions);
  elements.exportButton.addEventListener("click", startExport);
  elements.modeInputs.forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) setRepairMode(input.value);
    }),
  );
  elements.cornerButtons.forEach((button) => {
    button.addEventListener("click", () => addCornerRegion(button.dataset.corner));
  });
  elements.canvas.addEventListener("keydown", adjustSelectedRegionWithKeyboard);
  window.addEventListener("resize", drawCanvas);
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditing = target?.matches?.("input, textarea, select, [contenteditable='true']");
    if (!isEditing && (event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
      event.preventDefault();
      removeRegion(state.selectedId);
    }
    if (event.key === "Escape") cancelSelection();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.exporting) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

/** Loads a server-backed video source and resets masks from any prior source. */
function loadSource(sourceId, metadata, filename) {
  state.sourceId = sourceId;
  state.metadata = metadata;
  state.regions = [];
  state.selectedId = null;
  elements.videoShell.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
  elements.video.src = `/api/watermark/source?source=${encodeURIComponent(sourceId)}&v=${Date.now()}`;
  elements.emptyState.hidden = true;
  elements.sourceName.textContent = filename;
  elements.sourceMeta.textContent = `${metadata.width} × ${metadata.height} · ${formatFps(metadata.fps)} FPS`;
  elements.duration.textContent = formatTime(metadata.duration);
  smartControls.reset(metadata);
  renderRegionList();
  invalidateExportResult();
}

/** Uploads the selected file and resets the native picker. @param {Event} event File change event. */
async function uploadSelectedFile(event) {
  const file = event.target.files?.[0];
  try {
    await uploadFile(file);
  } finally {
    event.target.value = "";
  }
}

/**
 * Uploads a local or pasted video to the local Node process with visible failure handling.
 * @param {File|null|undefined} file Video file.
 * @returns {Promise<void>}
 */
async function uploadFile(file) {
  if (!file || state.uploading) return;
  if (file.size <= 0 || file.size > 1024 * 1024 * 1024) {
    showToast("请选择不超过 1 GB 的视频文件");
    return;
  }
  state.uploading = true;
  showToast("正在读取视频…");
  elements.exportButton.disabled = true;
  elements.fileInput.disabled = true;
  try {
    const response = await fetch("/api/watermark/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const result = await readJsonResponse(response);
    loadSource(result.sourceId, result.metadata, result.filename || file.name);
    showToast("视频已载入，可以开始框选");
  } catch (error) {
    showToast(error.message);
  } finally {
    state.uploading = false;
    updateExportState();
  }
}

/** Opens the destructive source-clear confirmation with a native fallback. */
function requestClearSource() {
  if (!state.sourceId || state.exporting || state.uploading) return;
  elements.clearSourceDialog.returnValue = "cancel";
  if (typeof elements.clearSourceDialog.showModal === "function") {
    elements.clearSourceDialog.showModal();
    return;
  }
  if (window.confirm("清空当前视频、全部水印选区和未下载结果？")) void clearSource();
}

/** Removes the local source video and resets every source-derived editor state. @returns {Promise<void>} */
async function clearSource() {
  if (!state.sourceId || state.exporting || state.uploading) return;
  const sourceId = state.sourceId;
  state.uploading = true;
  updateExportState();
  try {
    const response = await fetch(`/api/watermark/source?source=${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok || response.status !== 404) await readJsonResponse(response);
    elements.video.pause();
    elements.video.removeAttribute("src");
    elements.video.load();
    state.sourceId = null;
    state.metadata = null;
    state.regions = [];
    state.selectedId = null;
    state.draft = null;
    state.pointerId = null;
    elements.videoShell.style.aspectRatio = "16 / 9";
    elements.emptyState.hidden = false;
    elements.sourceName.textContent = "等待视频";
    elements.sourceMeta.textContent = "— × — · — FPS";
    elements.duration.textContent = "00:00";
    elements.timecode.textContent = "00:00.00";
    elements.timeline.value = "0";
    context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    renderRegionList();
    smartControls.setSelectedRegion(null, -1);
    invalidateExportResult();
    showToast("已清空本地视频、选区和导出结果");
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    state.uploading = false;
    updateExportState();
  }
}

/** Starts a new drag-to-select gesture in original-video coordinates. */
function startSelection(event) {
  if (!state.metadata || state.exporting) return;
  const point = pointerToVideo(event);
  state.pointerId = event.pointerId;
  state.draft = { x: point.x, y: point.y, width: 0, height: 0, originX: point.x, originY: point.y };
  elements.canvas.setPointerCapture(event.pointerId);
}

/** Updates the current selection and supports dragging in any direction. */
function updateSelection(event) {
  if (!state.draft || event.pointerId !== state.pointerId) return;
  const point = pointerToVideo(event);
  state.draft.x = Math.min(state.draft.originX, point.x);
  state.draft.y = Math.min(state.draft.originY, point.y);
  state.draft.width = Math.abs(point.x - state.draft.originX);
  state.draft.height = Math.abs(point.y - state.draft.originY);
  drawCanvas();
}

/** Commits a valid region or explains why a tiny accidental drag was ignored. */
function finishSelection(event) {
  if (!state.draft || event.pointerId !== state.pointerId) return;
  const region = {
    id: crypto.randomUUID(),
    x: Math.round(state.draft.x),
    y: Math.round(state.draft.y),
    width: Math.round(state.draft.width),
    height: Math.round(state.draft.height),
    ...createDefaultTimeRange(),
  };
  state.draft = null;
  state.pointerId = null;
  commitRegion(region, "已添加选区，默认处理当前起 3 秒");
}

/** Adds a validated region and synchronizes selection-dependent controls. */
function commitRegion(region, successMessage) {
  if (region.width < 8 || region.height < 8) {
    showToast("框选区域过小，请重新拖拽");
  } else if (state.regions.length >= 8) {
    showToast("最多可添加 8 个区域");
  } else {
    state.regions.push(region);
    state.selectedId = region.id;
    renderRegionList();
    invalidateExportResult();
    showToast(successMessage);
  }
  drawCanvas();
}

/** Adds a practical 25% × 12% keyboard-accessible preset to one video corner. */
function addCornerRegion(corner) {
  if (!state.metadata || state.exporting) {
    showToast("请先载入视频");
    return;
  }
  const width = Math.max(8, Math.round(state.metadata.width * 0.25));
  const height = Math.max(8, Math.round(state.metadata.height * 0.12));
  const insetX = Math.max(1, Math.round(state.metadata.width * 0.02));
  const insetY = Math.max(1, Math.round(state.metadata.height * 0.02));
  const isRight = String(corner).includes("right");
  const isBottom = String(corner).includes("bottom");
  commitRegion(
    {
      id: crypto.randomUUID(),
      x: isRight ? state.metadata.width - width - insetX : insetX,
      y: isBottom ? state.metadata.height - height - insetY : insetY,
      width,
      height,
      ...createDefaultTimeRange(),
    },
    "已添加角落选区，可在画面中继续调整",
  );
}

/** Moves or resizes the selected region from the focused canvas. */
function adjustSelectedRegionWithKeyboard(event) {
  if (!state.metadata || state.exporting || !event.key.startsWith("Arrow")) return;
  const region = getSelectedRegion();
  if (!region) {
    showToast("请先框选或快捷添加一个区域");
    return;
  }
  event.preventDefault();
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ];
  const step = event.altKey ? 10 : 1;
  if (event.shiftKey) {
    region.width = clamp(region.width + direction[0] * step, 8, state.metadata.width - region.x - 1);
    region.height = clamp(region.height + direction[1] * step, 8, state.metadata.height - region.y - 1);
  } else {
    region.x = clamp(region.x + direction[0] * step, 1, state.metadata.width - region.width - 1);
    region.y = clamp(region.y + direction[1] * step, 1, state.metadata.height - region.height - 1);
  }
  renderRegionList();
  invalidateExportResult();
  drawCanvas();
}

/** Cancels an in-progress pointer gesture. */
function cancelSelection() {
  state.draft = null;
  state.pointerId = null;
  drawCanvas();
}

/** Draws blurred preview patches and crisp selection outlines over the video. */
function drawCanvas() {
  if (!state.metadata) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const rect = elements.canvas.getBoundingClientRect();
  const renderWidth = Math.max(1, Math.round(rect.width * pixelRatio));
  const renderHeight = Math.max(1, Math.round(rect.height * pixelRatio));
  if (elements.canvas.width !== renderWidth || elements.canvas.height !== renderHeight) {
    elements.canvas.width = renderWidth;
    elements.canvas.height = renderHeight;
  }
  const scaleX = renderWidth / state.metadata.width;
  const scaleY = renderHeight / state.metadata.height;
  context.clearRect(0, 0, renderWidth, renderHeight);

  for (const region of [...state.regions, ...(state.draft ? [state.draft] : [])]) {
    const isDraft = !region.id;
    const isActive = isDraft || state.mode === "smart" || isRegionActive(region, elements.video.currentTime);
    const x = region.x * scaleX;
    const y = region.y * scaleY;
    const width = region.width * scaleX;
    const height = region.height * scaleY;
    if (isActive && elements.video.readyState >= 2 && width > 0 && height > 0) {
      context.save();
      context.beginPath();
      context.rect(x, y, width, height);
      context.clip();
      context.filter = `blur(${Math.max(8, 12 * pixelRatio)}px)`;
      const padding = 20;
      context.drawImage(
        elements.video,
        region.x - padding,
        region.y - padding,
        region.width + padding * 2,
        region.height + padding * 2,
        x - padding * scaleX,
        y - padding * scaleY,
        width + padding * 2 * scaleX,
        height + padding * 2 * scaleY,
      );
      context.restore();
    }
    context.strokeStyle = isActive
      ? region.id === state.selectedId
        ? "#f7b84b"
        : "#31d6b4"
      : "rgba(145, 161, 174, 0.7)";
    context.lineWidth = (region.id === state.selectedId ? 2 : 1.2) * pixelRatio;
    context.setLineDash([7 * pixelRatio, 5 * pixelRatio]);
    context.strokeRect(x, y, width, height);
    context.fillStyle = isActive ? "rgba(49, 214, 180, 0.13)" : "rgba(145, 161, 174, 0.06)";
    context.fillRect(x, y, width, height);
    context.setLineDash([]);
  }
}

/** Converts CSS pointer coordinates to clamped source-video pixels. */
function pointerToVideo(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: clamp(
      ((event.clientX - rect.left) / rect.width) * state.metadata.width,
      DELOGO_SAFE_BORDER,
      state.metadata.width - DELOGO_SAFE_BORDER,
    ),
    y: clamp(
      ((event.clientY - rect.top) / rect.height) * state.metadata.height,
      DELOGO_SAFE_BORDER,
      state.metadata.height - DELOGO_SAFE_BORDER,
    ),
  };
}

/** Rebuilds the data-driven region list after selection changes. */
function renderRegionList() {
  elements.maskList.replaceChildren();
  if (!state.regions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "尚未框选区域";
    elements.maskList.append(empty);
    updateSmartSelection();
    return;
  }
  state.regions.forEach((region, index) => {
    const item = document.createElement("div");
    item.className = `mask-item${region.id === state.selectedId ? " selected" : ""}`;
    item.innerHTML = `<div class="mask-main"><span class="mask-swatch"></span><div class="mask-copy"><strong>水印区域 ${String(index + 1).padStart(2, "0")}</strong><span>${region.x}, ${region.y} / ${region.width} × ${region.height}</span></div><button class="remove-mask" type="button" aria-label="删除区域">×</button></div><div class="time-editor"><div class="time-field"><label>开始 / 秒</label><div class="time-input-row"><input class="start-time" type="number" min="0" max="${state.metadata.duration}" step="0.1" value="${region.startTime.toFixed(2)}" aria-label="区域 ${index + 1} 开始时间"><button class="set-time-button set-start" type="button">当前</button></div></div><div class="time-field"><label>结束 / 秒</label><div class="time-input-row"><input class="end-time" type="number" min="0" max="${state.metadata.duration}" step="0.1" value="${region.endTime.toFixed(2)}" aria-label="区域 ${index + 1} 结束时间"><button class="set-time-button set-end" type="button">当前</button></div></div><p class="time-summary">仅在 ${formatTimecode(region.startTime)} — ${formatTimecode(region.endTime)} 生效</p></div>`;
    item.addEventListener("click", () => {
      if (state.selectedId === region.id) return;
      state.selectedId = region.id;
      renderRegionList();
      invalidateExportResult();
      drawCanvas();
    });
    item.querySelector(".remove-mask").addEventListener("click", (event) => {
      event.stopPropagation();
      removeRegion(region.id);
    });
    item
      .querySelector(".start-time")
      .addEventListener("change", (event) => updateRegionTime(region.id, "startTime", event.target.value));
    item
      .querySelector(".end-time")
      .addEventListener("change", (event) => updateRegionTime(region.id, "endTime", event.target.value));
    item.querySelector(".set-start").addEventListener("click", (event) => {
      event.stopPropagation();
      updateRegionTime(region.id, "startTime", elements.video.currentTime);
    });
    item.querySelector(".set-end").addEventListener("click", (event) => {
      event.stopPropagation();
      updateRegionTime(region.id, "endTime", elements.video.currentTime);
    });
    item
      .querySelectorAll("input, button")
      .forEach((control) => control.addEventListener("pointerdown", (event) => event.stopPropagation()));
    elements.maskList.append(item);
  });
  updateSmartSelection();
}

/** Updates one time boundary while maintaining a valid, frame-sized interval. */
function updateRegionTime(id, field, rawValue) {
  const region = state.regions.find((candidate) => candidate.id === id);
  const value = Number(rawValue);
  if (!region || !Number.isFinite(value)) {
    showToast("请输入有效的时间");
    renderRegionList();
    return;
  }
  const minimumGap = Math.max(0.04, 1 / (state.metadata.fps || 25));
  if (field === "startTime") {
    region.startTime = roundTime(clamp(value, 0, state.metadata.duration - minimumGap));
    if (region.endTime <= region.startTime)
      region.endTime = roundTime(Math.min(state.metadata.duration, region.startTime + minimumGap));
  } else {
    region.endTime = roundTime(clamp(value, minimumGap, state.metadata.duration));
    if (region.startTime >= region.endTime)
      region.startTime = roundTime(Math.max(0, region.endTime - minimumGap));
  }
  renderRegionList();
  invalidateExportResult();
  drawCanvas();
}

/** Removes one region by stable id. */
function removeRegion(id) {
  state.regions = state.regions.filter((region) => region.id !== id);
  if (state.selectedId === id) state.selectedId = state.regions.at(-1)?.id ?? null;
  renderRegionList();
  invalidateExportResult();
  drawCanvas();
}

/** Clears all regions with no effect on the loaded video. */
function clearRegions() {
  state.regions = [];
  state.selectedId = null;
  renderRegionList();
  invalidateExportResult();
  drawCanvas();
}

/** Starts export, polls server progress, and exposes the completed download. */
async function startExport() {
  if (state.exporting || !state.regions.length) return;
  state.exporting = true;
  elements.downloadButton.hidden = true;
  elements.progressWrap.hidden = false;
  elements.progressBar.style.width = "0%";
  elements.progressWrap.setAttribute("aria-valuenow", "0");
  elements.progressText.textContent = state.mode === "smart" ? "逐帧修复 0%" : "处理中 0%";
  updateExportCopy();
  updateExportState();
  try {
    const selectedRegion = getSelectedRegion();
    const requestBody =
      state.mode === "smart"
        ? { sourceId: state.sourceId, mode: "smart", smart: smartControls.getOptions(selectedRegion) }
        : {
            sourceId: state.sourceId,
            mode: "delogo",
            regions: state.regions.map(({ x, y, width, height, startTime, endTime }) => ({
              x,
              y,
              width,
              height,
              startTime,
              endTime,
            })),
          };
    const response = await fetch("/api/watermark/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const result = await readJsonResponse(response);
    await pollJob(result.id);
  } catch (error) {
    showToast(error.message);
    elements.progressWrap.hidden = true;
  } finally {
    state.exporting = false;
    updateExportCopy();
    updateExportState();
  }
}

/** Polls a job until completion or failure without overlapping requests. */
async function pollJob(jobId) {
  while (true) {
    await delay(650);
    const response = await fetch(`/api/watermark/jobs/${encodeURIComponent(jobId)}`);
    const job = await readJsonResponse(response);
    const progress = Number(job.progress || 0);
    elements.progressBar.style.width = `${progress}%`;
    elements.progressWrap.setAttribute("aria-valuenow", String(progress));
    elements.progressText.textContent = `${state.mode === "smart" ? "逐帧修复" : "处理中"} ${progress}%`;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "导出失败");
    if (job.status === "completed") {
      elements.progressText.textContent = "修复完成";
      elements.downloadButton.href = job.downloadUrl;
      elements.downloadButton.hidden = false;
      showToast("视频修复完成");
      return;
    }
  }
}

/** Keeps time labels and the custom timeline synchronized. */
function updateTransport() {
  const duration = elements.video.duration || 0;
  elements.timeline.value = duration ? Math.round((elements.video.currentTime / duration) * 1000) : 0;
  elements.timecode.textContent = formatTimecode(elements.video.currentTime);
}

/** Plays or pauses the source with browser promise rejection handling. */
async function togglePlayback() {
  if (!state.metadata) return;
  try {
    if (elements.video.paused) await elements.video.play();
    else elements.video.pause();
  } catch (error) {
    showToast(`无法播放：${error.message}`);
  }
}

/** Runs canvas refresh only while playback is active. */
function renderLoop() {
  drawCanvas();
  if (!elements.video.paused) requestAnimationFrame(renderLoop);
}

/** Resizes canvas after video metadata becomes available. */
function syncCanvas() {
  drawCanvas();
  updateTransport();
}

/** Creates a conservative three-second range around the current editing position. */
function createDefaultTimeRange() {
  const duration = state.metadata.duration;
  const currentTime = clamp(elements.video.currentTime || 0, 0, duration);
  const startTime = currentTime >= duration - 0.25 ? Math.max(0, duration - 3) : currentTime;
  return { startTime: roundTime(startTime), endTime: roundTime(Math.min(duration, startTime + 3)) };
}

/** Returns whether a region should affect the currently displayed frame. */
function isRegionActive(region, time) {
  return time >= region.startTime && time <= region.endTime;
}

/** Enables export only when the editor is ready and idle. */
function updateExportState() {
  const selectedRegion = getSelectedRegion();
  const hasValidInput =
    state.mode === "smart" ? smartControls.isValid(selectedRegion) : state.regions.length > 0;
  elements.exportButton.disabled =
    !state.engineAvailable ||
    !state.metadata ||
    !state.sourceId ||
    !hasValidInput ||
    state.exporting ||
    state.uploading;
  elements.fileInput.disabled = state.exporting || state.uploading;
  elements.clearSourceButton.disabled = state.exporting || state.uploading || !state.sourceId;
  elements.clearButton.disabled = state.exporting || !state.regions.length;
  elements.cornerButtons.forEach((button) => {
    button.disabled = state.exporting || !state.metadata;
  });
  elements.modeInputs.forEach((input) => {
    input.disabled = state.exporting;
  });
  elements.maskList.querySelectorAll("input, button").forEach((control) => {
    control.disabled = state.exporting;
  });
  smartControls.setDisabled(state.exporting);
  updateExportSummary();
  updateWorkflowState(hasValidInput);
}

/** Summarizes the final processing scope with a deliberately approximate encoded size. */
function updateExportSummary() {
  const metadata = state.metadata;
  elements.exportDuration.textContent = metadata ? formatTime(metadata.duration) : "—";
  elements.exportResolution.textContent = metadata ? `${metadata.width} × ${metadata.height}` : "—";
  elements.exportRegions.textContent = `${state.regions.length} 个区域`;
  if (!metadata) {
    elements.exportSize.textContent = "—";
    return;
  }
  const estimatedBytes = metadata.width * metadata.height * metadata.duration * 0.045;
  elements.exportSize.textContent =
    estimatedBytes >= 1024 * 1024
      ? `约 ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`
      : `约 ${Math.max(1, Math.round(estimatedBytes / 1024))} KB`;
}

/** Updates progressive disclosure, step semantics, and the disabled export explanation. */
function updateWorkflowState(hasValidInput) {
  const step = !state.sourceId
    ? "source"
    : !state.regions.length
      ? "region"
      : hasValidInput
        ? "preview"
        : "repair";
  const order = ["source", "region", "repair", "preview", "export"];
  document.body.dataset.workflowStep = step;
  const currentIndex = order.indexOf(step);
  elements.workflowSteps.forEach((item, index) => {
    item.classList.toggle("is-complete", index < currentIndex);
    if (index === currentIndex) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  elements.exportReason.hidden = !elements.exportButton.disabled;
  if (!state.engineAvailable) elements.exportReason.textContent = "本地 FFmpeg 引擎不可用";
  else if (!state.sourceId) elements.exportReason.textContent = "请先载入视频";
  else if (!state.regions.length) elements.exportReason.textContent = "请在画面中框选至少一个水印区域";
  else if (!hasValidInput) elements.exportReason.textContent = "请完善当前智能修复参数";
  else elements.exportReason.textContent = "";
}

/** Clears a completed export whenever its source configuration becomes stale. */
function invalidateExportResult() {
  if (!state.exporting) {
    elements.downloadButton.hidden = true;
    elements.downloadButton.removeAttribute("href");
    elements.progressWrap.hidden = true;
    elements.progressBar.style.width = "0%";
    elements.progressWrap.setAttribute("aria-valuenow", "0");
    elements.progressText.textContent = "处理中 0%";
  }
  updateExportState();
}

/** Switches between the fast rectangle filter and frame-by-frame smart repair. */
function setRepairMode(mode) {
  state.mode = mode === "smart" ? "smart" : "delogo";
  document.body.dataset.mode = state.mode;
  elements.smartPanel.hidden = state.mode !== "smart";
  elements.qualityOutput.textContent = state.mode === "smart" ? "逐帧模板 · CRF 18" : "高质量 · CRF 18";
  updateExportCopy();
  updateSmartSelection();
  invalidateExportResult();
  drawCanvas();
}

/** Updates button language to make the active pipeline explicit. */
function updateExportCopy() {
  if (state.exporting) {
    elements.exportLabel.textContent = state.mode === "smart" ? "正在逐帧修复…" : "正在修复…";
    return;
  }
  elements.exportLabel.textContent = state.mode === "smart" ? "导出智能修复视频" : "导出修复视频";
}

/** Returns the stable selected region used as the smart template bounds. */
function getSelectedRegion() {
  return state.regions.find((region) => region.id === state.selectedId) ?? null;
}

/** Synchronizes the smart panel's selected-region summary. */
function updateSmartSelection() {
  const selectedRegion = getSelectedRegion();
  smartControls.setSelectedRegion(selectedRegion, state.regions.indexOf(selectedRegion));
}

/** Displays a transient, screen-reader-announced message. */
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => elements.toast.classList.remove("visible"), 2400);
}

/** Parses one JSON response and promotes server errors to user-facing exceptions. */
async function readJsonResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error(`本地服务返回了无效响应（${response.status}）`);
  }
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

/** Formats seconds as MM:SS. */
function formatTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(Math.floor(safeSeconds % 60)).padStart(2, "0")}`;
}

/** Formats seconds as MM:SS.cc for a compact editing timecode. */
function formatTimecode(seconds) {
  const base = formatTime(seconds);
  const centiseconds = Math.floor((Number(seconds || 0) % 1) * 100);
  return `${base}.${String(centiseconds).padStart(2, "0")}`;
}

/** Formats fractional frame rates without noisy decimals. */
function formatFps(fps) {
  return Number(fps || 0)
    .toFixed(2)
    .replace(/\.00$/, "");
}

/** Constrains a numeric value to a closed interval. */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Returns a promise that settles after the given interval. */
function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/** Rounds editor time values to milliseconds. */
function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}
