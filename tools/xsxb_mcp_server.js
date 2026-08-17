#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { createXsxbMcpService } = require("./xsxb_mcp_service");

const SERVER_INFO = Object.freeze({ name: "xsxb-frame-tuner", version: "0.1.0" });
const INSTRUCTIONS =
  "Use xsxb_list_projects or xsxb_get_project before mutations. Bind Godot with xsxb_bind_godot before xsxb_sync_godot. Import with xsxb_import_animation (start_frame/end_frame/replace supported); xsxb_import_video remains a video alias. Cut frames with xsxb_cutout (smart-cutout; optional protected_colors; already-cut frames are skipped unless force). Bind real assets with xsxb_add_attachment and xsxb_add_sfx via file_path; author trails with xsxb_add_attack_trail sticks/texture_path; remove mistaken bindings with xsxb_remove_binding (dry_run first). Read back current boxes, timing, and bindings with xsxb_get_animation include=[boxes,timing,sfx,attachments,trails]. Auto-fill boxes with xsxb_estimate_boxes (dry_run to preview, replace to recompute); batch-edit many frames via the frames array on xsxb_update_frame_boxes and xsxb_update_timing. Scale or offset visuals with xsxb_set_visual_transform (character|group|frame level). Swap one frame image with xsxb_replace_frame (keeps boxes and bindings). Render a shareable preview with xsxb_export_gif (honors per-frame timing; requires ffmpeg). xsxb_open_tuner starts the local Tuner when it is down. Set the default project with xsxb_set_active_project. Edit boxes and timing without syncing, then sync explicitly. Validate with layer=standalone|bind|gameplay. Delete mistaken imports with dry_run first. Report all tool results without inventing success. If MCP errors, a needed capability is missing, or you must leave MCP to finish the request, do not hide it: tell the user and raise it to the XSXB-Frame-Tuner project with tool name, arguments, receipt or error, expected result, and actual result.";

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
  return lines;
}

if (require.main === module) startServer();

module.exports = { INSTRUCTIONS, handleMessage, startServer };
