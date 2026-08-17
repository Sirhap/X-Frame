(function attachXsxbAppSurface(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppSurface = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const ORGANIZER_PATHS = Object.freeze([
    "/tools/import",
    "/tools/organizer",
    "/workspace/tools/organizer",
    "/workspace/resources/import",
  ]);
  const CUTOUT_PATHS = Object.freeze([
    "/tools/cutout",
    "/workspace/tools/cutout",
    "/workspace/resources/cutout",
  ]);
  const SCATTER_PATHS = Object.freeze(["/tools/scatter-slice", "/workspace/resources/scatter"]);

  /**
   * Strips a trailing slash so route tables match the browser path.
   * @param {unknown} pathname Location pathname.
   * @returns {string} Canonical path.
   */
  function normalizePath(pathname) {
    return String(pathname || "/").replace(/\/+$/u, "") || "/";
  }

  /**
   * Returns the first-paint surface for one pathname.
   * @param {unknown} pathname Location pathname.
   * @returns {"projects"|"tools"|"scatter"|"delivery"|"tool"|"workspace"} Surface id.
   */
  function resolveAppSurface(pathname) {
    const path = normalizePath(pathname);
    if (path === "/projects") return "projects";
    if (path === "/tools") return "tools";
    if (SCATTER_PATHS.includes(path)) return "scatter";
    if (path.startsWith("/workspace/delivery") || path === "/tools/export") return "delivery";
    if (ORGANIZER_PATHS.includes(path) || CUTOUT_PATHS.includes(path)) return "tool";
    return "workspace";
  }

  /**
   * Returns the overlay that must appear with a tool URL before app.js boots.
   * @param {unknown} pathname Location pathname.
   * @returns {"organizer"|"cutout"|""} Overlay id.
   */
  function resolveToolOverlay(pathname) {
    const path = normalizePath(pathname);
    if (ORGANIZER_PATHS.includes(path)) return "organizer";
    if (CUTOUT_PATHS.includes(path)) return "cutout";
    return "";
  }

  /**
   * Applies the URL surface before workbench controllers finish loading.
   * @param {Document} documentRef Document to stamp.
   * @param {unknown} pathname Location pathname.
   * @returns {string} Applied surface.
   */
  function applyAppSurface(documentRef, pathname) {
    const surface = resolveAppSurface(pathname);
    const overlay = resolveToolOverlay(pathname);
    documentRef?.documentElement?.setAttribute?.("data-app-surface", surface);
    documentRef?.body?.setAttribute?.("data-app-surface", surface);
    const workspace =
      documentRef?.querySelector?.("#mainWorkbench > .workspace") ||
      documentRef?.querySelector?.(".workspace");
    if (workspace) workspace.hidden = surface !== "workspace";
    const organizerModal = documentRef?.getElementById?.("organizerModal");
    const cutoutModal = documentRef?.getElementById?.("cutoutModal");
    const liveOrganizer = Boolean(documentRef?.body?.classList?.contains?.("organizerOpen"));
    const liveCutout = Boolean(documentRef?.body?.classList?.contains?.("cutoutOpen"));
    if (organizerModal && (overlay === "organizer" || liveOrganizer)) organizerModal.hidden = false;
    else if (organizerModal) organizerModal.hidden = true;
    if (cutoutModal && (overlay === "cutout" || liveCutout)) cutoutModal.hidden = false;
    else if (cutoutModal) cutoutModal.hidden = true;
    if (overlay === "organizer") documentRef?.body?.classList?.add?.("organizerOpen");
    if (overlay === "cutout") documentRef?.body?.classList?.add?.("cutoutOpen");
    return surface;
  }

  return Object.freeze({
    applyAppSurface,
    normalizePath,
    resolveAppSurface,
    resolveToolOverlay,
  });
});
