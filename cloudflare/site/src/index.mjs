import { handleActivationRequest } from "./activation.mjs";

const WORKBENCH_ROUTES = new Set(["/workspace", "/tools/import", "/tools/cutout", "/tools/organizer"]);

/**
 * Resolves a public route to its immutable deployment entry document.
 * @param {string} pathname Request pathname.
 * @returns {string} Static asset pathname.
 */
export function resolveAssetPath(pathname) {
  if (pathname === "/") return "/index.html";
  if (WORKBENCH_ROUTES.has(pathname)) return "/workbench.html";
  return pathname;
}

/**
 * Adds stable security and cache headers without mutating the asset response.
 * @param {Response} response Static asset response.
 * @param {string} assetPath Resolved asset path.
 * @returns {Response} Header-enriched response.
 */
function withResponseHeaders(response, assetPath) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (assetPath.endsWith(".html")) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  } else if (assetPath.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  /**
   * Routes landing and tool URLs while delegating file delivery to Static Assets.
   * @param {Request} request Incoming Worker request.
   * @param {{ASSETS:{fetch:(request:Request)=>Promise<Response>}}} env Worker bindings.
   * @returns {Promise<Response>} Routed asset response.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/activation" || url.pathname.startsWith("/api/activation/")) {
      return handleActivationRequest(request, env);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const assetPath = resolveAssetPath(url.pathname);
    url.pathname = assetPath;
    try {
      const response = await env.ASSETS.fetch(new Request(url, request));
      return withResponseHeaders(response, assetPath);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "static_asset_fetch_failed",
          pathname: assetPath,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return new Response("Static asset temporarily unavailable", { status: 502 });
    }
  },
};
