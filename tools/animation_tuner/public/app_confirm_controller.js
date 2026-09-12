(function attachXFrameAppConfirm(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppConfirm = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])';

  /**
   * Creates the application-level confirmation layer used by main-workbench actions.
   * @param {{
   *   elements?:{
   *     panel?:HTMLElement,
   *     card?:HTMLElement,
   *     title?:HTMLElement,
   *     message?:HTMLElement,
   *     details?:HTMLElement,
   *     cancel?:HTMLButtonElement,
   *     alternate?:HTMLButtonElement,
   *     accept?:HTMLButtonElement,
   *   },
   *   documentRef?:Document,
   *   windowRef?:Window,
   * }} dependencies DOM dependencies.
   * @returns {{
   *   bind:()=>void,
   *   isOpen:()=>boolean,
   *   requestConfirmation:(message:string,details?:Array<[string,string|number]>,options?:object)=>Promise<boolean>,
   *   requestDecision:(message:string,options?:object)=>Promise<"save"|"discard"|"cancel">,
   *   resolveConfirmation:(accepted:boolean)=>boolean,
   * }} Confirmation controller.
   */
  function createController(dependencies = {}) {
    const elements = dependencies.elements || {};
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const requiredElements = [
      elements.panel,
      elements.card,
      elements.title,
      elements.message,
      elements.details,
      elements.cancel,
      elements.accept,
    ];
    if (!documentRef?.createElement || requiredElements.some((element) => !element)) {
      throw new TypeError("XSXB app confirmation DOM dependencies are required.");
    }

    let bound = false;
    let confirmationResolver = null;
    let confirmationMode = "boolean";
    let returnFocus = null;
    let previousAppInert = false;

    /**
     * Returns whether a control can receive Tab focus.
     * Do not use `offsetParent` or `getClientRects`: `#appConfirmPanel` is
     * `position: fixed` (offsetParent is null) and a just-opened dialog can
     * have empty rects, which dropped every button from the trap.
     * @param {HTMLElement} element Candidate control.
     * @returns {boolean} Whether the control should be in the Tab cycle.
     */
    function isDisplayedForFocus(element) {
      return Boolean(element) && !element.disabled && !element.hidden;
    }

    /**
     * Returns the confirmation actions that should cycle under Tab.
     * Prefer the known action buttons so a query/layout miss cannot empty the trap.
     * @returns {HTMLElement[]} Focusable controls.
     */
    function focusableElements() {
      const known = [elements.cancel, elements.alternate, elements.accept].filter(isDisplayedForFocus);
      if (known.length) return known;
      return Array.from(elements.panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isDisplayedForFocus);
    }

    /**
     * Restores main-workbench interaction after the confirmation closes.
     * @returns {void}
     */
    function restoreInteraction() {
      const app = documentRef.querySelector?.(".app");
      if (app) app.inert = previousAppInert;
      const focusTarget = returnFocus;
      returnFocus = null;
      if (focusTarget && focusTarget.isConnected !== false && typeof focusTarget.focus === "function") {
        focusTarget.focus();
      }
    }

    /**
     * Resolves and closes the active confirmation.
     * @param {boolean} accepted Whether the user accepted the action.
     * @returns {boolean} Whether a pending confirmation was resolved.
     */
    function resolveConfirmation(accepted) {
      if (!confirmationResolver) return false;
      const resolver = confirmationResolver;
      confirmationResolver = null;
      elements.panel.hidden = true;
      elements.card.removeAttribute("data-tone");
      restoreInteraction();
      resolver(confirmationMode === "decision" ? (accepted ? "discard" : "cancel") : Boolean(accepted));
      confirmationMode = "boolean";
      return true;
    }

    /**
     * Resolves the active three-way navigation decision.
     * @param {"save"|"discard"|"cancel"} decision Selected action.
     * @returns {boolean} Whether a pending decision was resolved.
     */
    function resolveDecision(decision) {
      if (!confirmationResolver || confirmationMode !== "decision") return false;
      const resolver = confirmationResolver;
      confirmationResolver = null;
      confirmationMode = "boolean";
      elements.panel.hidden = true;
      elements.card.removeAttribute("data-tone");
      if (elements.alternate) elements.alternate.hidden = true;
      restoreInteraction();
      resolver(["save", "discard"].includes(decision) ? decision : "cancel");
      return true;
    }

    /**
     * Opens an application-styled confirmation layer.
     * @param {string} message Confirmation message.
     * @param {Array<[string,string|number]>} [details] Optional operation summary rows.
     * @param {{title?:string,confirmLabel?:string,cancelLabel?:string,tone?:"warning"|"danger"}} [options] Dialog labels and tone.
     * @returns {Promise<boolean>} Whether the user accepted the action.
     */
    function requestConfirmation(message, details = [], options = {}) {
      if (confirmationResolver) resolveConfirmation(false);
      confirmationMode = "boolean";
      if (elements.alternate) elements.alternate.hidden = true;
      elements.title.textContent = options.title || "Confirm action";
      elements.message.textContent = String(message || "");
      elements.cancel.textContent = options.cancelLabel || "Cancel";
      elements.accept.textContent = options.confirmLabel || "Confirm";
      elements.details.replaceChildren();
      for (const [label, value] of details) {
        const term = documentRef.createElement("dt");
        const description = documentRef.createElement("dd");
        term.textContent = String(label);
        description.textContent = String(value);
        elements.details.append(term, description);
      }
      elements.details.hidden = details.length === 0;
      elements.card.dataset.tone = options.tone === "danger" ? "danger" : "warning";
      returnFocus = documentRef.activeElement;
      const app = documentRef.querySelector?.(".app");
      previousAppInert = Boolean(app?.inert);
      if (app) app.inert = true;
      elements.panel.hidden = false;
      const focusInitialControl = () => {
        const initialControl = options.tone === "danger" ? elements.cancel : elements.accept;
        initialControl.focus();
      };
      if (typeof windowRef?.setTimeout === "function") windowRef.setTimeout(focusInitialControl, 0);
      else focusInitialControl();
      return new Promise((resolve) => {
        confirmationResolver = resolve;
      });
    }

    /**
     * Opens a three-way save, discard, or cancel decision dialog.
     * @param {string} message Decision explanation.
     * @param {{title?:string,saveLabel?:string,discardLabel?:string,cancelLabel?:string}} [options] Labels.
     * @returns {Promise<"save"|"discard"|"cancel">} Selected action.
     */
    function requestDecision(message, options = {}) {
      if (!elements.alternate) return Promise.resolve("cancel");
      if (confirmationResolver) resolveConfirmation(false);
      confirmationMode = "decision";
      elements.title.textContent = options.title || "Unsaved changes";
      elements.message.textContent = String(message || "");
      elements.cancel.textContent = options.cancelLabel || "Cancel";
      elements.alternate.textContent = options.saveLabel || "Save";
      elements.accept.textContent = options.discardLabel || "Discard";
      elements.alternate.hidden = false;
      elements.details.replaceChildren();
      elements.details.hidden = true;
      elements.card.dataset.tone = "danger";
      returnFocus = documentRef.activeElement;
      const app = documentRef.querySelector?.(".app");
      previousAppInert = Boolean(app?.inert);
      if (app) app.inert = true;
      elements.panel.hidden = false;
      const focusInitialControl = () => elements.cancel.focus();
      if (typeof windowRef?.setTimeout === "function") windowRef.setTimeout(focusInitialControl, 0);
      else focusInitialControl();
      return new Promise((resolve) => {
        confirmationResolver = resolve;
      });
    }

    /**
     * Handles cancellation and keyboard focus containment.
     * @param {KeyboardEvent} event Keyboard event.
     * @returns {void}
     */
    function handleKeydown(event) {
      if (elements.panel.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        resolveConfirmation(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      event.preventDefault();
      event.stopPropagation?.();
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(documentRef.activeElement);
      if (event.shiftKey) {
        const next = currentIndex <= 0 ? focusable[focusable.length - 1] : focusable[currentIndex - 1];
        next.focus();
        return;
      }
      const next =
        currentIndex === -1 || currentIndex >= focusable.length - 1
          ? focusable[0]
          : focusable[currentIndex + 1];
      next.focus();
    }

    /**
     * Pulls focus back when it lands outside the open confirmation.
     * @param {FocusEvent} event Focus event.
     * @returns {void}
     */
    function handleFocusIn(event) {
      if (elements.panel.hidden) return;
      if (typeof elements.panel.contains === "function" && elements.panel.contains(event.target)) return;
      const focusable = focusableElements();
      const fallback = elements.card?.dataset?.tone === "danger" ? elements.cancel : elements.accept;
      (focusable[0] || fallback)?.focus?.();
    }

    /**
     * Binds the confirmation layer once.
     * @returns {void}
     */
    function bind() {
      if (bound) return;
      bound = true;
      elements.cancel.addEventListener("click", () => resolveConfirmation(false));
      elements.alternate?.addEventListener("click", () => resolveDecision("save"));
      elements.accept.addEventListener("click", () => resolveConfirmation(true));
      elements.panel.addEventListener("click", (event) => {
        if (event.target === elements.panel) resolveConfirmation(false);
      });
      documentRef.addEventListener("keydown", handleKeydown, true);
      documentRef.addEventListener("focusin", handleFocusIn);
    }

    bind();
    return {
      bind,
      isOpen: () => !elements.panel.hidden,
      requestConfirmation,
      requestDecision,
      resolveConfirmation,
      resolveDecision,
    };
  }

  return Object.freeze({ createController });
});
