(function attachXsxbAppProjectState(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppProjectState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** @type {readonly ["home","kunkun","dark","light"]} Supported workbench themes. */
  const UI_THEMES = Object.freeze(["home", "kunkun", "dark", "light"]);

  /** @type {Readonly<Record<"home"|"kunkun"|"dark"|"light", string>>} Browser chrome colors by theme. */
  const THEME_COLORS = Object.freeze({
    home: "#0b0d0c",
    kunkun: "#09080d",
    dark: "#141922",
    light: "#edf1f4",
  });

  /**
   * Normalizes persisted or user-selected theme values.
   * @param {unknown} theme Raw theme value.
   * @returns {"home"|"kunkun"|"dark"|"light"} Supported theme, defaulting to the homepage style.
   */
  function normalizeThemePreference(theme) {
    return UI_THEMES.includes(theme) ? theme : "home";
  }

  /**
   * Creates the small state, localization, and project-key helpers used by the
   * workbench. Mutable editor state stays in app.js and is accessed through the
   * injected state facade so this module has no hidden application singleton.
   * @param {object} [dependencies] State facade and UI collaborators.
   * @returns {object} Project-state operations.
   */
  function createController(dependencies = {}) {
    const {
      state = {},
      elements = state.elements || {},
      messages = {},
      documentRef = root?.document || {},
      windowRef = root?.window || root || {},
      confirm = (message) => windowRef.confirm?.(message) ?? true,
      storage = resolveStorage(root),
      projectLabel = (project) => project?.label || project?.name || project?.id || "",
      frameImageAttachmentClipboardItem = (attachment) => attachment,
      normalizeFrameImageAttachment = (attachment) => attachment,
      cloneValue = (value) =>
        typeof root?.structuredClone === "function"
          ? root.structuredClone(value)
          : JSON.parse(JSON.stringify(value)),
      normalizeThemeValue = normalizeThemePreference,
      normalizeColorValue = (value, fallback = "#000000") => {
        const text = String(value || "").trim();
        return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
      },
      newLocalId = (prefix) => `${prefix}-${Date.now()}`,
      updateSaveStateImpl = () => updateSaveState(),
      updateHistoryControls = () => {},
      renderTunerUpdateStatus = () => {},
      renderHomeHub = () => {},
      renderSceneSelect = () => {},
      renderProfileSelect = () => {},
      renderGroupSelect = () => {},
      renderChainGroupSelect = () => {},
      renderFilmstrip = () => {},
      syncFrameAudioInputs = () => {},
      updateCanvasTitle = () => {},
      updateCoordHud = () => {},
      syncAdjustmentInputs = () => {},
      syncFrameInputs = () => {},
      draw = () => {},
      setAdjustmentMode = () => {},
      setSingleFrameSelection = () => {},
      selectedFrameIndexes = () => [],
      selectedFrameAttachment = () => null,
      frameImageAttachmentsForFrame = () => [],
      directManipulationAttachment = () => null,
      pushUndo = () => {},
      loadImageCached = async () => {},
      resetProjectSession = () => {},
      loadConfig = async () => {},
      resizeCanvas = () => {},
      activeProjectId = () => state.config?.activeProjectId || state.selectedProjectId || "",
    } = dependencies;

    /**
     * Returns a state value while allowing the facade to omit optional fields.
     * @param {string} key State property.
     * @param {unknown} fallback Value used when the field is undefined.
     * @returns {unknown} Current state value.
     */
    function readState(key, fallback) {
      return state[key] === undefined ? fallback : state[key];
    }

    /**
     * Translates one message and interpolates its named variables.
     * @param {string} key Message key.
     * @param {Record<string,unknown>} [vars] Interpolation values.
     * @returns {string} Localized message.
     */
    function t(key, vars = {}) {
      const language = readState("language", "zh");
      const table = messages[language] || messages.zh || {};
      const template = table[key] ?? messages.zh?.[key] ?? key;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) => vars[name] ?? "");
    }

    /**
     * Applies the current language to visible labels and dependent panels.
     * @returns {void}
     */
    function applyLanguage() {
      const language = readState("language", "zh") === "en" ? "en" : "zh";
      state.language = language;
      if (documentRef.documentElement) documentRef.documentElement.lang = language === "zh" ? "zh-CN" : "en";
      for (const button of elements.languageButtons || []) {
        const active = button.dataset.language === language;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
      documentRef.querySelectorAll?.("[data-i18n]").forEach((node) => {
        node.textContent = t(node.dataset.i18n);
      });
      documentRef.querySelectorAll?.("[data-i18n-placeholder]").forEach((node) => {
        node.placeholder = t(node.dataset.i18nPlaceholder);
      });
      documentRef.querySelectorAll?.("[data-i18n-title]").forEach((node) => {
        node.title = t(node.dataset.i18nTitle);
        if (node.hasAttribute("aria-label")) node.setAttribute("aria-label", t(node.dataset.i18nTitle));
      });
      documentRef.querySelectorAll?.("[data-i18n-aria-label]").forEach((node) => {
        const valueKey = node.dataset.i18nValue;
        node.setAttribute(
          "aria-label",
          t(node.dataset.i18nAriaLabel, valueKey ? { value: t(valueKey) } : undefined),
        );
      });
      if (elements.refreshProject)
        elements.refreshProject.setAttribute("aria-label", t("refreshAnimationList"));
      readState("batchCutout", null)?.setLanguage?.(language);
      readState("frameOrganizer", null)?.setLanguage?.(language);
      updateSaveStateImpl();
      updateHistoryControls();
      syncFrameAudioInputs();
      updateCanvasTitle();
      updateCoordHud();
      if (state.config) {
        renderSceneSelect();
        renderProfileSelect();
        renderGroupSelect(state.currentGroup?.uiId);
        renderChainGroupSelect();
        renderFilmstrip();
        status(loadedStatusText());
      }
      renderHomeHub();
    }

    /**
     * Normalizes a theme preference.
     * @param {unknown} theme Raw theme value.
     * @returns {"home"|"kunkun"|"dark"|"light"} Valid theme.
     */
    function normalizeTheme(theme) {
      return normalizeThemeValue(theme);
    }

    /**
     * Normalizes a six-digit hexadecimal color.
     * @param {unknown} value Raw color value.
     * @param {string} [fallback] Fallback color.
     * @returns {string} Valid hexadecimal color.
     */
    function normalizeColor(value, fallback = "#000000") {
      return normalizeColorValue(value, fallback);
    }

    /**
     * Applies the persisted UI theme to body and theme controls.
     * @returns {void}
     */
    function applyUiTheme() {
      const theme = normalizeTheme(readState("uiTheme", "home"));
      state.uiTheme = theme;
      for (const themeName of UI_THEMES) {
        documentRef.body?.classList.toggle(`theme-${themeName}`, theme === themeName);
      }
      documentRef.querySelector?.('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
      for (const button of elements.themeButtons || []) {
        const active = button.dataset.theme === theme;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
    }

    /**
     * Applies and persists the canvas background color.
     * @returns {void}
     */
    function applyCanvasColor() {
      const canvasColor = normalizeColor(readState("canvasColor", "#000000"));
      state.canvasColor = canvasColor;
      documentRef.documentElement?.style?.setProperty("--canvas-bg", canvasColor);
      if (elements.canvasColor) elements.canvasColor.value = canvasColor;
    }

    /**
     * Writes a status message to the workbench status region.
     * @param {string} text Status text.
     * @returns {void}
     */
    function status(text) {
      if (!elements.status) return;
      elements.status.textContent = text;
      elements.status.hidden = !text;
    }

    /**
     * Builds the localized status shown after project loading.
     * @returns {string} Loaded project status.
     */
    function loadedStatusText() {
      const config = state.config;
      if (!config) return t("ready");
      const projectName = projectLabel(config.activeProject);
      const projectPath = config.projectRoot || config.workspaceRoot || config.root;
      const warningText =
        Array.isArray(config.warnings) && config.warnings.length
          ? t("warnings", { warnings: config.warnings.join("\n") })
          : "";
      return t("loadedStatus", {
        project: projectName,
        count: config.groups?.length || 0,
        path: projectPath,
        warnings: warningText,
      });
    }

    /**
     * Synchronizes save controls with the current dirty state.
     * @returns {void}
     */
    function updateSaveState() {
      if (!elements.saveState || !elements.save) return;
      const saveInFlight = Boolean(readState("saveInFlight", false));
      const dirty = Boolean(readState("dirty", false));
      const lastSavedAt = readState("lastSavedAt", "");
      const label = saveInFlight
        ? t("saving")
        : dirty
          ? t("unsavedChanges")
          : lastSavedAt
            ? t("savedAt", { time: lastSavedAt })
            : t("noChanges");
      elements.saveState.textContent = label;
      elements.saveState.classList.toggle("dirty", dirty);
      elements.save.disabled = saveInFlight;
      elements.save.textContent = saveInFlight ? t("saving") : dirty ? t("saveTuningDirty") : t("saveTuning");
      documentRef.body?.classList.toggle("hasUnsavedChanges", dirty);
      renderTunerUpdateStatus();
    }

    /**
     * Marks the workbench dirty and records the edit timestamp.
     * @returns {void}
     */
    function markDirty() {
      state.editRevision = Number(readState("editRevision", 0)) + 1;
      state.dirty = true;
      try {
        storage?.setItem("xsxbFrameTuner.lastEditedAt", new Date().toISOString());
      } catch (_error) {
        // Memory state remains authoritative when storage is unavailable.
      }
      updateSaveStateImpl();
      renderHomeHub();
    }

    /**
     * Marks the workbench clean after a successful save.
     * @returns {void}
     */
    function markClean() {
      state.dirty = false;
      state.lastSavedAt = new Date().toLocaleTimeString();
      updateSaveStateImpl();
    }

    /**
     * Reloads the active project after handling unsaved edits.
     * @returns {Promise<void>} Resolves when the project has reloaded.
     */
    async function refreshActiveProject() {
      if (readState("dirty", false) && !(await confirm(t("projectRefreshConfirm"), { tone: "warning" })))
        return;
      resetProjectSession();
      state.dirty = false;
      state.editRevision = Number(readState("editRevision", 0)) + 1;
      readState("imageCache", null)?.clear?.();
      await loadConfig();
      resizeCanvas();
    }

    /**
     * Builds a stable key for a group and frame index.
     * @param {string} groupName Runtime group name.
     * @param {number|string} index Frame index.
     * @returns {string} Stable key.
     */
    function keyFor(groupName, index) {
      return `${groupName}:${index}`;
    }

    /**
     * Returns the runtime animation name of a group.
     * @param {object|null} [group] Animation group.
     * @returns {string} Runtime animation name.
     */
    function tuningAnimationName(group = state.currentGroup) {
      return group?.runtimeAnimation || group?.name || "";
    }

    /**
     * Maps a displayed frame to its source frame.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {number} Source frame index.
     */
    function sourceFrameIndex(index = readState("selectedFrame", 0), group = state.currentGroup) {
      if (!group || !Array.isArray(group.sourceFrameIndices) || !group.sourceFrameIndices.length)
        return index;
      return Number(group.sourceFrameIndices[index] ?? index);
    }

    /**
     * Returns the persisted tuning key for a frame.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {string} Tuning key.
     */
    function tuningFrameKey(index = readState("selectedFrame", 0), group = state.currentGroup) {
      return keyFor(tuningAnimationName(group), sourceFrameIndex(index, group));
    }

    /**
     * Returns the active project identifier.
     * @returns {string} Active project identifier.
     */
    function getActiveProjectId() {
      return activeProjectId();
    }

    /**
     * Returns the stable frame-audio key.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {string} Audio key.
     */
    function frameAudioKey(index = readState("selectedFrame", 0), group = state.currentGroup) {
      if (!group) return "";
      return [
        getActiveProjectId(),
        group.tuningTarget || "player",
        group.profileId || "all",
        group.type || "animation",
        group.name || "",
        group.source || "",
        sourceFrameIndex(index, group),
      ].join(":");
    }

    /**
     * Builds audio metadata for one frame.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object|null} Audio metadata.
     */
    function frameAudioMetadata(index = readState("selectedFrame", 0), group = state.currentGroup) {
      if (!group) return null;
      const frame = sourceFrameIndex(index, group);
      return {
        projectId: getActiveProjectId(),
        tuningTarget: group.tuningTarget || "player",
        profileId: group.profileId || "all",
        groupType: group.type || "animation",
        animation: tuningAnimationName(group),
        source: group.source || "",
        frame,
        displayFrame: index,
      };
    }

    /**
     * Parses a persisted audio key, including legacy keys.
     * @param {string} key Serialized audio key.
     * @returns {object|null} Parsed metadata.
     */
    function frameAudioMetadataFromKey(key) {
      const parts = String(key || "").split(":");
      if (parts.length < 6) return null;
      const frame = Number(parts[parts.length - 1]);
      if (!Number.isFinite(frame)) return null;
      if (parts.length >= 7) {
        return {
          projectId: parts[0] || "default",
          tuningTarget: parts[1] || "player",
          profileId: parts[2] || "all",
          groupType: parts[3] || "animation",
          animation: parts[4] || "",
          source: parts.slice(5, -1).join(":"),
          frame,
          displayFrame: frame,
        };
      }
      return {
        projectId: "legacy",
        tuningTarget: parts[0] || "player",
        profileId: parts[1] || "all",
        groupType: parts[2] || "animation",
        animation: parts[3] || "",
        source: parts.slice(4, -1).join(":"),
        frame,
        displayFrame: frame,
      };
    }

    /**
     * Returns the stable frame-attachment key.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {string} Attachment key.
     */
    function frameImageAttachmentKey(index = readState("selectedFrame", 0), group = state.currentGroup) {
      return frameAudioKey(index, group);
    }

    /**
     * Returns attachment metadata for one frame.
     * @param {number} [index] Displayed frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object|null} Attachment metadata.
     */
    function frameImageAttachmentMetadata(index = readState("selectedFrame", 0), group = state.currentGroup) {
      return frameAudioMetadata(index, group);
    }

    /**
     * Reports whether a selected attachment can be manipulated directly.
     * @returns {boolean} Whether direct manipulation is available.
     */
    function canDirectManipulateSelectedAttachment() {
      return Boolean(directManipulationAttachment());
    }

    /**
     * Activates an attachment for frame editing.
     * @param {object|null} attachment Attachment to activate.
     * @returns {boolean} Whether the selection changed.
     */
    function activateFrameAttachmentForEditing(attachment) {
      if (!attachment) return false;
      const changed =
        state.selectedAttachmentId !== attachment.id || readState("adjustmentMode", "group") !== "frame";
      state.selectedAttachmentId = attachment.id;
      state.adjustmentMode = "frame";
      try {
        storage?.setItem("xsxbFrameTuner.adjustmentMode", "frame");
      } catch (_error) {
        // Memory state remains authoritative when storage is unavailable.
      }
      syncAdjustmentInputs();
      syncFrameInputs();
      if (changed) renderFilmstrip();
      return changed;
    }

    /**
     * Selects one attachment and synchronizes the frame controls.
     * @param {object|null} attachment Attachment to select.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {void}
     */
    function selectFrameImageAttachment(
      attachment,
      index = readState("selectedFrame", 0),
      group = state.currentGroup,
    ) {
      if (!attachment || !group) return;
      state.selectedAttachmentId = attachment.id;
      setSingleFrameSelection(index, group);
      if (readState("adjustmentMode", "group") !== "frame") setAdjustmentMode("frame");
      else syncAdjustmentInputs();
      syncFrameInputs();
      renderFilmstrip();
      draw();
    }

    /**
     * Clears the explicit attachment selection.
     * @returns {void}
     */
    function clearSelectedAttachment() {
      state.selectedAttachmentId = "";
    }

    /**
     * Copies the selected frame attachments to the in-memory clipboard.
     * @returns {boolean} Whether anything was copied.
     */
    function copyFrameImageAttachments() {
      const group = state.currentGroup;
      if (!group) return false;
      const selectedAttachment = selectedFrameAttachment();
      const attachments = selectedAttachment
        ? [selectedAttachment]
        : frameImageAttachmentsForFrame(readState("selectedFrame", 0), group);
      if (!attachments.length) {
        status(t("frameAttachmentCopyEmpty"));
        return false;
      }
      state.frameImageAttachmentClipboard = attachments.map(frameImageAttachmentClipboardItem);
      state.frameImageAttachmentClipboardProjectId = getActiveProjectId();
      status(t("frameAttachmentCopied", { count: state.frameImageAttachmentClipboard.length }));
      return true;
    }

    /**
     * Pastes copied attachments onto every selected frame.
     * @returns {boolean} Whether anything was pasted.
     */
    function pasteFrameImageAttachments() {
      const group = state.currentGroup;
      if (!group) return false;
      const clipboard = readState("frameImageAttachmentClipboard", []);
      if (!clipboard.length) {
        status(t("frameAttachmentPasteEmpty"));
        return false;
      }
      const clipboardProjectId = readState("frameImageAttachmentClipboardProjectId", "");
      if (clipboardProjectId && clipboardProjectId !== getActiveProjectId()) {
        status(t("frameAttachmentPasteProjectMismatch"));
        return false;
      }
      const targetFrames = selectedFrameIndexes(group);
      if (!targetFrames.length) return false;
      pushUndo("paste attached image");
      const created = [];
      for (const frameIndex of targetFrames) {
        for (const copied of clipboard) {
          const attachment = normalizeFrameImageAttachment({
            ...cloneValue(copied),
            id: newLocalId("layer"),
            key: frameImageAttachmentKey(frameIndex, group),
            metadata: frameImageAttachmentMetadata(frameIndex, group),
          });
          state.frameImageAttachments.push(attachment);
          created.push(attachment);
          loadImageCached(attachment).catch(() => null);
        }
      }
      if (created.length === 1 && targetFrames.length === 1) {
        state.selectedAttachmentId = created[0].id;
        state.adjustmentMode = "frame";
      } else {
        clearSelectedAttachment();
      }
      markDirty();
      syncFrameInputs();
      renderFilmstrip();
      draw();
      status(t("frameAttachmentPasted", { count: created.length }));
      return true;
    }

    /**
     * Returns the audio binding for one frame.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @returns {object|null} Audio binding.
     */
    function frameAudioBinding(index = readState("selectedFrame", 0), group = state.currentGroup) {
      return readState("frameAudioBindings", {})[frameAudioKey(index, group)] || null;
    }

    /**
     * Revokes a binding's object URL when one exists.
     * @param {object|null} binding Audio binding.
     * @returns {void}
     */
    function revokeFrameAudioBinding(binding) {
      if (binding?.url) root?.URL?.revokeObjectURL?.(binding.url);
    }

    /**
     * Clears all loaded frame-audio bindings.
     * @returns {void}
     */
    function resetFrameAudioBindings() {
      const bindings = readState("frameAudioBindings", {});
      for (const binding of Object.values(bindings)) revokeFrameAudioBinding(binding);
      state.frameAudioBindings = {};
    }

    /**
     * Gets or reconstructs a binding key from persisted metadata.
     * @param {object|null} binding Audio binding.
     * @returns {string} Binding key.
     */
    function frameAudioKeyFromBinding(binding) {
      if (binding?.key) return String(binding.key);
      const metadata = binding?.metadata || {};
      if (!metadata.animation || !Number.isFinite(Number(metadata.frame))) return "";
      return [
        metadata.projectId || getActiveProjectId(),
        metadata.tuningTarget || "player",
        metadata.profileId || "all",
        metadata.groupType || "animation",
        metadata.animation,
        metadata.source || "",
        Number(metadata.frame),
      ].join(":");
    }

    /**
     * Loads persisted frame-audio bindings for the active project.
     * @returns {void}
     */
    function loadFrameAudioBindingsFromProject() {
      const config = state.config;
      const bindings = Array.isArray(config?.frameAudioBindings) ? config.frameAudioBindings : [];
      const target = readState("frameAudioBindings", {});
      for (const rawBinding of bindings) {
        const binding = rawBinding && typeof rawBinding === "object" ? rawBinding : null;
        if (!binding) continue;
        const key = frameAudioKeyFromBinding(binding);
        if (!key || (!binding.data && !binding.path && !binding.file)) continue;
        const metadata = binding.metadata || frameAudioMetadataFromKey(key);
        if (metadata?.projectId && metadata.projectId !== getActiveProjectId()) continue;
        revokeFrameAudioBinding(target[key]);
        target[key] = {
          key,
          name: binding.name || "audio",
          type: binding.type || "",
          size: Number(binding.size || 0),
          metadata,
          data: binding.data || "",
          path: binding.path || binding.file || "",
        };
      }
      state.frameAudioBindings = target;
    }

    /**
     * Returns the group-level playback key.
     * @param {object|null} [group] Animation group.
     * @returns {string} Playback key.
     */
    function groupPlaybackKey(group = state.currentGroup) {
      return keyFor(tuningAnimationName(group), dependencies.groupPlaybackFrame ?? "__group");
    }

    /**
     * Checks whether a tuning key belongs to a group.
     * @param {object|null} group Animation group.
     * @param {string} key Tuning key.
     * @returns {boolean} Whether the group owns the key.
     */
    function groupOwnsFrameKey(group, key) {
      if (!group || !key.startsWith(`${tuningAnimationName(group)}:`)) return false;
      if (key === groupPlaybackKey(group)) return true;
      if (!Array.isArray(group.sourceFrameIndices) || !group.sourceFrameIndices.length) return true;
      const frameIndex = Number(String(key).slice(String(key).lastIndexOf(":") + 1));
      return group.sourceFrameIndices.includes(frameIndex);
    }

    /**
     * Selects the frame-visual override store for a group.
     * @param {object|null} [group] Animation group.
     * @returns {Record<string,unknown>} Override store.
     */
    function overrideStore(group = state.currentGroup) {
      if (!group) return state.frameOverrides;
      if (group.tuningTarget === "boss") return state.bossFrameOverrides;
      if (group.tuningTarget === "act2_statue_boss") return state.act2StatueBossFrameOverrides;
      if (group.tuningTarget === "huang_xian") return state.huangXianFrameOverrides;
      if (group.tuningTarget === "soul") return state.soulFrameOverrides;
      if (group.tuningTarget === "yecheng_props") return state.yechengPropFrameOverrides;
      return group.type === "vfx" ? state.vfxFrameOverrides : state.frameOverrides;
    }

    /**
     * Selects the playback override store for a group.
     * @param {object|null} [group] Animation group.
     * @returns {Record<string,unknown>} Playback store.
     */
    function playbackStore(group = state.currentGroup) {
      if (!group) return state.framePlaybackOverrides;
      if (group.tuningTarget === "boss") return state.bossPlaybackOverrides;
      if (group.tuningTarget === "act2_statue_boss") return state.act2StatueBossPlaybackOverrides;
      if (group.tuningTarget === "huang_xian") return state.huangXianPlaybackOverrides;
      if (group.tuningTarget === "soul") return state.soulPlaybackOverrides;
      return group.type === "vfx" ? state.vfxPlaybackOverrides : state.framePlaybackOverrides;
    }

    /**
     * Selects the frame-box override store for a group.
     * @param {object|null} [group] Animation group.
     * @returns {Record<string,unknown>} Box override store.
     */
    function boxOverrideStore(group = state.currentGroup) {
      return group?.tuningTarget === "soul" ? state.soulFrameBoxOverrides : state.frameBoxOverrides;
    }

    /**
     * Selects the tuning-value store for a group.
     * @param {object|null} [group] Animation group.
     * @returns {Record<string,unknown>} Tuning values.
     */
    function valueStore(group = state.currentGroup) {
      if (group?.tuningTarget === "boss") return state.bossValues;
      if (group?.tuningTarget === "act2_statue_boss") return state.act2StatueBossValues;
      if (group?.tuningTarget === "huang_xian") return state.huangXianValues;
      if (group?.tuningTarget === "soul") return state.soulValues;
      if (group?.tuningTarget === "yecheng_props") return state.yechengPropValues;
      return state.values;
    }

    /**
     * Tests whether a group advertises a profile capability.
     * @param {object|null} group Animation group.
     * @param {string} feature Capability name.
     * @returns {boolean} Whether the feature is supported.
     */
    function groupSupports(group, feature) {
      if (!group || !Array.isArray(group.profileSupports) || !group.profileSupports.length) return true;
      return group.profileSupports.includes(feature);
    }

    function canEditGroupTransform(group = state.currentGroup) {
      return groupSupports(group, "group_transform");
    }

    function canEditFrameTransform(group = state.currentGroup) {
      return groupSupports(group, "frame_transform");
    }

    function canEditFramePlayback(group = state.currentGroup) {
      return groupSupports(group, "frame_playback");
    }

    function canUseReferenceFrame(group = state.currentGroup) {
      return canEditFrameTransform(group) || groupSupports(group, "reference_frame");
    }

    return Object.freeze({
      activateFrameAttachmentForEditing,
      activeProjectId: getActiveProjectId,
      applyCanvasColor,
      applyLanguage,
      applyUiTheme,
      boxOverrideStore,
      canDirectManipulateSelectedAttachment,
      canEditFramePlayback,
      canEditFrameTransform,
      canEditGroupTransform,
      canUseReferenceFrame,
      clearSelectedAttachment,
      copyFrameImageAttachments,
      frameAudioBinding,
      frameAudioKey,
      frameAudioKeyFromBinding,
      frameAudioMetadata,
      frameAudioMetadataFromKey,
      frameImageAttachmentKey,
      frameImageAttachmentMetadata,
      framePlaybackKey: groupPlaybackKey,
      getActiveProjectId,
      groupOwnsFrameKey,
      groupPlaybackKey,
      groupSupports,
      keyFor,
      loadedStatusText,
      loadFrameAudioBindingsFromProject,
      markClean,
      markDirty,
      normalizeColor,
      normalizeTheme,
      overrideStore,
      pasteFrameImageAttachments,
      playbackStore,
      refreshActiveProject,
      resetFrameAudioBindings,
      revokeFrameAudioBinding,
      selectFrameImageAttachment,
      sourceFrameIndex,
      status,
      t,
      tuningAnimationName,
      tuningFrameKey,
      updateSaveState,
      valueStore,
    });
  }

  /**
   * Resolves localStorage without throwing in privacy-restricted contexts.
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

  return Object.freeze({ createController });
});
