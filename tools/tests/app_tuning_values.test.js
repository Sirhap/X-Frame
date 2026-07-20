const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_tuning_values");

test("tuning collectors preserve profile deduplication and target-specific keys", () => {
  const config = {
    groups: [
      {
        profileId: "hero",
        scale: "heroScale",
        characterScale: "characterScale",
        characterOffset: "characterOffset",
      },
      {
        profileId: "hero",
        scale: "heroScale2",
        characterScale: "characterScaleDuplicate",
      },
      { tuningTarget: "boss", scale: "bossScale", offset: "bossOffset" },
      { tuningTarget: "soul", scale: "soulScale", anchor: "soulAnchor" },
    ],
  };
  const controller = createController({
    getConfig: () => config,
    getValues: () => ({
      heroScale: 1,
      heroScale2: 2,
      characterScale: 3,
      characterScaleDuplicate: 4,
      characterOffset: { x: 5, y: 6 },
    }),
    getBossValues: () => ({ bossScale: 7, bossOffset: { x: 8, y: 9 } }),
    getSoulValues: () => ({ soulScale: 10, soulAnchor: 11 }),
  });

  assert.deepEqual(controller.collectTuningValues(), {
    characterScale: 3,
    characterOffset: { x: 5, y: 6 },
    heroScale: 1,
    heroScale2: 2,
  });
  assert.deepEqual(controller.collectBossTuningValues(), {
    bossOffset: { x: 8, y: 9 },
    bossScale: 7,
  });
  assert.deepEqual(controller.collectSoulTuningValues(), { soulAnchor: 11, soulScale: 10 });
  assert.deepEqual(controller.collectAct2StatueBossTuningValues(), {});
});
