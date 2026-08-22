"use strict";

const { tunerRootHash, waitForTuner } = require("./xsxb_mcp_processes");

const DEFAULT_TUNER_HOST = "127.0.0.1";
const DEFAULT_TUNER_PORT = 5179;

/**
 * Creates a root-aware Tuner launcher that never reuses a foreign checkout.
 * @param {{root:string,animationFor:Function,registryProject:Function,probeTuner:Function,launchTuner:Function,fastLaunchProbe?:boolean}} dependencies Service dependencies.
 * @returns {(args?:object)=>Promise<object>} Open-Tuner handler.
 */
function createOpenTunerHandler(dependencies) {
  const { root, animationFor, registryProject, probeTuner, launchTuner, fastLaunchProbe } = dependencies;

  return async function openTuner(args = {}) {
    const requestedAnimation = Boolean(args.animation_id || args.animation);
    let project;
    let profileId = String(args.profile_id || args.profile || "").trim();
    let animationId = String(args.animation_id || args.animation || "").trim();
    if (requestedAnimation) {
      const selection = animationFor(args);
      project = selection.project;
      profileId = selection.profile.id;
      animationId = String(selection.animation.id || selection.animation.name);
    } else {
      project = registryProject(args.project_id || args.project, false);
    }
    const requestedPort = Math.max(1, Number(args.port || process.env.PORT || DEFAULT_TUNER_PORT));
    const host = DEFAULT_TUNER_HOST;
    const expectedRootHash = tunerRootHash(root);
    const workspaceUrlFor = (port) => {
      const url = new URL(`http://${host}:${port}/workspace`);
      url.searchParams.set("project", project.id);
      if (profileId) url.searchParams.set("profile", profileId);
      if (animationId) url.searchParams.set("animation", animationId);
      return url.toString();
    };
    const normalizeProbe = (raw) => {
      if (raw === true) return { reachable: true, compatible: true, rootHash: expectedRootHash };
      if (!raw) return { reachable: false, compatible: false, rootHash: "" };
      return {
        reachable: raw.reachable === true,
        compatible: raw.compatible === true,
        rootHash: String(raw.rootHash || ""),
      };
    };
    const probePort = async (port) =>
      normalizeProbe(await probeTuner(workspaceUrlFor(port), { rootHash: expectedRootHash }));
    const shouldStart = args.start !== false;
    let port = requestedPort;
    let probe = await probePort(port);
    let conflictPort = null;
    if (probe.reachable && !probe.compatible) {
      conflictPort = port;
      if (shouldStart) {
        const selected = await nextAvailablePort(port, probePort);
        if (!selected) throw new Error(`No free Tuner port found after foreign instance on ${port}.`);
        port = selected.port;
        probe = selected.probe;
      }
    }
    let reused = probe.compatible;
    let launched = false;
    let pid = null;
    const workspaceUrl = workspaceUrlFor(port);
    if (!probe.reachable && shouldStart) {
      const spawned = (await launchTuner({ root, port, host, url: workspaceUrl })) || {};
      pid = spawned.pid || null;
      launched = true;
      reused = fastLaunchProbe
        ? (await probePort(port)).compatible
        : await waitForTuner((url) => probeTuner(url, { rootHash: expectedRootHash }), workspaceUrl);
      if (!reused && !fastLaunchProbe) {
        throw new Error(`Tuner did not start at http://${host}:${port}.`);
      }
    }
    return {
      projectId: project.id,
      profileId,
      animationId,
      url: workspaceUrl,
      port,
      rootHash: expectedRootHash,
      conflictPort,
      launched,
      reused: Boolean(reused && !launched),
      started: Boolean(reused || launched),
      pid,
    };
  };
}

/**
 * Finds either a compatible running Tuner or the first free adjacent port.
 * @param {number} port Occupied starting port.
 * @param {(port:number)=>Promise<object>} probePort Identity-aware probe.
 * @returns {Promise<{port:number,probe:object}|null>} Selected port or null.
 */
async function nextAvailablePort(port, probePort) {
  for (let candidate = port + 1; candidate <= Math.min(65535, port + 20); candidate += 1) {
    const probe = await probePort(candidate);
    if (probe.compatible || !probe.reachable) return { port: candidate, probe };
  }
  return null;
}

module.exports = { createOpenTunerHandler, nextAvailablePort };
