"use strict";

const WORKFLOW_NAMES = Object.freeze([
  "video_loop",
  "one_shot",
  "cutout",
  "visual_match",
  "attachments",
  "weapon_attachment",
  "weapon_trail",
  "godot_sync",
  "export",
]);

const FAILURE_FEEDBACK =
  "If a tool errors, a capability is missing, or completing the request requires leaving MCP, report it to the user and raise it to XSXB-Frame-Tuner with the tool, arguments, receipt/error, expected result, and actual result.";
const VISUAL_WORKFLOWS = new Set([
  "video_loop",
  "one_shot",
  "cutout",
  "visual_match",
  "attachments",
  "weapon_attachment",
  "weapon_trail",
  "export",
]);

const WORKFLOWS = Object.freeze({
  video_loop: {
    preconditions: ["A local video or imported animation is available."],
    steps: [
      { tool: "xsxb_import_animation", purpose: "Import native video frames." },
      { tool: "xsxb_find_duplicates", purpose: "Remove duplicate holds without mutating first." },
      { tool: "xsxb_cutout", purpose: "Apply the shared workbench cutout profile." },
      { tool: "xsxb_find_loop", purpose: "Rank loop candidates." },
      { tool: "xsxb_reorganize_frames", purpose: "Apply the reviewed frame order." },
      { tool: "xsxb_export_gif", purpose: "Render the kept loop." },
    ],
    completionChecks: ["The GIF loops smoothly and contains only reviewed frames."],
  },
  one_shot: {
    preconditions: ["An imported one-shot animation is available."],
    steps: [
      {
        tool: "xsxb_find_motion",
        purpose: "Cut out opaque sources first; use preset=attack to preserve anticipation and recovery.",
      },
      { tool: "xsxb_reorganize_frames", purpose: "Apply the reviewed motion window." },
      { tool: "xsxb_export_gif", purpose: "Review the one-shot timing." },
    ],
    completionChecks: ["The action begins and ends without unintended hold frames."],
  },
  cutout: {
    preconditions: ["Animation PNG frames exist on disk."],
    steps: [
      {
        tool: "xsxb_cutout",
        purpose: "Use shared defaults and reestimate_boxes=true when existing boxes predate the cutout.",
      },
      { tool: "xsxb_export_sheet", purpose: "Review transparency and leftover background pixels." },
    ],
    completionChecks: ["Body pixels remain and background pixels are transparent."],
  },
  visual_match: {
    preconditions: ["A reference animation or target height is known."],
    steps: [
      { tool: "xsxb_estimate_visual", purpose: "Estimate group and exceptional-frame scales." },
      { tool: "xsxb_export_sheet", purpose: "Compare standing heights." },
      { tool: "xsxb_cutout", purpose: "Bake reviewed visual transforms when requested." },
    ],
    completionChecks: ["Standing scale and foot origin match the reference."],
  },
  attachments: {
    preconditions: ["A local PNG attachment is available."],
    steps: [
      { tool: "xsxb_add_attachment", purpose: "Bind explicit per-frame transforms." },
      { tool: "xsxb_export_sheet", purpose: "Review layer and placement." },
    ],
    completionChecks: ["The attachment is visible in the workbench and exported preview."],
  },
  weapon_attachment: {
    preconditions: ["The character animation and transparent weapon PNG are available."],
    steps: [
      { tool: "xsxb_export_sheet", purpose: "Read hand and tip targets from the group-coordinate grid." },
      {
        tool: "xsxb_measure_image",
        purpose: "Measure the weapon axis; correct ambiguous blades with endpoint hints or flip_axis.",
      },
      {
        tool: "xsxb_plan_attachment",
        purpose: "Plan anchors with response_mode=compact and review the marked preview.",
      },
      { tool: "xsxb_add_attachment", purpose: "Apply plan_id with confirm=true." },
      { tool: "xsxb_export_sheet", purpose: "Verify grip, tip, scale, and front/back layers." },
      { tool: "xsxb_sync_godot", purpose: "Synchronize only after visual verification." },
    ],
    completionChecks: [
      "The weapon grip stays on the hand in every planned frame.",
      "The tip direction and front/back layer match the pose.",
    ],
  },
  weapon_trail: {
    preconditions: ["A confirmed multi-frame weapon attachment exists."],
    steps: [
      {
        tool: "xsxb_add_attack_trail",
        purpose:
          "Derive sticks with attachment_id; inspect sourceFxOverlapRatio and tune opacity/blade_width_scale.",
      },
      { tool: "xsxb_export_sheet", purpose: "Check the ribbon against weapon tips and body layers." },
      { tool: "xsxb_export_gif", purpose: "Review smear growth and release through playback." },
      { tool: "xsxb_sync_godot", purpose: "Synchronize the reviewed trail." },
    ],
    completionChecks: ["Every stick bottom follows the grip and every top follows the weapon tip."],
  },
  godot_sync: {
    preconditions: ["The XSXB project is bound to an existing Godot project."],
    steps: [
      { tool: "xsxb_bind_godot", purpose: "Bind or repair the Godot root." },
      { tool: "xsxb_validate_project", purpose: "Validate standalone and bind layers." },
      {
        tool: "xsxb_sync_godot",
        purpose:
          "Dry-run the inventory, then restrict include_animation_ids when diagnostics must stay local.",
      },
      { tool: "xsxb_validate_project", purpose: "Validate gameplay output." },
    ],
    completionChecks: ["Bind and gameplay validation report no errors."],
  },
  export: {
    preconditions: ["Animation frames and tuning data exist."],
    steps: [
      { tool: "xsxb_export_sheet", purpose: "Review labeled frames and layer composition." },
      { tool: "xsxb_export_gif", purpose: "Review final timing and motion." },
    ],
    completionChecks: ["Attachments, trails, timing, scale, and disabled frames match the workbench."],
  },
});

/**
 * Returns one on-demand MCP workflow.
 * @param {string} name Workflow name.
 * @returns {object} Serializable workflow.
 */
function getWorkflow(name) {
  const workflow = String(name || "");
  const definition = WORKFLOWS[workflow];
  if (!definition)
    throw new Error(`Unknown XSXB workflow: ${workflow}. Available: ${WORKFLOW_NAMES.join(", ")}`);
  return {
    workflow,
    ...definition,
    ...(VISUAL_WORKFLOWS.has(workflow)
      ? {
          requiredCapabilities: ["image_input"],
          fallback: "human_review",
          canAutoApplyWithoutVision: false,
        }
      : {
          requiredCapabilities: [],
          fallback: "none",
          canAutoApplyWithoutVision: true,
        }),
    failureFeedback: FAILURE_FEEDBACK,
  };
}

module.exports = { FAILURE_FEEDBACK, WORKFLOW_NAMES, getWorkflow };
