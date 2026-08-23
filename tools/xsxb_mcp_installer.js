"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { createRuntimeInfo, runtimeContentHash } = require("./xsxb_mcp_runtime");
const { toolDefinitions } = require("./xsxb_mcp_tool_catalog");

function copyRuntime(sourceRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(path.join(sourceRoot, "tools"), path.join(targetRoot, "tools"), {
    recursive: true,
    filter(source) {
      return !source.includes(`${path.sep}tests${path.sep}`) && !source.endsWith(`${path.sep}tests`);
    },
  });
  fs.copyFileSync(path.join(sourceRoot, "package.json"), path.join(targetRoot, "package.json"));
  const lockPath = path.join(sourceRoot, "package-lock.json");
  if (fs.existsSync(lockPath)) fs.copyFileSync(lockPath, path.join(targetRoot, "package-lock.json"));
  const sourceModules = path.join(sourceRoot, "node_modules");
  const targetModules = path.join(targetRoot, "node_modules");
  for (const packageName of ["playwright", "playwright-core"]) {
    const sourcePackage = path.join(sourceModules, packageName);
    if (!fs.existsSync(sourcePackage)) continue;
    const targetPackage = path.join(targetModules, packageName);
    if (!fs.existsSync(targetPackage)) {
      fs.mkdirSync(path.dirname(targetPackage), { recursive: true });
      fs.cpSync(sourcePackage, targetPackage, { recursive: true });
    }
  }
}

function switchCurrent(installRoot, buildDirectory) {
  const current = path.join(installRoot, "current");
  if (fs.existsSync(current) && !fs.lstatSync(current).isSymbolicLink()) {
    throw new Error(
      `Legacy MCP current path must be moved aside manually because it is not a symbolic link: ${current}`,
    );
  }
  const temporary = path.join(installRoot, `.current-${process.pid}-${Date.now()}`);
  fs.symlinkSync(buildDirectory, temporary, "dir");
  try {
    fs.renameSync(temporary, current);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return current;
}

function ensureCodexTimeouts(configPath) {
  if (!fs.existsSync(configPath)) return false;
  const source = fs.readFileSync(configPath, "utf8");
  const backupPath = `${configPath}.backup-xsxb-mcp`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  const header = "[mcp_servers.xsxb-frame-tuner]";
  const start = source.indexOf(header);
  if (start < 0) return false;
  const nextHeader = source.indexOf("\n[", start + header.length);
  const end = nextHeader < 0 ? source.length : nextHeader + 1;
  let block = source.slice(start, end).trimEnd();
  const set = (name, value) => {
    const pattern = new RegExp(`^${name}\\s*=.*$`, "mu");
    block = pattern.test(block)
      ? block.replace(pattern, `${name} = ${value}`)
      : `${block}\n${name} = ${value}`;
  };
  set("enabled", "true");
  set("startup_timeout_sec", "30");
  set("tool_timeout_sec", "300");
  const output = `${source.slice(0, start)}${block}\n${source.slice(end)}`;
  const temporary = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, output, "utf8");
  fs.renameSync(temporary, configPath);
  return true;
}

function selfCheck(serverPath, projectRoot) {
  const input = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "xsxb-self-check", version: "1" },
      },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "prompts/list", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/templates/list", params: {} }),
    "",
  ].join("\n");
  const result = spawnSync(process.execPath, [serverPath], {
    input,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, XSXB_ROOT: projectRoot },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Installed MCP self-check failed: ${result.stderr}`);
  const messages = String(result.stdout || "")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const initialized = messages.find((message) => message.id === 1);
  const listed = messages.find((message) => message.id === 2);
  const prompts = messages.find((message) => message.id === 3);
  const resources = messages.find((message) => message.id === 4);
  if (
    initialized?.result?.protocolVersion !== "2025-11-25" ||
    listed?.result?.tools?.length !== 34 ||
    !prompts?.result?.prompts?.length ||
    !resources?.result?.resourceTemplates?.length
  ) {
    throw new Error(`Installed MCP self-check returned an invalid contract: ${result.stdout}`);
  }
  return {
    ok: true,
    protocolVersion: initialized.result.protocolVersion,
    serverInfo: initialized.result.serverInfo,
    toolCount: listed.result.tools.length,
    promptCount: prompts.result.prompts.length,
    resourceTemplateCount: resources.result.resourceTemplates.length,
  };
}

/**
 * Installs one immutable MCP build and optionally updates global Codex registration.
 * @param {{sourceRoot:string,projectRoot?:string,installRoot?:string,register?:boolean,dryRun?:boolean,codexBinary?:string}} options Install options.
 * @returns {object} Install receipt.
 */
function installXsxbMcp(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const projectRoot = path.resolve(options.projectRoot || sourceRoot);
  const installRoot = path.resolve(
    options.installRoot || path.join(os.homedir(), ".codex", "mcp-servers", "xsxb-frame-tuner"),
  );
  const runtime = createRuntimeInfo(sourceRoot, toolDefinitions(), { refreshContent: true });
  const buildId = String(runtime._meta["xsxb/buildId"]).replace(/[^a-zA-Z0-9_.+-]+/gu, "_");
  const buildDirectory = path.join(installRoot, buildId);
  const buildServerPath = path.join(buildDirectory, "tools", "xsxb_mcp_server.js");
  const serverPath = path.join(installRoot, "current", "tools", "xsxb_mcp_server.js");
  const receipt = { sourceRoot, projectRoot, installRoot, buildId, buildDirectory, serverPath };
  if (options.dryRun === true) return { ...receipt, dryRun: true, installed: false, registered: false };
  fs.mkdirSync(installRoot, { recursive: true });
  const currentPath = path.join(installRoot, "current");
  if (fs.existsSync(currentPath) && !fs.lstatSync(currentPath).isSymbolicLink()) {
    throw new Error(
      `Legacy MCP current path must be moved aside manually because it is not a symbolic link: ${currentPath}`,
    );
  }
  if (!fs.existsSync(buildDirectory)) {
    const stagingDirectory = path.join(installRoot, `.install-${buildId}-${process.pid}-${Date.now()}`);
    try {
      copyRuntime(sourceRoot, stagingDirectory);
      const stagedContentHash = runtimeContentHash(stagingDirectory);
      if (stagedContentHash !== runtime._meta["xsxb/runtimeContentHash"]) {
        throw new Error("MCP source changed during installation; retry the immutable build.");
      }
      fs.writeFileSync(
        path.join(stagingDirectory, "xsxb-mcp-build.json"),
        `${JSON.stringify(runtime, null, 2)}\n`,
        "utf8",
      );
      fs.renameSync(stagingDirectory, buildDirectory);
    } finally {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
  }
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(buildDirectory, "xsxb-mcp-build.json"), "utf8"),
  );
  if (installedManifest._meta?.["xsxb/buildId"] !== runtime._meta["xsxb/buildId"]) {
    throw new Error(`Immutable MCP build identity mismatch: ${buildDirectory}`);
  }
  if (runtimeContentHash(buildDirectory) !== installedManifest._meta["xsxb/runtimeContentHash"]) {
    throw new Error(`Immutable MCP build content is corrupted: ${buildDirectory}`);
  }
  const previousBuild = fs.existsSync(currentPath) ? fs.realpathSync(currentPath) : "";
  const checked = selfCheck(buildServerPath, projectRoot);
  switchCurrent(installRoot, buildDirectory);
  let registered = false;
  if (options.register === true) {
    const codex = options.codexBinary || "codex";
    const configPath = path.resolve(
      options.configPath ||
        path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml"),
    );
    const configExisted = fs.existsSync(configPath);
    const configBefore = configExisted ? fs.readFileSync(configPath) : null;
    try {
      try {
        execFileSync(codex, ["mcp", "remove", "xsxb-frame-tuner"], { stdio: "ignore" });
      } catch {
        // Missing registration is the normal first-install case.
      }
      execFileSync(
        codex,
        ["mcp", "add", "xsxb-frame-tuner", "--env", `XSXB_ROOT=${projectRoot}`, "--", "node", serverPath],
        { stdio: "ignore" },
      );
      ensureCodexTimeouts(configPath);
      registered = true;
    } catch (error) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      if (configExisted) {
        const temporary = `${configPath}.restore-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, configBefore);
        fs.renameSync(temporary, configPath);
      } else {
        fs.rmSync(configPath, { force: true });
      }
      if (previousBuild) switchCurrent(installRoot, previousBuild);
      else fs.rmSync(currentPath, { recursive: true, force: true });
      throw error;
    }
  }
  return { ...receipt, dryRun: false, installed: true, registered, selfCheck: checked };
}

module.exports = { copyRuntime, ensureCodexTimeouts, installXsxbMcp, selfCheck, switchCurrent };
