(function initializeScatterSliceTool(root) {
  "use strict";

  const core = root.XSXBScatterSliceCore;
  const groupCore = root.XSXBScatterSliceGroups;
  const smartCutout = root.XSXBScatterSliceSmartCutout;
  const editorCore = root.XSXBScatterSliceEditorCore;
  const workspaceCore = root.XSXBScatterSliceWorkspaceCore;
  const groupControllerCore = root.XSXBScatterSliceGroupController;
  const temporaryWorksetCore = root.XSXBScatterTemporaryWorkset;
  const historyCore = root.XSXBHistory;
  const clipboardMedia = root.ClipboardMedia;
  if (!core) throw new Error("零散切图核心模块未加载");
  if (!groupCore) throw new Error("零散切图分组模块未加载");
  if (!smartCutout) throw new Error("智能抠图模块未加载");
  if (!editorCore) throw new Error("切片编辑核心模块未加载");
  if (!workspaceCore) throw new Error("切片工作区核心模块未加载");
  if (!groupControllerCore) throw new Error("切片分组控制器未加载");
  if (!temporaryWorksetCore) throw new Error("切片临时工作集模块未加载");
  if (!historyCore) throw new Error("编辑历史模块未加载");
  if (!clipboardMedia) throw new Error("剪贴板媒体模块未加载");

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_SOURCE_PIXELS = 20_000_000;
  const MAX_OUTPUT_PIXELS = 64_000_000;
  const MAX_HANDOFF_PIXELS = 24_000_000;
  const MAX_CANVAS_SIDE = 32_767;
  const OUTPUT_PADDING = 2;
  const OUTPUT_MAXIMUM_COLUMNS = 8;
  const ACCEPTED_IMAGE_TYPE = /^image\/(png|jpeg|webp)$/i;
  const GROUP_COLORS = Object.freeze([
    { stroke: "#31d6b4", fill: "rgba(49, 214, 180, .12)" },
    { stroke: "#f7b84b", fill: "rgba(247, 184, 75, .12)" },
    { stroke: "#f05b62", fill: "rgba(240, 91, 98, .12)" },
    { stroke: "#70a7ff", fill: "rgba(112, 167, 255, .12)" },
  ]);

  /** @param {string} selector @returns {HTMLElement} */
  function requireElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`找不到界面元素：${selector}`);
    return element;
  }

  const elements = {
    activeBox: requireElement("#scatterActiveBox"),
    addModeButton: requireElement("#scatterAddMode"),
    boxCount: requireElement("#scatterBoxCount"),
    addProjectButton: requireElement("#scatterAddProject"),
    animationNameInput: requireElement("#scatterAnimationName"),
    clearSourceButton: requireElement("#scatterClearSource"),
    clearSourceDialog: requireElement("#scatterClearDialog"),
    colorInput: requireElement("#scatterColor"),
    colorValue: requireElement("#scatterColorValue"),
    deleteButton: requireElement("#scatterDelete"),
    detectButton: requireElement("#scatterDetect"),
    downloadSheetButton: requireElement("#scatterDownloadSheet"),
    downloadSliceButton: requireElement("#scatterDownloadSlice"),
    dropZone: requireElement("#scatterDropZone"),
    editModeButton: requireElement("#scatterEditMode"),
    emptyStage: requireElement("#scatterEmptyStage"),
    fileInput: requireElement("#scatterFileInput"),
    groupSelection: requireElement("#scatterGroupSelection"),
    interactionStatus: requireElement("#scatterInteractionStatus"),
    modeInput: requireElement("#scatterMode"),
    normalizeBoxesButton: requireElement("#scatterNormalizeBoxes"),
    playAllButton: requireElement("#scatterPlayAll"),
    playAllCanvas: requireElement("#scatterPlaybackAll"),
    projectModeInput: requireElement("#scatterProjectMode"),
    previewCanvas: requireElement("#scatterPreview"),
    redoButton: requireElement("#scatterRedo"),
    regroupButton: requireElement("#scatterRegroup"),
    sampleModeButton: requireElement("#scatterSampleMode"),
    selectSmallSlicesButton: requireElement("#scatterSelectSmallSlices"),
    smallSliceRatioInput: requireElement("#scatterSmallSliceRatio"),
    sliceList: requireElement("#scatterSliceList"),
    sourceMeta: requireElement("#scatterSourceMeta"),
    status: requireElement("#scatterStatus"),
    statusMessage: requireElement("#scatterStatus p"),
    transparentInput: requireElement("#scatterTransparent"),
    toggleGroupsButton: requireElement("#scatterToggleGroups"),
    uploadButton: requireElement("#scatterUpload"),
    undoButton: requireElement("#scatterUndo"),
    uniformOutputInput: requireElement("#scatterUniformOutput"),
    actionSummary: document.querySelector("#scatterActionSummary"),
    organizePanel: document.querySelector("[data-requires-detection]"),
    resultSummary: document.querySelector("#scatterResultSummary"),
    stageAction: document.querySelector("#scatterStageAction"),
    surface: document.querySelector("#scatterSliceSurface"),
    workflowSteps: Array.from(document.querySelectorAll("[data-scatter-step]")),
  };

  const sourceCanvas = document.createElement("canvas");
  const state = {
    animationNameAuto: true,
    busy: false,
    redoStack: [],
    resolvedMode: "colorkey",
    sliceCanvasCache: new WeakMap(),
    smartBackgroundColor: null,
    source: null,
    pointerEdit: null,
    playbackTimerId: null,
    playbackButton: null,
    playbackCanvas: null,
    playbackIdleLabel: null,
    previewFrameId: null,
    suppressBeforeUnload: false,
    toolMode: "sample",
    undoStack: [],
    workspace: workspaceCore.createDetectedWorkspace([], []),
  };

  /** Returns current frame objects in detector order. @returns {object[]} */
  function workspaceFrames() {
    return state.workspace.frames;
  }

  /** Returns editable groups with resolved frame objects. @returns {Array<object>} */
  function workspaceGroups() {
    const frameById = new Map(workspaceFrames().map((frame) => [frame.id, frame]));
    return state.workspace.groups.map((group) => ({
      ...group,
      boxes: group.frameIds.map((id) => frameById.get(id)).filter(Boolean),
    }));
  }

  /** Returns the primary selected frame index. @returns {number|null} */
  function selectedIndex() {
    const index = workspaceFrames().findIndex((frame) => frame.id === state.workspace.selection.primaryId);
    return index >= 0 ? index : null;
  }

  /** Replaces selection with one index or clears it. @param {number|null} index Frame index. */
  function selectIndex(index) {
    const frame = Number.isInteger(index) ? workspaceFrames()[index] : null;
    state.workspace = workspaceCore.setSelection(state.workspace, frame ? [frame.id] : [], frame?.id || null);
  }

  Object.defineProperties(state, {
    boxes: { get: workspaceFrames },
    groups: { get: workspaceGroups },
    selectedIndex: { get: selectedIndex, set: selectIndex },
  });

  const history = historyCore.createController({
    elements: { undo: elements.undoButton, redoTop: elements.redoButton },
    getUndoStack: () => state.undoStack,
    setUndoStack: (value) => {
      state.undoStack = value;
    },
    getRedoStack: () => state.redoStack,
    setRedoStack: (value) => {
      state.redoStack = value;
    },
    getSnapshot: () => workspaceCore.snapshotWorkspace(state.workspace),
    restoreSnapshot: (snapshot) => {
      state.workspace = workspaceCore.restoreWorkspace(snapshot);
      elements.uniformOutputInput.checked = state.workspace.uniformOutput;
      state.sliceCanvasCache = new WeakMap();
      renderAll();
    },
    status: (message) => setStatus(message, "success"),
    translate: (key, variables = {}) => {
      const label = variables.label || "编辑";
      return {
        undoReady: `${label}已记录。`,
        undoNothing: "没有可撤销的编辑。",
        redoNothing: "没有可重做的编辑。",
        undone: `已撤销：${label}。`,
        redone: `已重做：${label}。`,
        loadFailed: `历史恢复失败：${variables.message || "未知错误"}`,
      }[key];
    },
    maxDepth: 80,
  });

  /** Clears undo and redo history for a newly loaded source. @returns {void} */
  function resetHistory() {
    state.undoStack = [];
    state.redoStack = [];
    history.updateHistoryControls();
  }

  /**
   * Converts an unknown failure into a readable Chinese message.
   * @param {unknown} error Failure value.
   * @param {string} fallback Fallback message.
   * @returns {string} User-facing message.
   */
  function errorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  /**
   * Updates the live status bar and its visual tone.
   * @param {string} message User-facing message.
   * @param {"ready"|"working"|"success"|"error"} [tone] Status tone.
   * @returns {void}
   */
  function setStatus(message, tone = "ready") {
    elements.status.dataset.tone = tone;
    elements.statusMessage.textContent = message;
    const label = elements.status.querySelector("span");
    if (label)
      label.lastChild.textContent = ` ${tone === "error" ? "ERROR" : tone === "working" ? "WORKING" : "READY"}`;
  }

  /**
   * Routes recoverable UI failures through the tool's visible error boundary.
   * @param {unknown} error Failure value.
   * @param {string} fallback Fallback message.
   * @returns {void}
   */
  function reportFailure(error, fallback) {
    setStatus(errorMessage(error, fallback), "error");
  }

  /**
   * Locks file and detection actions while an asynchronous task is running.
   * @param {boolean} busy Whether work is running.
   * @returns {void}
   */
  function setBusy(busy) {
    state.busy = Boolean(busy);
    document.body.classList.toggle("isBusy", state.busy);
    elements.uploadButton.disabled = state.busy;
    elements.clearSourceButton.disabled = state.busy || !state.source;
    elements.detectButton.disabled = state.busy || !state.source;
    if (elements.stageAction) elements.stageAction.disabled = state.busy;
  }

  /**
   * Reads and normalizes current detection controls.
   * @returns {object} Core detection options.
   */
  function readDetectionOptions() {
    const width = state.source?.width || 1;
    const height = state.source?.height || 1;
    const shortestSide = Math.min(width, height);
    return {
      mode: elements.modeInput.value,
      colorKey: elements.colorInput.value,
      threshold: core.DEFAULT_OPTIONS.threshold,
      mergeGap: Math.max(1, Math.min(4, Math.round(shortestSide / 600))),
      minPixels: Math.max(4, Math.round((width * height) / 100_000)),
      minSide: Math.max(1, Math.round(shortestSide / 500)),
      sortOrder: "row-major",
    };
  }

  /**
   * Replaces current row groups and selects every detected group for export.
   * @param {object[]} boxes Detection boxes.
   * @returns {void}
   */
  function installGroups(boxes) {
    state.workspace = workspaceCore.createDetectedWorkspace(boxes, groupCore.groupBoxesByRows(boxes), {
      uniformOutput: elements.uniformOutputInput.checked,
    });
  }

  /**
   * Returns currently included animation groups in visual order.
   * @returns {Array<{id:string,boxes:object[]}>} Selected groups.
   */
  function selectedGroups() {
    return state.groups.filter((group) => group.enabled && Array.isArray(group.boxes) && group.boxes.length > 0);
  }

  /**
   * Returns the source-image bounds expected by the editor core.
   * @returns {{width:number,height:number}} Source bounds.
   */
  function sourceBounds() {
    if (!state.source) throw new Error("请先加载源图片");
    return { width: state.source.width, height: state.source.height };
  }

  /**
   * Switches the canvas between rectangle editing and background sampling.
   * @param {"edit"|"add"|"sample"} requestedMode Requested tool.
   * @returns {void}
   */
  function setToolMode(requestedMode) {
    if (requestedMode === "edit" && state.boxes.length > 0) state.toolMode = "edit";
    else if (requestedMode === "add" && state.source) state.toolMode = "add";
    else state.toolMode = "sample";
    elements.editModeButton.setAttribute("aria-pressed", state.toolMode === "edit" ? "true" : "false");
    elements.addModeButton.setAttribute("aria-pressed", state.toolMode === "add" ? "true" : "false");
    elements.sampleModeButton.setAttribute("aria-pressed", state.toolMode === "sample" ? "true" : "false");
    elements.previewCanvas.dataset.tool = state.toolMode;
    const description = {
      add: "源图片与检测框预览；按住并拖动以添加新切片",
      edit: "源图片与检测框预览；点击选择，拖动移动，拖动控制点缩放",
      sample: "源图片与检测框预览；点击画布选取背景色",
    }[state.toolMode];
    elements.previewCanvas.setAttribute("aria-label", description);
    elements.previewCanvas.title = description;
  }

  /**
   * Finds group and frame positions for one detection box.
   * @param {object} box Detection box.
   * @returns {{groupIndex:number,frameIndex:number}|null} Visual position.
   */
  function locateBox(box) {
    for (let groupIndex = 0; groupIndex < state.groups.length; groupIndex += 1) {
      const frameIndex = state.groups[groupIndex].boxes.indexOf(box);
      if (frameIndex >= 0) return { groupIndex, frameIndex };
    }
    return null;
  }

  /**
   * Formats a one-based group or frame number.
   * @param {number} index Zero-based index.
   * @returns {string} Two-digit label.
   */
  function ordinal(index) {
    return String(index + 1).padStart(2, "0");
  }

  /**
   * Loads a browser file into an image element with URL cleanup.
   * @param {File} file Source image file.
   * @returns {Promise<HTMLImageElement>} Decoded image.
   */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = document.createElement("img");
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败，请确认文件没有损坏"));
      };
      image.src = url;
    });
  }

  /**
   * Encodes a canvas as a PNG blob.
   * @param {HTMLCanvasElement} canvas Source canvas.
   * @returns {Promise<Blob>} Encoded PNG.
   */
  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 编码失败"));
      }, "image/png");
    });
  }

  /**
   * Downloads one canvas and releases its temporary URL.
   * @param {HTMLCanvasElement} canvas Source canvas.
   * @param {string} fileName Download filename.
   * @returns {Promise<void>}
   */
  async function downloadCanvas(canvas, fileName) {
    try {
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      root.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      throw new Error(errorMessage(error, "下载 PNG 失败"));
    }
  }

  /**
   * Validates and installs a new source image.
   * @param {File} file Image selected by the user.
   * @returns {Promise<boolean>} Whether the image was installed.
   */
  async function applyFile(file) {
    setBusy(true);
    setStatus("正在解码图片…", "working");
    try {
      if (!ACCEPTED_IMAGE_TYPE.test(file.type)) throw new Error("仅支持 PNG、JPG 和 WebP 图片");
      if (file.size <= 0) throw new Error("图片文件为空");
      if (file.size > MAX_FILE_BYTES) throw new Error("图片不能超过 20 MB");
      const image = await loadImage(file);
      const pixelCount = image.naturalWidth * image.naturalHeight;
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尺寸无效");
      if (pixelCount > MAX_SOURCE_PIXELS) throw new Error("图片不能超过 2000 万像素");

      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("无法创建源图画布");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      context.drawImage(image, 0, 0);
      state.source = {
        height: sourceCanvas.height,
        name: file.name || "untitled-image",
        width: sourceCanvas.width,
      };
      if (state.animationNameAuto || !elements.animationNameInput.value.trim()) {
        elements.animationNameInput.value = state.source.name.replace(/\.[^.]+$/, "") || "sprites";
        state.animationNameAuto = true;
      }

      const rgba = context.getImageData(0, 0, state.source.width, state.source.height).data;
      state.smartBackgroundColor = smartCutout.detectBackgroundColor(
        rgba,
        state.source.width,
        state.source.height,
      );
      const sampledColor = core.rgbToHex(state.smartBackgroundColor);
      elements.colorInput.value = sampledColor;
      elements.colorValue.textContent = sampledColor.toUpperCase();
      elements.sourceMeta.textContent = `${state.source.name} · ${state.source.width} × ${state.source.height}`;
      elements.previewCanvas.hidden = false;
      elements.emptyStage.hidden = true;
      state.workspace = workspaceCore.createDetectedWorkspace([], [], {
        uniformOutput: elements.uniformOutputInput.checked,
      });
      resetHistory();
      state.sliceCanvasCache = new WeakMap();
      state.pointerEdit = null;
      setToolMode("sample");
      renderAll();
      setStatus(`已自动识别背景色 ${sampledColor.toUpperCase()}，可以开始识别。`, "success");
      return true;
    } catch (error) {
      reportFailure(error, "图片加载失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Expands and clamps one box to the source bounds.
   * @param {object} box Detection rectangle.
   * @returns {object} Padded rectangle.
   */
  function getPaddedBox(box) {
    if (!state.source) throw new Error("请先加载源图片");
    const x = Math.max(0, box.x - OUTPUT_PADDING);
    const y = Math.max(0, box.y - OUTPUT_PADDING);
    const right = Math.min(state.source.width, box.x + box.w + OUTPUT_PADDING);
    const bottom = Math.min(state.source.height, box.y + box.h + OUTPUT_PADDING);
    return { ...box, x, y, w: right - x, h: bottom - y };
  }

  /**
   * Builds a stable cache key for one rendered slice configuration.
   * @returns {string} Current rendering fingerprint.
   */
  function sliceCanvasCacheKey() {
    return [
      OUTPUT_PADDING,
      elements.transparentInput.checked ? "smart" : "original",
      state.resolvedMode,
    ].join(":");
  }

  /**
   * Builds one cropped canvas and optionally applies the shared smart-cutout pipeline.
   * @param {object} box Detection rectangle.
   * @returns {HTMLCanvasElement} Cropped canvas.
   */
  function createSliceCanvas(box) {
    const cacheKey = sliceCanvasCacheKey();
    const cached = state.sliceCanvasCache.get(box);
    if (cached?.key === cacheKey) return cached.canvas;
    const padded = getPaddedBox(box);
    const output = document.createElement("canvas");
    output.width = padded.w;
    output.height = padded.h;
    const context = output.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建切片画布");
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, padded.x, padded.y, padded.w, padded.h, 0, 0, padded.w, padded.h);
    if (elements.transparentInput.checked) {
      const imageData = context.getImageData(0, 0, output.width, output.height);
      const transparent = smartCutout.applySmartCutout(
        imageData.data,
        output.width,
        output.height,
        state.smartBackgroundColor,
      );
      imageData.data.set(transparent);
      context.putImageData(imageData, 0, 0);
    }
    state.sliceCanvasCache.set(box, { canvas: output, key: cacheKey });
    return output;
  }

  /**
   * Returns maximum rendered crop dimensions for one frame sequence.
   * @param {object[]} boxes Ordered slice frames.
   * @returns {{width:number,height:number}} Maximum dimensions.
   */
  function maximumFrameSize(boxes) {
    const frames = boxes.map(createSliceCanvas);
    return {
      width: Math.max(0, ...frames.map((frame) => frame.width)),
      height: Math.max(0, ...frames.map((frame) => frame.height)),
    };
  }

  /**
   * Creates a rendered frame using the current non-destructive output setting.
   * @param {object} box Slice frame.
   * @param {{width:number,height:number}|null} uniformSize Optional uniform canvas size.
   * @returns {HTMLCanvasElement} Tight or unified frame canvas.
   */
  function createOutputFrame(box, uniformSize = null) {
    const frame = createSliceCanvas(box);
    if (!uniformSize || (frame.width === uniformSize.width && frame.height === uniformSize.height)) {
      return frame;
    }
    return bottomCenterFrame(frame, uniformSize.width, uniformSize.height);
  }

  /** Draws the source and all current detection boxes. @returns {void} */
  function renderPreview() {
    if (!state.source) return;
    const canvas = elements.previewCanvas;
    if (canvas.width !== state.source.width) canvas.width = state.source.width;
    if (canvas.height !== state.source.height) canvas.height = state.source.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(sourceCanvas, 0, 0);
    context.font = `700 ${Math.max(13, Math.round(state.source.width / 72))}px SFMono-Regular, monospace`;
    state.boxes.forEach((box, index) => {
      const selected = state.workspace.selection.ids.includes(box.id);
      const primary = index === state.selectedIndex;
      const position = locateBox(box);
      const groupIndex = position?.groupIndex ?? 0;
      const palette = GROUP_COLORS[groupIndex % GROUP_COLORS.length];
      const included = position ? state.groups[position.groupIndex].enabled : false;
      context.globalAlpha = included ? 1 : 0.45;
      context.fillStyle = palette.fill;
      context.strokeStyle = primary ? "#edf6f7" : selected ? "#f7b84b" : palette.stroke;
      context.lineWidth = primary
        ? Math.max(3, Math.round(state.source.width / 400))
        : Math.max(2, Math.round(state.source.width / 512));
      context.fillRect(box.x, box.y, box.w, box.h);
      context.strokeRect(box.x, box.y, box.w, box.h);
      context.fillStyle = primary ? "#edf6f7" : selected ? "#f7b84b" : palette.stroke;
      const label = position
        ? `G${ordinal(position.groupIndex)}.${ordinal(position.frameIndex)}`
        : String(index + 1);
      context.fillText(label, box.x + 4, Math.max(16, box.y + 16));
      context.globalAlpha = 1;
    });
    const selected = state.selectedIndex === null ? null : state.boxes[state.selectedIndex];
    if (selected && state.toolMode === "edit") {
      const renderedWidth = Math.max(1, canvas.getBoundingClientRect().width || canvas.clientWidth);
      const handleRadius = Math.max(4, Math.round((state.source.width / renderedWidth) * 5));
      context.fillStyle = "#edf6f7";
      context.strokeStyle = "#0a1017";
      context.lineWidth = Math.max(1, Math.round(handleRadius / 3));
      editorCore.handlePoints(selected).forEach((point) => {
        const size = handleRadius * 2;
        context.fillRect(point.x - handleRadius, point.y - handleRadius, size, size);
        context.strokeRect(point.x - handleRadius, point.y - handleRadius, size, size);
      });
    }
  }

  /** Coalesces high-frequency pointer updates into one canvas draw per frame. @returns {void} */
  function schedulePreviewRender() {
    if (state.previewFrameId !== null) return;
    state.previewFrameId = root.requestAnimationFrame(() => {
      state.previewFrameId = null;
      renderPreview();
    });
  }

  /** Stops the active animation-group preview timer. @returns {void} */
  function stopGroupPlayback() {
    if (state.playbackTimerId !== null) root.clearInterval(state.playbackTimerId);
    if (state.playbackButton) state.playbackButton.textContent = state.playbackIdleLabel || "播放";
    if (state.playbackCanvas) state.playbackCanvas.hidden = true;
    state.playbackTimerId = null;
    state.playbackButton = null;
    state.playbackCanvas = null;
    state.playbackIdleLabel = null;
  }

  /**
   * Draws one group frame into its compact playback canvas.
   * @param {HTMLCanvasElement} canvas Playback canvas.
   * @param {object} box Slice rectangle.
   * @param {number} frameIndex Zero-based frame index.
   * @param {{width:number,height:number}|null} [uniformSize] Optional output canvas size.
   * @returns {void}
   */
  function drawGroupPlaybackFrame(canvas, box, frameIndex, uniformSize = null) {
    const frame = createOutputFrame(box, uniformSize);
    canvas.width = 180;
    canvas.height = 160;
    canvas.dataset.frameIndex = String(frameIndex);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建动画预览画布");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    const scale = Math.min(1, (canvas.width - 16) / frame.width, (canvas.height - 16) / frame.height);
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));
    const x = Math.floor((canvas.width - width) / 2);
    const y = canvas.height - height - 8;
    context.drawImage(frame, x, y, width, height);
  }

  /**
   * Starts or stops playback for one sequence of slices.
   * @param {object[]} boxes Ordered slice rectangles.
   * @param {HTMLButtonElement} button Playback toggle.
   * @param {HTMLCanvasElement} canvas Playback canvas.
   * @param {string} label User-facing sequence label.
   * @returns {void}
   */
  function toggleSequencePlayback(boxes, button, canvas, label) {
    if (state.playbackButton === button) {
      stopGroupPlayback();
      setStatus(`已暂停${label}预览。`, "success");
      return;
    }
    stopGroupPlayback();
    if (boxes.length === 0) return;
    let frameIndex = 0;
    const uniformSize = state.workspace.uniformOutput ? maximumFrameSize(boxes) : null;
    try {
      canvas.hidden = false;
      drawGroupPlaybackFrame(canvas, boxes[frameIndex], frameIndex, uniformSize);
      state.playbackIdleLabel = button.textContent;
      button.textContent = "暂停播放";
      state.playbackButton = button;
      state.playbackCanvas = canvas;
      state.playbackTimerId = root.setInterval(() => {
        try {
          frameIndex = (frameIndex + 1) % boxes.length;
          drawGroupPlaybackFrame(canvas, boxes[frameIndex], frameIndex, uniformSize);
        } catch (error) {
          stopGroupPlayback();
          reportFailure(error, `${label}预览失败`);
        }
      }, 125);
      setStatus(`正在循环播放${label} · ${boxes.length} 帧。`, "success");
    } catch (error) {
      stopGroupPlayback();
      reportFailure(error, `${label}预览失败`);
    }
  }

  const groupController = groupControllerCore.createController({
    colors: GROUP_COLORS,
    createSliceCanvas,
    deleteSelectedFrames: deleteSelectedBox,
    documentApi: document,
    getGroups: workspaceGroups,
    getWorkspace: () => state.workspace,
    hasSource: () => Boolean(state.source),
    history,
    interactionStatus: elements.interactionStatus,
    invalidateSliceCache: () => {
      state.sliceCanvasCache = new WeakMap();
    },
    listElement: elements.sliceList,
    ordinal,
    renderAll,
    rootApi: root,
    setStatus,
    setToolMode,
    setWorkspace: (workspace) => {
      state.workspace = workspace;
    },
    stopGroupPlayback,
    toggleSequencePlayback,
    uniformOutputInput: elements.uniformOutputInput,
    workspaceCore,
  });

  /**
   * Applies a group or frame workspace mutation through the extracted controller.
   * @param {string} label History label.
   * @param {(workspace:object)=>object} mutate Pure mutation.
   * @param {string} message Success message.
   * @returns {boolean} Whether state changed.
   */
  function applyWorkspaceMutation(label, mutate, message) {
    return groupController.applyWorkspaceMutation(label, mutate, message);
  }

  /** Rebuilds the accessible animation-group and frame list. @returns {void} */
  function renderSliceList() {
    groupController.render();
  }

  /**
   * Writes detection counters and export enablement before any preview work.
   * Preview failures must not leave the UI stuck at the initial 0 BOXES state.
   * @returns {void}
   */
  function syncDetectionChrome() {
    const includedGroups = selectedGroups();
    const allGroupsSelected = state.groups.length > 0 && includedGroups.length === state.groups.length;
    elements.boxCount.textContent = `${state.boxes.length} BOXES / ${state.groups.length} GROUPS`;
    elements.groupSelection.textContent = `${includedGroups.length} / ${state.groups.length} 组`;
    elements.toggleGroupsButton.disabled = state.groups.length === 0;
    elements.toggleGroupsButton.textContent = allGroupsSelected ? "全部取消" : "全部选择";
    elements.editModeButton.disabled = state.boxes.length === 0;
    elements.addModeButton.disabled = !state.source;
    elements.sampleModeButton.disabled = !state.source;
    elements.playAllButton.disabled = state.boxes.length === 0;
    elements.regroupButton.disabled = state.boxes.length === 0;
    elements.normalizeBoxesButton.disabled = state.workspace.selection.ids.length < 2;
    elements.selectSmallSlicesButton.disabled = state.boxes.length < 2;
    elements.uniformOutputInput.checked = state.workspace.uniformOutput;
    const selected = state.selectedIndex === null ? null : state.boxes[state.selectedIndex];
    let position = null;
    try {
      position = selected ? locateBox(selected) : null;
    } catch (_error) {
      position = null;
    }
    elements.activeBox.textContent =
      selected && position
        ? `已选 ${state.workspace.selection.ids.length} · G${ordinal(position.groupIndex)} F${ordinal(position.frameIndex)} · X:${selected.x} Y:${selected.y} W:${selected.w} H:${selected.h}`
        : "NO SELECTION";
    elements.deleteButton.disabled = state.workspace.selection.ids.length === 0;
    elements.downloadSliceButton.disabled = !selected;
    elements.downloadSheetButton.disabled = includedGroups.length === 0;
    elements.addProjectButton.disabled = state.busy || includedGroups.length === 0;
    elements.clearSourceButton.disabled = state.busy || !state.source;
    elements.surface?.classList.toggle("hasSource", Boolean(state.source));
    elements.surface?.classList.toggle("hasDetection", state.boxes.length > 0);
    const stage = !state.source ? "source" : state.boxes.length ? "organize" : "detect";
    for (const step of elements.workflowSteps) {
      const order = ["source", "detect", "organize", "deliver"];
      step.classList.toggle("active", order.indexOf(step.dataset.scatterStep) <= order.indexOf(stage));
    }
    if (elements.resultSummary) {
      const label = elements.resultSummary.querySelector("span");
      const detail = elements.resultSummary.querySelector("strong");
      if (label) label.textContent = state.boxes.length ? "识别完成" : state.source ? "素材已就绪" : "等待素材";
      if (detail) {
        detail.textContent = state.boxes.length
          ? `已识别 ${state.boxes.length} 个区域 · 已建立 ${state.groups.length} 个分组`
          : state.source
            ? "下一步：智能识别主体"
            : "先选择一张包含散落元素的图片";
      }
    }
    if (elements.actionSummary) {
      elements.actionSummary.textContent = state.boxes.length
        ? `${includedGroups.length} 个动画组 · ${state.boxes.length} 个切片`
        : state.source
          ? "素材已载入，等待识别"
          : "尚未识别切片";
    }
    if (elements.stageAction) {
      elements.stageAction.disabled = state.busy;
      elements.stageAction.textContent = !state.source
        ? "选择素材"
        : state.boxes.length
          ? isStandaloneTool()
            ? "应用到工作集"
            : "加入动画项目"
          : "智能识别";
    }
  }

  /** Synchronizes counters first, then previews. @returns {boolean} Whether preview rendering succeeded. */
  function renderAll() {
    try {
      syncDetectionChrome();
    } catch (error) {
      reportFailure(error, "预览更新失败");
      return false;
    }
    try {
      if (state.previewFrameId !== null) {
        root.cancelAnimationFrame(state.previewFrameId);
        state.previewFrameId = null;
      }
      renderPreview();
      renderSliceList();
      setToolMode(state.toolMode);
      history.updateHistoryControls();
      return true;
    } catch (error) {
      reportFailure(error, "预览更新失败");
      return false;
    }
  }

  /** Runs connected-component detection for the current source. @returns {void} */
  function runDetection() {
    if (!state.source || state.busy) return;
    setStatus("正在扫描前景像素与连通区域…", "working");
    try {
      const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("无法读取源图像素");
      const rgba = context.getImageData(0, 0, state.source.width, state.source.height).data;
      const startedAt = performance.now();
      const result = core.detectScatterSlices(
        rgba,
        state.source.width,
        state.source.height,
        readDetectionOptions(),
      );
      history.pushUndo(state.boxes.length ? "重新识别切片" : "识别切片");
      installGroups(result.boxes);
      state.resolvedMode = result.mode;
      state.selectedIndex = state.boxes.length > 0 ? 0 : null;
      if (elements.organizePanel && state.boxes.length > 0) elements.organizePanel.open = true;
      setToolMode(state.boxes.length > 0 ? "edit" : "sample");
      const rendered = renderAll();
      if (!rendered) return;
      const duration = (performance.now() - startedAt).toFixed(1);
      const guideSummary = result.ignoredGuidePixels
        ? ` · 已过滤 ${result.ignoredGuidePixels} 个网格像素`
        : "";
      setStatus(
        `识别到 ${state.boxes.length} 个区域，自动分为 ${state.groups.length} 组 · ${result.mode}${guideSummary} · ${duration} ms`,
        "success",
      );
    } catch (error) {
      reportFailure(error, "识别失败");
    }
  }

  /**
   * Builds a grouped bottom-centered sprite sheet from selected animation rows.
   * @returns {HTMLCanvasElement} Stitched sheet.
   */
  function createStitchedSheet() {
    const groups = selectedGroups();
    if (groups.length === 0) throw new Error("请至少选择一个动画组");
    const cutsByGroup = groups.map((group) => group.boxes.map(createSliceCanvas));
    const cuts = cutsByGroup.flat();
    const plan = groupCore.createGroupedGridPlan(
      cutsByGroup.map((groupCuts) => groupCuts.length),
      OUTPUT_MAXIMUM_COLUMNS,
    );
    const cellWidth = Math.max(...cuts.map((canvas) => canvas.width));
    const cellHeight = Math.max(...cuts.map((canvas) => canvas.height));
    const width = cellWidth * plan.columns;
    const height = cellHeight * plan.rowCount;
    if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_OUTPUT_PIXELS) {
      throw new Error("输出精灵表尺寸过大，请减少留白或调整列数");
    }
    const sheet = document.createElement("canvas");
    sheet.width = width;
    sheet.height = height;
    const context = sheet.getContext("2d");
    if (!context) throw new Error("无法创建拼接画布");
    context.imageSmoothingEnabled = false;
    plan.rows.forEach((rowPlan) => {
      const groupCuts = cutsByGroup[rowPlan.groupIndex];
      for (let offset = 0; offset < rowPlan.count; offset += 1) {
        const cut = groupCuts[rowPlan.startIndex + offset];
        const x = offset * cellWidth + Math.floor((cellWidth - cut.width) / 2);
        const y = rowPlan.row * cellHeight + cellHeight - cut.height;
        context.drawImage(cut, x, y);
      }
    });
    return sheet;
  }

  /**
   * Handles a selected or dropped file and clears the native input when needed.
   * @param {File|null|undefined} file Candidate file.
   * @returns {Promise<boolean>} Whether the source image was installed.
   */
  async function handleFile(file) {
    try {
      if (!file) return false;
      return await applyFile(file);
    } catch (error) {
      reportFailure(error, "图片载入失败");
      return false;
    }
  }

  /** Removes the source image and every derived slice from the current browser session. @returns {void} */
  function clearSource() {
    if (!state.source || state.busy) return;
    cancelPointerEdit();
    stopGroupPlayback();
    state.source = null;
    state.smartBackgroundColor = null;
    state.workspace = workspaceCore.createDetectedWorkspace([], []);
    resetHistory();
    state.sliceCanvasCache = new WeakMap();
    state.toolMode = "sample";
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    elements.previewCanvas.width = 0;
    elements.previewCanvas.height = 0;
    elements.previewCanvas.hidden = true;
    elements.emptyStage.hidden = false;
    elements.fileInput.value = "";
    elements.sourceMeta.textContent = "未加载图片";
    elements.animationNameInput.value = "";
    state.animationNameAuto = true;
    elements.colorInput.value = "#98d79b";
    elements.colorValue.textContent = "#98D79B";
    renderAll();
    setBusy(false);
    setStatus("已清空源图片、识别框和切片分组。", "success");
  }

  /** Opens the destructive-action confirmation with a native fallback. @returns {void} */
  function requestClearSource() {
    if (!state.source || state.busy) return;
    elements.clearSourceDialog.returnValue = "cancel";
    if (typeof elements.clearSourceDialog.showModal === "function") {
      elements.clearSourceDialog.showModal();
      return;
    }
    if (root.confirm("清空当前素材、识别框和切片分组？")) clearSource();
  }

  /**
   * Downloads the selected slice with guarded error handling.
   * @returns {Promise<void>}
   */
  async function downloadSelectedSlice() {
    try {
      if (state.selectedIndex === null) throw new Error("请先选择一个切片");
      const canvas = createSliceCanvas(state.boxes[state.selectedIndex]);
      await downloadCanvas(canvas, `sprite-${String(state.selectedIndex + 1).padStart(3, "0")}.png`);
      setStatus("选中切片已导出。", "success");
    } catch (error) {
      reportFailure(error, "切片导出失败");
    }
  }

  /** Downloads the stitched sprite sheet with guarded error handling. @returns {Promise<void>} */
  async function downloadStitchedSheet() {
    try {
      const groups = selectedGroups();
      const sheet = createStitchedSheet();
      const baseName = state.source?.name.replace(/\.[^.]+$/, "") || "sprites";
      const groupLabel = groups.length === 1 ? groups[0].id : `${groups.length}-groups`;
      await downloadCanvas(sheet, `${baseName}-${groupLabel}.png`);
      setStatus(`已导出 ${groups.length} 个动画组 · ${sheet.width} × ${sheet.height}`, "success");
    } catch (error) {
      reportFailure(error, "拼接导出失败");
    }
  }

  /**
   * Draws a cropped frame onto a shared transparent canvas using a bottom-center anchor.
   * @param {HTMLCanvasElement} frame Cropped frame.
   * @param {number} width Output width.
   * @param {number} height Output height.
   * @returns {HTMLCanvasElement} Unified frame canvas.
   */
  function bottomCenterFrame(frame, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建合并动画画布");
    context.imageSmoothingEnabled = false;
    context.drawImage(frame, Math.floor((width - frame.width) / 2), height - frame.height);
    return canvas;
  }

  /** Builds one or more ordered worksets from the selected visual row groups. */
  function projectWorksets() {
    const groups = selectedGroups();
    if (!groups.length) throw new Error("请至少选择一个动画组");
    const baseName = elements.animationNameInput.value.trim() || "sprites";
    if (elements.projectModeInput.value === "merge") {
      const frames = groups.flatMap((group) => group.boxes.map(createSliceCanvas));
      const width = Math.max(...frames.map((frame) => frame.width));
      const height = Math.max(...frames.map((frame) => frame.height));
      if (
        width > MAX_CANVAS_SIDE ||
        height > MAX_CANVAS_SIDE ||
        width * height * frames.length > MAX_HANDOFF_PIXELS
      ) {
        throw new Error("合并动画的统一画布总量过大，请减少切片数量、留白或源图尺寸");
      }
      return [
        {
          id: `scatter-merged-${Date.now()}`,
          label: baseName,
          animationName: baseName,
          profileLabel: "character",
          profileKind: "actor",
          animationType: "actor",
          anchorMode: "canvas_bottom_center",
          fps: 12,
          items: frames.map((frame, sourceIndex) => ({
            sourceIndex,
            name: `frame_${String(sourceIndex + 1).padStart(4, "0")}.png`,
            data: bottomCenterFrame(frame, width, height).toDataURL("image/png"),
            flipped: false,
          })),
        },
      ];
    }
    const outputs = groups.map((group) => {
      const size = state.workspace.uniformOutput ? maximumFrameSize(group.boxes) : null;
      return {
        group,
        frames: group.boxes.map((box) => createOutputFrame(box, size)),
      };
    });
    const totalPixels = outputs.reduce(
      (total, output) =>
        total + output.frames.reduce((groupTotal, frame) => groupTotal + frame.width * frame.height, 0),
      0,
    );
    if (totalPixels > MAX_HANDOFF_PIXELS) {
      throw new Error("所选切片的项目写入总量过大，请减少切片数量、留白或源图尺寸");
    }
    return outputs.map(({ group, frames }) => {
      const groupIndex = state.groups.findIndex((candidate) => candidate.id === group.id);
      const defaultName = `动画组 ${String(groupIndex + 1).padStart(2, "0")}`;
      const animationName =
        group.name === defaultName
          ? `${baseName}-group-${String(groupIndex + 1).padStart(2, "0")}`
          : `${baseName}-${group.name}`;
      return {
        id: `scatter-${group.id}-${Date.now()}`,
        label: animationName,
        animationName,
        profileLabel: "character",
        profileKind: "actor",
        animationType: "actor",
        anchorMode: "canvas_bottom_center",
        fps: 12,
        items: frames.map((frame, sourceIndex) => ({
          sourceIndex,
          name: `frame_${String(sourceIndex + 1).padStart(4, "0")}.png`,
          data: frame.toDataURL("image/png"),
          flipped: false,
        })),
      };
    });
  }

  /** Returns whether the slice editor is running as a project-free quick tool. */
  function isStandaloneTool() {
    return root.location.pathname.startsWith("/tools/");
  }

  /** Builds canvases for enabled groups while preserving their visual order and identity. */
  function temporaryWorkset() {
    const groups = selectedGroups().map((group) => {
      const uniformSize = state.workspace.uniformOutput ? maximumFrameSize(group.boxes) : null;
      return {
        id: group.id,
        name: group.name,
        enabled: true,
        frames: group.boxes,
        uniformSize,
      };
    });
    const baseName = elements.animationNameInput.value.trim() || state.source?.name || "零散切片";
    return temporaryWorksetCore.createTemporaryWorkset({
      name: baseName.replace(/\.[^.]+$/, ""),
      groups,
      createCanvas: (frame, group) => createOutputFrame(frame, group.uniformSize),
    });
  }

  /** Publishes selected slice groups to the shared quick-tool session and opens organizer. */
  async function applySelectedGroupsToTemporaryWorkset() {
    if (state.busy) return;
    setStatus("正在生成临时工作集…", "working");
    try {
      const parentWindow = root.parent && root.parent !== root ? root.parent : root;
      const temporaryStore = parentWindow.XSXBTemporaryWorkset;
      const navigate = parentWindow.XSXBNavigateWorkbench;
      if (!temporaryStore?.setWorkset || typeof navigate !== "function") {
        throw new Error("临时工作集尚未就绪，请从快速工具首页重新进入零散切片");
      }
      const workset = temporaryWorkset();
      temporaryStore.setWorkset(workset);
      setStatus(`已生成 ${workset.frames.length} 帧，正在进入导入与整理…`, "success");
      await navigate("organizer", "standalone");
    } catch (error) {
      reportFailure(error, "应用到工作集失败");
    }
  }

  /** Opens the parent application's shared project handoff without discarding slice state. */
  async function addSelectedGroupsToProject() {
    if (state.busy) return;
    setStatus("正在准备动画项目目标…", "working");
    try {
      const parentWindow = root.parent && root.parent !== root ? root.parent : root;
      const openHandoff = parentWindow.XSXBOpenWorksetHandoff;
      if (typeof openHandoff !== "function") {
        throw new Error("请从 /tools/scatter-slice 打开统一工具界面后再加入项目");
      }
      await openHandoff({ sourceTool: "scatter-slice", worksets: projectWorksets() });
      setStatus("已打开项目目标选择；切片会话仍然保留。", "success");
    } catch (error) {
      reportFailure(error, "加入动画项目失败");
    }
  }

  /**
   * Returns the resize-handle hit radius in source-image pixels.
   * @returns {number} Handle radius.
   */
  function editorHandleRadius() {
    if (!state.source) return 6;
    const rect = canvasContentRect();
    const scaleX = state.source.width / Math.max(1, rect.width);
    const scaleY = state.source.height / Math.max(1, rect.height);
    return Math.max(4, Math.ceil(Math.max(scaleX, scaleY) * 6));
  }

  /**
   * Returns the rendered bitmap content box without the canvas CSS border.
   * @returns {{left:number,top:number,width:number,height:number}} Content rectangle.
   */
  function canvasContentRect() {
    const rect = elements.previewCanvas.getBoundingClientRect();
    return {
      left: rect.left + elements.previewCanvas.clientLeft,
      top: rect.top + elements.previewCanvas.clientTop,
      width: elements.previewCanvas.clientWidth,
      height: elements.previewCanvas.clientHeight,
    };
  }

  /**
   * Converts one pointer event to source-image coordinates.
   * @param {PointerEvent|MouseEvent} event Browser pointer event.
   * @returns {{x:number,y:number}} Source-image point.
   */
  function sourcePointFromEvent(event) {
    return editorCore.pointFromClient(
      { x: event.clientX, y: event.clientY },
      canvasContentRect(),
      sourceBounds(),
    );
  }

  /**
   * Returns a CSS cursor for an editor hit result.
   * @param {{action:"move"|"resize",handle?:string}|null} hit Hit result.
   * @returns {string} CSS cursor.
   */
  function cursorForHit(hit) {
    if (!hit) return "default";
    if (hit.action === "move") return "move";
    if (["n", "s"].includes(hit.handle)) return "ns-resize";
    if (["e", "w"].includes(hit.handle)) return "ew-resize";
    if (["ne", "sw"].includes(hit.handle)) return "nesw-resize";
    return "nwse-resize";
  }

  /**
   * Begins moving or resizing a detected slice.
   * @param {PointerEvent} event Pointer-down event.
   * @returns {void}
   */
  function beginPointerEdit(event) {
    if (!["edit", "add"].includes(state.toolMode) || !state.source || event.button !== 0) return;
    event.preventDefault();
    const point = sourcePointFromEvent(event);
    if (state.toolMode === "add") {
      const newBox = editorCore.createBoxFromPoints(point, point, sourceBounds());
      const beforeSnapshot = workspaceCore.snapshotWorkspace(state.workspace);
      const previousRedoStack = [...state.redoStack];
      history.pushUndo("添加切片");
      state.workspace = workspaceCore.insertFrame(state.workspace, newBox, {
        afterFrameId: state.workspace.selection.primaryId,
      });
      const createdFrame = state.boxes.find((box) => box.id === state.workspace.selection.primaryId);
      state.pointerEdit = {
        action: "create",
        beforeSnapshot,
        box: createdFrame,
        handle: null,
        originalBox: { ...createdFrame },
        pointerId: event.pointerId,
        previousRedoStack,
        start: point,
      };
      elements.previewCanvas.setPointerCapture(event.pointerId);
      elements.previewCanvas.style.cursor = "crosshair";
      renderPreview();
      return;
    }
    const hit = editorCore.hitTestBoxes(state.boxes, point, state.selectedIndex, editorHandleRadius());
    if (!hit) {
      state.selectedIndex = null;
      renderAll();
      return;
    }
    const hitFrameId = state.boxes[hit.index].id;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      state.workspace = workspaceCore.selectFrame(state.workspace, hitFrameId, {
        range: event.shiftKey,
        toggle: event.metaKey || event.ctrlKey,
      });
      if (!state.workspace.selection.ids.includes(hitFrameId)) {
        renderAll();
        return;
      }
    } else if (state.workspace.selection.ids.includes(hitFrameId)) {
      state.workspace = workspaceCore.setSelection(
        state.workspace,
        state.workspace.selection.ids,
        hitFrameId,
      );
    } else {
      state.workspace = workspaceCore.selectFrame(state.workspace, hitFrameId);
    }
    const editedBox = state.boxes.find((box) => box.id === hitFrameId);
    const beforeSnapshot = workspaceCore.snapshotWorkspace(state.workspace);
    const previousRedoStack = [...state.redoStack];
    history.pushUndo(hit.action === "move" ? "移动切片" : "缩放切片");
    state.pointerEdit = {
      action: hit.action,
      beforeSnapshot,
      box: editedBox,
      handle: hit.handle || null,
      originalBox: { ...editedBox },
      pointerId: event.pointerId,
      previousRedoStack,
      start: point,
    };
    elements.previewCanvas.setPointerCapture(event.pointerId);
    elements.previewCanvas.style.cursor = cursorForHit(hit);
    renderAll();
  }

  /**
   * Applies one in-progress pointer edit without rebuilding thumbnails.
   * @param {PointerEvent} event Pointer-move event.
   * @returns {void}
   */
  function updatePointerEdit(event) {
    if (!state.source || !["edit", "add"].includes(state.toolMode)) return;
    const point = sourcePointFromEvent(event);
    if (!state.pointerEdit || state.pointerEdit.pointerId !== event.pointerId) {
      if (state.toolMode === "add") {
        elements.previewCanvas.style.cursor = "crosshair";
        return;
      }
      const hit = editorCore.hitTestBoxes(state.boxes, point, state.selectedIndex, editorHandleRadius());
      elements.previewCanvas.style.cursor = cursorForHit(hit);
      return;
    }
    event.preventDefault();
    const deltaX = point.x - state.pointerEdit.start.x;
    const deltaY = point.y - state.pointerEdit.start.y;
    let nextBox;
    if (state.pointerEdit.action === "create") {
      nextBox = editorCore.createBoxFromPoints(state.pointerEdit.start, point, sourceBounds());
    } else if (state.pointerEdit.action === "move") {
      nextBox = editorCore.moveBox(state.pointerEdit.originalBox, deltaX, deltaY, sourceBounds());
    } else {
      nextBox = editorCore.resizeBox(
        state.pointerEdit.originalBox,
        state.pointerEdit.handle,
        deltaX,
        deltaY,
        sourceBounds(),
      );
    }
    Object.assign(state.pointerEdit.box, nextBox);
    schedulePreviewRender();
  }

  /**
   * Commits an in-progress pointer edit and refreshes all derived views.
   * @param {PointerEvent} event Pointer-up or pointer-cancel event.
   * @returns {void}
   */
  function finishPointerEdit(event) {
    if (!state.pointerEdit || state.pointerEdit.pointerId !== event.pointerId) return;
    const pointerEdit = state.pointerEdit;
    const created = pointerEdit.action === "create";
    const changed =
      created || ["x", "y", "w", "h"].some((key) => pointerEdit.box[key] !== pointerEdit.originalBox[key]);
    state.pointerEdit = null;
    if (elements.previewCanvas.hasPointerCapture(event.pointerId)) {
      elements.previewCanvas.releasePointerCapture(event.pointerId);
    }
    if (!changed) {
      state.undoStack.pop();
      state.redoStack = pointerEdit.previousRedoStack;
      history.updateHistoryControls();
    }
    state.sliceCanvasCache = new WeakMap();
    if (created) setToolMode("edit");
    renderAll();
    setStatus(
      created
        ? "已添加新切片并归入当前动画组。"
        : changed
          ? "已更新切片范围；原动画分组与顺序保持不变。"
          : "切片范围未变化。",
      "success",
    );
  }

  /** Cancels pointer capture before a destructive state change. @returns {void} */
  function cancelPointerEdit() {
    if (!state.pointerEdit) return;
    const pointerEdit = state.pointerEdit;
    const pointerId = pointerEdit.pointerId;
    state.workspace = workspaceCore.restoreWorkspace(pointerEdit.beforeSnapshot);
    state.undoStack.pop();
    state.redoStack = pointerEdit.previousRedoStack;
    state.pointerEdit = null;
    if (elements.previewCanvas.hasPointerCapture(pointerId)) {
      elements.previewCanvas.releasePointerCapture(pointerId);
    }
    history.updateHistoryControls();
  }

  /**
   * Samples a background color from the source canvas.
   * @param {MouseEvent} event Canvas click event.
   * @returns {void}
   */
  function sampleBackgroundColor(event) {
    if (!state.source || state.toolMode !== "sample") return;
    try {
      const point = sourcePointFromEvent(event);
      const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("无法读取源图颜色");
      const rgba = context.getImageData(0, 0, state.source.width, state.source.height).data;
      const sampled = core.samplePixelHex(rgba, state.source.width, state.source.height, point.x, point.y);
      elements.colorInput.value = sampled;
      elements.colorValue.textContent = sampled.toUpperCase();
      elements.modeInput.value = "colorkey";
      setStatus(`已取色 ${sampled.toUpperCase()}，请重新识别。`, "success");
    } catch (error) {
      reportFailure(error, "取色失败");
    }
  }

  /** Deletes the selected rectangle and rebuilds derived views. @returns {void} */
  function deleteSelectedBox() {
    if (state.workspace.selection.ids.length === 0) return;
    cancelPointerEdit();
    const count = state.workspace.selection.ids.length;
    history.pushUndo(count > 1 ? `删除 ${count} 个切片` : "删除切片");
    state.workspace = workspaceCore.deleteSelectedFrames(state.workspace);
    state.sliceCanvasCache = new WeakMap();
    if (state.boxes.length === 0) setToolMode("sample");
    renderAll();
    setStatus(`已删除 ${count} 个选中切片。`, "success");
  }

  /**
   * Checks whether a keyboard event target owns text or activation behavior.
   * @param {EventTarget|null} target Event target.
   * @returns {boolean} Whether the shortcut must be ignored.
   */
  function isInteractiveTarget(target) {
    if (typeof root.Element !== "function" || !(target instanceof root.Element)) return false;
    if (target.closest("input, select, textarea, button, a")) return true;
    const editable = target.closest("[contenteditable]");
    return Boolean(editable?.isContentEditable);
  }

  elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
  elements.clearSourceButton.addEventListener("click", requestClearSource);
  elements.clearSourceDialog.addEventListener("click", (event) => {
    if (event.target === elements.clearSourceDialog) elements.clearSourceDialog.close("cancel");
  });
  elements.clearSourceDialog.addEventListener("close", () => {
    if (elements.clearSourceDialog.returnValue === "clear") clearSource();
  });
  elements.emptyStage.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    elements.fileInput.value = "";
    void handleFile(file);
  });
  clipboardMedia.bindPaste({
    target: document,
    accept: ["image"],
    isActive: () => !state.busy && !elements.surface?.hidden,
    onPaste: async ({ images }) => {
      const installed = await handleFile(images[0]);
      if (installed && images.length > 1) {
        setStatus(`零散切片一次处理一张图片，已载入第 1 张并忽略其余 ${images.length - 1} 张。`, "success");
      }
    },
    onUnsupported: () => setStatus("零散切片只支持粘贴 PNG、JPG 或 WebP 图片。", "error"),
    onError: (error) => reportFailure(error, "粘贴图片失败"),
  });
  elements.detectButton.addEventListener("click", runDetection);
  elements.undoButton.addEventListener("click", history.undo);
  elements.redoButton.addEventListener("click", history.redo);
  elements.regroupButton.addEventListener("click", () => {
    applyWorkspaceMutation(
      "按位置重新分组",
      (workspace) => {
        const rows = groupCore.groupBoxesByRows(workspace.frames).map((group) => ({
          frameIds: group.boxes.map((box) => box.id),
        }));
        return workspaceCore.regroupWorkspace(workspace, rows);
      },
      "已按源图位置重新生成动画分组。",
    );
  });
  elements.normalizeBoxesButton.addEventListener("click", () => {
    applyWorkspaceMutation(
      "统一裁剪框",
      (workspace) => workspaceCore.normalizeSelectedBoxes(workspace, sourceBounds()),
      `已将 ${state.workspace.selection.ids.length} 个裁剪框扩展为统一尺寸。`,
    );
  });
  elements.selectSmallSlicesButton.addEventListener("click", () => {
    try {
      const ratio = Number(elements.smallSliceRatioInput.value);
      state.workspace = workspaceCore.selectFramesByRelativeArea(state.workspace, ratio);
      renderAll();
      const count = state.workspace.selection.ids.length;
      setStatus(
        count > 0
          ? `已按尺寸选择 ${count} 个小切片；确认后可统一删除或另建组。`
          : `没有找到面积不超过最大切片 ${Math.round(ratio * 100)}% 的区域。`,
        count > 0 ? "success" : "working",
      );
    } catch (error) {
      reportFailure(error, "小切片筛选失败");
    }
  });
  elements.animationNameInput.addEventListener("input", () => {
    state.animationNameAuto = !elements.animationNameInput.value.trim();
  });
  elements.colorInput.addEventListener("input", () => {
    elements.colorValue.textContent = elements.colorInput.value.toUpperCase();
  });
  elements.transparentInput.addEventListener("change", () => {
    state.sliceCanvasCache = new WeakMap();
    renderAll();
    setStatus(
      elements.transparentInput.checked
        ? "智能抠图已开启，缩略图、动画预览与导出已更新。"
        : "智能抠图已关闭，当前显示源图裁剪结果。",
      "success",
    );
  });
  elements.uniformOutputInput.addEventListener("change", () => {
    const enabled = elements.uniformOutputInput.checked;
    applyWorkspaceMutation(
      enabled ? "开启统一输出画布" : "关闭统一输出画布",
      (workspace) => workspaceCore.setUniformOutput(workspace, enabled),
      enabled ? "动画预览与导出将使用组内统一画布。" : "独立动画将保留各帧原始裁剪尺寸。",
    );
  });
  elements.playAllButton.addEventListener("click", () => {
    const boxes = state.groups.flatMap((group) => group.boxes);
    toggleSequencePlayback(boxes, elements.playAllButton, elements.playAllCanvas, "全部切片");
  });
  elements.editModeButton.addEventListener("click", () => {
    setToolMode("edit");
    renderAll();
    setStatus("编辑模式：拖动框体移动，拖动控制点缩放。", "success");
  });
  elements.addModeButton.addEventListener("click", () => {
    setToolMode("add");
    renderAll();
    setStatus("添加模式：在原图上按住并拖动以创建新切片。", "success");
  });
  elements.sampleModeButton.addEventListener("click", () => {
    setToolMode("sample");
    renderAll();
    setStatus("取色模式：点击源图选择背景色。", "success");
  });
  elements.toggleGroupsButton.addEventListener("click", () => {
    const allSelected = selectedGroups().length === state.groups.length;
    applyWorkspaceMutation(
      allSelected ? "取消全部导出组" : "选择全部导出组",
      (workspace) =>
        workspace.groups.reduce(
          (next, group) => workspaceCore.setGroupEnabled(next, group.id, !allSelected),
          workspace,
        ),
      allSelected ? "已取消全部动画组；请选择需要导出的组。" : "已选择全部动画组。",
    );
  });
  elements.previewCanvas.addEventListener("click", sampleBackgroundColor);
  elements.previewCanvas.addEventListener("pointerdown", beginPointerEdit);
  elements.previewCanvas.addEventListener("pointermove", updatePointerEdit);
  elements.previewCanvas.addEventListener("pointerup", finishPointerEdit);
  elements.previewCanvas.addEventListener("pointercancel", finishPointerEdit);
  elements.previewCanvas.addEventListener("pointerleave", () => {
    if (!state.pointerEdit && state.toolMode === "edit") elements.previewCanvas.style.cursor = "default";
  });
  elements.deleteButton.addEventListener("click", deleteSelectedBox);
  elements.stageAction?.addEventListener("click", () => {
    if (!state.source) elements.fileInput.click();
    else if (!state.boxes.length) runDetection();
    else if (isStandaloneTool()) void applySelectedGroupsToTemporaryWorkset();
    else elements.addProjectButton.click();
  });
  document.addEventListener("keydown", (event) => {
    if (elements.surface?.hidden) return;
    if (isInteractiveTarget(event.target)) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      history.redo();
      return;
    }
    if (!["Delete", "Backspace"].includes(event.key)) return;
    if (state.selectedIndex === null) return;
    event.preventDefault();
    deleteSelectedBox();
  });
  elements.downloadSliceButton.addEventListener("click", () => void downloadSelectedSlice());
  elements.downloadSheetButton.addEventListener("click", () => void downloadStitchedSheet());
  elements.addProjectButton.addEventListener("click", () => void addSelectedGroupsToProject());
  root.XSXBScatterSliceSession = Object.freeze({
    allowDiscard() {
      state.suppressBeforeUnload = true;
    },
    hasUnsavedChanges() {
      return Boolean(state.source);
    },
    clear: clearSource,
  });
  root.addEventListener("beforeunload", (event) => {
    if (state.suppressBeforeUnload || !state.source) return;
    event.preventDefault();
    event.returnValue = "";
  });
  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!state.busy) elements.dropZone.classList.add("isDragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("isDragging");
    });
  }
  elements.dropZone.addEventListener("drop", (event) => {
    if (state.busy) return;
    void handleFile(event.dataTransfer?.files?.[0]);
  });
})(window);
