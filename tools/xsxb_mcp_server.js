#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { createXsxbMcpService } = require("./xsxb_mcp_service");

const SERVER_INFO = Object.freeze({ name: "xsxb-frame-tuner", version: "0.1.0" });
const INSTRUCTIONS =
  "Use xsxb_list_projects or xsxb_get_project before mutations. Bind Godot with xsxb_bind_godot before xsxb_sync_godot. Import with xsxb_import_animation (start_frame/end_frame/replace supported); xsxb_import_video remains a video alias. Video-to-loop playbook: import the clip; drop near-duplicate holds with xsxb_find_duplicates (threshold / duplicate_ratio is the organizer 重复比例 slider, 55–100 default 88) then xsxb_reorganize_frames order; xsxb_cutout (same workbench sliders; omit for the shared profile) before comparing sheets; xsxb_find_loop then xsxb_export_sheet each candidate (start_frame/end_frame; cells are labeled with absolute indexes; mark_frame highlights one cell, defaulting to the loop start, for a second cull pass); pick the smoothest loop, reorganize to that order, and drop any marked-out cells; keep character scale consistent with xsxb_estimate_visual against one template animation (apply), bake with xsxb_cutout apply_visual and a canvas; finish with one xsxb_export_gif of the kept loop. Cut frames with xsxb_cutout (optional protected_colors; already-cut frames are skipped unless force plus an explicit key_color; force alone rematches without re-keying; receipts include keyed plus bodyHeight/nearWhite metrics unless metrics=false). Bind real assets with xsxb_add_attachment and xsxb_add_sfx via file_path (attachments accept a frames array); author trails with xsxb_add_attack_trail sticks (blade top/bottom on one swing; layer behind/front; reverseDirection flips the curve handle; GIF/sheet bake the mesh); remove mistaken bindings with xsxb_remove_binding (dry_run first). Read back current boxes, timing, and bindings with xsxb_get_animation include=[boxes,timing,sfx,attachments,trails]. Find ranked loop segments with xsxb_find_loop (imported animation, PNG directory, or file_paths; oneShotLikely means inspect sheets or use xsxb_find_motion); trim one-shot holds with xsxb_find_motion; apply either order with xsxb_reorganize_frames. Auto-fill boxes with xsxb_estimate_boxes (dry_run to preview, replace to recompute); batch-edit many frames via the frames array on xsxb_update_frame_boxes, xsxb_update_timing, and xsxb_add_attachment. Scale or offset visuals with xsxb_set_visual_transform (character|group|frame level). Estimate standing scales vs a reference animation or target_height with xsxb_estimate_visual (apply writes group/frame visual_size). Bake group/frame visual_size into pixels with xsxb_cutout apply_visual and a canvas; do not rematch or bake frames outside MCP. Swap one frame image with xsxb_replace_frame (keeps boxes and bindings). Lossless-reencode workspace PNGs with xsxb_compress_frames (pixels stay identical; dry_run previews savings). Render a shareable preview with xsxb_export_gif (honors per-frame timing and group/frame visual_size; requires ffmpeg) or a labeled contact sheet with xsxb_export_sheet (group-coordinate grid, foot origin 0,0, body is negative y). Measure a weapon PNG's pommel/tip/handle fraction with xsxb_measure_image (pommel is the end nearer the widest station; t=0.5 middle, t=2/3 toward the tip); localFromCenter is the grip relative to the image center, so attachment offset = hand - localFromCenter. After xsxb_find_duplicates, do not apply order when autoAdjustedThreshold is set unless you passed auto_adjust. xsxb_open_tuner starts the local Tuner when it is down. Set the default project with xsxb_set_active_project. Edit boxes and timing without syncing, then sync explicitly. Validate with layer=standalone|bind|gameplay. Delete mistaken imports with dry_run first. Report all tool results without inventing success. If MCP errors, a needed capability is missing, or you must leave MCP to finish the request, do not hide it: tell the user and raise it to the XSXB-Frame-Tuner project with tool name, arguments, receipt or error, expected result, and actual result.";

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
