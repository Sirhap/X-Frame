(function attachXFrameAppProjectLifecycle(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppProjectLifecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** Resolves animation=profile/id first, then an exact uiId, then a stale index-suffixed uiId by identity prefix. */
  function requestedGroup(groups, urlState, savedGroupUiId = "") {
    const values = Array.from(groups || []);
    const animationKey = String(urlState?.get?.("animation") || "");
    const separator = animationKey.indexOf("/");
    if (separator > 0) {
      const profileId = animationKey.slice(0, separator);
      const animationId = animationKey.slice(separator + 1);
      const animationMatch = values.find(
        (group) => group.profileId === profileId && group.animationId === animationId,
      );
      if (animationMatch) return animationMatch;
    }
    const groupUiId = String(urlState?.get?.("group") || savedGroupUiId || "");
    const stalePrefix = groupUiId.replace(/:\d+$/, "");
    const staleIndexMatch = groupUiId.match(/:(\d+)$/);
    const staleIndex = staleIndexMatch ? Number(staleIndexMatch[1]) : -1;
    const prefixMatches = values.filter((group) => {
      const currentId = String(group.uiId || "");
      const currentPrefix = currentId.replace(/:\d+$/, "");
      if (currentPrefix === stalePrefix) return true;
      const assembled = `${group.tuningTarget || "player"}:${group.type}:${group.name}`;
      const assembledWithProfile = `${group.tuningTarget || "player"}:${group.profileId || ""}:${group.type}:${group.name}`;
      return assembled === stalePrefix || assembledWithProfile === stalePrefix;
    });
    const exact = values.find((group) => group.uiId === groupUiId);
    const uiIndex = (group) => {
      const match = String(group.uiId || "").match(/:(\d+)$/);
      return match ? Number(match[1]) : -1;
    };
    const bumpedSibling = prefixMatches.some((group) => uiIndex(group) === staleIndex + 1);
    if (exact && (prefixMatches.length <= 1 || !bumpedSibling)) return exact;
    if (!stalePrefix || stalePrefix === groupUiId) return exact || null;
    if (prefixMatches.length <= 1) return prefixMatches[0] || exact || null;
    const shifted = prefixMatches
      .filter((group) => uiIndex(group) > staleIndex)
      .sort((left, right) => uiIndex(left) - uiIndex(right));
    if (shifted[0]) return shifted[0];
    const byProfile = prefixMatches.find(
      (group) => group.profileId && stalePrefix.includes(`:${group.profileId}:`),
    );
    return byProfile || prefixMatches[0];
  }

  /**
   * Creates project loading and active-group selection operations.
   *
   * The workbench keeps its state in app.js. This controller receives explicit
   * getters, setters, and side-effect functions so loading can be tested without
   * constructing a DOM or importing the rest of the editor.
   *
   * @param {object} [dependencies] Injected state accessors and collaborators.
   * @returns {object} Project lifecycle operations.
   */
  function createController(dependencies = {}) {
    const {
      state = {},
      elements = state.elements || {},
      setConfig = (value) => (state.config = value),
      getSelectedProjectId = () => state.selectedProjectId || "",
      setSelectedProjectId = (value) => (state.selectedProjectId = value),
      getCurrentGroup = () => state.currentGroup || null,
      setCurrentGroup = (value) => (state.currentGroup = value),
      getSelectedFrame = () => state.selectedFrame ?? 0,
      setSelectedFrame = (value) => (state.selectedFrame = value),
      setSelectedFrames = (value) => (state.selectedFrames = value),
      setSelectionAnchorFrame = (value) => (state.selectionAnchorFrame = value),
      setPlaying = (value) => (state.playing = value),
      setPlaybackPrimaryGroup = (value) => (state.playbackPrimaryGroup = value),
      setPlaybackSecondaryGroup = (value) => (state.playbackSecondaryGroup = value),
      setPlaybackSwitching = (value) => (state.playbackSwitching = value),
      getImages = () => state.images || [],
      setImages = (value) => (state.images = value),
      setChainImages = (value) => (state.chainImages = value),
      setPreviewOwnerGroup = (value) => (state.previewOwnerGroup = value),
      setPreviewOwnerImages = (value) => (state.previewOwnerImages = value),
      setCoordinateOwnerGroup = (value) => (state.coordinateOwnerGroup = value),
      setCoordinateOwnerImages = (value) => (state.coordinateOwnerImages = value),
      getAttachedLayerImageSets = () => state.attachedLayerImageSets || new Map(),
      setAttachedLayerImageSets = (value) => (state.attachedLayerImageSets = value),
      setReferenceFrame = (value) => (state.referenceFrame = value),
      setUndoStack = (value) => (state.undoStack = value),
      setRedoStack = (value) => (state.redoStack = value),
      getImageCache = () => state.imageCache || null,
      getImageElements = () => state.imageElements || null,
      setOpaqueRectCache = (value) => (state.opaqueRectCache = value),
      setHuangXianAnchorXCache = (value) => (state.huangXianAnchorXCache = value),
      setSelectedAttachmentId = (value) => (state.selectedAttachmentId = value),
      setValues = (value) => (state.values = value),
      setBossValues = (value) => (state.bossValues = value),
      setAct2StatueBossValues = (value) => (state.act2StatueBossValues = value),
      setHuangXianValues = (value) => (state.huangXianValues = value),
      setSoulValues = (value) => (state.soulValues = value),
      setYechengPropValues = (value) => (state.yechengPropValues = value),
      setSceneSettings = (value) => (state.sceneSettings = value),
      setFrameOverrides = (value) => (state.frameOverrides = value),
      setVfxFrameOverrides = (value) => (state.vfxFrameOverrides = value),
      setFramePlaybackOverrides = (value) => (state.framePlaybackOverrides = value),
      setVfxPlaybackOverrides = (value) => (state.vfxPlaybackOverrides = value),
      setFrameBoxOverrides = (value) => (state.frameBoxOverrides = value),
      setBossFrameOverrides = (value) => (state.bossFrameOverrides = value),
      setBossPlaybackOverrides = (value) => (state.bossPlaybackOverrides = value),
      setAct2StatueBossFrameOverrides = (value) => (state.act2StatueBossFrameOverrides = value),
      setAct2StatueBossPlaybackOverrides = (value) => (state.act2StatueBossPlaybackOverrides = value),
      setHuangXianFrameOverrides = (value) => (state.huangXianFrameOverrides = value),
      setHuangXianPlaybackOverrides = (value) => (state.huangXianPlaybackOverrides = value),
      setSoulFrameOverrides = (value) => (state.soulFrameOverrides = value),
      setSoulPlaybackOverrides = (value) => (state.soulPlaybackOverrides = value),
      setSoulFrameBoxOverrides = (value) => (state.soulFrameBoxOverrides = value),
      setYechengPropFrameOverrides = (value) => (state.yechengPropFrameOverrides = value),
      fetchImpl = root?.fetch,
      storage = resolveStorage(root),
      windowRef = root?.window || root || {},
      structuredCloneImpl = root?.structuredClone,
      translate = (key) => key,
      getGroupSearch = () => "",
      loadFrameImageAttachmentsFromProject = () => {},
      loadAttachmentAssetsFromProject = () => {},
      resetFrameAudioBindings = () => {},
      loadFrameAudioBindingsFromProject = () => {},
      loadFrameAudioBindingsFromDb = async () => {},
      syncFrameAudioBindingsToGame = async () => {},
      getFrameAudioBindings = () => ({}),
      renderProjectSelect = () => {},
      renderSceneSelect = () => {},
      renderProfileSelect = () => {},
      renderGroupSelect = () => {},
      renderChainGroupSelect = () => {},
      updateSaveState = () => {},
      updateHistoryControls = () => {},
      loadedStatusText = () => "",
      status = () => {},
      updateWorkbenchHud = () => {},
      draw = () => {},
      startPreloadImages = () => {},
      loadImagesBounded = async () => {
        throw new TypeError("An image loader is required.");
      },
      restoreReferenceFrame = async () => {
        setReferenceFrame(null);
        return false;
      },
      loadImageCached = async () => {
        throw new TypeError("An image loader is required.");
      },
      loadCompositeContextImpl = async () => ({}),
      loadFrameImageAttachmentsForGroupImpl = async () => {},
      loadChainImagesImpl = async () => [],
      framePlayback = () => ({ disabled: false }),
      firstPlayableFrame = () => 0,
      setFrameSelection = () => {},
      setSingleFrameSelection = () => {},
      updateCanvasTitle = () => {},
      updateGroupMeta = () => {},
      syncBoxSelectionForGroup = () => {},
      syncBaseInputs = () => {},
      syncFrameInputs = () => {},
      syncGroupPlaybackInputs = () => {},
      syncGroupTimeInputs = () => {},
      renderFilmstrip = () => {},
      fitView = () => {},
      syncUrlState = () => {},
      onConfigLoaded = () => {},
      onGroupSelected = () => {},
    } = dependencies;

    /**
     * Reads a JSON config response while preserving the server's error text.
     * @param {Response} response Fetch response.
     * @returns {Promise<object>} Parsed project config.
     */
    async function readConfigResponse(response) {
      if (!response?.ok) throw new Error((await response?.text?.()) || "Unable to load project config.");
      return response.json();
    }

    /**
     * Clones a config value using the injected platform implementation.
     * @param {unknown} value Value to clone.
     * @returns {unknown} Cloned value.
     */
    function clone(value) {
      if (typeof structuredCloneImpl === "function") return structuredCloneImpl(value);
      return JSON.parse(JSON.stringify(value));
    }

    /**
     * Persists a small workbench preference without making storage mandatory.
     * @param {string} key Storage key.
     * @param {string} value Storage value.
     * @returns {void}
     */
    function writeStorage(key, value) {
      try {
        storage?.setItem(key, value);
      } catch (_error) {
        // Memory state remains authoritative when storage is unavailable.
      }
    }

    /**
     * Clears the active session before a project reload.
     * @returns {void}
     */
    function resetProjectSession() {
      setPlaying(false);
      setPlaybackPrimaryGroup(null);
      setPlaybackSecondaryGroup(null);
      setPlaybackSwitching(false);
      setCurrentGroup(null);
      setSelectedFrame(0);
      setSelectedFrames(new Set([0]));
      setSelectionAnchorFrame(0);
      setImages([]);
      setChainImages([]);
      setPreviewOwnerGroup(null);
      setPreviewOwnerImages([]);
      setCoordinateOwnerGroup(null);
      setCoordinateOwnerImages([]);
      const attachedLayerImageSets = getAttachedLayerImageSets();
      if (attachedLayerImageSets && typeof attachedLayerImageSets.clear === "function") {
        attachedLayerImageSets.clear();
      } else {
        setAttachedLayerImageSets(new Map());
      }
      setReferenceFrame(null);
      setUndoStack([]);
      setRedoStack([]);
      getImageCache()?.clear?.();
      getImageElements()?.clear?.();
      setOpaqueRectCache(new WeakMap());
      setHuangXianAnchorXCache(new WeakMap());
      if (elements.playPause) elements.playPause.textContent = translate("play");
      if (elements.filmstrip) elements.filmstrip.innerHTML = "";
      if (elements.canvasTitle) elements.canvasTitle.textContent = translate("canvas");
      if (elements.selectionHud) elements.selectionHud.textContent = `${translate("frame")} -`;
      if (elements.coordHud) elements.coordHud.textContent = translate("coordHudIdle");
      updateHistoryControls();
    }

    /**
     * Loads and normalizes the active project configuration.
     * @returns {Promise<void>} Resolves when the initial group is selected.
     */
    async function loadConfig() {
      if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
      const selectedProjectId = getSelectedProjectId();
      const configUrl = selectedProjectId
        ? `/api/config?project=${encodeURIComponent(selectedProjectId)}`
        : "/api/config";
      const response = await fetchImpl(configUrl);
      const nextConfig = await readConfigResponse(response);
      nextConfig.groups = Array.isArray(nextConfig.groups) ? nextConfig.groups : [];
      nextConfig.scenes = Array.isArray(nextConfig.scenes) ? nextConfig.scenes : [];
      setConfig(nextConfig);
      const activeProjectId = nextConfig.activeProjectId || selectedProjectId || "";
      setSelectedProjectId(activeProjectId);
      if (activeProjectId) writeStorage("xsxbFrameTuner.project", activeProjectId);
      nextConfig.groups.forEach((group, index) => {
        group.uiId = `${group.tuningTarget || "player"}:${group.type}:${group.name}:${index}`;
      });
      onConfigLoaded(nextConfig);

      const tuning = nextConfig.tuning && typeof nextConfig.tuning === "object" ? nextConfig.tuning : {};
      setValues({ ...tuning });
      setBossValues({ ...(nextConfig.bossTuning || {}) });
      setAct2StatueBossValues({ ...(nextConfig.act2StatueBossTuning || {}) });
      setHuangXianValues({ ...(nextConfig.huangXianTuning || {}) });
      setSoulValues({ ...(nextConfig.soulTuning || {}) });
      setYechengPropValues({ ...(nextConfig.yechengPropTuning || {}) });
      setSceneSettings(clone(tuning.scene_settings || {}));
      setFrameOverrides(clone(tuning.frame_visual_overrides || {}));
      setVfxFrameOverrides(clone(tuning.attack_vfx_frame_overrides || {}));
      setFramePlaybackOverrides(clone(tuning.frame_playback_overrides || {}));
      setVfxPlaybackOverrides(clone(tuning.attack_vfx_playback_overrides || {}));
      setFrameBoxOverrides(clone(tuning.frame_box_overrides || {}));
      setBossFrameOverrides(clone(nextConfig.bossTuning?.boss_frame_visual_overrides || {}));
      setBossPlaybackOverrides(clone(nextConfig.bossTuning?.boss_frame_playback_overrides || {}));
      setAct2StatueBossFrameOverrides(clone(nextConfig.act2StatueBossTuning?.frame_visual_overrides || {}));
      setAct2StatueBossPlaybackOverrides(
        clone(nextConfig.act2StatueBossTuning?.frame_playback_overrides || {}),
      );
      setHuangXianFrameOverrides(clone(nextConfig.huangXianTuning?.frame_visual_overrides || {}));
      setHuangXianPlaybackOverrides(clone(nextConfig.huangXianTuning?.frame_playback_overrides || {}));
      setSoulFrameOverrides(clone(nextConfig.soulTuning?.frame_visual_overrides || {}));
      setSoulPlaybackOverrides(clone(nextConfig.soulTuning?.frame_playback_overrides || {}));
      setSoulFrameBoxOverrides(clone(nextConfig.soulTuning?.frame_box_overrides || {}));
      setYechengPropFrameOverrides(clone(nextConfig.yechengPropTuning?.frame_visual_overrides || {}));
      loadFrameImageAttachmentsFromProject();
      loadAttachmentAssetsFromProject();
      resetFrameAudioBindings();
      loadFrameAudioBindingsFromProject();
      await loadFrameAudioBindingsFromDb();
      if (Object.keys(getFrameAudioBindings() || {}).length) {
        try {
          await syncFrameAudioBindingsToGame({ silent: true });
        } catch (error) {
          status(translate("boxSyncFailed", { message: error.message }));
        }
      }

      if (elements.groupSearch) elements.groupSearch.value = getGroupSearch();
      renderProjectSelect();
      renderSceneSelect();
      renderProfileSelect();
      renderGroupSelect();
      renderChainGroupSelect();
      updateSaveState();
      updateHistoryControls();

      const currentUrlState = new URLSearchParams(windowRef?.location?.search || "");
      const savedGroupUiId = readStorage(storage, "animationTuner.groupUiId");
      const initialGroup =
        requestedGroup(nextConfig.groups, currentUrlState, savedGroupUiId) ||
        nextConfig.groups.find((group) => group.name === "stand_attack") ||
        nextConfig.groups[0];
      if (initialGroup) {
        await selectGroup(initialGroup, {
          frameIndex: Math.max(0, Number.parseInt(currentUrlState.get("frame") || "0", 10) || 0),
          history: false,
        });
        await restoreReferenceFrame(tuning.reference_frame || null, nextConfig.groups, (frames) =>
          frames === getCurrentGroup()?.frames && getImages().length
            ? getImages()
            : loadImagesBounded(frames),
        );
        syncFrameInputs();
        renderFilmstrip();
        draw();
        startPreloadImages(initialGroup);
      } else {
        resetProjectSession();
        renderProjectSelect();
        renderProfileSelect();
        renderGroupSelect();
        renderChainGroupSelect();
        updateWorkbenchHud(null);
        draw();
      }
      status(loadedStatusText());
    }

    /**
     * Loads one animation group and synchronizes all editor views.
     * @param {object|null} group Animation group to activate.
     * @param {object} [options] Selection and view options.
     * @returns {Promise<void>} Resolves when all group context is ready.
     */
    async function selectGroup(group, options = {}) {
      if (!group) return;
      const hadCurrentGroup = Boolean(getCurrentGroup());
      if (options.stopPlayback !== false) {
        setPlaying(false);
        setPlaybackPrimaryGroup(null);
        setPlaybackSecondaryGroup(null);
        if (elements.playPause) elements.playPause.textContent = translate("play");
      }
      renderGroupSelect(group.uiId);
      setCurrentGroup(group);
      writeStorage("animationTuner.groupUiId", group.uiId);
      setSelectedFrame(Number.isInteger(options.frameIndex) ? options.frameIndex : 0);
      const groupFrames = Array.isArray(group.frames) ? group.frames : [];
      setImages(await loadImagesBounded(groupFrames));
      if (group.huangXianAnchorFrame) {
        group.huangXianAnchorImage = await loadImageCached(group.huangXianAnchorFrame);
      } else {
        delete group.huangXianAnchorImage;
      }
      await loadCompositeContext(group);
      await loadFrameImageAttachmentsForGroup(group);
      setSelectedFrame(Math.min(Math.max(getSelectedFrame(), 0), Math.max(groupFrames.length - 1, 0)));
      setSelectedAttachmentId(options.selectedAttachmentId || "");
      if (framePlayback(getSelectedFrame(), group).disabled) {
        setSelectedFrame(firstPlayableFrame(group));
      }
      if (Array.isArray(options.selectedFrames)) {
        setSelectionAnchorFrame(
          Number.isInteger(options.selectionAnchorFrame) ? options.selectionAnchorFrame : getSelectedFrame(),
        );
        setFrameSelection(options.selectedFrames, getSelectedFrame(), group);
      } else {
        setSingleFrameSelection(getSelectedFrame(), group);
      }
      await loadChainImages();
      if (elements.groupSelect) elements.groupSelect.value = group.uiId;
      updateCanvasTitle(group);
      updateGroupMeta(group);
      syncBoxSelectionForGroup(group);
      syncBaseInputs();
      syncFrameInputs();
      syncGroupPlaybackInputs();
      syncGroupTimeInputs();
      renderFilmstrip();
      const preserveView =
        options.preserveView === true || (options.preserveView !== false && hadCurrentGroup);
      if (options.fitView === true || !preserveView) fitView();
      draw();
      onGroupSelected(group);
      syncUrlState({ push: options.history !== false && hadCurrentGroup });
    }

    /**
     * Loads images for the configured chained playback group.
     * @param {object|null} [chain] Optional chain group override.
     * @returns {Promise<object[]>} Loaded chain images.
     */
    function loadChainImages(chain) {
      return loadChainImagesImpl(chain);
    }

    /**
     * Loads preview-owner, coordinate-owner, and attached-layer context.
     * @param {object|null} group Active animation group.
     * @returns {Promise<object>} Loaded context.
     */
    function loadCompositeContext(group) {
      return loadCompositeContextImpl(group);
    }

    /**
     * Preloads all attachment images referenced by a group.
     * @param {object|null} group Active animation group.
     * @returns {Promise<void>} Resolves after preload attempts complete.
     */
    function loadFrameImageAttachmentsForGroup(group) {
      return loadFrameImageAttachmentsForGroupImpl(group);
    }

    return Object.freeze({
      loadChainImages,
      loadCompositeContext,
      loadConfig,
      loadFrameImageAttachmentsForGroup,
      resetProjectSession,
      selectGroup,
    });
  }

  /**
   * Reads localStorage without throwing in privacy-restricted browsers.
   * @param {typeof globalThis} scope Browser global object.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage(scope) {
    try {
      return scope?.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Reads one storage key with a safe fallback.
   * @param {Storage|null} storage Storage implementation.
   * @param {string} key Storage key.
   * @returns {string} Stored value or an empty string.
   */
  function readStorage(storage, key) {
    try {
      return storage?.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  }

  return Object.freeze({ createController, requestedGroup });
});
