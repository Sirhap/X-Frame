#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { createXsxbMcpService } = require("./xsxb_mcp_service");

const SERVER_INFO = Object.freeze({ name: "xsxb-frame-tuner", version: "0.1.0" });
const INSTRUCTIONS =
  "Use xsxb_list_projects or xsxb_get_project before mutations. Import with xsxb_import_animation (video, PNG sequence, SpriteFrames, or items); xsxb_import_video remains a video alias. Edit boxes and timing without syncing, then call xsxb_sync_godot explicitly. Delete mistaken imports with dry_run first. Validate after synchronization and report all tool results without inventing success.";

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
 * @returns {Promise<object|null>} Response, or null for notifications.
 */
async function handleMessage(message, service) {
  const id = Object.prototype.hasOwnProperty.call(message || {}, "id") ? message.id : null;
  const method = String(message?.method || "");
  if (!method) return failure(id, -32600, "Invalid JSON-RPC request.");
  if (id === null) return null;
  if (method === "initialize") {
    return success(id, {
      protocolVersion: String(message.params?.protocolVersion || "2025-06-18"),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }
  if (method === "ping") return success(id, {});
  if (method === "tools/list") return success(id, { tools: service.tools });
  if (method === "tools/call") {
    try {
      const result = await service.call(String(message.params?.name || ""), message.params?.arguments || {});
      return success(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      });
    } catch (error) {
      const result = { ok: false, error: error.message, code: error.code || "xsxb_tool_error" };
      return success(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: true,
      });
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
  const service = options.service || createXsxbMcpService();
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      output.write(`${JSON.stringify(failure(null, -32700, `Parse error: ${error.message}`))}\n`);
      return;
    }
    const response = await handleMessage(message, service);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  });
  return lines;
}

if (require.main === module) startServer();

module.exports = { handleMessage, startServer };
