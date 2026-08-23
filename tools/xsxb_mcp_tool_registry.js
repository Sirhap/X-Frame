"use strict";

/**
 * Binds declarative MCP tool contracts to their execution adapters.
 * @param {{tools:object[],handlers:Record<string,Function>}} options Registry inputs.
 * @returns {{tools:object[],names:string[],descriptor:(name:string)=>object,call:(name:string,args:object)=>Promise<object>|object}} Registry.
 */
function createMcpToolRegistry(options) {
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const handlers = options.handlers || {};
  const descriptors = new Map();
  for (const tool of tools) {
    if (!tool?.name || descriptors.has(tool.name))
      throw new Error(`Duplicate or invalid MCP tool: ${tool?.name}`);
    const handler = handlers[tool.name];
    if (typeof handler !== "function") throw new Error(`MCP tool has no handler adapter: ${tool.name}`);
    descriptors.set(tool.name, {
      ...tool,
      handler,
      probeName: tool.name,
      mode: tool.annotations?.readOnlyHint ? "read" : "write",
    });
  }
  const extraHandlers = Object.keys(handlers).filter((name) => !descriptors.has(name));
  if (extraHandlers.length)
    throw new Error(`MCP handlers have no tool contract: ${extraHandlers.join(", ")}`);
  return {
    tools,
    names: [...descriptors.keys()],
    descriptor(name) {
      const descriptor = descriptors.get(name);
      if (!descriptor) throw new Error(`Unknown XSXB MCP tool: ${name}`);
      return descriptor;
    },
    call(name, args) {
      return this.descriptor(name).handler(args);
    },
  };
}

function auditProbeCoverage(toolNames, probeNames) {
  const tools = new Set(toolNames || []);
  const probes = new Set(probeNames || []);
  return {
    missing: [...tools].filter((name) => !probes.has(name)),
    extra: [...probes].filter((name) => !tools.has(name)),
  };
}

module.exports = { auditProbeCoverage, createMcpToolRegistry };
