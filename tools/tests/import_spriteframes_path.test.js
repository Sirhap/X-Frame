"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveGodotPath } = require("../import_spriteframes");

test("SpriteFrames path resolver keeps res:// and absolute paths inside the Godot root", () => {
  const projectRoot = path.join(os.tmpdir(), "xsxb-godot-root");
  const owner = path.join(projectRoot, "sprites", "hero.spriteframes.tres");
  assert.equal(
    resolveGodotPath("res://sprites/idle.png", projectRoot, owner),
    path.resolve(projectRoot, "sprites/idle.png"),
  );
  assert.equal(resolveGodotPath("res://../../secret.png", projectRoot, owner), null);
  assert.equal(resolveGodotPath(path.join(os.tmpdir(), "outside.png"), projectRoot, owner), null);
  assert.equal(resolveGodotPath("../idle.png", projectRoot, owner), path.resolve(projectRoot, "idle.png"));
  assert.equal(resolveGodotPath("../../outside.png", projectRoot, owner), null);
});
