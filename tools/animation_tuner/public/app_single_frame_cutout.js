(function attachXFrameSingleFrameCutout(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameSingleFrameCutout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the project-workspace handoff for editing only the selected frame.
   * @param {{button?:HTMLButtonElement|null,getCurrentGroup?:()=>object|null,getSelectedFrame?:()=>number,getFrameImage?:(index:number,frame:object)=>Promise<CanvasImageSource|null>|CanvasImageSource|null,getBatchCutout?:()=>object|null,applyOutput?:(output:object,options:{frameIndex:number,premiumFeatures:string[]})=>Promise<void>,onReturn?:()=>void,translate?:(key:string,variables?:object)=>string,status?:(message:string)=>void}} dependencies Handoff collaborators.
   * @returns {{bind:()=>void,destroy:()=>void,open:()=>Promise<boolean>}} Single-frame cutout operations.
   */
  function createController(dependencies = {}) {
    const button = dependencies.button || null;
    const getCurrentGroup = dependencies.getCurrentGroup || (() => null);
    const getSelectedFrame = dependencies.getSelectedFrame || (() => 0);
    const getFrameImage = dependencies.getFrameImage || (() => null);
    const getBatchCutout = dependencies.getBatchCutout || (() => null);
    const applyOutput = dependencies.applyOutput || (async () => {});
    const onReturn = dependencies.onReturn || (() => {});
    const translate = dependencies.translate || ((key) => key);
    const status = dependencies.status || (() => {});
    let busy = false;
    let bound = false;

    /** Builds a stable display name without exposing a full local path. */
    function frameName(frame, frameIndex) {
      const explicitName = String(frame?.name || "").trim();
      if (explicitName) return explicitName;
      const pathName = String(frame?.path || "")
        .split(/[\\/]/)
        .pop();
      return pathName || `frame_${String(frameIndex + 1).padStart(4, "0")}.png`;
    }

    /** Opens the selected frame as an isolated one-image cutout workset. */
    async function open() {
      if (busy) return false;
      const group = getCurrentGroup();
      const frameIndex = Math.max(0, Number.parseInt(getSelectedFrame(), 10) || 0);
      const frame = group?.frames?.[frameIndex];
      const cutout = getBatchCutout();
      if (!frame || typeof cutout?.openWorkset !== "function") {
        status(translate("cutoutCurrentFrameUnavailable"));
        return false;
      }

      busy = true;
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
      }
      try {
        const image = await getFrameImage(frameIndex, frame);
        if (!image) throw new Error(translate("cutoutCurrentFrameUnavailable"));
        const outputs = await cutout.openWorkset({
          name: `${group.name || group.animationId || "animation"} · ${frameName(frame, frameIndex)}`,
          mode: "single",
          selectedIndex: 0,
          items: [
            {
              name: frameName(frame, frameIndex),
              image,
              frame: { ...frame, sourceIndex: frameIndex },
            },
          ],
        });
        if (!Array.isArray(outputs) || !outputs[0]) return false;
        await applyOutput(outputs[0], {
          frameIndex,
          premiumFeatures: Array.from(outputs.premiumFeatures || []),
        });
        status(translate("cutoutCurrentFrameApplied", { frame: frameIndex + 1 }));
        return true;
      } catch (error) {
        status(
          translate("cutoutCurrentFrameFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      } finally {
        onReturn();
        busy = false;
        if (button) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      }
    }

    /** Binds the project action once. */
    function bind() {
      if (bound || !button?.addEventListener) return;
      bound = true;
      button.addEventListener("click", open);
    }

    /** Removes the project action listener. */
    function destroy() {
      if (!bound || !button?.removeEventListener) return;
      bound = false;
      button.removeEventListener("click", open);
    }

    return { bind, destroy, open };
  }

  return Object.freeze({ createController });
});
