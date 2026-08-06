(function attachScatterSliceGroupController(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBScatterSliceGroupController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Creates the animation-group renderer and interaction controller.
   * @param {object} dependencies Controller dependencies.
   * @returns {{applyWorkspaceMutation:(label:string,mutate:Function,message:string)=>boolean,render:()=>void}}
   */
  function createController(dependencies) {
    const {
      colors,
      createSliceCanvas,
      deleteSelectedFrames,
      documentApi,
      getGroups,
      getWorkspace,
      history,
      interactionStatus,
      invalidateSliceCache,
      listElement,
      ordinal,
      renderAll,
      rootApi,
      setStatus,
      setToolMode,
      setWorkspace,
      stopGroupPlayback,
      toggleSequencePlayback,
      uniformOutputInput,
      workspaceCore,
    } = dependencies;
    let draggedFrameId = null;
    let draggedGroupId = null;

    /** Announces a keyboard or drag interaction. @param {string} message Message. */
    function announceInteraction(message) {
      interactionStatus.textContent = "";
      rootApi.requestAnimationFrame(() => {
        interactionStatus.textContent = message;
      });
    }

    /**
     * Applies one pure workspace mutation as a single undoable operation.
     * @param {string} label History label.
     * @param {(workspace:object)=>object} mutate Pure mutation.
     * @param {string} message Success message.
     * @returns {boolean} Whether state changed.
     */
    function applyWorkspaceMutation(label, mutate, message) {
      const current = getWorkspace();
      const next = mutate(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      history.pushUndo(label);
      setWorkspace(next);
      uniformOutputInput.checked = next.uniformOutput;
      invalidateSliceCache();
      renderAll();
      setStatus(message, "success");
      announceInteraction(message);
      return true;
    }

    /**
     * Creates a compact group action button.
     * @param {string} text Visible text.
     * @param {string} label Accessible label.
     * @param {()=>void} action Click action.
     * @param {boolean} [disabled] Disabled state.
     * @returns {HTMLButtonElement} Button.
     */
    function groupActionButton(text, label, action, disabled = false) {
      const button = documentApi.createElement("button");
      button.type = "button";
      button.className = "sliceGroupAction";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.disabled = disabled;
      button.addEventListener("click", action);
      return button;
    }

    /** Clears temporary drag styling across re-rendered group cards. @returns {void} */
    function clearDragStyles() {
      documentApi
        .querySelectorAll(
          ".sliceGroup.dragging,.sliceGroup.groupDropTarget,.sliceCardShell.dragging,.sliceCardShell.dropBefore,.sliceCardShell.dropAfter",
        )
        .forEach((node) => node.classList.remove("dragging", "groupDropTarget", "dropBefore", "dropAfter"));
    }

    /** Rebuilds the accessible animation-group and frame list. @returns {void} */
    function render() {
      stopGroupPlayback();
      listElement.replaceChildren();
      const workspace = getWorkspace();
      const groups = getGroups();
      if (workspace.frames.length === 0) {
        const empty = documentApi.createElement("p");
        empty.className = "emptyResults";
        empty.textContent = dependencies.hasSource()
          ? "尚未识别到切片，请调整参数后重试。"
          : "识别结果会显示在这里。";
        listElement.append(empty);
        return;
      }
      const selectedIds = new Set(workspace.selection.ids);
      const visualFrameIds = workspaceCore.orderedFrameIds(workspace);
      groups.forEach((group, groupIndex) => {
        const palette = colors[groupIndex % colors.length];
        const section = documentApi.createElement("section");
        section.className = `sliceGroup${group.enabled ? " included" : ""}`;
        section.dataset.groupId = group.id;
        section.style.setProperty("--group-accent", palette.stroke);
        section.addEventListener("dragover", (event) => {
          if (!draggedGroupId || draggedGroupId === group.id) return;
          event.preventDefault();
          section.classList.add("groupDropTarget");
        });
        section.addEventListener("dragleave", () => section.classList.remove("groupDropTarget"));
        section.addEventListener("drop", (event) => {
          if (!draggedGroupId || draggedGroupId === group.id) return;
          event.preventDefault();
          section.classList.remove("groupDropTarget");
          applyWorkspaceMutation(
            "调整动画组顺序",
            (current) => workspaceCore.moveGroup(current, draggedGroupId, groupIndex),
            `已将动画组移动到第 ${groupIndex + 1} 位。`,
          );
          draggedGroupId = null;
        });

        const header = documentApi.createElement("header");
        header.className = "sliceGroupHeader";
        const dragHandle = documentApi.createElement("button");
        dragHandle.type = "button";
        dragHandle.className = "sliceGroupDrag";
        dragHandle.textContent = "⋮⋮";
        dragHandle.draggable = true;
        dragHandle.setAttribute("aria-label", `拖动${group.name}调整动画组顺序`);
        dragHandle.addEventListener("dragstart", (event) => {
          draggedGroupId = group.id;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", group.id);
          section.classList.add("dragging");
          announceInteraction(`开始拖动${group.name}。`);
        });
        dragHandle.addEventListener("dragend", () => {
          draggedGroupId = null;
          clearDragStyles();
        });

        const exportToggle = documentApi.createElement("input");
        exportToggle.type = "checkbox";
        exportToggle.checked = group.enabled;
        exportToggle.setAttribute("aria-label", `选择动画组 ${groupIndex + 1} 导出`);
        exportToggle.addEventListener("change", () => {
          applyWorkspaceMutation(
            exportToggle.checked ? "选择导出动画组" : "取消导出动画组",
            (current) => workspaceCore.setGroupEnabled(current, group.id, exportToggle.checked),
            `${exportToggle.checked ? "已选择" : "已取消"}${group.name}。`,
          );
        });
        const code = documentApi.createElement("span");
        code.className = "sliceGroupCode";
        code.textContent = `G${ordinal(groupIndex)}`;
        const title = documentApi.createElement("input");
        title.type = "text";
        title.className = "sliceGroupName";
        title.maxLength = 80;
        title.value = group.name;
        title.setAttribute("aria-label", `动画组 ${groupIndex + 1} 名称`);
        const originalName = group.name;
        const commitName = () => {
          const requested = title.value.trim();
          if (!requested) {
            title.value = originalName;
            setStatus("动画组名称不能为空。", "error");
            return;
          }
          applyWorkspaceMutation(
            "重命名动画组",
            (current) => workspaceCore.renameGroup(current, group.id, requested),
            `动画组已重命名为“${requested}”。`,
          );
        };
        title.addEventListener("change", commitName);
        title.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            title.blur();
          } else if (event.key === "Escape") {
            title.value = originalName;
            title.blur();
          }
        });
        const identity = documentApi.createElement("div");
        identity.className = "sliceGroupIdentity";
        identity.append(exportToggle, code, title);

        const top = Math.min(...group.boxes.map((box) => box.y));
        const bottom = Math.max(...group.boxes.map((box) => box.y + box.h));
        const meta = documentApi.createElement("span");
        meta.className = "sliceGroupMeta";
        meta.textContent = `${group.boxes.length} FRAMES · Y ${top}—${bottom}`;
        const groupActions = documentApi.createElement("div");
        groupActions.className = "sliceGroupActions";
        const playbackButton = documentApi.createElement("button");
        playbackButton.type = "button";
        playbackButton.className = "sliceGroupPlay";
        playbackButton.textContent = "播放本组";
        playbackButton.setAttribute("aria-label", `播放动画组 ${groupIndex + 1}`);
        groupActions.append(
          meta,
          playbackButton,
          groupActionButton(
            "↑",
            `上移${group.name}`,
            () =>
              applyWorkspaceMutation(
                "上移动画组",
                (current) => workspaceCore.moveGroup(current, group.id, groupIndex - 1),
                `${group.name}已上移。`,
              ),
            groupIndex === 0,
          ),
          groupActionButton(
            "↓",
            `下移${group.name}`,
            () =>
              applyWorkspaceMutation(
                "下移动画组",
                (current) => workspaceCore.moveGroup(current, group.id, groupIndex + 1),
                `${group.name}已下移。`,
              ),
            groupIndex === groups.length - 1,
          ),
        );
        header.append(dragHandle, identity, groupActions);

        const playbackCanvas = documentApi.createElement("canvas");
        playbackCanvas.className = "sliceGroupPlayback";
        playbackCanvas.setAttribute("aria-label", `动画组 ${groupIndex + 1} 循环预览`);
        playbackCanvas.hidden = true;
        playbackButton.addEventListener("click", () => {
          toggleSequencePlayback(group.boxes, playbackButton, playbackCanvas, `动画组 ${groupIndex + 1}`);
        });

        const grid = documentApi.createElement("div");
        grid.className = "sliceGrid";
        grid.addEventListener("dragover", (event) => {
          if (!draggedFrameId) return;
          event.preventDefault();
          event.stopPropagation();
          grid.classList.add("frameDropTarget");
        });
        grid.addEventListener("dragleave", () => grid.classList.remove("frameDropTarget"));
        grid.addEventListener("drop", (event) => {
          if (!draggedFrameId) return;
          event.preventDefault();
          event.stopPropagation();
          grid.classList.remove("frameDropTarget");
          applyWorkspaceMutation(
            "移动切片帧",
            (current) => workspaceCore.moveSelectedFrames(current, group.id, group.boxes.length),
            `已将所选切片移动到${group.name}末尾。`,
          );
          draggedFrameId = null;
        });
        group.boxes.forEach((box, frameIndex) => {
          const shell = documentApi.createElement("div");
          shell.className = `sliceCardShell${selectedIds.has(box.id) ? " selected" : ""}`;
          shell.dataset.frameId = box.id;
          shell.draggable = true;
          shell.addEventListener("dragstart", (event) => {
            if (!getWorkspace().selection.ids.includes(box.id)) {
              setWorkspace(workspaceCore.selectFrame(getWorkspace(), box.id));
            }
            draggedFrameId = box.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", box.id);
            shell.classList.add("dragging");
            announceInteraction(`开始拖动 ${getWorkspace().selection.ids.length} 个切片。`);
          });
          shell.addEventListener("dragend", () => {
            draggedFrameId = null;
            clearDragStyles();
          });
          shell.addEventListener("dragover", (event) => {
            if (!draggedFrameId || draggedFrameId === box.id) return;
            event.preventDefault();
            event.stopPropagation();
            const bounds = shell.getBoundingClientRect();
            const after = event.clientX >= bounds.left + bounds.width / 2;
            shell.classList.toggle("dropBefore", !after);
            shell.classList.toggle("dropAfter", after);
          });
          shell.addEventListener("dragleave", () => shell.classList.remove("dropBefore", "dropAfter"));
          shell.addEventListener("drop", (event) => {
            if (!draggedFrameId) return;
            event.preventDefault();
            event.stopPropagation();
            const bounds = shell.getBoundingClientRect();
            const after = event.clientX >= bounds.left + bounds.width / 2;
            shell.classList.remove("dropBefore", "dropAfter");
            applyWorkspaceMutation(
              "移动切片帧",
              (current) => workspaceCore.moveSelectedFrames(current, group.id, frameIndex + (after ? 1 : 0)),
              `已移动 ${getWorkspace().selection.ids.length} 个切片。`,
            );
            draggedFrameId = null;
          });

          const button = documentApi.createElement("button");
          button.type = "button";
          button.draggable = true;
          button.className = `sliceCard${selectedIds.has(box.id) ? " selected" : ""}`;
          button.dataset.boxIndex = String(visualFrameIds.indexOf(box.id));
          button.dataset.frameId = box.id;
          button.setAttribute("aria-pressed", selectedIds.has(box.id) ? "true" : "false");
          button.addEventListener("click", (event) => {
            setWorkspace(
              workspaceCore.selectFrame(getWorkspace(), box.id, {
                range: event.shiftKey,
                toggle: event.metaKey || event.ctrlKey,
              }),
            );
            setToolMode("edit");
            renderAll();
          });
          const indexLabel = documentApi.createElement("strong");
          indexLabel.textContent = `G${ordinal(groupIndex)} · F${ordinal(frameIndex)}`;
          const crop = createSliceCanvas(box);
          crop.className = "sliceThumbnail";
          crop.setAttribute("aria-hidden", "true");
          const size = documentApi.createElement("small");
          size.textContent = `${crop.width} × ${crop.height} · ${box.pixels} px`;
          button.append(indexLabel, crop, size);
          const deleteButton = documentApi.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "sliceCardDelete";
          deleteButton.textContent = "删除";
          deleteButton.setAttribute("aria-label", `删除动画组 ${groupIndex + 1} 第 ${frameIndex + 1} 帧`);
          deleteButton.addEventListener("click", () => {
            setWorkspace(workspaceCore.setSelection(getWorkspace(), [box.id], box.id));
            deleteSelectedFrames();
          });
          shell.append(button, deleteButton);
          grid.append(shell);
        });

        const selectedInGroup = group.frameIds.filter((id) => selectedIds.has(id)).length;
        const management = documentApi.createElement("div");
        management.className = "sliceGroupManagement";
        management.append(
          groupActionButton(
            "所选另建组",
            `将所选切片移出${group.name}并新建动画组`,
            () =>
              applyWorkspaceMutation(
                "所选切片另建组",
                workspaceCore.splitSelectedFrames,
                "已将所选切片拆分为新动画组。",
              ),
            selectedInGroup === 0,
          ),
          groupActionButton(
            "并入上组",
            `将${group.name}合并到上一个动画组`,
            () =>
              applyWorkspaceMutation(
                "合并动画组",
                (current) => workspaceCore.mergeGroup(current, group.id, "previous"),
                `${group.name}已并入上一组。`,
              ),
            groupIndex === 0,
          ),
          groupActionButton(
            "并入下组",
            `将${group.name}合并到下一个动画组`,
            () =>
              applyWorkspaceMutation(
                "合并动画组",
                (current) => workspaceCore.mergeGroup(current, group.id, "next"),
                `${group.name}已并入下一组。`,
              ),
            groupIndex === groups.length - 1,
          ),
          groupActionButton("删除组", `删除${group.name}及其全部切片`, () => {
            if (!rootApi.confirm(`删除“${group.name}”及其中 ${group.boxes.length} 个切片？`)) return;
            applyWorkspaceMutation(
              "删除动画组",
              (current) => workspaceCore.deleteGroup(current, group.id),
              `${group.name}及其切片已删除。`,
            );
          }),
        );
        section.append(header, playbackCanvas, grid, management);
        listElement.append(section);
      });
    }

    return Object.freeze({ applyWorkspaceMutation, render });
  }

  return Object.freeze({ createController });
});
