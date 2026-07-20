(function attachXsxbAppUtils(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Builds a cache-busting URL for a managed frame asset.
   * @param {{path?:string}|null|undefined} frame Frame descriptor.
   * @returns {string} Asset endpoint URL.
   */
  function assetUrl(frame) {
    return `/asset?path=${encodeURIComponent(frame?.path || "")}&v=${Date.now()}`;
  }

  /**
   * Escapes text before it is inserted into an HTML template.
   * @param {unknown} value Untrusted text value.
   * @returns {string} HTML-safe text.
   */
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /**
   * Returns a human-readable project label with a stable fallback.
   * @param {{label?:string,id?:string}|null|undefined} project Project descriptor.
   * @returns {string} Display label.
   */
  function projectLabel(project) {
    if (!project) return "Project";
    return project.label || project.id || "Project";
  }

  /**
   * Returns the extra binding text shown after a group name.
   * @param {object|null|undefined} group Animation group descriptor.
   * @returns {string} Binding suffix.
   */
  function groupBindingLabel(group) {
    if (!group) return "";
    if (group.previewOwner) return ` -> ${group.previewOwner}`;
    if (Array.isArray(group.attachedLayers) && group.attachedLayers.length) {
      return ` + ${group.attachedLayers.join(", ")}`;
    }
    if (group.type !== "vfx") return "";
    const boundTarget = group.attachTo || String(group.name || "").replace(/_vfx$/, "");
    return boundTarget ? ` -> ${boundTarget}` : "";
  }

  /**
   * Builds the display label used by group selectors and status text.
   * @param {object} group Animation group descriptor.
   * @returns {string} Display label.
   */
  function groupLabel(group) {
    const fallbackTypeLabel =
      group.tuningTarget === "act2_statue_boss"
        ? "Act2 Statue"
        : group.tuningTarget === "huang_xian"
          ? "Act2 Huang Xian"
          : group.tuningTarget === "soul"
            ? group.type === "prop"
              ? "Soul Prop"
              : "Soul"
            : group.tuningTarget === "yecheng_props"
              ? group.type === "scene_prop_attachment"
                ? "Yecheng Prop Layer"
                : "Yecheng Prop"
              : group.type === "boss"
                ? "Boss"
                : group.type === "vfx"
                  ? "VFX"
                  : "Sprite";
    let typeLabel = group.profileLabel || fallbackTypeLabel;
    if (group.profileLabel && group.type === "vfx") typeLabel = `${group.profileLabel} VFX`;
    if (group.profileLabel && group.type === "prop") typeLabel = `${group.profileLabel} Prop`;
    if (group.profileLabel && group.type === "scene_prop_attachment")
      typeLabel = `${group.profileLabel} Layer`;
    const runtimeLabel = group.skillName && group.runtimeAnimation ? ` (${group.runtimeAnimation})` : "";
    return `${typeLabel} - ${group.name}${runtimeLabel}${groupBindingLabel(group)}`;
  }

  /**
   * Maps values concurrently while preserving input order.
   * @template T,U
   * @param {T[]} inputs Input values.
   * @param {(value:T,index:number)=>Promise<U>} mapper Async mapper.
   * @param {number} [concurrency=6] Maximum active operations.
   * @returns {Promise<U[]>} Ordered results.
   */
  async function mapWithConcurrency(inputs, mapper, concurrency = 6) {
    const values = Array.from(inputs || []);
    const results = new Array(values.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index], index);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => worker()),
    );
    return results;
  }

  /**
   * Clones a two-dimensional vector with numeric normalization.
   * @param {{x?:number,y?:number}|null|undefined} vector Source vector.
   * @returns {{x:number,y:number}} Normalized vector.
   */
  function cloneVector(vector) {
    return { x: Number(vector?.x || 0), y: Number(vector?.y || 0) };
  }

  /**
   * Clones a scale vector, using a uniform fallback when the source is empty.
   * @param {{x?:number,y?:number}|null|undefined} vector Source scale.
   * @param {number} [fallbackScale=1] Uniform fallback.
   * @returns {{x:number,y:number}} Normalized scale.
   */
  function cloneScaleVector(vector, fallbackScale = 1) {
    const fallback = Number(fallbackScale || 1);
    if (!vector || (Number(vector.x || 0) === 0 && Number(vector.y || 0) === 0)) {
      return { x: fallback, y: fallback };
    }
    return { x: Number(vector?.x ?? fallback), y: Number(vector?.y ?? fallback) };
  }

  /**
   * Extracts normalized scale axes from a transform-like object.
   * @param {{scale?:number,scaleX?:number,scaleY?:number}|null|undefined} transform Transform values.
   * @returns {{x:number,y:number}} Scale axes.
   */
  function scaleVectorFromTransform(transform) {
    return {
      x: Number(transform?.scaleX ?? transform?.scale ?? 1),
      y: Number(transform?.scaleY ?? transform?.scale ?? 1),
    };
  }

  /**
   * Formats a number without insignificant trailing zeroes.
   * @param {unknown} value Numeric value.
   * @returns {string} Compact numeric representation.
   */
  function round(value) {
    return Number(value || 0)
      .toFixed(4)
      .replace(/\.?0+$/, "");
  }

  /**
   * Clamps a finite number to an inclusive range.
   * @param {unknown} value Candidate value.
   * @param {number} min Minimum value.
   * @param {number} max Maximum value.
   * @returns {number} Clamped value.
   */
  function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(Math.max(numeric, min), max);
  }

  /**
   * Clamps a rounded finite number to an inclusive integer range.
   * @param {unknown} value Candidate value.
   * @param {number} min Minimum integer.
   * @param {number} max Maximum integer.
   * @returns {number} Clamped integer.
   */
  function clampInteger(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(Math.max(Math.round(numeric), min), max);
  }

  /**
   * Compares numeric values using the editor's tolerance.
   * @param {unknown} left First value.
   * @param {unknown} right Second value.
   * @returns {boolean} Whether the values are effectively equal.
   */
  function nearlyEqual(left, right) {
    return Math.abs(Number(left || 0) - Number(right || 0)) < 0.0001;
  }

  /**
   * Reports whether an event originated from a text-editing target.
   * @param {{target?:Element|null}} event Browser event-like value.
   * @returns {boolean} Whether typing should take precedence.
   */
  function isTypingTarget(event) {
    const target = event?.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
  }

  /**
   * Reports whether an event originated from a numeric input.
   * @param {{target?:Element|null}} event Browser event-like value.
   * @returns {boolean} Whether the target is a number input.
   */
  function isNumberInputTarget(event) {
    const target = event?.target;
    const InputConstructor = root.HTMLInputElement;
    return (
      typeof InputConstructor === "function" && target instanceof InputConstructor && target.type === "number"
    );
  }

  return {
    assetUrl,
    clampInteger,
    clampNumber,
    cloneScaleVector,
    cloneVector,
    escapeHtml,
    groupBindingLabel,
    groupLabel,
    isNumberInputTarget,
    isTypingTarget,
    mapWithConcurrency,
    nearlyEqual,
    projectLabel,
    round,
    scaleVectorFromTransform,
  };
});
