(function attachKeyboardModule(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppKeyboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DEFAULT_MODAL_IDS = ["cutoutModal", "organizerModal"];

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
      return modalIds.some((id) => !documentRef?.querySelector?.(`#${id}`)?.hidden);
    }

    /** Handles editor-level shortcuts and frame navigation. */
    function handleEditorKeydown(event) {
      if (isModalOpen()) return;

      const command = Boolean(event.ctrlKey || event.metaKey);
      const key = String(event.key || "").toLowerCase();
      if (command && key === "s") {
        event.preventDefault?.();
        runAsync(save, "saveFailed");
        return;
      }
      if (command && key === "z") {
        event.preventDefault?.();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && key === "c" && copyFrameImageAttachments()) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (command && key === "v" && pasteFrameImageAttachments()) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }

      const typing = Boolean(isTypingTarget(event));
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

      const group = getCurrentGroup();
      const frameCount = group?.frames?.length || 0;
      if (command && key === "a" && frameCount) {
        event.preventDefault?.();
        setSelectedFrames(new Set(group.frames.map((_frame, index) => index)));
        setSelectedFrame(Math.max(0, frameCount - 1));
        setSelectionAnchorFrame(0);
        syncFrameInputs();
        renderFilmstrip();
        draw();
        return;
      }
      if (!command && (event.key === "ArrowLeft" || event.key === "ArrowRight") && frameCount) {
        event.preventDefault?.();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const nextIndex = Math.max(0, Math.min(frameCount - 1, getSelectedFrame() + direction));
        selectFilmstripFrame(nextIndex, event.shiftKey ? { shiftKey: true } : null);
        documentRef
          ?.querySelector?.(`.thumb[data-frame-index="${nextIndex}"]`)
          ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        return;
      }
      if (!command && key === "f") {
        event.preventDefault?.();
        fitView();
        draw();
        return;
      }
      if (!command && event.key === "0") {
        event.preventDefault?.();
        centerStageContent(1, "actual");
        draw();
        return;
      }
      if (event.key === " " && playPauseElement) {
        event.preventDefault?.();
        playPauseElement.click?.();
      }
    }

    /** Handles Ctrl/Cmd+1/2/3 workbench navigation. */
    function handleRouteKeydown(event) {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) return;
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
      if (String(event.key || "").toLowerCase() !== "h") return;
      if (!getReferenceFrameHiddenByKey()) return;
      setReferenceFrameHiddenByKey(false);
      draw();
    }

    /** Releases all temporary key state when the browser window loses focus. */
    function handleBlur() {
      clearHeldAttachmentTransformKeys();
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
