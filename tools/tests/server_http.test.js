"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createHttpUtilities } = require("../animation_tuner/server_http");

/** @returns {ReturnType<typeof createHttpUtilities>} HTTP test utilities. */
function createFixture() {
  return createHttpUtilities({
    port: 5179,
    mediaRoutes: new Set(["/api/media"]),
    defaultBodyLimit: 16,
    saveBodyLimit: 32,
    mediaBodyLimit: 64,
    logger: { error() {} },
  });
}

/**
 * Creates an event-driven request fixture.
 * @param {Record<string,string>} headers Request headers.
 * @returns {EventEmitter & {headers:Record<string,string>,resume:()=>void}}
 */
function createRequest(headers = {}) {
  return Object.assign(new EventEmitter(), { headers, resume() {} });
}

test("HTTP utilities enforce JSON content type and local origins", () => {
  const { HttpError, validateWriteRequest } = createFixture();
  assert.throws(
    () => validateWriteRequest(createRequest({ "content-type": "text/plain" })),
    (error) => error instanceof HttpError && error.status === 415,
  );
  assert.throws(
    () =>
      validateWriteRequest(
        createRequest({ "content-type": "application/json", origin: "https://example.com" }),
      ),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.doesNotThrow(() =>
    validateWriteRequest(
      createRequest({ "content-type": "application/json; charset=utf-8", origin: "http://127.0.0.1:5179" }),
    ),
  );
});

test("HTTP utilities parse bounded JSON object bodies", async () => {
  const { readJsonBody } = createFixture();
  const request = createRequest({ "content-length": "12" });
  const result = readJsonBody(request, "/api/default");
  request.emit("data", Buffer.from('{"ok":true}'));
  request.emit("end");
  assert.deepEqual(await result, { ok: true });

  const oversized = createRequest({ "content-length": "17" });
  await assert.rejects(readJsonBody(oversized, "/api/default"), (error) => error.status === 413);
});

test("HTTP utilities serialize JSON responses with no-store headers", () => {
  const { send } = createFixture();
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };

  assert.equal(send(response, 200, { ok: true }), true);
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(response.body.toString("utf8")), { ok: true });
});
