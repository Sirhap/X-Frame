(function attachXsxbAppBoxSelection(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppBoxSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the collision-box selection and preference controller.
   * @param {{
   *   boxNames:string[],
   *   boxPrefKeys:{show:string,only:string,selected:string,checked:string},
   *   getSelectedBoxes:()=>Set<string>,
   *   getSelectedBox:()=>string,
   *   setSelectedBox:(value:string)=>void,
   *   getCurrentGroup?:()=>object|null,
   *   canEditBox:(boxName:string,group:object|null)=>boolean,
   *   getShowBoxes?:()=>boolean,
   *   storage?:Storage|null,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   selectedBoxNames:()=>string[],
   *   firstEditableSelectedBox:(group?:object|null)=>string,
   *   normalizeBoxSelectionForGroup:(group?:object|null)=>boolean,
   *   saveBoxViewPrefs:()=>void,
   * }} Box selection operations.
   */
  function createController(dependencies) {
    const {
      boxNames,
      boxPrefKeys,
      getSelectedBoxes,
      getSelectedBox,
      setSelectedBox,
      getCurrentGroup = () => null,
      canEditBox,
      getShowBoxes = () => false,
      storage = resolveStorage(root),
    } = dependencies;

    /**
     * Returns selected box names in the canonical draw order.
     * @returns {string[]} Selected supported box names.
     */
    function selectedBoxNames() {
      const selectedBoxes = getSelectedBoxes();
      return boxNames.filter((boxName) => selectedBoxes?.has(boxName));
    }

    /**
     * Finds the first selected box editable for the requested group.
     * @param {object|null} [group] Animation group.
     * @returns {string} Editable box name or an empty string.
     */
    function firstEditableSelectedBox(group = getCurrentGroup()) {
      const selectedBoxes = getSelectedBoxes();
      return boxNames.find((boxName) => selectedBoxes?.has(boxName) && canEditBox(boxName, group)) || "";
    }

    /**
     * Removes unsupported selections and guarantees one valid active box.
     * @param {object|null} [group] Animation group.
     * @returns {boolean} Whether selection state changed.
     */
    function normalizeBoxSelectionForGroup(group = getCurrentGroup()) {
      const selectedBoxes = getSelectedBoxes();
      let changed = false;
      for (const boxName of [...selectedBoxes]) {
        if (!canEditBox(boxName, group)) {
          selectedBoxes.delete(boxName);
          changed = true;
        }
      }
      let selectedBox = getSelectedBox();
      if (selectedBox && !canEditBox(selectedBox, group)) {
        selectedBox = firstEditableSelectedBox(group);
        setSelectedBox(selectedBox);
        changed = true;
      }
      if (!selectedBox) {
        const nextBox = firstEditableSelectedBox(group);
        if (nextBox) {
          selectedBox = nextBox;
          setSelectedBox(nextBox);
          changed = true;
        }
      }
      if (selectedBox && !selectedBoxes.has(selectedBox)) {
        selectedBoxes.add(selectedBox);
        changed = true;
      }
      return changed;
    }

    /**
     * Persists collision-box visibility and selection preferences.
     * @returns {void}
     */
    function saveBoxViewPrefs() {
      writeStorage(boxPrefKeys.show, getShowBoxes() ? "true" : "false");
      writeStorage(boxPrefKeys.only, "false");
      writeStorage(boxPrefKeys.selected, getSelectedBox() || "");
      writeStorage(boxPrefKeys.checked, selectedBoxNames().join(","));
    }

    /**
     * Writes one preference without allowing blocked storage to break editing.
     * @param {string} key Preference key.
     * @param {string} value Preference value.
     * @returns {void}
     */
    function writeStorage(key, value) {
      try {
        storage?.setItem(key, value);
      } catch (_error) {
        // Browser storage is optional; in-memory selection remains active.
      }
    }

    return {
      firstEditableSelectedBox,
      normalizeBoxSelectionForGroup,
      saveBoxViewPrefs,
      selectedBoxNames,
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
