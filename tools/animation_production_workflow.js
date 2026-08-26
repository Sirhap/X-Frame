const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { syncGodotProject } = require("./godot_sync");
const { loadContract, validateContract } = require("./animation_production_contract");
const { createProjectStore } = require("./project_store");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 5179;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Parse the small command-line surface exposed to agents.
 * @param {string[]} argv Command-line tokens after the Node script path.
 * @returns {{command:string,contract:string,project:string,projectRoot:string,replace:boolean,port:number,json:boolean,timeoutMs:number,help?:boolean}} Parsed options.
 */
function parseArgs(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  const command = tokens[0] && !tokens[0].startsWith("--") ? tokens[0] : "";
  const result = {
    command,
    contract: "",
    project: "",
    projectRoot: "",
    replace: false,
    port: DEFAULT_PORT,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  let index = command ? 1 : 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "help") {
      result.help = true;
      index += 1;
      continue;
    }
    if (key === "json" || key === "replace") {
      result[key] = true;
      index += 1;
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    if (key === "contract") result.contract = value;
    else if (key === "project") result.project = value;
    else if (key === "project-root") result.projectRoot = value;
    else if (key === "port") result.port = Number(value);
    else if (key === "timeout-ms") result.timeoutMs = Number(value);
    else throw new Error(`Unknown option: --${key}`);
    index += 2;
  }
  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new Error(`Invalid port: ${result.port}`);
  }
  if (!Number.isFinite(result.timeoutMs) || result.timeoutMs < 1) {
    throw new Error(`Invalid timeout-ms: ${result.timeoutMs}`);
  }
  return result;
}

/**
 * Count PNG files in a directory using the same natural input boundary as import tools.
 * @param {string} directory Candidate frame directory.
 * @returns {number} Number of PNG files.
 */
function countPngFiles(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return 0;
  return fs.readdirSync(directory).filter((name) => path.extname(name).toLowerCase() === ".png").length;
}

/**
 * Read a project registry entry without creating or normalizing project data.
 * @param {string} tunerRoot Tuner repository root.
 * @param {string} projectId Optional project id.
 * @param {string} projectRoot Exact target Godot root.
 * @returns {string[]} Binding errors.
 */
function checkProjectBinding(tunerRoot, projectId, projectRoot) {
  if (!projectId) return [];
  const registryPath = path.join(tunerRoot, "data", "projects.json");
  if (!fs.existsSync(registryPath)) return [];
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return [`Could not read project registry: ${error.message}`];
  }
  const project = Array.isArray(registry.projects)
    ? registry.projects.find((entry) => String(entry?.id || "") === String(projectId))
    : null;
  if (!project?.projectRoot) return [];
  if (path.resolve(project.projectRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) {
    return [`Project id "${projectId}" is already bound to ${project.projectRoot}.`];
  }
  return [];
}

/**
 * Resolve an existing registry project for an explicit synchronization request.
 * @param {string} tunerRoot Tuner repository root.
 * @param {string} projectId Optional project id.
 * @param {string} projectRoot Exact target Godot root.
 * @returns {{store:object,project:object}|{error:string}} Resolved project or an error.
 */
function resolveRegisteredProject(tunerRoot, projectId, projectRoot) {
  const registryPath = path.join(tunerRoot, "data", "projects.json");
  if (!fs.existsSync(registryPath)) return { error: `XSXB project registry not found: ${registryPath}` };
  let rawRegistry;
  try {
    rawRegistry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return { error: `Could not read project registry: ${error.message}` };
  }
  const candidates = Array.isArray(rawRegistry?.projects) ? rawRegistry.projects : [];
  const rawProject = projectId
    ? candidates.find((entry) => String(entry?.id || "") === String(projectId))
    : candidates.find(
        (entry) =>
          entry?.projectRoot &&
          path.resolve(entry.projectRoot).toLowerCase() === path.resolve(projectRoot).toLowerCase(),
      );
  if (!rawProject) return { error: `XSXB project not found: ${projectId || projectRoot}` };
  if (
    rawProject.projectRoot &&
    path.resolve(rawProject.projectRoot).toLowerCase() !== path.resolve(projectRoot).toLowerCase()
  ) {
    return {
      error: `Project id "${rawProject.id}" is bound to ${rawProject.projectRoot}, not ${projectRoot}.`,
    };
  }
  const store = createProjectStore(tunerRoot);
  const registry = store.readRegistry();
  const project = registry.projects.find((entry) => entry.id === rawProject.id);
  return project
    ? { store, project }
    : { error: `XSXB project not found after registry normalization: ${rawProject.id}` };
}

/**
 * Inspect local filesystem requirements before a mutating workflow stage.
 * @param {object} contract Normalized animation contract.
 * @param {{project?:string,tunerRoot?:string}} options Workflow options.
 * @returns {{ok:boolean,stage:string,errors:string[],warnings:string[],plan:object}} Inspection result.
 */
function inspectContract(contract, options = {}) {
  const errors = [];
  const warnings = [];
  const projectRoot = contract.projectRoot;
  const tunerRoot = options.tunerRoot || ROOT;
  if (!projectRoot || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    errors.push(`Godot project root not found: ${projectRoot || "(empty)"}`);
  } else if (!fs.existsSync(path.join(projectRoot, "project.godot"))) {
    errors.push(`Godot project.godot not found under: ${projectRoot}`);
  }
  errors.push(...checkProjectBinding(tunerRoot, options.project, projectRoot));

  for (const clip of contract.clips) {
    if (clip.execution === "browser-required") {
      if (!fs.existsSync(clip.source.path))
        errors.push(`${clip.id}: source file not found: ${clip.source.path}`);
      warnings.push(`${clip.id}: use the existing browser or specialized importer workflow.`);
      continue;
    }
    if (!fs.existsSync(clip.source.path) || !fs.statSync(clip.source.path).isDirectory()) {
      errors.push(`${clip.id}: source folder not found: ${clip.source.path}`);
      continue;
    }
    const actualFrameCount = countPngFiles(clip.source.path);
    if (!actualFrameCount) errors.push(`${clip.id}: no PNG frames found in ${clip.source.path}`);
    if (clip.frameCount !== null && clip.frameCount !== actualFrameCount) {
      errors.push(
        `${clip.id}: frame count mismatch (${clip.frameCount} declared, ${actualFrameCount} found).`,
      );
    }
  }

  return { ok: errors.length === 0, stage: "inspect", errors, warnings, plan: contract };
}

/**
 * Build the existing importer command for one or more normalized clips.
 * @param {object} contract Normalized animation contract.
 * @param {{project?:string,replace?:boolean,tunerRoot?:string}} options Workflow options.
 * @returns {{file:string,args:string[]}} Child process command.
 */
function buildImportCommand(contract, options = {}) {
  const clips = contract.clips;
  const scriptName = clips.length === 1 ? "import_frames.js" : "import_batch.js";
  const file = path.join(options.tunerRoot || ROOT, "tools", scriptName);
  const args = [file, "--project-root", contract.projectRoot, "--profile", contract.profile];
  if (options.project) args.push("--project", options.project);
  const clipReplace = clips.map((clip) => Boolean(clip.replace));
  const allClipsReplace = clipReplace.length > 0 && clipReplace.every(Boolean);
  if (options.replace || allClipsReplace) args.push("--replace");
  if (clips.length === 1) {
    const [clip] = clips;
    args.push(
      "--animation",
      clip.id,
      "--source",
      clip.source.path,
      "--fps",
      String(clip.fps),
      "--type",
      clip.type,
      "--anchor",
      clip.anchor,
    );
  } else {
    for (const clip of clips) {
      args.push(
        "--animation",
        clip.id,
        "--source",
        clip.source.path,
        "--fps",
        String(clip.fps),
        "--type",
        clip.type,
        "--anchor",
        clip.anchor,
      );
    }
  }
  return { file: process.execPath, args };
}

/**
 * Run a child process with deterministic argument passing.
 * @param {string} file Executable path.
 * @param {string[]} args Arguments.
 * @param {{cwd:string,timeout:number}} options Child process options.
 * @returns {{status:number|null,stdout:string,stderr:string}} Child result.
 */
function defaultRunProcess(file, args, options) {
  return spawnSync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout,
    windowsHide: true,
  });
}

/**
 * Check whether a local TCP port is accepting connections.
 * @param {string} host Hostname.
 * @param {number} port TCP port.
 * @param {number} timeoutMs Connection timeout.
 * @returns {Promise<boolean>} Whether the port is open.
 */
function defaultIsPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/**
 * Start the local tuner server as a detached child process.
 * @param {{tunerRoot:string,port:number}} options Start options.
 * @returns {{pid:number|null}} Started child information.
 */
function defaultStartServer(options) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCommand, ["run", "start:local"], {
    cwd: options.tunerRoot,
    detached: true,
    env: { ...process.env, PORT: String(options.port) },
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid || null };
}

/**
 * Read a child JSON response, preserving useful diagnostics for non-JSON output.
 * @param {{status:number|null,stdout?:string,stderr?:string}} childResult Child process result.
 * @returns {object|null} Parsed JSON value.
 */
function parseChildJson(childResult) {
  const text = String(childResult?.stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Execute one AI production workflow command.
 * @param {string} command Workflow command.
 * @param {{contractPath?:string,contract?:string,project?:string,projectRoot?:string,replace?:boolean,port?:number,timeoutMs?:number,tunerRoot?:string,runProcess?:Function,isPortOpen?:Function,startServer?:Function}} options Workflow options.
 * @returns {Promise<object>} Machine-readable workflow result.
 */
async function runWorkflow(command, options = {}) {
  const stage = String(command || "").trim();
  const tunerRoot = path.resolve(options.tunerRoot || ROOT);
  if (stage === "start") {
    const port = Number(options.port || DEFAULT_PORT);
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const isPortOpen = options.isPortOpen || defaultIsPortOpen;
    const url = `http://127.0.0.1:${port}`;
    if (await isPortOpen("127.0.0.1", port, timeoutMs)) {
      return { ok: true, stage, errors: [], warnings: [], url, reused: true, artifacts: [] };
    }
    const startServer = options.startServer || defaultStartServer;
    let child;
    try {
      child = startServer({ tunerRoot, port });
    } catch (error) {
      return { ok: false, stage, errors: [error.message], warnings: [], url, reused: false, artifacts: [] };
    }
    return {
      ok: true,
      stage,
      errors: [],
      warnings: ["Server started in the background; verify the URL before browser-only operations."],
      url,
      reused: false,
      pid: child?.pid || null,
      artifacts: [],
    };
  }

  const contractPath = options.contractPath || options.contract;
  if (!contractPath) {
    return {
      ok: false,
      stage,
      errors: ["--contract is required for this command."],
      warnings: [],
      artifacts: [],
    };
  }

  let contract;
  try {
    contract = loadContract(contractPath);
  } catch (error) {
    return { ok: false, stage, errors: [error.message], warnings: [], artifacts: [] };
  }
  if (options.projectRoot) contract.projectRoot = path.resolve(options.projectRoot);
  const contractValidation = validateContract(contract, {
    baseDir: path.dirname(path.resolve(contractPath)),
  });
  if (!contractValidation.ok) {
    return {
      ok: false,
      stage,
      errors: contractValidation.errors,
      warnings: contractValidation.warnings,
      artifacts: [],
    };
  }
  contract = { ...contract, projectRoot: contract.projectRoot };

  if (stage === "plan") {
    return {
      ok: true,
      stage,
      errors: [],
      warnings: contractValidation.warnings,
      plan: contract,
      artifacts: contract.artifacts?.directory ? [contract.artifacts.directory] : [],
    };
  }

  if (stage === "sync") {
    const root = contract.projectRoot;
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return {
        ok: false,
        stage,
        errors: [`Godot project root not found: ${root || "(empty)"}`],
        warnings: [],
        plan: contract,
        artifacts: [],
      };
    }
    if (!fs.existsSync(path.join(root, "project.godot"))) {
      return {
        ok: false,
        stage,
        errors: [`Godot project.godot not found under: ${root}`],
        warnings: [],
        plan: contract,
        artifacts: [],
      };
    }
    const resolved = resolveRegisteredProject(tunerRoot, options.project, root);
    if (resolved.error) {
      return { ok: false, stage, errors: [resolved.error], warnings: [], plan: contract, artifacts: [] };
    }
    try {
      const sync = (options.syncProject || syncGodotProject)(tunerRoot, resolved.store, resolved.project);
      return {
        ok: sync?.ok === true,
        stage,
        errors: sync?.ok === true ? [] : [sync?.reason || "Godot synchronization failed."],
        warnings: contractValidation.warnings,
        sync,
        plan: contract,
        artifacts: sync?.dataDir ? [sync.dataDir] : [],
      };
    } catch (error) {
      return { ok: false, stage, errors: [error.message], warnings: [], plan: contract, artifacts: [] };
    }
  }

  const inspection = inspectContract(contract, { project: options.project, tunerRoot });
  if (stage === "inspect") return inspection;
  if (!inspection.ok) {
    return { ...inspection, stage, errors: inspection.errors, warnings: inspection.warnings };
  }

  if (stage === "import") {
    const unsupported = contract.clips.filter((clip) => clip.execution !== "cli-import");
    if (unsupported.length) {
      return {
        ok: false,
        stage,
        errors: unsupported.map(
          (clip) => `${clip.id}: browser-required source cannot be imported by the CLI.`,
        ),
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    const clipReplace = contract.clips.map((clip) => Boolean(clip.replace));
    const anyClipReplace = clipReplace.some(Boolean);
    const allClipsReplace = clipReplace.length > 0 && clipReplace.every(Boolean);
    if (anyClipReplace && !allClipsReplace && !options.replace) {
      return {
        ok: false,
        stage,
        errors: [
          "mixed replace: some clips set replace=true and others do not. Split the batch or pass --replace for every clip.",
        ],
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    const commandInfo = buildImportCommand(contract, {
      project: options.project,
      replace: options.replace,
      tunerRoot,
    });
    const runProcess = options.runProcess || defaultRunProcess;
    let childResult;
    try {
      childResult = runProcess(commandInfo.file, commandInfo.args, {
        cwd: tunerRoot,
        timeout: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        stage,
        errors: [error.message],
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    if (childResult?.status !== 0) {
      const detail = String(childResult?.stderr || childResult?.stdout || "Unknown import error").trim();
      return {
        ok: false,
        stage,
        errors: [detail],
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    return {
      ok: true,
      stage,
      errors: [],
      warnings: inspection.warnings,
      plan: contract,
      command: commandInfo,
      output: String(childResult?.stdout || "").trim(),
      artifacts: [],
    };
  }

  if (stage === "validate") {
    const validatorFile = path.join(tunerRoot, "tools", "validate_import.js");
    const validatorArgs = [
      validatorFile,
      "--project-root",
      contract.projectRoot,
      "--strict",
      "--require-gameplay",
    ];
    if (options.project) validatorArgs.push("--project", options.project);
    const runProcess = options.runProcess || defaultRunProcess;
    let childResult;
    try {
      childResult = runProcess(process.execPath, validatorArgs, {
        cwd: tunerRoot,
        timeout: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        stage,
        errors: [error.message],
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    const validation = parseChildJson(childResult);
    if (!validation) {
      const detail = String(
        childResult?.stderr || childResult?.stdout || "Validator returned no JSON.",
      ).trim();
      return {
        ok: false,
        stage,
        errors: [detail],
        warnings: inspection.warnings,
        plan: contract,
        artifacts: [],
      };
    }
    return {
      ok: validation.ok === true && childResult?.status === 0,
      stage,
      errors: Array.isArray(validation.errors) ? validation.errors : [],
      warnings: [...inspection.warnings, ...(Array.isArray(validation.warnings) ? validation.warnings : [])],
      validation,
      plan: contract,
      artifacts: [],
    };
  }

  return {
    ok: false,
    stage,
    errors: [`Unknown workflow command: ${stage || "(empty)"}.`],
    warnings: [],
    artifacts: [],
  };
}

function usage() {
  return `Usage:
node tools/animation_production_workflow.js <inspect|plan|import|sync|validate|start> [options]

Options:
  --contract <file>       Version-1 animation-constraints.json (not needed for start)
  --project <id>          Existing XSXB project id
  --project-root <path>   Override the Godot root from the contract
  --replace               Explicitly replace existing animation data during import
  --port <number>         Local tuner port (default: ${DEFAULT_PORT})
  --timeout-ms <number>  Child-process/network timeout (default: ${DEFAULT_TIMEOUT_MS})
  --json                  Print machine-readable JSON output
  --help                  Show this help
`;
}

/**
 * Execute the command-line entry point.
 * @param {string[]} argv Command-line tokens.
 * @returns {Promise<number>} Process exit code.
 */
async function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.help || !args.command) {
      process.stdout.write(usage());
      return args.help ? 0 : 1;
    }
    const result = await runWorkflow(args.command, {
      contract: args.contract,
      project: args.project,
      projectRoot: args.projectRoot,
      replace: args.replace,
      port: args.port,
      timeoutMs: args.timeoutMs,
      tunerRoot: ROOT,
    });
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (result.ok) process.stdout.write(output);
    else process.stderr.write(output);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  buildImportCommand,
  countPngFiles,
  inspectContract,
  main,
  parseArgs,
  runWorkflow,
};
