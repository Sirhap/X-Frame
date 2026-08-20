"use strict";

const fs = require("node:fs");

/** HTTP-safe application error carrying a response status. */
class HttpError extends Error {
  /**
   * @param {number} status HTTP status.
   * @param {string} message User-facing error message.
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Creates bounded JSON request and response utilities for the local server.
 * @param {{port:number,mediaRoutes:Set<string>,defaultBodyLimit:number,saveBodyLimit:number,mediaBodyLimit:number,logger?:Console}} options Server limits and origin policy.
 * @returns {{HttpError:typeof HttpError,send:Function,validateWriteRequest:Function,readJsonBody:Function}}
 */
function createHttpUtilities(options) {
  if (!options || !Number.isFinite(Number(options.port)) || !(options.mediaRoutes instanceof Set)) {
    throw new TypeError("HTTP utility options are required.");
  }
  const port = Number(options.port);
  const logger = options.logger || console;

  /**
   * Sends one response unless the connection is already closed.
   * @param {import("node:http").ServerResponse} response HTTP response.
   * @param {number} status HTTP status.
   * @param {unknown} body Response body.
   * @param {string} [contentType] Content type.
   * @returns {boolean} Whether sending completed.
   */
  function send(response, status, body, contentType = "application/json") {
    if (response.destroyed || response.writableEnded) return false;
    const data = Buffer.isBuffer(body)
      ? body
      : contentType === "application/json"
        ? Buffer.from(JSON.stringify(body, null, 2))
        : Buffer.from(String(body));
    try {
      if (!response.headersSent) {
        response.writeHead(status, {
          "content-type": contentType,
          "cache-control": "no-store",
        });
      }
      response.end(data);
      return true;
    } catch (error) {
      logger.error("Failed to send HTTP response:", error);
      if (!response.destroyed) response.destroy();
      return false;
    }
  }

  /** @param {string} pathname Request path. @returns {number} Maximum body bytes. */
  function requestBodyLimit(pathname) {
    if (options.mediaRoutes.has(pathname)) return options.mediaBodyLimit;
    if (pathname === "/api/save" || pathname === "/api/frame-audio") return options.saveBodyLimit;
    return options.defaultBodyLimit;
  }

  /**
   * Rejects cross-origin browser writes while preserving Origin-less CLI calls.
   * @param {import("node:http").IncomingMessage} request HTTP request.
   * @returns {void}
   */
  function validateWriteRequest(request) {
    const contentType = String(request.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new HttpError(415, "Expected Content-Type: application/json.");
    }
    const origin = String(request.headers.origin || "").trim();
    if (!origin) return;
    const requestHost = String(request.headers.host || "")
      .trim()
      .toLowerCase();
    const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const localOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (!localHosts.has(requestHost) || !localOrigins.has(origin)) {
      throw new HttpError(403, "Cross-origin API writes are not allowed.");
    }
  }

  /**
   * Reads one bounded UTF-8 request body.
   * @param {import("node:http").IncomingMessage} request HTTP request.
   * @param {number} limit Maximum bytes.
   * @returns {Promise<string>}
   */
  function readBody(request, limit) {
    return new Promise((resolve, reject) => {
      const declaredLength = Number(request.headers["content-length"] || 0);
      if (Number.isFinite(declaredLength) && declaredLength > limit) {
        request.resume();
        reject(new HttpError(413, `Request body exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`));
        return;
      }
      const chunks = [];
      let received = 0;
      let settled = false;
      request.on("data", (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.length;
        if (received > limit) {
          settled = true;
          chunks.length = 0;
          request.resume();
          reject(new HttpError(413, `Request body exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`));
          return;
        }
        chunks.push(buffer);
      });
      request.on("end", () => {
        if (!settled) resolve(Buffer.concat(chunks, received).toString("utf8"));
      });
      request.on("error", (error) => {
        if (!settled) reject(error);
      });
    });
  }

  /**
   * Parses one bounded JSON object request.
   * @param {import("node:http").IncomingMessage} request HTTP request.
   * @param {string} pathname Request path.
   * @returns {Promise<object>}
   */
  async function readJsonBody(request, pathname) {
    const body = await readBody(request, requestBodyLimit(pathname));
    try {
      const payload = JSON.parse(body || "{}");
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new HttpError(400, "Expected a JSON object.");
      }
      return payload;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, `Invalid JSON request: ${error.message}`);
    }
  }

  /**
   * Pipes a local file to the response and destroys the stream on read errors.
   * @param {import("node:http").ServerResponse} response HTTP response.
   * @param {string} filePath Absolute file path.
   * @param {Record<string,string|number>} headers Response headers.
   * @param {{createReadStream?:Function}} [fsApi] Filesystem override.
   * @returns {import("node:stream").Writable} Piped destination.
   */
  function pipeFile(response, filePath, headers, fsApi = fs) {
    const stream = fsApi.createReadStream(filePath);
    stream.on("error", (error) => {
      logger.error("Asset stream failed:", error);
      if (!response.destroyed) response.destroy(error);
    });
    response.on("close", () => stream.destroy());
    if (!response.headersSent) response.writeHead(200, headers);
    return stream.pipe(response);
  }

  return { HttpError, send, validateWriteRequest, readJsonBody, pipeFile };
}

module.exports = { HttpError, createHttpUtilities };
