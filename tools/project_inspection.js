const fs = require("node:fs");
const path = require("node:path");
const { reslash } = require("./project_store");

const DEFAULT_SKIP_DIRECTORIES = new Set([
  ".git",
  ".godot",
  ".import",
  "addons",
  "node_modules",
  "_external_vfx",
]);

/**
 * Reads the GDScript and scene facts required by project validation in one tree walk.
 * @param {string} projectRoot Godot project root.
 * @returns {{root:string,gdScripts:Array<{path:string,relativePath:string,text:string,lines:string[]}>,scenes:Array<{path:string,relativePath:string,text:string}>}} Immutable inspection facts.
 */
function createProjectInspection(projectRoot) {
  const root = projectRoot ? path.resolve(String(projectRoot)) : "";
  const inspection = { root, gdScripts: [], scenes: [] };
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return inspection;

  /**
   * Visits relevant project source files while excluding generated and dependency folders.
   * @param {string} directory Current directory.
   * @returns {void}
   */
  function walk(directory) {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DEFAULT_SKIP_DIRECTORIES.has(entry.name)) walk(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension !== ".gd" && extension !== ".tscn") continue;
      const filePath = path.join(directory, entry.name);
      let text = "";
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const relativePath = reslash(path.relative(root, filePath));
      if (extension === ".gd") {
        inspection.gdScripts.push({ path: filePath, relativePath, text, lines: text.split(/\r?\n/) });
      } else {
        inspection.scenes.push({ path: filePath, relativePath, text });
      }
    }
  }

  walk(root);
  return inspection;
}

module.exports = { createProjectInspection };
