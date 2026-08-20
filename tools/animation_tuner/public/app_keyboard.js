(function attachKeyboardModule(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppKeyboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_MODAL_IDS = ["cutoutModal", "organizerModal", "appConfirmPanel"];

  /**
   * Creates the application keyboard shortcut controller.
   *
   * Browser event wiring is kept here while application state and mutations
   * remain explicit callbacks. This lets the main app preserve its state
   * ownership without coupling this controller to global variables.
   *
   * @param {object} dependencies Controller dependencies.
   * @param {Window} [dependencies.windowRef] Window-like event target.
   * @param {Document} [dependencies.documentRef] Document used for modal and thumb lookup.
   * @param {string[]} [dependencies.modalIds] Modal element ids that suspend shortcuts.
   * @returns {{bind:()=>()=>void, unbind:()=>void, handleEditorKeydown:(event:KeyboardEvent)=>void, handleRouteKeydown:(event:KeyboardEvent)=>void, handleKeyup:(event:KeyboardEvent)=>void, handleBlur:()=>void}} Keyboard controller.
   */
  function createController(dependencies = {}) {
    const {
      windowRef = globalThis,
      documentRef = globalThis.document,
      modalIds = DEFAULT_MODAL_IDS,
      isTypingTarget = () => false,
      isNumberInputTarget = () => false,
      save = () => Promise.resolve(),
      undo = () => {},
      redo = () => {},
      copyFrameImageAttachments = () => false,
      pasteFrameImageAttachments = () => false,
      trackAttachmentTransformKey = () => false,
      getReferenceFrame = () => null,
      getReferenceFrameHiddenByKey = () => false,
      setReferenceFrameHiddenByKey = () => {},
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      setSelectedFrame = () => {},
      setSelectedFrames = () => {},
      setSelectionAnchorFrame = () => {},
      syncFrameInputs = () => {},
      renderFilmstrip = () => {},
      draw = () => {},
      selectFilmstripFrame = () => {},
      fitView = () => {},
      centerStageContent = () => {},
      setStageZoom = () => {},
      getStageZoom = () => 1,
      setStageSpacePan = () => {},
      getStageSpacePan = () => false,
      getStageSpacePanConsumed = () => false,
      setStageSpacePanConsumed = () => {},
      playPauseElement = null,
      clearHeldAttachmentTransformKeys = () => {},
      getCurrentWorkbenchRoute = () => "",
      syncWorkbenchRoute = () => {},
      applyWorkbenchRoute = () => Promise.resolve(),
      status = () => {},
      translate = (_key, vars = {}) => vars.message || "Operation failed",
    } = dependencies;

    let bound = false;

    /** Safely renders an error through the app status callback. */
    function reportAsyncError(error, key) {
      const message = error instanceof Error ? error.message : String(error);
      status(translate(key, { message }));
    }

    /** Runs an action and reports both synchronous and asynchronous failures. */
    function runAsync(action, errorKey) {
      try {
        Promise.resolve()
          .then(action)
          .catch((error) => reportAsyncError(error, errorKey));
      } catch (error) {
        reportAsyncError(error, errorKey);
      }
    }

    /** Returns whether a tool modal currently owns keyboard focus. */
    function isModalOpen() {
      return modalIds.some((id) => {
        const modal = documentRef?.querySelector?.(`#${id}`);
        return Boolean(modal && !modal.hidden);
      });
    }

    /** Returns whether editor undo/redo should win over the focused control. */
    function shouldHandleHistoryShortcut(typing, event) {
      return !typing || Boolean(isNumberInputTarget(event));
    }

    /** Returns whether Space should arm stage pan / play instead of a control. */
    function isStagePlayTarget(event) {
      const target = event?.target;
      if (!target) return false;
      if (target.id === "stage") return true;
      return Boolean(target.closest?.("#stage"));
    }

    /** Returns whether the event target owns native keyboard interaction. */
    function isInteractiveShortcutTarget(event) {
      const target = event?.target;
      if (!target) return false;
      if (target.isContentEditable) return true;
      if (["A", "BUTTON", "INPUT", "SELECT", "SUMMARY", "TEXTAREA"].includes(target.tagName)) {
        return true;
      }
      if (["button", "link", "menuitem", "option", "tab"].includes(target.getAttribute?.("role"))) {
        return true;
      }
      return Boolean(
        target.closest?.(
          'a[href], button, input, select, summary, textarea, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]',
        ),
      );
    }

    /** Returns whether the frame card itself, rather than a child control, owns the event. */
    function isFrameCardTarget(event) {
      const target = event?.target;
      return Boolean(
        target?.matches?.('.thumb[role="option"]') ||
        (target?.classList?.contains?.("thumb") && target?.getAttribute?.("role") === "option"),
      );
    }

    /** Handles editor-level shortcuts and frame navigation. */
    function handleEditorKeydown(event) {
      if (isModalOpen()) return;

      const command = Boolean(event.ctrlKey || event.metaKey);
      const key = String(event.key || "").toLowerCase();
      const typing = Boolean(isTypingTarget(event));
      if (command && key === "s") {
        event.preventDefault?.();
        runAsync(save, "saveFailed");
        return;
      }
      if (shouldHandleHistoryShortcut(typing, event) && command && key === "z") {
        event.preventDefault?.();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (shouldHandleHistoryShortcut(typing, event) && command && key === "y") {
        event.preventDefault?.();
        redo();
        return;
      }
      if (!typing && command && key === "c" && copyFrameImageAttachments()) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (!typing && command && key === "v" && pasteFrameImageAttachments()) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }

      const trackingAttachmentKey =
        (!typing || isNumberInputTarget(event)) && trackAttachmentTransformKey(event, true);
      if (trackingAttachmentKey && isNumberInputTarget(event)) event.preventDefault?.();

      if (
        getReferenceFrame() &&
        !command &&
        !event.altKey &&
        !event.isComposing &&
        key === "h" &&
        (!typing || isNumberInputTarget(event))
      ) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!getReferenceFrameHiddenByKey()) {
          setReferenceFrameHiddenByKey(true);
          draw();
        }
        return;
      }
      if (typing) return;

      const interactiveTarget = isInteractiveShortcutTarget(event);
      const frameCardTarget = isFrameCardTarget(event);
      const canHandleApplicationShortcut = !interactiveTarget || frameCardTarget;
      const group = getCurrentGroup();
      const frameCount = group?.frames?.length || 0;
      if (canHandleApplicationShortcut && command && key === "a" && frameCount) {
        event.preventDefault?.();
        setSelectedFrames(new Set(group.frames.map((_frame, index) => index)));
        setSelectedFrame(Math.max(0, frameCount - 1));
        setSelectionAnchorFrame(0);
        syncFrameInputs();
        renderFilmstrip();
        draw();
        return;
      }
      if (
        canHandleApplicationShortcut &&
        !command &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        frameCount
      ) {
        event.preventDefault?.();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const nextIndex = Math.max(0, Math.min(frameCount - 1, getSelectedFrame() + direction));
        selectFilmstripFrame(nextIndex, event.shiftKey ? { shiftKey: true } : null);
        const nextCard = documentRef?.querySelector?.(`.thumb[data-frame-index="${nextIndex}"]`);
        nextCard?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        if (frameCardTarget) nextCard?.focus?.();
        return;
      }
      if (canHandleApplicationShortcut && !command && key === "f") {
        event.preventDefault?.();
        fitView();
        draw();
        return;
      }
      if (canHandleApplicationShortcut && !command && event.key === "0") {
        event.preventDefault?.();
        centerStageContent(1, "actual");
        draw();
        return;
      }
      if (canHandleApplicationShortcut && command && (key === "=" || key === "+" || event.key === "+")) {
        event.preventDefault?.();
        setStageZoom(getStageZoom() * 1.08);
        return;
      }
      if (canHandleApplicationShortcut && command && key === "-") {
        event.preventDefault?.();
        setStageZoom(getStageZoom() * 0.92);
        return;
      }
      if (
        !interactiveTarget &&
        isStagePlayTarget(event) &&
        !command &&
        !event.altKey &&
        !event.repeat &&
        event.code === "Space"
      ) {
        event.preventDefault?.();
        setStageSpacePan(true);
        setStageSpacePanConsumed(false);
        return;
      }
    }

    /** Handles Ctrl/Cmd+1/2/3 workbench navigation. */
    function handleRouteKeydown(event) {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (isInteractiveShortcutTarget(event) && !isFrameCardTarget(event)) return;
      const routeByKey = { 1: "import", 2: "organizer", 3: "cutout" };
      const route = routeByKey[event.key];
      if (!route || route === getCurrentWorkbenchRoute()) return;
      event.preventDefault?.();
      syncWorkbenchRoute(route, { push: true });
      runAsync(applyWorkbenchRoute, "loadFailed");
    }

    /** Releases temporary attachment and reference-frame key state. */
    function handleKeyup(event) {
      trackAttachmentTransformKey(event, false);
      if (event.code === "Space") {
        const wasArmed = getStageSpacePan();
        const consumed = getStageSpacePanConsumed();
        setStageSpacePan(false);
        setStageSpacePanConsumed(false);
        // Only Space that we armed on keydown may toggle play (tap without pan).
        if (wasArmed && !consumed && !isModalOpen() && playPauseElement) {
          playPauseElement.click?.();
        }
        return;
      }
      if (String(event.key || "").toLowerCase() !== "h") return;
      if (!getReferenceFrameHiddenByKey()) return;
      setReferenceFrameHiddenByKey(false);
      draw();
    }

    /** Releases all temporary key state when the browser window loses focus. */
    function handleBlur() {
      clearHeldAttachmentTransformKeys();
      setStageSpacePan(false);
      setStageSpacePanConsumed(false);
      if (!getReferenceFrameHiddenByKey()) return;
      setReferenceFrameHiddenByKey(false);
      draw();
    }

    /** Binds all keyboard listeners and returns an idempotent cleanup function. */
    function bind() {
      if (bound) return unbind;
      bound = true;
      windowRef.addEventListener("keydown", handleEditorKeydown);
      windowRef.addEventListener("keydown", handleRouteKeydown);
      windowRef.addEventListener("keyup", handleKeyup);
      windowRef.addEventListener("blur", handleBlur);
      return unbind;
    }

    /** Removes all listeners installed by {@link bind}. */
    function unbind() {
      if (!bound) return;
      bound = false;
      windowRef.removeEventListener("keydown", handleEditorKeydown);
      windowRef.removeEventListener("keydown", handleRouteKeydown);
      windowRef.removeEventListener("keyup", handleKeyup);
      windowRef.removeEventListener("blur", handleBlur);
    }

    return Object.freeze({
      bind,
      unbind,
      handleEditorKeydown,
      handleRouteKeydown,
      handleKeyup,
      handleBlur,
    });
  }

  return Object.freeze({ createController });
});
