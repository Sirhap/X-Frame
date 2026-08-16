const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeContract, validateContract } = require("../animation_production_contract");

test("normalizes motion into one clip and applies safe defaults", () => {
  const result = normalizeContract(
    {
      version: 1,
      projectRoot: "/tmp/game",
      profile: "Hero One",
      motion: {
        id: "run",
        source: { kind: "png-sequence", path: "frames/run" },
        frameCount: 8,
      },
    },
    { baseDir: "/tmp/job" },
  );

  assert.equal(result.profile, "Hero_One");
  assert.equal(result.clips[0].id, "run");
  assert.equal(result.clips[0].fps, 12);
  assert.equal(result.clips[0].anchor, "canvas_bottom_center");
  assert.equal(result.clips[0].replace, false);
  assert.equal(result.clips[0].source.path, "/tmp/job/frames/run");
});

test("rejects unsafe or incomplete contracts", () => {
  const result = validateContract(
    {
      version: 2,
      projectRoot: "",
      profile: "",
      clips: [{ id: "", source: { kind: "png-sequence", path: "" }, fps: 0 }],
    },
    { baseDir: "/tmp/job" },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /version|projectRoot|profile|clip|fps|source/i);
});

test("marks non-PNG media as browser-required instead of pretending it is importable", () => {
  const result = normalizeContract(
    {
      version: 1,
      projectRoot: "/tmp/game",
      profile: "hero",
      clips: [{ id: "intro", source: { kind: "video", path: "intro.mov" }, frameCount: 24 }],
    },
    { baseDir: "/tmp/job" },
  );

  assert.equal(result.clips[0].execution, "browser-required");
});

test("rejects an invalid declared frame count instead of dropping it", () => {
  const result = validateContract(
    {
      version: 1,
      projectRoot: "/tmp/game",
      profile: "hero",
      clips: [{ id: "idle", source: { kind: "png-sequence", path: "frames/idle" }, frameCount: 0 }],
    },
    { baseDir: "/tmp/job" },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /frameCount/);
});
