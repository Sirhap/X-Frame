import { createAccountAuthService, handleAccountAuthRequest } from "./account_auth.mjs";
import { handleAdminRequest } from "./admin.mjs";
import { handleExportAuthorizationRequest } from "./export_authorization.mjs";

const WORKBENCH_ROUTES = new Set([
  "/projects",
  "/tools",
  "/tools/import",
  "/tools/cutout",
  "/tools/organizer",
  "/tools/scatter-slice",
  "/tools/export",
  "/workspace",
  "/workspace/tools/cutout",
  "/workspace/tools/organizer",
  "/workspace/resources/import",
  "/workspace/resources/cutout",
  "/workspace/resources/scatter",
  "/workspace/animation/overview",
  "/workspace/animation/transform",
  "/workspace/animation/boxes",
  "/workspace/animation/trails",
  "/workspace/animation/audio",
  "/workspace/animation/attachments",
  "/workspace/delivery/export",
  "/workspace/delivery/godot",
  "/workspace/delivery/codex-pet",
]);

/**
 * Resolves a public route to its immutable deployment entry document.
 * @param {string} pathname Request pathname.
 * @returns {string} Static asset pathname.
 */
export function resolveAssetPath(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/admin/login" || pathname === "/admin/licenses") return "/admin.html";
  if (WORKBENCH_ROUTES.has(pathname)) return "/workbench.html";
  return pathname;
}

/**
 * Reports media encoders that are intentionally unavailable in the static Cloudflare deployment.
 * @returns {Response} Stable capability response consumed by the organizer export dialog.
 */
function mediaExportCapabilitiesResponse() {
  return Response.json(
    {
      mode: "cloudflare-static",
      ffmpeg: { available: false, version: "" },
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

/**
 * Creates an administrator redirect that cannot be reused across authentication states.
 * @param {string} pathname Destination pathname.
 * @param {URL} requestUrl Incoming URL.
 * @returns {Response} Private redirect response.
 */
function adminRedirect(pathname, requestUrl) {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "private, no-store",
      Location: new URL(pathname, requestUrl).toString(),
      Vary: "Cookie",
    },
  });
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
    if (url.pathname === "/api/media-export/capabilities" && request.method === "GET") {
      return mediaExportCapabilitiesResponse();
    }
    if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) {
      return handleAdminRequest(request, env);
    }
    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/entitlements/")) {
      return handleAccountAuthRequest(request, env);
    }
    if (url.pathname === "/api/export" || url.pathname.startsWith("/api/export/")) {
      return handleExportAuthorizationRequest(request, env);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/tools/watermark") {
      return Response.redirect(new URL("/?notice=local-watermark#factoryTools", url), 302);
    }
    if (url.pathname === "/admin.html") {
      return new Response("Not Found", { status: 404 });
    }
    if (url.pathname === "/admin/login" || url.pathname === "/admin/licenses") {
      const session = await createAccountAuthService(env).status(request);
      if (url.pathname === "/admin/licenses" && !session.administrator) {
        return adminRedirect("/admin/login", url);
      }
      if (url.pathname === "/admin/login" && session.administrator) {
        return adminRedirect("/admin/licenses", url);
      }
      const assetUrl = new URL(url);
      assetUrl.pathname = "/admin.html";
      try {
        const response = await env.ASSETS.fetch(new Request(assetUrl, request));
        const protectedResponse = withResponseHeaders(response, "/admin.html");
        protectedResponse.headers.set("Cache-Control", "private, no-store");
        protectedResponse.headers.set("Vary", "Cookie");
        return protectedResponse;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "static_asset_fetch_failed",
            pathname: "/admin.html",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return new Response("Static asset temporarily unavailable", { status: 502 });
      }
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
