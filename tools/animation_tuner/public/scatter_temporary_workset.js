(function attachScatterTemporaryWorkset(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameScatterTemporaryWorkset = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /** Converts enabled scatter groups into an ordered, non-persistent frame workset. */
  function createTemporaryWorkset({ name = "零散切片", groups = [], createCanvas }) {
    if (typeof createCanvas !== "function") throw new TypeError("createCanvas 必须是函数");
    const enabledGroups = Array.from(groups).filter((group) => group?.enabled !== false);
    if (!enabledGroups.length) throw new Error("请至少选择一个动画组");

    const frames = enabledGroups.flatMap((group, groupIndex) => {
      const groupId = String(group.id || `group-${groupIndex + 1}`);
      const groupName = String(group.name || `动画组 ${groupIndex + 1}`);
      return Array.from(group.frames || group.boxes || []).map((frame, frameIndex) => {
        const image = createCanvas(frame, group);
        if (!image || !Number(image.width) || !Number(image.height)) {
          throw new Error(`无法生成切片画布：${groupName} 第 ${frameIndex + 1} 帧`);
        }
        const sourceFrameId = String(frame.id || `frame-${frameIndex + 1}`);
        return {
          id: `scatter:${groupId}:${sourceFrameId}`,
          name: `${groupName}-${String(frameIndex + 1).padStart(3, "0")}.png`,
          image,
          enabled: true,
          assetRevision: 0,
          groupId,
          groupName,
          sourceFrameId,
        };
      });
    });
    if (!frames.length) throw new Error("所选动画组中没有可用切片");
    return {
      name: String(name || "零散切片"),
      sourceTool: "scatter-slice",
      frames,
    };
  }

  return Object.freeze({ createTemporaryWorkset });
});
