(function attachClipboardMedia(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClipboardMedia = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;
  const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm)$/i;

  /**
   * Determines whether a clipboard file is a supported image or video.
   * @param {{type?:string,name?:string}|null|undefined} file Clipboard file candidate.
   * @returns {"image"|"video"|null} Supported media kind.
   */
  function mediaKind(file) {
    if (!file) return null;
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "");
    if (type.startsWith("image/") || IMAGE_EXTENSION.test(name)) return "image";
    if (type.startsWith("video/") || VIDEO_EXTENSION.test(name)) return "video";
    return null;
  }

  /**
   * Reads file-backed clipboard entries while preserving clipboard order.
   * @param {{items?:ArrayLike<object>,files?:ArrayLike<object>}|null|undefined} clipboardData Clipboard payload.
   * @returns {object[]} Clipboard files.
   */
  function readFiles(clipboardData) {
    if (!clipboardData) return [];
    const itemFiles = [];
    Array.from(clipboardData.items || []).forEach((item) => {
      if (item?.kind !== "file" || typeof item.getAsFile !== "function") return;
      try {
        const file = item.getAsFile();
        if (file) itemFiles.push(file);
      } catch (_error) {
        // Some browsers expose inaccessible clipboard items; file-list fallback remains available.
      }
    });
    return itemFiles.length ? itemFiles : Array.from(clipboardData.files || []).filter(Boolean);
  }

  /**
   * Splits clipboard files into media groups for tool-specific routing.
   * @param {{items?:ArrayLike<object>,files?:ArrayLike<object>}|null|undefined} clipboardData Clipboard payload.
   * @returns {{all:object[],images:object[],videos:object[],unsupported:object[]}} Grouped clipboard files.
   */
  function groupFiles(clipboardData) {
    const all = readFiles(clipboardData);
    const images = [];
    const videos = [];
    const unsupported = [];
    all.forEach((file) => {
      const kind = mediaKind(file);
      if (kind === "image") images.push(file);
      else if (kind === "video") videos.push(file);
      else unsupported.push(file);
    });
    return { all, images, videos, unsupported };
  }

  /**
   * Checks whether the event target should keep native text paste behavior.
   * @param {EventTarget|null|undefined} target Paste event target.
   * @returns {boolean} Whether the target is text-editable.
   */
  function isEditableTarget(target) {
    if (!target || typeof target !== "object") return false;
    if (target.isContentEditable) return true;
    const tagName = String(target.tagName || "").toLowerCase();
    if (tagName === "textarea") return true;
    if (tagName !== "input") return false;
    const type = String(target.type || "text").toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }

  /**
   * Binds a guarded paste listener and routes supported clipboard media.
   * @param {{
   *   target?:{addEventListener:Function,removeEventListener?:Function},
   *   accept?:Array<"image"|"video">,
   *   isActive?:()=>boolean,
   *   onPaste:(media:{all:object[],images:object[],videos:object[],unsupported:object[]},event:object)=>void|Promise<void>,
   *   onUnsupported?:(media:{all:object[],images:object[],videos:object[],unsupported:object[]},event:object)=>void,
   *   onError?:(error:unknown)=>void
   * }} options Paste integration options.
   * @returns {()=>void} Unbind callback.
   */
  function bindPaste(options = {}) {
    const target = options.target || root?.document;
    if (!target?.addEventListener || typeof options.onPaste !== "function") {
      throw new TypeError("Clipboard paste target and handler are required.");
    }
    const acceptedKinds = new Set(options.accept || ["image", "video"]);
    const handlePaste = (event) => {
      if (options.isActive && !options.isActive()) return;
      if (isEditableTarget(event?.target)) return;
      const media = groupFiles(event?.clipboardData);
      if (!media.all.length) return;
      const accepted = {
        ...media,
        images: acceptedKinds.has("image") ? media.images : [],
        videos: acceptedKinds.has("video") ? media.videos : [],
      };
      if (!accepted.images.length && !accepted.videos.length) {
        options.onUnsupported?.(media, event);
        return;
      }
      event.preventDefault?.();
      try {
        Promise.resolve(options.onPaste(accepted, event)).catch((error) => options.onError?.(error));
      } catch (error) {
        options.onError?.(error);
      }
    };
    target.addEventListener("paste", handlePaste);
    return () => target.removeEventListener?.("paste", handlePaste);
  }

  return { bindPaste, groupFiles, isEditableTarget, mediaKind, readFiles };
});
