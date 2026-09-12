(function attachXFrameAppNavigationGuard(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameAppNavigationGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const DEFAULT_SELECTOR = "[data-document-navigation]";
  const HISTORY_BASE_KEY = "xsxbDocumentNavigationBase";
  const HISTORY_GUARD_KEY = "xsxbDocumentNavigationGuard";

  /**
   * Creates the guard for app-owned links that intentionally leave the editor document.
   * @param {{
   *   documentRef?:Document,
   *   windowRef?:Window,
   *   selector?:string,
   *   hasUnsavedChanges?:()=>boolean,
   *   requestNavigation?:({href:string,anchor:HTMLAnchorElement|null})=>Promise<boolean>|boolean,
   *   reportError?:(error:Error)=>void,
   * }} [dependencies] Navigation and unsaved-state dependencies.
   * @returns {{bind:()=>void,destroy:()=>void,isNavigationApproved:()=>boolean}} Guard operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const selector = dependencies.selector || DEFAULT_SELECTOR;
    const hasUnsavedChanges = dependencies.hasUnsavedChanges || (() => false);
    const requestNavigation = dependencies.requestNavigation || (async () => false);
    const reportError = dependencies.reportError || (() => {});
    if (!documentRef?.addEventListener || !windowRef?.addEventListener) {
      throw new TypeError("XSXB navigation guard requires document and window event targets.");
    }

    let bound = false;
    let navigationPending = false;
    let navigationApproved = false;

    /** Returns a copyable object representation of a browser history state. */
    function historyState(value) {
      return value && typeof value === "object" ? value : {};
    }

    /** Places one same-URL history entry in front of the document boundary. */
    function installHistoryGuard() {
      if (!windowRef.history?.replaceState || !windowRef.history?.pushState) return;
      const href = windowRef.location?.href;
      const state = historyState(windowRef.history.state);
      windowRef.history.replaceState({ ...state, [HISTORY_BASE_KEY]: true }, "", href);
      windowRef.history.pushState({ ...state, [HISTORY_GUARD_KEY]: true }, "", href);
    }

    /** Restores the same-URL guard after a browser-back decision is cancelled. */
    function restoreHistoryGuard() {
      if (!windowRef.history?.pushState) return;
      const href = windowRef.location?.href;
      const state = historyState(windowRef.history.state);
      windowRef.history.pushState({ ...state, [HISTORY_GUARD_KEY]: true }, "", href);
    }

    /** Resets approval if a requested document transition fails to unload the page. */
    function scheduleApprovalReset() {
      windowRef.setTimeout?.(() => {
        navigationApproved = false;
      }, 1000);
    }

    /** Returns whether a click should retain native browser behavior. */
    function usesModifiedNavigation(event) {
      return (
        event.defaultPrevented ||
        (typeof event.button === "number" && event.button !== 0) ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      );
    }

    /** Resolves the guarded anchor represented by an event target. */
    function guardedAnchor(target) {
      const anchor = target?.closest?.(selector);
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self")) return null;
      return anchor;
    }

    /** Handles app-owned document navigation without exposing the browser's generic prompt. */
    async function handleDocumentClick(event) {
      if (usesModifiedNavigation(event)) return;
      const anchor = guardedAnchor(event.target);
      if (!anchor || !hasUnsavedChanges()) return;
      event.preventDefault();
      if (navigationPending) return;
      navigationPending = true;
      try {
        const accepted = await requestNavigation({ href: anchor.href, anchor });
        if (!accepted) return;
        navigationApproved = true;
        windowRef.location.assign(anchor.href);
        scheduleApprovalReset();
      } catch (error) {
        navigationApproved = false;
        reportError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        navigationPending = false;
      }
    }

    /** Handles the final browser-back step before it crosses the editor document boundary. */
    async function handleHistoryNavigation(event) {
      if (!event.state?.[HISTORY_BASE_KEY]) return;
      event.stopImmediatePropagation?.();
      if (navigationPending) {
        restoreHistoryGuard();
        return;
      }
      navigationPending = true;
      try {
        const accepted = !hasUnsavedChanges() || (await requestNavigation({ href: "", anchor: null }));
        if (!accepted) {
          restoreHistoryGuard();
          return;
        }
        navigationApproved = true;
        windowRef.history.back();
        scheduleApprovalReset();
      } catch (error) {
        navigationApproved = false;
        restoreHistoryGuard();
        reportError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        navigationPending = false;
      }
    }

    /** Preserves native refresh/tab-close protection for navigation that was not approved in-app. */
    function handleBeforeUnload(event) {
      if (navigationApproved || !hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    /** Binds document navigation and unload protection once. */
    function bind() {
      if (bound) return;
      bound = true;
      installHistoryGuard();
      documentRef.addEventListener("click", handleDocumentClick, true);
      windowRef.addEventListener("beforeunload", handleBeforeUnload);
      windowRef.addEventListener("popstate", handleHistoryNavigation);
    }

    /** Removes every listener owned by the guard. */
    function destroy() {
      if (!bound) return;
      bound = false;
      documentRef.removeEventListener("click", handleDocumentClick, true);
      windowRef.removeEventListener("beforeunload", handleBeforeUnload);
      windowRef.removeEventListener("popstate", handleHistoryNavigation);
    }

    bind();
    return {
      bind,
      destroy,
      isNavigationApproved: () => navigationApproved,
    };
  }

  return Object.freeze({ DEFAULT_SELECTOR, HISTORY_BASE_KEY, HISTORY_GUARD_KEY, createController });
});
