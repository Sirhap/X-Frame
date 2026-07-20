const assert = require("node:assert/strict");
const test = require("node:test");

const { createController } = require("../animation_tuner/public/app_update");

function createElements() {
  return {
    updatePanel: { hidden: true, classList: { toggle() {} } },
    updateMessage: { textContent: "" },
    updateButton: { disabled: false },
    updateVersion: { textContent: "" },
  };
}

function translate(key, variables = {}) {
  return `${key}:${variables.message || ""}`;
}

test("update controller renders available update state and checks status", async () => {
  const elements = createElements();
  let request;
  const controller = createController({
    elements,
    translate,
    now: () => 42,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            updateAvailable: true,
            currentCommit: "123456789",
            latestCommit: "abcdefghi",
            canUpdate: true,
            token: "token-1",
            blockReason: "",
          };
        },
      };
    },
  });

  assert.equal(await controller.check(), true);
  assert.deepEqual(request, {
    url: "/api/update-status?opened=42",
    options: { cache: "no-store" },
  });
  assert.equal(elements.updatePanel.hidden, false);
  assert.equal(elements.updateVersion.textContent, "1234567 → abcdefg");
  assert.equal(controller.getState().token, "token-1");
});

test("update controller blocks installation while edits are dirty", async () => {
  const elements = createElements();
  let dirty = true;
  let fetchCalls = 0;
  const controller = createController({
    elements,
    getDirty: () => dirty,
    translate,
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { updateAvailable: true, canUpdate: true, token: "token-1" };
        },
      };
    },
  });

  await controller.check();
  assert.equal(await controller.install(), false);
  assert.equal(fetchCalls, 1);
  assert.equal(elements.updateMessage.textContent, "updateSaveFirst:");

  dirty = false;
});

test("update controller handles successful install and server reconnect", async () => {
  const elements = createElements();
  let clock = 0;
  let reloads = 0;
  const requests = [];
  const controller = createController({
    elements,
    translate,
    now: () => clock,
    sleep: async () => {
      clock += 1;
    },
    reload: () => {
      reloads += 1;
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/update") {
        return {
          ok: true,
          async json() {
            return { ok: true, update: { currentCommit: "new-commit" } };
          },
        };
      }
      if (url.includes("reconnect")) {
        return {
          ok: true,
          async json() {
            return { restarting: false, currentCommit: "new-commit" };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { updateAvailable: true, canUpdate: true, token: "token-1", latestCommit: "new-commit" };
        },
      };
    },
  });

  await controller.check();
  assert.equal(await controller.install(), true);
  assert.equal(reloads, 1);
  assert.equal(controller.getState().phase, "restarting");
  assert.equal(requests[1].options.headers["x-xsxb-update-token"], "token-1");
});

test("update controller records failed install without throwing", async () => {
  const controller = createController({
    elements: createElements(),
    translate,
    fetchImpl: async (url) => {
      if (url.includes("update-status")) {
        return {
          ok: true,
          async json() {
            return { updateAvailable: true, canUpdate: true, token: "token-1" };
          },
        };
      }
      return {
        ok: false,
        status: 409,
        async json() {
          return { ok: false, error: "conflict" };
        },
      };
    },
  });

  await controller.check();
  assert.equal(await controller.install(), false);
  assert.equal(controller.getState().phase, "failed:conflict");
});
