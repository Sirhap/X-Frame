(function attachXsxbAppState(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const constants = Object.freeze({
    FRAME_DURATION_STEP_MS: 10,
    MIN_FRAME_DURATION_MS: 1,
    PRELOAD_FRAME_LIMIT: 160,
    PRELOAD_CONCURRENCY: 6,
    BOX_PREF_KEYS: Object.freeze({
      show: "xsxbFrameTuner.showBoxes",
      only: "xsxbFrameTuner.boxOnlyMode",
      selected: "xsxbFrameTuner.selectedBox",
      checked: "xsxbFrameTuner.checkedBoxes",
    }),
    ADJUSTMENT_MODE_KEY: "xsxbFrameTuner.adjustmentMode",
    ADJUSTMENT_MODES: Object.freeze(["character", "group", "frame"]),
    BOX_NAMES: Object.freeze(["hurtbox", "hitbox", "collisionbox"]),
    BOX_DRAW_ORDER: Object.freeze(["collisionbox", "hurtbox", "hitbox"]),
    COLLISION_BOX_HANDLES: new Set(["nw", "n", "ne", "w", "e"]),
    FRAME_AUDIO_DB_NAME: "xsxb-frame-tuner-frame-audio",
    FRAME_AUDIO_DB_VERSION: 1,
    FRAME_AUDIO_STORE: "frameAudio",
    LAYER_CARD_DRAG_TYPE: "application/x-xsxb-layer-card",
    ATTACHMENT_ASSET_DRAG_TYPE: "application/x-xsxb-attachment-asset",
    GROUP_PLAYBACK_FRAME: "__group",
    UI_THEME_DEFAULT: "dark",
    UI_SIDEBAR_TABS: Object.freeze(["project", "transform", "boxes", "effects"]),
    UI_FILMSTRIP_LAYOUTS: Object.freeze(["single", "grid"]),
  });

  /**
   * Reads a persisted preference without allowing storage failures to stop
   * application startup in privacy-restricted browser contexts.
   * @param {Storage|null|undefined} storage Browser storage implementation.
   * @param {string} key Preference key.
   * @param {string} fallback Value used when the preference is unavailable.
   * @returns {string} Persisted value or fallback.
   */
  function readStorage(storage, key, fallback = "") {
    try {
      return storage?.getItem(key) ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  /**
   * Parses the checked collision-box preference while preserving declaration
   * order and dropping unknown or duplicate names.
   * @param {unknown} value Serialized box names.
   * @param {readonly string[]} boxNames Supported box names.
   * @returns {string[]} Unique supported box names.
   */
  function parseBoxSelection(value, boxNames = constants.BOX_NAMES) {
    const seen = new Set();
    return String(value || "")
      .split(/[,\s]+/)
      .map((name) => name.trim())
      .filter((name) => {
        if (!boxNames.includes(name) || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
  }

  /**
   * Creates the initial mutable values used by the main workbench controller.
   * @param {{location?:{search?:string}|null,storage?:Storage|null}} [dependencies]
   * Browser dependencies, injectable for unit tests.
   * @returns {Record<string, unknown>} Initial workbench state values.
   */
  function createInitialState(dependencies = {}) {
    const storage = dependencies.storage || resolveStorage();
    const location = dependencies.location || root.location || {};
    const initialUrlState = new URLSearchParams(location.search || "");
    const selectedBox = readStorage(storage, constants.BOX_PREF_KEYS.selected);
    const selectedBoxes = new Set(parseBoxSelection(readStorage(storage, constants.BOX_PREF_KEYS.checked)));
    if (!selectedBoxes.size && constants.BOX_NAMES.includes(selectedBox)) {
      selectedBoxes.add(selectedBox);
    }

    const storedAdjustmentMode = readStorage(storage, constants.ADJUSTMENT_MODE_KEY);
    const adjustmentMode = constants.ADJUSTMENT_MODES.includes(storedAdjustmentMode)
      ? storedAdjustmentMode
      : "group";

    return {
      config: null,
      language: readStorage(storage, "xsxbFrameTuner.language", "zh") || "zh",
      uiTheme:
        readStorage(storage, "xsxbFrameTuner.theme", constants.UI_THEME_DEFAULT) ||
        constants.UI_THEME_DEFAULT,
      sidebarCollapsed: readStorage(storage, "xsxbFrameTuner.sidebarCollapsed") === "true",
      activePanelTab: constants.UI_SIDEBAR_TABS.includes(
        readStorage(storage, "xsxbFrameTuner.activePanelTab"),
      )
        ? readStorage(storage, "xsxbFrameTuner.activePanelTab")
        : "transform",
      filmstripLayout: constants.UI_FILMSTRIP_LAYOUTS.includes(
        readStorage(storage, "xsxbFrameTuner.filmstripLayout"),
      )
        ? readStorage(storage, "xsxbFrameTuner.filmstripLayout")
        : "single",
      kunkunUnlocked:
        readStorage(storage, "xsxbFrameTuner.kunkunUnlocked") === "true" ||
        readStorage(storage, "xsxbFrameTuner.theme") === "kunkun",
      canvasColor: readStorage(storage, "xsxbFrameTuner.canvasColor", "#000000") || "#000000",
      selectedProjectId: initialUrlState.get("project") || readStorage(storage, "xsxbFrameTuner.project"),
      selectedSceneId: readStorage(storage, "xsxbFrameTuner.scene"),
      currentGroup: null,
      selectedFrame: Math.max(0, Number.parseInt(initialUrlState.get("frame") || "0", 10) || 0),
      selectedFrames: new Set([0]),
      selectionAnchorFrame: 0,
      selectedProfileId: "all",
      groupSearch: readStorage(storage, "animationTuner.groupSearch"),
      images: [],
      chainImages: [],
      frameOverrides: {},
      vfxFrameOverrides: {},
      framePlaybackOverrides: {},
      vfxPlaybackOverrides: {},
      bossFrameOverrides: {},
      bossPlaybackOverrides: {},
      act2StatueBossFrameOverrides: {},
      act2StatueBossPlaybackOverrides: {},
      huangXianFrameOverrides: {},
      huangXianPlaybackOverrides: {},
      soulFrameOverrides: {},
      soulPlaybackOverrides: {},
      soulFrameBoxOverrides: {},
      yechengPropFrameOverrides: {},
      values: {},
      bossValues: {},
      act2StatueBossValues: {},
      huangXianValues: {},
      soulValues: {},
      yechengPropValues: {},
      sceneSettings: {},
      previewOwnerGroup: null,
      previewOwnerImages: [],
      coordinateOwnerGroup: null,
      coordinateOwnerImages: [],
      attachedLayerImageSets: new Map(),
      frameImageAttachments: [],
      attachmentAssets: [],
      frameMutationPending: false,
      selectedAttachmentId: "",
      frameImageAttachmentClipboard: [],
      frameImageAttachmentClipboardProjectId: "",
      ghost: true,
      referenceFrameHiddenByKey: false,
      playing: false,
      lastPlay: 0,
      playbackAnimationFrame: 0,
      pointerStagePoint: null,
      playbackPrimaryGroup: null,
      playbackSecondaryGroup: null,
      playbackSwitching: false,
      view: { zoom: 1, x: 0, y: 0 },
      stageViewMode: "fit",
      drag: null,
      undoStack: [],
      redoStack: [],
      inputEditSnapshots: new WeakMap(),
      baseEditSnapshot: null,
      boxEditSnapshot: null,
      attachmentWheelUndoTimer: null,
      attachmentWheelUndoLabel: "",
      heldAttachmentTransformKeys: new Set(),
      imageCache: new Map(),
      opaqueRectCache: new WeakMap(),
      huangXianAnchorXCache: new WeakMap(),
      referenceFrame: null,
      frameAudioBindings: {},
      frameAudioDbPromise: null,
      frameAudioSyncPromise: null,
      imageElements: new Map(),
      layerCardDrag: null,
      showBoxes: readStorage(storage, constants.BOX_PREF_KEYS.show) === "true",
      boxOnlyMode: false,
      selectedBox,
      selectedBoxes,
      adjustmentMode,
      frameBoxOverrides: {},
      dirty: false,
      editRevision: 0,
      saveInFlight: false,
      lastSavedAt: "",
      batchCutout: null,
      frameOrganizer: null,
      cutoutReturnTool: "",
    };
  }

  /**
   * Resolves localStorage without throwing in browsers that deny access.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage() {
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  return { constants, createInitialState, parseBoxSelection, resolveStorage };
});
