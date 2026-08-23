"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PLANS_PER_PROJECT = 100;

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function stablePlanHash(plan) {
  const stable = structuredClone(plan);
  for (const key of ["createdAt", "createdAtMs", "expiresAtMs"]) delete stable[key];
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/**
 * Creates a persistent reviewed-plan store scoped to project workspaces.
 * @param {{projectStore:object,now?:()=>number}} options Store options.
 * @returns {{save:Function,load:Function,remove:Function}} Plan store.
 */
function createReviewedPlanStore(options) {
  const projectStore = options.projectStore;
  const now = options.now || Date.now;
  const onRemove = typeof options.onRemove === "function" ? options.onRemove : () => {};
  const directoryFor = (project) =>
    path.join(projectStore.projectWorkspaceDir(project), ".xsxb", "reviews", "plans");

  function planPath(project, planId) {
    if (!/^[a-z]+_[a-f0-9]{24}$/u.test(String(planId || ""))) throw new Error("Invalid reviewed plan id.");
    return path.join(directoryFor(project), `${planId}.json`);
  }

  function rawPlans(project) {
    const directory = directoryFor(project);
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .flatMap((entry) => {
        const filePath = path.join(directory, entry.name);
        try {
          return [{ filePath, plan: JSON.parse(fs.readFileSync(filePath, "utf8")) }];
        } catch {
          fs.rmSync(filePath, { force: true });
          return [];
        }
      });
  }

  function prune(project) {
    const retained = [];
    for (const entry of rawPlans(project)) {
      if (Number(entry.plan.expiresAtMs || 0) <= now()) {
        fs.rmSync(entry.filePath, { force: true });
        onRemove(project, entry.plan);
      } else {
        retained.push(entry);
      }
    }
    retained
      .sort((left, right) => Number(right.plan.createdAtMs || 0) - Number(left.plan.createdAtMs || 0))
      .slice(MAX_PLANS_PER_PROJECT)
      .forEach((entry) => {
        fs.rmSync(entry.filePath, { force: true });
        onRemove(project, entry.plan);
      });
  }

  function save(project, plan) {
    prune(project);
    const destination = planPath(project, plan.planId);
    if (fs.existsSync(destination)) {
      const existing = JSON.parse(fs.readFileSync(destination, "utf8"));
      if (Number(existing.expiresAtMs || 0) > now()) {
        if (stablePlanHash(existing) !== stablePlanHash(plan)) {
          throw new Error(`Reviewed attachment plan id collision with different content: ${plan.planId}`);
        }
        return existing;
      }
      fs.rmSync(destination, { force: true });
      onRemove(project, existing);
    }
    const createdAtMs = Number(plan.createdAtMs || now());
    const persisted = {
      ...structuredClone(plan),
      createdAtMs,
      expiresAtMs: Number(plan.expiresAtMs || createdAtMs + PLAN_RETENTION_MS),
    };
    atomicJson(destination, persisted);
    prune(project);
    return persisted;
  }

  function load(project, planId) {
    const filePath = planPath(project, planId);
    if (!fs.existsSync(filePath)) throw new Error(`Reviewed attachment plan not found: ${planId}`);
    const plan = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Number(plan.expiresAtMs || 0) <= now()) {
      fs.rmSync(filePath, { force: true });
      onRemove(project, plan);
      throw new Error(`Reviewed attachment plan expired: ${planId}`);
    }
    return plan;
  }

  function remove(project, planId) {
    const filePath = planPath(project, planId);
    let plan = null;
    if (fs.existsSync(filePath)) {
      try {
        plan = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        // Corrupt plan metadata is removed but cannot identify a referenced artifact.
      }
    }
    fs.rmSync(filePath, { force: true });
    if (plan) onRemove(project, plan);
  }

  for (const project of projectStore.readRegistry().projects) prune(project);

  return { load, prune, remove, save };
}

module.exports = { MAX_PLANS_PER_PROJECT, PLAN_RETENTION_MS, createReviewedPlanStore };
