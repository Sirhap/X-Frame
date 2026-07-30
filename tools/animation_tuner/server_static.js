"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

/** @type {Readonly<Record<string, string>>} MIME types for locally served public assets. */
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

/**
 * Creates the local static-resource handler.
 * @param {{publicRoot:string,workbenchRoutes:Set<string>,safeResolve:(base:string,requested:string)=>string|null,send:Function,landingDocument?:string,workbenchDocument?:string,documentRoutes?:Readonly<Record<string,string>>,fsApi?:typeof import("node:fs"),pathApi?:typeof import("node:path")}} options Static handler dependencies.
 * @returns {(request:object,response:object,pathname:string)=>boolean} Resource handler.
 */
function createStaticHandler(options) {
  if (!options?.publicRoot || !(options.workbenchRoutes instanceof Set)) {
    throw new TypeError("Static resource options are required.");
  }
  const fsApi = options.fsApi || defaultFs;
  const pathApi = options.pathApi || defaultPath;
  const landingDocument = options.landingDocument || "landing.html";
  const workbenchDocument = options.workbenchDocument || "index.html";
  const documentRoutes = options.documentRoutes || {};
  return function serveStatic(_request, response, pathname) {
    const requestPath =
      pathname === "/"
        ? landingDocument
        : options.workbenchRoutes.has(pathname)
          ? workbenchDocument
          : documentRoutes[pathname] || pathname.slice(1);
    const fullPath = options.safeResolve(options.publicRoot, requestPath);
    if (!fullPath || !fsApi.existsSync(fullPath) || fsApi.statSync(fullPath).isDirectory()) {
      return options.send(response, 404, "Not found", "text/plain");
    }
    const extension = pathApi.extname(fullPath).toLowerCase();
    const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
    return options.send(response, 200, fsApi.readFileSync(fullPath), contentType);
  };
}

module.exports = { createStaticHandler };
