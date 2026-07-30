"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const geometry = require("../animation_tuner/public/cutout_tracking_geometry_core.js");
const tracking = require("../animation_tuner/public/cutout_tracking_core.js");

test("tracking core forwards geometry helpers without changing its public API", () => {
  for (const name of [
    "mapCanvasBrushStroke",
    "mapCanvasPoint",
    "mapCanvasRectangle",
    "mapBrushStroke",
    "mapPoint",
    "mapRectangle",
  ]) {
    assert.strictEqual(tracking[name], geometry[name]);
  }
});

test("geometry helpers preserve normalized canvas and PCA mappings", () => {
  assert.deepEqual(
    geometry.mapCanvasPoint({ x: 25, y: 50 }, { width: 100, height: 100 }, { width: 200, height: 50 }),
    { x: 50, y: 25 },
  );
  assert.deepEqual(
    geometry.mapCanvasRectangle(
      { x1: 20, y1: 10, x2: 80, y2: 90 },
      { width: 100, height: 100 },
      { width: 200, height: 50 },
    ),
    { x1: 40, y1: 5, x2: 160, y2: 45 },
  );

  const descriptor = {
    center: { x: 50, y: 50 },
    majorAxis: { x: 1, y: 0 },
    minorAxis: { x: 0, y: 1 },
    majorLength: 40,
    minorLength: 20,
    width: 100,
    height: 100,
  };
  assert.deepEqual(geometry.mapPoint({ x: 70, y: 40 }, descriptor, descriptor), { x: 70, y: 40 });
});
