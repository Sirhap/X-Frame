(function attachXsxbAppEvents(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const inputHelpersModule =
    root.XSXBAppEventsInputHelpers ||
    (typeof require === "function" ? require("./app_events_input_helpers") : null);
  const stagePointerModule =
    root.XSXBAppEventsStagePointer ||
    (typeof require === "function" ? require("./app_events_stage_pointer") : null);

  /**
   * Resolves browser storage without letting a restricted-origin getter abort initialization.
   * @param {Storage|null|undefined} explicitStorage Injected storage implementation.
   * @returns {Storage|null} Available storage or null.
   */
  function resolveStorage(explicitStorage) {
    if (explicitStorage) return explicitStorage;
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Creates DOM and pointer event bindings for the Frame Tuner workbench.
   *
   * The event code is intentionally kept behaviorally identical to app.js.
   * Mutable values use the injected state facade, while application operations
   * are explicit handler dependencies.
   *
   * @param {object} [dependencies] Controller dependencies.
   * @returns {{bind:()=>()=>void,unbind:()=>void}} Event binding controller.
   */
  function createController(dependencies = {}) {
    const elements = dependencies.elements || {};
    const state = dependencies.state || {};
    const handlers = dependencies.handlers || {};
    const constants = dependencies.constants || {};
    const documentRef = dependencies.documentRef || root.document;
    const storage = resolveStorage(dependencies.storage);
    const getDevicePixelRatio = dependencies.getDevicePixelRatio || (() => root.devicePixelRatio || 1);
    const structuredCloneImpl = dependencies.structuredCloneImpl || root.structuredClone;
    const els = elements;
    const document = documentRef;
    const localStorage = storage;
    const devicePixelRatio = Number(getDevicePixelRatio() || 1);
    const structuredClone =
      typeof structuredCloneImpl === "function"
        ? structuredCloneImpl
        : (value) => JSON.parse(JSON.stringify(value));
    const {
      activateFrameAttachmentForEditing,
      activateProject,
      applyCanvasColor,
      applyGroupTimeFromInput,
      applyLanguage,
      applySelectedAttachmentWheel,
      applyUiTheme,
      adjustmentNumberInputs,
      attachmentFrameIndex,
      attachmentOffsetDeltaFromClientDelta,
      bindFrameAudioFile,
      boxOffsetDeltaFromScreenDelta,
      boxResizeDeltaFromScreenDelta,
      canEditBox,
      canEditFramePlayback,
      canEditFrameTransform,
      centerStageContent,
      clearActiveProject,
      clearBoxOverride,
      clearSelectedAttachment,
      cloneState,
      cloneVector,
      collisionOffsetYForHeight,
      createBoxEditSnapshot,
      deleteActiveProject,
      deleteBoxOnFrame,
      draw,
      baseTransform,
      firstEditableSelectedBox,
      firstPlayableFrame,
      fitView,
      frameBox,
      framePlayback,
      groupHasGroupTimeOverride,
      groupOwnsFrameKey,
      hitTestBoxes,
      hitTestDirectManipulationAttachment,
      hitTestDirectManipulationFrame,
      isCollisionBox,
      keyboardController,
      loadChainImages,
      markDirty,
      moveDirectManipulationFrameByClientDelta,
      normalizeAdjustmentMode,
      normalizeAttachmentTransform,
      normalizeColor,
      normalizeTheme,
      playFrameAudio,
      playbackChainGroup,
      playbackStore,
      pushUndo,
      overrideStore,
      refreshActiveProject,
      redo,
      renderFilmstrip,
      renderGroupSelect,
      resizeFrameBox,
      removeFrameAudioFromCard,
      save,
      saveBoxViewPrefs,
      schedulePlaybackAnimation,
      selectGroup,
      selectedFrameAttachment,
      selectedFrameIndexes,
      setBoxOverride,
      setFrameTransform,
      setReferenceFrameEnabled,
      setSingleFrameSelection,
      setStageZoom,
      status,
      stepAdjustmentInput,
      normalizeAdjustmentInputDisplay = (input) => input,
      isIncompleteNumberInput = () => false,
      stagePoint,
      syncAdjustmentInputs,
      syncAdjustmentModeInputs,
      syncBoxInputs,
      syncFrameInputs,
      syncSceneInputs,
      tuningFrameKey,
      t,
      undo,
      updateAdjustmentFromInputs,
      updateCoordHud,
      updateGroupMeta,
      updateGroupPlaybackFromInputs,
      updateHistoryControls,
      updateSceneScaleFromInput,
      updateSelectedBoxFromInputs,
      updateSelectedFromInputs,
      updateSelectedPlaybackFromInputs,
      valueStore,
      zoomViewAt,
      rotateVector,
    } = handlers;

    if (!inputHelpersModule?.createController) {
      throw new Error("XSXBAppEventsInputHelpers is required.");
    }
    const {
      armInputUndo,
      syncFrameAxisScaleToUniform,
      syncBaseAxisScaleToUniform,
      setAdjustmentMode,
      audioFileFromList,
      initPanelState,
      writePreference,
    } = inputHelpersModule.createController({
      elements: els,
      state,
      constants,
      documentRef: document,
      storage: localStorage,
      handlers: {
        applyCanvasColor,
        applyLanguage,
        applyUiTheme,
        cloneState,
        normalizeAdjustmentMode,
        normalizeColor,
        normalizeTheme,
        syncAdjustmentInputs,
        updateHistoryControls,
      },
    });

    if (!stagePointerModule?.createController) {
      throw new Error("XSXBAppEventsStagePointer is required.");
    }
    const stagePointerController = stagePointerModule.createController({
      stage: els.stage,
      state,
      devicePixelRatio,
      structuredCloneImpl: structuredClone,
      handlers: {
        activateFrameAttachmentForEditing,
        applySelectedAttachmentWheel,
        attachmentFrameIndex,
        attachmentOffsetDeltaFromClientDelta,
        boxOffsetDeltaFromScreenDelta,
        boxResizeDeltaFromScreenDelta,
        collisionOffsetYForHeight,
        cloneVector,
        draw,
        frameBox,
        getCurrentGroup: () => state.currentGroup,
        getImages: () => state.images,
        hitTestBoxes,
        hitTestDirectManipulationAttachment,
        hitTestDirectManipulationFrame,
        isCollisionBox,
        markDirty,
        moveDirectManipulationFrameByClientDelta,
        normalizeAttachmentTransform,
        pushUndo,
        renderFilmstrip,
        resizeFrameBox,
        rotateVector,
        selectedFrameIndexes,
        setBoxOverride,
        stagePoint,
        syncAdjustmentInputs,
        syncBoxInputs,
        updateCoordHud,
        zoomViewAt,
      },
    });

    let bound = false;

    /**
     * Runs an asynchronous playback edit and reports failures in the existing
     * workbench status area instead of leaking an unhandled rejection.
     * @param {()=>Promise<void>} operation Playback edit operation.
     * @returns {void}
     */
    function runPlaybackEdit(operation) {
      void operation().catch((error) =>
        status(t("frameMutationFailed", { message: error?.message || String(error) })),
      );
    }

    /**
     * Binds all workbench DOM and pointer listeners in their original order.
     * @returns {()=>void} Cleanup function (listeners are intentionally one-shot).
     */
    function bind() {
      if (bound) return unbind;
      bound = true;
      els.projectSelect.addEventListener("change", () => {
        activateProject(els.projectSelect.value).catch((error) =>
          status(t("projectSwitchFailed", { message: error.message })),
        );
      });
      els.importAnimationOpen.addEventListener("click", () => {
        state.frameOrganizer
          ?.openImport()
          .catch((error) => status(t("loadFailed", { message: error.message })));
      });
      els.refreshProject.addEventListener("click", () => {
        refreshActiveProject().catch((error) =>
          status(t("projectRefreshFailed", { message: error.message })),
        );
      });
      els.clearProject?.addEventListener("click", () => {
        clearActiveProject().catch((error) => status(t("projectMutationFailed", { message: error.message })));
      });
      els.deleteProject?.addEventListener("click", () => {
        deleteActiveProject().catch((error) =>
          status(t("projectMutationFailed", { message: error.message })),
        );
      });
      for (const button of els.languageButtons) {
        button.addEventListener("click", () => {
          state.language = button.dataset.language === "en" ? "en" : "zh";
          applyLanguage();
          writePreference("xsxbFrameTuner.language", state.language);
          writePreference("xsxbFrameTuner.languageExplicit", "true");
        });
      }
      for (const button of els.themeButtons) {
        button.addEventListener("click", () => {
          state.uiTheme = normalizeTheme(button.dataset.theme);
          applyUiTheme();
          writePreference("xsxbFrameTuner.theme", state.uiTheme);
        });
      }
      if (els.canvasColor) {
        els.canvasColor.addEventListener("input", () => {
          state.canvasColor = normalizeColor(els.canvasColor.value);
          applyCanvasColor();
          draw();
          writePreference("xsxbFrameTuner.canvasColor", state.canvasColor);
        });
      }
      if (els.sceneSelect) {
        els.sceneSelect.addEventListener("change", () => {
          state.selectedSceneId = els.sceneSelect.value || "";
          syncSceneInputs();
          draw();
          if (state.selectedSceneId) writePreference("xsxbFrameTuner.scene", state.selectedSceneId);
        });
      }
      if (els.sceneScale) {
        armInputUndo(els.sceneScale, "scene scale");
        els.sceneScale.addEventListener("input", updateSceneScaleFromInput);
        els.sceneScale.addEventListener("change", syncSceneInputs);
      }
      els.groupSelect.addEventListener("change", () =>
        selectGroup(state.config.groups.find((group) => group.uiId === els.groupSelect.value)),
      );
      els.groupSearch.addEventListener("input", () => {
        state.groupSearch = els.groupSearch.value || "";
        writePreference("animationTuner.groupSearch", state.groupSearch);
        const groups = renderGroupSelect(state.currentGroup?.uiId);
        const currentVisible = groups.some((group) => group.uiId === state.currentGroup?.uiId);
        if (!currentVisible && groups[0]) selectGroup(groups[0]);
      });
      if (els.chainGroupSelect) {
        els.chainGroupSelect.addEventListener("change", async () => {
          if (state.playing) {
            state.playbackPrimaryGroup = state.currentGroup;
            state.playbackSecondaryGroup = playbackChainGroup();
            if (state.playbackSecondaryGroup?.uiId === state.playbackPrimaryGroup.uiId)
              state.playbackSecondaryGroup = null;
          }
          await loadChainImages();
          updateGroupMeta();
          renderFilmstrip();
          draw();
        });
      }
      initPanelState();

      els.frameScale.addEventListener("input", syncFrameAxisScaleToUniform);
      for (const input of [
        els.frameScale,
        els.frameScaleX,
        els.frameScaleY,
        els.frameX,
        els.frameY,
        els.frameRotation,
      ]) {
        armInputUndo(input, "frame input");
        input.addEventListener("input", updateSelectedFromInputs);
      }
      armInputUndo(els.frameDuration, "frame duration");
      els.frameDuration.addEventListener("input", () => {
        runPlaybackEdit(() => updateSelectedPlaybackFromInputs());
      });
      if (els.groupTimeMs) {
        armInputUndo(els.groupTimeMs, "group time");
        els.groupTimeMs.addEventListener("input", () => {
          runPlaybackEdit(() => applyGroupTimeFromInput());
        });
        els.groupTimeMs.addEventListener("change", () => {
          runPlaybackEdit(() => applyGroupTimeFromInput());
        });
      }
      if (els.frameAudioFile) {
        els.frameAudioFile.addEventListener("change", async () => {
          const file = audioFileFromList(els.frameAudioFile.files);
          await bindFrameAudioFile(file);
        });
      }
      if (els.frameAudioDrop) {
        for (const eventName of ["dragenter", "dragover"]) {
          els.frameAudioDrop.addEventListener(eventName, (event) => {
            event.preventDefault();
            if (!state.currentGroup) return;
            event.dataTransfer.dropEffect = "copy";
            els.frameAudioDrop.classList.add("dragOver");
          });
        }
        for (const eventName of ["dragleave", "dragend"]) {
          els.frameAudioDrop.addEventListener(eventName, () => {
            els.frameAudioDrop.classList.remove("dragOver");
          });
        }
        els.frameAudioDrop.addEventListener("drop", async (event) => {
          event.preventDefault();
          els.frameAudioDrop.classList.remove("dragOver");
          if (!state.currentGroup) return;
          const file = audioFileFromList(event.dataTransfer?.files);
          if (!file) {
            status(t("dropAudioFile"));
            return;
          }
          await bindFrameAudioFile(file);
        });
      }
      if (els.clearFrameAudio) {
        els.clearFrameAudio.addEventListener("click", async () => {
          await removeFrameAudioFromCard(state.selectedFrame, state.currentGroup);
        });
      }
      els.frameDisabled.addEventListener("change", () => {
        pushUndo("toggle frame");
        runPlaybackEdit(() =>
          updateSelectedPlaybackFromInputs({
            preserveDuration: groupHasGroupTimeOverride(),
            changeDuration: false,
          }),
        );
      });
      els.frameReference.addEventListener("change", () => {
        setReferenceFrameEnabled(els.frameReference.checked);
      });
      for (const [mode, input] of [
        ["character", els.adjustCharacter],
        ["group", els.adjustGroup],
        ["frame", els.adjustFrame],
      ]) {
        input.addEventListener("change", () => {
          if (input.checked) {
            setAdjustmentMode(mode);
          } else {
            syncAdjustmentModeInputs();
          }
        });
      }
      els.baseScale.addEventListener("input", () => {
        if (isIncompleteNumberInput(els.baseScale.value)) return;
        syncBaseAxisScaleToUniform();
        updateAdjustmentFromInputs();
      });

      document.querySelectorAll(".numberStep").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          const input = document.querySelector(`#${button.dataset.stepTarget}`);
          stepAdjustmentInput(input, Number(button.dataset.stepDir || 0));
          input?.focus({ preventScroll: true });
        });
      });

      for (const input of adjustmentNumberInputs()) {
        armInputUndo(input, "base input");
        input.addEventListener("focus", () => {
          if (selectedFrameAttachment()) {
            state.baseEditSnapshot = null;
            state.boxEditSnapshot = null;
            return;
          }
          state.boxEditSnapshot = createBoxEditSnapshot(state.adjustmentMode);
          if (state.adjustmentMode === "group") {
            state.baseEditSnapshot = {
              groupUiId: state.currentGroup?.uiId,
              base: structuredClone(baseTransform()),
              overrides: structuredClone(overrideStore()),
            };
          }
        });
        input.addEventListener("blur", () => {
          normalizeAdjustmentInputDisplay(input);
          updateAdjustmentFromInputs();
          state.baseEditSnapshot = null;
          state.boxEditSnapshot = null;
        });
        input.addEventListener("change", () => {
          normalizeAdjustmentInputDisplay(input);
          state.baseEditSnapshot = null;
          state.boxEditSnapshot = null;
        });
        input.addEventListener("keydown", (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            stepAdjustmentInput(input, 1, event.shiftKey ? 10 : 1);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            stepAdjustmentInput(input, -1, event.shiftKey ? 10 : 1);
            return;
          }
          if (event.key === "PageUp") {
            event.preventDefault();
            stepAdjustmentInput(input, 1, 10);
            return;
          }
          if (event.key === "PageDown") {
            event.preventDefault();
            stepAdjustmentInput(input, -1, 10);
            return;
          }
          if (event.key.length === 1 && /[0-9eE+\-.,]/.test(event.key)) {
            return;
          }
          if (
            [
              "Backspace",
              "Delete",
              "Home",
              "End",
              "Tab",
              "Escape",
              "Enter",
              "ArrowLeft",
              "ArrowRight",
            ].includes(event.key)
          ) {
            return;
          }
          event.preventDefault();
        });
        input.addEventListener("paste", (event) => {
          const text = String(event.clipboardData?.getData("text") || "").trim();
          if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) event.preventDefault();
        });
        input.addEventListener("drop", (event) => event.preventDefault());
        if (input !== els.baseScale) {
          input.addEventListener("input", () => {
            if (isIncompleteNumberInput(input.value)) return;
            updateAdjustmentFromInputs();
          });
        }
      }

      els.showBoxes.addEventListener("change", () => {
        state.showBoxes = els.showBoxes.checked;
        if (!state.showBoxes) state.boxOnlyMode = false;
        saveBoxViewPrefs();
        syncBoxInputs();
        draw();
      });

      if (els.boxOnlyMode) {
        els.boxOnlyMode.addEventListener("change", () => {
          state.boxOnlyMode = false;
          saveBoxViewPrefs();
          syncBoxInputs();
          draw();
        });
      }

      for (const input of els.boxChoiceInputs) {
        input.addEventListener("change", () => {
          const boxName = input.dataset.boxChoice;
          if (!canEditBox(boxName)) return;
          if (input.checked) {
            state.selectedBoxes.add(boxName);
            state.selectedBox = boxName;
            state.showBoxes = true;
          } else {
            state.selectedBoxes.delete(boxName);
            if (state.selectedBox === boxName) state.selectedBox = firstEditableSelectedBox();
          }
          saveBoxViewPrefs();
          syncBoxInputs();
          draw();
        });
      }

      for (const input of [els.boxX, els.boxY, els.boxW, els.boxH, els.boxRotation].filter(Boolean)) {
        armInputUndo(input, "box input");
        input.addEventListener("input", updateSelectedBoxFromInputs);
      }

      if (els.boxEnabled) {
        els.boxEnabled.addEventListener("change", () => {
          pushUndo("toggle box");
          updateSelectedBoxFromInputs();
          syncBoxInputs();
        });
      }

      if (els.clearBox) {
        els.clearBox.addEventListener("click", () => {
          if (!state.selectedBox) return;
          pushUndo("clear box");
          for (const frameIndex of selectedFrameIndexes()) {
            clearBoxOverride(state.selectedBox, frameIndex);
          }
          syncBoxInputs();
          draw();
        });
      }

      if (els.deleteBox) {
        els.deleteBox.addEventListener("click", () => {
          if (!state.selectedBox) return;
          pushUndo("delete box");
          for (const frameIndex of selectedFrameIndexes()) {
            deleteBoxOnFrame(state.selectedBox, frameIndex);
          }
          syncBoxInputs();
          draw();
        });
      }

      els.applyBaseToFrame.addEventListener("click", () => {
        if (!canEditFrameTransform()) return;
        pushUndo("copy base to frame");
        const base = baseTransform();
        for (const frameIndex of selectedFrameIndexes()) {
          setFrameTransform(frameIndex, base);
        }
        syncFrameInputs();
        renderFilmstrip();
        draw();
      });

      if (els.undo) els.undo.addEventListener("click", undo);
      if (els.undoTop) els.undoTop.addEventListener("click", undo);
      if (els.redoTop) els.redoTop.addEventListener("click", redo);

      if (els.clearFrame) {
        els.clearFrame.addEventListener("click", () => {
          if (!canEditFrameTransform() && !canEditFramePlayback()) return;
          const visualOverrides = overrideStore();
          const playbackOverrides = playbackStore();
          const keys = selectedFrameIndexes().map((frameIndex) =>
            tuningFrameKey(frameIndex, state.currentGroup),
          );
          const changed = keys.some(
            (key) =>
              Object.prototype.hasOwnProperty.call(visualOverrides, key) ||
              Object.prototype.hasOwnProperty.call(playbackOverrides, key),
          );
          if (!changed) {
            status(t("defaultsAlreadyActive"));
            return;
          }
          pushUndo("restore frame defaults");
          for (const key of keys) {
            delete visualOverrides[key];
            delete playbackOverrides[key];
          }
          markDirty();
          syncFrameInputs();
          renderFilmstrip();
          draw();
          status(t("restoreFrameDefaultsDone"));
        });
      }

      if (els.clearGroup) {
        els.clearGroup.addEventListener("click", () => {
          if (!canEditFrameTransform() && !canEditFramePlayback()) return;
          const group = state.currentGroup;
          const tuningValues = valueStore(group);
          const tuningKeys = [group?.scale, group?.scaleVector, group?.offset, group?.rotation].filter(
            Boolean,
          );
          const visualOverrides = overrideStore(group);
          const visualKeys = Object.keys(visualOverrides).filter((key) => groupOwnsFrameKey(group, key));
          const playbackOverrides = playbackStore(group);
          const playbackKeys = Object.keys(playbackOverrides).filter((key) => groupOwnsFrameKey(group, key));
          const changed =
            tuningKeys.some((key) => Object.prototype.hasOwnProperty.call(tuningValues, key)) ||
            visualKeys.length > 0 ||
            playbackKeys.length > 0;
          if (!changed) {
            status(t("defaultsAlreadyActive"));
            return;
          }
          pushUndo("restore animation defaults");
          for (const key of tuningKeys) delete tuningValues[key];
          for (const key of visualKeys) delete visualOverrides[key];
          for (const key of playbackKeys) delete playbackOverrides[key];
          markDirty();
          syncFrameInputs();
          renderFilmstrip();
          draw();
          status(t("restoreGroupDefaultsDone"));
        });
      }

      if (els.playPause) {
        els.playPause.addEventListener("click", () => {
          if (!handlers.canPlayCurrentGroup?.()) {
            status(t("singleFramePlaybackUnavailable"));
            handlers.syncPlaybackAvailability?.();
            return;
          }
          clearSelectedAttachment();
          state.playing = !state.playing;
          if (state.playing) {
            state.playbackPrimaryGroup = state.currentGroup;
            state.playbackSecondaryGroup = playbackChainGroup();
            if (state.playbackSecondaryGroup?.uiId === state.playbackPrimaryGroup.uiId)
              state.playbackSecondaryGroup = null;
            setSingleFrameSelection(
              framePlayback(state.selectedFrame).disabled
                ? firstPlayableFrame(state.currentGroup)
                : state.selectedFrame,
              state.currentGroup,
            );
            state.lastPlay = -1;
            playFrameAudio(state.selectedFrame, state.currentGroup);
            schedulePlaybackAnimation();
          } else {
            state.playbackPrimaryGroup = null;
            state.playbackSecondaryGroup = null;
          }
          els.playPause.textContent = state.playing ? t("pause") : t("play");
          syncFrameInputs();
          renderFilmstrip();
          draw();
          handlers.syncPlaybackAvailability?.();
        });
      }

      if (els.ghostToggle) {
        els.ghostToggle.addEventListener("click", () => {
          state.ghost = !state.ghost;
          els.ghostToggle.classList.toggle("active", state.ghost);
          draw();
        });
      }

      els.resetView?.addEventListener("click", () => {
        fitView();
        draw();
      });
      els.stageZoomOut?.addEventListener("click", () => setStageZoom(state.view.zoom / 1.2));
      els.stageZoomIn?.addEventListener("click", () => setStageZoom(state.view.zoom * 1.2));
      els.stageZoom?.addEventListener("input", () => setStageZoom(Number(els.stageZoom.value) / 100));
      els.stageZoomFit?.addEventListener("click", () => {
        fitView();
        draw();
      });
      els.stageZoomActual?.addEventListener("click", () => {
        centerStageContent(1, "actual");
        draw();
      });
      els.stage.addEventListener("dblclick", () => {
        if (state.stageViewMode === "actual") fitView();
        else centerStageContent(1, "actual");
        draw();
      });
      els.save.addEventListener("click", () =>
        save().catch((error) => status(t("saveFailed", { message: error.message }))),
      );
      if (els.fps) {
        armInputUndo(els.fps, "group fps");
        els.fps.addEventListener("input", updateGroupPlaybackFromInputs);
      }
      for (const input of [els.vfxStartFrame, els.vfxEndFrame].filter(Boolean)) {
        armInputUndo(input, "vfx action frame window");
        input.addEventListener("input", updateGroupPlaybackFromInputs);
      }
      for (const input of [els.rootMotionX, els.rootMotionY].filter(Boolean)) {
        armInputUndo(input, "group root motion");
        input.addEventListener("input", updateGroupPlaybackFromInputs);
      }

      stagePointerController.bind();

      keyboardController.bind();

      return unbind;
    }

    /**
     * Removes the binding guard. Anonymous listeners remain attached for the
     * lifetime of the page, matching the original app behavior.
     * @returns {void}
     */
    function unbind() {
      bound = false;
    }

    return { bind, unbind };
  }

  return { createController };
});
