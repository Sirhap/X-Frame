#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const path = require("node:path");
const { createXsxbMcpService } = require("./xsxb_mcp_service");
const { createRuntimeInfo } = require("./xsxb_mcp_runtime");

const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18"]);
const LOGGING_LEVELS = new Set([
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
]);
const INSTRUCTIONS =
  "XSXB-Frame-Tuner is a local multimodal animation-production MCP. Read state before mutation and use xsxb_get_workflow for ordered operations. Visual tools return a bounded image plus an xsxb:// full resource; inspect it with image input or use the declared human_review fallback. Weapon placement requires explicit hand/tip anchors: measure, plan, inspect the review artifact, then apply the persisted plan_id with confirm=true and an artifact-bound review_confirmation. Use apply_mode=replace for atomic weapon resizing or replacement. Derive trails with dry_run first and review baked-FX overlap. Every project write creates a restorable mutation revision; list revisions and dry-run restore before confirmation. GIF and sheet exports include attachments and trails unless disabled. Bind and sync Godot explicitly, then validate standalone, bind, and gameplay layers. Report receipts exactly; never claim visual approval without reviewing the returned artifact. If a capability is missing or work must leave MCP, tell the user and raise it to XSXB-Frame-Tuner with the tool, arguments, expected result, and actual result.";
/**
 * Creates one successful JSON-RPC response.
 * @param {string|number|null} id Request id.
 * @param {unknown} result Response result.
 * @returns {object} JSON-RPC response.
 */
function success(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Creates one JSON-RPC error response.
 * @param {string|number|null} id Request id.
 * @param {number} code JSON-RPC error code.
 * @param {string} message Error message.
 * @returns {object} JSON-RPC response.
 */
function failure(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handles one MCP JSON-RPC request.
 * @param {object} message Parsed request.
 * @param {{tools:object[],call:Function}} service XSXB service.
 * @param {{notify?:(message:object)=>void}} [options] Transport hooks.
 * @returns {Promise<object|null>} Response, or null for notifications.
 */
async function handleMessage(message, service, options = {}) {
  const id = Object.prototype.hasOwnProperty.call(message || {}, "id") ? message.id : null;
  const method = String(message?.method || "");
  if (!method) return failure(id, -32600, "Invalid JSON-RPC request.");
  if (method === "notifications/cancelled") {
    service.cancel?.(message.params?.requestId, message.params?.reason);
    return null;
  }
  if (id === null) return null;
  if (method === "initialize") {
    const requestedVersion = String(message.params?.protocolVersion || "");
    return success(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0],
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: true },
        prompts: { listChanged: false },
        logging: {},
      },
      serverInfo: createRuntimeInfo(path.resolve(__dirname, ".."), service.tools),
      instructions: INSTRUCTIONS,
    });
  }
  if (method === "ping") return success(id, {});
  if (method === "logging/setLevel") {
    const level = String(message.params?.level || "");
    if (!LOGGING_LEVELS.has(level)) {
      return failure(id, -32602, `Invalid MCP logging level: ${level || "missing"}`);
    }
    service.setLogLevel?.(level);
    return success(id, {});
  }
  if (method === "tools/list") return success(id, { tools: service.tools });
  if (method === "tools/call") {
    const params = message.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return failure(id, -32602, "tools/call params must be an object.");
    }
    const name = typeof params.name === "string" ? params.name : "";
    if (!name) return failure(id, -32602, "tools/call requires a non-empty tool name.");
    if (
      params.arguments !== undefined &&
      (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))
    ) {
      return failure(id, -32602, "tools/call arguments must be an object.");
    }
    if (!Array.isArray(service.tools) || !service.tools.some((tool) => tool.name === name)) {
      return failure(id, -32602, `Unknown XSXB MCP tool: ${name}`);
    }
    try {
      const result = await service.call(name, params.arguments || {}, {
        requestId: id,
        progressToken: params._meta?.progressToken,
        progress(update = {}) {
          const progressToken = params._meta?.progressToken;
          if (progressToken === undefined || progressToken === null || !options.notify) return;
          options.notify({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progressToken, ...update },
          });
        },
      });
      const formatted = service.formatToolResult?.(result) || {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      };
      return success(id, formatted);
    } catch (error) {
      const result = {
        ok: false,
        error: error.message,
        code: error.code || "xsxb_tool_error",
        ...(error.retryable === true ? { retryable: true } : {}),
      };
      return success(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: true,
      });
    }
  }
  if (method === "resources/list") {
    if (!service.resources?.list) return failure(id, -32601, "Resources are unavailable.");
    return success(id, await service.resources.list(message.params || {}));
  }
  if (method === "resources/templates/list") {
    if (!service.resources?.templates) return failure(id, -32601, "Resource templates are unavailable.");
    return success(id, await service.resources.templates(message.params || {}));
  }
  if (method === "resources/read") {
    if (!service.resources?.read) return failure(id, -32601, "Resources are unavailable.");
    const uri = message.params?.uri;
    if (typeof uri !== "string" || !uri.trim()) {
      return failure(id, -32602, "resources/read requires a non-empty uri.");
    }
    try {
      return success(id, await service.resources.read(uri));
    } catch (error) {
      const messageText = String(error?.message || "");
      const invalid = /invalid .*resource URI|unsafe/iu.test(messageText);
      const unavailable = /not found|expired/iu.test(messageText);
      return failure(
        id,
        invalid ? -32602 : unavailable ? -32002 : -32603,
        error.message || "Resource read failed.",
      );
    }
  }
  if (method === "prompts/list") {
    if (!service.prompts?.list) return failure(id, -32601, "Prompts are unavailable.");
    return success(id, await service.prompts.list(message.params || {}));
  }
  if (method === "prompts/get") {
    if (!service.prompts?.get) return failure(id, -32601, "Prompts are unavailable.");
    try {
      return success(id, await service.prompts.get(message.params || {}));
    } catch (error) {
      return failure(id, Number.isInteger(error.code) ? error.code : -32602, error.message);
    }
  }
  return failure(id, -32601, `Method not found: ${method}`);
}

/**
 * Starts the newline-delimited STDIO MCP transport.
 * @param {{input?:NodeJS.ReadableStream,output?:NodeJS.WritableStream,service?:object}} [options] Transport dependencies.
 * @returns {readline.Interface} Active line reader.
 */
function startServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const service =
    options.service ||
    createXsxbMcpService({
      root: process.env.XSXB_ROOT ? path.resolve(process.env.XSXB_ROOT) : undefined,
    });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  const writeMessage = (message) => output.write(`${JSON.stringify(message)}\n`);
  service.setNotifier?.(writeMessage);
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      writeMessage(failure(null, -32700, `Parse error: ${error.message}`));
      return;
    }
    if (message.method === "notifications/cancelled") {
      void handleMessage(message, service);
      return;
    }
    const task = handleMessage(message, service, { notify: writeMessage })
      .then((response) => {
        if (response) writeMessage(response);
      })
      .catch((error) => {
        writeMessage(failure(message.id ?? null, -32603, error.message || "Internal MCP error."));
      })
      .finally(() => {
        pending.delete(task);
      });
    pending.add(task);
  });
  lines.once("close", () => {
    service.cancelAll?.();
    Promise.allSettled([...pending])
      .then(() => service.close?.())
      .catch(() => {});
  });
  return lines;
}

if (require.main === module) startServer();

module.exports = { INSTRUCTIONS, handleMessage, startServer };
