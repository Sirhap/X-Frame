(function attachXsxbAppSave(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppSave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the save request orchestration used by the frame tuner.
   *
   * The controller deliberately receives all mutable app state through getters
   * and setters. This keeps the request payload, revision handling, and save
   * error flow identical to the original app.js implementation while allowing
   * the large block to live in a focused module.
   *
   * @param {{
   *   getConfig?:()=>object|null,
   *   getCurrentGroup?:()=>object|null,
   *   getImages?:()=>Array,
   *   getSaveInFlight?:()=>boolean,
   *   setSaveInFlight?:(value:boolean)=>void,
   *   getEditRevision?:()=>number,
   *   setDirty?:(value:boolean)=>void,
   *   getActiveProjectId?:()=>string,
   *   updateSaveState?:()=>void,
   *   updateAdjustmentFromInputs?:()=>void,
   *   pruneNoopFrameOverrides?:()=>void,
   *   collectFrameAudioBindingsForSave?:()=>Promise<Array>|Array,
   *   canEditBox?:(boxName:string,group:object)=>boolean,
   *   mapWithConcurrency?:(items:Array,worker:(item:unknown,index:number)=>Promise<unknown>)=>Promise<Array>,
   *   loadImageCached?:(frame:object)=>Promise<unknown>,
   *   boxOverrideStore?:(group:object)=>object,
   *   frameBoxKey?:(index:number,group:object)=>string,
   *   defaultCollisionBox?:(index:number,group:object,images:Array)=>object,
   *   normalizeFrameBox?:(boxName:string,box:object)=>object,
   *   collectTuningValues?:()=>object,
   *   collectBossTuningValues?:()=>object,
   *   collectAct2StatueBossTuningValues?:()=>object,
   *   collectHuangXianTuningValues?:()=>object,
   *   collectSoulTuningValues?:()=>object,
   *   collectYechengPropTuningValues?:()=>object,
   *   collectSceneSettings?:()=>object,
   *   collectFrameImageAttachmentsForSave?:()=>Array|object,
   *   getFrameOverrides?:()=>object,
   *   getVfxFrameOverrides?:()=>object,
   *   getFramePlaybackOverrides?:()=>object,
   *   getVfxPlaybackOverrides?:()=>object,
   *   getFrameBoxOverrides?:()=>object,
   *   getBossFrameOverrides?:()=>object,
   *   getBossPlaybackOverrides?:()=>object,
   *   getAct2StatueBossFrameOverrides?:()=>object,
   *   getAct2StatueBossPlaybackOverrides?:()=>object,
   *   getHuangXianFrameOverrides?:()=>object,
   *   getHuangXianPlaybackOverrides?:()=>object,
   *   getSoulFrameOverrides?:()=>object,
   *   getSoulPlaybackOverrides?:()=>object,
   *   getSoulFrameBoxOverrides?:()=>object,
   *   premiumFeatures?:object,
   *   fetchImpl?:typeof fetch,
   *   markClean?:()=>void,
   *   status?:(message:string)=>void,
   *   translate?:(key:string,variables?:object)=>string,
   *   cloneValue?:(value:unknown)=>unknown,
   * }} [dependencies] Injected app state and save helpers.
   * @returns {{
   *   save:()=>Promise<void|undefined>,
   *   ensureCollisionBoxOverridesForSave:()=>Promise<void>,
   *   collectTuningValues:()=>object,
   *   collectBossTuningValues:()=>object,
   *   collectAct2StatueBossTuningValues:()=>object,
   *   collectHuangXianTuningValues:()=>object,
   *   collectSoulTuningValues:()=>object,
   *   collectYechengPropTuningValues:()=>object,
   * }} Save operations and tuning value collectors.
   */
  function createController(dependencies = {}) {
    const {
      getConfig = () => null,
      getCurrentGroup = () => null,
      getImages = () => [],
      getSaveInFlight = () => false,
      setSaveInFlight = () => {},
      getEditRevision = () => 0,
      setDirty = () => {},
      getActiveProjectId = () => "",
      updateSaveState = () => {},
      updateAdjustmentFromInputs = () => {},
      pruneNoopFrameOverrides = () => {},
      collectFrameAudioBindingsForSave = async () => [],
      canEditBox = () => false,
      mapWithConcurrency = async (items, worker) => Promise.all(items.map(worker)),
      loadImageCached = async () => null,
      boxOverrideStore = () => ({}),
      frameBoxKey = () => "",
      defaultCollisionBox = () => ({}),
      normalizeFrameBox = (_boxName, box) => box,
      collectTuningValues = () => ({}),
      collectBossTuningValues = () => ({}),
      collectAct2StatueBossTuningValues = () => ({}),
      collectHuangXianTuningValues = () => ({}),
      collectSoulTuningValues = () => ({}),
      collectYechengPropTuningValues = () => ({}),
      collectSceneSettings = () => ({}),
      collectFrameImageAttachmentsForSave = () => [],
      getFrameOverrides = () => ({}),
      getVfxFrameOverrides = () => ({}),
      getFramePlaybackOverrides = () => ({}),
      getVfxPlaybackOverrides = () => ({}),
      getFrameBoxOverrides = () => ({}),
      getBossFrameOverrides = () => ({}),
      getBossPlaybackOverrides = () => ({}),
      getAct2StatueBossFrameOverrides = () => ({}),
      getAct2StatueBossPlaybackOverrides = () => ({}),
      getHuangXianFrameOverrides = () => ({}),
      getHuangXianPlaybackOverrides = () => ({}),
      getSoulFrameOverrides = () => ({}),
      getSoulPlaybackOverrides = () => ({}),
      getSoulFrameBoxOverrides = () => ({}),
      premiumFeatures = root?.XSXBPremiumFeatures,
      fetchImpl = root?.fetch,
      markClean = () => {},
      status = () => {},
      translate = (key) => key,
      cloneValue = (value) => root.structuredClone(value),
    } = dependencies;

    /**
     * Loads the images needed to generate missing collision boxes.
     * @param {object} group Animation group.
     * @returns {Array|Promise<Array>} Current group images or bounded loads.
     */
    async function loadImagesForBoxGeneration(group) {
      const currentImages = getImages();
      if (group?.uiId === getCurrentGroup()?.uiId && currentImages.length) return currentImages;
      return mapWithConcurrency(group?.frames || [], (frame) => loadImageCached(frame).catch(() => null));
    }

    /**
     * Ensures editable collision boxes have normalized entries before saving.
     * @returns {Promise<void>} Resolves after all groups are normalized.
     */
    async function ensureCollisionBoxOverridesForSave() {
      const config = getConfig();
      if (!Array.isArray(config?.groups)) return;
      for (const group of config.groups) {
        if (!canEditBox("collisionbox", group) || !Array.isArray(group.frames) || !group.frames.length)
          continue;
        const groupImages = await loadImagesForBoxGeneration(group);
        const store = boxOverrideStore(group);
        for (let index = 0; index < group.frames.length; index += 1) {
          const key = frameBoxKey(index, group);
          const entry = cloneValue(store[key] || {});
          const base = defaultCollisionBox(index, group, groupImages);
          const existing = entry.collisionbox || {};
          entry.collisionbox = normalizeFrameBox("collisionbox", {
            offset: existing.offset ?? base.offset,
            size: existing.size ?? base.size,
            rotation: 0,
            enabled: existing.enabled ?? base.enabled,
          });
          store[key] = entry;
        }
      }
    }

    /**
     * Sends the unchanged frame-tuner save payload and preserves revision flow.
     * @returns {Promise<void|undefined>} Resolves when the save completes.
     */
    async function save() {
      if (getSaveInFlight()) return;
      setSaveInFlight(true);
      updateSaveState();
      try {
        updateAdjustmentFromInputs();
        pruneNoopFrameOverrides();
        const frameAudioBindingsForSave = await collectFrameAudioBindingsForSave();
        await ensureCollisionBoxOverridesForSave();
        const frameImageAttachmentsForSave = collectFrameImageAttachmentsForSave();
        const premiumSnapshot = {
          frameAudioBindings: frameAudioBindingsForSave,
          frameImageAttachments: frameImageAttachmentsForSave,
          vfxFrameOverrides: getVfxFrameOverrides(),
          framePlaybackOverrides: getFramePlaybackOverrides(),
          vfxPlaybackOverrides: getVfxPlaybackOverrides(),
          frameBoxOverrides: getFrameBoxOverrides(),
          bossPlaybackOverrides: getBossPlaybackOverrides(),
          act2PlaybackOverrides: getAct2StatueBossPlaybackOverrides(),
          huangPlaybackOverrides: getHuangXianPlaybackOverrides(),
          soulPlaybackOverrides: getSoulPlaybackOverrides(),
          soulFrameBoxOverrides: getSoulFrameBoxOverrides(),
        };
        const usedPremiumFeatures = premiumFeatures?.detectTunerFeatures?.(premiumSnapshot) || [];
        const savedRevision = getEditRevision();
        const res = await fetchImpl("/api/save", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(usedPremiumFeatures.length
              ? { "x-xsxb-premium-features": usedPremiumFeatures.join(",") }
              : {}),
          },
          body: JSON.stringify({
            projectId: getActiveProjectId(),
            baseRevision: String(getConfig()?.dataRevision || ""),
            values: collectTuningValues(),
            scene_settings: collectSceneSettings(),
            frame_audio_bindings: frameAudioBindingsForSave,
            frame_image_attachments: frameImageAttachmentsForSave,
            frame_visual_overrides: getFrameOverrides(),
            attack_vfx_frame_overrides: getVfxFrameOverrides(),
            frame_playback_overrides: getFramePlaybackOverrides(),
            attack_vfx_playback_overrides: getVfxPlaybackOverrides(),
            frame_box_overrides: getFrameBoxOverrides(),
            boss: {
              values: collectBossTuningValues(),
              boss_frame_visual_overrides: getBossFrameOverrides(),
              boss_frame_playback_overrides: getBossPlaybackOverrides(),
            },
            act2StatueBoss: {
              values: collectAct2StatueBossTuningValues(),
              frame_visual_overrides: getAct2StatueBossFrameOverrides(),
              frame_playback_overrides: getAct2StatueBossPlaybackOverrides(),
            },
            huangXian: {
              values: collectHuangXianTuningValues(),
              frame_visual_overrides: getHuangXianFrameOverrides(),
              frame_playback_overrides: getHuangXianPlaybackOverrides(),
            },
            soul: {
              values: collectSoulTuningValues(),
              frame_visual_overrides: getSoulFrameOverrides(),
              frame_playback_overrides: getSoulPlaybackOverrides(),
              frame_box_overrides: getSoulFrameBoxOverrides(),
            },
            yechengProps: {
              values: collectYechengPropTuningValues(),
            },
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok && !result.localSaved) throw new Error(result.error || `HTTP ${res.status}`);
        if (result.localSaved && !res.ok) {
          if (getEditRevision() === savedRevision) markClean();
          else setDirty(true);
          status(translate("saveLocalOnly", { message: result.error || `HTTP ${res.status}` }));
          return;
        }
        const config = getConfig();
        if (result.dataRevision) config.dataRevision = result.dataRevision;
        if (Array.isArray(result.warnings)) config.warnings = result.warnings;
        if (getEditRevision() === savedRevision) {
          markClean();
        } else {
          setDirty(true);
        }
        const warningText =
          Array.isArray(result.warnings) && result.warnings.length
            ? translate("warnings", { warnings: result.warnings.join("\n") })
            : "";
        const concurrentEditText =
          getEditRevision() === savedRevision ? "" : translate("savedWithNewChanges");
        status([concurrentEditText, warningText.trim()].filter(Boolean).join("\n"));
      } finally {
        setSaveInFlight(false);
        updateSaveState();
      }
    }

    return {
      collectAct2StatueBossTuningValues,
      collectBossTuningValues,
      collectHuangXianTuningValues,
      collectSoulTuningValues,
      collectTuningValues,
      collectYechengPropTuningValues,
      ensureCollisionBoxOverridesForSave,
      save,
    };
  }

  return Object.freeze({ createController });
});
