const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SKILL_ROOT = path.resolve(__dirname, "../../skills/xsxb-animation-production");

test("production skill documents both media routes and the deterministic CLI boundary", () => {
  const skillPath = path.join(SKILL_ROOT, "SKILL.md");
  assert.equal(fs.existsSync(skillPath), true, "new production skill must exist");
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /supplied|existing media/i);
  assert.match(skill, /generate|no (?:usable )?frames|without (?:source|media)/i);
  assert.match(skill, /animation-constraints\.json/);
  assert.match(skill, /tools\/animation_production_workflow\.js/);
  assert.match(skill, /xsxb-frame-tuner/);
  assert.match(skill, /strict|require-gameplay/);
  assert.doesNotMatch(skill, /TODO|TBD/);
});

test("production skill includes the compact contract reference", () => {
  const referencePath = path.join(SKILL_ROOT, "references", "animation-contract.md");
  assert.equal(fs.existsSync(referencePath), true, "contract reference must exist");
  const reference = fs.readFileSync(referencePath, "utf8");

  assert.match(reference, /version/i);
  assert.match(reference, /frameCount/i);
  assert.match(reference, /rootMotion/i);
  assert.match(reference, /canvas_bottom_center/);
});
