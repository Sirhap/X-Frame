"use strict";

const { createXsxbMcpService } = require("./xsxb_mcp_service");

module.exports = async function xsxb_update_frame_boxes(args = {}) {
  return createXsxbMcpService().call("xsxb_update_frame_boxes", args);
};

module.exports.description = "Update hurtbox, collisionbox, and hitbox for one animation frame.";
module.exports.inputSchema = {
  type: "object",
  properties: {
    project_id: { type: "string" },
    profile_id: { type: "string" },
    animation_id: { type: "string" },
    frame: { type: "integer" },
    hurtbox: { type: "object" },
    collisionbox: { type: "object" },
    hitbox: { type: "object" },
    sync: { type: "boolean" },
  },
};
