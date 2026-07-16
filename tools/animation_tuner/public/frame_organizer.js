(function attachFrameOrganizer(root) {
  "use strict";

  const TEXT = {
    zh: {
      open: "帧整理",
      title: "帧工作集",
      subtitle: "重排、减帧与相似度诊断",
      importTitle: "导入动画",
      importSubtitle: "图片序列或视频 → 本地动画项目",
      importSetupTitle: "动画信息",
      importSetupHint: "可保存到当前项目；没有项目时会自动创建本地项目。",
      importProject: "保存到",
      importProjectCurrent: "当前项目 · {name}",
      importProjectNew: "新建本地项目",
      importProjectName: "新项目名称",
      importProfileName: "角色名称",
      importAnimationName: "动画名称",
      importFps: "播放 FPS",
      importType: "类型",
      importTypeActor: "角色",
      importTypeBoss: "Boss",
      importTypeVfx: "特效",
      importTypeProp: "道具",
      sourceTools: "来源",
      editTools: "编辑",
      analysisTools: "分析",
      dangerTools: "移除",
      reduceEvery: "每",
      undoDelete: "撤销删除",
      confirmTitle: "确认应用",
      confirm: "确认",
      cancel: "取消",
      detailProject: "项目",
      detailProfile: "角色",
      detailAnimation: "动画",
      detailFrames: "帧数",
      detailFps: "FPS",
      create: "创建动画",
      addToAssets: "添加到当前组素材",
      assetsAdded: "已添加 {count} 张图片到当前组素材",
      clearWorkset: "清空",
      importReady: "请导入图片序列，或从视频提取帧",
      importMissingMetadata: "请填写项目、角色和动画名称",
      createConfirm: "将当前工作集创建为新动画，共 {count} 帧。确定继续吗？",
      created: "动画创建完成，共导入 {count} 帧",
      close: "关闭",
      noGroup: "当前没有可整理的动画组",
      invert: "反选工作集",
      reduce: "减帧",
      autoSort: "恢复原顺序",
      flip: "水平翻转",
      import: "导入图片",
      importVideo: "导入视频",
      editCutout: "编辑抠图",
      cutoutReady: "已回写 {count} 帧抠图结果，可继续整理或创建动画",
      cutoutNeedFrames: "请先导入图片或从视频提取帧",
      videoTitle: "视频帧提取",
      videoSubtitle: "在浏览器本地选择片段与帧率，视频不会上传",
      videoNoFile: "尚未选择视频",
      videoReselect: "重新选择",
      videoRange: "提取时间段",
      videoStart: "开始",
      videoEnd: "结束",
      videoFps: "抽帧率",
      videoFpsUnit: "帧/秒",
      videoEstimate: "预计帧数",
      videoFramesUnit: "帧",
      videoHint: "最多一次提取 300 帧；长视频请缩短片段或降低帧率。",
      videoReady: "选择视频后开始设置",
      videoCancel: "取消",
      videoExtract: "提取到工作集",
      videoLoading: "正在读取视频信息…",
      videoLoaded: "视频已就绪，可选择片段并调整帧率",
      videoExtracting: "正在提取第 {current}/{total} 帧…",
      videoImported: "已从视频提取 {count} 帧并加入工作集",
      videoUnsupported: "浏览器无法解码此视频，请尝试 H.264 MP4 或 WebM",
      videoTooMany: "预计 {count} 帧，超过单次 300 帧限制",
      videoMemoryLimit: "当前分辨率与帧数占用过大，请缩短片段或降低帧率",
      videoInvalidRange: "结束时间必须晚于开始时间",
      deleteSelected: "删除选中",
      deleteExcluded: "删除未入集",
      threshold: "相似度阈值",
      findJump: "寻找跳变帧",
      findDuplicate: "寻找重复帧",
      findLoop: "寻找循环段",
      loopDialogTitle: "寻找循环帧",
      loopDialogSubtitle: "分析帧间周期、重复边界和首尾过渡",
      loopPreference: "循环偏好",
      loopPreferenceAuto: "自动",
      loopPreferenceShort: "短动画优先",
      loopPreferenceLong: "长动画优先",
      loopStartFrame: "起始帧",
      loopStartAuto: "自动",
      loopStartCustom: "指定",
      loopStartPrefix: "从第",
      loopStartSuffix: "帧开始搜索",
      loopSearching: "正在寻找稳定循环…",
      loopDecoding: "正在生成帧特征 {current}/{total}",
      loopComparing: "正在比较帧关系 {current}/{total}",
      loopRanking: "正在计算周期候选",
      loopNoResult: "没有找到可靠循环",
      loopNoResultHint: "可以改用其他循环偏好，或指定更靠后的起始帧后重试。",
      loopPreviewFrame: "帧",
      loopPlay: "播放",
      loopPause: "暂停",
      loopPlaybackSpeed: "播放速度",
      loopRetry: "重新设置",
      loopStartSearch: "开始搜索",
      loopTrim: "保留循环段并关闭",
      loopCandidatePeriod: "周期 {period}",
      loopCandidateRange: "第 {start}–{end} 帧 · {count} 帧",
      loopCandidateMetrics: "平滑 {smoothness}% · 覆盖 {coverage}%",
      loopNeedFrames: "寻找循环至少需要 4 个工作集帧",
      loopTrimmed: "已保留循环段第 {start}–{end} 帧，共 {count} 帧",
      thresholdAdjusted: "未命中原阈值，已自动调整为 {threshold}",
      reset: "还原",
      apply: "应用到动画组",
      frames: "帧缩略图",
      preview: "动画预览",
      workset: "工作集 {included} / {total} 帧",
      selected: "选中 {count} 帧",
      ready: "等待操作",
      loaded: "已载入 {name}，共 {count} 帧",
      reduced: "每 {step} 帧保留 1 帧，工作集剩余 {count} 帧",
      sorted: "已恢复原始帧顺序，导入帧排在末尾",
      flipped: "已水平翻转 {count} 帧",
      imported: "已导入 {count} 张图片",
      deleted: "已删除 {count} 帧",
      foundJump: "找到 {count} 个跳变帧",
      foundDuplicate: "找到 {count} 个重复帧",
      foundLoop: "循环候选：第 {start}–{end} 帧，相似度 {similarity}%",
      noneFound: "未找到匹配帧",
      applyConfirm: "将按当前工作集覆盖动画帧，并迁移调参、框体、音效和挂件。确定继续吗？",
      applied: "动画组整理完成，共保留 {count} 帧",
      failed: "操作失败：{message}",
      reducePrompt: "每多少帧保留 1 帧？",
      tagPlaceholder: "标记，例如：攻击有效帧",
      applyTag: "标记选中",
      clearTag: "清除标记",
      speed: "预览速度",
      original: "原始",
      edited: "编辑结果",
    },
    en: {
      open: "Frame Organizer",
      title: "Frame Workset",
      subtitle: "Reorder, reduce, and diagnose similarity",
      importTitle: "Import Animation",
      importSubtitle: "Image sequence or video → local animation project",
      importSetupTitle: "Animation Details",
      importSetupHint: "Save to the active project, or create a local project when none exists.",
      importProject: "Save to",
      importProjectCurrent: "Current · {name}",
      importProjectNew: "New local project",
      importProjectName: "New project name",
      importProfileName: "Character name",
      importAnimationName: "Animation name",
      importFps: "Playback FPS",
      importType: "Type",
      importTypeActor: "Actor",
      importTypeBoss: "Boss",
      importTypeVfx: "VFX",
      importTypeProp: "Prop",
      sourceTools: "SOURCE",
      editTools: "EDIT",
      analysisTools: "ANALYZE",
      dangerTools: "REMOVE",
      reduceEvery: "Every",
      undoDelete: "Undo delete",
      confirmTitle: "Confirm changes",
      confirm: "Confirm",
      cancel: "Cancel",
      detailProject: "Project",
      detailProfile: "Profile",
      detailAnimation: "Animation",
      detailFrames: "Frames",
      detailFps: "FPS",
      create: "Create Animation",
      addToAssets: "Add to Group Assets",
      assetsAdded: "Added {count} images to the current group assets",
      clearWorkset: "Clear",
      importReady: "Import an image sequence or extract frames from a video",
      importMissingMetadata: "Enter project, character, and animation names",
      createConfirm: "Create a new animation from the current {count}-frame workset?",
      created: "Animation created with {count} frames",
      close: "Close",
      noGroup: "No animation group is available",
      invert: "Invert Workset",
      reduce: "Reduce Frames",
      autoSort: "Restore Order",
      flip: "Flip Horizontal",
      import: "Import Images",
      importVideo: "Import Video",
      editCutout: "Edit Cutout",
      cutoutReady: "Applied cutout results to {count} frames; continue organizing or create the animation",
      cutoutNeedFrames: "Import images or extract video frames first",
      videoTitle: "Video Frame Extraction",
      videoSubtitle: "Choose a local segment and frame rate; the video is never uploaded",
      videoNoFile: "No video selected",
      videoReselect: "Choose Again",
      videoRange: "Extraction range",
      videoStart: "Start",
      videoEnd: "End",
      videoFps: "Extraction rate",
      videoFpsUnit: "frames/sec",
      videoEstimate: "Estimated frames",
      videoFramesUnit: "frames",
      videoHint: "Up to 300 frames per extraction. Shorten the range or lower FPS for long videos.",
      videoReady: "Choose a video to configure extraction",
      videoCancel: "Cancel",
      videoExtract: "Extract to Workset",
      videoLoading: "Reading video metadata…",
      videoLoaded: "Video ready; choose a range and frame rate",
      videoExtracting: "Extracting frame {current}/{total}…",
      videoImported: "Extracted {count} video frames into the workset",
      videoUnsupported: "This browser cannot decode the video. Try H.264 MP4 or WebM.",
      videoTooMany: "Estimated {count} frames exceeds the 300-frame limit",
      videoMemoryLimit: "Resolution and frame count require too much memory; shorten the range or lower FPS",
      videoInvalidRange: "End time must be later than start time",
      deleteSelected: "Delete Selected",
      deleteExcluded: "Delete Excluded",
      threshold: "Similarity",
      findJump: "Find Jump Frames",
      findDuplicate: "Find Duplicates",
      findLoop: "Find Loop Range",
      loopDialogTitle: "Find Loop Frames",
      loopDialogSubtitle: "Analyze periodicity, repeated boundaries, and seam continuity",
      loopPreference: "Loop preference",
      loopPreferenceAuto: "Automatic",
      loopPreferenceShort: "Prefer short",
      loopPreferenceLong: "Prefer long",
      loopStartFrame: "Start frame",
      loopStartAuto: "Automatic",
      loopStartCustom: "Specify",
      loopStartPrefix: "Start at frame",
      loopStartSuffix: "",
      loopSearching: "Searching for a stable loop…",
      loopDecoding: "Building frame features {current}/{total}",
      loopComparing: "Comparing frames {current}/{total}",
      loopRanking: "Ranking periodic candidates",
      loopNoResult: "No reliable loop found",
      loopNoResultHint: "Try another loop preference or specify a later starting frame.",
      loopPreviewFrame: "Frame",
      loopPlay: "Play",
      loopPause: "Pause",
      loopPlaybackSpeed: "Playback speed",
      loopRetry: "Change Settings",
      loopStartSearch: "Start Search",
      loopTrim: "Keep Loop Range & Close",
      loopCandidatePeriod: "Period {period}",
      loopCandidateRange: "Frames {start}–{end} · {count} frames",
      loopCandidateMetrics: "Seam {smoothness}% · coverage {coverage}%",
      loopNeedFrames: "At least four workset frames are required",
      loopTrimmed: "Kept loop range {start}–{end} ({count} frames)",
      thresholdAdjusted: "No match at the original threshold; adjusted to {threshold}",
      reset: "Reset",
      apply: "Apply to Group",
      frames: "Frame Thumbnails",
      preview: "Animation Preview",
      workset: "Workset {included} / {total} frames",
      selected: "{count} selected",
      ready: "Ready",
      loaded: "Loaded {name} ({count} frames)",
      reduced: "Kept 1 of every {step} frames; {count} remain",
      sorted: "Restored source order; imported frames were placed last",
      flipped: "Flipped {count} frames horizontally",
      imported: "Imported {count} images",
      deleted: "Deleted {count} frames",
      foundJump: "Found {count} jump frames",
      foundDuplicate: "Found {count} duplicate frames",
      foundLoop: "Loop candidate: frames {start}–{end}, {similarity}% similarity",
      noneFound: "No matching frames found",
      applyConfirm: "This replaces the animation frames and migrates tuning, boxes, audio, and attachments. Continue?",
      applied: "Organizer applied; {count} frames remain",
      failed: "Operation failed: {message}",
      reducePrompt: "Keep one frame out of every how many?",
      tagPlaceholder: "Tag, e.g. active attack",
      applyTag: "Tag Selected",
      clearTag: "Clear Tag",
      speed: "Preview speed",
      original: "Original",
      edited: "Edited",
    },
  };

  /**
   * Creates the frame organizer controller.
   * @param {{
   *   getLanguage?:()=>string,
   *   getCurrentAnimation?:()=>object|null,
   *   getImportContext?:()=>{activeProject?:object|null,profiles?:object[]},
   *   applyPlan?:(items:Array<object>)=>Promise<void>,
   *   createAnimation?:(metadata:object,items:Array<object>)=>Promise<void>,
   *   addAssets?:(items:Array<{name:string,image:HTMLCanvasElement}>)=>Promise<number>,
   *   editCutout?:(workset:{name:string,items:Array<{name:string,image:HTMLCanvasElement,frame:object}>})=>Promise<Array<{canvas?:HTMLCanvasElement,data?:string,frame?:object}>|null>,
   *   onStatus?:(message:string)=>void
   * }} hooks Host integration hooks.
   * @returns {{open:()=>Promise<void>,openImport:()=>Promise<void>,setLanguage:(language:string)=>void}}
   */
  function createController(hooks = {}) {
    const core = root.FrameOrganizerCore;
    if (!core) throw new Error("FrameOrganizerCore is required.");
    const ids = [
      "organizerOpen", "organizerModal", "organizerClose", "organizerTitle", "organizerSubtitle",
      "organizerImportSetup", "organizerProjectSelect", "organizerProjectNameField",
      "organizerProjectName", "organizerProfileName", "organizerAnimationName",
      "organizerImportFps", "organizerAnimationType", "organizerInvert", "organizerReduce",
      "organizerReduceStep", "organizerUndoDelete", "organizerConfirmPanel",
      "organizerConfirmTitle", "organizerConfirmMessage", "organizerConfirmDetails",
      "organizerConfirmCancel", "organizerConfirmAccept",
      "organizerLoopPanel", "organizerLoopTitle", "organizerLoopClose", "organizerLoopParams",
      "organizerLoopPreference", "organizerLoopStartAuto", "organizerLoopStartCustom",
      "organizerLoopStartRow", "organizerLoopStartInput", "organizerLoopSearch",
      "organizerLoopSearchLabel", "organizerLoopProgressBar", "organizerLoopProgressText",
      "organizerLoopResults", "organizerLoopEmpty", "organizerLoopResultContent",
      "organizerLoopCandidates", "organizerLoopCanvas", "organizerLoopPrevious",
      "organizerLoopNext", "organizerLoopFrameInput", "organizerLoopFrameTotal",
      "organizerLoopFrameRange", "organizerLoopPlay", "organizerLoopSpeed",
      "organizerLoopCancel", "organizerLoopRetry", "organizerLoopStartSearch",
      "organizerLoopTrim",
      "organizerAutoSort", "organizerFlip", "organizerImport", "organizerFileInput",
      "organizerImportVideo", "organizerVideoInput", "organizerVideoPanel", "organizerVideoClose",
      "organizerVideoElement", "organizerVideoName", "organizerVideoMeta", "organizerVideoReselect",
      "organizerVideoStart", "organizerVideoEnd", "organizerVideoStartRange",
      "organizerVideoEndRange", "organizerVideoDuration", "organizerVideoFps",
      "organizerVideoFpsNumber", "organizerVideoEstimate", "organizerVideoStatus",
      "organizerVideoCancel", "organizerVideoExtract",
      "organizerDeleteSelected", "organizerDeleteExcluded", "organizerThreshold",
      "organizerThresholdValue", "organizerFindJump", "organizerFindDuplicate",
      "organizerFindLoop", "organizerReset", "organizerAddAssets", "organizerApply", "organizerGrid",
      "organizerStatus", "organizerCount", "organizerSelection", "organizerPreview",
      "organizerSpeed", "organizerTag", "organizerApplyTag", "organizerClearTag",
      "organizerViewOriginal", "organizerViewEdited",
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
    const state = {
      language: hooks.getLanguage?.() === "en" ? "en" : "zh",
      mode: "edit",
      frames: [],
      anchorIndex: -1,
      previewIndex: 0,
      previewTimer: 0,
      viewMode: "edited",
      busy: false,
      animationName: "",
      videoUrl: "",
      videoFileName: "",
      videoDuration: 0,
      videoWidth: 0,
      videoHeight: 0,
      videoExtracting: false,
      returnFocus: null,
      deletedFramesSnapshot: null,
      confirmResolver: null,
      loopStage: "params",
      loopPreference: "auto",
      loopCandidates: [],
      loopCandidateIndex: -1,
      loopPreviewIndex: 0,
      loopTimer: 0,
      loopSearchToken: 0,
      loopCancelled: false,
      loopSourceEntries: [],
    };

    /**
     * Translates a UI key.
     * @param {string} key Translation key.
     * @param {Record<string,string|number>} variables Interpolation variables.
     * @returns {string}
     */
    function text(key, variables = {}) {
      const template = TEXT[state.language]?.[key] || TEXT.zh[key] || key;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) => variables[name] ?? "");
    }

    /**
     * Keeps a numeric value inside an inclusive range.
     * @param {number} value Candidate value.
     * @param {number} minimum Inclusive minimum.
     * @param {number} maximum Inclusive maximum.
     * @returns {number}
     */
    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, Number(value || 0)));
    }

    /**
     * Formats seconds as a compact minute timestamp.
     * @param {number} seconds Time in seconds.
     * @returns {string}
     */
    function formatVideoTime(seconds) {
      const safeSeconds = Math.max(0, Number(seconds || 0));
      const minutes = Math.floor(safeSeconds / 60);
      const remainder = safeSeconds - minutes * 60;
      return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
    }

    /**
     * Returns selected frame records.
     * @returns {object[]}
     */
    function selectedFrames() {
      return state.frames.filter((frame) => frame.selected);
    }

    /**
     * Returns frames included in the active workset.
     * @returns {object[]}
     */
    function includedFrames() {
      return state.frames.filter((frame) => frame.included);
    }

    /**
     * Publishes a status message to both organizer and host.
     * @param {string} message Status text.
     * @param {"idle"|"success"|"error"|"busy"} tone Visual tone.
     * @returns {void}
     */
    function setStatus(message, tone = "idle") {
      elements.organizerStatus.textContent = message;
      elements.organizerStatus.dataset.tone = tone;
      hooks.onStatus?.(message);
    }

    /**
     * Resolves and closes the organizer confirmation layer.
     * @param {boolean} accepted Whether the user accepted the operation.
     * @returns {void}
     */
    function resolveConfirmation(accepted) {
      if (elements.organizerConfirmPanel.hidden) return;
      elements.organizerConfirmPanel.hidden = true;
      const resolver = state.confirmResolver;
      state.confirmResolver = null;
      resolver?.(Boolean(accepted));
      elements.organizerApply.focus();
    }

    /**
     * Opens an application-styled confirmation layer.
     * @param {string} message Confirmation message.
     * @param {Array<[string,string|number]>} details Operation details.
     * @returns {Promise<boolean>}
     */
    function requestConfirmation(message, details = []) {
      elements.organizerConfirmMessage.textContent = message;
      elements.organizerConfirmDetails.replaceChildren();
      details.forEach(([label, value]) => {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = String(value);
        elements.organizerConfirmDetails.append(term, description);
      });
      elements.organizerConfirmPanel.hidden = false;
      elements.organizerConfirmAccept.focus();
      return new Promise((resolve) => { state.confirmResolver = resolve; });
    }

    /**
     * Stores a reversible frame deletion snapshot and exposes its undo action.
     * @param {object[]} frames Previous frame list.
     * @returns {void}
     */
    function offerDeleteUndo(frames) {
      state.deletedFramesSnapshot = frames;
      elements.organizerUndoDelete.hidden = false;
    }

    /**
     * Keeps keyboard focus inside the active organizer layer.
     * @param {KeyboardEvent} event Keyboard event.
     * @param {HTMLElement} container Active modal container.
     * @returns {void}
     */
    function trapFocus(event, container) {
      if (event.key !== "Tab") return;
      const focusable = Array.from(container.querySelectorAll(
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
     * Makes the main editor inert while the organizer owns interaction.
     * @param {boolean} inert Whether background interaction is disabled.
     * @returns {void}
     */
    function setEditorInert(inert) {
      const app = document.querySelector(".app");
      if (app) app.inert = Boolean(inert);
    }

    /**
     * Shows the project-name field only when a new local project is selected.
     * @returns {void}
     */
    function syncImportProjectField() {
      const creatingProject = elements.organizerProjectSelect.value === "__new__";
      elements.organizerProjectNameField.hidden = !creatingProject;
      elements.organizerProjectName.required = creatingProject;
    }

    /**
     * Populates import defaults from the host's active project.
     * @param {boolean} resetValues Whether editable defaults should be reset.
     * @returns {void}
     */
    function renderImportContext(resetValues = false) {
      const context = hooks.getImportContext?.() || {};
      const activeProject = context.activeProject || null;
      const selectedValue = elements.organizerProjectSelect.value;
      elements.organizerProjectSelect.innerHTML = "";
      if (activeProject?.id) {
        const currentOption = document.createElement("option");
        currentOption.value = String(activeProject.id);
        currentOption.textContent = text("importProjectCurrent", {
          name: activeProject.label || activeProject.id,
        });
        elements.organizerProjectSelect.appendChild(currentOption);
      }
      const newOption = document.createElement("option");
      newOption.value = "__new__";
      newOption.textContent = text("importProjectNew");
      elements.organizerProjectSelect.appendChild(newOption);
      const nextProjectValue = resetValues
        ? (activeProject?.id ? String(activeProject.id) : "__new__")
        : selectedValue;
      elements.organizerProjectSelect.value = Array.from(elements.organizerProjectSelect.options)
        .some((option) => option.value === nextProjectValue)
        ? nextProjectValue
        : (activeProject?.id ? String(activeProject.id) : "__new__");
      if (resetValues) {
        const defaultProfile = Array.isArray(context.profiles) ? context.profiles[0] : null;
        elements.organizerProjectName.value = state.language === "en" ? "Animation Project" : "动画项目";
        elements.organizerProfileName.value = String(defaultProfile?.label || defaultProfile?.id || "character");
        elements.organizerAnimationName.value = "idle";
        elements.organizerImportFps.value = "12";
        elements.organizerAnimationType.value = String(defaultProfile?.kind || "actor") === "boss" ? "boss" : "actor";
      }
      syncImportProjectField();
    }

    /**
     * Collects and validates metadata for a new animation import.
     * @returns {object}
     */
    function importMetadata() {
      const creatingProject = elements.organizerProjectSelect.value === "__new__";
      const metadata = {
        projectId: creatingProject ? "" : elements.organizerProjectSelect.value,
        projectLabel: elements.organizerProjectName.value.trim(),
        profileLabel: elements.organizerProfileName.value.trim(),
        animationName: elements.organizerAnimationName.value.trim(),
        fps: clamp(Math.round(elements.organizerImportFps.value), 1, 120),
        animationType: elements.organizerAnimationType.value,
        profileKind: elements.organizerAnimationType.value === "boss" ? "boss" : "actor",
        anchorMode: "canvas_bottom_center",
      };
      if ((creatingProject && !metadata.projectLabel) || !metadata.profileLabel || !metadata.animationName) {
        throw new Error(text("importMissingMetadata"));
      }
      return metadata;
    }

    /**
     * Applies localized labels to organizer nodes.
     * @returns {void}
     */
    function renderLanguage() {
      document.querySelectorAll("[data-organizer-i18n]").forEach((node) => {
        node.textContent = text(node.dataset.organizerI18n);
      });
      elements.organizerClose.setAttribute("aria-label", text("close"));
      elements.organizerVideoClose.setAttribute("aria-label", text("close"));
      elements.organizerLoopClose.setAttribute("aria-label", text("close"));
      elements.organizerTag.placeholder = text("tagPlaceholder");
      elements.organizerTitle.textContent = text(state.mode === "import" ? "importTitle" : "title");
      elements.organizerSubtitle.textContent = text(state.mode === "import" ? "importSubtitle" : "subtitle");
      elements.organizerApply.textContent = text(state.mode === "import" ? "create" : "apply");
      elements.organizerReset.textContent = text(state.mode === "import" ? "clearWorkset" : "reset");
      elements.organizerImportSetup.hidden = state.mode !== "import";
      elements.organizerImportSetup.closest(".organizerWorkbench")?.classList.toggle("importMode", state.mode === "import");
      if (state.mode === "import") renderImportContext(false);
      renderCounts();
    }

    /**
     * Converts an image to a reusable source canvas.
     * @param {CanvasImageSource} image Image source.
     * @returns {HTMLCanvasElement}
     */
    function imageCanvas(image) {
      const canvas = document.createElement("canvas");
      canvas.width = Number(image.naturalWidth || image.width || 1);
      canvas.height = Number(image.naturalHeight || image.height || 1);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    /**
     * Creates one organizer frame record.
     * @param {CanvasImageSource} image Source image.
     * @param {{sourceIndex?:number,originalIndex?:number,sourcePath?:string,name?:string,imported?:boolean,reuseCanvas?:boolean}} options Frame metadata.
     * @returns {object}
     */
    function createFrame(image, options = {}) {
      const originalCanvas = options.reuseCanvas && image instanceof HTMLCanvasElement
        ? image
        : imageCanvas(image);
      return {
        uid: root.crypto?.randomUUID?.() || `frame_${Date.now()}_${Math.random()}`,
        sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : null,
        originalIndex: Number.isInteger(options.originalIndex) ? options.originalIndex : Number.MAX_SAFE_INTEGER,
        sourcePath: String(options.sourcePath || ""),
        name: String(options.name || "frame.png"),
        originalCanvas,
        editedCanvas: originalCanvas,
        included: true,
        selected: false,
        flipped: false,
        imported: Boolean(options.imported),
        tag: "",
        signature: null,
        thumbnails: { original: "", edited: "" },
      };
    }

    /**
     * Loads a local image file.
     * @param {File} file Local file.
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
     * Publishes a status inside the video importer.
     * @param {string} message Status message.
     * @param {"idle"|"success"|"error"|"busy"} tone Visual tone.
     * @returns {void}
     */
    function setVideoStatus(message, tone = "idle") {
      elements.organizerVideoStatus.textContent = message;
      elements.organizerVideoStatus.dataset.tone = tone;
    }

    /**
     * Returns normalized video extraction settings.
     * @returns {{start:number,end:number,fps:number,count:number,pixelCount:number}}
     */
    function videoSelection() {
      const duration = state.videoDuration;
      const start = clamp(elements.organizerVideoStart.value, 0, duration);
      const end = clamp(elements.organizerVideoEnd.value, 0, duration);
      const fps = clamp(Math.round(elements.organizerVideoFpsNumber.value), 1, 60);
      const count = end > start ? Math.max(1, Math.floor((end - start) * fps)) : 0;
      const outputScale = Math.min(1, 2048 / Math.max(state.videoWidth, state.videoHeight));
      const outputWidth = Math.max(1, Math.round(state.videoWidth * outputScale));
      const outputHeight = Math.max(1, Math.round(state.videoHeight * outputScale));
      return {
        start,
        end,
        fps,
        count,
        pixelCount: count * outputWidth * outputHeight,
      };
    }

    /**
     * Synchronizes video time/FPS controls and extraction limits.
     * @param {"start"|"end"|"fps"|""} changedControl Last edited control.
     * @returns {void}
     */
    function syncVideoControls(changedControl = "") {
      if (!state.videoDuration) {
        elements.organizerVideoEstimate.textContent = "0";
        elements.organizerVideoExtract.disabled = true;
        return;
      }
      let start = clamp(elements.organizerVideoStart.value, 0, state.videoDuration);
      let end = clamp(elements.organizerVideoEnd.value, 0, state.videoDuration);
      if (start > end) {
        if (changedControl === "start") end = start;
        else start = end;
      }
      const fps = clamp(Math.round(elements.organizerVideoFpsNumber.value), 1, 60);
      elements.organizerVideoStart.value = start.toFixed(2);
      elements.organizerVideoEnd.value = end.toFixed(2);
      elements.organizerVideoStartRange.value = String(start);
      elements.organizerVideoEndRange.value = String(end);
      elements.organizerVideoFps.value = String(fps);
      elements.organizerVideoFpsNumber.value = String(fps);
      const selection = videoSelection();
      elements.organizerVideoDuration.textContent = `${formatVideoTime(selection.start)} → ${formatVideoTime(selection.end)}`;
      elements.organizerVideoEstimate.textContent = String(selection.count);
      elements.organizerVideoEstimate.parentElement.classList.toggle(
        "overLimit",
        selection.count > 300 || selection.pixelCount > 120_000_000,
      );
      const invalidRange = selection.end <= selection.start;
      const tooMany = selection.count > 300;
      const tooLarge = selection.pixelCount > 120_000_000;
      elements.organizerVideoExtract.disabled = invalidRange || tooMany || tooLarge || state.videoExtracting;
      if (state.videoExtracting) return;
      if (invalidRange) setVideoStatus(text("videoInvalidRange"), "error");
      else if (tooMany) setVideoStatus(text("videoTooMany", { count: selection.count }), "error");
      else if (tooLarge) setVideoStatus(text("videoMemoryLimit"), "error");
      else setVideoStatus(text("videoLoaded"), "success");
    }

    /**
     * Releases the selected video and closes the extraction panel.
     * @returns {void}
     */
    function closeVideoImporter(force = false) {
      if (state.videoExtracting && !force) return;
      elements.organizerVideoElement.pause();
      elements.organizerVideoElement.removeAttribute("src");
      elements.organizerVideoElement.load();
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
      state.videoUrl = "";
      state.videoFileName = "";
      state.videoDuration = 0;
      state.videoWidth = 0;
      state.videoHeight = 0;
      elements.organizerVideoInput.value = "";
      elements.organizerVideoName.textContent = text("videoNoFile");
      elements.organizerVideoMeta.textContent = "—";
      elements.organizerVideoPanel.hidden = true;
      elements.organizerVideoExtract.disabled = true;
    }

    /**
     * Loads a local browser-decodable video into the extraction panel.
     * @param {File} file Local video file.
     * @returns {Promise<void>}
     */
    async function loadVideoFile(file) {
      if (!file || !(
        String(file.type || "").startsWith("video/")
        || /\.(mp4|webm|mov|m4v)$/i.test(file.name || "")
      )) {
        setStatus(text("videoUnsupported"), "error");
        return;
      }
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
      state.videoUrl = URL.createObjectURL(file);
      state.videoFileName = file.name;
      elements.organizerVideoPanel.hidden = false;
      elements.organizerVideoName.textContent = file.name;
      elements.organizerVideoMeta.textContent = "…";
      elements.organizerVideoElement.src = state.videoUrl;
      setVideoStatus(text("videoLoading"), "busy");
      try {
        await new Promise((resolve, reject) => {
          const video = elements.organizerVideoElement;
          const handleLoaded = () => {
            cleanup();
            resolve();
          };
          const handleError = () => {
            cleanup();
            reject(new Error(text("videoUnsupported")));
          };
          const cleanup = () => {
            video.removeEventListener("loadeddata", handleLoaded);
            video.removeEventListener("error", handleError);
          };
          video.addEventListener("loadeddata", handleLoaded, { once: true });
          video.addEventListener("error", handleError, { once: true });
          video.load();
        });
        const video = elements.organizerVideoElement;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
          throw new Error(text("videoUnsupported"));
        }
        state.videoDuration = video.duration;
        state.videoWidth = video.videoWidth;
        state.videoHeight = video.videoHeight;
        for (const input of [
          elements.organizerVideoStart,
          elements.organizerVideoEnd,
          elements.organizerVideoStartRange,
          elements.organizerVideoEndRange,
        ]) {
          input.max = String(video.duration);
        }
        elements.organizerVideoStart.value = "0";
        elements.organizerVideoEnd.value = video.duration.toFixed(2);
        elements.organizerVideoStartRange.value = "0";
        elements.organizerVideoEndRange.value = String(video.duration);
        elements.organizerVideoMeta.textContent = `${video.videoWidth}×${video.videoHeight} · ${formatVideoTime(video.duration)}`;
        syncVideoControls();
      } catch (error) {
        elements.organizerVideoExtract.disabled = true;
        setVideoStatus(error.message || text("videoUnsupported"), "error");
      }
    }

    /**
     * Seeks the selected video and resolves after a decoded frame is ready.
     * @param {number} time Target time in seconds.
     * @returns {Promise<void>}
     */
    function seekVideoFrame(time) {
      const video = elements.organizerVideoElement;
      const target = clamp(time, 0, Math.max(0, state.videoDuration - 0.001));
      if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("Video seek timed out."));
        }, 10000);
        const handleSeeked = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error(text("videoUnsupported")));
        };
        const cleanup = () => {
          window.clearTimeout(timeout);
          video.removeEventListener("seeked", handleSeeked);
          video.removeEventListener("error", handleError);
        };
        video.addEventListener("seeked", handleSeeked, { once: true });
        video.addEventListener("error", handleError, { once: true });
        video.currentTime = target;
      });
    }

    /**
     * Extracts the configured video segment into imported workset frames.
     * @returns {Promise<void>}
     */
    async function extractVideoFrames() {
      const selection = videoSelection();
      if (!selection.count || selection.end <= selection.start) {
        setVideoStatus(text("videoInvalidRange"), "error");
        return;
      }
      if (selection.count > 300) {
        setVideoStatus(text("videoTooMany", { count: selection.count }), "error");
        return;
      }
      if (selection.pixelCount > 120_000_000) {
        setVideoStatus(text("videoMemoryLimit"), "error");
        return;
      }
      state.busy = true;
      state.videoExtracting = true;
      renderCounts();
      syncVideoControls();
      elements.organizerVideoElement.pause();
      const extractedFrames = [];
      const baseName = state.videoFileName.replace(/\.[^.]+$/, "") || "video";
      const scale = Math.min(1, 2048 / Math.max(state.videoWidth, state.videoHeight));
      const frameWidth = Math.max(1, Math.round(state.videoWidth * scale));
      const frameHeight = Math.max(1, Math.round(state.videoHeight * scale));
      try {
        for (let index = 0; index < selection.count; index += 1) {
          setVideoStatus(text("videoExtracting", { current: index + 1, total: selection.count }), "busy");
          const time = Math.min(selection.end - 0.001, selection.start + index / selection.fps);
          await seekVideoFrame(time);
          const canvas = document.createElement("canvas");
          canvas.width = frameWidth;
          canvas.height = frameHeight;
          const context = canvas.getContext("2d", { alpha: true });
          context.drawImage(elements.organizerVideoElement, 0, 0, frameWidth, frameHeight);
          extractedFrames.push(createFrame(canvas, {
            originalIndex: Number.MAX_SAFE_INTEGER - selection.count + index,
            name: `${baseName}_frame_${String(index + 1).padStart(4, "0")}.png`,
            imported: true,
            reuseCanvas: true,
          }));
          if (index % 4 === 3) await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        state.frames.push(...extractedFrames);
        renderGrid();
        restartPreview();
        closeVideoImporter(true);
        setStatus(text("videoImported", { count: extractedFrames.length }), "success");
      } catch (error) {
        setVideoStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.videoExtracting = false;
        state.busy = false;
        renderCounts();
        syncVideoControls();
      }
    }

    /**
     * Returns or creates the reference 256×256 RGBA analysis sample.
     * Canvas performs the same browser-native resampling used by the reference client.
     * @param {object} frame Organizer frame.
     * @returns {{data:Uint8ClampedArray,width:number,height:number}}
     */
    function frameSignature(frame) {
      if (frame.signature) return frame.signature;
      const sampleSize = core.REFERENCE_SAMPLE_SIZE || 256;
      const canvas = document.createElement("canvas");
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      context.clearRect(0, 0, sampleSize, sampleSize);
      context.drawImage(frame.editedCanvas, 0, 0, sampleSize, sampleSize);
      const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
      frame.signature = core.createSignature(imageData.data, imageData.width, imageData.height);
      return frame.signature;
    }

    /**
     * Updates workset and selection counts.
     * @returns {void}
     */
    function renderCounts() {
      const included = includedFrames().length;
      const selected = selectedFrames().length;
      const animation = hooks.getCurrentAnimation?.();
      elements.organizerCount.textContent = text("workset", { included, total: state.frames.length });
      elements.organizerSelection.textContent = text("selected", { count: selected });
      elements.organizerApply.disabled = !included
        || state.busy
        || (state.mode === "edit" && !animation?.frames?.length);
      elements.organizerDeleteSelected.disabled = !selected || state.busy;
      elements.organizerFlip.disabled = (!selected && !included) || state.busy;
      elements.organizerDeleteExcluded.disabled = included === state.frames.length || state.busy;
      elements.organizerImport.disabled = state.busy;
      elements.organizerImportVideo.disabled = state.busy;
      elements.organizerAddAssets.hidden = state.mode !== "import";
      elements.organizerAddAssets.disabled = state.mode !== "import"
        || !included
        || state.busy
        || !animation?.frames?.length
        || typeof hooks.addAssets !== "function";
      elements.organizerReduce.disabled = !included || state.busy;
      elements.organizerFindJump.disabled = included < 3 || state.busy;
      elements.organizerFindDuplicate.disabled = included < 3 || state.busy;
      elements.organizerFindLoop.disabled = included < 4 || state.busy;
    }

    /**
     * Chooses frames while respecting platform selection modifiers.
     * @param {number} index Frame index.
     * @param {MouseEvent} event Click event.
     * @returns {void}
     */
    function selectFrame(index, event) {
      if (event.shiftKey && state.anchorIndex >= 0) {
        const start = Math.min(index, state.anchorIndex);
        const end = Math.max(index, state.anchorIndex);
        state.frames.forEach((frame, cursor) => { frame.selected = cursor >= start && cursor <= end; });
      } else if (event.metaKey || event.ctrlKey) {
        state.frames[index].selected = !state.frames[index].selected;
        state.anchorIndex = index;
      } else {
        state.frames.forEach((frame, cursor) => { frame.selected = cursor === index; });
        state.anchorIndex = index;
      }
      state.previewIndex = index;
      renderGrid();
      renderPreview();
    }

    /**
     * Returns a cached PNG thumbnail for one organizer frame.
     * @param {object} frame Organizer frame.
     * @returns {string}
     */
    function frameThumbnail(frame) {
      const cacheKey = state.viewMode === "original" ? "original" : "edited";
      if (!frame.thumbnails[cacheKey]) {
        const canvas = cacheKey === "original" ? frame.originalCanvas : frame.editedCanvas;
        frame.thumbnails[cacheKey] = canvas.toDataURL("image/png");
      }
      return frame.thumbnails[cacheKey];
    }

    /**
     * Creates one reusable organizer frame card.
     * @param {object} frame Organizer frame.
     * @returns {HTMLDivElement}
     */
    function createFrameCard(frame) {
        const card = document.createElement("div");
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.dataset.frameUid = frame.uid;
        card.innerHTML = `
          <span class="organizerFrameNumber"></span>
          <img alt="">
          <span class="organizerFrameName"></span>
          <span class="organizerFrameTag"></span>
          <input type="checkbox" aria-label="workset">
          <button type="button" class="organizerFrameCutout" aria-label="${text("editCutout")}" title="${text("editCutout")}">✎</button>
        `;
        card.querySelector("input").addEventListener("click", (event) => {
          event.stopPropagation();
          const currentFrame = state.frames.find((entry) => entry.uid === card.dataset.frameUid);
          if (!currentFrame) return;
          currentFrame.included = event.currentTarget.checked;
          renderCounts();
          restartPreview();
        });
        card.querySelector(".organizerFrameCutout").addEventListener("click", (event) => {
          event.stopPropagation();
          const currentFrame = state.frames.find((entry) => entry.uid === card.dataset.frameUid);
          if (!currentFrame) return;
          editImportCutout(currentFrame).catch((error) => {
            setStatus(text("failed", { message: error.message }), "error");
          });
        });
        card.addEventListener("click", (event) => {
          const index = state.frames.findIndex((entry) => entry.uid === card.dataset.frameUid);
          if (index >= 0) selectFrame(index, event);
        });
        card.addEventListener("keydown", (event) => {
          if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          const index = state.frames.findIndex((entry) => entry.uid === card.dataset.frameUid);
          if (index >= 0) selectFrame(index, event);
        });
        return card;
    }

    /**
     * Renders frame cards while reusing nodes and cached thumbnails.
     * @returns {void}
     */
    function renderGrid() {
      const existingCards = new Map(Array.from(elements.organizerGrid.children)
        .map((card) => [card.dataset.frameUid, card]));
      const fragment = document.createDocumentFragment();
      state.frames.forEach((frame, index) => {
        const card = existingCards.get(frame.uid) || createFrameCard(frame);
        card.className = `organizerFrame ${frame.selected ? "selected" : ""} ${frame.included ? "included" : "excluded"}`;
        card.querySelector(".organizerFrameNumber").textContent = String(index + 1).padStart(3, "0");
        card.querySelector(".organizerFrameName").textContent = frame.name;
        card.querySelector(".organizerFrameTag").textContent = frame.tag;
        card.querySelector("input").checked = frame.included;
        const image = card.querySelector("img");
        const thumbnail = frameThumbnail(frame);
        if (image.src !== thumbnail) image.src = thumbnail;
        const cutoutButton = card.querySelector(".organizerFrameCutout");
        cutoutButton.hidden = false;
        cutoutButton.disabled = state.busy;
        cutoutButton.setAttribute("aria-label", text("editCutout"));
        cutoutButton.title = text("editCutout");
        fragment.appendChild(card);
      });
      elements.organizerGrid.replaceChildren(fragment);
      renderCounts();
    }

    /**
     * Draws one organizer frame into a responsive preview canvas.
     * @param {object|null} frame Frame record to draw.
     * @param {HTMLCanvasElement} canvas Target canvas.
     * @returns {void}
     */
    function drawFrameToCanvas(frame, canvas) {
      const context = canvas.getContext("2d");
      // clientWidth/clientHeight exclude borders. Feeding the border-box size back
      // into a content-box canvas on every animation frame makes it grow forever.
      canvas.width = Math.max(320, Math.round(canvas.clientWidth || 480));
      canvas.height = Math.max(260, Math.round(canvas.clientHeight || 420));
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!frame) return;
      const source = state.viewMode === "original" ? frame.originalCanvas : frame.editedCanvas;
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      context.imageSmoothingEnabled = false;
      context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    }

    /**
     * Draws the currently previewed organizer frame.
     * @returns {void}
     */
    function renderPreview() {
      const frames = includedFrames();
      const frame = frames.length
        ? frames[state.previewIndex % frames.length]
        : null;
      drawFrameToCanvas(frame, elements.organizerPreview);
    }

    /**
     * Converts a left-to-right speed control value into a frame delay.
     * @param {HTMLInputElement} input Playback speed control.
     * @returns {number} Delay between frames in milliseconds.
     */
    function playbackDelay(input) {
      const minimum = Number(input.min || 40);
      const maximum = Number(input.max || 600);
      const speed = clamp(Number(input.value || maximum), minimum, maximum);
      return Math.max(40, minimum + maximum - speed);
    }

    /**
     * Schedules the next workset preview frame using the latest speed value.
     * @returns {void}
     */
    function schedulePreviewFrame() {
      window.clearTimeout(state.previewTimer);
      state.previewTimer = window.setTimeout(() => {
        const frames = includedFrames();
        if (frames.length && !elements.organizerModal.hidden) {
          state.previewIndex = (state.previewIndex + 1) % frames.length;
          renderPreview();
        }
        schedulePreviewFrame();
      }, playbackDelay(elements.organizerSpeed));
    }

    /**
     * Restarts the workset animation preview timer.
     * @returns {void}
     */
    function restartPreview() {
      window.clearTimeout(state.previewTimer);
      state.previewIndex = 0;
      renderPreview();
      schedulePreviewFrame();
    }

    /**
     * Reloads organizer state from the current host animation.
     * @returns {Promise<void>}
     */
    async function loadCurrentAnimation() {
      const animation = hooks.getCurrentAnimation?.();
      if (!animation?.frames?.length || animation.images?.length !== animation.frames.length) {
        state.frames = [];
        state.animationName = "";
        renderGrid();
        renderPreview();
        setStatus(text("noGroup"), "error");
        return;
      }
      state.frames = animation.frames.map((frame, index) => createFrame(animation.images[index], {
        sourceIndex: index,
        originalIndex: index,
        sourcePath: frame.path,
        name: frame.name,
      }));
      state.animationName = animation.name;
      state.anchorIndex = -1;
      state.previewIndex = 0;
      renderGrid();
      restartPreview();
      setStatus(text("loaded", { name: animation.name, count: state.frames.length }), "success");
    }

    /**
     * Selects frame indexes returned by an analysis operation.
     * @param {number[]} indexes Frame indexes.
     * @returns {void}
     */
    function selectIndexes(indexes) {
      const selected = new Set(indexes);
      state.frames.forEach((frame, index) => { frame.selected = selected.has(index); });
      state.anchorIndex = indexes[0] ?? -1;
      renderGrid();
    }

    /**
     * Returns the active loop candidate.
     * @returns {object|null}
     */
    function currentLoopCandidate() {
      return state.loopCandidates[state.loopCandidateIndex] || null;
    }

    /**
     * Resolves source frames contained by the active loop candidate.
     * @returns {object[]}
     */
    function currentLoopFrames() {
      const candidate = currentLoopCandidate();
      if (!candidate) return [];
      return state.loopSourceEntries
        .slice(candidate.start, candidate.end + 1)
        .map((entry) => entry.frame);
    }

    /**
     * Stops loop-candidate playback.
     * @returns {void}
     */
    function stopLoopPlayback() {
      window.clearTimeout(state.loopTimer);
      state.loopTimer = 0;
      elements.organizerLoopPlay.textContent = text("loopPlay");
    }

    /**
     * Draws the current frame of the selected loop candidate.
     * @returns {void}
     */
    function renderLoopPreview() {
      const frames = currentLoopFrames();
      if (!frames.length) {
        drawFrameToCanvas(null, elements.organizerLoopCanvas);
        elements.organizerLoopFrameInput.value = "1";
        elements.organizerLoopFrameTotal.textContent = "/ 0";
        elements.organizerLoopFrameRange.max = "1";
        elements.organizerLoopFrameRange.value = "1";
        return;
      }
      state.loopPreviewIndex = ((state.loopPreviewIndex % frames.length) + frames.length) % frames.length;
      const displayIndex = state.loopPreviewIndex + 1;
      drawFrameToCanvas(frames[state.loopPreviewIndex], elements.organizerLoopCanvas);
      elements.organizerLoopFrameInput.max = String(frames.length);
      elements.organizerLoopFrameInput.value = String(displayIndex);
      elements.organizerLoopFrameTotal.textContent = `/ ${frames.length}`;
      elements.organizerLoopFrameRange.max = String(frames.length);
      elements.organizerLoopFrameRange.value = String(displayIndex);
    }

    /**
     * Selects a loop-preview frame by zero-based index.
     * @param {number} index Candidate-local frame index.
     * @returns {void}
     */
    function setLoopPreviewIndex(index) {
      const frames = currentLoopFrames();
      if (!frames.length) return;
      state.loopPreviewIndex = ((Math.round(index) % frames.length) + frames.length) % frames.length;
      renderLoopPreview();
    }

    /**
     * Starts looping the selected candidate.
     * @returns {void}
     */
    function startLoopPlayback() {
      stopLoopPlayback();
      if (!currentLoopFrames().length) return;
      elements.organizerLoopPlay.textContent = text("loopPause");
      const scheduleNextFrame = () => {
        state.loopTimer = window.setTimeout(() => {
          if (!state.loopTimer) return;
          setLoopPreviewIndex(state.loopPreviewIndex + 1);
          scheduleNextFrame();
        }, playbackDelay(elements.organizerLoopSpeed));
      };
      scheduleNextFrame();
    }

    /**
     * Selects and previews one ranked loop candidate.
     * @param {number} candidateIndex Candidate list index.
     * @returns {void}
     */
    function selectLoopCandidate(candidateIndex) {
      const candidate = state.loopCandidates[candidateIndex];
      if (!candidate) return;
      stopLoopPlayback();
      state.loopCandidateIndex = candidateIndex;
      state.loopPreviewIndex = 0;
      Array.from(elements.organizerLoopCandidates.children).forEach((button, index) => {
        button.classList.toggle("active", index === candidateIndex);
        button.setAttribute("aria-selected", String(index === candidateIndex));
      });
      selectIndexes(state.loopSourceEntries
        .slice(candidate.start, candidate.end + 1)
        .map((entry) => entry.index));
      window.requestAnimationFrame(renderLoopPreview);
    }

    /**
     * Renders ranked loop candidates and their empty state.
     * @returns {void}
     */
    function renderLoopCandidates() {
      elements.organizerLoopCandidates.replaceChildren();
      const hasCandidates = state.loopCandidates.length > 0;
      elements.organizerLoopEmpty.hidden = hasCandidates;
      elements.organizerLoopResultContent.hidden = !hasCandidates;
      elements.organizerLoopTrim.hidden = !hasCandidates;
      state.loopCandidates.forEach((candidate, index) => {
        const button = document.createElement("button");
        const period = document.createElement("strong");
        const title = document.createElement("span");
        const details = document.createElement("small");
        button.type = "button";
        button.className = "organizerLoopCandidate";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        period.textContent = String(candidate.period).padStart(2, "0");
        title.textContent = text("loopCandidatePeriod", { period: candidate.period });
        details.textContent = `${text("loopCandidateRange", {
          start: candidate.start + 1,
          end: candidate.end + 1,
          count: candidate.length,
        })} · ${text("loopCandidateMetrics", {
          smoothness: Math.round(candidate.smoothness * 100),
          coverage: Math.round(candidate.coverage * 100),
        })}`;
        button.append(period, title, details);
        button.addEventListener("click", () => selectLoopCandidate(index));
        elements.organizerLoopCandidates.appendChild(button);
      });
      if (hasCandidates) selectLoopCandidate(0);
      else renderLoopPreview();
    }

    /**
     * Switches the loop finder between parameters, search, and result stages.
     * @param {"params"|"search"|"results"} stage Stage identifier.
     * @returns {void}
     */
    function setLoopStage(stage) {
      state.loopStage = stage;
      elements.organizerLoopParams.hidden = stage !== "params";
      elements.organizerLoopSearch.hidden = stage !== "search";
      elements.organizerLoopResults.hidden = stage !== "results";
      elements.organizerLoopCancel.hidden = stage === "results";
      elements.organizerLoopRetry.hidden = stage !== "results";
      elements.organizerLoopStartSearch.hidden = stage !== "params";
      elements.organizerLoopTrim.hidden = stage !== "results" || !currentLoopCandidate();
    }

    /**
     * Updates visible loop-search progress.
     * @param {number} current Completed work units.
     * @param {number} total Total work units.
     * @returns {void}
     */
    function renderLoopProgress(current, total) {
      const frameCount = Math.max(1, state.loopSourceEntries.length);
      const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      elements.organizerLoopProgressBar.style.width = `${percentage}%`;
      elements.organizerLoopProgressText.textContent = `${percentage}%`;
      if (current <= frameCount) {
        elements.organizerLoopSearchLabel.textContent = text("loopDecoding", {
          current: Math.min(frameCount, current),
          total: frameCount,
        });
      } else if (current < frameCount * 2) {
        elements.organizerLoopSearchLabel.textContent = text("loopComparing", {
          current: Math.min(frameCount, current - frameCount),
          total: frameCount,
        });
      } else {
        elements.organizerLoopSearchLabel.textContent = text("loopRanking");
      }
    }

    /**
     * Opens the loop-finder parameter dialog.
     * @returns {void}
     */
    function openLoopFinder() {
      const count = includedFrames().length;
      if (count < 4) {
        setStatus(text("loopNeedFrames"), "error");
        return;
      }
      stopLoopPlayback();
      state.loopSearchToken += 1;
      state.loopCancelled = false;
      state.loopPreference = "auto";
      state.loopCandidates = [];
      state.loopCandidateIndex = -1;
      state.loopSourceEntries = [];
      elements.organizerLoopStartAuto.checked = true;
      elements.organizerLoopStartCustom.checked = false;
      elements.organizerLoopStartRow.hidden = true;
      elements.organizerLoopStartInput.value = "1";
      elements.organizerLoopStartInput.max = String(count);
      Array.from(elements.organizerLoopPreference.children).forEach((button) => {
        button.classList.toggle("active", button.dataset.loopPreference === "auto");
      });
      renderLoopProgress(0, count * 3);
      setLoopStage("params");
      elements.organizerLoopPanel.hidden = false;
      elements.organizerLoopStartSearch.focus();
    }

    /**
     * Cancels work and closes the loop finder.
     * @returns {void}
     */
    function closeLoopFinder() {
      state.loopCancelled = true;
      state.loopSearchToken += 1;
      state.busy = false;
      stopLoopPlayback();
      elements.organizerLoopPanel.hidden = true;
      renderCounts();
      elements.organizerFindLoop.focus({ preventScroll: true });
    }

    /**
     * Runs cancellable loop analysis with self-similarity progress.
     * @returns {Promise<void>}
     */
    async function startLoopSearch() {
      const sourceEntries = state.frames
        .map((frame, index) => ({ frame, index }))
        .filter((entry) => entry.frame.included);
      if (sourceEntries.length < 4) {
        setStatus(text("loopNeedFrames"), "error");
        return;
      }
      const searchToken = state.loopSearchToken + 1;
      state.loopSearchToken = searchToken;
      state.loopCancelled = false;
      state.loopSourceEntries = sourceEntries;
      state.busy = true;
      renderCounts();
      setLoopStage("search");
      renderLoopProgress(0, sourceEntries.length * 3);
      try {
        const signatures = [];
        for (let index = 0; index < sourceEntries.length; index += 1) {
          if (state.loopCancelled || searchToken !== state.loopSearchToken) return;
          signatures.push(frameSignature(sourceEntries[index].frame));
          renderLoopProgress(index + 1, sourceEntries.length * 3);
          if (index % 4 === 3) await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        const customStart = elements.organizerLoopStartCustom.checked;
        const startFrame = clamp(
          Math.round(elements.organizerLoopStartInput.value || 1),
          1,
          sourceEntries.length,
        );
        elements.organizerLoopStartInput.value = String(startFrame);
        const candidates = await core.findLoopCandidatesAsync(signatures, {
          minPeriod: 2,
          maxPeriod: Math.max(2, Math.floor((2 * signatures.length) / 3)),
          startFrame: customStart ? startFrame - 1 : 0,
          preference: state.loopPreference,
          boundaryFactor: 0.85,
        }, {
          onProgress: renderLoopProgress,
          isCancelled: () => state.loopCancelled || searchToken !== state.loopSearchToken,
        });
        if (state.loopCancelled || searchToken !== state.loopSearchToken) return;
        state.loopCandidates = candidates;
        state.loopCandidateIndex = -1;
        setLoopStage("results");
        renderLoopCandidates();
      } catch (error) {
        if (searchToken !== state.loopSearchToken) return;
        setLoopStage("params");
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        if (searchToken === state.loopSearchToken) {
          state.busy = false;
          renderCounts();
        }
      }
    }

    /**
     * Keeps only the selected loop candidate in the workset.
     * @returns {void}
     */
    function trimToLoopCandidate() {
      const candidate = currentLoopCandidate();
      if (!candidate) return;
      const keptEntries = state.loopSourceEntries.slice(candidate.start, candidate.end + 1);
      const keptUids = new Set(keptEntries.map((entry) => entry.frame.uid));
      state.frames.forEach((frame) => { frame.included = keptUids.has(frame.uid); });
      selectIndexes(keptEntries.map((entry) => entry.index));
      restartPreview();
      closeLoopFinder();
      setStatus(text("loopTrimmed", {
        start: candidate.start + 1,
        end: candidate.end + 1,
        count: keptEntries.length,
      }), "success");
    }

    /**
     * Runs jump or duplicate analysis against currently included frames.
     * @param {"jump"|"duplicate"} type Analysis type.
     * @returns {void}
     */
    function analyze(type) {
      const included = state.frames
        .map((frame, index) => ({ frame, index }))
        .filter((entry) => entry.frame.included);
      const signatures = included.map((entry) => frameSignature(entry.frame));
      const threshold = Number(elements.organizerThreshold.value);
      if (type === "jump") {
        const result = core.analyzeJumpFrames(signatures, threshold);
        const { matches } = result;
        selectIndexes(matches.map((match) => included[match.index].index));
        if (result.autoAdjustedThreshold != null) {
          elements.organizerThreshold.value = String(result.autoAdjustedThreshold);
          elements.organizerThresholdValue.textContent = String(result.autoAdjustedThreshold);
        }
        const adjusted = result.autoAdjustedThreshold == null
          ? ""
          : ` · ${text("thresholdAdjusted", { threshold: result.autoAdjustedThreshold })}`;
        setStatus(matches.length ? `${text("foundJump", { count: matches.length })}${adjusted}` : text("noneFound"), matches.length ? "success" : "idle");
        return;
      }
      const result = core.analyzeDuplicateFrames(signatures, threshold);
      const { matches } = result;
      selectIndexes(matches.map((match) => included[match.index].index));
      if (result.autoAdjustedThreshold != null) {
        elements.organizerThreshold.value = String(result.autoAdjustedThreshold);
        elements.organizerThresholdValue.textContent = String(result.autoAdjustedThreshold);
      }
      const adjusted = result.autoAdjustedThreshold == null
        ? ""
        : ` · ${text("thresholdAdjusted", { threshold: result.autoAdjustedThreshold })}`;
      setStatus(matches.length ? `${text("foundDuplicate", { count: matches.length })}${adjusted}` : text("noneFound"), matches.length ? "success" : "idle");
    }

    /**
     * Mirrors selected frames or the entire workset when nothing is selected.
     * @returns {void}
     */
    function flipFrames() {
      const targets = selectedFrames().length ? selectedFrames() : includedFrames();
      targets.forEach((frame) => {
        const source = frame.editedCanvas;
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(source, 0, 0);
        frame.editedCanvas = canvas;
        frame.flipped = !frame.flipped;
        frame.signature = null;
        frame.thumbnails.edited = "";
      });
      renderGrid();
      renderPreview();
      setStatus(text("flipped", { count: targets.length }), "success");
    }

    /**
     * Imports local images at the end of the frame sequence.
     * @param {FileList|File[]} fileList Local files.
     * @returns {Promise<void>}
     */
    async function importFiles(fileList) {
      const files = Array.from(fileList || []).filter((file) => (
        String(file.type || "").startsWith("image/")
        || /\.(png|jpe?g|webp)$/i.test(file.name || "")
      ));
      if (!files.length) return;
      const images = await Promise.all(files.map(loadFileImage));
      images.forEach((image, index) => {
        state.frames.push(createFrame(image, {
          originalIndex: Number.MAX_SAFE_INTEGER - files.length + index,
          name: files[index].name,
          imported: true,
        }));
      });
      renderGrid();
      restartPreview();
      setStatus(text("imported", { count: files.length }), "success");
    }

    /**
     * Opens one workset frame in the cutout editor and writes its result back in place.
     * @param {object} targetFrame Organizer frame to edit.
     * @returns {Promise<void>}
     */
    async function editImportCutout(targetFrame) {
      if (!targetFrame || !state.frames.includes(targetFrame)) {
        setStatus(text("cutoutNeedFrames"), "error");
        return;
      }
      if (typeof hooks.editCutout !== "function") {
        setStatus(text("failed", { message: "Batch cutout is unavailable." }), "error");
        return;
      }
      const sourceFrames = [targetFrame];
      state.busy = true;
      renderCounts();
      window.clearTimeout(state.previewTimer);
      elements.organizerModal.hidden = true;
      document.body.classList.remove("organizerOpen");
      try {
        const outputs = await hooks.editCutout({
          name: elements.organizerAnimationName.value.trim() || "animation",
          items: sourceFrames.map((frame) => ({
            name: frame.name,
            image: frame.editedCanvas,
            frame: { uid: frame.uid },
          })),
        });
        if (!outputs) return;
        if (outputs.length !== sourceFrames.length) {
          throw new Error(`Expected ${sourceFrames.length} cutout frames, received ${outputs.length}.`);
        }
        const outputByUid = new Map(outputs
          .filter((output) => output?.frame?.uid)
          .map((output) => [output.frame.uid, output]));
        sourceFrames.forEach((frame, index) => {
          const output = outputByUid.get(frame.uid) || outputs[index];
          if (!output?.canvas) throw new Error(`Missing cutout canvas for frame ${index + 1}.`);
          frame.editedCanvas = imageCanvas(output.canvas);
          frame.imported = true;
          frame.flipped = false;
          frame.signature = null;
          frame.thumbnails.edited = "";
        });
        renderGrid();
        setStatus(text("cutoutReady", { count: outputs.length }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        elements.organizerModal.hidden = false;
        setEditorInert(true);
        document.body.classList.add("organizerOpen");
        renderGrid();
        restartPreview();
        const editButton = elements.organizerGrid.querySelector(
          `[data-frame-uid="${CSS.escape(targetFrame.uid)}"] .organizerFrameCutout`,
        );
        editButton?.focus({ preventScroll: true });
      }
    }

    /**
     * Applies the staged frame plan through the host application.
     * @returns {Promise<void>}
     */
    async function applyPlan() {
      const frames = includedFrames();
      let metadata = null;
      try {
        if (state.mode === "import") metadata = importMetadata();
      } catch (error) {
        setStatus(error.message, "error");
        return;
      }
      const confirmation = state.mode === "import"
        ? text("createConfirm", { count: frames.length })
        : text("applyConfirm");
      const details = state.mode === "import"
        ? [
            [text("detailProject"), metadata.projectId || metadata.projectLabel],
            [text("detailProfile"), metadata.profileLabel],
            [text("detailAnimation"), metadata.animationName],
            [text("detailFrames"), frames.length],
            [text("detailFps"), metadata.fps],
          ]
        : [
            [text("detailAnimation"), state.animationName],
            [text("detailFrames"), frames.length],
          ];
      if (!frames.length || !(await requestConfirmation(confirmation, details))) return;
      state.busy = true;
      renderCounts();
      try {
        const items = frames.map((frame) => ({
          sourceIndex: frame.sourceIndex,
          sourcePath: frame.sourcePath,
          name: frame.name,
          flipped: frame.flipped,
          data: state.mode === "import" || frame.imported || frame.flipped
            ? frame.editedCanvas.toDataURL("image/png")
            : "",
        }));
        if (state.mode === "import") {
          await hooks.createAnimation?.(metadata, items);
          state.mode = "edit";
          setStatus(text("created", { count: items.length }), "success");
          renderLanguage();
        } else {
          await hooks.applyPlan?.(items);
          setStatus(text("applied", { count: items.length }), "success");
        }
        await loadCurrentAnimation();
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    /**
     * Adds included processed frames to the active group's reusable asset tray.
     * @returns {Promise<void>}
     */
    async function addIncludedFramesToAssets() {
      const frames = includedFrames();
      if (!frames.length || typeof hooks.addAssets !== "function") return;
      state.busy = true;
      renderCounts();
      try {
        const count = await hooks.addAssets(frames.map((frame) => ({
          name: frame.name,
          image: frame.editedCanvas,
        })));
        setStatus(text("assetsAdded", { count }), "success");
      } catch (error) {
        setStatus(text("failed", { message: error.message }), "error");
      } finally {
        state.busy = false;
        renderCounts();
      }
    }

    /**
     * Opens the organizer and reloads the current animation.
     * @returns {Promise<void>}
     */
    async function open() {
      state.returnFocus = document.activeElement;
      state.mode = "edit";
      state.deletedFramesSnapshot = null;
      elements.organizerUndoDelete.hidden = true;
      elements.organizerModal.hidden = false;
      setEditorInert(true);
      document.body.classList.add("organizerOpen");
      renderLanguage();
      await loadCurrentAnimation();
      elements.organizerImport.focus();
    }

    /**
     * Opens a blank organizer workset for creating a new animation.
     * @returns {Promise<void>}
     */
    async function openImport() {
      state.returnFocus = document.activeElement;
      state.mode = "import";
      state.frames = [];
      state.animationName = "";
      state.anchorIndex = -1;
      state.previewIndex = 0;
      state.deletedFramesSnapshot = null;
      elements.organizerUndoDelete.hidden = true;
      elements.organizerModal.hidden = false;
      setEditorInert(true);
      document.body.classList.add("organizerOpen");
      renderImportContext(true);
      renderLanguage();
      renderGrid();
      restartPreview();
      setStatus(text("importReady"));
      elements.organizerProjectSelect.focus();
    }

    /**
     * Closes the organizer.
     * @returns {void}
     */
    function close() {
      if (state.videoExtracting) return;
      if (!elements.organizerLoopPanel.hidden) closeLoopFinder();
      closeVideoImporter();
      elements.organizerModal.hidden = true;
      setEditorInert(false);
      document.body.classList.remove("organizerOpen");
      window.clearTimeout(state.previewTimer);
      if (state.returnFocus && typeof state.returnFocus.focus === "function") state.returnFocus.focus();
    }

    elements.organizerOpen.addEventListener("click", () => open().catch((error) => setStatus(text("failed", { message: error.message }), "error")));
    elements.organizerClose.addEventListener("click", close);
    elements.organizerModal.addEventListener("pointerdown", (event) => {
      if (event.target === elements.organizerModal) close();
    });
    elements.organizerInvert.addEventListener("click", () => {
      state.frames.forEach((frame) => { frame.included = !frame.included; });
      renderGrid();
      restartPreview();
    });
    elements.organizerReduce.addEventListener("click", () => {
      const step = Math.max(2, Math.min(20, Number.parseInt(elements.organizerReduceStep.value, 10) || 2));
      elements.organizerReduceStep.value = String(step);
      const targets = selectedFrames().length ? new Set(selectedFrames().map((frame) => frame.uid)) : null;
      let cursor = 0;
      state.frames.forEach((frame) => {
        if (!frame.included || (targets && !targets.has(frame.uid))) return;
        frame.included = cursor % step === 0;
        cursor += 1;
      });
      renderGrid();
      restartPreview();
      setStatus(text("reduced", { step, count: includedFrames().length }), "success");
    });
    elements.organizerAutoSort.addEventListener("click", () => {
      state.frames.sort((left, right) => left.originalIndex - right.originalIndex);
      renderGrid();
      restartPreview();
      setStatus(text("sorted"), "success");
    });
    elements.organizerFlip.addEventListener("click", flipFrames);
    elements.organizerImport.addEventListener("click", () => {
      elements.organizerFileInput.value = "";
      elements.organizerFileInput.click();
    });
    elements.organizerFileInput.addEventListener("change", () => {
      importFiles(elements.organizerFileInput.files).catch((error) => {
        setStatus(text("failed", { message: error.message }), "error");
      });
    });
    elements.organizerImportVideo.addEventListener("click", () => {
      elements.organizerVideoInput.value = "";
      elements.organizerVideoInput.click();
    });
    elements.organizerVideoReselect.addEventListener("click", () => {
      elements.organizerVideoInput.value = "";
      elements.organizerVideoInput.click();
    });
    elements.organizerVideoInput.addEventListener("change", () => {
      loadVideoFile(elements.organizerVideoInput.files?.[0]).catch((error) => {
        setVideoStatus(text("failed", { message: error.message }), "error");
      });
    });
    elements.organizerVideoClose.addEventListener("click", () => closeVideoImporter());
    elements.organizerVideoCancel.addEventListener("click", () => closeVideoImporter());
    elements.organizerVideoPanel.addEventListener("pointerdown", (event) => {
      if (event.target === elements.organizerVideoPanel) closeVideoImporter();
    });
    elements.organizerLoopPanel.addEventListener("pointerdown", (event) => {
      if (event.target === elements.organizerLoopPanel) closeLoopFinder();
    });
    elements.organizerLoopClose.addEventListener("click", closeLoopFinder);
    elements.organizerLoopPreference.addEventListener("click", (event) => {
      const button = event.target.closest("[data-loop-preference]");
      if (!button) return;
      state.loopPreference = button.dataset.loopPreference;
      Array.from(elements.organizerLoopPreference.children).forEach((entry) => {
        entry.classList.toggle("active", entry === button);
      });
    });
    [elements.organizerLoopStartAuto, elements.organizerLoopStartCustom].forEach((input) => {
      input.addEventListener("change", () => {
        elements.organizerLoopStartRow.hidden = !elements.organizerLoopStartCustom.checked;
        if (elements.organizerLoopStartCustom.checked) elements.organizerLoopStartInput.focus();
      });
    });
    elements.organizerLoopStartInput.addEventListener("blur", () => {
      const maximum = Math.max(1, state.frames.filter((frame) => frame.included).length);
      elements.organizerLoopStartInput.value = String(clamp(
        Math.round(elements.organizerLoopStartInput.value || 1),
        1,
        maximum,
      ));
    });
    elements.organizerLoopStartSearch.addEventListener("click", () => {
      startLoopSearch().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
    });
    elements.organizerLoopCancel.addEventListener("click", () => {
      if (state.loopStage !== "search") {
        closeLoopFinder();
        return;
      }
      state.loopCancelled = true;
      state.loopSearchToken += 1;
      state.busy = false;
      setLoopStage("params");
      renderCounts();
    });
    elements.organizerLoopRetry.addEventListener("click", () => {
      stopLoopPlayback();
      setLoopStage("params");
      elements.organizerLoopStartSearch.focus();
    });
    elements.organizerLoopTrim.addEventListener("click", trimToLoopCandidate);
    elements.organizerLoopPrevious.addEventListener("click", () => {
      stopLoopPlayback();
      setLoopPreviewIndex(state.loopPreviewIndex - 1);
    });
    elements.organizerLoopNext.addEventListener("click", () => {
      stopLoopPlayback();
      setLoopPreviewIndex(state.loopPreviewIndex + 1);
    });
    const updateLoopFrameInput = () => {
      stopLoopPlayback();
      const frameCount = Math.max(1, currentLoopFrames().length);
      const value = clamp(Math.round(elements.organizerLoopFrameInput.value || 1), 1, frameCount);
      setLoopPreviewIndex(value - 1);
    };
    elements.organizerLoopFrameInput.addEventListener("change", updateLoopFrameInput);
    elements.organizerLoopFrameInput.addEventListener("blur", updateLoopFrameInput);
    elements.organizerLoopFrameRange.addEventListener("input", () => {
      stopLoopPlayback();
      setLoopPreviewIndex(Number(elements.organizerLoopFrameRange.value) - 1);
    });
    elements.organizerLoopPlay.addEventListener("click", () => {
      if (state.loopTimer) stopLoopPlayback();
      else startLoopPlayback();
    });
    elements.organizerLoopSpeed.addEventListener("input", () => {
      if (!state.loopTimer) return;
      startLoopPlayback();
    });
    elements.organizerVideoExtract.addEventListener("click", extractVideoFrames);
    elements.organizerVideoStart.addEventListener("input", () => {
      elements.organizerVideoStartRange.value = elements.organizerVideoStart.value;
      syncVideoControls("start");
    });
    elements.organizerVideoEnd.addEventListener("input", () => {
      elements.organizerVideoEndRange.value = elements.organizerVideoEnd.value;
      syncVideoControls("end");
    });
    elements.organizerVideoStartRange.addEventListener("input", () => {
      elements.organizerVideoStart.value = elements.organizerVideoStartRange.value;
      elements.organizerVideoElement.currentTime = Number(elements.organizerVideoStartRange.value);
      syncVideoControls("start");
    });
    elements.organizerVideoEndRange.addEventListener("input", () => {
      elements.organizerVideoEnd.value = elements.organizerVideoEndRange.value;
      elements.organizerVideoElement.currentTime = Number(elements.organizerVideoEndRange.value);
      syncVideoControls("end");
    });
    elements.organizerVideoFps.addEventListener("input", () => {
      elements.organizerVideoFpsNumber.value = elements.organizerVideoFps.value;
      syncVideoControls("fps");
    });
    elements.organizerVideoFpsNumber.addEventListener("input", () => {
      elements.organizerVideoFps.value = elements.organizerVideoFpsNumber.value;
      syncVideoControls("fps");
    });
    elements.organizerDeleteSelected.addEventListener("click", () => {
      const snapshot = state.frames.slice();
      const before = state.frames.length;
      state.frames = state.frames.filter((frame) => !frame.selected);
      renderGrid();
      restartPreview();
      setStatus(text("deleted", { count: before - state.frames.length }), "success");
      offerDeleteUndo(snapshot);
    });
    elements.organizerDeleteExcluded.addEventListener("click", () => {
      const snapshot = state.frames.slice();
      const before = state.frames.length;
      state.frames = state.frames.filter((frame) => frame.included);
      renderGrid();
      restartPreview();
      setStatus(text("deleted", { count: before - state.frames.length }), "success");
      offerDeleteUndo(snapshot);
    });
    elements.organizerUndoDelete.addEventListener("click", () => {
      if (!state.deletedFramesSnapshot) return;
      state.frames = state.deletedFramesSnapshot;
      state.deletedFramesSnapshot = null;
      elements.organizerUndoDelete.hidden = true;
      renderGrid();
      restartPreview();
      setStatus(text("ready"), "success");
    });
    elements.organizerConfirmCancel.addEventListener("click", () => resolveConfirmation(false));
    elements.organizerConfirmAccept.addEventListener("click", () => resolveConfirmation(true));
    elements.organizerThreshold.addEventListener("input", () => {
      elements.organizerThresholdValue.textContent = elements.organizerThreshold.value;
    });
    elements.organizerFindJump.addEventListener("click", () => analyze("jump"));
    elements.organizerFindDuplicate.addEventListener("click", () => analyze("duplicate"));
    elements.organizerFindLoop.addEventListener("click", openLoopFinder);
    elements.organizerReset.addEventListener("click", () => {
      if (state.mode === "import") {
        state.frames = [];
        state.anchorIndex = -1;
        state.previewIndex = 0;
        renderGrid();
        restartPreview();
        setStatus(text("importReady"));
        return;
      }
      loadCurrentAnimation().catch((error) => setStatus(text("failed", { message: error.message }), "error"));
    });
    elements.organizerApply.addEventListener("click", applyPlan);
    elements.organizerAddAssets.addEventListener("click", addIncludedFramesToAssets);
    elements.organizerProjectSelect.addEventListener("change", syncImportProjectField);
    elements.organizerSpeed.addEventListener("input", schedulePreviewFrame);
    elements.organizerApplyTag.addEventListener("click", () => {
      selectedFrames().forEach((frame) => { frame.tag = elements.organizerTag.value.trim(); });
      renderGrid();
    });
    elements.organizerClearTag.addEventListener("click", () => {
      selectedFrames().forEach((frame) => { frame.tag = ""; });
      renderGrid();
    });
    elements.organizerViewOriginal.addEventListener("click", () => {
      state.viewMode = "original";
      elements.organizerViewOriginal.classList.add("active");
      elements.organizerViewEdited.classList.remove("active");
      renderGrid();
      renderPreview();
    });
    elements.organizerViewEdited.addEventListener("click", () => {
      state.viewMode = "edited";
      elements.organizerViewEdited.classList.add("active");
      elements.organizerViewOriginal.classList.remove("active");
      renderGrid();
      renderPreview();
    });
    window.addEventListener("keydown", (event) => {
      if (!elements.organizerModal.hidden && event.key === "Tab") {
        const layer = !elements.organizerConfirmPanel.hidden
          ? elements.organizerConfirmPanel
          : !elements.organizerLoopPanel.hidden
            ? elements.organizerLoopPanel
            : !elements.organizerVideoPanel.hidden
              ? elements.organizerVideoPanel
              : elements.organizerModal;
        trapFocus(event, layer);
        return;
      }
      if (!elements.organizerModal.hidden && elements.organizerConfirmPanel.hidden && elements.organizerLoopPanel.hidden && elements.organizerVideoPanel.hidden) {
        const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName);
        const command = event.metaKey || event.ctrlKey;
        if (!typing && command && event.key.toLowerCase() === "a") {
          event.preventDefault();
          state.frames.forEach((frame) => { frame.selected = true; });
          state.anchorIndex = 0;
          renderGrid();
          return;
        }
        if (!typing && (event.key === "ArrowLeft" || event.key === "ArrowRight") && state.frames.length) {
          event.preventDefault();
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          const nextIndex = Math.max(0, Math.min(state.frames.length - 1, state.previewIndex + direction));
          selectFrame(nextIndex, event.shiftKey ? { shiftKey: true } : {});
          elements.organizerGrid.children[nextIndex]?.focus({ preventScroll: true });
          elements.organizerGrid.children[nextIndex]?.scrollIntoView({ block: "nearest" });
          return;
        }
        if (!typing && (event.key === "Delete" || event.key === "Backspace") && selectedFrames().length) {
          event.preventDefault();
          elements.organizerDeleteSelected.click();
          return;
        }
      }
      if (event.key !== "Escape" || elements.organizerModal.hidden) return;
      if (!elements.organizerConfirmPanel.hidden) resolveConfirmation(false);
      else if (!elements.organizerLoopPanel.hidden) closeLoopFinder();
      else if (!elements.organizerVideoPanel.hidden) closeVideoImporter();
      else close();
    });

    renderLanguage();
    renderCounts();
    return {
      open,
      openImport,
      setLanguage(nextLanguage) {
        state.language = nextLanguage === "en" ? "en" : "zh";
        renderLanguage();
      },
    };
  }

  root.FrameOrganizer = { createController };
}(globalThis));
