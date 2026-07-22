"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

/**
 * Creates the local static-resource handler.
 * @param {{publicRoot:string,workbenchRoutes:Set<string>,safeResolve:(base:string,requested:string)=>string|null,send:Function,landingDocument?:string,workbenchDocument?:string,fsApi?:typeof import("node:fs"),pathApi?:typeof import("node:path")}} options Static handler dependencies.
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
  return function serveStatic(_request, response, pathname) {
    const requestPath =
      pathname === "/"
        ? landingDocument
        : options.workbenchRoutes.has(pathname)
          ? workbenchDocument
          : pathname.slice(1);
    const fullPath = options.safeResolve(options.publicRoot, requestPath);
    if (!fullPath || !fsApi.existsSync(fullPath) || fsApi.statSync(fullPath).isDirectory()) {
      return options.send(response, 404, "Not found", "text/plain");
    }
    const extension = pathApi.extname(fullPath).toLowerCase();
    const contentType =
      extension === ".js" ? "application/javascript" : extension === ".css" ? "text/css" : "text/html";
    return options.send(response, 200, fsApi.readFileSync(fullPath), contentType);
  };
}

module.exports = { createStaticHandler };
