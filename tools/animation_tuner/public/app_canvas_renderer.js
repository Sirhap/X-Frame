(function initializeCanvasRenderer(globalScope, factory) {
  const api = factory(globalScope);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.XSXBAppCanvasRenderer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createCanvasRendererModule(globalScope) {
  "use strict";

  const canvasLayerRendererModule =
    globalScope?.XSXBAppCanvasRendererLayers ||
    (typeof require === "function" ? require("./app_canvas_renderer_layers") : null);

  /**
   * Creates the Canvas rendering controller used by the animation workbench.
   *
   * @param {object} options - Render state accessors, drawing context, and domain callbacks.
   * @returns {object} Canvas renderer API.
   */
  function createController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const state = () => getState() || {};
    const ctx = options.context;
    const els = options.elements;
    const getDevicePixelRatio =
      typeof options.getDevicePixelRatio === "function" ? options.getDevicePixelRatio : () => 1;
    const {
      attachedLayerGroups,
      attachedVfxPlaybackWindow,
      boxScreenRect,
      canEditBoxes,
      clampInteger,
      cloneVector,
      coordinateGridStep,
      coordinateOrigin,
      coordinateScreenScale,
      coordinateToScreen,
      drawableFrameAttachments,
      editableBoxHandleRects,
      floorReferenceLabel,
      floorTopReferenceOffset,
      framePlayback,
      frameTransform,
      groupOriginScreen,
      isReferenceFrame,
      nearlyEqual,
      nextPlayableFrameInGroup,
      playbackChainGroup,
      frameImageAttachmentScreenRect = () => null,
      renderTransformForGroup,
      rawGroupPlaybackFps,
      round = (value) => Math.round(value),
      runtimeBaseScaleForGroup,
      screenToCoordinate,
      selectedFrameAttachment,
      selectedFrameIndexes,
      t = (key) => String(key),
      targetHeightAnimationAnchorX,
      targetHeightAnimationAnchorY,
      usesRuntimeFootAnchor,
      usesSceneTopLeftAnchor,
      valueStore,
      boxDrawOrder = [],
    } = options;
    if (!ctx || !els?.stage) throw new TypeError("Canvas renderer requires context and stage elements.");
    function drawGrid() {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.07)";
      ctx.lineWidth = 1;
      const step = 64 * getDevicePixelRatio();
      for (let x = state().view.x % step; x < els.stage.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, els.stage.height);
        ctx.stroke();
      }
      for (let y = state().view.y % step; y < els.stage.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(els.stage.width, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(242,162,60,.55)";
      ctx.beginPath();
      ctx.moveTo(state().view.x - 20, state().view.y);
      ctx.lineTo(state().view.x + 20, state().view.y);
      ctx.moveTo(state().view.x, state().view.y - 20);
      ctx.lineTo(state().view.x, state().view.y + 20);
      ctx.stroke();
      drawCoordinateGrid();
      drawFloorTopReference();
      ctx.restore();
    }

    function drawCoordinateGrid() {
      if (!state().currentGroup || !state().images.length) return;
      const origin = coordinateOrigin();
      const scale = coordinateScreenScale();
      const step = coordinateGridStep(scale);
      const minX = Math.floor((0 - origin.x) / scale / step) * step;
      const maxX = Math.ceil((els.stage.width - origin.x) / scale / step) * step;
      const minY = Math.floor((0 - origin.y) / scale / step) * step;
      const maxY = Math.ceil((els.stage.height - origin.y) / scale / step) * step;
      const labelY = Math.min(
        Math.max(origin.y + 15 * getDevicePixelRatio(), 16 * getDevicePixelRatio()),
        els.stage.height - 10 * getDevicePixelRatio(),
      );
      const labelX = Math.min(
        Math.max(origin.x + 8 * getDevicePixelRatio(), 8 * getDevicePixelRatio()),
        els.stage.width - 74 * getDevicePixelRatio(),
      );
      ctx.save();
      ctx.lineWidth = Math.max(1, getDevicePixelRatio());
      ctx.font = `${11 * getDevicePixelRatio()}px Consolas, "Cascadia Mono", monospace`;
      ctx.textBaseline = "top";
      for (let x = minX; x <= maxX; x += step) {
        const screenX = origin.x + x * scale;
        ctx.strokeStyle = nearlyEqual(x, 0) ? "rgba(255, 196, 74, .82)" : "rgba(145, 215, 255, .12)";
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, els.stage.height);
        ctx.stroke();
        if (!nearlyEqual(x, 0) && screenX >= 0 && screenX <= els.stage.width) {
          ctx.fillStyle = "rgba(203, 238, 255, .68)";
          ctx.fillText(String(round(x)), screenX + 4 * getDevicePixelRatio(), labelY);
        }
      }
      for (let y = minY; y <= maxY; y += step) {
        const screenY = origin.y + y * scale;
        ctx.strokeStyle = nearlyEqual(y, 0) ? "rgba(255, 196, 74, .82)" : "rgba(145, 215, 255, .10)";
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(els.stage.width, screenY);
        ctx.stroke();
        if (!nearlyEqual(y, 0) && screenY >= 0 && screenY <= els.stage.height) {
          ctx.fillStyle = "rgba(203, 238, 255, .68)";
          ctx.fillText(String(round(y)), labelX, screenY + 3 * getDevicePixelRatio());
        }
      }
      ctx.fillStyle = "rgba(255, 224, 150, .95)";
      ctx.fillText("0,0", origin.x + 8 * getDevicePixelRatio(), origin.y + 8 * getDevicePixelRatio());
      ctx.restore();
    }

    function drawFloorTopReference() {
      const offsetY = floorTopReferenceOffset(state().selectedFrame, state().currentGroup, state().images);
      const y = state().view.y + offsetY * state().view.zoom * getDevicePixelRatio();
      ctx.save();
      ctx.strokeStyle = "rgba(255,196,74,.78)";
      ctx.lineWidth = Math.max(1, getDevicePixelRatio());
      ctx.setLineDash([10 * getDevicePixelRatio(), 7 * getDevicePixelRatio()]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(els.stage.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,214,128,.92)";
      ctx.font = `${12 * getDevicePixelRatio()}px system-ui, sans-serif`;
      ctx.fillText(
        floorReferenceLabel(state().currentGroup),
        12 * getDevicePixelRatio(),
        y - 8 * getDevicePixelRatio(),
      );
      ctx.restore();
    }

    function drawAlignedFloorLabel(label, color = "rgba(145,215,255,.62)") {
      const offsetY = floorTopReferenceOffset(state().selectedFrame, state().currentGroup, state().images);
      const y = state().view.y + offsetY * state().view.zoom * getDevicePixelRatio();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, getDevicePixelRatio());
      ctx.setLineDash([4 * getDevicePixelRatio(), 8 * getDevicePixelRatio()]);
      ctx.beginPath();
      ctx.moveTo(0, y + 4 * getDevicePixelRatio());
      ctx.lineTo(els.stage.width, y + 4 * getDevicePixelRatio());
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = `${11 * getDevicePixelRatio()}px system-ui, sans-serif`;
      ctx.fillText(label, 12 * getDevicePixelRatio(), y + 19 * getDevicePixelRatio());
      ctx.restore();
    }

    function frameScreenRect(
      index,
      group = state().currentGroup,
      groupImages = state().images,
      options = {},
    ) {
      const img = groupImages[index];
      if (!img || !group) return null;
      const t = renderTransformForGroup(options.transform || frameTransform(index, group), group);
      const flipH = effectiveFlipH(group, options);
      const facing = flipH ? -1 : 1;
      const worldScale = state().view.zoom * getDevicePixelRatio();
      const runtimeBaseScale = runtimeBaseScaleForGroup(index, group, groupImages);
      const alignFloor = options.alignFloor === true || group.uiId !== state().currentGroup?.uiId;
      const origin = groupOriginScreen(index, group, groupImages, alignFloor);
      if (usesRuntimeFootAnchor(group)) {
        const spriteScaleX = runtimeBaseScale * t.scaleX * worldScale;
        const spriteScaleY = runtimeBaseScale * t.scaleY * worldScale;
        const scaledOffsetX = t.offset.x * runtimeBaseScale * worldScale * facing;
        const scaledOffsetY = t.offset.y * runtimeBaseScale * worldScale;
        const anchorX = targetHeightAnimationAnchorX(index, group, groupImages);
        const anchorY = targetHeightAnimationAnchorY(index, group, groupImages);
        const originX = origin.x + scaledOffsetX + (img.width * 0.5 - anchorX) * spriteScaleX * facing;
        const originY = origin.y + scaledOffsetY + (img.height * 0.5 - anchorY) * spriteScaleY;
        const topLeftX = originX - (img.width * spriteScaleX) / 2;
        const topLeftY = origin.y + scaledOffsetY - anchorY * spriteScaleY;
        const rotation = (Number(t.rotation || 0) * facing * Math.PI) / 180;
        if (Math.abs(rotation) > 0.0001) {
          const corners = [
            { x: topLeftX - originX, y: topLeftY - originY },
            { x: topLeftX + img.width * spriteScaleX - originX, y: topLeftY - originY },
            {
              x: topLeftX + img.width * spriteScaleX - originX,
              y: topLeftY + img.height * spriteScaleY - originY,
            },
            { x: topLeftX - originX, y: topLeftY + img.height * spriteScaleY - originY },
          ].map((point) => ({
            x: originX + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
            y: originY + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
          }));
          const xs = corners.map((point) => point.x);
          const ys = corners.map((point) => point.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          return {
            x: minX,
            y: minY,
            originX,
            originY,
            width: maxX - minX,
            height: maxY - minY,
          };
        }
        return {
          x: topLeftX,
          y: topLeftY,
          originX,
          originY,
          width: img.width * spriteScaleX,
          height: img.height * spriteScaleY,
        };
      }
      const spriteScaleX = runtimeBaseScale * t.scaleX * worldScale;
      const spriteScaleY = runtimeBaseScale * t.scaleY * worldScale;
      if (usesSceneTopLeftAnchor(group)) {
        const width = img.width * spriteScaleX;
        const height = img.height * spriteScaleY;
        const x = origin.x + t.offset.x * runtimeBaseScale * worldScale * facing - (flipH ? width : 0);
        const y = origin.y + t.offset.y * runtimeBaseScale * worldScale;
        const originX = x + width / 2;
        const originY = y + height / 2;
        const rotation = (Number(t.rotation || 0) * facing * Math.PI) / 180;
        if (Math.abs(rotation) > 0.0001) {
          const corners = [
            { x: x - originX, y: y - originY },
            { x: x + width - originX, y: y - originY },
            { x: x + width - originX, y: y + height - originY },
            { x: x - originX, y: y + height - originY },
          ].map((point) => ({
            x: originX + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
            y: originY + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
          }));
          const xs = corners.map((point) => point.x);
          const ys = corners.map((point) => point.y);
          return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            originX,
            originY,
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        }
        return {
          x,
          y,
          originX,
          originY,
          width,
          height,
        };
      }
      let x = origin.x + t.offset.x * runtimeBaseScale * worldScale * facing;
      let y = origin.y + t.offset.y * runtimeBaseScale * worldScale;
      if (group.type === "character") {
        const centerX = Number(state().config?.references?.playerSpriteCenterX || 512);
        const footY = Number(state().config?.references?.playerSpriteFootY || 512);
        const anchorX = Number(group.anchorX ?? centerX);
        x =
          origin.x + (-(anchorX - centerX) * t.scaleX + t.offset.x) * runtimeBaseScale * worldScale * facing;
        y = origin.y + (-footY * t.scaleY + t.offset.y) * runtimeBaseScale * worldScale;
      }
      if (group.type === "vfx") {
        const store = valueStore(group);
        const anchor = cloneVector(
          store[group.anchor] || group.anchorValue || { x: img.width, y: img.height },
        );
        return {
          x: x - anchor.x * spriteScaleX,
          y: y - anchor.y * spriteScaleY,
          originX: x,
          originY: y,
          width: img.width * spriteScaleX,
          height: img.height * spriteScaleY,
        };
      }
      if (group.type === "boss") {
        y = origin.y + (-img.height * t.scaleY * 0.5 + t.offset.y) * runtimeBaseScale * worldScale;
      }
      return {
        x: x - (img.width * spriteScaleX) / 2,
        y: y - (img.height * spriteScaleY) / 2,
        originX: x,
        originY: y,
        width: img.width * spriteScaleX,
        height: img.height * spriteScaleY,
      };
    }

    function compositeOwnerFrameIndex(
      layerIndex = state().selectedFrame,
      ownerGroup = state().previewOwnerGroup,
    ) {
      if (!ownerGroup?.frames?.length) return 0;
      return Math.min(Math.max(layerIndex, 0), ownerGroup.frames.length - 1);
    }

    function effectiveFlipH(group, options = {}) {
      return Boolean(options.flipH ?? group?.flipH === true);
    }

    function compositeLayerFlipH(layerGroup, ownerGroup) {
      return Boolean(ownerGroup?.flipH === true) !== Boolean(layerGroup?.flipH === true);
    }

    function compositeLayerTransform(layerGroup, layerIndex, ownerGroup, ownerIndex) {
      const owner = frameTransform(ownerIndex, ownerGroup);
      const layer = frameTransform(layerIndex, layerGroup);
      let offsetX = owner.offset.x + layer.offset.x * owner.scaleX;
      if (ownerGroup?.flipH === true) {
        offsetX = owner.offset.x - layer.offset.x * owner.scaleX;
      }
      return {
        scale: owner.scale * layer.scale,
        scaleX: owner.scaleX * layer.scaleX,
        scaleY: owner.scaleY * layer.scaleY,
        offset: {
          x: offsetX,
          y: owner.offset.y + layer.offset.y * owner.scaleY,
        },
        rotation: Number(owner.rotation || 0) + Number(layer.rotation || 0),
      };
    }

    function currentFrameRect(index = state().selectedFrame) {
      if (
        state().currentGroup?.previewOwner &&
        state().previewOwnerGroup &&
        state().previewOwnerImages.length
      ) {
        const ownerIndex = compositeOwnerFrameIndex(index, state().previewOwnerGroup);
        return frameScreenRect(index, state().currentGroup, state().images, {
          transform: compositeLayerTransform(
            state().currentGroup,
            index,
            state().previewOwnerGroup,
            ownerIndex,
          ),
          flipH: compositeLayerFlipH(state().currentGroup, state().previewOwnerGroup),
        });
      }
      return frameScreenRect(index);
    }

    function coordinateOwnerFrameIndex(layerIndex = state().selectedFrame) {
      if (!state().coordinateOwnerGroup?.frames?.length) return 0;
      const window = attachedVfxPlaybackWindow(state().currentGroup);
      if (window.owner?.uiId === state().coordinateOwnerGroup.uiId) {
        return clampInteger(window.start + layerIndex, 0, window.end);
      }
      return Math.min(Math.max(layerIndex, 0), state().coordinateOwnerGroup.frames.length - 1);
    }

    function drawCoordinateMarker(point, label, color) {
      if (!point) return;
      const size = 10 * getDevicePixelRatio();
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1.5 * getDevicePixelRatio(), 1.5);
      ctx.beginPath();
      ctx.moveTo(point.x - size, point.y);
      ctx.lineTo(point.x + size, point.y);
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x, point.y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.2 * getDevicePixelRatio(), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${12 * getDevicePixelRatio()}px system-ui, sans-serif`;
      ctx.fillText(label, point.x + 9 * getDevicePixelRatio(), point.y - 18 * getDevicePixelRatio());
      ctx.restore();
    }

    function drawCoordinateMarkers() {
      if (!state().currentGroup || !state().images.length) return;
      const currentOffset = frameTransform().offset;
      const currentPoint = coordinateToScreen(currentOffset);
      drawCoordinateMarker(
        currentPoint,
        `Current ${round(currentOffset.x)}, ${round(currentOffset.y)}`,
        "rgba(242, 162, 60, .96)",
      );
      if (
        !state().coordinateOwnerGroup ||
        !state().coordinateOwnerImages.length ||
        state().coordinateOwnerGroup.uiId === state().currentGroup.uiId
      )
        return;
      const ownerIndex = coordinateOwnerFrameIndex();
      const ownerOffset = frameTransform(ownerIndex, state().coordinateOwnerGroup).offset;
      const ownerPoint = coordinateToScreen(
        ownerOffset,
        ownerIndex,
        state().coordinateOwnerGroup,
        state().coordinateOwnerImages,
        true,
      );
      drawCoordinateMarker(
        ownerPoint,
        `Owner ${state().coordinateOwnerGroup.name}`,
        "rgba(145, 215, 255, .94)",
      );
      ctx.save();
      ctx.strokeStyle = "rgba(145, 215, 255, .58)";
      ctx.fillStyle = "rgba(203, 238, 255, .92)";
      ctx.lineWidth = Math.max(1.25 * getDevicePixelRatio(), 1.25);
      ctx.setLineDash([7 * getDevicePixelRatio(), 5 * getDevicePixelRatio()]);
      ctx.beginPath();
      ctx.moveTo(ownerPoint.x, ownerPoint.y);
      ctx.lineTo(currentPoint.x, currentPoint.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const delta = {
        x: currentOffset.x - ownerOffset.x,
        y: currentOffset.y - ownerOffset.y,
      };
      ctx.font = `${12 * getDevicePixelRatio()}px Consolas, "Cascadia Mono", monospace`;
      ctx.fillText(
        `delta ${round(delta.x)}, ${round(delta.y)}`,
        (ownerPoint.x + currentPoint.x) * 0.5 + 8 * getDevicePixelRatio(),
        (ownerPoint.y + currentPoint.y) * 0.5 + 8 * getDevicePixelRatio(),
      );
      ctx.restore();
    }

    function updateCoordHud() {
      if (!els.coordHud) return;
      if (!state().currentGroup) {
        els.coordHud.textContent = t("coordHudIdle");
        return;
      }
      const pointer = state().pointerStagePoint ? screenToCoordinate(state().pointerStagePoint) : null;
      const currentOffset = frameTransform().offset;
      const parts = [
        pointer
          ? `${state().language === "zh" ? "鼠标" : "Mouse"} ${round(pointer.x)}, ${round(pointer.y)}`
          : state().language === "zh"
            ? "鼠标 -, -"
            : "Mouse -, -",
        `${state().language === "zh" ? "偏移" : "Offset"} ${round(currentOffset.x)}, ${round(currentOffset.y)}`,
      ];
      if (
        state().coordinateOwnerGroup &&
        state().coordinateOwnerImages.length &&
        state().coordinateOwnerGroup.uiId !== state().currentGroup.uiId
      ) {
        const ownerIndex = coordinateOwnerFrameIndex();
        const ownerOffset = frameTransform(ownerIndex, state().coordinateOwnerGroup).offset;
        parts.push(
          `${state().language === "zh" ? "参考" : "Owner"} ${round(ownerOffset.x)}, ${round(ownerOffset.y)}`,
        );
        parts.push(
          `${state().language === "zh" ? "差值" : "Delta"} ${round(currentOffset.x - ownerOffset.x)}, ${round(currentOffset.y - ownerOffset.y)}`,
        );
      }
      els.coordHud.textContent = parts.join(" | ");
    }

    function isPointInsideFrame(event, index = state().selectedFrame) {
      const rect = currentFrameRect(index);
      if (!rect) return false;
      const stageRect = els.stage.getBoundingClientRect();
      const x = (event.clientX - stageRect.left) * getDevicePixelRatio();
      const y = (event.clientY - stageRect.top) * getDevicePixelRatio();
      const padding = Math.max(18 * getDevicePixelRatio(), Math.min(rect.width, rect.height) * 0.18);
      const minSize = 72 * getDevicePixelRatio();
      const extraX = Math.max(0, minSize - rect.width) * 0.5;
      const extraY = Math.max(0, minSize - rect.height) * 0.5;
      return (
        x >= rect.x - padding - extraX &&
        x <= rect.x + rect.width + padding + extraX &&
        y >= rect.y - padding - extraY &&
        y <= rect.y + rect.height + padding + extraY
      );
    }

    if (!canvasLayerRendererModule?.createController) {
      throw new Error("XSXBAppCanvasRendererLayers is required.");
    }
    const layerRenderer = canvasLayerRendererModule.createController({
      context: ctx,
      getState,
      getDevicePixelRatio,
      attachedLayerGroups,
      cloneVector,
      compositeLayerFlipH,
      compositeLayerTransform,
      compositeOwnerFrameIndex,
      drawableFrameAttachments,
      effectiveFlipH,
      frameImageAttachmentScreenRect,
      framePlayback,
      frameScreenRect,
      frameTransform,
      nextPlayableFrameInGroup,
      rawGroupPlaybackFps,
      renderTransformForGroup,
      runtimeBaseScaleForGroup,
      valueStore,
    });
    const { drawCompositeFrame, drawFrame, playbackNeedsContinuousDraw } = layerRenderer;

    function drawBox(boxName) {
      const rect = boxScreenRect(boxName);
      if (!rect) return;
      const box = rect.box;
      const selected = state().selectedBox === boxName;
      const styles = {
        hitbox: {
          fill: "rgba(255, 90, 66, .16)",
          stroke: "rgba(255, 112, 82, .94)",
          label: "rgba(255, 178, 156, .96)",
          handle: "rgba(255, 112, 82, 1)",
        },
        hurtbox: {
          fill: "rgba(99, 196, 255, .13)",
          stroke: "rgba(99, 196, 255, .92)",
          label: "rgba(184, 230, 255, .96)",
          handle: "rgba(99, 196, 255, 1)",
        },
        collisionbox: {
          fill: "rgba(76, 224, 132, .12)",
          stroke: "rgba(80, 220, 125, .95)",
          label: "rgba(186, 255, 210, .98)",
          handle: "rgba(80, 220, 125, 1)",
        },
      };
      const style = styles[boxName] || styles.hurtbox;
      ctx.save();
      ctx.globalAlpha = box.enabled === false ? 0.36 : 1;
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = (selected ? 2.5 : 1.5) * getDevicePixelRatio();
      ctx.setLineDash(selected ? [] : [7 * getDevicePixelRatio(), 5 * getDevicePixelRatio()]);
      ctx.translate(rect.centerX, rect.centerY);
      ctx.rotate(rect.rotation);
      ctx.fillRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
      ctx.strokeRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
      ctx.setLineDash([]);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = box.enabled === false ? 0.36 : 1;
      ctx.fillStyle = style.label;
      ctx.font = `${12 * getDevicePixelRatio()}px system-ui, sans-serif`;
      const label = box.enabled === false ? `${t(boxName)} preview` : t(boxName);
      ctx.fillText(label, rect.left + 6 * getDevicePixelRatio(), rect.top - 7 * getDevicePixelRatio());
      if (selected) {
        ctx.fillStyle = "#0a0a0a";
        ctx.strokeStyle = style.handle;
        for (const handle of editableBoxHandleRects(boxName, rect)) {
          ctx.fillRect(handle.x, handle.y, handle.width, handle.height);
          ctx.strokeRect(handle.x, handle.y, handle.width, handle.height);
        }
      }
      ctx.restore();
    }

    function drawBoxes() {
      if (!state().showBoxes || !canEditBoxes()) return;
      for (const boxName of boxDrawOrder.filter((name) => state().selectedBoxes.has(name))) drawBox(boxName);
    }

    function drawReferenceFrameOverlay() {
      if (!state().referenceFrame) return;
      if (state().referenceFrameHiddenByKey) return;
      const referenceImages = state().referenceFrame.images || [];
      if (!referenceImages[state().referenceFrame.index])
        referenceImages[state().referenceFrame.index] = state().referenceFrame.image;
      drawFrame(state().referenceFrame.index, 0.48, false, state().referenceFrame.group, referenceImages, {
        transform: state().referenceFrame.transform,
        alignFloor: state().referenceFrame.group?.uiId !== state().currentGroup.uiId,
      });
    }

    function canvasHintLines() {
      const lines = [];
      if (selectedFrameAttachment()) {
        lines.push({
          text: t("frameAttachmentCanvasHint"),
          active: true,
        });
      }
      if (state().referenceFrame) {
        lines.push({
          text: t("referenceFrameHideHint"),
          active: state().referenceFrameHiddenByKey,
        });
      }
      if (state().showBoxes && canEditBoxes()) {
        lines.push({
          text: t("boxEditHint"),
          active: false,
        });
      }
      return lines;
    }

    function drawCanvasHints() {
      const lines = canvasHintLines();
      if (!lines.length) return;
      const paddingX = 11 * getDevicePixelRatio();
      const paddingY = 8 * getDevicePixelRatio();
      const lineHeight = 19 * getDevicePixelRatio();
      const margin = 22 * getDevicePixelRatio();
      ctx.save();
      ctx.font = `${13 * getDevicePixelRatio()}px system-ui, "Microsoft YaHei UI", sans-serif`;
      const width = Math.max(...lines.map((line) => ctx.measureText(line.text).width)) + paddingX * 2;
      const height = paddingY * 2 + lineHeight * lines.length;
      const x = Math.max(margin, els.stage.width - width - margin);
      const y = margin;
      ctx.fillStyle = "rgba(8, 11, 13, .72)";
      ctx.strokeStyle = lines.some((line) => line.active)
        ? "rgba(255, 196, 74, .72)"
        : "rgba(145, 215, 255, .52)";
      ctx.lineWidth = Math.max(1, getDevicePixelRatio());
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.fill();
      ctx.stroke();
      ctx.textBaseline = "middle";
      lines.forEach((line, index) => {
        ctx.fillStyle = line.active ? "rgba(255, 224, 150, .95)" : "rgba(203, 238, 255, .92)";
        ctx.fillText(line.text, x + paddingX, y + paddingY + lineHeight * index + lineHeight / 2);
      });
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, els.stage.width, els.stage.height);
      drawGrid();
      if (!state().currentGroup || !state().images.length) {
        updateCoordHud();
        return;
      }
      const chain = playbackChainGroup();
      if (state().ghost && chain && chain.uiId !== state().currentGroup.uiId && state().chainImages.length) {
        drawAlignedFloorLabel(`Then group aligned to Floor top: ${chain.name}`);
        for (let i = 0; i < state().chainImages.length; i += 1) {
          if (!framePlayback(i, chain).disabled) drawFrame(i, 0.18, false, chain, state().chainImages);
        }
      }
      if (state().ghost) {
        for (let i = 0; i < state().images.length; i += 1) {
          if (
            i !== state().selectedFrame &&
            !state().selectedFrames.has(i) &&
            !isReferenceFrame(i) &&
            !framePlayback(i).disabled
          )
            drawCompositeFrame(i, 0.22, false);
        }
      }
      for (const frameIndex of selectedFrameIndexes()) {
        if (frameIndex !== state().selectedFrame && !framePlayback(frameIndex).disabled) {
          drawCompositeFrame(frameIndex, 0.72, true);
        }
      }
      drawCompositeFrame(state().selectedFrame, 1, true);
      drawReferenceFrameOverlay();
      drawBoxes();
      drawCoordinateMarkers();
      drawCanvasHints();
      updateCoordHud();
    }

    return {
      draw,
      currentFrameRect,
      effectiveFlipH,
      frameScreenRect,
      isPointInsideFrame,
      playbackNeedsContinuousDraw,
      updateCoordHud,
    };
  }

  return { createController };
});
