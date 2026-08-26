(function attachXsxbAppEventsStagePointer(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppEventsStagePointer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const PAN_MOVE_THRESHOLD_SQ = 16;

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
    const getViewportWidth =
      typeof dependencies.getViewportWidth === "function"
        ? dependencies.getViewportWidth
        : () => Number(root?.innerWidth || 0);
    const structuredCloneImpl = dependencies.structuredCloneImpl || root?.structuredClone;
    const structuredClone =
      typeof structuredCloneImpl === "function"
        ? structuredCloneImpl
        : (value) => JSON.parse(JSON.stringify(value));
    const {
      activateFrameAttachmentForEditing,
      applySelectedAttachmentWheel,
      applySelectedFrameWheel = () => false,
      attachmentFrameIndex,
      attachmentOffsetDeltaFromClientDelta,
      boxOffsetDeltaFromScreenDelta,
      boxResizeDeltaFromScreenDelta,
      collisionOffsetYForHeight,
      cloneVector,
      draw = () => {},
      frameBox,
      getCurrentGroup,
      getImages,
      hitTestBoxes,
      hitTestDirectManipulationAttachment,
      hitTestDirectManipulationFrame = () => null,
      isCollisionBox,
      markDirty,
      moveDirectManipulationFrameByClientDelta = () => {},
      normalizeAttachmentTransform,
      panViewBy = () => {},
      pushUndo,
      renderFilmstrip,
      resizeFrameBox,
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
    /**
     * Starts a pan drag from the current pointer position.
     * @param {PointerEvent} event Pointer that began the pan.
     * @param {(nextDrag:object)=>void} beginDrag Drag starter from pointerdown.
     * @returns {void}
     */
    function beginPanDrag(event, beginDrag) {
      beginDrag({
        mode: "pan",
        x: event.clientX,
        y: event.clientY,
        viewX: state.view.x,
        viewY: state.view.y,
      });
    }

    /**
     * Returns whether this pointerdown should pan instead of editing.
     * Middle/right mouse always pan. Primary pans while Space is held.
     * @param {PointerEvent} event Pointerdown event.
     * @returns {boolean} True when navigation should own the gesture.
     */
    function shouldPanFromPointer(event) {
      if (event.button === 1 || event.button === 2) return true;
      if (event.button !== 0) return false;
      return Boolean(state.stageSpacePan);
    }

    /**
     * Trackpad two-finger and Shift+wheel pan; pinch and mouse-wheel still zoom.
     * @param {WheelEvent} event Stage wheel event.
     * @returns {boolean} True when the wheel should pan the viewport.
     */
    function shouldPanFromWheel(event) {
      if (event.ctrlKey || event.metaKey) return false;
      if (event.shiftKey) return true;
      const dx = Math.abs(Number(event.deltaX) || 0);
      const dy = Math.abs(Number(event.deltaY) || 0);
      if (dx > dy) return true;
      if (event.deltaMode === 0 && dx > 0) return true;
      return (
        event.deltaMode === 0 &&
        Number.isFinite(event.wheelDeltaY) &&
        event.wheelDeltaY !== 0 &&
        event.wheelDeltaY === -3 * event.deltaY
      );
    }

    /**
     * Shows move over the sprite and grab only on empty canvas.
     * @param {PointerEvent|null} [event] Latest pointer event.
     * @returns {void}
     */
    function refreshStageCursor(event) {
      const panning = Boolean(state.drag?.mode === "pan" || state.stageSpacePan);
      const overSprite = Boolean(
        !panning && state.drag?.mode !== "frame-transform" && event && hitTestDirectManipulationFrame(event),
      );
      stage.classList.toggle("isOverSprite", overSprite || state.drag?.mode === "frame-transform");
      stage.classList.toggle("isPanning", panning);
    }

    function bind() {
      // Middle-click paste/autoscroll would steal stage navigation.
      stage.addEventListener("auxclick", (event) => {
        if (event.button === 1) event.preventDefault();
      });
      stage.addEventListener("contextmenu", (event) => {
        event.preventDefault();
      });

      stage.addEventListener("pointerdown", (event) => {
        if (typeof stage.focus === "function") {
          try {
            stage.focus({ preventScroll: true });
          } catch (_error) {
            stage.focus();
          }
        }
        state.pointerStagePoint = stagePoint(event);
        updateCoordHud();
        const beginDrag = (nextDrag) => {
          stage.setPointerCapture(event.pointerId);
          stage.classList.add("dragging");
          state.drag = nextDrag;
        };
        if (shouldPanFromPointer(event)) {
          event.preventDefault?.();
          beginPanDrag(event, beginDrag);
          refreshStageCursor(event);
          return;
        }
        // The Transform sidebar is dedicated to moving the visible animation frame.
        // Give that direct manipulation precedence over collision-box hit targets,
        // but only when the pointer is on the sprite (empty canvas still pans).
        const frameTransform = hitTestDirectManipulationFrame(event);
        if (frameTransform) {
          pushUndo("drag frame transform");
          beginDrag({
            mode: "frame-transform",
            x: event.clientX,
            y: event.clientY,
            transform: structuredClone(frameTransform),
          });
          return;
        }
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
          const displayedBox = (boxName, frameIndex) => {
            const group = typeof getCurrentGroup === "function" ? getCurrentGroup() : undefined;
            const images = typeof getImages === "function" ? getImages() : undefined;
            if (images !== undefined) return frameBox(boxName, frameIndex, group, images);
            if (group !== undefined) return frameBox(boxName, frameIndex, group);
            return frameBox(boxName, frameIndex);
          };
          const box = displayedBox(state.selectedBox);
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
              box: structuredClone(displayedBox(state.selectedBox, frameIndex)),
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
        beginPanDrag(event, beginDrag);
      });

      stage.addEventListener("pointermove", (event) => {
        state.pointerStagePoint = stagePoint(event);
        if (!state.drag) {
          refreshStageCursor(event);
          updateCoordHud();
          return;
        }
        if (state.drag.mode === "pan") {
          const dx = event.clientX - state.drag.x;
          const dy = event.clientY - state.drag.y;
          const moved = dx * dx + dy * dy >= PAN_MOVE_THRESHOLD_SQ;
          // Space tap (no movement) still toggles play/pause; only a real pan
          // drag consumes Space and leaves fit/actual for a custom view.
          if (state.stageSpacePan && moved) state.stageSpacePanConsumed = true;
          if (moved) state.stageViewMode = "custom";
          state.view.x = state.drag.viewX + dx * devicePixelRatio;
          state.view.y = state.drag.viewY + dy * devicePixelRatio;
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
          for (const entry of state.drag.boxes || []) {
            const localDelta = isCollisionBox(state.drag.boxName)
              ? boxOffsetDeltaFromScreenDelta({ x: dx, y: dy }, entry.index)
              : boxResizeDeltaFromScreenDelta({ x: dx, y: dy }, entry.box.rotation, entry.index);
            setBoxOverride(
              state.drag.boxName,
              resizeFrameBox(state.drag.boxName, entry.box, state.drag.handle, localDelta),
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
        if (state.drag.mode === "frame-transform") {
          moveDirectManipulationFrameByClientDelta(
            state.drag.transform,
            event.clientX - state.drag.x,
            event.clientY - state.drag.y,
          );
          return;
        }
        state.drag = null;
        stage.classList.remove("dragging");
        updateCoordHud();
      });

      stage.addEventListener("pointerup", (event) => {
        state.drag = null;
        stage.classList.remove("dragging");
        refreshStageCursor(event);
        updateCoordHud();
      });

      stage.addEventListener("pointercancel", () => {
        state.drag = null;
        state.pointerStagePoint = null;
        stage.classList.remove("dragging");
        refreshStageCursor(null);
        updateCoordHud();
      });

      stage.addEventListener("lostpointercapture", () => {
        state.drag = null;
        stage.classList.remove("dragging");
        refreshStageCursor(null);
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
          if (applySelectedFrameWheel(event)) return;
          if (shouldPanFromWheel(event)) {
            const panX = -(Number(event.deltaX) || 0) || 0;
            const panY = -(Number(event.deltaY) || 0) || 0;
            panViewBy(panX, panY);
            draw();
            return;
          }
          zoomViewAt(event);
        },
        { passive: false },
      );
    }

    return { bind };
  }

  return { createController };
});
