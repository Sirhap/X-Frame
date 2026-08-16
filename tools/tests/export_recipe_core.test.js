"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PRESETS,
  createDefaultRecipe,
  normalizeRecipe,
} = require("../animation_tuner/public/export_recipe_core");

test("export recipes are transient, bounded, and preserve valid transform values", () => {
  const recipe = normalizeRecipe({
    width: 10000,
    height: 0,
    padding: 0,
    alphaThreshold: 0,
    speed: 4,
    scaleX: 450,
    scaleY: 75,
    offsetX: -42,
  });
  assert.equal(recipe.width, 8192);
  assert.equal(recipe.height, 1);
  assert.equal(recipe.padding, 0);
  assert.equal(recipe.alphaThreshold, 0);
  assert.equal(recipe.speed, 2);
  assert.equal(recipe.scaleX, 300);
  assert.equal(recipe.scaleY, 75);
  assert.equal(recipe.offsetX, -42);
  assert.equal(createDefaultRecipe().canvasMode, "union");
  assert.equal(PRESETS.socialMp4.background, "color");
});
