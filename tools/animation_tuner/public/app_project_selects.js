(function attachXsxbProjectSelects(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppProjectSelects = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (globalScope) => {
  "use strict";

  /**
   * Creates the project/profile/group select renderers for the workbench.
   *
   * The controller deliberately owns no selection state. Accessors keep the
   * existing app.js state authoritative while making the select-panel
   * formatting and filtering independently testable.
   *
   * @param {object} [dependencies] DOM elements, state accessors, and helpers.
   * @returns {object} Project and group select operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getConfig = () => null,
      setSelectedProjectId = () => {},
      getSelectedProfileId = () => "all",
      setSelectedProfileId = () => {},
      getGroupSearch = () => "",
      getCurrentGroup = () => null,
      storage = globalScope?.localStorage,
      escapeHtml = (value) => String(value ?? ""),
      projectLabel = (project) => project?.id || "",
      groupLabel = (group) => group?.name || group?.uiId || "",
      translate = (key) => key,
    } = dependencies;

    /**
     * Renders the active project options and synchronizes the selected project.
     * @returns {void}
     */
    function renderProjectSelect() {
      if (!elements.projectSelect) return;
      const config = getConfig();
      const projects = Array.isArray(config?.projects) ? config.projects : [];
      elements.projectSelect.innerHTML = projects.length
        ? projects
            .map(
              (project) =>
                `<option value="${escapeHtml(project.id)}">${escapeHtml(projectLabel(project))}</option>`,
            )
            .join("")
        : `<option value="">No projects</option>`;
      const active = config?.activeProjectId || projects[0]?.id || "";
      setSelectedProjectId(active);
      if (active) storage?.setItem("xsxbFrameTuner.project", active);
      elements.projectSelect.value = active;
      elements.projectSelect.disabled = !projects.length;
      if (elements.clearProject) elements.clearProject.disabled = !active;
      if (elements.deleteProject) elements.deleteProject.disabled = !active;
    }

    /**
     * Returns groups matching the active profile and search query.
     * @returns {Array<object>} Filtered animation groups.
     */
    function filteredGroups() {
      const config = getConfig();
      if (!config?.groups) return [];
      const selectedProfileId = getSelectedProfileId();
      let groups =
        !selectedProfileId || selectedProfileId === "all"
          ? config.groups
          : config.groups.filter((group) => group.profileId === selectedProfileId);
      const query = String(getGroupSearch() || "")
        .trim()
        .toLowerCase();
      if (query) {
        groups = groups.filter((group) => {
          const haystack = [
            groupLabel(group),
            group.name,
            group.type,
            group.source,
            group.profileLabel,
            group.runtimeAnimation,
            group.profileKind,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        });
      }
      return groups;
    }

    /**
     * Builds profile options that are represented by configured groups.
     * @returns {Array<{id:string,label:string}>} Profile select options.
     */
    function profileOptionsFromConfig() {
      const config = getConfig();
      const profileIdsInUse = new Set((config?.groups || []).map((group) => group.profileId).filter(Boolean));
      const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
      return profiles
        .filter((profile) => profileIdsInUse.has(profile.id))
        .map((profile) => ({ id: profile.id, label: profile.label || profile.id }));
    }

    /**
     * Renders the profile filter options and normalizes its selected value.
     * @returns {void}
     */
    function renderProfileSelect() {
      if (!elements.profileSelect) return;
      const selectedProfileId = getSelectedProfileId();
      const options = [{ id: "all", label: translate("allCharacters") }, ...profileOptionsFromConfig()];
      elements.profileSelect.innerHTML = options
        .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`)
        .join("");
      const nextProfileId = options.some((profile) => profile.id === selectedProfileId)
        ? selectedProfileId
        : "all";
      setSelectedProfileId(nextProfileId);
      elements.profileSelect.value = nextProfileId;
    }

    /**
     * Renders the filtered animation group options.
     * @param {string} [selectedUiId] Group UI id to keep selected.
     * @returns {Array<object>} Groups rendered into the select.
     */
    function renderGroupSelect(selectedUiId = getCurrentGroup()?.uiId) {
      if (!elements.groupSelect) return [];
      const groups = filteredGroups();
      elements.groupSelect.innerHTML = groups.length
        ? groups
            .map(
              (group) =>
                `<option value="${escapeHtml(group.uiId)}">${escapeHtml(groupLabel(group))}</option>`,
            )
            .join("")
        : `<option value="">${escapeHtml(translate("noMatchingGroups"))}</option>`;
      elements.groupSelect.disabled = !groups.length;
      if (selectedUiId && groups.some((group) => group.uiId === selectedUiId)) {
        elements.groupSelect.value = selectedUiId;
      }
      return groups;
    }

    /**
     * Renders the optional chain-group selector.
     * @param {string} [selectedUiId] Group UI id to keep selected.
     * @returns {void}
     */
    function renderChainGroupSelect(selectedUiId = elements.chainGroupSelect?.value || "") {
      if (!elements.chainGroupSelect) return;
      const groups = getConfig()?.groups || [];
      elements.chainGroupSelect.innerHTML = [
        `<option value="">${escapeHtml(translate("none"))}</option>`,
        ...groups.map(
          (group) => `<option value="${escapeHtml(group.uiId)}">${escapeHtml(groupLabel(group))}</option>`,
        ),
      ].join("");
      elements.chainGroupSelect.value = selectedUiId || "";
    }

    return {
      filteredGroups,
      profileOptionsFromConfig,
      renderChainGroupSelect,
      renderGroupSelect,
      renderProfileSelect,
      renderProjectSelect,
    };
  }

  return { createController };
});
