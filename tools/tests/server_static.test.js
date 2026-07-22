"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStaticHandler } = require("../animation_tuner/server_static");

test("static handler serves workbench routes and rejects missing files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-static-test-"));
  fs.writeFileSync(path.join(root, "index.html"), "index");
  fs.writeFileSync(path.join(root, "landing.html"), "landing");
  fs.writeFileSync(path.join(root, "app.js"), "script");
  const responses = [];
  const handler = createStaticHandler({
    publicRoot: root,
    workbenchRoutes: new Set(["/workspace", "/tools/organizer"]),
    safeResolve: (base, requested) => {
      const resolved = path.resolve(base, requested);
      return resolved === base || resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
    },
    send: (_response, status, body, contentType) => {
      responses.push({ status, body: body.toString(), contentType });
      return true;
    },
  });

  handler({}, {}, "/");
  handler({}, {}, "/workspace");
  handler({}, {}, "/tools/organizer");
  handler({}, {}, "/app.js");
  handler({}, {}, "/missing.js");
  assert.deepEqual(responses, [
    { status: 200, body: "landing", contentType: "text/html" },
    { status: 200, body: "index", contentType: "text/html" },
    { status: 200, body: "index", contentType: "text/html" },
    { status: 200, body: "script", contentType: "application/javascript" },
    { status: 404, body: "Not found", contentType: "text/plain" },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});
