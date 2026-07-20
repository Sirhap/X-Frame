const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_filmstrip_interaction");

test("filmstrip rendering clears the tray and renders the active chain", () => {
  const filmstrip = { innerHTML: "stale" };
  const group = { uiId: "main", frames: [] };
  const chain = { uiId: "chain", frames: [] };
  const rendered = [];
  let trayCalls = 0;
  const controller = createController({
    elements: { filmstrip },
    state: { getCurrentGroup: () => group },
    handlers: {
      renderAttachmentAssetTray: () => {
        trayCalls += 1;
      },
      getPlaybackChainGroup: () => chain,
      renderFilmstripGroup: (renderedGroup, label) => rendered.push([renderedGroup, label]),
    },
    utils: { translate: (key) => key },
  });

  controller.renderFilmstrip();

  assert.equal(filmstrip.innerHTML, "");
  assert.equal(trayCalls, 1);
  assert.deepEqual(rendered, [
    [group, "mainLabel"],
    [chain, "thenLabel"],
  ]);
});
