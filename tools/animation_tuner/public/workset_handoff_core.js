(function attachXsxbWorksetHandoffCore(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBWorksetHandoffCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /** Converts a user-facing identifier into a stable project key. */
  function defaultSlug(value, fallback = "item") {
    const result = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return result || fallback;
  }

  /** Locates one profile and animation without mutating the manifest. */
  function findAnimation(manifest, profileId, animationId) {
    const profile = Array.from(manifest?.profiles || []).find((entry) => String(entry.id) === profileId);
    const animation = Array.from(profile?.animations || []).find(
      (entry) => String(entry.id || entry.name) === animationId,
    );
    return { profile: profile || null, animation: animation || null };
  }

  /** Reads stable animation and frame ownership from one persisted binding. */
  function bindingIdentity(binding) {
    const metadata = binding?.metadata && typeof binding.metadata === "object" ? binding.metadata : {};
    const profileId = String(metadata.profileId || binding?.profileId || "");
    let animation = String(metadata.animation || binding?.animation || binding?.animationId || "");
    if (animation && profileId && !animation.includes("/")) animation = `${profileId}/${animation}`;
    const match = /^(.*):(\d+)$/.exec(String(binding?.key || binding?.frameKey || ""));
    if (!animation && match) animation = match[1];
    const frame = Number(metadata.frame ?? binding?.frame ?? match?.[2]);
    return { animation, frame: Number.isInteger(frame) ? frame : null };
  }

  /** Counts preserved and removed indexed dictionary entries for a replacement. */
  function indexedImpact(dictionary, prefix, retainedSourceIndexes) {
    let preserved = 0;
    let removed = 0;
    for (const key of Object.keys(dictionary && typeof dictionary === "object" ? dictionary : {})) {
      if (!key.startsWith(prefix) || key === `${prefix}__group`) continue;
      const frame = Number(key.slice(prefix.length));
      if (Number.isInteger(frame) && retainedSourceIndexes.has(frame)) preserved += 1;
      else removed += 1;
    }
    return { preserved, removed };
  }

  /** Counts preserved and removed frame-owned bindings for a replacement. */
  function bindingImpact(bindings, animationKey, retainedSourceIndexes) {
    let preserved = 0;
    let removed = 0;
    const values = Array.isArray(bindings)
      ? bindings
      : Object.entries(bindings && typeof bindings === "object" ? bindings : {}).map(([key, value]) => ({
          key,
          ...(value && typeof value === "object" ? value : {}),
        }));
    for (const binding of values) {
      const identity = bindingIdentity(binding);
      if (identity.animation !== animationKey) continue;
      if (identity.frame !== null && retainedSourceIndexes.has(identity.frame)) preserved += 1;
      else removed += 1;
    }
    return { preserved, removed };
  }

  /** Counts frame-owned attack-trail control sticks for replacement disclosure. */
  function attackTrailImpact(document, animationKey, retainedSourceIndexes) {
    let preserved = 0;
    let removed = 0;
    for (const segment of Array.from(document?.bindings?.[animationKey] || [])) {
      for (const stick of Array.from(segment?.sticks || [])) {
        const frame = Number(stick?.frame);
        if (Number.isInteger(frame) && retainedSourceIndexes.has(frame)) preserved += 1;
        else removed += 1;
      }
    }
    return { preserved, removed };
  }

  /** Builds the user-facing replacement impact summary. */
  function replacementImpact(state, operation, animation) {
    const animationKey = `${operation.profileId}/${operation.animationId}`;
    const retainedSourceIndexes = new Set(
      Array.from(operation.items || [])
        .map((item) => Number(item?.sourceIndex))
        .filter(Number.isInteger),
    );
    return {
      operationId: operation.id,
      profileId: operation.profileId,
      animationId: operation.animationId,
      frames: {
        before: Array.isArray(animation?.frames) ? animation.frames.length : 0,
        after: operation.frameCount,
      },
      visual: indexedImpact(state.tuning?.frame_visual_overrides, `${animationKey}:`, retainedSourceIndexes),
      playback: indexedImpact(
        state.tuning?.frame_playback_overrides,
        `${animationKey}:`,
        retainedSourceIndexes,
      ),
      boxes: indexedImpact(state.tuning?.frame_box_overrides, `${animationKey}:`, retainedSourceIndexes),
      audio: bindingImpact(state.frameAudioBindings, animationKey, retainedSourceIndexes),
      attachments: bindingImpact(state.frameImageAttachments, animationKey, retainedSourceIndexes),
      attackTrails: attackTrailImpact(state.attackTrails, animationKey, retainedSourceIndexes),
    };
  }

  /** Normalizes one workset operation while preserving its ordered items. */
  function normalizeOperation(rawOperation, index, slug) {
    const type = rawOperation?.type === "replace" ? "replace" : "create";
    const profileLabel = String(rawOperation?.profileLabel || rawOperation?.profileId || "").trim();
    const animationName = String(rawOperation?.animationName || rawOperation?.animationId || "").trim();
    const items = Array.from(rawOperation?.items || []);
    return {
      ...rawOperation,
      id: String(rawOperation?.id || `operation-${index + 1}`),
      type,
      profileId: slug(rawOperation?.profileId || profileLabel, "character"),
      profileLabel,
      animationId: slug(rawOperation?.animationId || animationName, "animation"),
      animationName,
      frameCount: items.length || Math.max(0, Number(rawOperation?.frameCount) || 0),
      items,
    };
  }

  /**
   * Validates and plans a mixed batch of animation worksets.
   * @param {{manifest?:object,tuning?:object,frameAudioBindings?:object[]|object,frameImageAttachments?:object[]|object,attackTrails?:object,operations?:object[],slug?:(value:unknown,fallback?:string)=>string}} input Planning input.
   * @returns {{ok:boolean,operations:object[],conflicts:object[],impacts:object[]}} Workset plan.
   */
  function planWorksetOperations(input = {}) {
    const slug = input.slug || defaultSlug;
    const operations = Array.from(input.operations || []).map((operation, index) =>
      normalizeOperation(operation, index, slug),
    );
    const conflicts = [];
    const impacts = [];
    const requestedTargets = new Set();
    for (const operation of operations) {
      if (!operation.profileLabel || !operation.animationName || operation.frameCount < 1) {
        conflicts.push({
          operationId: operation.id,
          code: "invalid_operation",
          message: "项目角色、动画名称和至少一帧素材都是必填项。",
        });
        continue;
      }
      const targetKey = `${operation.profileId}/${operation.animationId}`;
      if (requestedTargets.has(targetKey)) {
        conflicts.push({
          operationId: operation.id,
          code: "duplicate_target",
          targetKey,
          message: `同一批次不能重复写入动画：${targetKey}`,
        });
        continue;
      }
      requestedTargets.add(targetKey);
      const { profile, animation } = findAnimation(
        input.manifest,
        operation.profileId,
        operation.animationId,
      );
      if (operation.type === "create" && animation) {
        conflicts.push({
          operationId: operation.id,
          code: "animation_exists",
          targetKey,
          message: `动画已存在，请改名或明确选择替换：${targetKey}`,
        });
        continue;
      }
      if (operation.type === "replace" && (!profile || !animation)) {
        conflicts.push({
          operationId: operation.id,
          code: "animation_missing",
          targetKey,
          message: `要替换的动画不存在：${targetKey}`,
        });
        continue;
      }
      if (operation.type === "replace") impacts.push(replacementImpact(input, operation, animation));
    }
    return {
      ok: conflicts.length === 0 && operations.length > 0,
      operations,
      conflicts,
      impacts,
    };
  }

  return Object.freeze({ defaultSlug, planWorksetOperations });
});
