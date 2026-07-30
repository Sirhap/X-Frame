(function attachBatchCutoutGesturePreview(root) {
  "use strict";

  const MAX_PREVIEW_POINTS = 512;

  /**
   * Reduces a long stroke to a bounded set of points for live painting.
   * The committed repair keeps every sampled point; this only protects the
   * animation-frame preview from becoming quadratic during a fast drag.
   * @param {Array<{x:number,y:number}>} points Source-space stroke points.
   * @returns {Array<{x:number,y:number}>} Preview points with preserved endpoints.
   */
  function previewGesturePoints(points) {
    if (points.length <= MAX_PREVIEW_POINTS) return points;
    const previewPoints = [];
    const interval = (points.length - 1) / (MAX_PREVIEW_POINTS - 1);
    for (let index = 0; index < MAX_PREVIEW_POINTS; index += 1) {
      previewPoints.push(points[Math.round(index * interval)]);
    }
    return previewPoints;
  }

  /**
   * Converts a source-space point into the current result-canvas view.
   * @param {{x:number,y:number}} point Source-image point.
   * @param {{scale:number,offsetX:number,offsetY:number}} view Preview transform.
   * @returns {{x:number,y:number}} Result-canvas point.
   */
  function previewBrushPoint(point, view) {
    return {
      x: view.offsetX + point.x * view.scale,
      y: view.offsetY + point.y * view.scale,
    };
  }

  /**
   * Iterates interpolated display-space brush stamps for a gesture.
   * @param {Array<{x:number,y:number}>} points Source-space stroke points.
   * @param {{scale:number,offsetX:number,offsetY:number}} view Preview transform.
   * @param {number} radius Display-space brush radius.
   * @param {(point:{x:number,y:number}) => void} callback Stamp callback.
   * @returns {void}
   */
  function forEachBrushPreviewStamp(points, view, radius, callback) {
    if (!points.length) return;
    const displayPoints = previewGesturePoints(points).map((point) => previewBrushPoint(point, view));
    const stepSize = Math.max(1, radius * 0.35);
    callback(displayPoints[0]);
    for (let index = 1; index < displayPoints.length; index += 1) {
      const previous = displayPoints[index - 1];
      const current = displayPoints[index];
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      const steps = Math.max(1, Math.ceil(distance / stepSize));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        callback({
          x: previous.x + (current.x - previous.x) * progress,
          y: previous.y + (current.y - previous.y) * progress,
        });
      }
    }
  }

  /**
   * Paints one soft brush stamp into the live gesture preview.
   * @param {CanvasRenderingContext2D} context Result-canvas context.
   * @param {{x:number,y:number}} point Display-space stamp point.
   * @param {number} radius Display-space radius.
   * @param {number} hardness Brush hardness from 0 to 1.
   * @param {number} opacity Brush opacity from 0 to 1.
   * @param {{r:number,g:number,b:number}} color Brush color.
   * @returns {void}
   */
  function drawBrushPreviewStamp(context, point, radius, hardness, opacity, color) {
    const brushRadius = Math.max(0.5, radius);
    const hardStop = Math.max(0, Math.min(0.999, hardness));
    const colorText = `${color.r},${color.g},${color.b}`;
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, brushRadius);
    gradient.addColorStop(0, `rgba(${colorText}, ${opacity})`);
    if (hardStop > 0) gradient.addColorStop(hardStop, `rgba(${colorText}, ${opacity})`);
    gradient.addColorStop(1, `rgba(${colorText}, 0)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.x, point.y, brushRadius, 0, Math.PI * 2);
    context.fill();
  }

  /**
   * Draws a source-restore gesture using the original image as a clipped overlay.
   * @param {CanvasRenderingContext2D} context Result-canvas context.
   * @param {object} item Selected queue item.
   * @param {Array<{x:number,y:number}>} points Source-space stroke points.
   * @param {{scale:number,offsetX:number,offsetY:number,sourceWidth:number,sourceHeight:number}} view Preview transform.
   * @param {number} radius Display-space brush radius.
   * @param {number} opacity Brush opacity from 0 to 1.
   * @returns {void}
   */
  function drawRestoreSourcePreview(context, item, points, view, radius, opacity) {
    if (!item.sourceCanvas || !points.length) return;
    context.save();
    context.globalAlpha = opacity;
    context.beginPath();
    forEachBrushPreviewStamp(points, view, radius, (point) => {
      context.moveTo(point.x + radius, point.y);
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    });
    context.clip();
    context.drawImage(
      item.sourceCanvas,
      view.offsetX,
      view.offsetY,
      view.sourceWidth * view.scale,
      view.sourceHeight * view.scale,
    );
    context.restore();
  }

  /**
   * Clamps a canvas pointer to the source-image edge so a stroke can enter from
   * the checkerboard or navigation affordance and continue into the image.
   * @param {PointerEvent} event Pointer event from the result canvas.
   * @param {HTMLCanvasElement} target Result canvas.
   * @returns {{canvasX:number,canvasY:number,sourceX:number,sourceY:number}|null} Clamped source point.
   */
  function clampPointerPoint(event, target) {
    const view = target?._cutoutView;
    if (!view || !view.scale) return null;
    const rect = target.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * target.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * target.height;
    return {
      canvasX,
      canvasY,
      sourceX: Math.max(0, Math.min(view.sourceWidth, (canvasX - view.offsetX) / view.scale)),
      sourceY: Math.max(0, Math.min(view.sourceHeight, (canvasY - view.offsetY) / view.scale)),
    };
  }

  /**
   * Commits points already collected before the browser cancels or releases capture.
   * @param {HTMLCanvasElement} target Result canvas receiving the gesture.
   * @param {PointerEvent} event Capture-loss event.
   * @returns {void}
   */
  function commitLostPointer(target, event) {
    const PointerEventConstructor = root.PointerEvent;
    if (!target || typeof PointerEventConstructor !== "function" || !Number.isFinite(event?.pointerId))
      return;
    target.dispatchEvent(
      new PointerEventConstructor("pointerup", {
        bubbles: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        buttons: 0,
      }),
    );
  }

  /**
   * Draws a live brush-family gesture on top of a captured result frame.
   * @param {object} options Gesture preview options.
   * @param {CanvasRenderingContext2D} options.context Result-canvas context.
   * @param {object} options.item Selected queue item.
   * @param {{points:Array<{x:number,y:number}>}} options.drag Active gesture.
   * @param {{scale:number,offsetX:number,offsetY:number,sourceWidth:number,sourceHeight:number}} options.view Preview transform.
   * @param {"brush"|"eraser"|"restore-source"} options.mode Active brush-family mode.
   * @param {object} options.controls Brush control elements.
   * @returns {void}
   */
  function draw(options) {
    const { context, item, drag, view, mode, controls } = options;
    if (
      !context ||
      !item ||
      !drag ||
      !view ||
      !drag.points?.length ||
      !["brush", "eraser", "restore-source"].includes(mode)
    )
      return;
    const size = Number(controls.cutoutBrushSize.value) || 1;
    const hardness = Number(controls.cutoutBrushHardness.value) || 0;
    const opacity = Number(controls.cutoutBrushOpacity.value) || 0;
    const colorHex = controls.cutoutBrushColor.value || "#00c800";
    const color = {
      r: Number.parseInt(colorHex.slice(1, 3), 16) || 0,
      g: Number.parseInt(colorHex.slice(3, 5), 16) || 0,
      b: Number.parseInt(colorHex.slice(5, 7), 16) || 0,
    };
    const radius = Math.max(0.5, (Math.max(1, size) / 2) * view.scale);
    const normalizedHardness = Math.max(0, Math.min(1, hardness / 100));
    const normalizedOpacity = Math.max(0, Math.min(1, opacity / 100));
    if (mode === "restore-source") {
      drawRestoreSourcePreview(context, item, drag.points, view, radius, normalizedOpacity);
      return;
    }
    context.save();
    if (mode === "eraser") context.globalCompositeOperation = "destination-out";
    forEachBrushPreviewStamp(drag.points, view, radius, (point) => {
      drawBrushPreviewStamp(context, point, radius, normalizedHardness, normalizedOpacity, color);
    });
    context.restore();
  }

  root.BatchCutoutGesturePreview = Object.freeze({ clampPointerPoint, commitLostPointer, draw });
})(globalThis);
