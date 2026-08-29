#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { createXsxbMcpService } = require("./xsxb_mcp_service");

const SERVER_INFO = Object.freeze({ name: "xsxb-frame-tuner", version: "0.1.0" });
const INSTRUCTIONS =
  "Use xsxb_list_projects or xsxb_get_project before mutations. Bind Godot with xsxb_bind_godot before xsxb_sync_godot. Import with xsxb_import_animation (start_frame/end_frame/replace supported); xsxb_import_video remains a video alias. Video-to-loop playbook: import the clip; drop near-duplicate holds with xsxb_find_duplicates (threshold / duplicate_ratio is the organizer 重复比例 slider, 55–100 default 88) then xsxb_reorganize_frames order; xsxb_cutout (same workbench sliders; omit for the shared profile) before comparing sheets; xsxb_find_loop then xsxb_export_sheet each candidate (start_frame/end_frame; cells are labeled with absolute indexes; mark_frame highlights one cell, defaulting to the loop start, for a second cull pass); pick the smoothest loop, reorganize to that order, and drop any marked-out cells; keep character scale consistent with xsxb_estimate_visual against one template animation (apply), bake with xsxb_cutout apply_visual and a canvas; finish with one xsxb_export_gif of the kept loop. Cut frames with xsxb_cutout (optional protected_colors; already-cut frames are skipped unless force plus an explicit key_color; force alone rematches without re-keying; receipts include keyed plus bodyHeight/nearWhite metrics unless metrics=false). Bind real assets with xsxb_add_attachment and xsxb_add_sfx via file_path (attachments accept a frames array); author trails with xsxb_add_attack_trail Hermite sticks (blade top/bottom on one swing; layer behind/front; reverseDirection flips the curve handle; GIF/sheet bake the mesh) only when the sampled weapon-head path is already a smooth arc that matches the intended smear. Mesh color is the striking-mass or a user-named hex — do not hardcode red. Do not default to that mesh when the head path is a polyline that should still read as a sickle (what you traced on 牛来's downward chop, across then nearly vertical e.g. D1→G3 then H8, is one case; an 上挑 clip can fail the same way). Hermite through those points always reads as a 7字折杆, a diagonal slice, or a column plus hook; twisting tangentStrength, reverseDirection, or extra mid sticks only swaps 不够弯 and 7字. Read the smear arc from this animation: overlay or sheet the frames and trace the striking-mass cells across the clip — do not pick a canned chop or 上挑 recipe. The generic playbook is only the skeleton. Before painting, call xsxb_plan_smear with the motion you actually read, path_kind polyline or smooth_arc, sampled color, and lock per-frame start and end cells (plus head); receipt.brief is the clip-specific prompt — execute that brief, do not jump from the generic skeleton to GenerateImage. Lock start = far cell already swept; end = leading/outer side of this frame's striking face — do not pin the head on the striking-mass cell (that paints onto the cup/shaft). Keep the band tight on that outer arc: layer behind so opaque weapon pixels punch through (hairline readable cup). Reject a full-grid-cell void (the smear floats) and reject overlap onto the cup/shaft. The smear occupies the front half of the weapon (striking-mass side), not the grip, not the palm, not through the body. It is not drawn farther ahead than this frame's cup has reached. If a prior GIF/sheet already passed eye QA, pass accepted_path and reuse those frames — do not GenerateImage a weaker sickle. Validated reference (example only, not a canned recipe for other attacks): 牛来 downward plunger chop, polyline D1→G3 then H8, 像素层 月牙, layer behind, files exports/niulai-plunger-mcp/niulai-chop-crescent-trail-v4.gif and niulai-chop-crescent-trail-v4-sheet.png. Paint a 像素层 月牙/镰刀 along the locked cells from the brief: take smear color from the striking mass or the named hex (do not hardcode red); GenerateImage a hollow sickle ribbon on pure white that follows the traced head motion (not a filled fan); xsxb_cutout the white while protecting those smear colors; xsxb_overlay_grid then xsxb_place_image with cell anchors onto the committed-strike frames (layer behind so the weapon stays readable; scale and anchor in cells, never convert canvas pixels). Do not pin mid-swing at the far end with a large scale or the crescent crops. Timing follows the strike, not a canned downward recipe: wind-up none or faint; committed swing longest/solid; follow-through a remnant; idle none. Replace-import, then xsxb_export_gif plus xsxb_export_sheet (GIF forward-play can hide the bow — inspect the sheet; human inspect sheets pass grid=false). Accept a continuous bow between the chord (locked start→locked end) and the smear band; reject bars, slices, 7字, overlap onto the weapon, and a cell-sized gap that floats the smear. Follow the weapon head, not the palm; keep visible width; obvious on the strike only. Remove mistaken bindings with xsxb_remove_binding (dry_run first). Read back current boxes, timing, and bindings with xsxb_get_animation include=[boxes,timing,sfx,attachments,trails]. Find ranked loop segments with xsxb_find_loop (imported animation, PNG directory, or file_paths; oneShotLikely means inspect sheets or use xsxb_find_motion); trim one-shot holds with xsxb_find_motion; apply either order with xsxb_reorganize_frames. Auto-fill boxes with xsxb_estimate_boxes (dry_run to preview, replace to recompute); batch-edit many frames via the frames array on xsxb_update_frame_boxes, xsxb_update_timing, and xsxb_add_attachment. Scale or offset visuals with xsxb_set_visual_transform (character|group|frame level). Estimate standing scales vs a reference animation or target_height with xsxb_estimate_visual (apply writes group/frame visual_size). Bake group/frame visual_size into pixels with xsxb_cutout apply_visual and a canvas; do not rematch or bake frames outside MCP. Swap one frame image with xsxb_replace_frame (keeps boxes and bindings). Translate planted pixels with xsxb_shift_frames (positive dy plants down toward the foot origin). Lossless-reencode workspace PNGs with xsxb_compress_frames (pixels stay identical; dry_run previews savings). Render a shareable preview with xsxb_export_gif (honors per-frame timing and group/frame visual_size; requires ffmpeg) or a labeled contact sheet with xsxb_export_sheet (overlay grid for the eye; source animation PNGs stay unchanged). Pass grid_density (sparse|normal|dense), grid_divs like 8x8, or grid_x/grid_y, and grid_scope canvas|subject — fill these from the task and image size; omit to keep the auto step. Density densifies grid lines. Overlay paints row/col indices matching export_sheet grid.cells; group x,y are in that JSON and grid.legend — do not OCR overlay digits. Use export_sheet grid.cells[row][col] (row 0 = top, col 0 = left; x,y is that square's top-left) for write-back. Write tools accept the same group coordinates: xsxb_shift_frames from/to or dx/dy, box min/max, attachment hand plus t, trail sticks, visual offset. Do not convert those numbers to canvas pixels yourself. After rematch, xsxb_cutout returns inspectFeet with that overlay; plant with xsxb_shift_frames after reading cells[row][col], never by guessing boot colors. xsxb_shift_frames is a catalog tool (MCP_TOOL_NAMES / tools/list already include it). If a client reports it not found, the session catalog is stale — reload the xsxb MCP server; do not skip planting or convert overlay numbers to canvas pixels. grid_divs / grid_density already work on xsxb_export_sheet / xsxb_cutout. Yellow 0,0 is outside the bitmap: canvasAnchor uses y=height, so the last pixel row is group y=-1; do not plant soles to 0,0 or they clip 1px — plant the sole to y=-1. metrics.feetY is the boot sole and ignores connected bright slash/glow below it; confirm on the overlay before planting. Measure a weapon PNG's pommel/tip/handle fraction with xsxb_measure_image (pommel is the end nearer the widest station; t=0.5 middle, t=2/3 toward the tip); to place it, pass the same t plus hand group coordinates to xsxb_add_attachment. Speakable still overlays: xsxb_overlay_grid paints A1-style cell ids on a PNG (the agent is the eye; only report those cell ids; do not OCR pixel x,y). Pass crop_from with parent_view plus cells (padding_cells optional) to integer-crop a finer overlay; view stays in original-image pixels. After the user confirms a still composite, call xsxb_plan_place with 图度 fields (read contact on both images, physics rules, accept criteria, 3–5 step plan) and execute receipt.brief before placing; await_confirm pauses for the user. Composite a sprite with xsxb_place_image using target_anchor/object_anchor (cell derive or alpha_support), scale relative|physical from the selected span — never image-width-per-meter — layer front|under_target|behind (under_target puts the object under opaque pixels inside the target cell union), and rotation as clockwise degrees around the object anchor (screen y-down). Held objects follow pose physics, not source-upright: rotation 0 is the PNG as generated (often the heavy head down). Rotate around the grip so the mass/striking end faces the figure's facing or attack side and the shaft follows the forearm/wrist, not world-vertical. Scale physical or relative from the body span — two full canvases are not 1:1 meters. object_anchor is the handle grip (measure t or handle cells), not the head; target_anchor is the palm or fist with layer under_target. xsxb_place_image does not redraw a hand — a closed fist reads held, an open palm stays open. After placing, look at the overlay: handle through the palm cells, head on the strike side; if the head clips the canvas, pad that edge or grip closer to the head. xsxb_cutout file_path cuts a standalone workspace PNG with the same smart-cutout as animation frames. For a white-background 月牙 VFX, key the white and protect the smear colors (sampled from the striking mass; do not hardcode red) before xsxb_place_image. Example: stand a figure on a marked region by naming its cells and a physical width. xsxb_measure_image anchor=alpha_bottom returns that opaque-foot point. After xsxb_find_duplicates, do not apply order when autoAdjustedThreshold is set unless you passed auto_adjust. xsxb_open_tuner starts the local Tuner when it is down. Set the default project with xsxb_set_active_project. Edit boxes and timing without syncing, then sync explicitly. Validate with layer=standalone|bind|gameplay. Delete mistaken imports with dry_run first. Report all tool results without inventing success. If MCP errors, a needed capability is missing, or you must leave MCP to finish the request, do not hide it: tell the user and raise it to the XSXB-Frame-Tuner project with tool name, arguments, receipt or error, expected result, and actual result.";

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
