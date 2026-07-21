"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { copyArtifactTree, validateBuildId } = require("../algorithm_protection/release_store");

test("protected release ids reject path injection", () => {
  assert.equal(validateBuildId("0123456789abcdefabcd"), "0123456789abcdefabcd");
  assert.throws(() => validateBuildId("../dist"), /Invalid protected build id/);
  assert.throws(() => validateBuildId("0123456789ABCDEFABCD"), /Invalid protected build id/);
});

test("artifact release copies retain bytes and refuse overwrites", (context) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-release-store-"));
  context.after(() => fs.rmSync(temporaryRoot, { force: true, recursive: true }));
  const source = path.join(temporaryRoot, "source");
  const destination = path.join(temporaryRoot, "destination");
  fs.mkdirSync(path.join(source, "assets"), { recursive: true });
  fs.writeFileSync(path.join(source, "index.html"), "<main></main>");
  fs.writeFileSync(path.join(source, "assets", "engine.wasm"), Buffer.from([0, 97, 115, 109]));

  copyArtifactTree(source, destination);
  assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), "<main></main>");
  assert.deepEqual(
    fs.readFileSync(path.join(destination, "assets", "engine.wasm")),
    Buffer.from([0, 97, 115, 109]),
  );
  assert.throws(() => copyArtifactTree(source, destination), /exist/i);
});
