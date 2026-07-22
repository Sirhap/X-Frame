(function attachBrowserRuntime(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBrowserRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const FRAME_NAME_PADDING = 4;

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
   * Builds a browser-downloadable animation package from processed PNG data URLs.
   * @param {object} metadata Animation metadata collected by the organizer.
   * @param {Array<{name?:string,data:string,flipped?:boolean}>} items Processed frame items.
   * @param {{batchZip?:{buildZip:(entries:Array<object>,options?:object)=>Promise<Blob>},document?:Document,urlApi?:typeof URL,now?:()=>Date,onProgress?:(current:number,total:number)=>void}} [dependencies] Browser adapters.
   * @returns {Promise<{filename:string,frameCount:number,blob:Blob}>} Export result.
   */
  async function exportAnimationPackage(metadata, items, dependencies = {}) {
    if (!metadata || typeof metadata !== "object") throw new TypeError("Animation metadata is required.");
    if (!Array.isArray(items) || !items.length) throw new Error("At least one processed frame is required.");
    const batchZip = dependencies.batchZip || root.BatchZip;
    if (!batchZip || typeof batchZip.buildZip !== "function") throw new Error("ZIP export is unavailable.");

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
    return { filename, frameCount: items.length, blob };
  }

  return { createEmptyConfig, exportAnimationPackage, fetchConfig, isEnabled, safeFilename };
});
