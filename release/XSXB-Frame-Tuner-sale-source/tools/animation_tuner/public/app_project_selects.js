(function attachXsxbProjectSelects(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppProjectSelects = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (globalScope) => {
  "use strict";

  const GROUP_SEARCH_THRESHOLD = 8;

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
      setSelectedProfileId = () => {},
      getGroupSearch = () => "",
      setGroupSearch = () => {},
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
      const activeProject = projects.find((project) => project.id === active) || projects[0];
      if (elements.currentProjectLabel) {
        elements.currentProjectLabel.textContent = activeProject ? projectLabel(activeProject) : "—";
      }
      elements.projectContext?.classList?.toggle("singleProject", projects.length <= 1);
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
      let groups = config.groups;
      const query = String(groups.length > GROUP_SEARCH_THRESHOLD ? getGroupSearch() || "" : "")
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
     * Clears the retired profile filter while preserving legacy controller calls.
     * Character/profile grouping is now represented directly inside the animation select.
     * @returns {void}
     */
    function renderProfileSelect() {
      setSelectedProfileId("all");
      storage?.removeItem?.("animationTuner.profile");
    }

    /**
     * Builds animation options, grouping multiple characters without exposing a second selector.
     * @param {Array<object>} groups Animation groups to render.
     * @returns {string} Escaped option and optgroup markup.
     */
    function groupOptionsMarkup(groups) {
      const profileKeys = new Set(groups.map((group) => group.profileId || group.profileLabel || ""));
      if (profileKeys.size <= 1) {
        return groups
          .map(
            (group) => `<option value="${escapeHtml(group.uiId)}">${escapeHtml(groupLabel(group))}</option>`,
          )
          .join("");
      }

      const groupedAnimations = new Map();
      for (const group of groups) {
        const profileLabel = group.profileLabel || translate("otherAnimations");
        if (!groupedAnimations.has(profileLabel)) groupedAnimations.set(profileLabel, []);
        groupedAnimations.get(profileLabel).push(group);
      }
      return Array.from(groupedAnimations, ([profileLabel, profileGroups]) => {
        const prefix = `${profileLabel} - `;
        const options = profileGroups
          .map((group) => {
            const fullLabel = groupLabel(group);
            const animationLabel = fullLabel.startsWith(prefix)
              ? fullLabel.slice(prefix.length)
              : group.name || fullLabel;
            return `<option value="${escapeHtml(group.uiId)}">${escapeHtml(animationLabel)}</option>`;
          })
          .join("");
        return `<optgroup label="${escapeHtml(profileLabel)}">${options}</optgroup>`;
      }).join("");
    }

    /**
     * Renders the filtered animation group options.
     * @param {string} [selectedUiId] Group UI id to keep selected.
     * @returns {Array<object>} Groups rendered into the select.
     */
    function renderGroupSelect(selectedUiId = getCurrentGroup()?.uiId) {
      if (!elements.groupSelect) return [];
      const configuredGroups = Array.isArray(getConfig()?.groups) ? getConfig().groups : [];
      const searchable = configuredGroups.length > GROUP_SEARCH_THRESHOLD;
      if (!searchable && getGroupSearch()) {
        setGroupSearch("");
        storage?.removeItem?.("animationTuner.groupSearch");
      }
      const groups = filteredGroups();
      elements.groupSelect.innerHTML = groups.length
        ? groupOptionsMarkup(groups)
        : `<option value="">${escapeHtml(translate("noMatchingGroups"))}</option>`;
      elements.groupSelect.disabled = !groups.length;
      if (elements.groupSearch) elements.groupSearch.disabled = !configuredGroups.length;
      if (elements.groupFilterField) elements.groupFilterField.hidden = !searchable;
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
      groupOptionsMarkup,
      renderChainGroupSelect,
      renderGroupSelect,
      renderProfileSelect,
      renderProjectSelect,
    };
  }

  return { createController };
});
