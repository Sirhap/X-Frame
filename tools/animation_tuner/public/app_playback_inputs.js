(function attachXsxbPlaybackInputs(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppPlaybackInputs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates the playback-panel input handlers used by the animation workbench.
   *
   * The controller owns no editor state. It reads and mutates state through
   * injected callbacks so app.js can keep the original global function names
   * as compatibility facades for event modules and filmstrip controls.
   *
   * @param {object} [dependencies] Playback state, elements, and UI callbacks.
   * @returns {object} Playback input operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      minFrameDurationMs = 1,
      getCurrentGroup = () => null,
      selectedFrameIndexes = () => [],
      canEditFramePlayback = () => false,
      usesAttachedPlaybackTiming = () => false,
      groupPlaybackDurationSeconds = () => 0,
      frameDurationMs = () => 0,
      groupHasGroupTimeOverride = () => false,
      groupPlaybackFps = () => 0,
      framePlayback = () => ({ duration: 1, disabled: false }),
      frameDurationMultiplierFromMs = () => 1,
      setFramePlayback = () => {},
      setGroupPlaybackData = () => {},
      clearGroupTimeOverride = () => {},
      preserveGroupPlaybackDuration = () => {},
      clampFrameIndex = (value) => value,
      setSingleFrameSelection = () => {},
      syncFrameInputs = () => {},
      syncGroupPlaybackInputs = () => {},
      renderFilmstrip = () => {},
      updateGroupMeta = () => {},
      updateWorkbenchHud = () => {},
      draw = () => {},
      pushUndo = () => {},
      confirm = () => true,
      translate = (key) => key,
      round = (value) => Math.round(value),
    } = dependencies;

    /**
     * Applies the selected frame duration/disabled inputs to all selected frames.
     * @param {{preserveDuration?:boolean,changeDuration?:boolean}} [options] Edit options.
     * @returns {Promise<void>}
     */
    async function updateSelectedPlaybackFromInputs({
      preserveDuration = false,
      changeDuration = true,
    } = {}) {
      if (!canEditFramePlayback()) return;
      const previousDurationSeconds = preserveDuration ? groupPlaybackDurationSeconds() : 0;
      const targetMs = Math.max(
        minFrameDurationMs,
        Math.round(Number(elements.frameDuration?.value || minFrameDurationMs)),
      );
      const selectedIndexes = selectedFrameIndexes();
      const currentGroup = getCurrentGroup();
      const durationChanged =
        changeDuration &&
        selectedIndexes.some(
          (frameIndex) => Math.round(frameDurationMs(frameIndex, currentGroup)) !== targetMs,
        );
      const hasGroupTiming = durationChanged && groupHasGroupTimeOverride();
      if (
        hasGroupTiming &&
        !(await confirm(translate("frameTimeConflict"), {
          tone: "warning",
        }))
      ) {
        syncFrameInputs();
        return;
      }
      if (hasGroupTiming) {
        if (!elements.frameDuration?.dataset.undoUsed) pushUndo("frame duration");
        clearGroupTimeOverride(currentGroup);
      }
      for (const frameIndex of selectedIndexes) {
        const playback = framePlayback(frameIndex, currentGroup);
        setFramePlayback(frameIndex, {
          duration: changeDuration
            ? frameDurationMultiplierFromMs(targetMs, currentGroup)
            : playback.duration,
          disabled: Boolean(elements.frameDisabled?.checked),
        });
      }
      if (preserveDuration) preserveGroupPlaybackDuration(previousDurationSeconds);
      syncFrameInputs();
      renderFilmstrip();
      updateWorkbenchHud();
      draw();
    }

    /**
     * Adjusts one frame duration from a filmstrip stepper control.
     * @param {number} index Frame index.
     * @param {number} deltaMs Duration delta in milliseconds.
     * @returns {Promise<void>}
     */
    async function adjustFrameDurationMs(index, deltaMs) {
      const currentGroup = getCurrentGroup();
      if (!currentGroup || !canEditFramePlayback() || usesAttachedPlaybackTiming()) return;
      const frameIndex = clampFrameIndex(index, currentGroup);
      const nextMs = Math.max(
        minFrameDurationMs,
        Math.round(frameDurationMs(frameIndex, currentGroup) + deltaMs),
      );
      const hasGroupTiming = groupHasGroupTimeOverride();
      if (
        hasGroupTiming &&
        !(await confirm(translate("frameTimeConflict"), {
          tone: "warning",
        }))
      ) {
        syncFrameInputs();
        return;
      }
      pushUndo("frame duration");
      setSingleFrameSelection(frameIndex, currentGroup);
      const playback = framePlayback(frameIndex, currentGroup);
      if (hasGroupTiming) clearGroupTimeOverride(currentGroup);
      setFramePlayback(
        frameIndex,
        {
          ...playback,
          duration: frameDurationMultiplierFromMs(nextMs, currentGroup),
        },
        currentGroup,
      );
      syncFrameInputs();
      renderFilmstrip();
      updateWorkbenchHud();
      draw();
    }

    /**
     * Applies FPS, root-motion, or attached VFX frame-window inputs.
     * @returns {void}
     */
    function updateGroupPlaybackFromInputs() {
      if (!elements.fps || !elements.fpsValue || !elements.rootMotionX || !elements.rootMotionY) return;
      if (!canEditFramePlayback()) return;
      const currentGroup = getCurrentGroup();
      if (usesAttachedPlaybackTiming()) {
        if (!elements.vfxStartFrame || !elements.vfxEndFrame) return;
        setGroupPlaybackData({
          start_frame: Number(elements.vfxStartFrame.value || 1) - 1,
          end_frame: Number(elements.vfxEndFrame.value || elements.vfxStartFrame.value || 1) - 1,
        });
        syncGroupPlaybackInputs();
        updateGroupMeta();
        updateWorkbenchHud();
        return;
      }
      setGroupPlaybackData({
        fps: Number(elements.fps.value || groupPlaybackFps()),
        root_motion: {
          x: Number(elements.rootMotionX.value || 0),
          y: Number(elements.rootMotionY.value || 0),
        },
      });
      elements.fpsValue.textContent = round(groupPlaybackFps(currentGroup));
      updateGroupMeta();
      updateWorkbenchHud();
    }

    return {
      adjustFrameDurationMs,
      updateGroupPlaybackFromInputs,
      updateSelectedPlaybackFromInputs,
    };
  }

  return { createController };
});
