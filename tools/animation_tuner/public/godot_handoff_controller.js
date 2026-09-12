(function attachGodotHandoffController(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameGodotHandoffController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STATES = Object.freeze([
    "local_only",
    "invalid_root",
    "sync_required",
    "sync_failed",
    "synced",
    "gameplay_ready",
  ]);
  const COPY = Object.freeze({
    zh: {
      local_only: "仅本地",
      invalid_root: "根目录无效",
      sync_required: "需要同步",
      sync_failed: "同步失败",
      synced: "已同步",
      gameplay_ready: "Gameplay 就绪",
      localOnlyMessage: "尚未绑定 Godot 工程。",
      hostedMessage: "local_only · 需要本地版",
      bind: "验证并同步",
      rebind: "重绑并同步",
      sync: "同步",
      retry: "重试同步",
      unbind: "解除绑定",
      rootLabel: "Godot 项目根目录",
      rootPlaceholder: "/绝对路径/到/Godot工程",
      binding: "正在验证并同步…",
      syncing: "正在同步…",
      unbinding: "正在解除绑定…",
      confirmRebind: "确认改绑到新工程？旧工程内 x_frame 将保留。",
      confirmUnbind: "确认解除 Godot 绑定？外部文件不会删除。",
      serverText: {
        "Project is not bound to a Godot project.": "尚未绑定 Godot 工程。",
        "Godot project has not been synchronized.": "该工程尚未同步过 Godot 数据。",
        "Local project data changed after the last Godot synchronization.":
          "上次 Godot 同步之后，本地项目数据又发生了变化。",
        "Missing synchronized outputs": "缺少已同步的产物",
        "Godot synchronization is required.": "需要执行 Godot 同步。",
        "Godot synchronization failed.": "Godot 同步失败。",
        "No animation is available for gameplay validation.": "没有可用于 Gameplay 验证的动画。",
        "Godot data is synchronized; gameplay integration still needs attention.":
          "Godot 数据已同步；Gameplay 接入仍有待处理项。",
        "Godot gameplay integration is ready.": "Godot Gameplay 接入已就绪。",
      },
    },
    en: {
      local_only: "Local only",
      invalid_root: "Invalid root",
      sync_required: "Sync required",
      sync_failed: "Sync failed",
      synced: "Synced",
      gameplay_ready: "Gameplay ready",
      localOnlyMessage: "No Godot project is bound.",
      hostedMessage: "local_only · local app required",
      bind: "Validate and sync",
      rebind: "Rebind and sync",
      sync: "Sync",
      retry: "Retry sync",
      unbind: "Unbind",
      rootLabel: "Godot project root",
      rootPlaceholder: "/absolute/path/to/Godot/project",
      binding: "Validating and synchronizing…",
      syncing: "Synchronizing…",
      unbinding: "Unbinding…",
      confirmRebind: "Rebind to the new project? x_frame remains in the old project.",
      confirmUnbind: "Unbind this Godot project? External files will not be deleted.",
      serverText: {},
    },
  });

  /** Normalizes a server-provided handoff state. @param {unknown} value Raw state. */
  function normalizeState(value) {
    return STATES.includes(value) ? value : "local_only";
  }

  /** Parses a structured handoff response. @param {Response} response Fetch response. */
  async function readHandoffResponse(response) {
    const body = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch (_error) {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || body || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.code || "";
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /**
   * Creates Godot handoff UI operations.
   * @param {object} dependencies DOM and application adapters.
   * @returns {{bind:()=>Promise<boolean>,render:()=>void,sync:()=>Promise<boolean>,unbind:()=>Promise<boolean>}}
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getConfig = () => null,
      getLanguage = () => "zh",
      browserOnly = false,
      fetchImpl = root.fetch,
      confirm = () => true,
      reload = async () => {},
      status = () => {},
    } = dependencies;
    if (!elements.card || !elements.rootInput || !elements.bindButton) {
      throw new TypeError("Godot handoff UI elements are required.");
    }
    let busy = false;
    let inlineError = "";

    /** Returns localized copy. */
    function copy() {
      return getLanguage() === "en" ? COPY.en : COPY.zh;
    }

    /** Localizes known server-provided status strings; unknown text passes through. */
    function localizeServerText(value) {
      const text = String(value || "");
      if (!text) return "";
      const table = copy().serverText || {};
      if (table[text]) return table[text];
      for (const [source, localized] of Object.entries(table)) {
        if (text.startsWith(`${source}: `)) return `${localized}: ${text.slice(source.length + 2)}`;
      }
      return text;
    }

    /** Returns current normalized handoff. */
    function handoff() {
      const value = getConfig()?.godotHandoff;
      return value && typeof value === "object"
        ? { ...value, state: normalizeState(value.state) }
        : { state: "local_only", projectRoot: "", blockers: [], warnings: [], lastSync: null };
    }

    /** Renders status, blockers, and available actions. */
    function render() {
      const config = getConfig();
      const value = handoff();
      const text = copy();
      const hasProject = Boolean(config?.activeProject?.id);
      const rootPath = String(value.projectRoot || config?.projectRoot || "");
      elements.card.dataset.state = value.state;
      elements.badge.textContent = browserOnly ? text.hostedMessage : text[value.state];
      elements.badge.dataset.state = value.state;
      elements.rootLabel.textContent = text.rootLabel;
      elements.rootInput.placeholder = text.rootPlaceholder;
      if (root.document?.activeElement !== elements.rootInput) elements.rootInput.value = rootPath;
      elements.rootInput.disabled = busy || browserOnly || !hasProject;
      elements.bindButton.textContent = rootPath ? text.rebind : text.bind;
      elements.syncButton.textContent = value.state === "sync_failed" ? text.retry : text.sync;
      elements.unbindButton.textContent = text.unbind;
      elements.bindButton.disabled = busy || browserOnly || !hasProject;
      elements.syncButton.disabled = busy || browserOnly || !hasProject || !rootPath;
      elements.unbindButton.disabled = busy || browserOnly || !hasProject || !rootPath;
      elements.message.textContent =
        inlineError ||
        (browserOnly
          ? text.hostedMessage
          : value.state === "local_only"
            ? text.localOnlyMessage
            : localizeServerText(value.message || text.localOnlyMessage));
      elements.message.dataset.tone = inlineError ? "error" : value.state;
      elements.blockers.replaceChildren();
      const blockers = Array.isArray(value.blockers) ? value.blockers.filter(Boolean) : [];
      elements.blockers.hidden = blockers.length === 0;
      blockers.forEach((blocker) => {
        const item = root.document.createElement("li");
        item.textContent = localizeServerText(blocker);
        elements.blockers.append(item);
      });
    }

    /** Posts one serialized handoff action. */
    async function execute(action, options = {}) {
      const config = getConfig();
      if (!config?.activeProject?.id || busy || browserOnly) return false;
      if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
      busy = true;
      inlineError = "";
      status(copy()[`${action}ing`] || copy().syncing);
      render();
      try {
        const response = await fetchImpl("/api/projects/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            projectId: config.activeProject.id,
            projectRoot: options.projectRoot,
            confirmRebind: options.confirmRebind === true,
            baseRevision: config.dataRevision || "",
          }),
        });
        await readHandoffResponse(response);
        await reload();
        return true;
      } catch (error) {
        inlineError = error?.message || String(error);
        render();
        return false;
      } finally {
        busy = false;
        render();
        if (inlineError && action === "bind") elements.rootInput.focus?.();
      }
    }

    /** Validates and synchronizes a new or existing root. */
    async function bind() {
      const value = handoff();
      const projectRoot = String(elements.rootInput.value || "").trim();
      const rebind = Boolean(value.projectRoot && projectRoot && value.projectRoot !== projectRoot);
      if (rebind && !(await confirm(copy().confirmRebind, { tone: "warning" }))) return false;
      return execute("bind", { projectRoot, confirmRebind: rebind });
    }

    /** Synchronizes current binding. */
    async function sync() {
      return execute("sync");
    }

    /** Clears registry binding without deleting external files. */
    async function unbind() {
      if (!(await confirm(copy().confirmUnbind, { tone: "warning" }))) return false;
      return execute("unbind");
    }

    elements.bindButton.addEventListener("click", () => void bind());
    elements.syncButton.addEventListener("click", () => void sync());
    elements.unbindButton.addEventListener("click", () => void unbind());
    elements.rootInput.addEventListener("input", () => {
      inlineError = "";
      render();
    });

    return Object.freeze({ bind, render, sync, unbind });
  }

  return Object.freeze({ COPY, STATES, createController, normalizeState, readHandoffResponse });
});
