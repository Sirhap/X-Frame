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
  fs.writeFileSync(path.join(root, "favicon.ico"), "icon");
  fs.mkdirSync(path.join(root, "assets", "landing"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "landing", "hero.webp"), "webp");
  const responses = [];
  const handler = createStaticHandler({
    publicRoot: root,
    workbenchRoutes: new Set(["/workspace", "/tools/organizer", "/tools/scatter-slice"]),
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
  handler({}, {}, "/tools/scatter-slice");
  handler({}, {}, "/favicon.ico");
  handler({}, {}, "/assets/landing/hero.webp");
  handler({}, {}, "/missing.js");
  assert.deepEqual(responses, [
    { status: 200, body: "landing", contentType: "text/html" },
    { status: 200, body: "index", contentType: "text/html" },
    { status: 200, body: "index", contentType: "text/html" },
    { status: 200, body: "script", contentType: "application/javascript" },
    { status: 200, body: "index", contentType: "text/html" },
    { status: 200, body: "icon", contentType: "image/x-icon" },
    { status: 200, body: "webp", contentType: "image/webp" },
    { status: 404, body: "Not found", contentType: "text/plain" },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("static handler maps the project entry route directly to the workbench document", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-project-route-test-"));
  fs.writeFileSync(path.join(root, "index.html"), "workbench");
  const responses = [];
  const handler = createStaticHandler({
    publicRoot: root,
    workbenchRoutes: new Set(["/projects"]),
    safeResolve: (base, requested) => path.resolve(base, requested),
    send: (_response, status, body) => {
      responses.push({ status, body: body.toString() });
      return true;
    },
  });

  handler({}, {}, "/projects");
  assert.deepEqual(responses, [{ status: 200, body: "workbench" }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("static handler supports a dedicated factory homepage without changing workbench routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-factory-static-test-"));
  fs.writeFileSync(path.join(root, "animation_factory.html"), "factory");
  fs.writeFileSync(path.join(root, "index.html"), "workbench");
  const responses = [];
  const handler = createStaticHandler({
    publicRoot: root,
    workbenchRoutes: new Set(["/workspace"]),
    landingDocument: "animation_factory.html",
    safeResolve: (base, requested) => path.resolve(base, requested),
    send: (_response, status, body) => {
      responses.push({ status, body: body.toString() });
      return true;
    },
  });

  handler({}, {}, "/");
  handler({}, {}, "/workspace");

  assert.deepEqual(responses, [
    { status: 200, body: "factory" },
    { status: 200, body: "workbench" },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("static handler maps dedicated documents without treating them as workbench routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-document-static-test-"));
  fs.writeFileSync(path.join(root, "admin.html"), "admin");
  fs.writeFileSync(path.join(root, "watermark_studio.html"), "watermark");
  const responses = [];
  const handler = createStaticHandler({
    publicRoot: root,
    workbenchRoutes: new Set(),
    documentRoutes: {
      "/admin/licenses": "admin.html",
      "/tools/watermark": "watermark_studio.html",
    },
    safeResolve: (base, requested) => path.resolve(base, requested),
    send: (_response, status, body) => {
      responses.push({ status, body: body.toString() });
      return true;
    },
  });

  handler({}, {}, "/admin/licenses");
  handler({}, {}, "/tools/watermark");

  assert.deepEqual(responses, [
    { status: 200, body: "admin" },
    { status: 200, body: "watermark" },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});
