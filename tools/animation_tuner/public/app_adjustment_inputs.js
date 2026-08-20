(function attachXsxbAdjustmentInputs(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppAdjustmentInputs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Returns whether a number field is still being typed and is not a complete value.
   * @param {unknown} value Raw input value.
   * @returns {boolean} Whether the value should not be committed yet.
   */
  function isIncompleteNumberInput(value) {
    const text = String(value ?? "").trim();
    if (text === "" || text === "-" || text === "+" || text === "." || text === "-." || text === "+.") {
      return true;
    }
    if (/^[+-]?\d+\.$/.test(text) || /[eE][+-]?$/.test(text)) return true;
    return false;
  }

  /**
   * Compacts a displayed number so 1.000 and 1 compare the same.
   * @param {unknown} value Displayed field value.
   * @returns {string} Canonical numeric text, or the trimmed original when incomplete.
   */
  function compactDisplayedNumber(value) {
    const text = String(value ?? "").trim();
    if (!text || isIncompleteNumberInput(text)) return text;
    const number = Number(text);
    return Number.isFinite(number) ? String(number) : text;
  }

  /**
   * Returns whether text is a number the user could be typing.
   * @param {unknown} value Candidate token.
   * @returns {boolean} Whether the token is a numeric prefix.
   */
  function isTypedNumberToken(value) {
    return /^[+-]?(?:\d+\.?\d*|\.\d*)(?:[eE][+-]?\d*)?$/.test(String(value ?? "").trim());
  }

  /**
   * Recovers the number the user meant when a focused field still holds the
   * previous complete value. Typing 1.5 into 1 or 1.000 must become 1.5, never
   * 11.5, and typing 1.500 must keep the leading 1.
   * @param {unknown} origin Value captured when the field was focused.
   * @param {unknown} incoming Current raw field value.
   * @param {{firstEdit?:boolean}} [options] Whether this is the first keystroke.
   * @returns {string} Sanitized field text.
   */
  function sanitizeAdjustmentNumberInput(origin, incoming, options = {}) {
    const next = String(incoming ?? "");
    const originText = String(origin ?? "").trim();
    if (next === originText) return next;
    if (options.firstEdit === false) return next;

    if (originText && next.startsWith(originText) && next.length > originText.length) {
      const suffix = next.slice(originText.length);
      if (/^[+-]?\d/.test(suffix) && isTypedNumberToken(suffix)) return suffix;
    }

    const compactOrigin = compactDisplayedNumber(originText);
    if (compactOrigin && next.startsWith(compactOrigin) && next.length > compactOrigin.length) {
      const suffix = next.slice(compactOrigin.length);
      if (/^[+-]?\d/.test(suffix) && isTypedNumberToken(suffix)) return suffix;
    }

    return next;
  }

  /**
   * Creates the adjustment-panel input and synchronization helpers.
   * @param {{
   *   elements: Record<string, any>,
   *   adjustmentModes?: string[],
   *   adjustmentModeKey?: string,
   *   getAdjustmentMode?: ()=>string,
   *   setAdjustmentMode?: (value:string)=>void,
   *   getCurrentGroup?: ()=>object|null,
   *   getSelectedFrame?: ()=>number,
   *   getSelectedFrameAttachment?: ()=>object|null,
   *   canEditGroupTransform?: (group?:object|null)=>boolean,
   *   canEditFrameTransform?: (group?:object|null)=>boolean,
   *   groupSupports?: (group:object|null, capability:string)=>boolean,
   *   characterTransform?: (group?:object|null)=>object,
   *   frameTransform?: (index?:number, group?:object|null)=>object,
   *   baseTransform?: (group?:object|null)=>object,
   *   normalizeAttachmentTransform?: (value:unknown)=>object,
   *   characterBaseScaleForGroup?: (group?:object|null)=>number,
   *   framePlayback?: (index?:number, group?:object|null)=>object,
   *   frameDurationMs?: (index?:number, group?:object|null)=>number,
   *   canEditFramePlayback?: (group?:object|null)=>boolean,
   *   isReferenceFrame?: (index?:number, group?:object|null)=>boolean,
   *   canUseReferenceFrame?: (group?:object|null)=>boolean,
   *   usesAttachedPlaybackTiming?: (group?:object|null)=>boolean,
   *   groupPlaybackFps?: (group?:object|null)=>number,
   *   groupRootMotion?: (group?:object|null)=>{x:number,y:number},
   *   attachedPlaybackOwnerGroup?: ()=>object|null,
   *   attachedVfxPlaybackWindow?: ()=>{start:number,end:number},
   *   syncGroupTimeInputs?: ()=>void,
   *   updateCanvasTitle?: (group?:object|null)=>void,
   *   updateWorkbenchHud?: (group?:object|null)=>void,
   *   syncBoxInputs?: ()=>void,
   *   syncFrameAudioInputs?: ()=>void,
   *   updateAdjustmentFromInputs?: ()=>void,
   *   pushUndo?: (label:string)=>void,
   *   overrideStore?: (group?:object|null)=>Record<string,unknown>,
   *   createBoxEditSnapshot?: (mode?:string)=>object,
   *   setBaseEditSnapshot?: (value:object|null)=>void,
   *   setBoxEditSnapshot?: (value:object|null)=>void,
   *   cloneValue?: (value:unknown)=>unknown,
   *   round?: (value:number)=>number,
   *   documentRef?: Document,
   *   localStorageRef?: Storage|null,
   * }} Controller dependencies.
   * @returns {object} Adjustment-panel operations.
   */
  function createController(dependencies) {
    const {
      elements,
      adjustmentModes = ["character", "group", "frame"],
      adjustmentModeKey = "xsxbFrameTuner.adjustmentMode",
      getAdjustmentMode = () => "group",
      setAdjustmentMode = () => {},
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getSelectedFrameAttachment = () => null,
      canEditGroupTransform = () => false,
      canEditFrameTransform = () => false,
      groupSupports = () => false,
      characterTransform = () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
      frameTransform = () => characterTransform(),
      baseTransform = () => characterTransform(),
      normalizeAttachmentTransform = (value) => value || baseTransform(),
      characterBaseScaleForGroup = () => 1,
      framePlayback = () => ({ disabled: false }),
      frameDurationMs = () => 0,
      canEditFramePlayback = () => false,
      isReferenceFrame = () => false,
      canUseReferenceFrame = () => false,
      usesAttachedPlaybackTiming = () => false,
      groupPlaybackFps = () => 0,
      groupRootMotion = () => ({ x: 0, y: 0 }),
      attachedPlaybackOwnerGroup = () => null,
      attachedVfxPlaybackWindow = () => ({ start: 0, end: 0 }),
      syncGroupTimeInputs = () => {},
      updateCanvasTitle = () => {},
      updateWorkbenchHud = () => {},
      syncBoxInputs = () => {},
      syncFrameAudioInputs = () => {},
      updateAdjustmentFromInputs = () => {},
      pushUndo = () => {},
      overrideStore = () => ({}),
      createBoxEditSnapshot = () => ({}),
      setBaseEditSnapshot = () => {},
      setBoxEditSnapshot = () => {},
      cloneValue = (value) => {
        if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
        return JSON.parse(JSON.stringify(value));
      },
      round = (value) => value,
      documentRef = typeof document !== "undefined" ? document : null,
      localStorageRef = globalThis.localStorage || null,
    } = dependencies;

    /** Returns whether the selected group supports the requested transform mode. */
    function canEditAdjustmentMode(mode = getAdjustmentMode(), group = getCurrentGroup()) {
      if (getSelectedFrameAttachment()) return mode === "frame";
      if (mode === "character") return canEditCharacterTransformForGroup(group);
      if (mode === "group") return canEditGroupTransform(group);
      if (mode === "frame") return canEditFrameTransform(group);
      return false;
    }

    /** Returns whether character-level transforms can be edited for a group. */
    function canEditCharacterTransformForGroup(group = getCurrentGroup()) {
      return (
        Boolean(group) &&
        (groupSupports(group, "character_transform") || groupSupports(group, "group_transform"))
      );
    }

    /** Normalizes the selected adjustment mode against current capabilities. */
    function normalizeAdjustmentMode(mode = getAdjustmentMode()) {
      if (getSelectedFrameAttachment()) return "frame";
      const requested = adjustmentModes.includes(mode) ? mode : "group";
      if (canEditAdjustmentMode(requested)) return requested;
      return adjustmentModes.find((entry) => canEditAdjustmentMode(entry)) || "group";
    }

    /** Returns the transform represented by the selected adjustment mode. */
    function adjustmentTransform(mode = getAdjustmentMode()) {
      const attachment = getSelectedFrameAttachment();
      if (attachment && mode === "frame") return normalizeAttachmentTransform(attachment.transform);
      if (mode === "character") return characterTransform();
      if (mode === "frame") return frameTransform();
      return baseTransform();
    }

    /** Parses one adjustment number and falls back when the field is empty or invalid. */
    function parseAdjustmentNumber(value, fallback) {
      if (isIncompleteNumberInput(value)) return Number(fallback) || 0;
      const number = Number(value);
      return Number.isFinite(number) ? number : Number(fallback) || 0;
    }

    /** Reads the base transform fields from the adjustment panel. */
    function transformFromAdjustmentInputs() {
      const last = adjustmentTransform();
      const uniformScale = parseAdjustmentNumber(elements.baseScale.value, last.scale);
      return {
        scale: uniformScale,
        scaleX: parseAdjustmentNumber(elements.baseScaleX.value, last.scaleX ?? uniformScale),
        scaleY: parseAdjustmentNumber(elements.baseScaleY.value, last.scaleY ?? uniformScale),
        offset: {
          x: parseAdjustmentNumber(elements.baseX.value, last.offset?.x ?? 0),
          y: parseAdjustmentNumber(elements.baseY.value, last.offset?.y ?? 0),
        },
        rotation: parseAdjustmentNumber(elements.baseRotation.value, last.rotation ?? 0),
      };
    }

    /** Returns numeric inputs controlled by the adjustment panel. */
    function adjustmentNumberInputs() {
      return [
        elements.baseScale,
        elements.baseScaleX,
        elements.baseScaleY,
        elements.baseX,
        elements.baseY,
        elements.baseRotation,
      ].filter(Boolean);
    }

    /** Finds stepper buttons associated with one numeric input. */
    function adjustmentStepButtonsForInput(input) {
      if (!input?.id || !documentRef) return [];
      return Array.from(documentRef.querySelectorAll(`.numberStep[data-step-target="${input.id}"]`));
    }

    /** Captures the active adjustment state before a stepper edit. */
    function beginStepAdjustmentEdit() {
      if (getSelectedFrameAttachment()) {
        setBaseEditSnapshot(null);
        setBoxEditSnapshot(null);
        return;
      }
      setBoxEditSnapshot(createBoxEditSnapshot(getAdjustmentMode()));
      if (getAdjustmentMode() === "group") {
        setBaseEditSnapshot({
          groupUiId: getCurrentGroup()?.uiId,
          base: cloneValue(baseTransform()),
          overrides: cloneValue(overrideStore()),
        });
      }
    }

    /** Clears temporary edit snapshots after a stepper edit. */
    function endStepAdjustmentEdit() {
      setBaseEditSnapshot(null);
      setBoxEditSnapshot(null);
    }

    /** Steps one adjustment input and applies the resulting transform. */
    function stepAdjustmentInput(input, direction, multiplier = 1) {
      if (!input || input.disabled) return;
      const current = Number(input.value);
      if (!Number.isFinite(current)) return;
      const step = Number(input.step || 1) || 1;
      const nextValue = current + Number(direction || 0) * step * multiplier;
      pushUndo("adjustment step");
      beginStepAdjustmentEdit();
      input.value = round(nextValue);
      if (input === elements.baseScale) {
        elements.baseScaleX.value = input.value;
        elements.baseScaleY.value = input.value;
      }
      updateAdjustmentFromInputs();
      endStepAdjustmentEdit();
    }

    /** Stores the focus-time value and selects the field so the next keystroke replaces. */
    function beginAdjustmentNumberEdit(input) {
      if (!input) return;
      input.dataset.numberEditOrigin = String(input.value ?? "");
      delete input.dataset.numberEditConsumed;
      try {
        input.select();
      } catch (_error) {
        // type=number can reject selection APIs
      }
    }

    /** Keeps the origin selected until the first keystroke so a click does not append. */
    function retainAdjustmentNumberSelection(event, input) {
      if (!input || input.dataset.numberEditConsumed === "1") return;
      event?.preventDefault?.();
      try {
        input.select();
      } catch (_error) {
        // type=number can reject selection APIs
      }
    }

    /**
     * Unwraps an appended first keystroke and reports whether the value can be committed.
     * @param {{value?:unknown,dataset?:{numberEditOrigin?:string,numberEditConsumed?:string}}} input Focused field.
     * @returns {boolean} Whether the sanitized value is complete enough to apply.
     */
    function applyAdjustmentNumberInput(input) {
      if (!input) return false;
      const origin = input.dataset?.numberEditOrigin ?? "";
      const firstEdit = input.dataset?.numberEditConsumed !== "1";
      const sanitized = sanitizeAdjustmentNumberInput(origin, input.value, { firstEdit });
      if (String(input.value ?? "") !== sanitized) input.value = sanitized;
      if (input.dataset) input.dataset.numberEditConsumed = "1";
      return !isIncompleteNumberInput(input.value);
    }

    /** Writes a normalized number back into one focused adjustment field. */
    function normalizeAdjustmentInputDisplay(input, transform = transformFromAdjustmentInputs()) {
      if (!input) return transform;
      const values = {
        [elements.baseScale?.id]: round(transform.scale),
        [elements.baseScaleX?.id]: round(transform.scaleX),
        [elements.baseScaleY?.id]: round(transform.scaleY),
        [elements.baseX?.id]: round(transform.offset.x),
        [elements.baseY?.id]: round(transform.offset.y),
        [elements.baseRotation?.id]: round(transform.rotation || 0),
      };
      if (input.id && values[input.id] !== undefined) input.value = values[input.id];
      return transform;
    }

    /** Applies one arrow-key offset step. @returns {boolean} Whether the key was consumed. */
    function stepOffsetByArrowKey(key, multiplier = 1) {
      if (key === "ArrowLeft") {
        stepAdjustmentInput(elements.baseX, -1, multiplier);
        return true;
      }
      if (key === "ArrowRight") {
        stepAdjustmentInput(elements.baseX, 1, multiplier);
        return true;
      }
      if (key === "ArrowUp") {
        stepAdjustmentInput(elements.baseY, -1, multiplier);
        return true;
      }
      if (key === "ArrowDown") {
        stepAdjustmentInput(elements.baseY, 1, multiplier);
        return true;
      }
      return false;
    }

    /** Synchronizes the radio buttons and group timing controls. */
    function syncAdjustmentModeInputs() {
      const mode = getAdjustmentMode();
      if (elements.adjustCharacter) elements.adjustCharacter.checked = mode === "character";
      if (elements.adjustGroup) elements.adjustGroup.checked = mode === "group";
      if (elements.adjustFrame) elements.adjustFrame.checked = mode === "frame";
      syncGroupTimeInputs();
    }

    /** Synchronizes adjustment values, capability state, and stepper controls. */
    function syncAdjustmentInputs() {
      const mode = normalizeAdjustmentMode(getAdjustmentMode());
      setAdjustmentMode(mode);
      localStorageRef?.setItem(adjustmentModeKey, mode);
      syncAdjustmentModeInputs();
      const transform = adjustmentTransform(mode);
      const active = documentRef?.activeElement;
      const writeValue = (input, value) => {
        if (!input || input === active) return;
        input.value = value;
      };
      writeValue(elements.baseScale, round(transform.scale));
      writeValue(elements.baseScaleX, round(transform.scaleX));
      writeValue(elements.baseScaleY, round(transform.scaleY));
      writeValue(elements.baseX, round(transform.offset.x));
      writeValue(elements.baseY, round(transform.offset.y));
      writeValue(elements.baseRotation, round(transform.rotation || 0));
      const enabled = canEditAdjustmentMode(mode);
      for (const input of adjustmentNumberInputs()) {
        input.disabled = !enabled;
        for (const button of adjustmentStepButtonsForInput(input)) button.disabled = !enabled;
      }
      const editingAttachment = Boolean(getSelectedFrameAttachment());
      if (elements.clearGroup) {
        elements.clearGroup.hidden = mode !== "group" || editingAttachment;
        elements.clearGroup.disabled = !enabled;
      }
      if (elements.clearFrame) {
        elements.clearFrame.hidden = mode !== "frame" || editingAttachment;
        elements.clearFrame.disabled = !enabled;
      }
      if (elements.applyBaseToFrame) {
        elements.applyBaseToFrame.hidden = true;
        elements.applyBaseToFrame.disabled = true;
      }
    }

    /** Synchronizes the character base scale/source labels. */
    function syncCharacterBaseInputs(group = getCurrentGroup()) {
      if (!elements.characterBaseScale || !elements.characterBaseSource) return;
      if (!group) {
        elements.characterBaseScale.value = "";
        elements.characterBaseSource.value = "";
        return;
      }
      elements.characterBaseScale.value = round(characterBaseScaleForGroup(group));
      elements.characterBaseSource.value =
        group.characterBaseSource || group.profileScaleSemantic || group.profileLabel || "";
    }

    /** Synchronizes the selected frame transform, playback, and adjustment controls. */
    function syncFrameInputs() {
      updateCanvasTitle();
      syncCharacterBaseInputs();
      const transform = frameTransform();
      const transformEditable = canEditFrameTransform();
      elements.frameScale.value = transform.scale;
      elements.frameScaleX.value = transform.scaleX;
      elements.frameScaleY.value = transform.scaleY;
      elements.frameX.value = transform.offset.x;
      elements.frameY.value = transform.offset.y;
      elements.frameRotation.value = transform.rotation || 0;
      const playback = framePlayback();
      elements.frameDuration.value = Math.round(frameDurationMs());
      elements.frameDuration.disabled = !canEditFramePlayback() || usesAttachedPlaybackTiming();
      elements.frameReference.checked = isReferenceFrame(getSelectedFrame(), getCurrentGroup());
      elements.frameDisabled.checked = playback.disabled;
      for (const input of [
        elements.frameScale,
        elements.frameScaleX,
        elements.frameScaleY,
        elements.frameX,
        elements.frameY,
        elements.frameRotation,
      ]) {
        input.disabled = !transformEditable;
      }
      elements.frameReference.disabled = !canUseReferenceFrame();
      elements.frameDisabled.disabled = !canEditFramePlayback();
      if (elements.applyBaseToFrame) elements.applyBaseToFrame.disabled = true;
      elements.frameDisabled.parentElement.classList.toggle("dangerActive", playback.disabled);
      syncGroupTimeInputs();
      syncAdjustmentInputs();
      syncBoxInputs();
      syncFrameAudioInputs();
    }

    /** Synchronizes group playback fields and the workbench HUD. */
    function syncGroupPlaybackInputs() {
      if (!elements.fps || !elements.fpsValue || !elements.rootMotionX || !elements.rootMotionY) {
        updateWorkbenchHud();
        return;
      }
      const fps = groupPlaybackFps();
      const rootMotion = groupRootMotion();
      const owner = attachedPlaybackOwnerGroup();
      const attachedTiming = usesAttachedPlaybackTiming();
      const playbackEditable = canEditFramePlayback();
      elements.fps.value = fps;
      elements.fpsValue.textContent = round(fps);
      elements.fps.disabled = !playbackEditable || attachedTiming;
      if (elements.vfxWindowControls) elements.vfxWindowControls.hidden = !attachedTiming;
      if (attachedTiming && owner && elements.vfxStartFrame && elements.vfxEndFrame) {
        const window = attachedVfxPlaybackWindow();
        const maxFrame = owner.frames?.length || 1;
        elements.vfxStartFrame.max = maxFrame;
        elements.vfxEndFrame.max = maxFrame;
        elements.vfxStartFrame.value = window.start + 1;
        elements.vfxEndFrame.value = window.end + 1;
      }
      elements.rootMotionX.value = rootMotion.x;
      elements.rootMotionY.value = rootMotion.y;
      elements.rootMotionX.disabled = !playbackEditable || attachedTiming;
      elements.rootMotionY.disabled = !playbackEditable || attachedTiming;
      updateWorkbenchHud();
    }

    return {
      canEditAdjustmentMode,
      canEditCharacterTransform: canEditCharacterTransformForGroup,
      normalizeAdjustmentMode,
      adjustmentTransform,
      transformFromAdjustmentInputs,
      compactDisplayedNumber,
      isIncompleteNumberInput,
      sanitizeAdjustmentNumberInput,
      beginAdjustmentNumberEdit,
      retainAdjustmentNumberSelection,
      applyAdjustmentNumberInput,
      parseAdjustmentNumber,
      normalizeAdjustmentInputDisplay,
      adjustmentNumberInputs,
      adjustmentStepButtonsForInput,
      beginStepAdjustmentEdit,
      endStepAdjustmentEdit,
      stepAdjustmentInput,
      stepOffsetByArrowKey,
      syncAdjustmentModeInputs,
      syncAdjustmentInputs,
      syncBaseInputs: syncAdjustmentInputs,
      syncCharacterBaseInputs,
      syncFrameInputs,
      syncGroupPlaybackInputs,
    };
  }

  return {
    compactDisplayedNumber,
    createController,
    isIncompleteNumberInput,
    sanitizeAdjustmentNumberInput,
  };
});
