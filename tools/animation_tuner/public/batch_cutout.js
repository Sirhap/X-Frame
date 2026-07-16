(function attachBatchCutout(root) {
  "use strict";

  /**
   * Settles async work with bounded concurrency while preserving input order.
   * @template T,U
   * @param {T[]} inputs Input values.
   * @param {(value:T,index:number)=>Promise<U>} mapper Async mapper.
   * @param {number} [concurrency] Maximum active operations.
   * @returns {Promise<PromiseSettledResult<U>[]>} Ordered settled results.
   */
  async function mapSettledWithConcurrency(inputs, mapper, concurrency = 6) {
    const values = Array.from(inputs || []);
    const results = new Array(values.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { status: "fulfilled", value: await mapper(values[index], index) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()),
    );
    return results;
  }

  const TEXT = {
    zh: {
      title: "批量抠图",
      subtitle: "本地像素处理 · 图片不会上传",
      open: "批量抠图",
      close: "关闭",
      addFiles: "选择图片",
      appendFiles: "继续添加",
      loadGroup: "载入当前组",
      emptyTitle: "拖入 PNG / JPG / WebP",
      emptyHint: "支持多选。自动识别背景；连通清除与柔性色键按需开启。",
      autoColor: "每张图自动取背景色",
      backgroundColor: "背景色",
      backgroundSample: "添加背景样本",
      backgroundClear: "清除样本",
      backgroundSampling: "请点击原图中的另一处背景",
      backgroundAdded: "已添加背景样本 {color}",
      regular: "常规",
      post: "后处理",
      advanced: "高级",
      zoomFit: "适应",
      zoomActual: "100%",
      zoomHint: "滚轮缩放；按住空格拖拽平移",
      settingsTitle: "处理参数",
      settingsHint: "调整后自动刷新预览",
      sourceDetection: "背景识别",
      keyQuality: "抠图质量",
      spillCleanup: "色彩净化",
      edgeRefinement: "边缘重建",
      advancedTitle: "精细 Alpha 与保护色",
      advancedHint: "先选择预设，再针对边缘细节微调。",
      presetConservative: "保守",
      presetConservativeHint: "保留发丝与半透明",
      presetBalanced: "均衡",
      presetBalancedHint: "适合大多数序列",
      presetHard: "硬边",
      presetHardHint: "像素图与纯色边缘",
      alphaWindow: "透明度窗口",
      alphaWindowHint: "低于下限清空，高于上限转为不透明",
      protectedPalette: "保护色板",
      protectedPaletteHint: "点击色块可移除",
      tolerance: "容差",
      edgeBoost: "边缘清除增强",
      feather: "边缘柔化",
      chromaCleanup: "色键清理",
      chromaFeather: "色键柔边",
      perceptual: "OKLab / YCbCr 柔性色键",
      alphaThreshold: "硬透明阈值",
      despillStrength: "全局去污强度",
      despillMode: "边缘去污模式",
      despillGeneral: "通用模式",
      despillBlend: "混合模式",
      despillChroma: "褪色模式",
      edgeDespillRadius: "边缘去污半径",
      edgeRecoveryStrength: "边缘颜色恢复",
      backgroundRadius: "背景搜索半径",
      blurRadius: "柔化半径",
      postHint: "用于清理主体边缘残留的背景色，不改变透明区域。",
      alphaLow: "半透明低阈值",
      alphaHigh: "半透明高阈值",
      protectionTolerance: "保护色容差",
      colorProtection: "颜色保护",
      colorProtectionHint: "启用后点击原图，保留相近颜色",
      protectSample: "吸取保护色",
      protectClear: "清除",
      protectSampling: "请点击原图中需要保护的颜色",
      protectedColorAdded: "已添加保护色 {color}",
      connected: "仅清除边缘连通背景",
      original: "原图",
      result: "透明结果",
      editorCanvas: "编辑画布",
      viewResult: "结果",
      viewOriginal: "原图",
      viewAlpha: "Alpha",
      viewDifference: "差异",
      viewResultCaption: "透明结果 · 可编辑",
      viewOriginalCaption: "原始图像 · 只读",
      viewAlphaCaption: "Alpha 蒙版 · 白色为保留",
      viewDifferenceCaption: "差异高亮 · 红色移除 / 黄色半透明 / 青色修色",
      diagnosticReadOnly: "诊断视图为只读；选择修正工具会自动返回结果视图",
      download: "导出 ZIP",
      applyGroup: "替换当前动画组",
      applyWorkset: "应用到导入动画",
      clear: "清空",
      pickHint: "先点“添加背景样本”，再在编辑画布上取色",
      ready: "等待图片",
      processing: "正在处理 {current}/{total}…",
      selected: "已载入 {count} 张图片",
      processed: "完成：{count} 张，移除 {pixels} 个像素",
      zipping: "正在压缩 {current}/{total}…",
      downloaded: "ZIP 已生成：{count} 张图片，失败 {failed} 张",
      applied: "当前动画组已替换，共 {count} 帧",
      worksetLoaded: "已载入导入动画：{name}（{count} 帧）",
      worksetApplied: "抠图结果已回写导入动画，共 {count} 帧",
      worksetMismatch: "导入动画抠图必须保留全部帧（当前包含 {included} / {total}）",
      failed: "处理失败：{message}",
      invalidFiles: "没有找到支持的图片文件",
      tooMany: "单次最多处理 240 张图片",
      groupUnavailable: "当前没有可用的动画组",
      groupLoaded: "已载入当前动画组：{name}（{count} 帧）",
      applyMismatch: "图片数量必须与当前组帧数一致（图片 {files} / 帧 {frames}）",
      applyConfirm: "这会覆盖当前动画组的原始 PNG 帧。确定继续吗？",
      applyTitle: "替换当前动画组？",
      cancel: "取消",
      confirmApply: "确认替换",
      framePrefix: "帧",
      batchTray: "批次结果",
      showResult: "结果",
      showOriginal: "原图",
      includeAll: "全部包含",
      excludeAll: "全部排除",
      selectAll: "全选",
      invertSelection: "反选",
      excludeSelected: "排除所选",
      deleteSelected: "删除所选",
      retryFailed: "重试失败",
      cancelProcess: "停止处理",
      includeFrame: "包含此帧",
      excludeFrame: "排除此帧",
      removeFrame: "移除此帧",
      batchSummary: "包含 {included}/{total} · 已选 {selected} · 已生成 {processed} · 失败 {failed}",
      qualityOnly: "只看异常",
      nextIssue: "下一异常",
      qualityEmpty: "主体为空",
      qualityArea: "面积突变",
      qualityPosition: "位置突跳",
      qualitySoftEdge: "软边异常",
      qualitySplit: "主体分裂",
      qualityHoles: "主体孔洞",
      qualityClipped: "画布裁切",
      qualityTransparentRgb: "透明 RGB 污染",
      qualityBackgroundResidue: "残余背景色",
      qualityNone: "未发现异常帧",
      qualityFilteredEmpty: "当前没有已检测出的异常帧",
      partialProcessed: "完成 {count} 张，跳过 {excluded} 张，失败 {failed} 张",
      noIncluded: "当前批次没有包含任何图片",
      frameFailed: "第 {index} 张处理失败：{message}",
      cancelled: "已停止处理，未生成下载文件",
      applyAnimation: "动画组",
      applyFrames: "替换帧数",
      applyExcluded: "排除帧数",
      sample: "背景 {color}",
      connectedMode: "连通",
      globalMode: "全图",
      localRepair: "框选局部修正",
      repairSmart: "智能清除",
      repairBrush: "画笔",
      repairEraser: "橡皮擦",
      brushSize: "大小",
      brushHardness: "硬度",
      brushOpacity: "不透明度",
      brushColor: "颜色",
      repairClear: "整块清空",
      repairRestore: "恢复主体",
      repairProtect: "框选保护",
      repairUndo: "撤销框选",
      repairRedo: "重做框选",
      repairReset: "清除修正",
      repairUndoShort: "撤销",
      repairRedoShort: "重做",
      repairResetShort: "清除",
      repairBatch: "传播到全部帧",
      repairHint: "直接在编辑画布上绘制或框选",
      repaired: "已添加局部修正：{mode}",
      protectedRegion: "已从框选区域提取 {count} 个保护色",
      protectedRegionCoverage: "已提取 {count} 个保护色，覆盖率 {coverage}%",
      protectedRegionIncomplete: "已提取 {count} 个保护色，覆盖率仅 {coverage}%，建议扩大框选或补充保护色",
      batchRepaired: "已将局部修正传播到 {count} 帧，跳过 {skipped} 帧",
      batchRepairUnavailable: "请先添加一个局部修正",
      repairSmartMode: "智能清除",
      repairClearMode: "整块清空",
      repairRestoreMode: "恢复主体",
      repairProtectMode: "框选保护",
    },
    en: {
      title: "Batch Cutout",
      subtitle: "Local pixel processing · images never leave this device",
      open: "Batch Cutout",
      close: "Close",
      addFiles: "Choose Images",
      appendFiles: "Add More",
      loadGroup: "Load Current Group",
      emptyTitle: "Drop PNG / JPG / WebP",
      emptyHint: "Multi-select supported. Background is detected automatically; connected and perceptual modes are optional.",
      autoColor: "Auto-sample each image",
      backgroundColor: "Background",
      backgroundSample: "Add Background Sample",
      backgroundClear: "Clear Samples",
      backgroundSampling: "Click another background area in the original preview",
      backgroundAdded: "Added background sample {color}",
      regular: "Regular",
      post: "Post",
      advanced: "Advanced",
      zoomFit: "Fit",
      zoomActual: "100%",
      zoomHint: "Wheel to zoom; hold Space and drag to pan",
      settingsTitle: "Processing",
      settingsHint: "Preview refreshes automatically",
      sourceDetection: "Background detection",
      keyQuality: "Key quality",
      spillCleanup: "Color cleanup",
      edgeRefinement: "Edge reconstruction",
      advancedTitle: "Fine alpha and color protection",
      advancedHint: "Choose a preset, then refine edge details.",
      presetConservative: "Conservative",
      presetConservativeHint: "Preserve hair and translucency",
      presetBalanced: "Balanced",
      presetBalancedHint: "Works for most sequences",
      presetHard: "Hard edge",
      presetHardHint: "Pixel art and solid edges",
      alphaWindow: "Alpha window",
      alphaWindowHint: "Clear below low; make opaque above high",
      protectedPalette: "Protected palette",
      protectedPaletteHint: "Click a swatch to remove it",
      tolerance: "Tolerance",
      edgeBoost: "Edge cleanup",
      feather: "Edge softness",
      chromaCleanup: "Chroma cleanup",
      chromaFeather: "Chroma feather",
      perceptual: "OKLab / YCbCr perceptual key",
      alphaThreshold: "Hard alpha",
      despillStrength: "Global despill",
      despillMode: "Edge despill mode",
      despillGeneral: "General",
      despillBlend: "Blend",
      despillChroma: "Chroma",
      edgeDespillRadius: "Edge radius",
      edgeRecoveryStrength: "Edge color recovery",
      backgroundRadius: "Background search",
      blurRadius: "Blur radius",
      postHint: "Reduces background-color contamination along visible subject edges.",
      alphaLow: "Alpha low",
      alphaHigh: "Alpha high",
      protectionTolerance: "Protection tolerance",
      colorProtection: "Color protection",
      colorProtectionHint: "Enable, then click a color in the original preview",
      protectSample: "Sample protected color",
      protectClear: "Clear",
      protectSampling: "Click a color to protect in the original preview",
      protectedColorAdded: "Added protected color {color}",
      connected: "Only remove edge-connected background",
      original: "Original",
      result: "Transparent result",
      editorCanvas: "Editing canvas",
      viewResult: "Result",
      viewOriginal: "Original",
      viewAlpha: "Alpha",
      viewDifference: "Diff",
      viewResultCaption: "Transparent result · editable",
      viewOriginalCaption: "Original image · read only",
      viewAlphaCaption: "Alpha mask · white is retained",
      viewDifferenceCaption: "Difference · red removed / yellow partial / cyan corrected",
      diagnosticReadOnly: "Diagnostic views are read only; choosing a repair tool returns to Result",
      download: "Export ZIP",
      applyGroup: "Replace Current Group",
      applyWorkset: "Apply to Imported Animation",
      clear: "Clear",
      pickHint: "Choose Add Background Sample, then pick on the editing canvas",
      ready: "Waiting for images",
      processing: "Processing {current}/{total}…",
      selected: "Loaded {count} images",
      processed: "Done: {count} images, {pixels} pixels removed",
      zipping: "Compressing {current}/{total}…",
      downloaded: "ZIP ready: {count} images; {failed} failed",
      applied: "Replaced the current animation group ({count} frames)",
      worksetLoaded: "Loaded imported animation: {name} ({count} frames)",
      worksetApplied: "Applied cutout results to the imported animation ({count} frames)",
      worksetMismatch: "All imported frames must remain included ({included} / {total})",
      failed: "Processing failed: {message}",
      invalidFiles: "No supported image files were found",
      tooMany: "A batch can contain at most 240 images",
      groupUnavailable: "No animation group is currently available",
      groupLoaded: "Loaded current group: {name} ({count} frames)",
      applyMismatch: "Image count must match the current group ({files} images / {frames} frames)",
      applyConfirm: "This overwrites the current animation group's PNG frames. Continue?",
      applyTitle: "Replace current animation group?",
      cancel: "Cancel",
      confirmApply: "Replace Frames",
      framePrefix: "Frame",
      batchTray: "Batch Results",
      showResult: "Result",
      showOriginal: "Original",
      includeAll: "Include All",
      excludeAll: "Exclude All",
      selectAll: "Select All",
      invertSelection: "Invert",
      excludeSelected: "Exclude Selected",
      deleteSelected: "Delete Selected",
      retryFailed: "Retry Failed",
      cancelProcess: "Stop",
      includeFrame: "Include frame",
      excludeFrame: "Exclude frame",
      removeFrame: "Remove frame",
      batchSummary: "Included {included}/{total} · selected {selected} · ready {processed} · failed {failed}",
      qualityOnly: "Issues only",
      nextIssue: "Next issue",
      qualityEmpty: "Empty subject",
      qualityArea: "Area jump",
      qualityPosition: "Position jump",
      qualitySoftEdge: "Soft-edge anomaly",
      qualitySplit: "Split subject",
      qualityHoles: "Subject holes",
      qualityClipped: "Canvas clipping",
      qualityTransparentRgb: "Transparent RGB contamination",
      qualityBackgroundResidue: "Residual background color",
      qualityNone: "No anomalous frames found",
      qualityFilteredEmpty: "No detected anomalous frames",
      partialProcessed: "Done {count}; excluded {excluded}; failed {failed}",
      noIncluded: "No images are included in this batch",
      frameFailed: "Frame {index} failed: {message}",
      cancelled: "Processing stopped; no download was created",
      applyAnimation: "Animation",
      applyFrames: "Frames to replace",
      applyExcluded: "Excluded frames",
      sample: "Background {color}",
      connectedMode: "Connected",
      globalMode: "Global",
      localRepair: "Local rectangle repair",
      repairSmart: "Smart Clear",
      repairBrush: "Brush",
      repairEraser: "Eraser",
      brushSize: "Size",
      brushHardness: "Hardness",
      brushOpacity: "Opacity",
      brushColor: "Color",
      repairClear: "Clear All",
      repairRestore: "Restore Subject",
      repairProtect: "Protect Region",
      repairUndo: "Undo Rectangle",
      repairRedo: "Redo Rectangle",
      repairReset: "Clear Repairs",
      repairUndoShort: "Undo",
      repairRedoShort: "Redo",
      repairResetShort: "Clear",
      repairBatch: "Propagate to All Frames",
      repairHint: "Paint or drag directly on the editing canvas",
      repaired: "Added local repair: {mode}",
      protectedRegion: "Extracted {count} protected colors from the region",
      protectedRegionCoverage: "Extracted {count} protected colors with {coverage}% coverage",
      protectedRegionIncomplete: "Extracted {count} protected colors with only {coverage}% coverage; expand the region or add colors",
      batchRepaired: "Propagated the repair to {count} frames; skipped {skipped}",
      batchRepairUnavailable: "Add a local repair first",
      repairSmartMode: "Smart Clear",
      repairClearMode: "Clear All",
      repairRestoreMode: "Restore Subject",
      repairProtectMode: "Protect Region",
    },
  };

  /**
   * Creates a complete batch-cutout controller.
   * @param {{
   *   getLanguage?:()=>string,
   *   getCurrentAnimation?:()=>object|null,
   *   applyToCurrentAnimation?:(outputs:Array<object>)=>Promise<void>,
   *   onStatus?:(message:string)=>void
   * }} hooks Integration hooks supplied by the host application.
   * @returns {{open:()=>void,openWorkset:(workset:{name?:string,items:Array<{name?:string,image:CanvasImageSource,frame?:object}>})=>Promise<Array<object>|null>,setLanguage:(language:string)=>void}}
   */
  function createController(hooks = {}) {
    const core = root.BatchCutoutCore;
    if (!core) throw new Error("BatchCutoutCore is required.");
    const tracking = root.CutoutTrackingCore;
    if (!tracking) throw new Error("CutoutTrackingCore is required.");
    const quality = root.CutoutQualityCore;
    if (!quality) throw new Error("CutoutQualityCore is required.");
    const batchZip = root.BatchZip;
    if (!batchZip) throw new Error("BatchZip is required.");
    const outputCore = root.BatchCutoutOutputCore;
    if (!outputCore) throw new Error("BatchCutoutOutputCore is required.");
    const workerClient = root.BatchCutoutWorkerClient;
    if (!workerClient) throw new Error("BatchCutoutWorkerClient is required.");
    const cutoutExecutor = workerClient.createExecutor({
      syncProcess: core.applyProductCutout,
    });
    const elements = Object.fromEntries([
      "cutoutOpen", "cutoutModal", "cutoutClose", "cutoutDropzone", "cutoutFileInput",
      "cutoutAddFiles", "cutoutLoadGroup", "cutoutClear", "cutoutAutoColor", "cutoutColor",
      "cutoutTolerance", "cutoutToleranceValue", "cutoutFeather", "cutoutFeatherValue",
      "cutoutChromaCleanup", "cutoutChromaCleanupValue", "cutoutChromaFeather", "cutoutChromaFeatherValue",
      "cutoutAlphaThreshold", "cutoutAlphaValue", "cutoutConnected", "cutoutOriginal",
      "cutoutResult", "cutoutQueue", "cutoutStatus", "cutoutDownload", "cutoutApplyGroup",
      "cutoutCounter", "cutoutSample", "cutoutRepairSmart", "cutoutRepairClear",
      "cutoutRepairBrush", "cutoutRepairEraser", "cutoutBrushSize", "cutoutBrushSizeValue",
      "cutoutBrushHardness", "cutoutBrushHardnessValue", "cutoutBrushOpacity",
      "cutoutBrushOpacityValue", "cutoutBrushColor",
      "cutoutRepairRestore", "cutoutRepairUndo", "cutoutRepairRedo", "cutoutRepairReset",
      "cutoutEdgeBoost", "cutoutEdgeBoostValue", "cutoutDespillStrength",
      "cutoutDespillStrengthValue", "cutoutDespillMode", "cutoutEdgeDespillRadius",
      "cutoutEdgeDespillRadiusValue", "cutoutAlphaLow", "cutoutAlphaLowValue",
      "cutoutAlphaHigh", "cutoutAlphaHighValue", "cutoutProtectionTolerance",
      "cutoutProtectionToleranceValue", "cutoutProtectSample", "cutoutProtectClear",
      "cutoutProtectedColors", "cutoutBackgroundSample", "cutoutBackgroundClear",
      "cutoutBackgroundColors", "cutoutPerceptual", "cutoutEdgeRecoveryStrength",
      "cutoutEdgeRecoveryStrengthValue", "cutoutBackgroundRadius", "cutoutBackgroundRadiusValue",
      "cutoutBlurRadius", "cutoutBlurRadiusValue", "cutoutRepairProtect", "cutoutRepairBatch",
      "cutoutZoomOut", "cutoutZoom", "cutoutZoomValue", "cutoutZoomIn", "cutoutZoomFit",
      "cutoutZoomActual",
      "cutoutPrevious", "cutoutNext", "cutoutFrameNumber", "cutoutFrameSlider",
      "cutoutPreviewPlay", "cutoutBatchSummary", "cutoutShowResult", "cutoutShowOriginal",
      "cutoutBatchTrayToggle", "cutoutViewResult", "cutoutViewOriginal", "cutoutViewAlpha",
      "cutoutViewDifference", "cutoutViewCaption", "cutoutRepairTools", "cutoutQualityOnly",
      "cutoutQualityCount", "cutoutNextIssue",
      "cutoutIncludeAll", "cutoutExcludeAll", "cutoutConfirmPanel", "cutoutConfirmMessage",
      "cutoutConfirmDetails", "cutoutConfirmCancel", "cutoutConfirmApply",
      "cutoutSelectAll", "cutoutInvertSelection", "cutoutExcludeSelected",
      "cutoutDeleteSelected", "cutoutRetryFailed", "cutoutCancelProcess",
    ].map((id) => [id, document.querySelector(`#${id}`)]));
    const state = {
      language: hooks.getLanguage?.() === "en" ? "en" : "zh",
      items: [],
      selectedIndex: 0,
      previewRevision: 0,
      busy: false,
      sourceKind: "",
      repairMode: "smart",
      repairDrag: null,
      keyboardRepairPoint: null,
      samplingProtectedColor: false,
      samplingBackgroundColor: false,
      previewScale: null,
      previewPanX: 0,
      previewPanY: 0,
      previewPanDrag: null,
      previewSpacePan: false,
      returnFocus: null,
      previewMode: "result",
      thumbnailMode: "result",
      thumbnailRevision: 0,
      thumbnailJob: 0,
      playing: false,
      playbackTimer: 0,
      confirmationResolver: null,
      selectedIds: new Set(),
      queueWindowStart: 0,
      queueRenderFrame: 0,
      selectionAnchorIndex: 0,
      draggedItemId: "",
      cancelRequested: false,
      worksetResolver: null,
      worksetName: "",
      batchTrayCollapsed: true,
      qualityOnly: false,
    };
    const advancedSummary = document.querySelector("#cutoutAdvancedSummary");
    const advancedPresetButtons = Array.from(document.querySelectorAll("[data-cutout-preset]"));
    const advancedPresets = {
      conservative: { alphaLow: 0, alphaHigh: 255, alphaThreshold: 0, protectionTolerance: 12 },
      balanced: { alphaLow: 0, alphaHigh: 255, alphaThreshold: 2, protectionTolerance: 8 },
      hard: { alphaLow: 24, alphaHigh: 220, alphaThreshold: 10, protectionTolerance: 4 },
    };
    let previewTimer = 0;
    elements.cutoutRepairTools.dataset.repairMode = state.repairMode;

    /**
     * Keeps keyboard focus inside the cutout workbench.
     * @param {KeyboardEvent} event Keyboard event.
     * @returns {void}
     */
    function trapModalFocus(event) {
      if (event.key !== "Tab") return;
      const layer = !elements.cutoutConfirmPanel.hidden
        ? elements.cutoutConfirmPanel
        : elements.cutoutModal;
      const focusable = Array.from(layer.querySelectorAll(
        'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    /**
     * Toggles background editor interaction while the modal is open.
     * @param {boolean} inert Whether the editor should be inert.
     * @returns {void}
     */
    function setEditorInert(inert) {
      const app = document.querySelector(".app");
      if (app) app.inert = Boolean(inert);
    }

    /**
     * Translates a UI key.
     * @param {string} key Translation key.
     * @param {Record<string,string|number>} variables Interpolation values.
     * @returns {string}
     */
    function text(key, variables = {}) {
      const template = TEXT[state.language]?.[key] || TEXT.zh[key] || key;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) => variables[name] ?? "");
    }

    /**
     * Updates modal labels for the selected language.
     * @returns {void}
     */
    function renderLanguage() {
      document.querySelectorAll("[data-cutout-i18n]").forEach((node) => {
        node.textContent = text(node.dataset.cutoutI18n);
      });
      document.querySelectorAll("[data-cutout-i18n-title]").forEach((node) => {
        node.title = text(node.dataset.cutoutI18nTitle);
      });
      elements.cutoutOpen.title = text("open");
      elements.cutoutClose.setAttribute("aria-label", text("close"));
      elements.cutoutPrevious.setAttribute("aria-label", text("framePrefix") + " −1");
      elements.cutoutNext.setAttribute("aria-label", text("framePrefix") + " +1");
      elements.cutoutAddFiles.textContent = state.items.length ? text("appendFiles") : text("addFiles");
      elements.cutoutApplyGroup.textContent = state.sourceKind === "workset" && state.worksetResolver
        ? text("applyWorkset")
        : text("applyGroup");
      renderQueue();
      renderPreviewMode();
      renderStatus();
    }

    /**
     * Resolves and closes the in-app destructive-action confirmation.
     * @param {boolean} accepted Whether the user accepted the action.
     * @returns {void}
     */
    function resolveConfirmation(accepted) {
      if (elements.cutoutConfirmPanel.hidden) return;
      elements.cutoutConfirmPanel.hidden = true;
      const resolve = state.confirmationResolver;
      state.confirmationResolver = null;
      resolve?.(Boolean(accepted));
    }

    /**
     * Opens an application-styled confirmation dialog.
     * @param {string} message Confirmation message.
     * @param {Array<[string,string|number]>} details Summary rows.
     * @returns {Promise<boolean>}
     */
    function requestConfirmation(message, details = []) {
      if (state.confirmationResolver) resolveConfirmation(false);
      elements.cutoutConfirmMessage.textContent = message;
      elements.cutoutConfirmDetails.innerHTML = "";
      for (const [label, value] of details) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = String(value);
        elements.cutoutConfirmDetails.append(term, description);
      }
      elements.cutoutConfirmPanel.hidden = false;
      window.setTimeout(() => elements.cutoutConfirmApply.focus(), 0);
      return new Promise((resolve) => { state.confirmationResolver = resolve; });
    }

    /**
     * Updates the advanced-mode summary and highlights an exact preset match.
     * @returns {void}
     */
    function renderAdvancedMode() {
      const values = {
        alphaLow: Number(elements.cutoutAlphaLow.value),
        alphaHigh: Number(elements.cutoutAlphaHigh.value),
        alphaThreshold: Number(elements.cutoutAlphaThreshold.value),
        protectionTolerance: Number(elements.cutoutProtectionTolerance.value),
      };
      advancedSummary.textContent = `${values.alphaLow} — ${values.alphaHigh} / T ${values.alphaThreshold}`;
      advancedPresetButtons.forEach((button) => {
        const preset = advancedPresets[button.dataset.cutoutPreset];
        const matches = preset && Object.entries(preset).every(([key, value]) => values[key] === value);
        button.classList.toggle("active", Boolean(matches));
      });
    }

    /**
     * Applies a named advanced Alpha preset through existing processing controls.
     * @param {"conservative"|"balanced"|"hard"} presetName Preset identifier.
     * @returns {void}
     */
    function applyAdvancedPreset(presetName) {
      const preset = advancedPresets[presetName];
      if (!preset) return;
      const controls = [
        [elements.cutoutAlphaLow, elements.cutoutAlphaLowValue, preset.alphaLow],
        [elements.cutoutAlphaHigh, elements.cutoutAlphaHighValue, preset.alphaHigh],
        [elements.cutoutAlphaThreshold, elements.cutoutAlphaValue, preset.alphaThreshold],
        [
          elements.cutoutProtectionTolerance,
          elements.cutoutProtectionToleranceValue,
          preset.protectionTolerance,
        ],
      ];
      controls.forEach(([input, output, value]) => {
        input.value = String(value);
        output.textContent = String(value);
      });
      renderAdvancedMode();
      schedulePreview();
    }

    /**
     * Publishes a user-visible status message.
     * @param {string} message Message to display.
     * @param {"idle"|"busy"|"success"|"error"} tone Visual tone.
     * @returns {void}
     */
    function setStatus(message, tone = "idle") {
      elements.cutoutStatus.textContent = message;
      elements.cutoutStatus.dataset.tone = tone;
      hooks.onStatus?.(message);
    }

    /**
     * Updates the status and control state without replacing an active message.
     * @returns {void}
     */
    function renderStatus() {
      const item = selectedItem();
      const total = state.items.length;
      const included = state.items.filter((candidate) => !candidate.excluded).length;
      const processed = state.items.filter((candidate) => candidate.status === "processed").length;
      const failed = state.items.filter((candidate) => candidate.status === "failed").length;
      const selected = state.items.filter((candidate) => state.selectedIds.has(candidate.id)).length;
      const issueCount = state.items.filter(hasQualityIssue).length;
      elements.cutoutCounter.textContent = `/ ${total}`;
      elements.cutoutFrameNumber.value = total ? String(state.selectedIndex + 1) : "1";
      elements.cutoutFrameNumber.max = String(Math.max(1, total));
      elements.cutoutFrameNumber.disabled = total < 2 || state.busy;
      elements.cutoutFrameSlider.max = String(Math.max(1, total));
      elements.cutoutFrameSlider.value = total ? String(state.selectedIndex + 1) : "1";
      elements.cutoutFrameSlider.disabled = total < 2 || state.busy;
      elements.cutoutPrevious.disabled = total < 2 || state.busy;
      elements.cutoutNext.disabled = total < 2 || state.busy;
      elements.cutoutPreviewPlay.disabled = total < 2 || state.busy;
      elements.cutoutPreviewPlay.classList.toggle("playing", state.playing);
      elements.cutoutPreviewPlay.textContent = state.playing ? "■" : "▶";
      elements.cutoutPreviewPlay.setAttribute("aria-pressed", String(state.playing));
      elements.cutoutBatchSummary.textContent = text("batchSummary", {
        included, total, selected, processed, failed,
      });
      elements.cutoutQualityCount.textContent = String(issueCount);
      elements.cutoutQualityOnly.classList.toggle("active", state.qualityOnly);
      elements.cutoutQualityOnly.setAttribute("aria-pressed", String(state.qualityOnly));
      elements.cutoutQualityOnly.disabled = !total || state.busy;
      elements.cutoutNextIssue.disabled = !issueCount || state.busy;
      const worksetSession = state.sourceKind === "workset" && typeof state.worksetResolver === "function";
      elements.cutoutModal.classList.toggle("hasItems", state.items.length > 0);
      elements.cutoutModal.classList.toggle("batchTrayCollapsed", state.batchTrayCollapsed);
      elements.cutoutBatchTrayToggle.textContent = state.batchTrayCollapsed ? "▾" : "▴";
      elements.cutoutBatchTrayToggle.setAttribute("aria-expanded", String(!state.batchTrayCollapsed));
      elements.cutoutAddFiles.disabled = worksetSession || state.busy || total >= 240;
      elements.cutoutDownload.disabled = !included || state.busy;
      const animation = hooks.getCurrentAnimation?.();
      elements.cutoutApplyGroup.disabled = !included
        || (!worksetSession && !animation?.frames?.length)
        || state.busy;
      elements.cutoutApplyGroup.textContent = worksetSession ? text("applyWorkset") : text("applyGroup");
      elements.cutoutClear.disabled = worksetSession || !state.items.length || state.busy;
      elements.cutoutLoadGroup.disabled = worksetSession || !animation?.frames?.length || state.busy;
      elements.cutoutRepairUndo.disabled = !item?.repairs?.length || state.busy;
      elements.cutoutRepairRedo.disabled = !item?.undoneRepairs?.length || state.busy;
      elements.cutoutRepairReset.disabled = !item?.repairs?.length || state.busy;
      elements.cutoutRepairBatch.disabled = state.items.length < 2 || !item?.repairs?.length || state.busy;
      elements.cutoutIncludeAll.disabled = !state.items.length || included === total || state.busy;
      elements.cutoutExcludeAll.disabled = !state.items.length || included === 0 || state.busy;
      elements.cutoutSelectAll.disabled = !total || selected === total || state.busy;
      elements.cutoutInvertSelection.disabled = !total || state.busy;
      elements.cutoutExcludeSelected.disabled = !selected || state.busy;
      elements.cutoutDeleteSelected.disabled = !selected || state.busy;
      elements.cutoutRetryFailed.disabled = !failed || state.busy;
      elements.cutoutCancelProcess.hidden = !state.busy;
      elements.cutoutCancelProcess.disabled = !state.busy || state.cancelRequested;
      [
        elements.cutoutZoomOut,
        elements.cutoutZoom,
        elements.cutoutZoomIn,
        elements.cutoutZoomFit,
        elements.cutoutZoomActual,
        elements.cutoutViewResult,
        elements.cutoutViewOriginal,
        elements.cutoutViewAlpha,
        elements.cutoutViewDifference,
      ].forEach((control) => { control.disabled = !item || state.busy; });
      elements.cutoutSample.textContent = state.items.length
        ? text("sample", { color: selectedBackgroundColor().hex })
        : text("ready");
      elements.cutoutAddFiles.textContent = state.items.length ? text("appendFiles") : text("addFiles");
    }

    /**
     * Converts an image source into source pixels.
     * @param {CanvasImageSource} image Browser image source.
     * @returns {{canvas:HTMLCanvasElement,context:CanvasRenderingContext2D,imageData:ImageData}}
     */
    function imagePixels(image) {
      const width = Number(image.naturalWidth || image.width || 0);
      const height = Number(image.naturalHeight || image.height || 0);
      if (!width || !height) throw new Error("Image has no readable pixels.");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      return { canvas, context, imageData: context.getImageData(0, 0, width, height) };
    }

    /**
     * Loads an image file into a browser image element.
     * @param {File} file Local image file.
     * @returns {Promise<HTMLImageElement>}
     */
    function loadFileImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`Cannot read ${file.name}`));
        };
        image.src = url;
      });
    }

    /**
     * Creates a bounded thumbnail URL without retaining a full-resolution data URL.
     * @param {CanvasImageSource} source Source image or canvas.
     * @returns {string}
     */
    function createThumbnailUrl(source) {
      const sourceWidth = Number(source.naturalWidth || source.width || 1);
      const sourceHeight = Number(source.naturalHeight || source.height || 1);
      const scale = Math.min(1, 180 / sourceWidth, 100 / sourceHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    }

    /**
     * Builds a processable queue item.
     * @param {CanvasImageSource} image Source image.
     * @param {string} name Display and export name.
     * @param {object|null} frame Optional current-animation frame.
     * @returns {object}
     */
    function createItem(image, name, frame = null) {
      const pixels = imagePixels(image);
      const background = core.estimateBackgroundColor(
        pixels.imageData.data,
        pixels.imageData.width,
        pixels.imageData.height,
      );
      return {
        id: root.crypto?.randomUUID?.() || `cutout_${Date.now()}_${Math.random()}`,
        name,
        frame,
        image,
        sourceCanvas: pixels.canvas,
        sourceImageData: pixels.imageData,
        background,
        resultCanvas: null,
        statistics: null,
        repairs: [],
        undoneRepairs: [],
        protectedColors: [],
        backgroundSamples: [],
        seedPoints: [],
        automaticImageData: null,
        resultImageData: null,
        shapeDescriptor: null,
        shapeCandidates: [],
        qualityMetrics: null,
        quality: null,
        diagnosticCanvases: {},
        excluded: false,
        status: "ready",
        error: "",
        sourceThumbnail: createThumbnailUrl(pixels.canvas),
        resultThumbnail: "",
        thumbnailRevision: -1,
        processingRevision: 0,
        processingPromise: null,
      };
    }

    /**
     * Returns the selected queue item.
     * @returns {object|null}
     */
    function selectedItem() {
      return state.items[state.selectedIndex] || null;
    }

    /**
     * Returns the selected background color according to auto/manual mode.
     * @param {object|null} item Queue item.
     * @returns {{r:number,g:number,b:number,hex:string}}
     */
    function selectedBackgroundColor(item = selectedItem()) {
      if (item?.backgroundSamples?.length) {
        const color = item.backgroundSamples[0];
        return { ...color, hex: core.rgbToHex(color) };
      }
      if (elements.cutoutAutoColor.checked && item?.background) return item.background;
      const color = core.hexToRgb(elements.cutoutColor.value);
      return { ...color, hex: core.rgbToHex(color) };
    }

    /**
     * Returns all active background samples for an item.
     * @param {object} item Queue item.
     * @returns {Array<{r:number,g:number,b:number}>}
     */
    function selectedBackgroundColors(item) {
      if (item?.backgroundSamples?.length) return item.backgroundSamples;
      return [selectedBackgroundColor(item)];
    }

    /**
     * Returns normalized processing options for a queue item.
     * @param {object} item Queue item.
     * @returns {object}
     */
    function processingOptions(item) {
      return {
        backgroundColor: selectedBackgroundColor(item),
        backgroundColors: selectedBackgroundColors(item),
        tolerance: Number(elements.cutoutTolerance.value),
        feather: Number(elements.cutoutFeather.value),
        alphaThreshold: Number(elements.cutoutAlphaThreshold.value),
        connected: elements.cutoutConnected.checked,
        perceptual: elements.cutoutPerceptual.checked,
        referenceChromaKey: elements.cutoutPerceptual.checked,
        chromaCleanup: Number(elements.cutoutChromaCleanup.value),
        chromaFeather: Number(elements.cutoutChromaFeather.value),
        seedPoints: item.seedPoints || [],
        edgeBoost: Number(elements.cutoutEdgeBoost.value),
        alphaLow: Math.min(Number(elements.cutoutAlphaLow.value), Number(elements.cutoutAlphaHigh.value)),
        alphaHigh: Math.max(Number(elements.cutoutAlphaLow.value), Number(elements.cutoutAlphaHigh.value)),
        despillStrength: Number(elements.cutoutDespillStrength.value),
        despillMode: elements.cutoutDespillMode.value,
        edgeDespillRadius: Number(elements.cutoutEdgeDespillRadius.value),
        edgeRecoveryStrength: Number(elements.cutoutEdgeRecoveryStrength.value),
        edgeRecoveryTolerance: 30,
        backgroundRadius: Number(elements.cutoutBackgroundRadius.value),
        blurRadius: Number(elements.cutoutBlurRadius.value),
        protectedColors: item.protectedColors || [],
        protectionTolerance: Number(elements.cutoutProtectionTolerance.value),
      };
    }

    /**
     * Re-evaluates frame-to-frame quality after one result changes.
     * @returns {void}
     */
    function refreshQualityAnalysis() {
      const currentAnimation = hooks.getCurrentAnimation?.();
      const analysis = quality.analyzeCutoutQualitySequence(
        state.items.map((item) => item.qualityMetrics),
        { circular: currentAnimation?.loop === true },
      );
      state.items.forEach((item, index) => {
        item.quality = analysis[index];
      });
      if (state.qualityOnly) {
        renderQueue();
        return;
      }
      state.items.forEach(updateQueueCard);
    }

    /**
     * Returns whether an item currently has a detected quality issue.
     * @param {object} item Queue item.
     * @returns {boolean}
     */
    function hasQualityIssue(item) {
      return Boolean(item?.quality?.codes?.length);
    }

    /**
     * Formats detected issue codes for card titles and announcements.
     * @param {object|null} quality Quality analysis result.
     * @returns {string}
     */
    function qualityLabel(quality) {
      const labels = {
        empty: text("qualityEmpty"),
        area: text("qualityArea"),
        position: text("qualityPosition"),
        "soft-edge": text("qualitySoftEdge"),
        split: text("qualitySplit"),
        holes: text("qualityHoles"),
        clipped: text("qualityClipped"),
        "transparent-rgb": text("qualityTransparentRgb"),
        "background-residue": text("qualityBackgroundResidue"),
      };
      return (quality?.codes || []).map((code) => labels[code] || code).join(" · ");
    }

    /**
     * Processes one image and stores its result canvas.
     * @param {object} item Queue item.
     * @returns {Promise<object>}
     */
    async function processItem(item) {
      if (
        item.status === "processed"
        && item.thumbnailRevision === state.thumbnailRevision
        && item.resultCanvas
      ) return item;
      if (item.processingPromise) return item.processingPromise;
      item.status = "processing";
      item.error = "";
      const processingRevision = Number(item.processingRevision || 0);
      const processingPromise = (async () => {
        const { width, height, data } = item.sourceImageData;
        const options = processingOptions(item);
        const result = await cutoutExecutor.process(
          data,
          width,
          height,
          options,
          item.repairs || [],
        );
        if (processingRevision !== Number(item.processingRevision || 0)) {
          throw new DOMException("Stale cutout result was discarded.", "AbortError");
        }
        item.automaticImageData = new ImageData(result.automaticData, width, height);
        item.shapeCandidates = result.shapeCandidates
          || tracking.createShapeCandidates(result.automaticData, width, height);
        item.shapeDescriptor = result.shapeDescriptor
          || item.shapeCandidates[0]
          || tracking.createShapeDescriptor(result.automaticData, width, height);
        item.resultImageData = new ImageData(new Uint8ClampedArray(result.data), width, height);
        item.qualityMetrics = result.qualityMetrics
          || quality.createCutoutQualityMetrics(result.data, width, height, {
            backgroundColors: options.backgroundColors,
            backgroundTolerance: options.tolerance + options.feather,
          });
        item.diagnosticCanvases = {};
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.putImageData(new ImageData(result.data, width, height), 0, 0);
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
        const ownsItemState = (
          item.processingPromise === processingPromise
          && processingRevision === Number(item.processingRevision || 0)
        );
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
     * Draws a source through the shared zoom and pan viewport.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @param {CanvasImageSource|null} source Source canvas or image.
     * @returns {void}
     */
    function drawPreviewCanvas(target, source) {
      const context = target.getContext("2d");
      const rect = target.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width || 480));
      const height = Math.max(240, Math.round(rect.height || 360));
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
      context.clearRect(0, 0, width, height);
      target._cutoutView = null;
      if (!source) return;
      const sourceWidth = Number(source.naturalWidth || source.width || 1);
      const sourceHeight = Number(source.naturalHeight || source.height || 1);
      const fitScale = Math.min(width / sourceWidth, height / sourceHeight);
      const scale = state.previewScale ?? fitScale;
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      const offsetX = (width - drawWidth) / 2 + state.previewPanX;
      const offsetY = (height - drawHeight) / 2 + state.previewPanY;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
      target._cutoutView = {
        sourceWidth,
        sourceHeight,
        fitScale,
        scale,
        offsetX,
        offsetY,
      };
    }

    /**
     * Updates zoom controls from the current preview transform.
     * @returns {void}
     */
    function renderPreviewZoom() {
      const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
      const scale = view?.scale || 1;
      const percent = Math.round(scale * 100);
      elements.cutoutZoom.value = String(Math.max(10, Math.min(500, percent)));
      elements.cutoutZoomValue.textContent = state.previewScale === null ? `FIT · ${percent}%` : `${percent}%`;
      elements.cutoutZoomFit.classList.toggle("active", state.previewScale === null);
      elements.cutoutZoomActual.classList.toggle(
        "active",
        state.previewScale !== null && Math.abs(state.previewScale - 1) < 0.001,
      );
    }

    /**
     * Sets an absolute preview scale while preserving an optional cursor anchor.
     * @param {number|null} scale Absolute source-pixel scale, or null for fit.
     * @param {HTMLCanvasElement|null} target Anchor canvas.
     * @param {{x:number,y:number}|null} canvasPoint Anchor point in canvas pixels.
     * @returns {void}
     */
    function setPreviewScale(scale, target = null, canvasPoint = null) {
      const view = target?._cutoutView;
      if (scale === null) {
        state.previewScale = null;
        state.previewPanX = 0;
        state.previewPanY = 0;
        renderPreview();
        return;
      }
      const nextScale = Math.max(0.1, Math.min(5, Number(scale || 1)));
      if (view && canvasPoint) {
        const sourceX = (canvasPoint.x - view.offsetX) / view.scale;
        const sourceY = (canvasPoint.y - view.offsetY) / view.scale;
        const centeredX = (target.width - view.sourceWidth * nextScale) / 2;
        const centeredY = (target.height - view.sourceHeight * nextScale) / 2;
        state.previewPanX = canvasPoint.x - sourceX * nextScale - centeredX;
        state.previewPanY = canvasPoint.y - sourceY * nextScale - centeredY;
      }
      state.previewScale = nextScale;
      renderPreview();
    }

    /**
     * Converts a pointer event to canvas coordinates.
     * @param {PointerEvent|WheelEvent} event Pointer-like event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {{x:number,y:number}}
     */
    function previewCanvasPoint(event, target) {
      const rect = target.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * target.width,
        y: ((event.clientY - rect.top) / rect.height) * target.height,
      };
    }

    /**
     * Converts preview coordinates to source-image coordinates.
     * @param {PointerEvent|WheelEvent} event Pointer-like event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}
     */
    function previewSourcePoint(event, target) {
      const view = target._cutoutView;
      if (!view) return null;
      const point = previewCanvasPoint(event, target);
      const sourceX = (point.x - view.offsetX) / view.scale;
      const sourceY = (point.y - view.offsetY) / view.scale;
      if (
        sourceX < 0 || sourceY < 0
        || sourceX > view.sourceWidth || sourceY > view.sourceHeight
      ) {
        return null;
      }
      return {
        canvasX: point.x,
        canvasY: point.y,
        sourceX,
        sourceY,
      };
    }

    /**
     * Draws the active repair rectangle over the result preview.
     * @returns {void}
     */
    function drawRepairOverlay() {
      if (state.previewMode !== "result" || !state.repairDrag) return;
      if (state.repairMode === "brush" || state.repairMode === "eraser") return;
      const context = elements.cutoutResult.getContext("2d");
      const { startX, startY, currentX, currentY } = state.repairDrag;
      context.save();
      context.fillStyle = "rgba(255, 212, 61, .18)";
      context.strokeStyle = "#ffd43d";
      context.lineWidth = 3;
      context.setLineDash([8, 5]);
      context.fillRect(startX, startY, currentX - startX, currentY - startY);
      context.strokeRect(startX, startY, currentX - startX, currentY - startY);
      context.restore();
    }

    /**
     * Builds a cached alpha-mask or difference diagnostic canvas.
     * @param {object} item Selected queue item.
     * @param {"alpha"|"difference"} mode Diagnostic mode.
     * @returns {HTMLCanvasElement|null}
     */
    function createDiagnosticCanvas(item, mode) {
      if (!item?.resultImageData || !item?.sourceImageData) return null;
      if (item.diagnosticCanvases?.[mode]) return item.diagnosticCanvases[mode];
      const { width, height, data: resultData } = item.resultImageData;
      const sourceData = item.sourceImageData.data;
      const output = new Uint8ClampedArray(width * height * 4);
      for (let offset = 0; offset < output.length; offset += 4) {
        const alpha = resultData[offset + 3];
        if (mode === "alpha") {
          output[offset] = alpha;
          output[offset + 1] = alpha;
          output[offset + 2] = alpha;
          output[offset + 3] = 255;
          continue;
        }
        const colorDelta = Math.max(
          Math.abs(sourceData[offset] - resultData[offset]),
          Math.abs(sourceData[offset + 1] - resultData[offset + 1]),
          Math.abs(sourceData[offset + 2] - resultData[offset + 2]),
        );
        if (alpha === 0 && sourceData[offset + 3] > 0) {
          output[offset] = 255;
          output[offset + 1] = 66;
          output[offset + 2] = 45;
        } else if (alpha < 250) {
          output[offset] = 255;
          output[offset + 1] = 208;
          output[offset + 2] = 58;
        } else if (colorDelta > 18) {
          output[offset] = 43;
          output[offset + 1] = 220;
          output[offset + 2] = 196;
        } else {
          const luminance = Math.round(
            sourceData[offset] * 0.2126
            + sourceData[offset + 1] * 0.7152
            + sourceData[offset + 2] * 0.0722,
          );
          const muted = Math.round(luminance * 0.34 + 20);
          output[offset] = muted;
          output[offset + 1] = muted;
          output[offset + 2] = muted;
        }
        output[offset + 3] = 255;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").putImageData(new ImageData(output, width, height), 0, 0);
      item.diagnosticCanvases ||= {};
      item.diagnosticCanvases[mode] = canvas;
      return canvas;
    }

    /**
     * Updates preview-mode buttons, caption, and editor affordances.
     * @returns {void}
     */
    function renderPreviewMode() {
      const modeButtons = [
        [elements.cutoutViewResult, "result"],
        [elements.cutoutViewOriginal, "original"],
        [elements.cutoutViewAlpha, "alpha"],
        [elements.cutoutViewDifference, "difference"],
      ];
      modeButtons.forEach(([button, mode]) => {
        const active = state.previewMode === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const captionKeys = {
        result: "viewResultCaption",
        original: "viewOriginalCaption",
        alpha: "viewAlphaCaption",
        difference: "viewDifferenceCaption",
      };
      elements.cutoutViewCaption.textContent = text(captionKeys[state.previewMode]);
      elements.cutoutRepairTools.dataset.previewMode = state.previewMode;
      elements.cutoutResult.classList.toggle("diagnostic", state.previewMode !== "result");
    }

    /**
     * Selects the main preview representation.
     * @param {"result"|"original"|"alpha"|"difference"} mode Preview mode.
     * @returns {void}
     */
    function setPreviewMode(mode) {
      state.previewMode = mode;
      state.repairDrag = null;
      renderPreview();
    }

    /**
     * Processes and redraws the selected preview.
     * @returns {void}
     */
    async function renderPreview() {
      const item = selectedItem();
      drawPreviewCanvas(elements.cutoutOriginal, item?.sourceCanvas || null);
      if (!item) {
        drawPreviewCanvas(elements.cutoutResult, null);
        renderPreviewMode();
        renderPreviewZoom();
        renderBackgroundSamples();
        renderProtectedColors();
        renderStatus();
        return;
      }
      try {
        await processItem(item);
        if (item !== selectedItem()) return;
        const previewSource = state.previewMode === "original"
          ? item.sourceCanvas
          : state.previewMode === "alpha" || state.previewMode === "difference"
            ? createDiagnosticCanvas(item, state.previewMode)
            : item.resultCanvas;
        drawPreviewCanvas(elements.cutoutResult, previewSource);
      } catch (error) {
        if (error?.name === "AbortError") return;
        drawPreviewCanvas(elements.cutoutResult, null);
        setStatus(text("frameFailed", {
          index: state.selectedIndex + 1,
          message: error.message,
        }), "error");
      }
      updateQueueCard(item);
      renderPreviewMode();
      drawRepairOverlay();
      renderPreviewZoom();
      elements.cutoutColor.value = selectedBackgroundColor(item).hex;
      renderBackgroundSamples();
      renderProtectedColors();
      renderStatus();
    }

    /**
     * Renders protected-color swatches for the selected image.
     * @returns {void}
     */
    function renderProtectedColors() {
      const item = selectedItem();
      elements.cutoutProtectedColors.innerHTML = "";
      for (const [index, color] of (item?.protectedColors || []).entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.title = core.rgbToHex(color);
        button.setAttribute("aria-label", `${text("protectedPalette")} ${core.rgbToHex(color)}`);
        button.style.setProperty("--protected-color", core.rgbToHex(color));
        button.addEventListener("click", () => {
          item.protectedColors.splice(index, 1);
          invalidateItem(item);
          renderPreview();
        });
        elements.cutoutProtectedColors.appendChild(button);
      }
      elements.cutoutProtectClear.disabled = !(item?.protectedColors?.length);
      elements.cutoutProtectSample.classList.toggle("active", state.samplingProtectedColor);
    }

    /**
     * Renders manual background samples for the selected image.
     * @returns {void}
     */
    function renderBackgroundSamples() {
      const item = selectedItem();
      elements.cutoutBackgroundColors.innerHTML = "";
      for (const [index, color] of (item?.backgroundSamples || []).entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.title = core.rgbToHex(color);
        button.setAttribute("aria-label", `${text("backgroundColor")} ${core.rgbToHex(color)}`);
        button.style.setProperty("--protected-color", core.rgbToHex(color));
        button.addEventListener("click", () => {
          item.backgroundSamples.splice(index, 1);
          item.seedPoints.splice(index, 1);
          invalidateItem(item);
          renderPreview();
        });
        elements.cutoutBackgroundColors.appendChild(button);
      }
      elements.cutoutBackgroundClear.disabled = !(item?.backgroundSamples?.length);
      elements.cutoutBackgroundSample.classList.toggle("active", state.samplingBackgroundColor);
    }

    /**
     * Schedules preview work after rapid slider changes settle.
     * @returns {void}
     */
    function schedulePreview() {
      cutoutExecutor.cancelAll();
      state.previewRevision += 1;
      state.thumbnailRevision += 1;
      state.thumbnailJob += 1;
      for (const item of state.items) {
        item.processingRevision = Number(item.processingRevision || 0) + 1;
        item.processingPromise = null;
        item.status = "ready";
        item.error = "";
        item.resultCanvas = null;
        item.resultImageData = null;
        item.resultThumbnail = "";
        item.thumbnailRevision = -1;
        item.qualityMetrics = null;
        item.quality = null;
        item.diagnosticCanvases = {};
      }
      const revision = state.previewRevision;
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        if (revision === state.previewRevision) {
          renderQueue();
          renderPreview();
          scheduleBatchThumbnails();
        }
      }, 40);
    }

    /**
     * Invalidates one frame after per-image sampling or repair changes.
     * @param {object|null} item Queue item.
     * @returns {void}
     */
    function invalidateItem(item) {
      if (!item) return;
      item.processingRevision = Number(item.processingRevision || 0) + 1;
      item.processingPromise = null;
      item.status = "ready";
      item.error = "";
      item.resultCanvas = null;
      item.resultImageData = null;
      item.resultThumbnail = "";
      item.thumbnailRevision = -1;
      item.qualityMetrics = null;
      item.quality = null;
      item.diagnosticCanvases = {};
      refreshQualityAnalysis();
    }

    /**
     * Updates batch selection using desktop range/toggle conventions.
     * @param {number} index Clicked item index.
     * @param {MouseEvent|KeyboardEvent} event Selection event.
     * @returns {void}
     */
    function updateBatchSelection(index, event) {
      const item = state.items[index];
      if (!item) return;
      if (event.shiftKey) {
        const start = Math.min(state.selectionAnchorIndex, index);
        const end = Math.max(state.selectionAnchorIndex, index);
        if (!event.metaKey && !event.ctrlKey) state.selectedIds.clear();
        for (let cursor = start; cursor <= end; cursor += 1) {
          state.selectedIds.add(state.items[cursor].id);
        }
      } else if (event.metaKey || event.ctrlKey) {
        if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
        else state.selectedIds.add(item.id);
        state.selectionAnchorIndex = index;
      } else {
        state.selectedIds.clear();
        state.selectedIds.add(item.id);
        state.selectionAnchorIndex = index;
      }
    }

    /**
     * Moves one batch item before or after another item.
     * @param {string} sourceId Dragged item identifier.
     * @param {number} targetIndex Target item index.
     * @param {boolean} after Whether to insert after the target.
     * @returns {void}
     */
    function reorderBatchItem(sourceId, targetIndex, after) {
      const sourceIndex = state.items.findIndex((item) => item.id === sourceId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const currentItemId = selectedItem()?.id;
      const [moved] = state.items.splice(sourceIndex, 1);
      let insertionIndex = targetIndex + (after ? 1 : 0);
      if (sourceIndex < insertionIndex) insertionIndex -= 1;
      state.items.splice(Math.max(0, Math.min(state.items.length, insertionIndex)), 0, moved);
      state.selectedIndex = Math.max(0, state.items.findIndex((item) => item.id === currentItemId));
      state.selectionAnchorIndex = state.selectedIndex;
      renderQueue();
      renderPreview();
    }

    /**
     * Selects a batch frame and keeps its card visible.
     * @param {number} index Requested zero-based frame index.
     * @param {{wrap?:boolean,stopPlayback?:boolean}} options Navigation options.
     * @returns {void}
     */
    function selectBatchIndex(index, options = {}) {
      if (!state.items.length) return;
      const total = state.items.length;
      const nextIndex = options.wrap
        ? (Number(index) + total) % total
        : Math.max(0, Math.min(total - 1, Number(index) || 0));
      if (options.stopPlayback !== false) stopBatchPlayback();
      state.selectedIndex = nextIndex;
      state.samplingProtectedColor = false;
      state.samplingBackgroundColor = false;
      const visibleIndex = state.qualityOnly
        ? state.items
          .slice(0, nextIndex)
          .filter(hasQualityIssue)
          .length
        : nextIndex;
      elements.cutoutQueue.scrollLeft = Math.max(0, visibleIndex * 140 - elements.cutoutQueue.clientWidth / 2);
      renderQueue();
      renderPreview();
      elements.cutoutQueue.querySelector(`[data-index="${nextIndex}"]`)?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
    }

    /**
     * Selects the next detected anomalous frame, wrapping at the batch end.
     * @returns {void}
     */
    function selectNextQualityIssue() {
      const issueIndices = state.items
        .map((item, index) => (hasQualityIssue(item) ? index : -1))
        .filter((index) => index >= 0);
      if (!issueIndices.length) {
        setStatus(text("qualityNone"), "success");
        return;
      }
      const nextIndex = issueIndices.find((index) => index > state.selectedIndex) ?? issueIndices[0];
      selectBatchIndex(nextIndex);
    }

    /**
     * Stops automatic batch preview playback.
     * @returns {void}
     */
    function stopBatchPlayback() {
      window.clearInterval(state.playbackTimer);
      state.playbackTimer = 0;
      state.playing = false;
      renderStatus();
    }

    /**
     * Toggles a lightweight sequential result preview.
     * @returns {void}
     */
    function toggleBatchPlayback() {
      if (state.playing) {
        stopBatchPlayback();
        return;
      }
      if (state.items.length < 2) return;
      state.playing = true;
      state.playbackTimer = window.setInterval(() => {
        selectBatchIndex(state.selectedIndex + 1, { wrap: true, stopPlayback: false });
      }, 320);
      renderStatus();
    }

    /**
     * Refreshes result thumbnails in small asynchronous slices.
     * Failures are isolated to their own frame.
     * @returns {void}
     */
    function scheduleBatchThumbnails() {
      const job = ++state.thumbnailJob;
      const candidates = state.items.filter((item, index) => (
        !item.excluded
        && index !== state.selectedIndex
        && item.thumbnailRevision !== state.thumbnailRevision
      ));
      const processNext = async () => {
        if (job !== state.thumbnailJob || elements.cutoutModal.hidden || !candidates.length) return;
        const item = candidates.shift();
        try {
          await processItem(item);
        } catch (error) {
          if (error?.name === "AbortError") return;
          // Per-frame status is rendered below; one bad image must not stop the batch.
        }
        if (job !== state.thumbnailJob) return;
        updateQueueCard(item);
        if (item !== selectedItem()) {
          item.resultCanvas = null;
          item.automaticImageData = null;
          item.resultImageData = null;
          item.diagnosticCanvases = {};
          item.shapeDescriptor = null;
          item.shapeCandidates = [];
        }
        renderStatus();
        window.setTimeout(processNext, 0);
      };
      window.setTimeout(processNext, 0);
    }

    /**
     * Updates one queue card after background processing.
     * @param {object} item Queue item.
     * @returns {void}
     */
    function updateQueueCard(item) {
      const card = elements.cutoutQueue.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
      if (!card) return;
      card.dataset.status = item.status;
      card.dataset.quality = item.quality?.severity || "pending";
      card.classList.toggle("excluded", item.excluded);
      card.classList.toggle("qualityIssue", hasQualityIssue(item));
      card.classList.toggle("qualityCritical", item.quality?.severity === "critical");
      const issueLabel = qualityLabel(item.quality);
      card.title = item.error || (issueLabel ? `${item.name} · ${issueLabel}` : item.name);
      card.setAttribute("aria-label", card.title);
      const image = card.querySelector("img");
      image.src = state.thumbnailMode === "result" && item.resultThumbnail
        ? item.resultThumbnail
        : item.sourceThumbnail;
      const toggle = card.querySelector(".cutoutQueueToggle");
      toggle.textContent = item.excluded ? "○" : "✓";
      toggle.setAttribute("aria-label", text(item.excluded ? "includeFrame" : "excludeFrame"));
      const alert = card.querySelector(".cutoutQueueAlert");
      if (alert) {
        alert.textContent = item.quality?.severity === "critical" ? "!!" : "!";
        alert.setAttribute("aria-label", issueLabel);
      }
    }

    /**
     * Renders the selectable batch queue.
     * @returns {void}
     */
    function renderQueue() {
      const previousScroll = elements.cutoutQueue.scrollLeft;
      elements.cutoutQueue.innerHTML = "";
      const filteredItems = state.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !state.qualityOnly || hasQualityIssue(item));
      const itemStride = 140;
      const visibleCount = Math.max(
        20,
        Math.ceil((elements.cutoutQueue.clientWidth || 840) / itemStride) + 20,
      );
      const start = Math.max(0, Math.min(
        filteredItems.length,
        Math.floor(previousScroll / itemStride) - 10,
      ));
      const end = Math.min(filteredItems.length, start + visibleCount);
      state.queueWindowStart = start;
      const appendSpacer = (count) => {
        if (count <= 0) return;
        const spacer = document.createElement("div");
        spacer.className = "cutoutQueueSpacer";
        spacer.style.flexBasis = `${count * itemStride}px`;
        spacer.setAttribute("aria-hidden", "true");
        elements.cutoutQueue.appendChild(spacer);
      };
      appendSpacer(start);
      filteredItems.slice(start, end).forEach(({ item, index }) => {
        const card = document.createElement("div");
        card.tabIndex = 0;
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", String(state.selectedIds.has(item.id)));
        card.dataset.index = String(index);
        card.dataset.itemId = item.id;
        card.dataset.status = item.status;
        card.draggable = !state.busy;
        card.className = `cutoutQueueItem ${index === state.selectedIndex ? "active" : ""} ${state.selectedIds.has(item.id) ? "batchSelected" : ""} ${item.excluded ? "excluded" : ""}`;
        card.innerHTML = `
          <img alt="">
          <span class="cutoutQueueName"></span>
          <b class="cutoutQueueIndex">${index + 1}</b>
          <em class="cutoutQueueAlert"></em>
          <i class="cutoutQueueState" aria-hidden="true"></i>
          <button type="button" class="cutoutQueueToggle"></button>
          <button type="button" class="cutoutQueueRemove">×</button>`;
        card.querySelector(".cutoutQueueName").textContent = item.name;
        card.addEventListener("click", (event) => {
          updateBatchSelection(index, event);
          selectBatchIndex(index);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          updateBatchSelection(index, event);
          selectBatchIndex(index);
        });
        card.addEventListener("dragstart", (event) => {
          if (state.busy) {
            event.preventDefault();
            return;
          }
          state.draggedItemId = item.id;
          card.classList.add("dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
        });
        card.addEventListener("dragover", (event) => {
          if (!state.draggedItemId || state.draggedItemId === item.id) return;
          event.preventDefault();
          const rect = card.getBoundingClientRect();
          const after = event.clientX >= rect.left + rect.width / 2;
          card.classList.toggle("dragBefore", !after);
          card.classList.toggle("dragAfter", after);
        });
        card.addEventListener("dragleave", () => {
          card.classList.remove("dragBefore", "dragAfter");
        });
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          const rect = card.getBoundingClientRect();
          const after = event.clientX >= rect.left + rect.width / 2;
          card.classList.remove("dragBefore", "dragAfter");
          reorderBatchItem(state.draggedItemId, index, after);
          state.draggedItemId = "";
        });
        card.addEventListener("dragend", () => {
          state.draggedItemId = "";
          elements.cutoutQueue.querySelectorAll(".dragging,.dragBefore,.dragAfter").forEach((node) => {
            node.classList.remove("dragging", "dragBefore", "dragAfter");
          });
        });
        card.querySelector(".cutoutQueueToggle").addEventListener("click", (event) => {
          event.stopPropagation();
          state.thumbnailJob += 1;
          item.excluded = !item.excluded;
          updateQueueCard(item);
          renderStatus();
          scheduleBatchThumbnails();
        });
        const remove = card.querySelector(".cutoutQueueRemove");
        remove.setAttribute("aria-label", text("removeFrame"));
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          stopBatchPlayback();
          state.thumbnailJob += 1;
          const itemIndex = state.items.indexOf(item);
          if (itemIndex < 0) return;
          state.items.splice(itemIndex, 1);
          state.selectedIds.delete(item.id);
          state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.items.length - 1));
          renderQueue();
          renderPreview();
          scheduleBatchThumbnails();
        });
        elements.cutoutQueue.appendChild(card);
        updateQueueCard(item);
      });
      appendSpacer(filteredItems.length - end);
      if (state.qualityOnly && !filteredItems.length) {
        const empty = document.createElement("div");
        empty.className = "cutoutQueueEmpty";
        empty.textContent = text("qualityFilteredEmpty");
        elements.cutoutQueue.appendChild(empty);
      }
      elements.cutoutQueue.scrollLeft = previousScroll;
      elements.cutoutShowResult.classList.toggle("active", state.thumbnailMode === "result");
      elements.cutoutShowOriginal.classList.toggle("active", state.thumbnailMode === "original");
      renderStatus();
    }

    /**
     * Replaces the queue with validated local files.
     * @param {FileList|File[]} fileList Browser files.
     * @returns {Promise<void>}
     */
    async function loadFiles(fileList) {
      const files = Array.from(fileList || []).filter((file) => (
        String(file.type || "").startsWith("image/")
        || /\.(png|jpe?g|webp)$/i.test(file.name || "")
      ));
      if (!files.length) {
        setStatus(text("invalidFiles"), "error");
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
        settled.forEach((result, index) => {
          if (result.status === "fulfilled") {
            additions.push(createItem(result.value, files[index].name));
          } else {
            failures.push(files[index].name);
          }
        });
        if (!additions.length) throw new Error(failures.join(", ") || text("invalidFiles"));
        const firstAddedIndex = state.items.length;
        state.items.push(...additions);
        state.sourceKind = state.sourceKind && state.sourceKind !== "files" ? "mixed" : "files";
        state.selectedIndex = firstAddedIndex;
        state.selectedIds = new Set([additions[0].id]);
        state.selectionAnchorIndex = firstAddedIndex;
        state.previewScale = null;
        state.previewPanX = 0;
        state.previewPanY = 0;
        state.previewMode = "result";
        state.qualityOnly = false;
        renderQueue();
        renderPreview();
        scheduleBatchThumbnails();
        setStatus(
          failures.length
            ? text("partialProcessed", { count: additions.length, excluded: 0, failed: failures.length })
            : text("selected", { count: state.items.length }),
          failures.length ? "error" : "success",
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
      const animation = hooks.getCurrentAnimation?.();
      if (!animation?.frames?.length || animation.images?.length !== animation.frames.length) {
        setStatus(text("groupUnavailable"), "error");
        return;
      }
      stopBatchPlayback();
      state.thumbnailJob += 1;
      try {
        state.items = animation.images.map((image, index) => createItem(
          image,
          animation.frames[index].name || `frame_${String(index + 1).padStart(4, "0")}.png`,
          animation.frames[index],
        ));
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
        return;
      }
      state.sourceKind = "group";
      state.selectedIndex = 0;
      state.selectedIds = new Set(state.items[0] ? [state.items[0].id] : []);
      state.selectionAnchorIndex = 0;
      state.previewScale = null;
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
     * @returns {Promise<{outputs:object[],failures:Array<{index:number,name:string,message:string}>,excluded:number,cancelled:boolean}>}
     */
    async function processAll() {
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
          setStatus(text("processing", { current: queueIndex + 1, total: includedItems.length }), "busy");
          try {
            await processItem(item);
            removedPixels += item.statistics.removedPixels;
            outputs.push(outputCore.createOutput({
              name: outputCore.uniquePngName(item.name, outputNameCounts),
              frame: item.frame,
              data: item.resultCanvas.toDataURL("image/png"),
              canvas: item.resultCanvas,
            }));
          } catch (error) {
            failures.push({ index, name: item.name, message: error.message });
          }
          updateQueueCard(item);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
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
        const animation = hooks.getCurrentAnimation?.();
        const manifest = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          animation: animation?.name || "",
          sourceKind: state.sourceKind,
          settings: {
            tolerance: Number(elements.cutoutTolerance.value),
            edgeBoost: Number(elements.cutoutEdgeBoost.value),
            feather: Number(elements.cutoutFeather.value),
            chromaCleanup: Number(elements.cutoutChromaCleanup.value),
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
        const archiveEntries = outputCore.createArchiveEntries(
          outputs,
          JSON.stringify(manifest, null, 2),
        );
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
        const stem = String(animation?.name || "cutout-batch")
          .replace(/[^\p{L}\p{N}._-]+/gu, "_")
          .replace(/^_+|_+$/g, "") || "cutout-batch";
        const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
        const url = URL.createObjectURL(archive);
        const link = document.createElement("a");
        link.download = `${stem}-${timestamp}.zip`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
     * @returns {Promise<void>}
     */
    async function applyCurrentGroup() {
      if (state.sourceKind === "workset" && typeof state.worksetResolver === "function") {
        const included = state.items.filter((item) => !item.excluded).length;
        if (included !== state.items.length) {
          setStatus(text("worksetMismatch", { included, total: state.items.length }), "error");
          return;
        }
        try {
          const { outputs, failures, cancelled } = await processAll();
          if (cancelled) return;
          if (failures.length || outputs.length !== state.items.length) {
            const first = failures[0];
            setStatus(text("frameFailed", {
              index: (first?.index ?? 0) + 1,
              message: first?.message || "output mismatch",
            }), "error");
            return;
          }
          setStatus(text("worksetApplied", { count: outputs.length }), "success");
          close(outputs);
        } catch (error) {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      const animation = hooks.getCurrentAnimation?.();
      if (!animation?.frames?.length) {
        setStatus(text("groupUnavailable"), "error");
        return;
      }
      const includedItems = state.items.filter((item) => !item.excluded);
      if (includedItems.length !== animation.frames.length) {
        setStatus(text("applyMismatch", { files: includedItems.length, frames: animation.frames.length }), "error");
        return;
      }
      const confirmed = await requestConfirmation(text("applyConfirm"), [
        [text("applyAnimation"), animation.name || "—"],
        [text("applyFrames"), includedItems.length],
        [text("applyExcluded"), state.items.length - includedItems.length],
      ]);
      if (!confirmed) return;
      try {
        const { outputs, failures, cancelled } = await processAll();
        if (cancelled) return;
        if (failures.length || outputs.length !== animation.frames.length) {
          const first = failures[0];
          setStatus(text("frameFailed", {
            index: (first?.index ?? 0) + 1,
            message: first?.message || "output mismatch",
          }), "error");
          return;
        }
        await hooks.applyToCurrentAnimation?.(outputs);
        setStatus(text("applied", { count: outputs.length }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      }
    }

    /**
     * Samples a manual background color from the original preview.
     * @param {PointerEvent} event Canvas pointer event.
     * @returns {void}
     */
    function samplePreviewColor(event) {
      const item = selectedItem();
      const point = previewSourcePoint(event, event.currentTarget || elements.cutoutResult);
      if (!item || !point) return;
      const source = item.sourceCanvas;
      const x = Math.floor(point.sourceX);
      const y = Math.floor(point.sourceY);
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
      const pixel = item.sourceImageData.data;
      const offset = (y * source.width + x) * 4;
      const color = { r: pixel[offset], g: pixel[offset + 1], b: pixel[offset + 2] };
      if (state.samplingProtectedColor) {
        const duplicate = item.protectedColors.some((protectedColor) => (
          core.colorDistance(color.r, color.g, color.b, protectedColor) < 1
        ));
        if (!duplicate) item.protectedColors.push(color);
        invalidateItem(item);
        state.samplingProtectedColor = false;
        setStatus(text("protectedColorAdded", { color: core.rgbToHex(color) }), "success");
        renderPreview();
        return;
      }
      if (state.samplingBackgroundColor) {
        const duplicate = item.backgroundSamples.some((sample) => (
          core.colorDistance(color.r, color.g, color.b, sample) < 1
        ));
        if (!duplicate) {
          item.backgroundSamples.push(color);
          item.seedPoints.push({ x, y });
        }
        invalidateItem(item);
        state.samplingBackgroundColor = false;
        elements.cutoutAutoColor.checked = false;
        elements.cutoutColor.disabled = false;
        elements.cutoutColor.value = core.rgbToHex(item.backgroundSamples[0] || color);
        setStatus(text("backgroundAdded", { color: core.rgbToHex(color) }), "success");
        renderPreview();
        return;
      }
      item.backgroundSamples = [color];
      item.seedPoints = [{ x, y }];
      invalidateItem(item);
      elements.cutoutAutoColor.checked = false;
      elements.cutoutColor.disabled = false;
      elements.cutoutColor.value = core.rgbToHex(color);
      schedulePreview();
    }

    /**
     * Converts result-preview coordinates to source-image coordinates.
     * @param {PointerEvent} event Pointer event.
     * @param {object} item Selected queue item.
     * @returns {{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null}
     */
    function resultPointerPoint(event, item) {
      if (!item) return null;
      return previewSourcePoint(event, elements.cutoutResult);
    }

    /**
     * Selects the active repair mode.
     * @param {"brush"|"eraser"|"smart"|"clear"|"restore"|"protect"} mode Repair mode.
     * @returns {void}
     */
    function setRepairMode(mode) {
      state.repairMode = mode;
      state.previewMode = "result";
      elements.cutoutRepairTools.dataset.repairMode = mode;
      [
        [elements.cutoutRepairBrush, "brush"],
        [elements.cutoutRepairEraser, "eraser"],
        [elements.cutoutRepairSmart, "smart"],
        [elements.cutoutRepairClear, "clear"],
        [elements.cutoutRepairRestore, "restore"],
        [elements.cutoutRepairProtect, "protect"],
      ].forEach(([button, buttonMode]) => {
        const active = mode === buttonMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      renderPreview();
    }

    /**
     * Propagates the latest repair with PCA mapping and sequential motion tracking.
     * @returns {Promise<void>}
     */
    async function propagateLatestRepair() {
      const sourceItem = selectedItem();
      const repair = sourceItem?.repairs?.at(-1);
      if (!sourceItem || !repair) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      try {
        await processItem(sourceItem);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      const isBrushRepair = repair.mode === "brush" || repair.mode === "eraser";
      const repairPoints = isBrushRepair && Array.isArray(repair.points) ? repair.points : [];
      const repairCenter = isBrushRepair
        ? repairPoints.reduce((center, point) => ({
          x: center.x + point.x / Math.max(1, repairPoints.length),
          y: center.y + point.y / Math.max(1, repairPoints.length),
        }), { x: 0, y: 0 })
        : {
          x: (repair.x1 + repair.x2) / 2,
          y: (repair.y1 + repair.y2) / 2,
        };
      if (!Number.isFinite(repairCenter.x) || !Number.isFinite(repairCenter.y)) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      const sourceDescriptor = sourceItem.shapeCandidates.reduce((closest, candidate) => {
        if (!closest) return candidate;
        const candidateDistance = Math.hypot(
          candidate.center.x - repairCenter.x,
          candidate.center.y - repairCenter.y,
        );
        const closestDistance = Math.hypot(
          closest.center.x - repairCenter.x,
          closest.center.y - repairCenter.y,
        );
        return candidateDistance < closestDistance ? candidate : closest;
      }, null) || sourceItem.shapeDescriptor;
      if (!sourceDescriptor) {
        setStatus(text("batchRepairUnavailable"), "error");
        return;
      }
      let propagated = 0;
      let skipped = 0;
      const repairId = repair.id || (repair.id = root.crypto?.randomUUID?.() || `repair_${Date.now()}`);
      const propagateDirection = async (indices) => {
        const trackingState = tracking.createTrackingState(sourceDescriptor);
        for (const index of indices) {
          const item = state.items[index];
          try {
            await processItem(item);
          } catch (error) {
            if (error?.name === "AbortError") return;
            skipped += 1;
            continue;
          }
          const match = tracking.selectTrackedCandidate(
            sourceDescriptor,
            item.shapeCandidates,
            trackingState,
          );
          if (!match) {
            tracking.advanceTrackingState(trackingState, null);
            skipped += 1;
            continue;
          }
          tracking.advanceTrackingState(trackingState, match.candidate);
          const mappedGeometry = isBrushRepair
            ? tracking.mapBrushStroke(repair, sourceDescriptor, match.candidate)
            : tracking.mapRectangle(repair, sourceDescriptor, match.candidate);
          if (isBrushRepair && !mappedGeometry.points.length) {
            skipped += 1;
            continue;
          }
          const mappedCenter = isBrushRepair
            ? mappedGeometry.points.reduce((center, point) => ({
              x: center.x + point.x / mappedGeometry.points.length,
              y: center.y + point.y / mappedGeometry.points.length,
            }), { x: 0, y: 0 })
            : {
              x: (mappedGeometry.x1 + mappedGeometry.x2) / 2,
              y: (mappedGeometry.y1 + mappedGeometry.y2) / 2,
            };
          const backgroundColor = tracking.sampleMatchingColor(
            item.sourceImageData.data,
            item.sourceImageData.width,
            item.sourceImageData.height,
            repair.backgroundColor || selectedBackgroundColor(sourceItem),
            mappedCenter,
            15,
          );
          item.repairs = (item.repairs || []).filter((candidate) => candidate.propagatedFrom !== repairId);
          item.repairs.push({
            ...repair,
            ...mappedGeometry,
            id: root.crypto?.randomUUID?.() || `repair_${Date.now()}_${index}`,
            propagatedFrom: repairId,
            backgroundColor,
          });
          item.undoneRepairs = [];
          invalidateItem(item);
          propagated += 1;
        }
      };
      try {
        await Promise.all([
          propagateDirection(
            Array.from(
              { length: state.items.length - state.selectedIndex - 1 },
              (_unused, offset) => state.selectedIndex + offset + 1,
            ),
          ),
          propagateDirection(
            Array.from(
              { length: state.selectedIndex },
              (_unused, offset) => state.selectedIndex - offset - 1,
            ),
          ),
        ]);
      } catch (error) {
        if (error?.name !== "AbortError") {
          setStatus(text("failed", { message: error.message }), "error");
        }
        return;
      }
      renderPreview();
      scheduleBatchThumbnails();
      setStatus(text("batchRepaired", { count: propagated, skipped }), "success");
    }

    /**
     * Clears the current batch.
     * @returns {void}
     */
    function clear() {
      stopBatchPlayback();
      state.thumbnailJob += 1;
      state.items = [];
      state.sourceKind = "";
      state.selectedIndex = 0;
      state.selectedIds.clear();
      state.selectionAnchorIndex = 0;
      state.samplingProtectedColor = false;
      state.samplingBackgroundColor = false;
      state.previewScale = null;
      state.previewPanX = 0;
      state.previewPanY = 0;
      state.cancelRequested = false;
      state.batchTrayCollapsed = true;
      state.previewMode = "result";
      state.qualityOnly = false;
      renderQueue();
      renderPreview();
      setStatus(text("ready"));
    }

    /**
     * Opens the modal workbench.
     * @returns {void}
     */
    function open() {
      if (!state.items.length) {
        elements.cutoutConnected.checked = false;
        elements.cutoutPerceptual.checked = false;
        state.batchTrayCollapsed = true;
      }
      state.returnFocus = document.activeElement;
      elements.cutoutModal.hidden = false;
      setEditorInert(true);
      document.body.classList.add("cutoutOpen");
      renderLanguage();
      renderPreview();
      scheduleBatchThumbnails();
      elements.cutoutAddFiles.focus();
    }

    /**
     * Opens an isolated cutout session for an unsaved animation workset.
     * Applying resolves with processed outputs; closing resolves with null.
     * @param {{name?:string,items:Array<{name?:string,image:CanvasImageSource,frame?:object}>}} workset Unsaved frame workset.
     * @returns {Promise<Array<object>|null>}
     */
    function openWorkset(workset) {
      if (state.busy) return Promise.reject(new Error("Batch cutout is busy."));
      const inputs = Array.isArray(workset?.items) ? workset.items : [];
      if (!inputs.length) return Promise.reject(new Error(text("invalidFiles")));
      if (inputs.length > 240) return Promise.reject(new Error(text("tooMany")));
      if (state.worksetResolver) {
        const previousResolver = state.worksetResolver;
        state.worksetResolver = null;
        previousResolver(null);
      }
      stopBatchPlayback();
      state.thumbnailJob += 1;
      elements.cutoutConnected.checked = false;
      elements.cutoutPerceptual.checked = false;
      state.batchTrayCollapsed = true;
      try {
        state.items = inputs.map((item, index) => createItem(
          item.image,
          item.name || `frame_${String(index + 1).padStart(4, "0")}.png`,
          item.frame || null,
        ));
      } catch (error) {
        return Promise.reject(error);
      }
      state.sourceKind = "workset";
      state.worksetName = String(workset.name || "animation");
      state.selectedIndex = 0;
      state.selectedIds = new Set(state.items[0] ? [state.items[0].id] : []);
      state.selectionAnchorIndex = 0;
      state.previewScale = null;
      state.previewPanX = 0;
      state.previewPanY = 0;
      state.cancelRequested = false;
      state.previewMode = "result";
      state.qualityOnly = false;
      return new Promise((resolve) => {
        state.worksetResolver = resolve;
        open();
        renderQueue();
        renderPreview();
        scheduleBatchThumbnails();
        setStatus(text("worksetLoaded", {
          name: state.worksetName,
          count: state.items.length,
        }), "success");
      });
    }

    /**
     * Closes the modal workbench.
     * @param {Array<object>|null} worksetResult Optional processed workset outputs.
     * @returns {void}
     */
    function close(worksetResult = null) {
      stopBatchPlayback();
      state.thumbnailJob += 1;
      if (!elements.cutoutConfirmPanel.hidden) resolveConfirmation(false);
      elements.cutoutModal.hidden = true;
      setEditorInert(false);
      document.body.classList.remove("cutoutOpen");
      state.previewSpacePan = false;
      state.previewPanDrag = null;
      elements.cutoutModal.classList.remove("isPreviewPanReady", "isPreviewPanning");
      const resolver = state.worksetResolver;
      state.worksetResolver = null;
      state.worksetName = "";
      if (resolver) {
        state.items = [];
        state.sourceKind = "";
        state.selectedIndex = 0;
        state.selectedIds.clear();
        resolver(worksetResult);
      }
      if (state.returnFocus && typeof state.returnFocus.focus === "function") state.returnFocus.focus();
    }

    /**
     * Returns whether a pointer event should start preview panning.
     * @param {PointerEvent} event Pointer event.
     * @returns {boolean}
     */
    function shouldPanPreview(event) {
      return event.button === 1 || (event.button === 0 && state.previewSpacePan);
    }

    /**
     * Starts shared preview panning.
     * @param {PointerEvent} event Pointer event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {boolean}
     */
    function beginPreviewPan(event, target) {
      if (!shouldPanPreview(event)) return false;
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      state.previewPanDrag = {
        pointerId: event.pointerId,
        target,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      elements.cutoutModal.classList.add("isPreviewPanning");
      return true;
    }

    /**
     * Zooms a preview around the mouse pointer.
     * @param {WheelEvent} event Wheel event.
     * @param {HTMLCanvasElement} target Preview canvas.
     * @returns {void}
     */
    function zoomPreviewAtPointer(event, target) {
      if (!target._cutoutView) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const currentScale = target._cutoutView.scale;
      setPreviewScale(currentScale * direction, target, previewCanvasPoint(event, target));
    }

    /**
     * Moves the shared preview viewport during a pan gesture.
     * @param {PointerEvent} event Pointer event.
     * @returns {void}
     */
    function movePreviewPan(event) {
      const drag = state.previewPanDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = drag.target.getBoundingClientRect();
      state.previewPanX += ((event.clientX - drag.clientX) / rect.width) * drag.target.width;
      state.previewPanY += ((event.clientY - drag.clientY) / rect.height) * drag.target.height;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      renderPreview();
    }

    /**
     * Finishes a shared preview pan gesture.
     * @param {PointerEvent} event Pointer event.
     * @returns {void}
     */
    function endPreviewPan(event) {
      if (!state.previewPanDrag || state.previewPanDrag.pointerId !== event.pointerId) return;
      state.previewPanDrag = null;
      elements.cutoutModal.classList.remove("isPreviewPanning");
    }

    elements.cutoutOpen.addEventListener("click", open);
    elements.cutoutClose.addEventListener("click", () => close());
    elements.cutoutAddFiles.addEventListener("click", () => elements.cutoutFileInput.click());
    elements.cutoutFileInput.addEventListener("change", () => loadFiles(elements.cutoutFileInput.files));
    elements.cutoutLoadGroup.addEventListener("click", loadCurrentGroup);
    elements.cutoutClear.addEventListener("click", clear);
    elements.cutoutDownload.addEventListener("click", downloadAll);
    elements.cutoutApplyGroup.addEventListener("click", applyCurrentGroup);
    elements.cutoutPrevious.addEventListener("click", () => {
      selectBatchIndex(state.selectedIndex - 1, { wrap: true });
    });
    elements.cutoutNext.addEventListener("click", () => {
      selectBatchIndex(state.selectedIndex + 1, { wrap: true });
    });
    elements.cutoutFrameNumber.addEventListener("change", () => {
      selectBatchIndex(Number(elements.cutoutFrameNumber.value) - 1);
    });
    elements.cutoutFrameSlider.addEventListener("input", () => {
      selectBatchIndex(Number(elements.cutoutFrameSlider.value) - 1);
    });
    elements.cutoutPreviewPlay.addEventListener("click", toggleBatchPlayback);
    elements.cutoutViewResult.addEventListener("click", () => setPreviewMode("result"));
    elements.cutoutViewOriginal.addEventListener("click", () => setPreviewMode("original"));
    elements.cutoutViewAlpha.addEventListener("click", () => setPreviewMode("alpha"));
    elements.cutoutViewDifference.addEventListener("click", () => setPreviewMode("difference"));
    elements.cutoutBatchTrayToggle.addEventListener("click", () => {
      state.batchTrayCollapsed = !state.batchTrayCollapsed;
      renderStatus();
    });
    elements.cutoutQualityOnly.addEventListener("click", () => {
      state.qualityOnly = !state.qualityOnly;
      if (state.qualityOnly) {
        state.batchTrayCollapsed = false;
        const current = selectedItem();
        if (!hasQualityIssue(current)) {
          const firstIssue = state.items.findIndex(hasQualityIssue);
          if (firstIssue >= 0) state.selectedIndex = firstIssue;
        }
      }
      renderQueue();
      renderPreview();
    });
    elements.cutoutNextIssue.addEventListener("click", selectNextQualityIssue);
    elements.cutoutShowResult.addEventListener("click", () => {
      state.thumbnailMode = "result";
      renderQueue();
      scheduleBatchThumbnails();
    });
    elements.cutoutShowOriginal.addEventListener("click", () => {
      state.thumbnailMode = "original";
      renderQueue();
    });
    elements.cutoutIncludeAll.addEventListener("click", () => {
      state.items.forEach((item) => { item.excluded = false; });
      renderQueue();
      scheduleBatchThumbnails();
    });
    elements.cutoutExcludeAll.addEventListener("click", () => {
      state.thumbnailJob += 1;
      state.items.forEach((item) => { item.excluded = true; });
      renderQueue();
    });
    elements.cutoutSelectAll.addEventListener("click", () => {
      state.selectedIds = new Set(state.items.map((item) => item.id));
      renderQueue();
    });
    elements.cutoutInvertSelection.addEventListener("click", () => {
      const nextSelection = new Set();
      state.items.forEach((item) => {
        if (!state.selectedIds.has(item.id)) nextSelection.add(item.id);
      });
      state.selectedIds = nextSelection;
      renderQueue();
    });
    elements.cutoutExcludeSelected.addEventListener("click", () => {
      state.thumbnailJob += 1;
      state.items.forEach((item) => {
        if (state.selectedIds.has(item.id)) item.excluded = true;
      });
      renderQueue();
      scheduleBatchThumbnails();
    });
    elements.cutoutDeleteSelected.addEventListener("click", () => {
      stopBatchPlayback();
      state.thumbnailJob += 1;
      const currentItemId = selectedItem()?.id;
      state.items = state.items.filter((item) => !state.selectedIds.has(item.id));
      state.selectedIds.clear();
      const preservedIndex = state.items.findIndex((item) => item.id === currentItemId);
      state.selectedIndex = preservedIndex >= 0
        ? preservedIndex
        : Math.min(state.selectedIndex, Math.max(0, state.items.length - 1));
      if (state.items[state.selectedIndex]) state.selectedIds.add(state.items[state.selectedIndex].id);
      state.selectionAnchorIndex = state.selectedIndex;
      renderQueue();
      renderPreview();
      scheduleBatchThumbnails();
    });
    elements.cutoutRetryFailed.addEventListener("click", () => {
      state.items.filter((item) => item.status === "failed").forEach(invalidateItem);
      renderQueue();
      renderPreview();
      scheduleBatchThumbnails();
    });
    elements.cutoutCancelProcess.addEventListener("click", () => {
      state.cancelRequested = true;
      cutoutExecutor.cancelAll();
      renderStatus();
    });
    elements.cutoutQueue.addEventListener("scroll", () => {
      if (state.queueRenderFrame) return;
      state.queueRenderFrame = requestAnimationFrame(() => {
        state.queueRenderFrame = 0;
        const nextStart = Math.max(0, Math.floor(elements.cutoutQueue.scrollLeft / 140) - 10);
        if (Math.abs(nextStart - state.queueWindowStart) >= 5) renderQueue();
      });
    }, { passive: true });
    elements.cutoutConfirmCancel.addEventListener("click", () => resolveConfirmation(false));
    elements.cutoutConfirmApply.addEventListener("click", () => resolveConfirmation(true));
    elements.cutoutOriginal.addEventListener("pointerdown", (event) => {
      if (!beginPreviewPan(event, elements.cutoutOriginal)) samplePreviewColor(event);
    });
    elements.cutoutResult.addEventListener("pointerdown", (event) => {
      if (beginPreviewPan(event, elements.cutoutResult)) return;
      if (state.samplingProtectedColor || state.samplingBackgroundColor) {
        samplePreviewColor(event);
        return;
      }
      if (state.previewMode !== "result") {
        setStatus(text("diagnosticReadOnly"), "idle");
        return;
      }
      const item = selectedItem();
      const point = resultPointerPoint(event, item);
      if (!item || !point) return;
      elements.cutoutResult.setPointerCapture(event.pointerId);
      state.repairDrag = {
        pointerId: event.pointerId,
        startX: point.canvasX,
        startY: point.canvasY,
        currentX: point.canvasX,
        currentY: point.canvasY,
        sourceStartX: point.sourceX,
        sourceStartY: point.sourceY,
        sourceCurrentX: point.sourceX,
        sourceCurrentY: point.sourceY,
        points: [{ x: point.sourceX, y: point.sourceY }],
      };
      renderPreview();
    });
    elements.cutoutResult.addEventListener("pointermove", (event) => {
      if (!state.repairDrag || state.repairDrag.pointerId !== event.pointerId) return;
      const point = resultPointerPoint(event, selectedItem());
      if (!point) return;
      state.repairDrag.currentX = point.canvasX;
      state.repairDrag.currentY = point.canvasY;
      state.repairDrag.sourceCurrentX = point.sourceX;
      state.repairDrag.sourceCurrentY = point.sourceY;
      if (state.repairMode === "brush" || state.repairMode === "eraser") {
        const previous = state.repairDrag.points.at(-1);
        if (!previous || Math.hypot(point.sourceX - previous.x, point.sourceY - previous.y) >= 0.5) {
          state.repairDrag.points.push({ x: point.sourceX, y: point.sourceY });
        }
      }
      renderPreview();
    });
    elements.cutoutResult.addEventListener("pointerup", async (event) => {
      const item = selectedItem();
      const drag = state.repairDrag;
      if (!item || !drag || drag.pointerId !== event.pointerId) return;
      state.repairDrag = null;
      if (state.repairMode === "brush" || state.repairMode === "eraser") {
        const colorHex = elements.cutoutBrushColor.value || "#00c800";
        item.repairs.push({
          id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
          mode: state.repairMode,
          points: drag.points,
          size: Number(elements.cutoutBrushSize.value),
          hardness: Number(elements.cutoutBrushHardness.value) / 100,
          opacity: Number(elements.cutoutBrushOpacity.value) / 100,
          color: {
            r: Number.parseInt(colorHex.slice(1, 3), 16),
            g: Number.parseInt(colorHex.slice(3, 5), 16),
            b: Number.parseInt(colorHex.slice(5, 7), 16),
          },
        });
        item.undoneRepairs = [];
        invalidateItem(item);
        renderPreview();
        return;
      }
      if (Math.abs(drag.sourceCurrentX - drag.sourceStartX) < 2 || Math.abs(drag.sourceCurrentY - drag.sourceStartY) < 2) {
        renderPreview();
        return;
      }
      if (state.repairMode === "protect") {
        try {
          await processItem(item);
        } catch (error) {
          if (error?.name !== "AbortError") {
            setStatus(text("failed", { message: error.message }), "error");
          }
          return;
        }
        const selection = core.selectProtectedColorsInRectangle(
          item.sourceImageData.data,
          item.sourceImageData.width,
          item.sourceImageData.height,
          {
            x1: drag.sourceStartX,
            y1: drag.sourceStartY,
            x2: drag.sourceCurrentX,
            y2: drag.sourceCurrentY,
          },
          {
            maximumSamples: 5000,
            maximumColors: 32,
            coverage: 0.95,
            excludeColors: selectedBackgroundColors(item),
            existingColors: item.protectedColors,
            previewData: item.automaticImageData?.data || item.resultImageData?.data || null,
          },
        );
        for (const color of selection.colors) {
          if (item.protectedColors.length >= 32) break;
          const duplicate = item.protectedColors.some((candidate) => (
            core.colorDistance(color.r, color.g, color.b, candidate) < 2
          ));
          if (!duplicate) item.protectedColors.push({ r: color.r, g: color.g, b: color.b });
        }
        invalidateItem(item);
        setStatus(
          text(
            selection.status === 0 ? "protectedRegionCoverage" : "protectedRegionIncomplete",
            { count: selection.count, coverage: selection.coverage },
          ),
          selection.status === 0 ? "success" : "idle",
        );
        renderPreview();
        return;
      }
      item.repairs.push({
        id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
        mode: state.repairMode,
        x1: drag.sourceStartX,
        y1: drag.sourceStartY,
        x2: drag.sourceCurrentX,
        y2: drag.sourceCurrentY,
        backgroundColor: { ...selectedBackgroundColor(item) },
        tolerance: Number(elements.cutoutTolerance.value),
        feather: Number(elements.cutoutFeather.value),
      });
      item.undoneRepairs = [];
      invalidateItem(item);
      const modeKey = state.repairMode === "clear"
        ? "repairClearMode"
        : state.repairMode === "restore"
          ? "repairRestoreMode"
          : "repairSmartMode";
      setStatus(text("repaired", { mode: text(modeKey) }), "success");
      renderPreview();
    });
    elements.cutoutResult.addEventListener("pointercancel", () => {
      state.repairDrag = null;
      renderPreview();
    });
    elements.cutoutResult.addEventListener("keydown", async (event) => {
      const item = selectedItem();
      if (!item || state.previewMode !== "result") return;
      const { width, height } = item.sourceImageData;
      const point = state.keyboardRepairPoint || { x: Math.floor(width / 2), y: Math.floor(height / 2) };
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        elements.cutoutZoomIn.click();
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        elements.cutoutZoomOut.click();
        return;
      }
      const deltas = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (deltas[event.key]) {
        event.preventDefault();
        point.x = Math.max(0, Math.min(width - 1, point.x + deltas[event.key][0]));
        point.y = Math.max(0, Math.min(height - 1, point.y + deltas[event.key][1]));
        state.keyboardRepairPoint = point;
        setStatus(`Keyboard repair cursor: ${point.x + 1}, ${point.y + 1}`, "idle");
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const radius = Math.max(2, Math.round(Number(elements.cutoutBrushSize.value) / 2));
      if (state.repairMode === "brush" || state.repairMode === "eraser") {
        const colorHex = elements.cutoutBrushColor.value || "#00c800";
        item.repairs.push({
          id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
          mode: state.repairMode,
          points: [{ x: point.x, y: point.y }],
          size: radius * 2,
          hardness: Number(elements.cutoutBrushHardness.value) / 100,
          opacity: Number(elements.cutoutBrushOpacity.value) / 100,
          color: {
            r: Number.parseInt(colorHex.slice(1, 3), 16),
            g: Number.parseInt(colorHex.slice(3, 5), 16),
            b: Number.parseInt(colorHex.slice(5, 7), 16),
          },
        });
      } else if (state.repairMode === "protect") {
        try {
          await processItem(item);
        } catch (error) {
          if (error?.name !== "AbortError") {
            setStatus(text("failed", { message: error.message }), "error");
          }
          return;
        }
        const selection = core.selectProtectedColorsInRectangle(
          item.sourceImageData.data,
          width,
          height,
          { x1: point.x - radius, y1: point.y - radius, x2: point.x + radius, y2: point.y + radius },
          {
            maximumSamples: 5000,
            maximumColors: Math.max(0, 32 - item.protectedColors.length),
            coverage: 0.95,
            excludeColors: selectedBackgroundColors(item),
            existingColors: item.protectedColors,
            previewData: item.automaticImageData?.data || item.resultImageData?.data || null,
          },
        );
        item.protectedColors.push(...selection.colors.slice(0, 32 - item.protectedColors.length));
      } else {
        item.repairs.push({
          id: root.crypto?.randomUUID?.() || `repair_${Date.now()}`,
          mode: state.repairMode,
          x1: point.x - radius,
          y1: point.y - radius,
          x2: point.x + radius,
          y2: point.y + radius,
          backgroundColor: { ...selectedBackgroundColor(item) },
          tolerance: Number(elements.cutoutTolerance.value),
          feather: Number(elements.cutoutFeather.value),
        });
      }
      item.undoneRepairs = [];
      invalidateItem(item);
      renderPreview();
      setStatus(text("repaired", { mode: state.repairMode }), "success");
    });
    [elements.cutoutOriginal, elements.cutoutResult].forEach((canvas) => {
      canvas.addEventListener("wheel", (event) => zoomPreviewAtPointer(event, canvas), { passive: false });
      canvas.addEventListener("pointermove", movePreviewPan);
      canvas.addEventListener("pointerup", endPreviewPan);
      canvas.addEventListener("pointercancel", endPreviewPan);
    });
    elements.cutoutZoomOut.addEventListener("click", () => {
      const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
      if (view) setPreviewScale(view.scale / 1.2);
    });
    elements.cutoutZoomIn.addEventListener("click", () => {
      const view = elements.cutoutResult._cutoutView || elements.cutoutOriginal._cutoutView;
      if (view) setPreviewScale(view.scale * 1.2);
    });
    elements.cutoutZoomFit.addEventListener("click", () => setPreviewScale(null));
    elements.cutoutZoomActual.addEventListener("click", () => setPreviewScale(1));
    elements.cutoutZoom.addEventListener("input", () => {
      setPreviewScale(Number(elements.cutoutZoom.value) / 100);
    });
    elements.cutoutRepairSmart.addEventListener("click", () => setRepairMode("smart"));
    elements.cutoutRepairBrush.addEventListener("click", () => setRepairMode("brush"));
    elements.cutoutRepairEraser.addEventListener("click", () => setRepairMode("eraser"));
    elements.cutoutRepairClear.addEventListener("click", () => setRepairMode("clear"));
    elements.cutoutRepairRestore.addEventListener("click", () => setRepairMode("restore"));
    elements.cutoutRepairProtect.addEventListener("click", () => setRepairMode("protect"));
    [
      [elements.cutoutBrushSize, elements.cutoutBrushSizeValue, ""],
      [elements.cutoutBrushHardness, elements.cutoutBrushHardnessValue, "%"],
      [elements.cutoutBrushOpacity, elements.cutoutBrushOpacityValue, "%"],
    ].forEach(([input, output, suffix]) => {
      input.addEventListener("input", () => { output.textContent = `${input.value}${suffix}`; });
    });
    elements.cutoutRepairUndo.addEventListener("click", () => {
      const item = selectedItem();
      const repair = item?.repairs?.pop();
      if (repair) item.undoneRepairs.push(repair);
      invalidateItem(item);
      renderPreview();
    });
    elements.cutoutRepairRedo.addEventListener("click", () => {
      const item = selectedItem();
      const repair = item?.undoneRepairs?.pop();
      if (repair) item.repairs.push(repair);
      invalidateItem(item);
      renderPreview();
    });
    elements.cutoutRepairReset.addEventListener("click", () => {
      const item = selectedItem();
      if (item) {
        item.repairs = [];
        item.undoneRepairs = [];
        invalidateItem(item);
      }
      renderPreview();
    });
    elements.cutoutRepairBatch.addEventListener("click", propagateLatestRepair);
    elements.cutoutProtectSample.addEventListener("click", () => {
      state.samplingProtectedColor = !state.samplingProtectedColor;
      state.samplingBackgroundColor = false;
      if (state.samplingProtectedColor) setStatus(text("protectSampling"), "busy");
      renderBackgroundSamples();
      renderProtectedColors();
    });
    elements.cutoutProtectClear.addEventListener("click", () => {
      const item = selectedItem();
      if (item) {
        item.protectedColors = [];
        invalidateItem(item);
      }
      state.samplingProtectedColor = false;
      renderPreview();
    });
    elements.cutoutBackgroundSample.addEventListener("click", () => {
      state.samplingBackgroundColor = !state.samplingBackgroundColor;
      state.samplingProtectedColor = false;
      if (state.samplingBackgroundColor) setStatus(text("backgroundSampling"), "busy");
      renderBackgroundSamples();
      renderProtectedColors();
    });
    elements.cutoutBackgroundClear.addEventListener("click", () => {
      const item = selectedItem();
      if (item) {
        item.backgroundSamples = [];
        item.seedPoints = [];
        invalidateItem(item);
      }
      state.samplingBackgroundColor = false;
      renderPreview();
    });
    document.querySelectorAll("[data-cutout-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.cutoutTab;
        document.querySelectorAll("[data-cutout-tab]").forEach((candidate) => {
          candidate.classList.toggle("active", candidate === button);
          candidate.setAttribute("aria-selected", String(candidate === button));
        });
        document.querySelectorAll("[data-cutout-panel]").forEach((panel) => {
          const active = panel.dataset.cutoutPanel === tab;
          panel.classList.toggle("active", active);
          panel.hidden = !active;
          panel.setAttribute("aria-hidden", String(!active));
        });
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(document.querySelectorAll("[data-cutout-tab]"));
        const currentIndex = tabs.indexOf(button);
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
      });
    });
    advancedPresetButtons.forEach((button) => {
      button.addEventListener("click", () => applyAdvancedPreset(button.dataset.cutoutPreset));
    });
    elements.cutoutModal.addEventListener("pointerdown", (event) => {
      if (event.target === elements.cutoutModal) close();
    });
    window.addEventListener("keydown", (event) => {
      if (!elements.cutoutModal.hidden && event.key === "Tab") {
        trapModalFocus(event);
        return;
      }
      if (event.key === "Escape" && !elements.cutoutModal.hidden) {
        if (!elements.cutoutConfirmPanel.hidden) resolveConfirmation(false);
        else close();
        return;
      }
      if (
        !elements.cutoutModal.hidden
        && elements.cutoutConfirmPanel.hidden
        && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
        && document.activeElement?.getAttribute("role") !== "tab"
        && (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectBatchIndex(state.selectedIndex + (event.key === "ArrowRight" ? 1 : -1), { wrap: true });
        return;
      }
      if (
        event.code === "Space"
        && !elements.cutoutModal.hidden
        && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.previewSpacePan = true;
        elements.cutoutModal.classList.add("isPreviewPanReady");
      }
    }, true);
    window.addEventListener("keyup", (event) => {
      if (event.code !== "Space") return;
      if (!elements.cutoutModal.hidden) event.stopImmediatePropagation();
      state.previewSpacePan = false;
      elements.cutoutModal.classList.remove("isPreviewPanReady");
    }, true);
    window.addEventListener("resize", () => {
      if (!elements.cutoutModal.hidden) renderPreview();
    });
    for (const eventName of ["dragenter", "dragover"]) {
      elements.cutoutDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.cutoutDropzone.classList.add("dragOver");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      elements.cutoutDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.cutoutDropzone.classList.remove("dragOver");
      });
    }
    elements.cutoutDropzone.addEventListener("drop", (event) => loadFiles(event.dataTransfer?.files));
    elements.cutoutAutoColor.addEventListener("change", () => {
      elements.cutoutColor.disabled = elements.cutoutAutoColor.checked;
      const item = selectedItem();
      if (elements.cutoutAutoColor.checked && item) {
        item.backgroundSamples = [];
        item.seedPoints = [];
      }
      schedulePreview();
    });
    elements.cutoutConnected.addEventListener("change", schedulePreview);
    elements.cutoutPerceptual.addEventListener("change", schedulePreview);
    elements.cutoutDespillMode.addEventListener("change", schedulePreview);
    elements.cutoutColor.addEventListener("input", () => {
      const item = selectedItem();
      if (item) {
        item.backgroundSamples = [core.hexToRgb(elements.cutoutColor.value)];
        item.seedPoints = [];
      }
      schedulePreview();
    });
    [
      [elements.cutoutTolerance, elements.cutoutToleranceValue],
      [elements.cutoutEdgeBoost, elements.cutoutEdgeBoostValue],
      [elements.cutoutFeather, elements.cutoutFeatherValue],
      [elements.cutoutChromaCleanup, elements.cutoutChromaCleanupValue],
      [elements.cutoutChromaFeather, elements.cutoutChromaFeatherValue],
      [elements.cutoutAlphaThreshold, elements.cutoutAlphaValue],
      [elements.cutoutDespillStrength, elements.cutoutDespillStrengthValue],
      [elements.cutoutEdgeDespillRadius, elements.cutoutEdgeDespillRadiusValue],
      [elements.cutoutEdgeRecoveryStrength, elements.cutoutEdgeRecoveryStrengthValue],
      [elements.cutoutBackgroundRadius, elements.cutoutBackgroundRadiusValue],
      [elements.cutoutBlurRadius, elements.cutoutBlurRadiusValue],
      [elements.cutoutAlphaLow, elements.cutoutAlphaLowValue],
      [elements.cutoutAlphaHigh, elements.cutoutAlphaHighValue],
      [elements.cutoutProtectionTolerance, elements.cutoutProtectionToleranceValue],
    ].forEach(([input, output]) => {
      input.addEventListener("input", () => {
        output.textContent = input.value;
        renderAdvancedMode();
        schedulePreview();
      });
    });

    renderLanguage();
    renderAdvancedMode();
    setRepairMode("smart");
    renderPreview();
    return {
      open,
      openWorkset,
      setLanguage(nextLanguage) {
        state.language = nextLanguage === "en" ? "en" : "zh";
        renderLanguage();
      },
    };
  }

  root.BatchCutout = { createController };
}(globalThis));
