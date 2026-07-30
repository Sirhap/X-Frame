(function attachBrowserRuntime(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBrowserRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const FRAME_NAME_PADDING = 4;

  /** @param {unknown} value Cloneable value. @returns {any} Independent copy. */
  function cloneValue(value) {
    if (typeof root.structuredClone === "function") return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  /** @param {Iterable<string>} values Feature identifiers. @returns {string[]} Stable unique values. */
  function mergeFeatureIds(values) {
    return [
      ...new Set(
        Array.from(values || [])
          .map(String)
          .filter(Boolean),
      ),
    ];
  }

  /** @param {object} boxes Frame boxes. @returns {object} Horizontally mirrored boxes. */
  function mirrorFrameBoxes(boxes) {
    const result = cloneValue(boxes);
    for (const box of Object.values(result || {})) {
      if (!box || typeof box !== "object") continue;
      if (box.offset && typeof box.offset === "object") box.offset.x = -Number(box.offset.x || 0);
      if (box.rotation !== undefined) box.rotation = -Number(box.rotation || 0);
    }
    return result;
  }

  /**
   * Remaps one animation's indexed records while preserving unrelated groups.
   * @param {object} source Indexed record.
   * @param {string} prefix Animation key prefix.
   * @param {Array<{sourceIndex?:number,flipped?:boolean}>} items New frame plan.
   * @param {boolean} [mirrorBoxes=false] Whether flipped records contain frame boxes.
   * @returns {object} Remapped record.
   */
  function remapIndexedRecord(source, prefix, items, mirrorBoxes = false) {
    const record = source && typeof source === "object" ? source : {};
    const result = Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !key.startsWith(prefix) || key === `${prefix}__group`)
        .map(([key, value]) => [key, cloneValue(value)]),
    );
    items.forEach((item, nextIndex) => {
      if (!Number.isInteger(item.sourceIndex)) return;
      const sourceKey = `${prefix}${item.sourceIndex}`;
      if (!(sourceKey in record)) return;
      result[`${prefix}${nextIndex}`] =
        mirrorBoxes && item.flipped ? mirrorFrameBoxes(record[sourceKey]) : cloneValue(record[sourceKey]);
    });
    return result;
  }

  /** @param {string} value Key ending in a frame number. @param {number} frame Next frame. @returns {string} */
  function rekeyFrameValue(value, frame) {
    const text = String(value || "");
    return /:\d+$/u.test(text) ? text.replace(/:\d+$/u, `:${frame}`) : text;
  }

  /** @param {object} binding Binding record. @returns {{animation:string,frame:number|null}} Ownership. */
  function bindingIdentity(binding) {
    const metadata = binding?.metadata && typeof binding.metadata === "object" ? binding.metadata : {};
    const keyMatch = /^(.*):(\d+)$/u.exec(String(binding?.key || binding?.frameKey || ""));
    const animation = String(metadata.animation || binding?.animation || keyMatch?.[1] || "");
    const frame = Number(metadata.frame ?? binding?.frame ?? keyMatch?.[2]);
    return { animation, frame: Number.isInteger(frame) ? frame : null };
  }

  /**
   * Remaps frame bindings and preserves their original array/object storage shape.
   * @param {object[]|object} source Binding collection.
   * @param {string} animationKey Runtime animation key.
   * @param {Array<{sourceIndex?:number}>} items New frame plan.
   * @returns {object[]|object} Remapped bindings.
   */
  function remapBindings(source, animationKey, items) {
    const sourceIsArray = Array.isArray(source);
    const entries = sourceIsArray
      ? source.map((binding, index) => [String(index), binding])
      : Object.entries(source && typeof source === "object" ? source : {});
    const untouched = [];
    const indexed = new Map();
    for (const [storageKey, rawBinding] of entries) {
      const binding = rawBinding && typeof rawBinding === "object" ? rawBinding : null;
      if (!binding) continue;
      const identity = bindingIdentity(binding);
      if (identity.animation === animationKey && Number.isInteger(identity.frame)) {
        if (!indexed.has(identity.frame)) indexed.set(identity.frame, []);
        indexed.get(identity.frame).push([storageKey, binding]);
      } else {
        untouched.push([storageKey, cloneValue(binding)]);
      }
    }
    const remapped = [];
    items.forEach((item, nextIndex) => {
      if (!Number.isInteger(item.sourceIndex)) return;
      for (const [storageKey, rawBinding] of indexed.get(item.sourceIndex) || []) {
        const binding = cloneValue(rawBinding);
        if (binding.metadata && typeof binding.metadata === "object") {
          binding.metadata.frame = nextIndex;
          binding.metadata.displayFrame = nextIndex;
        }
        if (binding.frame !== undefined) binding.frame = nextIndex;
        if (binding.key) binding.key = rekeyFrameValue(binding.key, nextIndex);
        if (binding.frameKey) binding.frameKey = rekeyFrameValue(binding.frameKey, nextIndex);
        remapped.push([rekeyFrameValue(storageKey, nextIndex), binding]);
      }
    });
    const combined = [...untouched, ...remapped];
    return sourceIsArray ? combined.map(([, binding]) => binding) : Object.fromEntries(combined);
  }

  /**
   * Applies an organizer frame plan to a transient browser animation.
   * @param {object} group Active browser group.
   * @param {Array<{sourceIndex?:number,data?:string,name?:string,flipped?:boolean}>} items Frame plan.
   * @param {{frameVisualOverrides?:object,framePlaybackOverrides?:object,frameBoxOverrides?:object,frameAudioBindings?:object|object[],frameImageAttachments?:object|object[],premiumFeatures?:string[]}} [state] Group-owned state.
   * @returns {{frames:object[],frameVisualOverrides:object,framePlaybackOverrides:object,frameBoxOverrides:object,frameAudioBindings:object|object[],frameImageAttachments:object|object[],premiumFeatures:string[]}} Updated state.
   */
  function reorganizeSessionAnimation(group, items, state = {}) {
    if (!group?.runtimeAnimation || !Array.isArray(group.frames))
      throw new Error("Browser animation is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("An animation must keep at least one frame.");
    const frames = items.map((item, index) => {
      const sourceFrame = Number.isInteger(item.sourceIndex) ? group.frames[item.sourceIndex] : null;
      const data = String(item.data || sourceFrame?.path || "");
      if (!data.startsWith("data:image/png")) throw new Error(`Frame ${index + 1} is missing PNG data.`);
      return {
        ...(sourceFrame || {}),
        id: `frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}`,
        name: String(item.name || sourceFrame?.name || `frame_${index + 1}.png`),
        path: data,
        duration: Number(sourceFrame?.duration || 1),
      };
    });
    const prefix = `${group.runtimeAnimation}:`;
    const result = {
      frames,
      frameVisualOverrides: remapIndexedRecord(state.frameVisualOverrides, prefix, items),
      framePlaybackOverrides: remapIndexedRecord(state.framePlaybackOverrides, prefix, items),
      frameBoxOverrides: remapIndexedRecord(state.frameBoxOverrides, prefix, items, true),
      frameAudioBindings: remapBindings(state.frameAudioBindings || {}, group.runtimeAnimation, items),
      frameImageAttachments: remapBindings(state.frameImageAttachments || [], group.runtimeAnimation, items),
      premiumFeatures: mergeFeatureIds([
        ...Array.from(group.premiumFeatures || []),
        ...Array.from(state.premiumFeatures || []),
      ]),
    };
    group.frames = result.frames;
    group.premiumFeatures = result.premiumFeatures;
    return result;
  }

  /**
   * Replaces the pixels of a transient browser animation without changing its frame ownership.
   * @param {object} group Active browser group.
   * @param {Array<{data?:string,canvas?:HTMLCanvasElement}>} outputs Processed frames.
   * @param {Iterable<string>} [premiumFeatures] Used Pro features.
   * @returns {object[]} Updated frames.
   */
  function replaceSessionAnimationFrames(group, outputs, premiumFeatures = []) {
    if (!group?.frames?.length || !Array.isArray(outputs) || outputs.length !== group.frames.length) {
      throw new Error("Processed frame count does not match the active animation.");
    }
    group.frames = group.frames.map((frame, index) => {
      const output = outputs[index];
      const data = String(output?.data || output?.canvas?.toDataURL?.("image/png") || "");
      if (!data.startsWith("data:image/png")) throw new Error(`Frame ${index + 1} is missing PNG data.`);
      return {
        ...frame,
        path: data,
        width: Number(output?.canvas?.width || frame.width || 0),
        height: Number(output?.canvas?.height || frame.height || 0),
      };
    });
    group.premiumFeatures = mergeFeatureIds([
      ...Array.from(group.premiumFeatures || []),
      ...Array.from(premiumFeatures || []),
    ]);
    return group.frames;
  }

  /** @param {object} record Indexed record. @param {string} prefix Group prefix. @returns {object} */
  function filterIndexedRecord(record, prefix) {
    return Object.fromEntries(
      Object.entries(record && typeof record === "object" ? record : {})
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /** @param {object[]|object} bindings Bindings. @param {string} animationKey Group key. @returns {object[]|object} */
  function filterBindings(bindings, animationKey) {
    if (Array.isArray(bindings)) {
      return bindings
        .filter((binding) => bindingIdentity(binding).animation === animationKey)
        .map(cloneValue);
    }
    return Object.fromEntries(
      Object.entries(bindings && typeof bindings === "object" ? bindings : {})
        .filter(([, binding]) => bindingIdentity(binding).animation === animationKey)
        .map(([key, value]) => [key, cloneValue(value)]),
    );
  }

  /**
   * Builds a tuning snapshot containing only the active browser animation group.
   * @param {object} group Active group.
   * @param {object} state Workbench state stores.
   * @returns {object} Group-scoped export state.
   */
  function createSessionExportSnapshot(group, state = {}) {
    if (!group?.runtimeAnimation) throw new Error("Browser animation is required.");
    const valueKeys = [
      group.characterScale,
      group.characterScaleVector,
      group.characterOffset,
      group.characterRotation,
      group.scale,
      group.scaleVector,
      group.offset,
      group.rotation,
      group.anchor,
    ].filter(Boolean);
    const values = Object.fromEntries(
      valueKeys
        .filter((key) => state.values?.[key] !== undefined)
        .map((key) => [key, cloneValue(state.values[key])]),
    );
    const prefix = `${group.runtimeAnimation}:`;
    return {
      values,
      sceneSettings: {},
      frameAudioBindings: filterBindings(state.frameAudioBindings || {}, group.runtimeAnimation),
      frameImageAttachments: filterBindings(state.frameImageAttachments || [], group.runtimeAnimation),
      frameVisualOverrides: filterIndexedRecord(state.frameVisualOverrides, prefix),
      framePlaybackOverrides: filterIndexedRecord(state.framePlaybackOverrides, prefix),
      frameBoxOverrides: filterIndexedRecord(state.frameBoxOverrides, prefix),
    };
  }

  /**
   * Detects the static browser-only production runtime.
   * @returns {boolean} Whether server-backed project operations must be disabled.
   */
  function isEnabled() {
    return (
      root.__XSXB_PRODUCTION__ === true || root.document?.documentElement?.dataset.runtimeMode === "browser"
    );
  }

  /**
   * Creates a transient project shell for UI components that expect project metadata.
   * @returns {object} Empty browser-session configuration.
   */
  function createEmptyConfig() {
    const activeProject = {
      id: "browser-session",
      label: "浏览器临时工作区",
      projectRoot: "",
    };
    return {
      activeProjectId: activeProject.id,
      activeProject,
      projects: [activeProject],
      profiles: [{ id: "browser-character", label: "新角色", kind: "actor" }],
      groups: [],
      scenes: [],
      tuning: {},
      dataRevision: "browser-session",
    };
  }

  /**
   * Returns a response-like transient configuration without making a network request.
   * @returns {Promise<{ok:boolean,status:number,json:()=>Promise<object>,text:()=>Promise<string>}>} Config response.
   */
  async function fetchConfig() {
    const payload = createEmptyConfig();
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  }

  /**
   * Converts user-entered labels into a safe portable filename component.
   * @param {unknown} value Candidate filename component.
   * @returns {string} Sanitized filename component.
   */
  function safeFilename(value) {
    const normalized = String(value || "animation")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80);
    return normalized || "animation";
  }

  /**
   * Builds an in-memory animation group compatible with the tuning workbench.
   * @param {object} metadata Animation metadata collected by the organizer.
   * @param {Array<object>} items Processed PNG frame records.
   * @param {Array<object>} existingGroups Existing browser-session groups.
   * @param {string} [language="zh"] Active interface language.
   * @returns {object} Transient animation group.
   */
  function createSessionAnimationGroup(metadata, items, existingGroups, language = "zh") {
    if (!Array.isArray(items) || !items.length) {
      throw new Error(language === "zh" ? "至少需要一帧动画。" : "At least one animation frame is required.");
    }
    if (items.some((item) => !String(item?.data || "").startsWith("data:image/png"))) {
      throw new Error(
        language === "zh" ? "动画帧缺少有效的 PNG 数据。" : "An animation frame is missing PNG data.",
      );
    }
    const groups = Array.isArray(existingGroups) ? existingGroups : [];
    const baseId = safeFilename(metadata?.animationName).toLowerCase() || "animation";
    const usedAnimationIds = new Set(groups.map((group) => String(group.animationId || "")));
    let animationId = baseId;
    let suffix = 2;
    while (usedAnimationIds.has(animationId)) {
      animationId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const profileId = String(metadata?.profileId || "browser-character");
    const profileLabel = String(metadata?.profileLabel || (language === "zh" ? "新角色" : "New Character"));
    const keyBase = `profiles.${profileId}.groups.${animationId}`;
    const characterKeyBase = `profiles.${profileId}.character`;
    return {
      uiId: `browser-session:${metadata?.animationType || "actor"}:${animationId}:${groups.length}`,
      name: String(metadata?.animationName || animationId),
      animationId,
      runtimeAnimation: `${profileId}/${animationId}`,
      profileId,
      profileLabel,
      profileKind: String(metadata?.profileKind || "actor"),
      profileScaleSemantic: "character_group_frame",
      profileAnchorMode: String(metadata?.anchorMode || "canvas_bottom_center"),
      profileSupports: [],
      type: String(metadata?.animationType || "actor"),
      tuningTarget: "",
      anchorMode: String(metadata?.anchorMode || "canvas_bottom_center"),
      sourceAnchor: null,
      scaleSemantic: "",
      source: "browser-session",
      premiumFeatures: Array.from(metadata?.premiumFeatures || []),
      speed: Math.max(1, Math.min(120, Number(metadata?.fps || 12))),
      frames: items.map((item, index) => ({
        id: `frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}`,
        name: String(item.name || `frame_${index + 1}.png`),
        path: String(item.data),
        duration: 1,
        width: 0,
        height: 0,
      })),
      characterScale: `${characterKeyBase}.visual_size`,
      characterScaleVector: `${characterKeyBase}.visual_scale`,
      characterOffset: `${characterKeyBase}.offset`,
      characterRotation: `${characterKeyBase}.rotation`,
      characterBaseScale: 1,
      characterBaseScaleVector: null,
      characterBaseOffset: { x: 0, y: 0 },
      characterBaseRotation: 0,
      characterBaseSource: "browser-session",
      runtimeScale: 1,
      bodyScale: 1,
      scale: `${keyBase}.visual_size`,
      scaleVector: `${keyBase}.visual_scale`,
      offset: `${keyBase}.offset`,
      rotation: `${keyBase}.rotation`,
      defaultScale: 1,
      defaultScaleVector: null,
      defaultOffset: { x: 0, y: 0 },
      defaultRotation: 0,
      baseScale: 1,
      baseScaleVector: null,
      baseOffset: { x: 0, y: 0 },
      baseRotation: 0,
    };
  }

  /**
   * Builds a browser-downloadable animation package from processed PNG data URLs.
   * @param {object} metadata Animation metadata collected by the organizer.
   * @param {Array<{name?:string,data:string,flipped?:boolean}>} items Processed frame items.
   * @param {{authorization?:{permit?:string}|null,fetchImpl?:typeof fetch,premiumFeatures?:string[],batchZip?:{buildZip:(entries:Array<object>,options?:object)=>Promise<Blob>},document?:Document,urlApi?:typeof URL,now?:()=>Date,onProgress?:(current:number,total:number)=>void}} [dependencies] Browser adapters.
   * @returns {Promise<{filename:string,frameCount:number,blob:Blob,premiumFeatures:string[]}>} Export result.
   */
  async function exportAnimationPackage(metadata, items, dependencies = {}) {
    if (!metadata || typeof metadata !== "object") throw new TypeError("Animation metadata is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("At least one processed frame is required.");
    const batchZip = dependencies.batchZip || root.BatchZip;
    if (!batchZip || typeof batchZip.buildZip !== "function") throw new Error("ZIP export is unavailable.");
    const premiumFeatureIds = Array.from(dependencies.premiumFeatures || []);
    await verifyPremiumExportAuthorization(
      premiumFeatureIds,
      dependencies.authorization || null,
      dependencies.fetchImpl || root.fetch,
    );

    const frameEntries = items.map((item, index) => {
      if (typeof item?.data !== "string" || !item.data.startsWith("data:image/png")) {
        throw new Error(`Frame ${index + 1} is missing processed PNG data.`);
      }
      const frameName = `frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}.png`;
      return { name: `frames/${frameName}`, data: item.data };
    });
    const manifest = {
      schemaVersion: 1,
      generator: "XSXB Frame Tuner",
      exportedAt: (dependencies.now?.() || new Date()).toISOString(),
      animation: {
        name: metadata.animationName,
        profile: metadata.profileLabel,
        type: metadata.animationType,
        fps: metadata.fps,
        anchorMode: metadata.anchorMode,
        frames: frameEntries.map((entry, index) => ({
          index,
          file: entry.name,
          sourceName: items[index].name || "",
          flipped: items[index].flipped === true,
        })),
      },
      premiumFeatures: premiumFeatureIds,
      godotImport: { enabled: false, status: "placeholder" },
    };
    const entries = [
      ...frameEntries,
      { name: "xsxb-animation.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      {
        name: "README.txt",
        data: "XSXB browser animation package\n\nGodot automatic import is currently disabled. The PNG sequence is available in frames/.\n",
      },
    ];
    const blob = await batchZip.buildZip(entries, {
      onProgress: (current) => dependencies.onProgress?.(current, entries.length),
    });
    const filename = `${safeFilename(metadata.animationName)}-xsxb.zip`;
    const documentApi = dependencies.document || root.document;
    const urlApi = dependencies.urlApi || root.URL;
    if (documentApi && urlApi?.createObjectURL) {
      const objectUrl = urlApi.createObjectURL(blob);
      try {
        const anchor = documentApi.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.hidden = true;
        documentApi.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        root.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 1000);
      }
    }
    return { filename, frameCount: items.length, blob, premiumFeatures: premiumFeatureIds };
  }

  /**
   * Verifies a device-bound Pro export permit immediately before ZIP generation.
   * @param {string[]} featureIds Pro features represented by the package.
   * @param {{permit?:string}|null} authorization Short-lived server authorization.
   * @param {typeof fetch} fetchImpl Fetch implementation.
   * @returns {Promise<void>}
   */
  async function verifyPremiumExportAuthorization(featureIds, authorization, fetchImpl) {
    if (!featureIds.length) return;
    if (!authorization?.permit || typeof fetchImpl !== "function") {
      throw new Error("A verified Pro export permit is required.");
    }
    const response = await fetchImpl("/api/export/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: featureIds, permit: authorization.permit }),
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok || payload.authorized !== true) {
      throw new Error(payload.error || "Pro export authorization failed.");
    }
  }

  /**
   * Exports one tuned browser-session animation with its workbench settings and attached assets.
   * @param {object} metadata Animation metadata.
   * @param {Array<{name?:string,data:string}>} items Animation frames.
   * @param {{tuning?:object,premiumFeatures?:string[],attachmentAssets?:object[]}} workbench Workbench state.
   * @param {{authorization?:{permit?:string}|null,fetchImpl?:typeof fetch,batchZip?:{buildZip:(entries:Array<object>,options?:object)=>Promise<Blob>},document?:Document,urlApi?:typeof URL,now?:()=>Date,onProgress?:(current:number,total:number)=>void}} [dependencies] Browser adapters.
   * @returns {Promise<{filename:string,frameCount:number,blob:Blob,premiumFeatures:string[]}>} Export result.
   */
  async function exportWorkbenchPackage(metadata, items, workbench = {}, dependencies = {}) {
    if (!metadata || typeof metadata !== "object") throw new TypeError("Animation metadata is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("At least one animation frame is required.");
    const batchZip = dependencies.batchZip || root.BatchZip;
    if (!batchZip || typeof batchZip.buildZip !== "function") throw new Error("ZIP export is unavailable.");
    const frameEntries = items.map((item, index) => {
      if (typeof item?.data !== "string" || !item.data.startsWith("data:image/png")) {
        throw new Error(`Frame ${index + 1} is missing PNG data.`);
      }
      return {
        name: `frames/frame_${String(index + 1).padStart(FRAME_NAME_PADDING, "0")}.png`,
        data: item.data,
      };
    });
    const assetEntries = Array.from(workbench.attachmentAssets || []).flatMap((asset, index) => {
      const data = String(asset?.data || asset?.path || "");
      if (!data.startsWith("data:image/")) return [];
      const extension = data.startsWith("data:image/jpeg")
        ? "jpg"
        : data.startsWith("data:image/webp")
          ? "webp"
          : "png";
      return [{ name: `attachments/asset_${String(index + 1).padStart(4, "0")}.${extension}`, data }];
    });
    const premiumFeatureIds = Array.from(workbench.premiumFeatures || []);
    await verifyPremiumExportAuthorization(
      premiumFeatureIds,
      dependencies.authorization || null,
      dependencies.fetchImpl || root.fetch,
    );
    const manifest = {
      schemaVersion: 2,
      generator: "XSXB Frame Tuner",
      exportedAt: (dependencies.now?.() || new Date()).toISOString(),
      animation: {
        id: metadata.animationId || "animation",
        name: metadata.animationName || metadata.name || "animation",
        profile: metadata.profileLabel || "character",
        type: metadata.animationType || metadata.type || "actor",
        fps: Math.max(1, Number(metadata.fps || 12)),
        anchorMode: metadata.anchorMode || "canvas_bottom_center",
        frames: frameEntries.map((entry, index) => ({
          index,
          file: entry.name,
          sourceName: items[index]?.name || "",
        })),
      },
      workbench: {
        tuning: workbench.tuning || {},
        premiumFeatures: premiumFeatureIds,
        attachments: assetEntries.map((entry) => entry.name),
      },
      godotImport: { enabled: false, status: "portable-browser-package" },
    };
    const entries = [
      ...frameEntries,
      ...assetEntries,
      { name: "xsxb-animation.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      {
        name: "README.txt",
        data: "XSXB tuned animation package\n\nFrames, tuning metadata, and session attachment assets are included.\n",
      },
    ];
    const blob = await batchZip.buildZip(entries, {
      onProgress: (current) => dependencies.onProgress?.(current, entries.length),
    });
    const filename = `${safeFilename(metadata.animationName || metadata.name)}-tuned-xsxb.zip`;
    const documentApi = dependencies.document || root.document;
    const urlApi = dependencies.urlApi || root.URL;
    if (documentApi && urlApi?.createObjectURL) {
      const objectUrl = urlApi.createObjectURL(blob);
      try {
        const anchor = documentApi.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.hidden = true;
        documentApi.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        root.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 1000);
      }
    }
    return { filename, frameCount: items.length, blob, premiumFeatures: premiumFeatureIds };
  }

  return {
    createSessionExportSnapshot,
    createEmptyConfig,
    createSessionAnimationGroup,
    exportAnimationPackage,
    exportWorkbenchPackage,
    fetchConfig,
    isEnabled,
    reorganizeSessionAnimation,
    replaceSessionAnimationFrames,
    safeFilename,
  };
});
