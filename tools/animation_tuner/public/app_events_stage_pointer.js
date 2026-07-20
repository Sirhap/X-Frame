(function attachXsxbAppEventsStagePointer(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppEventsStagePointer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the stage pointer, drag, and wheel listeners used by the workbench.
   * The controller owns no application state; all mutable values and domain
   * operations are provided by the host event controller.
   *
   * @param {object} [dependencies] Stage and handler dependencies.
   * @returns {{bind:()=>void}} Stage event binding controller.
   */
  function createController(dependencies = {}) {
    const stage = dependencies.stage;
    const state = dependencies.state || {};
    const devicePixelRatio = Number(dependencies.devicePixelRatio || 1);
    const handlers = dependencies.handlers || {};
    const structuredCloneImpl = dependencies.structuredCloneImpl || root?.structuredClone;
    const structuredClone =
      typeof structuredCloneImpl === "function"
        ? structuredCloneImpl
        : (value) => JSON.parse(JSON.stringify(value));
    const {
      activateFrameAttachmentForEditing,
      applySelectedAttachmentWheel,
      attachmentFrameIndex,
      attachmentOffsetDeltaFromClientDelta,
      boxOffsetDeltaFromScreenDelta,
      boxResizeDeltaFromScreenDelta,
      collisionOffsetYForHeight,
      cloneVector,
      draw,
      frameBox,
      hitTestBoxes,
      hitTestDirectManipulationAttachment,
      isCollisionBox,
      markDirty,
      normalizeAttachmentTransform,
      pushUndo,
      renderFilmstrip,
      rotateVector,
      selectedFrameIndexes,
      setBoxOverride,
      stagePoint,
      syncAdjustmentInputs,
      syncBoxInputs,
      updateCoordHud,
      zoomViewAt,
    } = handlers;

    if (!stage?.addEventListener) {
      throw new TypeError("XSXBAppEventsStagePointer requires a stage element.");
    }
    if (!state || typeof state !== "object") {
      throw new TypeError("XSXBAppEventsStagePointer requires a state object.");
    }

    /**
     * Binds stage listeners in the same order as the original event controller.
     * @returns {void}
     */
    function bind() {
      stage.addEventListener("pointerdown", (event) => {
        state.pointerStagePoint = stagePoint(event);
        updateCoordHud();
        const beginDrag = (nextDrag) => {
          stage.setPointerCapture(event.pointerId);
          stage.classList.add("dragging");
          state.drag = nextDrag;
        };
        const boxHit = hitTestBoxes(event);
        if (boxHit) {
          state.selectedBox = boxHit.boxName;
          state.selectedBoxes.add(state.selectedBox);
          state.showBoxes = true;
          if (boxHit.mode === "box-alt-block") {
            syncBoxInputs();
            draw();
            return;
          }
          pushUndo(boxHit.mode === "box-resize" ? "resize box" : "drag box");
          const box = frameBox(state.selectedBox);
          beginDrag({
            mode: boxHit.mode,
            handle: boxHit.handle,
            x: event.clientX,
            y: event.clientY,
            boxName: state.selectedBox,
            offset: cloneVector(box.offset),
            size: cloneVector(box.size),
            rotation: Number(box.rotation || 0),
            enabled: box.enabled !== false,
            boxes: selectedFrameIndexes().map((frameIndex) => ({
              index: frameIndex,
              box: structuredClone(frameBox(state.selectedBox, frameIndex)),
            })),
          });
          syncBoxInputs();
          draw();
          return;
        }
        const attachment = hitTestDirectManipulationAttachment(event);
        if (attachment) {
          const frameIndex = attachmentFrameIndex(attachment, state.currentGroup);
          activateFrameAttachmentForEditing(attachment);
          pushUndo("drag attached image");
          beginDrag({
            mode: "attachment",
            x: event.clientX,
            y: event.clientY,
            attachmentId: attachment.id,
            frameIndex,
            transform: structuredClone(normalizeAttachmentTransform(attachment.transform)),
          });
          draw();
          return;
        }
        beginDrag({
          mode: "pan",
          x: event.clientX,
          y: event.clientY,
          viewX: state.view.x,
          viewY: state.view.y,
        });
      });

      stage.addEventListener("pointermove", (event) => {
        state.pointerStagePoint = stagePoint(event);
        if (!state.drag) {
          updateCoordHud();
          return;
        }
        if (state.drag.mode === "pan") {
          state.view.x = state.drag.viewX + (event.clientX - state.drag.x) * devicePixelRatio;
          state.view.y = state.drag.viewY + (event.clientY - state.drag.y) * devicePixelRatio;
          draw();
          return;
        }
        const dx = (event.clientX - state.drag.x) / state.view.zoom;
        const dy = (event.clientY - state.drag.y) / state.view.zoom;
        if (state.drag.mode === "box-move") {
          for (const entry of state.drag.boxes || []) {
            const collision = isCollisionBox(state.drag.boxName);
            const localDelta = boxOffsetDeltaFromScreenDelta({ x: dx, y: dy }, entry.index);
            setBoxOverride(
              state.drag.boxName,
              {
                offset: {
                  x: entry.box.offset.x + localDelta.x,
                  y: collision
                    ? collisionOffsetYForHeight(entry.box.size.y)
                    : entry.box.offset.y + localDelta.y,
                },
                size: entry.box.size,
                rotation: collision ? 0 : entry.box.rotation,
                enabled: entry.box.enabled,
              },
              entry.index,
            );
          }
          syncBoxInputs();
          draw();
          return;
        }
        if (state.drag.mode === "box-resize") {
          const minSize = 4;
          for (const entry of state.drag.boxes || []) {
            if (isCollisionBox(state.drag.boxName)) {
              const localDelta = boxOffsetDeltaFromScreenDelta({ x: dx, y: dy }, entry.index);
              let left = -entry.box.size.x / 2;
              let right = entry.box.size.x / 2;
              if (state.drag.handle.includes("w")) left += localDelta.x;
              if (state.drag.handle.includes("e")) right += localDelta.x;
              if (right - left < minSize) {
                if (state.drag.handle.includes("w")) left = right - minSize;
                else right = left + minSize;
              }
              const width = right - left;
              const heightDelta = state.drag.handle.includes("n") ? -localDelta.y : 0;
              const height = Math.max(minSize, entry.box.size.y + heightDelta);
              setBoxOverride(
                state.drag.boxName,
                {
                  offset: {
                    x: entry.box.offset.x + (left + right) / 2,
                    y: collisionOffsetYForHeight(height),
                  },
                  size: { x: width, y: height },
                  rotation: 0,
                  enabled: entry.box.enabled,
                },
                entry.index,
              );
              continue;
            }
            const rotation = (Number(entry.box.rotation || 0) * Math.PI) / 180;
            const localDelta = boxResizeDeltaFromScreenDelta(
              { x: dx, y: dy },
              entry.box.rotation,
              entry.index,
            );
            let left = -entry.box.size.x / 2;
            let right = entry.box.size.x / 2;
            let top = -entry.box.size.y / 2;
            let bottom = entry.box.size.y / 2;
            if (state.drag.handle.includes("w")) left += localDelta.x;
            if (state.drag.handle.includes("e")) right += localDelta.x;
            if (state.drag.handle.includes("n")) top += localDelta.y;
            if (state.drag.handle.includes("s")) bottom += localDelta.y;
            if (right - left < minSize) {
              if (state.drag.handle.includes("w")) left = right - minSize;
              else right = left + minSize;
            }
            if (bottom - top < minSize) {
              if (state.drag.handle.includes("n")) top = bottom - minSize;
              else bottom = top + minSize;
            }
            const localCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
            const worldCenter = rotateVector(localCenter, rotation);
            setBoxOverride(
              state.drag.boxName,
              {
                offset: { x: entry.box.offset.x + worldCenter.x, y: entry.box.offset.y + worldCenter.y },
                size: { x: right - left, y: bottom - top },
                rotation: entry.box.rotation,
                enabled: entry.box.enabled,
              },
              entry.index,
            );
          }
          syncBoxInputs();
          draw();
          return;
        }
        if (state.drag.mode === "attachment") {
          const attachment = state.frameImageAttachments.find(
            (entry) => entry.id === state.drag.attachmentId,
          );
          if (!attachment) return;
          const localDelta = attachmentOffsetDeltaFromClientDelta(
            event.clientX - state.drag.x,
            event.clientY - state.drag.y,
            attachment,
          );
          attachment.transform = normalizeAttachmentTransform({
            ...state.drag.transform,
            offset: {
              x: state.drag.transform.offset.x + localDelta.x,
              y: state.drag.transform.offset.y + localDelta.y,
            },
          });
          markDirty();
          syncAdjustmentInputs();
          renderFilmstrip();
          draw();
          return;
        }
        state.drag = null;
        stage.classList.remove("dragging");
        updateCoordHud();
      });

      stage.addEventListener("pointerup", () => {
        state.drag = null;
        stage.classList.remove("dragging");
        updateCoordHud();
      });

      stage.addEventListener("pointercancel", () => {
        state.drag = null;
        state.pointerStagePoint = null;
        stage.classList.remove("dragging");
        updateCoordHud();
      });

      stage.addEventListener("lostpointercapture", () => {
        state.drag = null;
        stage.classList.remove("dragging");
        updateCoordHud();
      });

      stage.addEventListener("pointerleave", () => {
        if (state.drag) return;
        state.pointerStagePoint = null;
        updateCoordHud();
      });

      stage.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          state.pointerStagePoint = stagePoint(event);
          if (applySelectedAttachmentWheel(event)) return;
          zoomViewAt(event);
        },
        { passive: false },
      );
    }

    return { bind };
  }

  return { createController };
});
