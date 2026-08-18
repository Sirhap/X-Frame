"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateToolArguments } = require("../xsxb_mcp_schema");
const { toolDefinitions } = require("../xsxb_mcp_service");

const SCHEMA = Object.freeze({
  type: "object",
  required: ["file_path"],
  properties: {
    file_path: { type: "string" },
    fps: { type: "number", minimum: 1, maximum: 120, default: 12 },
    start_frame: { type: "integer", minimum: 0 },
    sync: { type: "boolean" },
    layer: { type: "string", enum: ["standalone", "bind", "gameplay"] },
    protected_colors: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
});

/**
 * Captures the message of the error a validation raises.
 * @param {object} args Tool arguments.
 * @returns {string} Error message, or an empty string when it passed.
 */
function validationError(args) {
  try {
    validateToolArguments("xsxb_demo", SCHEMA, args);
    return "";
  } catch (error) {
    return error.message;
  }
}

test("an unknown property is rejected and named", () => {
  const message = validationError({ file_path: "/tmp/a.mp4", animaton_id: "idle" });

  assert.match(message, /animaton_id/u, "the offending property is named");
  assert.match(message, /xsxb_demo/u, "the tool is named");
});

test("an unknown property suggests the closest declared name", () => {
  assert.match(validationError({ file_path: "/tmp/a.mp4", start_frames: 2 }), /start_frame/u);
});

test("a missing required property is rejected", () => {
  assert.match(validationError({ fps: 12 }), /file_path/u);
});

test("a value outside the declared enum is rejected", () => {
  const message = validationError({ file_path: "/tmp/a.mp4", layer: "gamplay" });

  assert.match(message, /layer/u);
  assert.match(message, /standalone/u, "the accepted values are listed");
});

test("numbers outside the declared range are rejected", () => {
  assert.match(validationError({ file_path: "/tmp/a.mp4", fps: 500 }), /fps/u);
  assert.match(validationError({ file_path: "/tmp/a.mp4", start_frame: -1 }), /start_frame/u);
});

test("an exclusive lower bound rejects the bound itself", () => {
  const schema = {
    type: "object",
    properties: { visual_size: { type: "number", exclusiveMinimum: 0 } },
    additionalProperties: false,
  };

  assert.throws(() => validateToolArguments("xsxb_demo", schema, { visual_size: 0 }), /visual_size/u);
  validateToolArguments("xsxb_demo", schema, { visual_size: 0.5 });
});

test("a structurally wrong type is rejected", () => {
  assert.match(validationError({ file_path: { path: "/tmp/a.mp4" } }), /file_path/u);
  assert.match(validationError({ file_path: "/tmp/a.mp4", fps: "soon" }), /fps/u);
  assert.match(
    validationError({ file_path: "/tmp/a.mp4", protected_colors: "#ffffff" }),
    /protected_colors/u,
  );
  assert.match(validationError({ file_path: "/tmp/a.mp4", start_frame: 1.5 }), /start_frame/u);
});

test("array items are checked against their declared type", () => {
  assert.match(validationError({ file_path: "/tmp/a.mp4", protected_colors: [{}] }), /protected_colors/u);
});

// The handlers deliberately accept the stringified numbers and booleans that
// agents send. Validation must not narrow the surface that already works.
test("the leniency the handlers already implement is preserved", () => {
  assert.equal(validationError({ file_path: "/tmp/a.mp4", fps: "24" }), "");
  assert.equal(validationError({ file_path: "/tmp/a.mp4", start_frame: "3" }), "");
  assert.equal(validationError({ file_path: "/tmp/a.mp4", sync: "true" }), "");
  assert.equal(validationError({ file_path: "/tmp/a.mp4", sync: 1 }), "");
  assert.equal(validationError({ file_path: "/tmp/a.mp4", fps: undefined }), "");
});

test("number fields accept a simple a/b fraction", () => {
  const schema = toolDefinitions().find((tool) => tool.name === "xsxb_measure_image").inputSchema;
  validateToolArguments("xsxb_measure_image", schema, { file_path: "/tmp/blade.png", t: "2/3" });
});

test("a valid argument set passes", () => {
  assert.equal(
    validationError({
      file_path: "/tmp/a.mp4",
      fps: 12,
      start_frame: 0,
      sync: false,
      layer: "bind",
      protected_colors: ["#ffffff"],
    }),
    "",
  );
});

test("every declared tool schema is one this validator understands", () => {
  const supported = new Set([
    "type",
    "description",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "items",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "default",
  ]);
  for (const tool of toolDefinitions()) {
    const schema = tool.inputSchema;
    assert.equal(schema.type, "object", `${tool.name} declares an object schema`);
    assert.equal(schema.additionalProperties, false, `${tool.name} closes its schema`);
    for (const [name, property] of Object.entries(schema.properties || {})) {
      for (const keyword of Object.keys(property)) {
        assert.ok(
          supported.has(keyword),
          `${tool.name}.${name} uses unsupported schema keyword "${keyword}"`,
        );
      }
    }
  }
});
