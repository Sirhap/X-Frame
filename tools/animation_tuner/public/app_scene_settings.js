(function attachXFrameAppSceneSettings(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppSceneSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the scene selection and scale settings controller.
   * @param {{
   *   elements?:{sceneSelect?:object|null,sceneScale?:object|null},
   *   getConfig?:()=>object|null,
   *   getSelectedSceneId?:()=>string,
   *   setSelectedSceneId?:(value:string)=>void,
   *   getSceneSettings?:()=>Record<string,object>,
   *   escapeHtml?:(value:unknown)=>string,
   *   round?:(value:number)=>number,
   *   nearlyEqual?:(left:number,right:number)=>boolean,
   *   translate?:(key:string)=>string,
   *   markDirty?:()=>void,
   *   updateSaveState?:()=>void,
   *   draw?:()=>void,
   *   storage?:Storage|null,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   activeSceneId:()=>string,
   *   sceneScaleFor:(sceneId?:string)=>number,
   *   activeSceneScale:()=>number,
   *   renderSceneSelect:()=>void,
   *   syncSceneInputs:()=>void,
   *   updateSceneScaleFromInput:()=>void,
   *   collectSceneSettings:()=>Record<string,{scale:number}>,
   * }} Scene settings operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getConfig = () => null,
      getSelectedSceneId = () => "",
      setSelectedSceneId = () => {},
      getSceneSettings = () => ({}),
      escapeHtml = (value) => String(value ?? ""),
      round = (value) => value,
      nearlyEqual = (left, right) => left === right,
      translate = (key) => key,
      markDirty = () => {},
      updateSaveState = () => {},
      draw = () => {},
      storage = resolveStorage(root),
    } = dependencies;

    /**
     * Returns the selected scene when it still exists in the loaded config.
     * @returns {string} Active scene identifier or an empty string.
     */
    function activeSceneId() {
      const config = getConfig();
      const scenes = Array.isArray(config?.scenes) ? config.scenes : [];
      const selectedSceneId = getSelectedSceneId();
      if (selectedSceneId && scenes.some((scene) => scene.id === selectedSceneId)) return selectedSceneId;
      return scenes[0]?.id || "";
    }

    /**
     * Returns a valid positive scale for one scene.
     * @param {string} [sceneId] Scene identifier.
     * @returns {number} Positive scene scale.
     */
    function sceneScaleFor(sceneId = activeSceneId()) {
      const setting = getSceneSettings()?.[sceneId] || {};
      const scale = Number(setting.scale ?? 1);
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    /**
     * Returns the scale of the currently active scene.
     * @returns {number} Active scene scale.
     */
    function activeSceneScale() {
      return sceneScaleFor(activeSceneId());
    }

    /**
     * Renders available scenes and synchronizes the selected scale input.
     * @returns {void}
     */
    function renderSceneSelect() {
      if (!elements.sceneSelect) return;
      const config = getConfig();
      const scenes = Array.isArray(config?.scenes) ? config.scenes : [];
      if (!scenes.length) {
        elements.sceneSelect.innerHTML = `<option value="">${escapeHtml(translate("noScenes"))}</option>`;
        elements.sceneSelect.value = "";
        elements.sceneSelect.disabled = true;
        setSelectedSceneId("");
        syncSceneInputs();
        return;
      }
      elements.sceneSelect.innerHTML = scenes
        .map(
          (scene) =>
            `<option value="${escapeHtml(scene.id)}">${escapeHtml(scene.label || scene.path || scene.id)}</option>`,
        )
        .join("");
      const sceneId = activeSceneId();
      setSelectedSceneId(sceneId);
      elements.sceneSelect.value = sceneId;
      elements.sceneSelect.disabled = false;
      if (sceneId) writeStorage("xsxbFrameTuner.scene", sceneId);
      syncSceneInputs();
    }

    /**
     * Synchronizes scene selector and scale input from current state.
     * @returns {void}
     */
    function syncSceneInputs() {
      if (!elements.sceneScale) return;
      const sceneId = activeSceneId();
      if (elements.sceneSelect && sceneId) elements.sceneSelect.value = sceneId;
      elements.sceneScale.disabled = !sceneId;
      elements.sceneScale.value = String(round(sceneScaleFor(sceneId)));
    }

    /**
     * Applies the scene scale input to the current scene settings.
     * @returns {void}
     */
    function updateSceneScaleFromInput() {
      const sceneId = activeSceneId();
      if (!sceneId || !elements.sceneScale) return;
      const parsedScale = Number(elements.sceneScale.value || 1);
      const nextScale = Number.isFinite(parsedScale) ? Math.max(0.01, parsedScale) : 1;
      const sceneSettings = getSceneSettings();
      if (nearlyEqual(nextScale, 1)) {
        delete sceneSettings[sceneId];
      } else {
        sceneSettings[sceneId] = {
          ...(sceneSettings[sceneId] || {}),
          scale: nextScale,
        };
      }
      markDirty();
      updateSaveState();
      draw();
    }

    /**
     * Collects only non-default, valid scene scales for persistence.
     * @returns {Record<string,{scale:number}>} Serializable scene settings.
     */
    function collectSceneSettings() {
      const result = {};
      for (const [sceneId, setting] of Object.entries(getSceneSettings() || {})) {
        const scale = Number(setting?.scale ?? 1);
        if (Number.isFinite(scale) && scale > 0 && !nearlyEqual(scale, 1)) {
          result[sceneId] = { scale };
        }
      }
      return result;
    }

    /**
     * Persists a scene selection without making storage a hard dependency.
     * @param {string} key Storage key.
     * @param {string} value Storage value.
     * @returns {void}
     */
    function writeStorage(key, value) {
      try {
        storage?.setItem(key, value);
      } catch (_error) {
        // Scene selection remains available in memory when storage is blocked.
      }
    }

    return {
      activeSceneId,
      activeSceneScale,
      collectSceneSettings,
      renderSceneSelect,
      sceneScaleFor,
      syncSceneInputs,
      updateSceneScaleFromInput,
    };
  }

  /**
   * Resolves localStorage without throwing in privacy-restricted contexts.
   * @param {typeof globalThis} scope Browser global object.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage(scope) {
    try {
      return scope.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  return { createController };
});
