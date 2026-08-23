"use strict";

const PROMPTS = Object.freeze({
  weapon_attachment: {
    title: "Review and apply a held weapon",
    description:
      "Measure a weapon, review hand/tip anchors, approve the visual artifact, and apply atomically.",
    text: "Use the XSXB weapon_attachment workflow. Inspect every returned image artifact. Do not approve a v2 plan unless the grip stays on the hand and the tip direction matches every pose. Use human_review when image input is unavailable.",
  },
  weapon_trail: {
    title: "Review a weapon-derived attack trail",
    description: "Derive trail sticks from a held weapon and review baked-FX overlap before applying.",
    text: "Run xsxb_add_attack_trail with dry_run=true first. Inspect its review artifact, sourceFxOverlapRatio, grip continuity, tip sweep, and layer changes. Apply only after visual approval.",
  },
  cutout_review: {
    title: "Review animation cutout quality",
    description: "Inspect transparency, character preservation, feet alignment, and stale boxes.",
    text: "Inspect the post-cutout contact sheet and metrics. Reject missing body pixels, leftover plate pixels, foot drift, or stale boxes. Use reestimate_boxes=true when saved boxes predate the cutout.",
  },
  delivery_review: {
    title: "Review final XSXB delivery",
    description: "Review GIF timing, contact sheet composition, bindings, and Godot validation.",
    text: "Inspect the final contact sheet and GIF resource. Confirm attachment/trail layer order, timing, disabled frames, scale, anchors, and strict standalone/bind validation before delivery.",
  },
});

function createPromptRegistry() {
  return {
    async list() {
      return {
        prompts: Object.entries(PROMPTS).map(([name, prompt]) => ({
          name,
          title: prompt.title,
          description: prompt.description,
          arguments: [],
        })),
      };
    },
    async get(params = {}) {
      const name = String(params.name || "");
      const prompt = PROMPTS[name];
      if (!prompt) {
        const error = new Error(`Unknown XSXB prompt: ${name}`);
        error.code = -32602;
        throw error;
      }
      return {
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
      };
    },
  };
}

module.exports = { PROMPTS, createPromptRegistry };
