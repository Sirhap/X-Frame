(function attachXFrameOrganizerProgressOverlay(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.XFrameOrganizerProgressOverlay = api;
    // Production bundles this file into ui.js after the inline boot script.
    api.scheduleAttach(api, root.document, root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const START_TIMEOUT_MS = 5000;
  const FINISHED_PATTERN = /完成|成功|complete|finished/iu;
  const PROGRESS_PATTERN = /(\d+)\s*\/\s*(\d+)/u;

  /**
   * Writes progress copy only when it changed. Mutation observers must never
   * observe and then rewrite their own caption, otherwise they create an
   * endless microtask loop that starves Worker responses and browser painting.
   * @param {{textContent?:string}|null} caption Progress caption.
   * @param {string} value Next caption.
   * @returns {boolean} Whether the DOM value changed.
   */
  function writeCaption(caption, value) {
    if (!caption || caption.textContent === value) return false;
    caption.textContent = value;
    return true;
  }

  /**
   * Synchronizes the determinate progress bar when frame counts are known.
   * @param {{max?:number,value?:number,removeAttribute?:(name:string)=>void}|null} meter Progress element.
   * @param {{current?:number,total?:number}} progress Parsed progress.
   * @returns {void}
   */
  function writeProgress(meter, progress) {
    if (!meter) return;
    const total = Math.max(0, Number(progress.total) || 0);
    const current = Math.max(0, Number(progress.current) || 0);
    if (!total) {
      meter.removeAttribute?.("value");
      return;
    }
    meter.max = total;
    meter.value = Math.min(total, current);
  }

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
   * First-paint n matches process: selected∩included when any included card is
   * selected, otherwise all included cards.
   * @param {ParentNode|null|undefined} documentApi Overlay document.
   * @returns {number} Frame count the batch will process.
   */
  function processFrameCount(documentApi) {
    const selectedIncluded =
      documentApi?.querySelectorAll?.(".organizerFrame.included.selected")?.length || 0;
    if (selectedIncluded > 0) return selectedIncluded;
    return documentApi?.querySelectorAll?.(".organizerFrame.included")?.length || 0;
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
    let attached = false;

    function attach() {
      if (attached) return true;
      const button = documentApi.querySelector("#organizerBatchCutout");
      const overlay = documentApi.querySelector("#organizerSmartCutoutProgress");
      const caption = documentApi.querySelector("#organizerSmartCutoutProgressText");
      const meter = documentApi.querySelector("#organizerSmartCutoutProgressBar");
      const cancel = documentApi.querySelector("#organizerSmartCutoutCancel");
      const organizer = documentApi.querySelector("#organizerModal");
      if (!button || !overlay || !caption || !organizer) return false;
      attached = true;
      let startedAt = 0;
      let sawBusy = false;
      let observer = null;
      let startTimer = 0;
      const hide = () => {
        overlay.hidden = true;
        if (cancel) cancel.disabled = false;
        observer?.disconnect();
        observer = null;
        windowApi.clearTimeout?.(startTimer);
        startTimer = 0;
      };
      const readSignals = () => {
        const statusText = documentApi.querySelector("#organizerStatus")?.textContent || "";
        const progress = parseProgress(`${button.textContent || ""} ${statusText}`);
        if (progress.current || progress.total) {
          writeCaption(caption, progressLabel(progress));
          writeProgress(meter, progress);
        }
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
          const total = processFrameCount(documentApi);
          writeCaption(caption, progressLabel({ total }));
          writeProgress(meter, { current: 0, total });
          overlay.hidden = false;
          startedAt = now();
          sawBusy = false;
          if (cancel) cancel.disabled = false;
          observer?.disconnect();
          observer = new windowApi.MutationObserver(settle);
          observer.observe(button, {
            attributes: true,
            attributeFilter: ["disabled"],
            childList: true,
            subtree: true,
            characterData: true,
          });
          const status = documentApi.querySelector("#organizerStatus");
          if (status) {
            observer.observe(status, { childList: true, subtree: true, characterData: true });
          }
          observer.observe(organizer, { attributes: true, attributeFilter: ["hidden"] });
          windowApi.clearTimeout?.(startTimer);
          startTimer = windowApi.setTimeout?.(settle, START_TIMEOUT_MS + 1) || 0;
        },
        { capture: true },
      );
      cancel?.addEventListener("click", () => {
        cancel.disabled = true;
        writeCaption(caption, "正在取消智能抠图…");
        documentApi.querySelector("#cutoutCancelProcess")?.click?.();
      });
      return true;
    }

    return { attach, shouldKeepVisible };
  }

  /**
   * Attaches after the document and bundled scripts are present.
   * Production moves the overlay module into `ui.js` after this inline call.
   * @param {object} api Overlay API.
   * @param {Document|null|undefined} documentApi Host document.
   * @param {Window|typeof globalThis|null|undefined} windowApi Host window.
   * @returns {boolean} Whether attach ran or was scheduled.
   */
  const attachedDocuments = typeof WeakSet === "function" ? new WeakSet() : null;

  function scheduleAttach(api, documentApi, windowApi) {
    if (!api?.createOverlay || !documentApi?.querySelector) return false;
    const start = () => {
      if (attachedDocuments?.has(documentApi)) return true;
      const attached = Boolean(api.createOverlay({ documentApi, windowApi }).attach());
      if (attached) attachedDocuments?.add(documentApi);
      return attached;
    };
    if (documentApi.readyState === "loading") {
      documentApi.addEventListener("DOMContentLoaded", start, { once: true });
      return true;
    }
    return start();
  }

  return Object.freeze({
    START_TIMEOUT_MS,
    createOverlay,
    parseProgress,
    processFrameCount,
    progressLabel,
    scheduleAttach,
    shouldKeepVisible,
    writeCaption,
    writeProgress,
  });
});
