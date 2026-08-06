(function attachScatterSliceWorkspaceCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBScatterSliceWorkspaceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /** @typedef {{id:string,x:number,y:number,w:number,h:number,pixels:number}} SliceFrame */
  /** @typedef {{id:string,name:string,frameIds:string[],enabled:boolean}} SliceGroup */

  /**
   * Deep-clones one serializable workspace value.
   * @param {object} workspace Source workspace.
   * @returns {object} Detached workspace copy.
   */
  function cloneWorkspace(workspace) {
    return {
      frames: workspace.frames.map((frame) => ({ ...frame })),
      groups: workspace.groups.map((group) => ({ ...group, frameIds: [...group.frameIds] })),
      selection: {
        ids: [...workspace.selection.ids],
        primaryId: workspace.selection.primaryId,
        anchorId: workspace.selection.anchorId,
      },
      uniformOutput: workspace.uniformOutput !== false,
      nextFrameNumber: workspace.nextFrameNumber,
      nextGroupNumber: workspace.nextGroupNumber,
    };
  }

  /**
   * Validates a positive source boundary.
   * @param {{width:number,height:number}} bounds Candidate bounds.
   * @returns {{width:number,height:number}} Safe integer bounds.
   */
  function normalizeBounds(bounds) {
    const width = Math.floor(Number(bounds?.width));
    const height = Math.floor(Number(bounds?.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new RangeError("bounds 必须包含正整数 width 和 height");
    }
    return { width, height };
  }

  /**
   * Normalizes one detected frame while retaining its stable identity.
   * @param {object} box Candidate frame box.
   * @param {string} id Stable frame ID.
   * @returns {SliceFrame} Safe frame.
   */
  function normalizeFrame(box, id) {
    const x = Math.max(0, Math.round(Number(box?.x) || 0));
    const y = Math.max(0, Math.round(Number(box?.y) || 0));
    const w = Math.max(1, Math.round(Number(box?.w) || 1));
    const h = Math.max(1, Math.round(Number(box?.h) || 1));
    const pixels = Math.max(1, Math.round(Number(box?.pixels) || w * h));
    return { id, x, y, w, h, pixels };
  }

  /**
   * Returns frame IDs in current group and frame order.
   * @param {object} workspace Workspace.
   * @returns {string[]} Visual frame IDs.
   */
  function orderedFrameIds(workspace) {
    return workspace.groups.flatMap((group) => group.frameIds);
  }

  /**
   * Returns the group containing one frame.
   * @param {object} workspace Workspace.
   * @param {string} frameId Stable frame ID.
   * @returns {SliceGroup|null} Matching group.
   */
  function groupForFrame(workspace, frameId) {
    return workspace.groups.find((group) => group.frameIds.includes(frameId)) || null;
  }

  /**
   * Orders a candidate ID list by current visual order and removes duplicates.
   * @param {object} workspace Workspace.
   * @param {string[]} ids Candidate IDs.
   * @returns {string[]} Valid ordered IDs.
   */
  function orderIds(workspace, ids) {
    const requested = new Set(ids);
    return orderedFrameIds(workspace).filter((id) => requested.has(id));
  }

  /**
   * Repairs selection after structural changes.
   * @param {object} workspace Mutable cloned workspace.
   * @returns {object} Repaired workspace.
   */
  function repairSelection(workspace) {
    const valid = new Set(workspace.frames.map((frame) => frame.id));
    workspace.selection.ids = orderIds(
      workspace,
      workspace.selection.ids.filter((id) => valid.has(id)),
    );
    if (!valid.has(workspace.selection.primaryId)) {
      workspace.selection.primaryId = workspace.selection.ids.at(-1) || null;
    }
    if (!valid.has(workspace.selection.anchorId)) {
      workspace.selection.anchorId = workspace.selection.primaryId;
    }
    return workspace;
  }

  /**
   * Removes empty groups and duplicate or missing group references.
   * @param {object} workspace Mutable cloned workspace.
   * @returns {object} Clean workspace.
   */
  function cleanGroups(workspace) {
    const valid = new Set(workspace.frames.map((frame) => frame.id));
    const claimed = new Set();
    workspace.groups = workspace.groups
      .map((group) => ({
        ...group,
        frameIds: group.frameIds.filter((id) => {
          if (!valid.has(id) || claimed.has(id)) return false;
          claimed.add(id);
          return true;
        }),
      }))
      .filter((group) => group.frameIds.length > 0);
    workspace.frames = workspace.frames.filter((frame) => claimed.has(frame.id));
    return repairSelection(workspace);
  }

  /**
   * Creates a stable editable workspace from detector output and visual rows.
   * @param {object[]} boxes Detector boxes.
   * @param {Array<{boxes:object[]}>} rows Visual rows using the same box objects.
   * @param {{uniformOutput?:boolean}} [options] Workspace defaults.
   * @returns {object} New workspace.
   */
  function createDetectedWorkspace(boxes, rows, options = {}) {
    if (!Array.isArray(boxes) || !Array.isArray(rows)) throw new TypeError("boxes 和 rows 必须是数组");
    const frames = boxes.map((box, index) => normalizeFrame(box, `frame-${index + 1}`));
    const frameIdByBox = new Map(boxes.map((box, index) => [box, frames[index].id]));
    const groups = rows
      .map((row, index) => ({
        id: `group-${index + 1}`,
        name: `动画组 ${String(index + 1).padStart(2, "0")}`,
        frameIds: (row.boxes || []).map((box) => frameIdByBox.get(box)).filter(Boolean),
        enabled: true,
      }))
      .filter((group) => group.frameIds.length > 0);
    const workspace = {
      frames,
      groups,
      selection: { ids: [], primaryId: null, anchorId: null },
      uniformOutput: options.uniformOutput !== false,
      nextFrameNumber: frames.length + 1,
      nextGroupNumber: groups.length + 1,
    };
    return cleanGroups(workspace);
  }

  /**
   * Replaces visual rows while retaining frame IDs and the best matching group identities.
   * @param {object} workspace Workspace.
   * @param {Array<{frameIds:string[]}>} rows Requested visual rows.
   * @returns {object} Regrouped workspace.
   */
  function regroupWorkspace(workspace, rows) {
    if (!Array.isArray(rows)) throw new TypeError("rows 必须是数组");
    const next = cloneWorkspace(workspace);
    const validIds = new Set(next.frames.map((frame) => frame.id));
    const claimed = new Set();
    const normalizedRows = rows
      .map((row) => ({
        frameIds: Array.isArray(row?.frameIds)
          ? row.frameIds.filter((id) => validIds.has(id) && !claimed.has(id) && claimed.add(id))
          : [],
      }))
      .filter((row) => row.frameIds.length > 0);
    if (claimed.size !== validIds.size) throw new RangeError("重新分组必须包含全部切片帧且不能重复");
    const available = new Set(next.groups.map((group) => group.id));
    next.groups = normalizedRows.map((row) => {
      const match = workspace.groups
        .filter((group) => available.has(group.id))
        .map((group) => ({
          group,
          overlap: group.frameIds.filter((id) => row.frameIds.includes(id)).length,
        }))
        .sort((first, second) => second.overlap - first.overlap)[0];
      if (match?.overlap > 0) {
        available.delete(match.group.id);
        return { ...match.group, frameIds: row.frameIds };
      }
      const number = next.nextGroupNumber;
      next.nextGroupNumber += 1;
      return {
        id: `group-${number}`,
        name: `动画组 ${String(number).padStart(2, "0")}`,
        frameIds: row.frameIds,
        enabled: true,
      };
    });
    return repairSelection(next);
  }

  /**
   * Captures an isolated serializable workspace snapshot.
   * @param {object} workspace Workspace.
   * @returns {object} Snapshot.
   */
  function snapshotWorkspace(workspace) {
    return cloneWorkspace(workspace);
  }

  /**
   * Restores and validates a serialized workspace snapshot.
   * @param {object} snapshot Serialized snapshot.
   * @returns {object} Restored workspace.
   */
  function restoreWorkspace(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.frames) || !Array.isArray(snapshot.groups)) {
      throw new TypeError("workspace snapshot 无效");
    }
    const frames = snapshot.frames.map((frame) => normalizeFrame(frame, String(frame.id || "")));
    const frameIds = new Set(frames.map((frame) => frame.id));
    if (frameIds.has("") || frameIds.size !== frames.length) throw new RangeError("frame id 必须唯一且非空");
    const groupIds = new Set();
    const groups = snapshot.groups.map((group) => {
      const id = String(group.id || "");
      if (!id || groupIds.has(id)) throw new RangeError("group id 必须唯一且非空");
      groupIds.add(id);
      return {
        id,
        name: String(group.name || "未命名动画组").trim() || "未命名动画组",
        frameIds: Array.isArray(group.frameIds) ? group.frameIds.map(String) : [],
        enabled: group.enabled !== false,
      };
    });
    return cleanGroups({
      frames,
      groups,
      selection: {
        ids: Array.isArray(snapshot.selection?.ids) ? snapshot.selection.ids.map(String) : [],
        primaryId: snapshot.selection?.primaryId || null,
        anchorId: snapshot.selection?.anchorId || null,
      },
      uniformOutput: snapshot.uniformOutput !== false,
      nextFrameNumber: Math.max(frames.length + 1, Math.floor(Number(snapshot.nextFrameNumber) || 1)),
      nextGroupNumber: Math.max(groups.length + 1, Math.floor(Number(snapshot.nextGroupNumber) || 1)),
    });
  }

  /**
   * Replaces one frame geometry without changing group membership.
   * @param {object} workspace Workspace.
   * @param {string} frameId Stable frame ID.
   * @param {object} box Replacement geometry.
   * @returns {object} Updated workspace.
   */
  function updateFrameBox(workspace, frameId, box) {
    const next = cloneWorkspace(workspace);
    const index = next.frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) throw new RangeError("找不到切片帧");
    next.frames[index] = normalizeFrame(box, frameId);
    return next;
  }

  /**
   * Selects, toggles, or range-selects a frame.
   * @param {object} workspace Workspace.
   * @param {string} frameId Stable frame ID.
   * @param {{toggle?:boolean,range?:boolean}} [options] Selection gesture.
   * @returns {object} Updated workspace.
   */
  function selectFrame(workspace, frameId, options = {}) {
    if (!workspace.frames.some((frame) => frame.id === frameId)) throw new RangeError("找不到切片帧");
    const next = cloneWorkspace(workspace);
    if (options.range) {
      const group = groupForFrame(next, frameId);
      const anchorGroup = groupForFrame(next, next.selection.anchorId);
      if (group && anchorGroup?.id === group.id) {
        const start = group.frameIds.indexOf(next.selection.anchorId);
        const end = group.frameIds.indexOf(frameId);
        next.selection.ids = group.frameIds.slice(Math.min(start, end), Math.max(start, end) + 1);
        next.selection.primaryId = frameId;
        return next;
      }
    }
    if (options.toggle) {
      const selected = new Set(next.selection.ids);
      if (selected.has(frameId)) selected.delete(frameId);
      else selected.add(frameId);
      next.selection.ids = orderIds(next, [...selected]);
      next.selection.primaryId = selected.has(frameId) ? frameId : next.selection.ids.at(-1) || null;
      if (!next.selection.anchorId) next.selection.anchorId = frameId;
      return next;
    }
    next.selection = { ids: [frameId], primaryId: frameId, anchorId: frameId };
    return next;
  }

  /**
   * Sets selection explicitly while preserving visual order.
   * @param {object} workspace Workspace.
   * @param {string[]} ids Selected frame IDs.
   * @param {string|null} [primaryId] Primary selection.
   * @returns {object} Updated workspace.
   */
  function setSelection(workspace, ids, primaryId = null) {
    const next = cloneWorkspace(workspace);
    next.selection.ids = orderIds(next, ids);
    next.selection.primaryId = next.selection.ids.includes(primaryId)
      ? primaryId
      : next.selection.ids.at(-1) || null;
    next.selection.anchorId = next.selection.primaryId;
    return next;
  }

  /**
   * Moves selected frames to a target insertion point.
   * @param {object} workspace Workspace.
   * @param {string} targetGroupId Target group ID.
   * @param {number} targetIndex Index before which the block is inserted.
   * @returns {object} Updated workspace.
   */
  function moveSelectedFrames(workspace, targetGroupId, targetIndex) {
    const next = cloneWorkspace(workspace);
    const moving = orderIds(next, next.selection.ids);
    const targetBefore = next.groups.find((group) => group.id === targetGroupId);
    if (!targetBefore || moving.length === 0) return next;
    const safeIndex = Math.max(
      0,
      Math.min(targetBefore.frameIds.length, Math.floor(Number(targetIndex) || 0)),
    );
    const removedBefore = targetBefore.frameIds
      .slice(0, safeIndex)
      .filter((id) => moving.includes(id)).length;
    next.groups.forEach((group) => {
      group.frameIds = group.frameIds.filter((id) => !moving.includes(id));
    });
    const target = next.groups.find((group) => group.id === targetGroupId);
    const insertionIndex = Math.max(0, Math.min(target.frameIds.length, safeIndex - removedBefore));
    target.frameIds.splice(insertionIndex, 0, ...moving);
    return cleanGroups(next);
  }

  /**
   * Moves a group to a new visual index.
   * @param {object} workspace Workspace.
   * @param {string} groupId Stable group ID.
   * @param {number} targetIndex Target group index.
   * @returns {object} Updated workspace.
   */
  function moveGroup(workspace, groupId, targetIndex) {
    const next = cloneWorkspace(workspace);
    const sourceIndex = next.groups.findIndex((group) => group.id === groupId);
    if (sourceIndex < 0) return next;
    const [group] = next.groups.splice(sourceIndex, 1);
    const index = Math.max(0, Math.min(next.groups.length, Math.floor(Number(targetIndex) || 0)));
    next.groups.splice(index, 0, group);
    return next;
  }

  /**
   * Renames an animation group.
   * @param {object} workspace Workspace.
   * @param {string} groupId Stable group ID.
   * @param {string} name Requested name.
   * @returns {object} Updated workspace.
   */
  function renameGroup(workspace, groupId, name) {
    const next = cloneWorkspace(workspace);
    const group = next.groups.find((item) => item.id === groupId);
    if (!group) throw new RangeError("找不到动画组");
    const normalized = String(name || "").trim();
    if (!normalized) throw new RangeError("动画组名称不能为空");
    group.name = normalized.slice(0, 80);
    return next;
  }

  /**
   * Moves selected frames into a new group after their earliest source group.
   * @param {object} workspace Workspace.
   * @returns {object} Updated workspace.
   */
  function splitSelectedFrames(workspace) {
    const next = cloneWorkspace(workspace);
    const moving = orderIds(next, next.selection.ids);
    if (!moving.length) return next;
    const sourceIndexes = next.groups
      .map((group, index) => (group.frameIds.some((id) => moving.includes(id)) ? index : -1))
      .filter((index) => index >= 0);
    const insertAt = Math.min(...sourceIndexes) + 1;
    next.groups.forEach((group) => {
      group.frameIds = group.frameIds.filter((id) => !moving.includes(id));
    });
    const number = next.nextGroupNumber;
    next.nextGroupNumber += 1;
    next.groups.splice(insertAt, 0, {
      id: `group-${number}`,
      name: `动画组 ${String(number).padStart(2, "0")}`,
      frameIds: moving,
      enabled: true,
    });
    return cleanGroups(next);
  }

  /**
   * Merges a group into its previous or next neighbor.
   * @param {object} workspace Workspace.
   * @param {string} groupId Source group ID.
   * @param {"previous"|"next"} direction Merge direction.
   * @returns {object} Updated workspace.
   */
  function mergeGroup(workspace, groupId, direction) {
    if (!["previous", "next"].includes(direction)) throw new RangeError("direction 无效");
    const next = cloneWorkspace(workspace);
    const index = next.groups.findIndex((group) => group.id === groupId);
    const targetIndex = direction === "previous" ? index - 1 : index + 1;
    if (index < 0 || !next.groups[targetIndex]) return next;
    const source = next.groups[index];
    const target = next.groups[targetIndex];
    if (direction === "previous") target.frameIds.push(...source.frameIds);
    else target.frameIds.unshift(...source.frameIds);
    next.groups.splice(index, 1);
    return cleanGroups(next);
  }

  /**
   * Deletes a group and every frame it owns.
   * @param {object} workspace Workspace.
   * @param {string} groupId Group ID.
   * @returns {object} Updated workspace.
   */
  function deleteGroup(workspace, groupId) {
    const next = cloneWorkspace(workspace);
    const group = next.groups.find((item) => item.id === groupId);
    if (!group) return next;
    const removed = new Set(group.frameIds);
    next.groups = next.groups.filter((item) => item.id !== groupId);
    next.frames = next.frames.filter((frame) => !removed.has(frame.id));
    return repairSelection(next);
  }

  /**
   * Deletes all selected frames and selects the next adjacent visual frame.
   * @param {object} workspace Workspace.
   * @returns {object} Updated workspace.
   */
  function deleteSelectedFrames(workspace) {
    const beforeOrder = orderedFrameIds(workspace);
    const removed = new Set(workspace.selection.ids);
    if (!removed.size) return cloneWorkspace(workspace);
    const primaryIndex = Math.max(0, beforeOrder.indexOf(workspace.selection.primaryId));
    const next = cloneWorkspace(workspace);
    next.frames = next.frames.filter((frame) => !removed.has(frame.id));
    next.groups.forEach((group) => {
      group.frameIds = group.frameIds.filter((id) => !removed.has(id));
    });
    next.selection = { ids: [], primaryId: null, anchorId: null };
    cleanGroups(next);
    const remaining = orderedFrameIds(next);
    const adjacent = remaining[Math.min(primaryIndex, remaining.length - 1)] || null;
    if (adjacent) next.selection = { ids: [adjacent], primaryId: adjacent, anchorId: adjacent };
    return next;
  }

  /**
   * Inserts a new frame after a reference frame or into a new group.
   * @param {object} workspace Workspace.
   * @param {object} box New frame geometry.
   * @param {{afterFrameId?:string|null}} [options] Placement options.
   * @returns {object} Updated workspace.
   */
  function insertFrame(workspace, box, options = {}) {
    const next = cloneWorkspace(workspace);
    const frameId = `frame-${next.nextFrameNumber}`;
    next.nextFrameNumber += 1;
    next.frames.push(normalizeFrame(box, frameId));
    const group = groupForFrame(next, options.afterFrameId);
    if (group) {
      group.frameIds.splice(group.frameIds.indexOf(options.afterFrameId) + 1, 0, frameId);
    } else {
      const number = next.nextGroupNumber;
      next.nextGroupNumber += 1;
      next.groups.push({
        id: `group-${number}`,
        name: `动画组 ${String(number).padStart(2, "0")}`,
        frameIds: [frameId],
        enabled: true,
      });
    }
    next.selection = { ids: [frameId], primaryId: frameId, anchorId: frameId };
    return next;
  }

  /**
   * Toggles whether a group participates in export.
   * @param {object} workspace Workspace.
   * @param {string} groupId Group ID.
   * @param {boolean} enabled Enabled value.
   * @returns {object} Updated workspace.
   */
  function setGroupEnabled(workspace, groupId, enabled) {
    const next = cloneWorkspace(workspace);
    const group = next.groups.find((item) => item.id === groupId);
    if (!group) throw new RangeError("找不到动画组");
    group.enabled = Boolean(enabled);
    return next;
  }

  /**
   * Enables or disables non-destructive uniform output canvases.
   * @param {object} workspace Workspace.
   * @param {boolean} enabled Enabled value.
   * @returns {object} Updated workspace.
   */
  function setUniformOutput(workspace, enabled) {
    const next = cloneWorkspace(workspace);
    next.uniformOutput = Boolean(enabled);
    return next;
  }

  /**
   * Expands selected boxes to a common size around each bottom-center anchor.
   * @param {object} workspace Workspace.
   * @param {{width:number,height:number}} bounds Source bounds.
   * @returns {object} Updated workspace.
   */
  function normalizeSelectedBoxes(workspace, bounds) {
    const safeBounds = normalizeBounds(bounds);
    const selected = workspace.frames.filter((frame) => workspace.selection.ids.includes(frame.id));
    if (selected.length < 2) return cloneWorkspace(workspace);
    const targetWidth = Math.max(...selected.map((frame) => frame.w));
    const targetHeight = Math.max(...selected.map((frame) => frame.h));
    if (targetWidth > safeBounds.width || targetHeight > safeBounds.height) {
      throw new RangeError("统一裁剪框不能超过 source bounds");
    }
    const selectedIds = new Set(selected.map((frame) => frame.id));
    const next = cloneWorkspace(workspace);
    next.frames = next.frames.map((frame) => {
      if (!selectedIds.has(frame.id)) return frame;
      const centerX = frame.x + frame.w / 2;
      const bottom = frame.y + frame.h;
      const x = Math.max(0, Math.min(safeBounds.width - targetWidth, Math.round(centerX - targetWidth / 2)));
      const y = Math.max(0, Math.min(safeBounds.height - targetHeight, Math.round(bottom - targetHeight)));
      return { ...frame, x, y, w: targetWidth, h: targetHeight, pixels: targetWidth * targetHeight };
    });
    return next;
  }

  /**
   * Calculates non-destructive padded output canvas dimensions.
   * @param {object} workspace Workspace.
   * @param {{padding?:number,scope?:"per-group"|"global",groupIds?:string[]}} [options] Layout options.
   * @returns {Array<{groupId:string,width:number,height:number}>|{width:number,height:number}} Layout.
   */
  function planOutputLayouts(workspace, options = {}) {
    const padding = Math.max(0, Math.floor(Number(options.padding) || 0));
    const requested = Array.isArray(options.groupIds) ? new Set(options.groupIds) : null;
    const frameById = new Map(workspace.frames.map((frame) => [frame.id, frame]));
    const layouts = workspace.groups
      .filter((group) => !requested || requested.has(group.id))
      .map((group) => {
        const frames = group.frameIds.map((id) => frameById.get(id)).filter(Boolean);
        return {
          groupId: group.id,
          width: Math.max(0, ...frames.map((frame) => frame.w + padding * 2)),
          height: Math.max(0, ...frames.map((frame) => frame.h + padding * 2)),
        };
      });
    if (options.scope === "global") {
      return {
        width: Math.max(0, ...layouts.map((layout) => layout.width)),
        height: Math.max(0, ...layouts.map((layout) => layout.height)),
      };
    }
    return layouts;
  }

  return Object.freeze({
    createDetectedWorkspace,
    deleteGroup,
    deleteSelectedFrames,
    groupForFrame,
    insertFrame,
    mergeGroup,
    moveGroup,
    moveSelectedFrames,
    normalizeSelectedBoxes,
    orderedFrameIds,
    planOutputLayouts,
    regroupWorkspace,
    renameGroup,
    restoreWorkspace,
    selectFrame,
    setGroupEnabled,
    setSelection,
    setUniformOutput,
    snapshotWorkspace,
    splitSelectedFrames,
    updateFrameBox,
  });
});
