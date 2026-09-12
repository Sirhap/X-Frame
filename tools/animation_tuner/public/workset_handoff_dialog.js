(function attachXFrameWorksetHandoffDialog(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameWorksetHandoffDialog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** Creates one option element. */
  function option(documentRef, value, label) {
    const node = documentRef.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  const HANDOFF_DEFAULTS = Object.freeze({
    handoffSubmit: "检查并加入项目",
    handoffConfirmImpact: "确认影响并加入项目",
    handoffCancel: "取消",
    handoffContinue: "继续处理",
    handoffCreateGroup: "新建动画组",
    handoffReplaceGroup: "替换已有动画",
    handoffWriteMode: "写入方式",
    handoffCharacter: "角色",
    handoffAnimation: "动画",
    handoffExisting: "已有动画",
    handoffChooseExisting: "选择已有动画…",
    handoffCharacterPlaceholder: "角色名称",
    handoffAnimationPlaceholder: "动画名称",
    handoffNewLocalProject: "＋ 新建本地项目",
    handoffWorksetFrames: "{label} · {count} 帧",
    handoffOpenAnimation: "打开动画 →",
    handoffChecking: "正在检查目标与绑定影响…",
    handoffConfirmStatus: "请检查替换影响；再次确认后才会写入项目。",
    handoffWriting: "正在原子写入动画项目…",
    handoffConflict: "目标存在冲突，请检查名称和写入方式。",
    handoffFailed: "加入动画项目失败。",
  });

  /**
   * Creates the shared quick-tool to project handoff dialog.
   * @param {{documentRef?:Document,windowRef?:Window,getConfig:()=>object|null,loadProjectConfig:(projectId:string)=>Promise<object>,createProject:(label:string)=>Promise<{projectId:string,config:object}>,discardProject?:(projectId:string,context:object)=>Promise<void>,plan:(payload:object)=>Promise<object>,apply:(payload:object)=>Promise<object>,onApplied?:(result:object,context:{projectId:string,operations:object[]})=>Promise<void>|void,projectLabel?:(project:object)=>string}} dependencies Dialog dependencies.
   * @returns {{bind:()=>void,open:(request:{worksets:object[],sourceTool?:string})=>Promise<void>,close:()=>void,isOpen:()=>boolean}} Dialog operations.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const projectLabel =
      dependencies.projectLabel || ((project) => project?.label || project?.name || project?.id || "");
    for (const name of ["getConfig", "loadProjectConfig", "createProject", "plan", "apply"]) {
      if (typeof dependencies[name] !== "function") throw new TypeError(`Workset handoff requires ${name}.`);
    }
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("Workset handoff requires a document implementation.");
    }

    const elements = {
      dialog: documentRef.querySelector("#worksetHandoffDialog"),
      close: documentRef.querySelector("#worksetHandoffClose"),
      form: documentRef.querySelector("#worksetHandoffForm"),
      project: documentRef.querySelector("#worksetHandoffProject"),
      newProjectField: documentRef.querySelector("#worksetHandoffNewProjectField"),
      newProject: documentRef.querySelector("#worksetHandoffNewProject"),
      rows: documentRef.querySelector("#worksetHandoffRows"),
      impact: documentRef.querySelector("#worksetHandoffImpact"),
      status: documentRef.querySelector("#worksetHandoffStatus"),
      success: documentRef.querySelector("#worksetHandoffSuccess"),
      targets: documentRef.querySelector("#worksetHandoffTargets"),
      cancel: documentRef.querySelector("#worksetHandoffCancel"),
      submit: documentRef.querySelector("#worksetHandoffSubmit"),
    };
    if (!elements.dialog || !elements.rows || !elements.project || !elements.submit) {
      throw new Error("Workset handoff dialog markup is incomplete.");
    }

    const rowControls = new Map();
    let worksets = [];
    let projectConfig = null;
    let pendingPlan = null;
    let pendingSignature = "";
    let busy = false;
    let createdProject = null;
    let projectSelectionReady = false;
    let originalProjectId = "";
    let bound = false;
    let returnFocus = null;
    let inertedSurfaces = [];

    /**
     * Resolves dialog copy from the host translator, falling back to Chinese.
     * @param {string} key Message key.
     * @param {Record<string,unknown>} [vars] Interpolation values.
     * @returns {string} Localized copy.
     */
    function text(key, vars = {}) {
      const translated = dependencies.translate?.(key, vars);
      const fallback = HANDOFF_DEFAULTS[key] || key;
      const template = translated && translated !== key ? translated : fallback;
      return String(template).replace(/\{(\w+)\}/g, (_match, name) =>
        vars[name] == null ? `{${name}}` : String(vars[name]),
      );
    }

    /** Updates the live status region. */
    function setStatus(message, tone = "") {
      if (!elements.status) return;
      elements.status.textContent = message;
      if (tone) elements.status.dataset.tone = tone;
      else delete elements.status.dataset.tone;
    }

    /** Clears a previous replacement confirmation whenever target inputs change. */
    function clearPendingPlan() {
      pendingPlan = null;
      pendingSignature = "";
      if (elements.impact) elements.impact.hidden = true;
      elements.submit.textContent = text("handoffSubmit");
    }

    /** Applies a consistent busy state to all mutation controls. */
    function setBusy(nextBusy) {
      busy = Boolean(nextBusy);
      elements.submit.disabled = busy;
      if (elements.cancel) elements.cancel.disabled = busy;
      if (elements.close) elements.close.disabled = busy;
      elements.dialog.setAttribute("aria-busy", String(busy));
    }

    /** Returns groups owned by the currently loaded target project. */
    function targetGroups() {
      return Array.from(projectConfig?.groups || []).filter(
        (group) => group?.profileId && group?.animationId,
      );
    }

    /** Synchronizes one row's create or replace inputs. */
    function syncRowMode(controls) {
      const replacing = controls.type.value === "replace";
      controls.profileField.hidden = replacing;
      controls.animationField.hidden = replacing;
      controls.targetField.hidden = !replacing;
      controls.targetSelect.required = replacing;
    }

    /** Creates a labeled field wrapper. */
    function field(labelText, control) {
      const label = documentRef.createElement("label");
      const span = documentRef.createElement("span");
      span.textContent = labelText;
      label.append(span, control);
      return label;
    }

    /** Creates and registers one workset target row. */
    function createRow(workset, index) {
      const row = documentRef.createElement("section");
      row.className = "worksetHandoffRow";
      const header = documentRef.createElement("header");
      const eyebrow = documentRef.createElement("span");
      eyebrow.textContent = `WORKSET ${String(index + 1).padStart(2, "0")}`;
      const title = documentRef.createElement("strong");
      title.textContent = text("handoffWorksetFrames", {
        label: workset.label || workset.name || `动画 ${index + 1}`,
        count: workset.items.length,
      });
      header.append(eyebrow, title);

      const type = documentRef.createElement("select");
      type.append(
        option(documentRef, "create", text("handoffCreateGroup")),
        option(documentRef, "replace", text("handoffReplaceGroup")),
      );
      type.value = workset.defaultType === "replace" ? "replace" : "create";
      const profileInput = documentRef.createElement("input");
      profileInput.type = "text";
      profileInput.maxLength = 80;
      profileInput.value = workset.profileLabel || "character";
      profileInput.placeholder = text("handoffCharacterPlaceholder");
      const animationInput = documentRef.createElement("input");
      animationInput.type = "text";
      animationInput.maxLength = 80;
      animationInput.value = workset.animationName || workset.name || `animation-${index + 1}`;
      animationInput.placeholder = text("handoffAnimationPlaceholder");
      const targetSelect = documentRef.createElement("select");
      targetSelect.append(option(documentRef, "", text("handoffChooseExisting")));
      for (const group of targetGroups()) {
        targetSelect.append(
          option(
            documentRef,
            `${group.profileId}/${group.animationId}`,
            `${group.profileLabel || group.profileId} / ${group.name || group.animationId}`,
          ),
        );
      }
      if (workset.targetProfileId && workset.targetAnimationId) {
        targetSelect.value = `${workset.targetProfileId}/${workset.targetAnimationId}`;
      }
      const typeField = field(text("handoffWriteMode"), type);
      const profileField = field(text("handoffCharacter"), profileInput);
      const animationField = field(text("handoffAnimation"), animationInput);
      const targetField = field(text("handoffExisting"), targetSelect);
      const controls = {
        type,
        typeField,
        profileInput,
        profileField,
        animationInput,
        animationField,
        targetSelect,
        targetField,
        workset,
      };
      rowControls.set(workset.id, controls);
      type.addEventListener("change", () => {
        syncRowMode(controls);
        clearPendingPlan();
      });
      for (const control of [profileInput, animationInput, targetSelect]) {
        control.addEventListener("input", clearPendingPlan);
        control.addEventListener("change", clearPendingPlan);
      }
      syncRowMode(controls);
      row.append(header, typeField, profileField, animationField, targetField);
      return row;
    }

    /** Rebuilds target rows after loading another project. */
    function renderRows() {
      rowControls.clear();
      elements.rows.replaceChildren(...worksets.map(createRow));
      clearPendingPlan();
    }

    /** Populates the project selector from the current application registry. */
    function renderProjects(config) {
      const projects = Array.from(config?.projects || []);
      elements.project.replaceChildren(
        ...projects.map((project) => option(documentRef, project.id, projectLabel(project) || project.id)),
        option(documentRef, "__new__", text("handoffNewLocalProject")),
      );
      const activeProjectId =
        config?.activeProjectId || config?.activeProject?.id || projects[0]?.id || "__new__";
      elements.project.value = projects.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : "__new__";
      if (elements.newProjectField) elements.newProjectField.hidden = elements.project.value !== "__new__";
    }

    /** Removes an unused transient project before the user targets another project. */
    async function discardAbandonedCreatedProject(nextProjectId) {
      if (!createdProject || createdProject.id === nextProjectId) return;
      if (typeof dependencies.discardProject !== "function") {
        throw new Error("无法清理未使用的新项目，请关闭对话框后重试。");
      }
      const abandonedProject = createdProject;
      await dependencies.discardProject(abandonedProject.id, {
        baseRevision: abandonedProject.baseRevision,
        restoreProjectId: nextProjectId === "__new__" ? originalProjectId : nextProjectId,
      });
      createdProject = null;
    }

    /** Loads project groups needed by replacement selectors. */
    async function loadSelectedProject() {
      clearPendingPlan();
      const selectedProjectId = elements.project.value;
      projectSelectionReady = false;
      if (elements.newProjectField) elements.newProjectField.hidden = selectedProjectId !== "__new__";
      setBusy(true);
      setStatus("正在读取目标项目…");
      try {
        await discardAbandonedCreatedProject(selectedProjectId);
        if (selectedProjectId === "__new__") {
          projectConfig = { groups: [], profiles: [] };
          projectSelectionReady = true;
          renderRows();
          setStatus("");
          return;
        }
        projectConfig = await dependencies.loadProjectConfig(selectedProjectId);
        projectSelectionReady = true;
        renderRows();
        setStatus("");
      } catch (error) {
        if (createdProject && createdProject.id !== selectedProjectId) {
          elements.project.value = createdProject.id;
          if (elements.newProjectField) elements.newProjectField.hidden = true;
          projectSelectionReady = true;
          renderRows();
        }
        setStatus(error?.message || "目标项目读取失败。", "error");
      } finally {
        setBusy(false);
      }
    }

    /** Ensures the selected project exists and returns its stable identifier. */
    async function ensureProject() {
      if (elements.project.value !== "__new__") {
        if (!projectSelectionReady) throw new Error("目标项目尚未加载完成，请重新选择后再试。");
        return elements.project.value;
      }
      const label = String(elements.newProject?.value || "").trim();
      if (!label) throw new Error("请填写新项目名称。");
      const created = await dependencies.createProject(label);
      if (!created?.projectId) throw new Error("新项目创建后没有返回项目标识。");
      projectConfig = created.config || { groups: [], profiles: [] };
      createdProject = {
        id: created.projectId,
        baseRevision: projectConfig.dataRevision || "",
      };
      elements.project.append(option(documentRef, created.projectId, label));
      elements.project.value = created.projectId;
      projectSelectionReady = true;
      if (elements.newProjectField) elements.newProjectField.hidden = true;
      return created.projectId;
    }

    /** Collects ordered operations from visible row controls. */
    function collectOperations(includeData) {
      return worksets.map((workset) => {
        const controls = rowControls.get(workset.id);
        if (!controls) throw new Error(`工作集目标不可用：${workset.label || workset.id}`);
        let profileId = "";
        let profileLabel = "";
        let animationId = "";
        let animationName = "";
        if (controls.type.value === "replace") {
          const targetKey = controls.targetSelect.value;
          const group = targetGroups().find(
            (entry) => `${entry.profileId}/${entry.animationId}` === targetKey,
          );
          if (!group) throw new Error(`请选择“${workset.label || workset.id}”要替换的已有动画。`);
          profileId = group.profileId;
          profileLabel = group.profileLabel || group.profileId;
          animationId = group.animationId;
          animationName = group.name || group.animationId;
        } else {
          profileLabel = controls.profileInput.value.trim();
          animationName = controls.animationInput.value.trim();
        }
        return {
          id: workset.id,
          type: controls.type.value,
          profileId,
          profileLabel,
          animationId,
          animationName,
          animationType: workset.animationType || "actor",
          profileKind: workset.profileKind || "actor",
          anchorMode: workset.anchorMode || "canvas_bottom_center",
          fps: Number(workset.fps || 12),
          premiumFeatures: Array.from(workset.premiumFeatures || []),
          items: workset.items.map((item) => ({
            sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : null,
            name: item.name || "",
            flipped: item.flipped === true,
            ...(includeData ? { data: item.data } : {}),
          })),
        };
      });
    }

    /** Creates a stable signature for confirmation invalidation. */
    function operationSignature(projectId, operations) {
      return JSON.stringify({
        projectId,
        operations: operations.map((operation) => ({
          id: operation.id,
          type: operation.type,
          profileId: operation.profileId,
          profileLabel: operation.profileLabel,
          animationId: operation.animationId,
          animationName: operation.animationName,
          items: operation.items.map((item) => item.sourceIndex),
        })),
      });
    }

    /** Renders replacement impact before destructive confirmation. */
    function renderImpact(impacts) {
      if (!elements.impact) return;
      const title = documentRef.createElement("strong");
      title.textContent = "替换影响确认";
      const list = documentRef.createElement("ul");
      for (const impact of impacts) {
        const item = documentRef.createElement("li");
        const removed = [
          impact.visual,
          impact.playback,
          impact.boxes,
          impact.audio,
          impact.attachments,
          impact.attackTrails,
        ].reduce((count, entry) => count + Number(entry?.removed || 0), 0);
        item.textContent = `${impact.profileId}/${impact.animationId}：${impact.frames.before} → ${impact.frames.after} 帧；保留可映射绑定，移除 ${removed} 项无法映射的数据。`;
        list.append(item);
      }
      elements.impact.replaceChildren(title, list);
      elements.impact.hidden = false;
    }

    /** Renders successful targets while keeping the quick-tool session alive. */
    function renderSuccess(projectId, result) {
      if (!elements.success || !elements.targets) return;
      const links = Array.from(result?.results || []).map((target) => {
        const link = documentRef.createElement("a");
        link.className = "worksetHandoffTarget";
        const url = new URL("/workspace", windowRef.location?.origin || "http://localhost");
        url.searchParams.set("project", projectId);
        url.searchParams.set("animation", `${target.profileId}/${target.animationId}`);
        link.href = `${url.pathname}${url.search}`;
        link.textContent = `${target.profileId}/${target.animationId}`;
        const action = documentRef.createElement("strong");
        action.textContent = text("handoffOpenAnimation");
        link.append(action);
        return link;
      });
      elements.targets.replaceChildren(...links);
      elements.form.hidden = true;
      elements.success.hidden = false;
      elements.submit.hidden = true;
      if (elements.cancel) elements.cancel.textContent = text("handoffContinue");
    }

    /** Plans, confirms, and atomically applies the current target selection. */
    async function submit() {
      if (busy) return;
      setBusy(true);
      setStatus(text("handoffChecking"));
      let applyStarted = false;
      try {
        const projectId = await ensureProject();
        const summaryOperations = collectOperations(false);
        const signature = operationSignature(projectId, summaryOperations);
        let plan = pendingPlan;
        if (!plan || signature !== pendingSignature) {
          plan = await dependencies.plan({ projectId, operations: summaryOperations });
          if (!plan?.ok) {
            const message = Array.from(plan?.conflicts || [], (conflict) => conflict.message).join("\n");
            throw new Error(message || text("handoffConflict"));
          }
          if (Array.isArray(plan.impacts) && plan.impacts.length) {
            pendingPlan = plan;
            pendingSignature = signature;
            renderImpact(plan.impacts);
            elements.submit.textContent = text("handoffConfirmImpact");
            setStatus(text("handoffConfirmStatus"));
            return;
          }
        }
        setStatus(text("handoffWriting"));
        const appliedOperations = collectOperations(true);
        applyStarted = true;
        const result = await dependencies.apply({
          projectId,
          baseRevision: plan.baseRevision,
          operations: appliedOperations,
        });
        createdProject = null;
        renderSuccess(projectId, result);
        try {
          await dependencies.onApplied?.(result, { projectId, operations: appliedOperations });
          setStatus("");
        } catch (refreshError) {
          setStatus(
            `动画已加入项目，但工作台刷新失败：${refreshError?.message || "请手动刷新后打开动画。"}`,
            "error",
          );
        }
      } catch (error) {
        if (applyStarted && createdProject && typeof dependencies.discardProject === "function") {
          const failedProject = createdProject;
          createdProject = null;
          await dependencies
            .discardProject(failedProject.id, {
              baseRevision: failedProject.baseRevision,
              restoreProjectId: originalProjectId,
            })
            .catch(() => {});
        }
        setStatus(error?.message || text("handoffFailed"), "error");
      } finally {
        setBusy(false);
      }
    }

    /** Opens the dialog for one or more ordered worksets. */
    async function open(request) {
      if (!Array.isArray(request?.worksets) || !request.worksets.length) {
        throw new Error("至少需要一个可加入项目的工作集。");
      }
      returnFocus = documentRef.activeElement;
      const config = dependencies.getConfig() || {};
      originalProjectId = String(config.activeProjectId || config.activeProject?.id || "");
      createdProject = null;
      projectSelectionReady = false;
      worksets = request.worksets.map((workset, index) => ({
        ...workset,
        id: String(workset.id || `workset-${index + 1}`),
        items: Array.from(workset.items || []),
      }));
      if (worksets.some((workset) => !workset.items.length)) throw new Error("工作集不能包含空动画。");
      pendingPlan = null;
      pendingSignature = "";
      elements.form.hidden = false;
      if (elements.success) elements.success.hidden = true;
      elements.submit.hidden = false;
      elements.submit.textContent = text("handoffSubmit");
      if (elements.cancel) elements.cancel.textContent = text("handoffCancel");
      if (elements.impact) elements.impact.hidden = true;
      setStatus("");
      renderProjects(config);
      inertedSurfaces = Array.from(
        documentRef.querySelectorAll?.(".organizerModal, .cutoutModal, .scatterSliceSurface") || [],
      ).filter((surface) => !surface.inert && !surface.hidden);
      inertedSurfaces.forEach((surface) => {
        surface.inert = true;
      });
      elements.dialog.hidden = false;
      await loadSelectedProject();
      elements.project.focus();
    }

    /** Closes the dialog without discarding the source quick-tool session. */
    function close() {
      if (busy) return;
      elements.dialog.hidden = true;
      inertedSurfaces.forEach((surface) => {
        surface.inert = false;
      });
      inertedSurfaces = [];
      returnFocus?.focus?.();
      returnFocus = null;
      if (createdProject && typeof dependencies.discardProject === "function") {
        const abandonedProject = createdProject;
        createdProject = null;
        void dependencies
          .discardProject(abandonedProject.id, {
            baseRevision: abandonedProject.baseRevision,
            restoreProjectId: originalProjectId,
          })
          .catch(() => {});
      }
    }

    /** Binds dialog events once. */
    function bind() {
      if (bound) return;
      bound = true;
      elements.project.addEventListener("change", () => void loadSelectedProject());
      elements.submit.addEventListener("click", () => void submit());
      elements.cancel?.addEventListener("click", close);
      elements.close?.addEventListener("click", close);
      elements.dialog.addEventListener("pointerdown", (event) => {
        if (event.target === elements.dialog) close();
      });
      elements.dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          elements.dialog.querySelectorAll?.(
            "button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), a[href]",
          ) || [],
        ).filter((element) => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && documentRef.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && documentRef.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    return { bind, open, close, isOpen: () => !elements.dialog.hidden };
  }

  return Object.freeze({ createController });
});
