(function attachXsxbOrganizerProgressOverlay(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBOrganizerProgressOverlay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const START_TIMEOUT_MS = 5000;
  const FINISHED_PATTERN = /完成|成功|complete|finished/iu;
  const PROGRESS_PATTERN = /(\d+)\s*\/\s*(\d+)/u;

  /**
   * Formats the overlay caption for the current frame progress.
   * @param {{current?:number,total?:number}} progress Parsed frame progress.
   * @returns {string}
   */
  function progressLabel(progress) {
    if (progress.current && progress.total)
      return `智能抠图处理中 · ${progress.current} / ${progress.total} 帧`;
    if (progress.total) return `智能抠图处理中 · 共 ${progress.total} 帧`;
    return "智能抠图处理中";
  }

  /**
   * Reads frame progress out of the button label and organizer status line.
   * @param {string} source Combined button and status text.
   * @returns {{current:number,total:number}}
   */
  function parseProgress(source) {
    const match = PROGRESS_PATTERN.exec(String(source || ""));
    if (!match) return { current: 0, total: 0 };
    return { current: Number(match[1]), total: Number(match[2]) };
  }

  /**
   * Decides whether the overlay should stay visible.
   * The busy button is the authoritative completion signal; an elapsed-time
   * guard only applies while the run has not started, so a long batch never
   * loses its progress indicator mid-flight.
   * @param {{organizerHidden:boolean,statusText:string,busy:boolean,sawBusy:boolean,elapsedMs:number}} signals Overlay signals.
   * @returns {boolean}
   */
  function shouldKeepVisible(signals) {
    if (signals.organizerHidden) return false;
    if (FINISHED_PATTERN.test(String(signals.statusText || ""))) return false;
    if (signals.sawBusy) return signals.busy;
    return signals.elapsedMs <= START_TIMEOUT_MS;
  }

  /**
   * Wires the smart-cutout progress overlay to organizer DOM signals.
   * @param {{documentApi:Document,windowApi:{requestAnimationFrame:Function,MutationObserver:Function,Date?:DateConstructor}}} dependencies Injected host APIs.
   * @returns {{attach:()=>boolean,shouldKeepVisible:typeof shouldKeepVisible}}
   */
  function createOverlay(dependencies) {
    const documentApi = dependencies.documentApi;
    const windowApi = dependencies.windowApi;
    const now = () => (windowApi.Date || Date).now();

    /**
     * Starts observing organizer signals until the smart-cutout run settles.
     * @returns {boolean} Whether the overlay found every required element.
     */
    function attach() {
      const button = documentApi.querySelector("#organizerBatchCutout");
      const overlay = documentApi.querySelector("#organizerSmartCutoutProgress");
      const caption = documentApi.querySelector("#organizerSmartCutoutProgressText");
      const organizer = documentApi.querySelector("#organizerModal");
      if (!button || !overlay || !caption || !organizer) return false;
      let startedAt = 0;
      let sawBusy = false;
      let observer = null;
      const hide = () => {
        overlay.hidden = true;
        observer?.disconnect();
        observer = null;
      };
      const readSignals = () => {
        const statusText = documentApi.querySelector("#organizerStatus")?.textContent || "";
        const progress = parseProgress(`${button.textContent || ""} ${statusText}`);
        if (progress.current || progress.total) caption.textContent = progressLabel(progress);
        sawBusy ||= Boolean(button.disabled);
        return {
          organizerHidden: Boolean(organizer.hidden),
          statusText,
          busy: Boolean(button.disabled),
          sawBusy,
          elapsedMs: now() - startedAt,
        };
      };
      const settle = () => {
        if (overlay.hidden) return true;
        if (shouldKeepVisible(readSignals())) return false;
        hide();
        return true;
      };
      button.addEventListener(
        "click",
        () => {
          const total = documentApi.querySelectorAll(".organizerFrame").length;
          caption.textContent = progressLabel({ total });
          overlay.hidden = false;
          startedAt = now();
          sawBusy = false;
          observer?.disconnect();
          observer = new windowApi.MutationObserver(settle);
          observer.observe(documentApi.body, {
            attributes: true,
            attributeFilter: ["disabled", "hidden", "open", "class"],
            childList: true,
            subtree: true,
            characterData: true,
          });
          const poll = () => {
            if (settle()) return;
            windowApi.requestAnimationFrame(poll);
          };
          windowApi.requestAnimationFrame(poll);
        },
        { capture: true },
      );
      return true;
    }

    return { attach, shouldKeepVisible };
  }

  return Object.freeze({
    START_TIMEOUT_MS,
    createOverlay,
    parseProgress,
    progressLabel,
    shouldKeepVisible,
  });
});
