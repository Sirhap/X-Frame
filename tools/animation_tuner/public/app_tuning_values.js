(function attachXFrameAppTuningValues(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppTuningValues = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates pure collectors for the tuning payloads owned by each target.
   *
   * The collectors intentionally only read injected config and value stores;
   * save orchestration stays in app.js and can therefore keep its existing
   * request and revision semantics.
   *
   * @param {{
   *   getConfig?:()=>object|null,
   *   getValues?:()=>object,
   *   getBossValues?:()=>object,
   *   getAct2StatueBossValues?:()=>object,
   *   getHuangXianValues?:()=>object,
   *   getSoulValues?:()=>object,
   *   getYechengPropValues?:()=>object,
   * }} [dependencies] Injected project state.
   * @returns {{
   *   collectTuningValues:()=>object,
   *   collectBossTuningValues:()=>object,
   *   collectAct2StatueBossTuningValues:()=>object,
   *   collectHuangXianTuningValues:()=>object,
   *   collectSoulTuningValues:()=>object,
   *   collectYechengPropTuningValues:()=>object,
   * }} Tuning value collectors.
   */
  function createController(dependencies = {}) {
    const {
      getConfig = () => null,
      getValues = () => ({}),
      getBossValues = () => ({}),
      getAct2StatueBossValues = () => ({}),
      getHuangXianValues = () => ({}),
      getSoulValues = () => ({}),
      getYechengPropValues = () => ({}),
    } = dependencies;

    /**
     * Returns configured groups without exposing a mutable config fallback.
     * @returns {object[]} Configured animation groups.
     */
    function groups() {
      const config = getConfig();
      return Array.isArray(config?.groups) ? config.groups : [];
    }

    /**
     * Copies a configured value when its key exists in the target store.
     * @param {object} result Destination payload.
     * @param {object} values Target value store.
     * @param {string|undefined} key Configured value key.
     * @param {boolean} [hasKey] Whether the source code configured this key.
     * @returns {void}
     */
    function copyValue(result, values, key, hasKey = Boolean(key)) {
      if (hasKey && values[key] != null) result[key] = values[key];
    }

    /**
     * Collects standard character tuning values while deduplicating profile keys.
     * @returns {object} Player tuning payload.
     */
    function collectTuningValues() {
      const result = {};
      const seenProfiles = new Set();
      const values = getValues() || {};
      for (const group of groups().filter((entry) => !entry.tuningTarget)) {
        if (group.profileId && !seenProfiles.has(group.profileId)) {
          seenProfiles.add(group.profileId);
          copyValue(result, values, group.characterScale, Boolean(group.characterScale));
          copyValue(result, values, group.characterScaleVector, Boolean(group.characterScaleVector));
          copyValue(result, values, group.characterOffset, Boolean(group.characterOffset));
          copyValue(result, values, group.characterRotation, Boolean(group.characterRotation));
        }
        copyValue(result, values, group.scale, true);
        copyValue(result, values, group.scaleVector, Boolean(group.scaleVector));
        copyValue(result, values, group.offset, true);
        copyValue(result, values, group.rotation, Boolean(group.rotation));
        copyValue(result, values, group.anchor, Boolean(group.anchor));
      }
      return result;
    }

    /**
     * Collects tuning values for one target using scale, vector, and offset keys.
     * @param {string} tuningTarget Target discriminator.
     * @param {()=>object} getValuesForTarget Target value-store getter.
     * @param {boolean} includeAnchor Whether anchor keys are included.
     * @returns {object} Target tuning payload.
     */
    function collectTargetValues(tuningTarget, getValuesForTarget, includeAnchor = false) {
      const result = {};
      const values = getValuesForTarget() || {};
      for (const group of groups().filter((entry) => entry.tuningTarget === tuningTarget)) {
        copyValue(result, values, group.scale, true);
        copyValue(result, values, group.scaleVector, Boolean(group.scaleVector));
        copyValue(result, values, group.offset, true);
        if (includeAnchor) copyValue(result, values, group.anchor, Boolean(group.anchor));
      }
      return result;
    }

    /**
     * Collects boss tuning values.
     * @returns {object} Boss tuning payload.
     */
    function collectBossTuningValues() {
      return collectTargetValues("boss", getBossValues);
    }

    /**
     * Collects Act 2 statue boss tuning values.
     * @returns {object} Act 2 statue boss tuning payload.
     */
    function collectAct2StatueBossTuningValues() {
      return collectTargetValues("act2_statue_boss", getAct2StatueBossValues);
    }

    /**
     * Collects Huang Xian tuning values.
     * @returns {object} Huang Xian tuning payload.
     */
    function collectHuangXianTuningValues() {
      return collectTargetValues("huang_xian", getHuangXianValues);
    }

    /**
     * Collects Soul tuning values, including optional anchor keys.
     * @returns {object} Soul tuning payload.
     */
    function collectSoulTuningValues() {
      return collectTargetValues("soul", getSoulValues, true);
    }

    /**
     * Collects Yecheng prop tuning values.
     * @returns {object} Yecheng prop tuning payload.
     */
    function collectYechengPropTuningValues() {
      return collectTargetValues("yecheng_props", getYechengPropValues);
    }

    return Object.freeze({
      collectAct2StatueBossTuningValues,
      collectBossTuningValues,
      collectHuangXianTuningValues,
      collectSoulTuningValues,
      collectTuningValues,
      collectYechengPropTuningValues,
    });
  }

  return Object.freeze({ createController });
});
