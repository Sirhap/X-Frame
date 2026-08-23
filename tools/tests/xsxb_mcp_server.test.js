"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PassThrough } = require("node:stream");
const { createProjectStore } = require("../project_store");
const { INSTRUCTIONS, handleMessage, startServer } = require("../xsxb_mcp_server");
const {
  MCP_TOOL_NAMES,
  booleanFlag,
  classifyValidationMessage,
  createTestWav,
  createXsxbMcpService,
  requireFps,
  requireFrameIndex,
  toolDefinitions,
} = require("../xsxb_mcp_service");
const { decodePngRgba, encodePngRgba, subjectAnchor } = require("../xsxb_mcp_cutout");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkM0WQAAAABJRU5ErkJggg==",
  "base64",
);

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xsxb-mcp-test-"));
  const godotRoot = path.join(root, "godot");
  fs.mkdirSync(godotRoot, { recursive: true });
  fs.writeFileSync(path.join(godotRoot, "project.godot"), '[application]\nconfig/name="MCP Test"\n');
  const presetPath = path.join(
    root,
    "tools/animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png",
  );
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "../animation_tuner/public/presets/attack_trails/dynamic_trail_luma.png"),
    presetPath,
  );
  const store = createProjectStore(root);
  store.addProject({ id: "mcp-test", label: "MCP Test", projectRoot: godotRoot });
  const video = path.join(root, "source.mp4");
  fs.writeFileSync(video, "test-video-placeholder");
  const extractVideoFramesImpl = async (_videoPath, outputDirectory) => {
    return Array.from({ length: 3 }, (_, index) => {
      const framePath = path.join(outputDirectory, `frame_${String(index + 1).padStart(6, "0")}.png`);
      fs.writeFileSync(framePath, ONE_PIXEL_PNG);
      return framePath;
    });
  };
  const serviceOptions = {
    root,
    extractVideoFramesImpl: options.extractVideoFramesImpl || extractVideoFramesImpl,
  };
  if (options.compositeTrailImpl) serviceOptions.compositeTrailImpl = options.compositeTrailImpl;
  if (!options.realCutout) {
    serviceOptions.cutoutPngFileImpl = async (inputPath, outputPath) => {
      fs.copyFileSync(inputPath, outputPath);
    };
  }
  return {
    root,
    godotRoot,
    video,
    service: createXsxbMcpService(serviceOptions),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("MCP tool catalog exposes the required XSXB tools in the requested order", () => {
  assert.deepEqual(
    toolDefinitions().map((tool) => tool.name),
    MCP_TOOL_NAMES,
  );
  for (const tool of toolDefinitions()) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.title, "string", `${tool.name} title`);
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} output schema`);
    assert.ok(tool.outputSchema.required?.length > 0, `${tool.name} declares a stable output field`);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name} ${hint}`);
    }
    assert.equal(tool.annotations.openWorldHint, false, `${tool.name} stays on the local machine`);
  }
  assert.equal(MCP_TOOL_NAMES.length, 34);
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_get_workflow"));
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_create_project"));
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_list_project_revisions"));
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_restore_project_revision"));
  assert.ok(toolDefinitions().every((tool) => tool.outputSchema.additionalProperties === false));
});

test("create_project previews and creates an unbound local project", async () => {
  const current = fixture();
  try {
    const before = await current.service.call("xsxb_list_projects");
    const preview = await current.service.call("xsxb_create_project", {
      id: "assassin-qa",
      label: "Assassin QA",
      kind: "scratch",
      dry_run: true,
    });
    assert.equal(preview.projectId, "assassin-qa");
    assert.equal(preview.created, false);
    assert.equal(preview.dryRun, true);
    assert.equal((await current.service.call("xsxb_list_projects")).count, before.count);

    const created = await current.service.call("xsxb_create_project", {
      id: "assassin-qa",
      label: "Assassin QA",
      kind: "scratch",
    });
    assert.equal(created.projectId, "assassin-qa");
    assert.equal(created.created, true);
    assert.equal(created.project.kind, "scratch");
    assert.equal(created.project.projectRoot, "");
    assert.equal((await current.service.call("xsxb_list_projects")).activeProjectId, "assassin-qa");
    const syncPreview = await current.service.call("xsxb_sync_godot", {
      project_id: "assassin-qa",
      dry_run: true,
    });
    assert.equal(syncPreview.requested, false);
    assert.deepEqual(syncPreview.availableAnimationIds, []);
  } finally {
    current.cleanup();
  }
});

test("MCP transport initializes, lists tools, and returns structured tool results", async () => {
  const service = { tools: toolDefinitions(), call: async () => ({ ok: true, value: 42 }) };
  const initialized = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    service,
  );
  assert.equal(initialized.result.serverInfo.name, "xsxb-frame-tuner");
  assert.equal(initialized.result.protocolVersion, "2025-06-18");
  assert.deepEqual(initialized.result.capabilities.resources, { listChanged: true });
  assert.deepEqual(initialized.result.capabilities.prompts, { listChanged: false });
  assert.deepEqual(initialized.result.capabilities.logging, {});
  assert.match(initialized.result.instructions, /XSXB-Frame-Tuner/);
  assert.match(initialized.result.instructions, /missing capability|leave MCP|raise it/i);
  assert.equal(initialized.result.instructions, INSTRUCTIONS);
  assert.ok(
    INSTRUCTIONS.length < 1500,
    `initialize instructions must stay compact, got ${INSTRUCTIONS.length}`,
  );
  const fallbackVersion = await handleMessage(
    { jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2099-01-01" } },
    service,
  );
  assert.equal(fallbackVersion.result.protocolVersion, "2025-11-25");
  const listed = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, service);
  assert.equal(listed.result.tools.length, MCP_TOOL_NAMES.length);
  const called = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "xsxb_list_projects" } },
    service,
  );
  assert.deepEqual(called.result.structuredContent, { ok: true, value: 42 });
  assert.equal(called.result.isError, false);
});

test("get_workflow returns on-demand weapon attachment and trail completion steps", async () => {
  const current = fixture();
  try {
    const attachment = await current.service.call("xsxb_get_workflow", {
      workflow: "weapon_attachment",
    });
    assert.equal(attachment.workflow, "weapon_attachment");
    assert.deepEqual(
      attachment.steps.map((step) => step.tool),
      [
        "xsxb_export_sheet",
        "xsxb_measure_image",
        "xsxb_plan_attachment",
        "xsxb_add_attachment",
        "xsxb_export_sheet",
        "xsxb_sync_godot",
      ],
    );
    assert.ok(attachment.completionChecks.some((check) => /grip/i.test(check)));
    assert.deepEqual(attachment.requiredCapabilities, ["image_input"]);
    assert.equal(attachment.fallback, "human_review");
    assert.equal(attachment.canAutoApplyWithoutVision, false);

    const trail = await current.service.call("xsxb_get_workflow", { workflow: "weapon_trail" });
    assert.ok(trail.steps.some((step) => step.tool === "xsxb_add_attack_trail"));
    assert.ok(trail.failureFeedback.includes("XSXB-Frame-Tuner"));
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("STDIO close releases service-owned resources", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let closes = 0;
  const lines = startServer({
    input,
    output,
    service: {
      tools: [],
      call: async () => ({}),
      close: async () => {
        closes += 1;
      },
    },
  });
  input.end();
  await new Promise((resolve) => lines.once("close", resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
});

test("a failing tool answers with an MCP error result instead of a transport error", async () => {
  const service = {
    tools: toolDefinitions(),
    call: async () => {
      const error = new Error("Animation not found: ghost");
      error.code = "xsxb_missing_animation";
      throw error;
    },
  };

  const called = await handleMessage(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "xsxb_get_animation" } },
    service,
  );

  assert.equal(called.error, undefined, "a tool failure is not a JSON-RPC error");
  assert.equal(called.result.isError, true);
  assert.equal(
    called.result.structuredContent,
    undefined,
    "error content does not violate success outputSchema",
  );
  assert.match(called.result.content[0].text, /ghost/u);
  assert.deepEqual(JSON.parse(called.result.content[0].text), {
    ok: false,
    error: "Animation not found: ghost",
    code: "xsxb_missing_animation",
  });
});

test("unknown methods and malformed requests answer with JSON-RPC errors", async () => {
  const service = { tools: toolDefinitions(), call: async () => ({ ok: true }) };

  const unknown = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/destroy" }, service);
  assert.equal(unknown.error.code, -32601);
  assert.match(unknown.error.message, /tools\/destroy/u);
  assert.equal(unknown.id, 1);

  const methodless = await handleMessage({ jsonrpc: "2.0", id: 2 }, service);
  assert.equal(methodless.error.code, -32600);

  const unknownTool = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "xsxb_nope" } },
    { tools: [], call: createXsxbMcpService().call },
  );
  assert.equal(unknownTool.error.code, -32602);
  assert.match(unknownTool.error.message, /Unknown XSXB MCP tool/u);

  const malformedArguments = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "xsxb_list_projects", arguments: ["not", "an", "object"] },
    },
    service,
  );
  assert.equal(malformedArguments.error.code, -32602);
  assert.match(malformedArguments.error.message, /arguments.*object/iu);
});

test("transport preserves mixed multimodal content and exposes resources and prompts", async () => {
  const service = {
    tools: [{ name: "visual", inputSchema: { type: "object" } }],
    call: async () => ({ ok: true, artifactId: "review_1" }),
    formatToolResult: (result) => ({
      content: [
        { type: "text", text: JSON.stringify(result) },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        {
          type: "resource_link",
          uri: "xsxb://projects/demo/reviews/review_1/full.png",
          name: "full.png",
          mimeType: "image/png",
        },
      ],
      structuredContent: result,
      isError: false,
    }),
    resources: {
      list: async () => ({ resources: [{ uri: "xsxb://projects/demo/reviews/review_1/full.png" }] }),
      templates: async () => ({
        resourceTemplates: [{ uriTemplate: "xsxb://projects/{project}/reviews/{id}/{asset}" }],
      }),
      read: async () => ({
        contents: [{ uri: "xsxb://projects/demo/reviews/review_1/full.png", blob: "aGVsbG8=" }],
      }),
    },
    prompts: {
      list: async () => ({ prompts: [{ name: "weapon_attachment" }] }),
      get: async () => ({ description: "weapon", messages: [] }),
    },
  };
  const called = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "visual", arguments: {} } },
    service,
  );
  assert.deepEqual(
    called.result.content.map((entry) => entry.type),
    ["text", "image", "resource_link"],
  );
  assert.equal(called.result.structuredContent.artifactId, "review_1");
  assert.equal(
    (await handleMessage({ jsonrpc: "2.0", id: 2, method: "resources/list" }, service)).result.resources
      .length,
    1,
  );
  assert.equal(
    (await handleMessage({ jsonrpc: "2.0", id: 3, method: "resources/templates/list" }, service)).result
      .resourceTemplates.length,
    1,
  );
  assert.equal(
    (
      await handleMessage(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "resources/read",
          params: { uri: "xsxb://projects/demo/reviews/review_1/full.png" },
        },
        service,
      )
    ).result.contents[0].blob,
    "aGVsbG8=",
  );
  assert.equal(
    (await handleMessage({ jsonrpc: "2.0", id: 5, method: "prompts/list" }, service)).result.prompts[0].name,
    "weapon_attachment",
  );
  assert.equal(
    (
      await handleMessage(
        { jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: "weapon_attachment" } },
        service,
      )
    ).result.description,
    "weapon",
  );
});

test("resource failures and logging level negotiation use MCP protocol responses", async () => {
  let selectedLevel = "";
  const service = {
    tools: [],
    resources: {
      async read() {
        throw new Error("Review artifact not found: review_missing");
      },
    },
    setLogLevel(level) {
      selectedLevel = level;
    },
  };

  const missingUri = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "resources/read", params: {} },
    service,
  );
  assert.equal(missingUri.error.code, -32602);

  const missingResource = await handleMessage(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "xsxb://projects/demo/reviews/review_missing/full.png" },
    },
    service,
  );
  assert.equal(missingResource.error.code, -32002);
  assert.match(missingResource.error.message, /not found/u);

  const configured = await handleMessage(
    { jsonrpc: "2.0", id: 3, method: "logging/setLevel", params: { level: "notice" } },
    service,
  );
  assert.deepEqual(configured.result, {});
  assert.equal(selectedLevel, "notice");

  const invalidLevel = await handleMessage(
    { jsonrpc: "2.0", id: 4, method: "logging/setLevel", params: { level: "verbose" } },
    service,
  );
  assert.equal(invalidLevel.error.code, -32602);
});

test("service logging emits sanitized MCP notifications at the negotiated threshold", async () => {
  const current = fixture();
  const notifications = [];
  try {
    current.service.setNotifier((message) => notifications.push(message));
    current.service.setLogLevel("info");
    await current.service.call("xsxb_list_projects", {}, { requestId: "log-probe" });
    const completed = notifications.find(
      (message) =>
        message.method === "notifications/message" && message.params?.data?.event === "tool_completed",
    );
    assert.equal(completed.params.level, "info");
    assert.equal(completed.params.logger, "xsxb-frame-tuner");
    assert.deepEqual(completed.params.data, {
      event: "tool_completed",
      tool: "xsxb_list_projects",
      requestId: "log-probe",
    });
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("notifications are executed without a response", async () => {
  const service = { tools: toolDefinitions(), call: async () => ({ ok: true }) };

  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, service), null);
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "ping" }, service), null);
});

test("STDIO transport answers unparsable lines and keeps serving the next request", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const lines = startServer({
    input,
    output,
    service: { tools: toolDefinitions(), call: async () => ({ projects: [] }) },
  });

  input.write("{ not json at all\n");
  input.write("   \n");
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  lines.close();

  const responses = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(responses.length, 2, "blank lines and notifications produce no response");
  assert.equal(responses[0].error.code, -32700);
  assert.match(responses[0].error.message, /Parse error/u);
  assert.equal(responses[1].id, 9, "the transport keeps serving after a parse error");
  assert.deepEqual(responses[1].result, {});
});

test("STDIO server accepts newline-delimited JSON-RPC", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  const lines = startServer({
    input,
    output,
    service: { tools: toolDefinitions(), call: async () => ({ projects: [] }) },
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  lines.close();
  const response = JSON.parse(text.trim());
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.length, MCP_TOOL_NAMES.length);
});

test("STDIO transport emits progress and cancellation bypasses an in-flight call", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let cancelled = null;
  let release;
  output.on("data", (chunk) => {
    for (const line of chunk.toString().trim().split("\n").filter(Boolean)) messages.push(JSON.parse(line));
  });
  const service = {
    tools: [{ name: "slow", inputSchema: { type: "object" } }],
    async call(_name, _args, execution) {
      execution.progress({ progress: 1, total: 2, message: "half" });
      await new Promise((resolve) => {
        release = resolve;
      });
      return { ok: true };
    },
    cancel(requestId, reason) {
      cancelled = { requestId, reason };
      release?.();
      return true;
    },
    close: async () => {},
  };
  const lines = startServer({ input, output, service });
  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "slow", arguments: {}, _meta: { progressToken: "progress-42" } },
    })}\n`,
  );
  await new Promise((resolve) => setImmediate(resolve));
  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 42, reason: "stop" },
    })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  input.end();
  await new Promise((resolve) => lines.once("close", resolve));
  assert.deepEqual(cancelled, { requestId: 42, reason: "stop" });
  const progress = messages.find((message) => message.method === "notifications/progress");
  assert.equal(progress.params.progressToken, "progress-42");
  assert.equal(progress.params.message, "half");
  assert.ok(messages.some((message) => message.id === 42));
});

test("nested cutout review progress remains strictly increasing", async () => {
  const current = fixture({
    async compositeTrailImpl(job) {
      return {
        framePaths: job.framePaths,
        tempDir: null,
        bakedTrails: false,
        bakedAttachments: false,
        trailIds: [],
        attachmentIds: [],
      };
    },
  });
  const updates = [];
  try {
    const framePng = encodePngRgba(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    await current.service.call("xsxb_import_animation", {
      source: "items",
      items: Array.from({ length: 5 }, (_, index) => ({
        name: `frame_${index}.png`,
        data: `data:image/png;base64,${framePng.toString("base64")}`,
      })),
      animation_id: "progress",
    });
    await current.service.call(
      "xsxb_cutout",
      { animation_id: "progress", metrics: false },
      { requestId: "cutout-progress", progress: (update) => updates.push(update) },
    );
    assert.ok(updates.length > 5);
    for (let index = 1; index < updates.length; index += 1) {
      assert.ok(updates[index].progress > updates[index - 1].progress, JSON.stringify(updates));
      assert.ok(updates[index].total >= updates[index].progress);
    }
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("real cutout worker cancellation stays responsive and rolls back frame files", async () => {
  const current = fixture({
    realCutout: true,
    async compositeTrailImpl(job) {
      return {
        framePaths: job.framePaths,
        tempDir: null,
        bakedTrails: false,
        bakedAttachments: false,
        trailIds: [],
        attachmentIds: [],
      };
    },
  });
  try {
    const width = 768;
    const height = 768;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba.set([24, 24, 24, 255], offset);
    }
    const framePng = encodePngRgba(rgba, width, height);
    await current.service.call("xsxb_import_animation", {
      source: "items",
      items: Array.from({ length: 6 }, (_, index) => ({
        name: `frame_${index}.png`,
        data: `data:image/png;base64,${framePng.toString("base64")}`,
      })),
      animation_id: "cancel_cutout",
    });
    const imported = await current.service.call("xsxb_get_animation", {
      animation_id: "cancel_cutout",
    });
    const framePaths = imported.animation.frames.map((frame) => frame.absolutePath);
    const before = framePaths.map((filePath) => fs.readFileSync(filePath));
    const pending = current.service.call(
      "xsxb_cutout",
      {
        animation_id: "cancel_cutout",
        key_color: "#000000",
        force: true,
        metrics: false,
      },
      {
        requestId: "real-cutout-cancel",
        progress(update) {
          if (update.message === "cutout_write") {
            current.service.cancel("real-cutout-cancel", "stop-real-cutout");
          }
        },
      },
    );
    await assert.rejects(pending, /stop-real-cutout/u);
    framePaths.forEach((filePath, index) => {
      assert.deepEqual(fs.readFileSync(filePath), before[index]);
    });
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("a queued implicit-project write keeps the project selected when it entered the queue", async () => {
  let releaseFirstComposite;
  let signalFirstComposite;
  let compositeCount = 0;
  const firstCompositeStarted = new Promise((resolve) => {
    signalFirstComposite = resolve;
  });
  const current = fixture({
    async compositeTrailImpl(job) {
      compositeCount += 1;
      if (compositeCount === 1) {
        signalFirstComposite();
        await new Promise((resolve) => {
          releaseFirstComposite = resolve;
        });
      }
      return {
        framePaths: job.framePaths,
        tempDir: null,
        bakedTrails: true,
        bakedAttachments: false,
        trailIds: ["trail"],
        attachmentIds: [],
      };
    },
  });
  try {
    await current.service.call("xsxb_create_project", { id: "other-project", label: "Other" });
    const framePng = encodePngRgba(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const item = { name: "frame.png", data: `data:image/png;base64,${framePng.toString("base64")}` };
    await current.service.call("xsxb_import_animation", {
      project_id: "other-project",
      source: "items",
      items: [item],
      animation_id: "attack",
    });
    await current.service.call("xsxb_import_animation", {
      project_id: "mcp-test",
      source: "items",
      items: [item],
      animation_id: "attack",
    });
    await current.service.call("xsxb_import_animation", {
      project_id: "mcp-test",
      source: "items",
      items: [item],
      animation_id: "attack_alt",
    });
    await current.service.call("xsxb_set_active_project", { project_id: "mcp-test" });
    const blocker = current.service.call("xsxb_add_attack_trail", {
      project_id: "mcp-test",
      animation_id: "attack_alt",
      dry_run: true,
    });
    await firstCompositeStarted;
    const queued = current.service.call("xsxb_add_attack_trail", {
      dry_run: true,
    });
    await current.service.call("xsxb_set_active_project", { project_id: "other-project" });
    releaseFirstComposite();

    const [, queuedReceipt] = await Promise.all([blocker, queued]);
    assert.equal(queuedReceipt.projectId, "mcp-test");
    assert.equal(queuedReceipt.segment.animationId, "attack_alt");
  } finally {
    releaseFirstComposite?.();
    await current.service.close();
    current.cleanup();
  }
});

test("the dispatcher rejects arguments the declared schema does not allow", async () => {
  const current = fixture();
  try {
    // A misspelled argument used to be dropped, so the tool ran with its
    // defaults and reported success for work the caller never requested.
    await assert.rejects(
      () => current.service.call("xsxb_get_animation", { animaton_id: "idle" }),
      /unknown argument "animaton_id".*animation_id/su,
    );
    await assert.rejects(
      () => current.service.call("xsxb_validate_project", { layer: "gamplay" }),
      /"layer" must be one of/u,
    );
    const error = await current.service
      .call("xsxb_get_animation", { animaton_id: "idle" })
      .catch((reason) => reason);
    assert.equal(error.code, "xsxb_invalid_arguments");
  } finally {
    current.cleanup();
  }
});

test("GIF export refuses to write outside the project workspace", async () => {
  const current = fixture();
  const outside = path.join(os.tmpdir(), `xsxb-escape-${process.pid}.gif`);
  try {
    const sequenceDir = path.join(current.root, "seq");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
    });

    await assert.rejects(
      () => current.service.call("xsxb_export_gif", { animation_id: "walk", output_path: outside }),
      /managed output/u,
    );
    assert.equal(fs.existsSync(outside), false, "the escaping path is never created");
    await assert.rejects(
      () =>
        current.service.call("xsxb_export_gif", {
          animation_id: "walk",
          output_path: "../../../../../../escape.gif",
        }),
      /managed output/u,
    );
  } finally {
    fs.rmSync(outside, { force: true });
    current.cleanup();
  }
});

test("oversized agent-supplied files are refused before they are read", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "seq");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
    });
    // Sparse file: the size guard must reject on the stat, never by reading it.
    const huge = path.join(current.root, "huge.png");
    const handle = fs.openSync(huge, "w");
    fs.ftruncateSync(handle, 600 * 1024 * 1024);
    fs.closeSync(handle);

    await assert.rejects(
      () => current.service.call("xsxb_add_attachment", { animation_id: "walk", file_path: huge }),
      /too large/iu,
    );
  } finally {
    current.cleanup();
  }
});

test("MCP items import enforces frame budgets before project mutation", async () => {
  const current = fixture();
  try {
    const framePng = encodePngRgba(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const data = `data:image/png;base64,${framePng.toString("base64")}`;
    await assert.rejects(
      current.service.call("xsxb_import_animation", {
        source: "items",
        animation_id: "too_many",
        items: Array.from({ length: 513 }, (_, index) => ({ name: `${index}.png`, data })),
      }),
      /limited to 512|frame budget/iu,
    );
    const project = await current.service.call("xsxb_get_project");
    assert.equal(
      project.animations.some((animation) => animation.id === "too_many"),
      false,
    );
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("MCP items import can be cancelled while materializing a bounded batch", async () => {
  const current = fixture();
  try {
    const framePng = encodePngRgba(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const data = `data:image/png;base64,${framePng.toString("base64")}`;
    const pending = current.service.call(
      "xsxb_import_animation",
      {
        source: "items",
        animation_id: "cancel_import",
        items: Array.from({ length: 200 }, (_, index) => ({ name: `${index}.png`, data })),
      },
      { requestId: "cancel-items-import" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current.service.cancel("cancel-items-import", "stop-items-import"), true);
    await assert.rejects(pending, /stop-items-import/u);
    const project = await current.service.call("xsxb_get_project");
    assert.equal(
      project.animations.some((animation) => animation.id === "cancel_import"),
      false,
    );
  } finally {
    await current.service.close();
    current.cleanup();
  }
});

test("XSXB MCP service executes the complete mutation workflow", async () => {
  const current = fixture();
  try {
    const projects = await current.service.call("xsxb_list_projects");
    assert.equal(projects.count, 1);
    assert.equal(projects.projects[0].godotProjectValid, true);

    const imported = await current.service.call("xsxb_import_video", {
      file_path: current.video,
      fps: 12,
      sync: true,
      validate: true,
    });
    assert.equal(imported.importedFrameCount, 3);
    assert.equal(imported.sync.ok, true);
    assert.equal(imported.validation.ok, true, imported.validation.errors.join("\n"));

    const animation = await current.service.call("xsxb_get_animation");
    assert.equal(animation.frameCount, 3);
    assert.equal(animation.generatedFrameCount, 3);
    assert.equal(animation.allFramesGenerated, true);

    const trail = await current.service.call("xsxb_add_attack_trail");
    assert.equal(trail.segment.sticks.length, 2);
    assert.equal(trail.sync.ok, true);

    const spark = path.join(current.root, "spark.png");
    fs.writeFileSync(spark, ONE_PIXEL_PNG);
    const attachment = await current.service.call("xsxb_add_attachment", { file_path: spark });
    assert.equal(
      attachment.binding.key,
      "mcp-test:player:mcp_imports:actor:source:workspace/projects/mcp-test/assets/mcp_imports/source:0",
    );
    assert.equal(attachment.sync.imageAttachmentCount, 1);

    const hit = path.join(current.root, "hit.wav");
    fs.writeFileSync(hit, createTestWav());
    const sfx = await current.service.call("xsxb_add_sfx", { file_path: hit });
    assert.equal(sfx.binding.type, "audio/wav");
    assert.equal(sfx.sync.audioCount, 1);

    const reorganized = await current.service.call("xsxb_reorganize_frames");
    assert.equal(reorganized.outputFrameCount, 3);
    assert.equal(reorganized.identityOrder, true);

    const validation = await current.service.call("xsxb_validate_project");
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(validation.summary.frames, 3);
    assert.equal(validation.summary.frameAudioBindings, 1);
    assert.equal(validation.summary.frameImageAttachments, 1);
    assert.equal(validation.summary.attackTrailSegments, 1);
  } finally {
    current.cleanup();
  }
});

test("generated MCP test WAV has a valid PCM RIFF header", () => {
  const wav = createTestWav();
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.length, wav.readUInt32LE(4) + 8);
});

test("MCP catalog includes the production editing tools", () => {
  for (const name of [
    "xsxb_import_animation",
    "xsxb_find_loop",
    "xsxb_find_duplicates",
    "xsxb_find_motion",
    "xsxb_estimate_visual",
    "xsxb_export_sheet",
    "xsxb_measure_image",
    "xsxb_update_frame_boxes",
    "xsxb_update_timing",
    "xsxb_sync_godot",
    "xsxb_get_project",
    "xsxb_delete_animation",
  ]) {
    assert.ok(MCP_TOOL_NAMES.includes(name), name);
  }
  assert.ok(MCP_TOOL_NAMES.includes("xsxb_import_video"));
});

test("XSXB MCP service completes the production editing loop", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "png-sequence");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "walk_02.png"), ONE_PIXEL_PNG);
    fs.writeFileSync(path.join(sequenceDir, "walk_01.png"), ONE_PIXEL_PNG);

    const imported = await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
      fps: 10,
    });
    assert.equal(imported.source, "png_sequence");
    assert.equal(imported.importedFrameCount, 2);
    assert.equal(imported.animationId, "walk");
    assert.equal(imported.sync.requested, false);

    const videoAlias = await current.service.call("xsxb_import_animation", {
      source: "video",
      file_path: current.video,
      animation_id: "clip",
      fps: 12,
    });
    assert.equal(videoAlias.source, "video");
    assert.equal(videoAlias.importedFrameCount, 3);

    const spriteDir = path.join(current.godotRoot, "sprites");
    fs.mkdirSync(spriteDir, { recursive: true });
    fs.writeFileSync(path.join(spriteDir, "idle.png"), ONE_PIXEL_PNG);
    const tresPath = path.join(spriteDir, "hero.spriteframes.tres");
    fs.writeFileSync(
      tresPath,
      `[ext_resource type="Texture2D" path="res://sprites/idle.png" id="1_tex"]

[resource]
animations = [{
"frames": [{
"duration": 1.0,
"texture": ExtResource("1_tex")
}],
"loop": true,
"name": &"idle",
"speed": 8.0
}]
`,
    );
    const spriteImported = await current.service.call("xsxb_import_animation", {
      source: "spriteframes",
      file_path: tresPath,
    });
    assert.equal(spriteImported.source, "spriteframes");
    assert.ok(spriteImported.importedFrameCount >= 1);

    const boxes = await current.service.call("xsxb_update_frame_boxes", {
      animation_id: "walk",
      frame: 0,
      hurtbox: { enabled: true, offset: { x: 1, y: -8 }, size: { x: 16, y: 16 } },
      collisionbox: { enabled: true, size: { x: 12, y: 20 } },
      hitbox: { enabled: false, offset: { x: 4, y: -4 }, size: { x: 8, y: 8 } },
    });
    assert.equal(boxes.frame, 0);
    assert.equal(boxes.boxes.hurtbox.size.x, 16);
    assert.equal(boxes.boxes.collisionbox.offset.y, -10);
    assert.equal(boxes.sync.requested, false);

    const timing = await current.service.call("xsxb_update_timing", {
      animation_id: "walk",
      fps: 8,
      frame: 1,
      duration_ms: 250,
      disabled: false,
    });
    assert.equal(timing.fps, 8);
    assert.equal(timing.playback.durationMs, 250);
    assert.equal(timing.sync.requested, false);

    const project = await current.service.call("xsxb_get_project");
    assert.equal(project.projectId, "mcp-test");
    assert.equal(project.godotProjectValid, true);
    assert.ok(project.animations.some((entry) => entry.id === "walk" && entry.frameCount === 2));
    assert.ok(project.animations.some((entry) => entry.id === "clip"));

    const preview = await current.service.call("xsxb_delete_animation", {
      animation_id: "clip",
      dry_run: true,
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.deleted, false);
    assert.equal(preview.removedFrames, 3);
    const stillThere = await current.service.call("xsxb_get_animation", { animation_id: "clip" });
    assert.equal(stillThere.frameCount, 3);

    const removed = await current.service.call("xsxb_delete_animation", { animation_id: "clip" });
    assert.equal(removed.deleted, true);
    assert.equal(removed.removedFrames, 3);
    await assert.rejects(
      () => current.service.call("xsxb_get_animation", { animation_id: "clip" }),
      /not found/i,
    );

    const synced = await current.service.call("xsxb_sync_godot");
    assert.equal(synced.ok, true);
    assert.equal(synced.requested, true);
    const afterSync = await current.service.call("xsxb_get_project");
    assert.equal(afterSync.animationCount, project.animationCount - 1);
  } finally {
    current.cleanup();
  }
});

test("MCP catalog exposes bind, cutout, active, and open-tuner tools", () => {
  for (const name of ["xsxb_bind_godot", "xsxb_cutout", "xsxb_set_active_project", "xsxb_open_tuner"]) {
    assert.ok(MCP_TOOL_NAMES.includes(name), name);
  }
});

test("sync keeps the requested project and reports the missing Godot bind", async () => {
  const current = fixture();
  try {
    const store = createProjectStore(current.root);
    store.addProject({ id: "orphan", label: "Orphan", projectRoot: "" });
    await assert.rejects(
      () => current.service.call("xsxb_sync_godot", { project_id: "orphan" }),
      /orphan[\s\S]*does not exist/i,
    );
  } finally {
    current.cleanup();
  }
});

test("bind_godot retargets a project to an existing Godot root", async () => {
  const current = fixture();
  try {
    const store = createProjectStore(current.root);
    store.addProject({ id: "orphan", label: "Orphan", projectRoot: "" });
    const bound = await current.service.call("xsxb_bind_godot", {
      project_id: "orphan",
      project_root: current.godotRoot,
    });
    assert.equal(bound.projectId, "orphan");
    assert.equal(bound.godotProjectValid, true);
    assert.equal(path.resolve(bound.projectRoot), path.resolve(current.godotRoot));
  } finally {
    current.cleanup();
  }
});

test("set_active_project and get_animation summary keep MCP context explicit", async () => {
  const current = fixture();
  try {
    const store = createProjectStore(current.root);
    store.addProject({ id: "other", label: "Other", projectRoot: "" });
    const activated = await current.service.call("xsxb_set_active_project", { project_id: "other" });
    assert.equal(activated.activeProjectId, "other");
    const listed = await current.service.call("xsxb_list_projects");
    assert.equal(listed.activeProjectId, "other");

    const sequenceDir = path.join(current.root, "png-sequence");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    fs.writeFileSync(path.join(sequenceDir, "b.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_set_active_project", { project_id: "mcp-test" });
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
    });
    const full = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    assert.equal(full.summary, false);
    assert.equal(full.frameCount, 2);
    assert.equal(full.animation.frames.length, 2);
    const summary = await current.service.call("xsxb_get_animation", {
      animation_id: "walk",
      frames: "summary",
    });
    assert.equal(summary.summary, true);
    assert.ok(!summary.animation.frames);
    const explicitFull = await current.service.call("xsxb_get_animation", {
      animation_id: "walk",
      frames: "full",
    });
    assert.equal(explicitFull.animation.frames.length, 2);
  } finally {
    current.cleanup();
  }
});

test("string dry_run and failed video replace do not destroy data", async () => {
  assert.equal(booleanFlag("true"), true);
  assert.equal(booleanFlag("false"), false);
  assert.equal(requireFps(24), 24);
  assert.throws(() => requireFps("abc"), /fps must be a finite number/);
  assert.throws(() => requireFrameIndex(1.5, 3), /Frame must be an integer/);

  const current = fixture();
  try {
    await current.service.call("xsxb_import_video", {
      file_path: current.video,
      animation_id: "keep",
      fps: 12,
    });
    const preview = await current.service.call("xsxb_delete_animation", {
      animation_id: "keep",
      dry_run: "true",
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.deleted, false);
    const stillThere = await current.service.call("xsxb_get_animation", { animation_id: "keep" });
    assert.equal(stillThere.frameCount, 3);

    const failing = createXsxbMcpService({
      root: current.root,
      extractVideoFramesImpl: async () => {
        throw new Error("FFmpeg video extraction failed: spawn ffmpeg ENOENT");
      },
    });
    await assert.rejects(
      () =>
        failing.call("xsxb_import_video", {
          file_path: current.video,
          animation_id: "keep",
          replace: true,
        }),
      /FFmpeg video extraction failed/,
    );
    const afterFailure = await current.service.call("xsxb_get_animation", { animation_id: "keep" });
    assert.equal(afterFailure.frameCount, 3);
  } finally {
    current.cleanup();
  }
});

test("reorganize duplicated frames receive unique ids", async () => {
  const current = fixture();
  try {
    await current.service.call("xsxb_import_video", {
      file_path: current.video,
      animation_id: "walk",
      fps: 12,
    });
    const reorganized = await current.service.call("xsxb_reorganize_frames", {
      animation_id: "walk",
      order: [0, 0, 1],
      sync: false,
    });
    assert.equal(reorganized.outputFrameCount, 3);
    const animation = await current.service.call("xsxb_get_animation", { animation_id: "walk" });
    const ids = animation.animation.frames.map((frame) => frame.id);
    assert.equal(new Set(ids).size, ids.length);
  } finally {
    current.cleanup();
  }
});

test("import can slice frames, replace the same id, and cutout updates the files", async () => {
  const current = fixture();
  try {
    const first = await current.service.call("xsxb_import_video", {
      file_path: current.video,
      animation_id: "attack",
      fps: 24,
      start_frame: 1,
      end_frame: 2,
    });
    assert.equal(first.importedFrameCount, 2);
    assert.equal(first.extractedFrameCount, 3);
    assert.equal(first.fps, 24);

    const replaced = await current.service.call("xsxb_import_video", {
      file_path: current.video,
      animation_id: "attack",
      replace: true,
      fps: 24,
    });
    assert.equal(replaced.animationId, "attack");
    assert.equal(replaced.importedFrameCount, 3);
    assert.equal(replaced.replaced, true);

    const cut = await current.service.call("xsxb_cutout", {
      animation_id: "attack",
      key_color: "#00f002",
      output_width: 256,
      output_height: 256,
    });
    assert.equal(cut.frameCount, 3);
    assert.equal(cut.outputWidth, 256);
    assert.equal(cut.outputHeight, 256);
    assert.ok(cut.processedFrameCount >= 1);

    const validation = await current.service.call("xsxb_validate_project", { layer: "standalone" });
    assert.ok(validation.layers.standalone);
    assert.ok(validation.layers.bind);
    assert.equal(validation.layer, "standalone");
  } finally {
    current.cleanup();
  }
});

test("xsxb_cutout uses the tuner smart-cutout path and keeps hit-frame feet", async () => {
  const current = fixture({ realCutout: true });
  try {
    const sequenceDir = path.join(current.root, "green-sequence");
    fs.mkdirSync(sequenceDir, { recursive: true });
    const width = 16;
    const height = 16;
    const idle = new Uint8ClampedArray(width * height * 4);
    const hit = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < idle.length; offset += 4) {
      idle.set([0, 255, 0, 255], offset);
      hit.set([0, 255, 0, 255], offset);
    }
    for (let y = 6; y <= 11; y += 1) {
      idle.set([210, 36, 42, 255], (y * width + 7) * 4);
      idle.set([210, 36, 42, 255], (y * width + 8) * 4);
      hit.set([210, 36, 42, 255], (y * width + 7) * 4);
      hit.set([210, 36, 42, 255], (y * width + 8) * 4);
    }
    for (let x = 6; x <= 14; x += 1) hit.set([240, 250, 255, 255], (14 * width + x) * 4);
    fs.writeFileSync(path.join(sequenceDir, "idle.png"), encodePngRgba(idle, width, height));
    fs.writeFileSync(path.join(sequenceDir, "hit.png"), encodePngRgba(hit, width, height));

    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "slash",
    });
    const cut = await current.service.call("xsxb_cutout", { animation_id: "slash" });
    assert.equal(cut.pipeline, "smart_product");
    assert.equal(cut.rematched, false);
    assert.equal(cut.processedFrameCount, 2);

    const full = await current.service.call("xsxb_get_animation", {
      animation_id: "slash",
      frames: "full",
    });
    const idleCut = decodePngRgba(full.animation.frames[0].absolutePath);
    const hitCut = decodePngRgba(full.animation.frames[1].absolutePath);
    assert.ok(idleCut.data[3] <= 16);
    assert.equal(idleCut.data[(6 * width + 7) * 4 + 3], 255);
    assert.equal(subjectAnchor(idleCut.data, width, height).feetY, 11);
    assert.equal(subjectAnchor(hitCut.data, width, height).feetY, 11);
  } finally {
    current.cleanup();
  }
});

test("add tools accept real files and open_tuner can launch", async () => {
  let launched = false;
  const current = fixture();
  const service = createXsxbMcpService({
    root: current.root,
    extractVideoFramesImpl: async (_videoPath, outputDirectory) => {
      return Array.from({ length: 3 }, (_, index) => {
        const framePath = path.join(outputDirectory, `frame_${String(index + 1).padStart(6, "0")}.png`);
        fs.writeFileSync(framePath, ONE_PIXEL_PNG);
        return framePath;
      });
    },
    probeTunerImpl: async () => false,
    launchTunerImpl: async () => {
      launched = true;
      return { pid: 99 };
    },
  });
  try {
    const sequenceDir = path.join(current.root, "seq");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    fs.writeFileSync(path.join(sequenceDir, "b.png"), ONE_PIXEL_PNG);
    await service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
    });

    const spark = path.join(current.root, "spark.png");
    fs.writeFileSync(spark, ONE_PIXEL_PNG);
    const attachment = await service.call("xsxb_add_attachment", {
      animation_id: "walk",
      file_path: spark,
      sync: false,
    });
    assert.match(attachment.binding.path, /attachments/);
    assert.equal(attachment.binding.name, "spark.png");

    const hit = path.join(current.root, "hit.wav");
    fs.writeFileSync(hit, createTestWav());
    const sfx = await service.call("xsxb_add_sfx", {
      animation_id: "walk",
      file_path: hit,
      sync: false,
    });
    assert.equal(sfx.binding.name, "hit.wav");
    assert.match(String(sfx.binding.path), /audio/);

    const trail = await service.call("xsxb_add_attack_trail", {
      animation_id: "walk",
      id: "arc",
      color: "#112233",
      sticks: [
        { frame: 0, top: { x: -4, y: -8 }, bottom: { x: 4, y: 2 } },
        { frame: 1, top: { x: 6, y: -6 }, bottom: { x: -2, y: 3 } },
      ],
      sync: false,
    });
    assert.equal(trail.segment.id, "arc");
    assert.equal(trail.segment.color, "#112233");

    const opened = await service.call("xsxb_open_tuner", { animation_id: "walk" });
    assert.equal(launched, true);
    assert.equal(opened.launched, true);
    assert.equal(opened.pid, 99);
    assert.match(opened.url, /animation=walk/);

    await assert.rejects(
      () => service.call("xsxb_add_attachment", { animation_id: "walk", sync: false }),
      /missing required argument "file_path"/,
    );
    await assert.rejects(
      () => service.call("xsxb_add_sfx", { animation_id: "walk", sync: false }),
      /missing required argument "file_path"/,
    );
    const ordered = await service.call("xsxb_add_attachment", {
      animation_id: "walk",
      file_path: spark,
      layer_order: 0,
      sync: false,
    });
    assert.equal(ordered.binding.layerOrder, 0);
    await assert.rejects(
      () => service.call("xsxb_update_timing", { animation_id: "walk", fps: "abc" }),
      /"fps" must be number/,
    );
    const stillWalk = await service.call("xsxb_get_animation", { animation_id: "walk" });
    assert.equal(stillWalk.animation.fps, 12);
  } finally {
    current.cleanup();
  }
});

test("attack trail defaults stay inside a one-frame animation", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "one");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "only.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "idle",
      fps: 12,
    });
    const trail = await current.service.call("xsxb_add_attack_trail", {
      animation_id: "idle",
      sync: false,
    });
    const frames = trail.segment.sticks.map((stick) => stick.frame);
    assert.deepEqual(frames, [0, 0]);
    assert.equal(
      frames.some((frame) => frame < 0 || frame > 0),
      false,
    );
  } finally {
    current.cleanup();
  }
});

test("cutout writes each frame's own size when no canvas is requested", async () => {
  const current = fixture({ realCutout: true });
  try {
    const sequenceDir = path.join(current.root, "mixed-size");
    fs.mkdirSync(sequenceDir, { recursive: true });
    const small = new Uint8ClampedArray(40 * 40 * 4);
    const large = new Uint8ClampedArray(80 * 60 * 4);
    for (let offset = 0; offset < small.length; offset += 4) small.set([0, 255, 0, 255], offset);
    for (let offset = 0; offset < large.length; offset += 4) large.set([0, 255, 0, 255], offset);
    small.set([210, 36, 42, 255], (20 * 40 + 20) * 4);
    large.set([210, 36, 42, 255], (30 * 80 + 40) * 4);
    fs.writeFileSync(path.join(sequenceDir, "a.png"), encodePngRgba(small, 40, 40));
    fs.writeFileSync(path.join(sequenceDir, "b.png"), encodePngRgba(large, 80, 60));
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "mixed",
    });
    await current.service.call("xsxb_cutout", { animation_id: "mixed" });
    const full = await current.service.call("xsxb_get_animation", {
      animation_id: "mixed",
      frames: "full",
    });
    assert.equal(full.animation.frames[0].width, 40);
    assert.equal(full.animation.frames[0].height, 40);
    assert.equal(full.animation.frames[1].width, 80);
    assert.equal(full.animation.frames[1].height, 60);
  } finally {
    current.cleanup();
  }
});

test("import_animation slices PNG sequences with start_frame and end_frame", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "ten-frames");
    fs.mkdirSync(sequenceDir, { recursive: true });
    for (let index = 0; index < 10; index += 1) {
      fs.writeFileSync(path.join(sequenceDir, `f${String(index).padStart(2, "0")}.png`), ONE_PIXEL_PNG);
    }
    const imported = await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "clip",
      start_frame: 2,
      end_frame: 4,
    });
    assert.equal(imported.importedFrameCount, 3);
    assert.equal(imported.startFrame, 2);
    assert.equal(imported.endFrame, 4);
    assert.equal(imported.sourceFrameCount, 10);
  } finally {
    current.cleanup();
  }
});

test("open_tuner can switch projects without leftover animation context", async () => {
  const current = fixture();
  const service = createXsxbMcpService({
    root: current.root,
    probeTunerImpl: async () => true,
    launchTunerImpl: async () => ({ pid: 1 }),
  });
  try {
    const sequenceDir = path.join(current.root, "seq-a");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    await service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "walk",
    });
    await service.call("xsxb_open_tuner", { animation_id: "walk" });

    const otherGodot = path.join(current.root, "godot-b");
    fs.mkdirSync(otherGodot, { recursive: true });
    fs.writeFileSync(path.join(otherGodot, "project.godot"), '[application]\nconfig/name="B"\n');
    createProjectStore(current.root).addProject({
      id: "proj-b",
      label: "B",
      projectRoot: otherGodot,
    });
    const opened = await service.call("xsxb_open_tuner", { project_id: "proj-b" });
    assert.equal(opened.projectId, "proj-b");
    assert.equal(opened.animationId, "");
    assert.match(opened.url, /project=proj-b/);
    assert.doesNotMatch(opened.url, /animation=/);
  } finally {
    current.cleanup();
  }
});

test("open_tuner refuses a foreign checkout and selects the next free port", async () => {
  const current = fixture();
  let launchedPort = null;
  const service = createXsxbMcpService({
    root: current.root,
    probeTunerImpl: async (url) => {
      const port = Number(new URL(url).port);
      if (port === 5179) return { reachable: true, compatible: false, rootHash: "foreign-root" };
      if (port === launchedPort) return { reachable: true, compatible: true };
      return { reachable: false, compatible: false };
    },
    launchTunerImpl: async ({ port }) => {
      launchedPort = port;
      return { pid: 72 };
    },
  });
  try {
    const opened = await service.call("xsxb_open_tuner", { project_id: "mcp-test" });
    assert.equal(launchedPort, 5180);
    assert.equal(opened.port, 5180);
    assert.equal(opened.conflictPort, 5179);
    assert.equal(opened.reused, false);
    assert.match(opened.url, /:5180\//u);
  } finally {
    current.cleanup();
  }
});

test("gameplay readiness warning is non-blocking unless require_gameplay is set", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "gameplay-seq");
    fs.mkdirSync(sequenceDir);
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "idle",
    });
    await current.service.call("xsxb_sync_godot", { force: true });

    const readiness = await current.service.call("xsxb_validate_project", {
      strict: true,
      layer: "gameplay",
    });
    assert.equal(readiness.errors.length, 0);
    assert.match(readiness.warnings.join("\n"), /No non-runtime gameplay scene/u);
    assert.equal(readiness.gameplayReady, false);
    assert.equal(readiness.ok, true);

    const required = await current.service.call("xsxb_validate_project", {
      strict: true,
      require_gameplay: true,
      layer: "gameplay",
    });
    assert.equal(required.ok, false);
  } finally {
    current.cleanup();
  }
});

test("bind validation layer keeps standalone/game-local mismatch errors", () => {
  assert.equal(classifyValidationMessage("Standalone and game-local animation_tuning.json differ."), "bind");
  assert.equal(
    classifyValidationMessage("hero/slash: standalone and game-local attack trail data differ."),
    "bind",
  );
  assert.equal(classifyValidationMessage("Unstable frame binding key: bad"), "bind");
  assert.equal(classifyValidationMessage("project.godot not found"), "bind");
  assert.equal(classifyValidationMessage("Generated runtime is missing"), "gameplay");
});

test("cutout is marked destructive because it overwrites source frames", () => {
  const cutout = toolDefinitions().find((tool) => tool.name === "xsxb_cutout");
  assert.equal(cutout.annotations.destructiveHint, true);
});

test("cutout accepts workspace-absolute imported frames and refuses escaped paths", async () => {
  const current = fixture();
  try {
    const sequenceDir = path.join(current.root, "seq-cutout-path");
    fs.mkdirSync(sequenceDir, { recursive: true });
    fs.writeFileSync(path.join(sequenceDir, "a.png"), ONE_PIXEL_PNG);
    await current.service.call("xsxb_import_animation", {
      source: "png_sequence",
      directory: sequenceDir,
      animation_id: "idle",
    });
    const store = createProjectStore(current.root);
    const project = store.resolveProject(store.readRegistry());
    const paths = store.projectPaths(project);
    const manifest = store.readJson(paths.manifest, { schemaVersion: 1, profiles: [] });
    const animation = manifest.profiles[0].animations.find((entry) => entry.id === "idle");
    const relativePath = String(animation.frames[0].path);
    const workspaceAbsolute = path.resolve(current.root, relativePath);
    const outside = path.join(current.root, "outside-cutout.png");
    fs.writeFileSync(outside, ONE_PIXEL_PNG);
    const originalOutside = fs.readFileSync(outside);

    animation.frames[0].path = workspaceAbsolute;
    store.writeJson(paths.manifest, manifest);
    const cut = await current.service.call("xsxb_cutout", { animation_id: "idle" });
    assert.ok(cut.processedFrameCount >= 1);

    animation.frames[0].path = outside;
    store.writeJson(paths.manifest, manifest);
    await assert.rejects(
      () => current.service.call("xsxb_cutout", { animation_id: "idle" }),
      /outside the project workspace or Godot root/,
    );
    assert.deepEqual(fs.readFileSync(outside), originalOutside);

    animation.frames[0].path = "res://../outside-cutout.png";
    store.writeJson(paths.manifest, manifest);
    await assert.rejects(
      () => current.service.call("xsxb_cutout", { animation_id: "idle" }),
      /outside the project workspace or Godot root/,
    );
    assert.deepEqual(fs.readFileSync(outside), originalOutside);

    const view = await current.service.call("xsxb_get_animation", { animation_id: "idle" });
    assert.equal(view.animation.frames[0].exists, false);
    assert.equal(view.animation.frames[0].absolutePath, "");
  } finally {
    current.cleanup();
  }
});
