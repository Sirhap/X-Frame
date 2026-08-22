#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { createXsxbMcpService } = require("./xsxb_mcp_service");

const SERVER_INFO = Object.freeze({ name: "xsxb-frame-tuner", version: "0.1.0" });
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18"]);
const INSTRUCTIONS =
  "XSXB-Frame-Tuner is a local animation-production MCP. Read state with xsxb_list_projects, xsxb_get_project, or xsxb_get_animation before mutation. Use xsxb_get_workflow for video loops, one-shots, cutout, visual matching, attachments, weapon placement, weapon trails, Godot sync, and export. Weapon placement requires explicit hand/tip anchors: measure with xsxb_measure_image, preview with xsxb_plan_attachment, then apply with xsxb_add_attachment confirm=true. Derive a matching smear with xsxb_add_attack_trail attachment_id. GIF and sheet exports include workbench attachments and trails unless disabled. Bind Godot before sync; edit first, sync explicitly, then validate standalone, bind, and gameplay layers. Use dry_run before deletion or binding removal. Report receipts exactly. If a tool errors, a capability is missing, or you must leave MCP, tell the user and raise it to XSXB-Frame-Tuner with tool, arguments, receipt/error, expected result, and actual result.";
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
    const requestedVersion = String(message.params?.protocolVersion || "");
    return success(id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0],
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
  let queue = Promise.resolve();
  lines.on("line", (line) => {
    queue = queue
      .then(async () => {
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
      })
      .catch((error) => {
        output.write(`${JSON.stringify(failure(null, -32603, error.message || "Internal MCP error."))}\n`);
      });
  });
  lines.once("close", () => {
    Promise.resolve(service.close?.()).catch(() => {});
  });
  return lines;
}

if (require.main === module) startServer();

module.exports = { INSTRUCTIONS, handleMessage, startServer };
