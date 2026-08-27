const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_canvas_renderer");

test("canvas renderer computes frame rectangles through injected transforms", () => {
  const image = { width: 10, height: 20 };
  const group = { uiId: "main", type: "animation", frames: [image] };
  const controller = createController({
    context: {},
    elements: { stage: { width: 100, height: 100 } },
    getState: () => ({
      view: { zoom: 1 },
      currentGroup: group,
      images: [image],
      selectedFrame: 0,
    }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    runtimeBaseScaleForGroup: () => 1,
    groupOriginScreen: () => ({ x: 50, y: 50 }),
    usesRuntimeFootAnchor: () => false,
    usesSceneTopLeftAnchor: () => false,
    getDevicePixelRatio: () => 1,
  });

  assert.deepEqual(controller.currentFrameRect(), {
    x: 45,
    y: 40,
    originX: 50,
    originY: 50,
    width: 10,
    height: 20,
  });
});

test("current-origin label sits below the crosshair instead of over the sprite", () => {
  const { coordinateMarkerLabelOffset } = require("../animation_tuner/public/app_canvas_renderer");
  const offset = coordinateMarkerLabelOffset(1);
  assert.ok(offset.y > 0, "label must be drawn below the marker");
  assert.equal(offset.baseline, "top");
});

/**
 * Records canvas overlay drawing so tests can assert tick placement and caption size.
 * @returns {{context:object,texts:Array<object>,rects:Array<object>}} Recording surface.
 */
function createOverlayRecorder() {
  const texts = [];
  const rects = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "12px sans-serif",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    rect(x, y, w, h) {
      rects.push({ x, y, w, h, font: this.font });
    },
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    translate() {},
    rotate() {},
    setLineDash() {},
    drawImage() {},
    measureText(text) {
      const value = String(text);
      const wide = (value.match(/[\u3400-\u9fff]/g) || []).length;
      return { width: wide * 10 + (value.length - wide) * 6 };
    },
    fillText(text, x, y) {
      texts.push({ text: String(text), x, y, font: this.font });
    },
  };
  return { context, texts, rects };
}

/**
 * @param {number} dpr Device pixel ratio.
 * @returns {number} Parsed px size from a canvas font string.
 */
function fontPx(font) {
  return Number((String(font).match(/(\d+(?:\.\d+)?)px/) || [])[1] || 0);
}

test("preview tick numbers hug the canvas edges instead of covering the sprite origin", () => {
  const { createController, CANVAS_OVERLAY } = require("../animation_tuner/public/app_canvas_renderer");
  const { context, texts } = createOverlayRecorder();
  const origin = { x: 400, y: 300 };
  const image = { width: 40, height: 80 };
  const group = { uiId: "main", type: "animation", frames: [image] };
  const controller = createController({
    context,
    elements: { stage: { width: 800, height: 600 } },
    getState: () => ({
      view: { x: origin.x, y: origin.y, zoom: 1 },
      currentGroup: group,
      images: [image],
      selectedFrame: 0,
      selectedFrames: new Set([0]),
      showBoxes: false,
      ghost: false,
    }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    groupOriginScreen: () => origin,
    coordinateOrigin: () => origin,
    coordinateScreenScale: () => 1,
    coordinateGridStep: () => 100,
    coordinateToScreen: (point) => ({
      x: origin.x + Number(point?.x || 0),
      y: origin.y + Number(point?.y || 0),
    }),
    floorTopReferenceOffset: () => 0,
    floorReferenceLabel: () => "Floor top",
    nearlyEqual: (left, right) => Math.abs(Number(left) - Number(right)) < 0.001,
    round: (value) => Math.round(value),
    usesRuntimeFootAnchor: () => false,
    usesSceneTopLeftAnchor: () => false,
    selectedFrameIndexes: () => [0],
    framePlayback: () => ({ disabled: false }),
    isReferenceFrame: () => false,
    playbackChainGroup: () => null,
    canEditBoxes: () => false,
    selectedFrameAttachment: () => null,
    getDevicePixelRatio: () => 1,
  });

  controller.draw();
  const ticks = texts.filter((item) => /^-?\d+$/.test(item.text));
  assert.ok(ticks.length > 0, "grid should label at least one tick");
  const inset = CANVAS_OVERLAY.axisInsetPx + CANVAS_OVERLAY.gridFontPx + 4;
  for (const tick of ticks) {
    assert.ok(
      tick.y <= inset || tick.x <= inset,
      `${tick.text} at ${tick.x},${tick.y} should sit on a canvas edge, not the sprite at ${origin.x},${origin.y}`,
    );
  }
});

test("preview overlay captions stay compact so the sprite stays readable", () => {
  const { createController, CANVAS_OVERLAY } = require("../animation_tuner/public/app_canvas_renderer");
  const { context, texts, rects } = createOverlayRecorder();
  const origin = { x: 400, y: 300 };
  const image = { width: 40, height: 80 };
  const group = { uiId: "main", type: "animation", frames: [image] };
  const hint = "拖动手柄改大小，拖动框体移动；方向键微调";
  const controller = createController({
    context,
    elements: { stage: { width: 800, height: 600 } },
    getState: () => ({
      view: { x: origin.x, y: origin.y, zoom: 1 },
      currentGroup: group,
      images: [image],
      selectedFrame: 0,
      selectedFrames: new Set([0]),
      showBoxes: true,
      ghost: false,
    }),
    frameTransform: () => ({ scale: 1, scaleX: 1, scaleY: 1, offset: { x: 0, y: 0 }, rotation: 0 }),
    renderTransformForGroup: (transform) => transform,
    runtimeBaseScaleForGroup: () => 1,
    groupOriginScreen: () => origin,
    coordinateOrigin: () => origin,
    coordinateScreenScale: () => 1,
    coordinateGridStep: () => 100,
    coordinateToScreen: (point) => ({
      x: origin.x + Number(point?.x || 0),
      y: origin.y + Number(point?.y || 0),
    }),
    floorTopReferenceOffset: () => 0,
    floorReferenceLabel: () => "Floor top",
    nearlyEqual: (left, right) => Math.abs(Number(left) - Number(right)) < 0.001,
    round: (value) => Math.round(value),
    usesRuntimeFootAnchor: () => false,
    usesSceneTopLeftAnchor: () => false,
    selectedFrameIndexes: () => [0],
    framePlayback: () => ({ disabled: false }),
    isReferenceFrame: () => false,
    playbackChainGroup: () => null,
    canEditBoxes: () => true,
    selectedFrameAttachment: () => null,
    t: (key) => (key === "boxEditHint" ? hint : key),
    getDevicePixelRatio: () => 1,
  });

  controller.draw();
  assert.equal(CANVAS_OVERLAY.gridFontPx, 8);
  assert.equal(CANVAS_OVERLAY.hintFontPx, 10);
  assert.ok(CANVAS_OVERLAY.hintMaxWidthPx <= 168);
  const overlayFonts = texts.map((item) => fontPx(item.font));
  assert.ok(overlayFonts.length > 0);
  assert.ok(
    Math.max(...overlayFonts) <= CANVAS_OVERLAY.hintFontPx,
    `overlay font ${Math.max(...overlayFonts)}px should stay <= ${CANVAS_OVERLAY.hintFontPx}px`,
  );
  const hintLines = texts.filter((item) => /拖动手柄|拖动框体|方向键/.test(item.text));
  assert.ok(hintLines.length >= 2, "long canvas hint should wrap instead of one wide line");
  assert.ok(hintLines.every((item) => item.text.length < hint.length));
  const hintBox = rects.at(-1);
  assert.ok(hintBox, "hint should paint a compact card");
  assert.ok(
    hintBox.w <= CANVAS_OVERLAY.hintMaxWidthPx + CANVAS_OVERLAY.hintPadXPx * 2,
    `hint card width ${hintBox.w} should stay within ${CANVAS_OVERLAY.hintMaxWidthPx}px`,
  );
});
