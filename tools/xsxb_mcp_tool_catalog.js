"use strict";

/**
 * Declarative catalog of the XSXB MCP tools: the advertised order, the input
 * schema of every tool, and the annotations clients use to reason about them.
 * Kept apart from the service so the schemas can be read and reviewed without
 * scrolling past the handler implementations.
 */

const path = require("node:path");
const { ORGANIZER_SIMILARITY_THRESHOLD } = require("./animation_tuner/public/frame_organizer_core");
const { workbenchSliderSchemaProperties } = require("./xsxb_mcp_cutout");

const DEFAULT_PROFILE_ID = "mcp_imports";
const MCP_TOOL_NAMES = Object.freeze([
  "xsxb_list_projects",
  "xsxb_get_project",
  "xsxb_import_video",
  "xsxb_import_animation",
  "xsxb_get_animation",
  "xsxb_find_loop",
  "xsxb_find_duplicates",
  "xsxb_find_motion",
  "xsxb_update_frame_boxes",
  "xsxb_estimate_boxes",
  "xsxb_update_timing",
  "xsxb_set_visual_transform",
  "xsxb_estimate_visual",
  "xsxb_reorganize_frames",
  "xsxb_replace_frame",
  "xsxb_add_attack_trail",
  "xsxb_add_attachment",
  "xsxb_add_sfx",
  "xsxb_remove_binding",
  "xsxb_delete_animation",
  "xsxb_sync_godot",
  "xsxb_validate_project",
  "xsxb_set_active_project",
  "xsxb_bind_godot",
  "xsxb_cutout",
  "xsxb_export_gif",
  "xsxb_export_sheet",
  "xsxb_measure_image",
  "xsxb_open_tuner",
]);

function toolDefinitions() {
  const projectProperty = {
    type: "string",
    description: "XSXB project id. Defaults to the last selected/imported project.",
  };
  const animationProperties = {
    project_id: projectProperty,
    profile_id: { type: "string", description: "Animation profile id." },
    animation_id: { type: "string", description: "Animation id." },
  };
  return [
    {
      name: "xsxb_list_projects",
      description: "List every local XSXB project, its active state, Godot binding, and animation counts.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_get_project",
      description:
        "Return one project's registry record, Godot binding, animation list, frame counts, and last sync receipt.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectProperty },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_import_video",
      description:
        "Extract every native frame from a local video, import it as an XSXB animation, optionally sync to Godot, and validate the result.",
      inputSchema: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Absolute local video path." },
          fps: { type: "number", minimum: 1, maximum: 120, default: 12 },
          start_frame: {
            type: "integer",
            minimum: 0,
            description: "Inclusive 0-based extracted frame index.",
          },
          end_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based extracted frame index." },
          replace: {
            type: "boolean",
            default: false,
            description: "Replace an existing animation id atomically.",
          },
          sync: { type: "boolean", default: false },
          validate: { type: "boolean", default: false },
          project_id: projectProperty,
          profile_id: { type: "string", default: DEFAULT_PROFILE_ID },
          animation_id: { type: "string", description: "Defaults to a sanitized video filename." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: "xsxb_import_animation",
      description:
        "Import a video, PNG sequence, SpriteFrames file, or PNG data items as an XSXB animation. Video import remains available as xsxb_import_video.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["video", "png_sequence", "spriteframes", "items"],
            description: "Import kind. Inferred from file_path, directory, or items when omitted.",
          },
          file_path: { type: "string", description: "Absolute video or .spriteframes.tres path." },
          directory: { type: "string", description: "Absolute directory of PNG frames." },
          items: {
            type: "array",
            items: { type: "object" },
            description: "PNG data-URL items for source=items.",
          },
          fps: { type: "number", minimum: 1, maximum: 120, default: 12 },
          start_frame: { type: "integer", minimum: 0 },
          end_frame: { type: "integer", minimum: 0 },
          replace: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
          validate: { type: "boolean", default: false },
          project_id: projectProperty,
          profile_id: { type: "string", default: DEFAULT_PROFILE_ID },
          animation_id: { type: "string" },
          animation_name: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    {
      name: "xsxb_get_animation",
      description:
        "Return animation metadata and frames. Pass frames=summary for a compact sample without animation.frames. Pass include to also read back current boxes, timing, sfx, attachments, or trails.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frames: { type: "string", enum: ["summary", "full"], default: "full" },
          include: {
            type: "array",
            items: {
              type: "string",
              enum: ["boxes", "timing", "visual", "sfx", "attachments", "trails"],
            },
            description:
              "Extra sections to return: box overrides, playback timing, visual transforms, and bindings.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_find_loop",
      description:
        "Rank loop-segment candidates with the same Tuner loop finder. Query an imported animation, a PNG directory, or file_paths. Does not mutate frames; apply a candidate with xsxb_reorganize_frames order. oneShotLikely is set when the recommended loop covers less than half of a clip with 12+ frames — inspect sheets or use xsxb_find_motion instead of applying a burst.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          directory: {
            type: "string",
            description: "Absolute PNG sequence directory. Overrides the imported animation when set.",
          },
          file_paths: {
            type: "array",
            items: { type: "string" },
            description:
              "Absolute PNG paths in playback order. Overrides directory and the imported animation when set.",
          },
          min_period: {
            type: "integer",
            minimum: 2,
            description: "Smallest loop period to consider. Defaults to the Tuner minimum of 2.",
          },
          max_period: {
            type: "integer",
            minimum: 2,
            description: "Largest loop period to consider. Defaults to two-thirds of the frame count.",
          },
          start_frame: {
            type: "integer",
            minimum: 0,
            description: "Ignore candidates that start before this 0-based index.",
          },
          preference: {
            type: "string",
            enum: ["auto", "short", "long"],
            default: "auto",
            description: "Bias ranking toward shorter or longer periods without dropping valid ones.",
          },
          boundary_factor: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.85,
            description: "Same Tuner seam threshold as the organizer loop search.",
          },
          sample_size: {
            type: "integer",
            minimum: 8,
            maximum: 256,
            default: 256,
            description: "Square analysis sample. Matches the Tuner 256×256 reference size.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_find_duplicates",
      description:
        "Find near-duplicate hold frames with the same Tuner duplicate finder. Pass threshold or duplicate_ratio for the organizer 重复比例 slider; do not pass both unless they match. If autoAdjustedThreshold is set, do not apply order unless you passed auto_adjust. Query an imported animation, a PNG directory, or file_paths. Does not mutate frames; apply the keep-order with xsxb_reorganize_frames.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          directory: {
            type: "string",
            description: "Absolute PNG sequence directory. Overrides the imported animation when set.",
          },
          file_paths: {
            type: "array",
            items: { type: "string" },
            description:
              "Absolute PNG paths in playback order. Overrides directory and the imported animation when set.",
          },
          threshold: {
            type: "number",
            minimum: ORGANIZER_SIMILARITY_THRESHOLD.min,
            maximum: ORGANIZER_SIMILARITY_THRESHOLD.max,
            default: ORGANIZER_SIMILARITY_THRESHOLD.fallback,
            description: "Organizer 相似度阈值 / 重复比例 slider. Higher keeps more near-duplicates.",
          },
          duplicate_ratio: {
            type: "number",
            minimum: ORGANIZER_SIMILARITY_THRESHOLD.min,
            maximum: ORGANIZER_SIMILARITY_THRESHOLD.max,
            default: ORGANIZER_SIMILARITY_THRESHOLD.fallback,
            description: "Alias of threshold. Same organizer 重复比例 slider.",
          },
          auto_adjust: {
            type: "boolean",
            default: false,
            description:
              "If true, apply the finder's lowered threshold when nothing matches the requested slider. Default keeps order unchanged and reports autoAdjustedThreshold / suggestedOrder.",
          },
          sample_size: {
            type: "integer",
            minimum: 8,
            maximum: 256,
            default: 256,
            description: "Square analysis sample. Matches the Tuner 256×256 reference size.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_find_motion",
      description:
        "Find the interior motion window by trimming a leading rest hold and, when the clip returns to that rest, the trailing hold. Query an imported animation, a PNG directory, or file_paths. Does not mutate frames; apply the order with xsxb_reorganize_frames.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          directory: {
            type: "string",
            description: "Absolute PNG sequence directory. Overrides the imported animation when set.",
          },
          file_paths: {
            type: "array",
            items: { type: "string" },
            description:
              "Absolute PNG paths in playback order. Overrides directory and the imported animation when set.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_frame_boxes",
      description:
        "Update hurtbox, collisionbox, and hitbox for one animation frame, or many frames at once via frames. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0, default: 0 },
          hurtbox: { type: "object" },
          collisionbox: { type: "object" },
          hitbox: { type: "object" },
          frames: {
            type: "array",
            items: { type: "object" },
            description:
              "Batch mode: [{frame, hurtbox?, collisionbox?, hitbox?}, ...] applied in one write. Overrides the single-frame parameters.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_estimate_boxes",
      description:
        "Auto-estimate hurtbox, collisionbox, and hitbox overrides for every animation frame from opaque pixel bounds. Keeps existing overrides unless replace=true. Use dry_run to preview.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          replace: {
            type: "boolean",
            default: false,
            description: "Recompute frames that already have box overrides.",
          },
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_update_timing",
      description:
        "Update animation FPS and optional per-frame duration or disabled playback, or many frames at once via frames. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          fps: { type: "number", minimum: 1, maximum: 120 },
          frame: { type: "integer", minimum: 0 },
          duration_ms: { type: "number", minimum: 1 },
          duration: {
            type: "number",
            minimum: 0.001,
            description: "Frame duration multiplier. 1 equals one FPS tick.",
          },
          disabled: { type: "boolean" },
          frames: {
            type: "array",
            items: { type: "object" },
            description:
              "Batch mode: [{frame, duration_ms?, duration?, disabled?}, ...] applied in one write. Overrides the single-frame parameters.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_set_visual_transform",
      description:
        "Set visual size, offset, and rotation at the character (profile), animation group, or single-frame level. Pass clear=true to remove overrides at that level. Does not sync Godot.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          level: {
            type: "string",
            enum: ["character", "group", "frame"],
            default: "group",
            description:
              "character applies to the whole profile; group to one animation; frame to one frame.",
          },
          frame: { type: "integer", minimum: 0, description: "Required when level=frame." },
          visual_size: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Uniform visual scale multiplier.",
          },
          offset_x: { type: "number" },
          offset_y: { type: "number" },
          rotation: { type: "number", description: "Rotation in radians." },
          clear: {
            type: "boolean",
            default: false,
            description: "Remove all visual overrides at the selected level.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_estimate_visual",
      description:
        "Estimate group and per-frame visual_size so standing height matches a reference animation or target_height. Frames shorter than the native median are treated as camera zoom-out; taller VFX or pose frames keep the group scale. apply writes those scales; bake pixels later with xsxb_cutout apply_visual.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          reference_animation_id: {
            type: "string",
            description:
              "Animation whose median standing height is the target when target_height is omitted.",
          },
          target_height: {
            type: "number",
            exclusiveMinimum: 0,
            description: "Desired standing body height in pixels. Overrides the reference median when set.",
          },
          zoom_ratio: {
            type: "number",
            minimum: 1,
            default: 1.12,
            description: "A frame shorter than native/zoom_ratio is treated as camera zoom-out.",
          },
          apply: {
            type: "boolean",
            default: false,
            description: "Write group and zoom-frame visual_size. Does not bake pixels.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_reorganize_frames",
      description:
        "Atomically reorganize animation frames and remap frame-owned tuning, audio, attachment, and attack-trail state. Defaults to an identity organization test.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          order: {
            type: "array",
            items: { type: "integer", minimum: 0 },
            description: "Source frame indexes in the desired output order. Defaults to the current order.",
          },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_replace_frame",
      description:
        "Replace one workspace frame PNG with a new local PNG while keeping boxes, timing, and bindings. Updates the stored frame size when it changes.",
      inputSchema: {
        type: "object",
        required: ["frame", "file_path"],
        properties: {
          ...animationProperties,
          frame: { type: "integer", minimum: 0 },
          file_path: { type: "string", description: "Absolute replacement PNG path." },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    {
      name: "xsxb_add_attack_trail",
      description:
        "Add or replace one attack-trail segment. Sticks are blade edges (top=tip, bottom=grip) on one swing: start frame when the blade starts moving, end frame at the hit, a mid stick only if the arc bends. layer is behind while the blade is behind the body and front when it is in front. reverseDirection flips the curve handle if the ribbon folds through the body. Path length follows the faster blade edge, so a rotating slash still makes a trailing smear. Auto sticks start at the first frame and end at the last. before_stop_chase defaults to 0.12 so a slash-plus-settle still keeps the slash (拖影); 0 fills the whole swing; 1 hugs the current blade. Receipts include frameSpan, centerTravel, edgeTravel. xsxb_export_gif and xsxb_export_sheet bake the smear onto the preview. Omitting sticks writes a default two-stick trail.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          id: { type: "string", description: "Segment id. Defaults to the texture basename or trail." },
          name: { type: "string" },
          color: { type: "string", description: "#RRGGBB solid color." },
          color_mode: { type: "string", enum: ["solid", "original", "gradient"], default: "solid" },
          texture_path: {
            type: "string",
            description: "Absolute PNG trail texture. Defaults to the built-in luma preset.",
          },
          start_frame: { type: "integer", minimum: 0 },
          end_frame: { type: "integer", minimum: 0 },
          before_stop_chase: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.12,
            description:
              "0.12 keeps a long smear so a follow-through does not erase the slash. 0 fills the whole swing. 1 hugs the current blade.",
          },
          after_stop_chase: {
            type: "number",
            minimum: 0.1,
            maximum: 20,
            default: 2,
            description: "How fast the tail catches the head after the last stick.",
          },
          sticks: {
            type: "array",
            description: "Blade-edge sticks. One swing per segment.",
            items: {
              type: "object",
              properties: {
                frame: { type: "integer", minimum: 0 },
                top: { type: "object", description: "Blade tip in group coordinates." },
                bottom: { type: "object", description: "Blade grip in group coordinates." },
                layer: {
                  type: "string",
                  enum: ["behind", "front"],
                  description: "Draw this stick's mesh behind or in front of the character.",
                },
                reverseDirection: {
                  type: "boolean",
                  description: "Flip the curve handle. Use when the ribbon folds through the body.",
                },
                tangentStrength: {
                  type: "number",
                  description: "Curve handle length. Product default 0.8; omit unless editing in Tuner.",
                },
              },
            },
          },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_add_attachment",
      description:
        "Bind a local PNG as a frame image attachment. file_path is required for a real asset. Pass frames to bind the same asset on many frames in one write.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          file_path: { type: "string", description: "Absolute PNG path to attach." },
          frame: { type: "integer", minimum: 0, default: 0 },
          frames: {
            type: "array",
            items: { type: "object" },
            description:
              "Batch mode: [{frame, offset_x?, offset_y?, scale?, rotation?}, ...] applied in one write. Shared file_path/id/layer apply to every entry. Overrides the single-frame parameters.",
          },
          id: { type: "string" },
          name: { type: "string" },
          layer: { type: "string", enum: ["above", "below"], default: "above" },
          layer_order: { type: "integer", default: 1 },
          offset_x: { type: "number", default: 0 },
          offset_y: { type: "number" },
          scale: { type: "number", default: 1 },
          rotation: { type: "number", default: 0 },
          sync: { type: "boolean", default: true },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_add_sfx",
      description: "Bind a local WAV/OGG/MP3 to one animation frame. file_path is required for a real clip.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          file_path: { type: "string", description: "Absolute audio path." },
          frame: { type: "integer", minimum: 0, default: 0 },
          id: { type: "string" },
          name: { type: "string" },
          sync: { type: "boolean", default: true },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_remove_binding",
      description:
        "Remove one SFX, attachment, or attack-trail binding by id from one animation. Use frame to disambiguate sfx/attachment bindings that share an id. Supports dry_run.",
      inputSchema: {
        type: "object",
        required: ["kind", "id"],
        properties: {
          ...animationProperties,
          kind: { type: "string", enum: ["sfx", "attachment", "trail"] },
          id: { type: "string", description: "Binding or trail segment id." },
          frame: {
            type: "integer",
            minimum: 0,
            description: "Only remove the binding on this frame. Not applicable to trails.",
          },
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_delete_animation",
      description:
        "Delete one imported animation and its owned frames, tuning, and bindings. Supports dry_run.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          dry_run: { type: "boolean", default: false },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_sync_godot",
      description: "Synchronize the current project to its bound Godot root without changing animation data.",
      inputSchema: {
        type: "object",
        properties: { project_id: projectProperty, force: { type: "boolean", default: false } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_validate_project",
      description:
        "Validate standalone XSXB data, generated frames, Godot-synchronized data, assets, and runtime files.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: projectProperty,
          strict: { type: "boolean", default: false },
          require_gameplay: { type: "boolean", default: false },
          layer: {
            type: "string",
            enum: ["all", "standalone", "bind", "gameplay"],
            default: "all",
            description: "Report only one validation layer. Default all, bind errors listed first.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_set_active_project",
      description: "Set the registry active XSXB project used when project_id is omitted.",
      inputSchema: {
        type: "object",
        required: ["project_id"],
        properties: { project_id: projectProperty },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_bind_godot",
      description:
        "Point one XSXB project at an existing Godot root that contains project.godot. Does not sync files.",
      inputSchema: {
        type: "object",
        required: ["project_root"],
        properties: {
          project_id: projectProperty,
          project_root: { type: "string", description: "Absolute Godot project directory." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_cutout",
      description:
        "Run the tuner smart-cutout product path on every animation frame. Slider names and ranges match the cutout workbench; omit them to keep the shared smart-cutout profile. Omitting the canvas keeps the source layout; an explicit canvas shares one scale and pins body feet to the bottom. apply_visual rematches from group/frame visual_size instead of that shared scale. Character visual_size stays playback-only and is not baked.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          key_color: {
            type: "string",
            description: "Optional #RRGGBB key. Omit to auto-detect the same background as the tuner.",
          },
          output_width: {
            type: "integer",
            minimum: 8,
            maximum: 4096,
            description: "Optional canvas width. Omit to keep each frame's source size.",
          },
          output_height: {
            type: "integer",
            minimum: 8,
            maximum: 4096,
            description: "Optional canvas height. Defaults to output_width when only width is set.",
          },
          protected_colors: {
            type: "array",
            items: { type: "string" },
            description: "Optional #RRGGBB colors to keep, same as the tuner protect-color list.",
          },
          ...workbenchSliderSchemaProperties(),
          force: {
            type: "boolean",
            default: false,
            description: "Re-cut frames whose borders are already transparent.",
          },
          apply_visual: {
            type: "boolean",
            default: false,
            description:
              "Rematch using group/frame visual_size instead of one shared scale. Requires or infers a canvas. Character visual_size is not baked.",
          },
          metrics: {
            type: "boolean",
            default: true,
            description:
              "Include per-frame bodyHeight, feetY, and leftover near-white counts on the receipt.",
          },
          sync: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    {
      name: "xsxb_export_gif",
      description:
        "Export one animation as an animated GIF preview via FFmpeg, honoring per-frame durations, group/frame visual_size, and authored attack-trail meshes. Skips disabled frames. Returns the absolute output path.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          output_path: {
            type: "string",
            description:
              "Absolute .gif destination. Defaults to <workspace>/exports/<profile>_<animation>.gif.",
          },
          fps: { type: "number", minimum: 1, maximum: 120, description: "Defaults to the animation FPS." },
          start_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          end_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          include_disabled: {
            type: "boolean",
            default: false,
            description: "Also render frames whose playback is disabled.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_export_sheet",
      description:
        "Export a contact sheet PNG that scales every source canvas into a shared cell so standing size, leftover dirt, and authored attack-trail meshes stay comparable. Every cell is labeled with its absolute 0-based index and the tuner group-coordinate grid (foot origin 0,0; body is negative y). mark_frame highlights one cell for a second cull pass. output_path must stay inside the XSXB root.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          output_path: {
            type: "string",
            description:
              "Absolute .png destination. Defaults to <workspace>/exports/<profile>_<animation>_sheet.png.",
          },
          start_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          end_frame: { type: "integer", minimum: 0, description: "Inclusive 0-based frame index." },
          mark_frame: {
            type: "integer",
            minimum: 0,
            description:
              "Absolute 0-based frame to highlight. Defaults to start_frame so the loop start is marked.",
          },
          columns: {
            type: "integer",
            minimum: 1,
            maximum: 32,
            description: "Cells per row. Defaults to min(frameCount, 8).",
          },
          cell: {
            type: "integer",
            minimum: 8,
            maximum: 1024,
            default: 220,
            description: "Shared cell edge in pixels. Every source canvas is scaled into this cell.",
          },
          pad: { type: "integer", minimum: 1, maximum: 64, default: 8 },
          grid: {
            type: "boolean",
            default: true,
            description: "Paint the tuner group-coordinate axes and ticks. Origin is the canvas foot.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_measure_image",
      description:
        'Measure a PNG\'s long axis. The pommel is the end closer to the widest cross-section (guard or forte); the far end is the tip. Pass t for a handle fraction (0=pommel, 0.5=middle, 0.666 or "2/3", 1=tip). Returns image-pixel landmarks. localFromCenter is the grip relative to the image center; attachment offset = hand - localFromCenter. Does not bind or write frames.',
      inputSchema: {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Absolute PNG path of the weapon or sprite." },
          t: {
            type: "number",
            minimum: 0,
            maximum: 1,
            default: 0.5,
            description: "Grip fraction along pommel→tip. 0.5 is the middle; send 0.666… or the string 2/3.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    {
      name: "xsxb_open_tuner",
      description:
        "Start the local Tuner if needed and return a workspace URL focused on one project, profile, and animation.",
      inputSchema: {
        type: "object",
        properties: {
          ...animationProperties,
          start: {
            type: "boolean",
            default: true,
            description: "Start the Tuner process when it is not listening.",
          },
          port: { type: "integer", minimum: 1, maximum: 65535, default: 5179 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ];
}

module.exports = { DEFAULT_PROFILE_ID, MCP_TOOL_NAMES, toolDefinitions };
