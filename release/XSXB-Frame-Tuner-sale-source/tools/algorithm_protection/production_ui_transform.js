"use strict";

/**
 * Locates the closing brace of a named function without being confused by
 * braces in strings, templates, or comments.
 * @param {string} source JavaScript source.
 * @param {number} openingBrace Index of the function's opening brace.
 * @returns {number} Index immediately after its closing brace.
 */
function findFunctionEnd(source, openingBrace) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (['"', "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return index + 1;
  }
  throw new Error("Production UI transform found an unterminated function.");
}

/**
 * Finds the body brace after a function parameter list, including parameters
 * with nested object/array defaults.
 * @param {string} source JavaScript source.
 * @param {number} parameterStart Index immediately after the opening parenthesis.
 * @returns {number} Function body opening-brace index.
 */
function findFunctionBodyStart(source, parameterStart) {
  let depth = 1;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = parameterStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (['"', "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character !== ")") continue;
    depth -= 1;
    if (depth !== 0) continue;
    let bodyStart = index + 1;
    while (/\s/u.test(source[bodyStart])) bodyStart += 1;
    if (source[bodyStart] === "{") return bodyStart;
    throw new Error("Production transform found a function without a body.");
  }
  throw new Error("Production transform found an unterminated parameter list.");
}

/**
 * Replaces development-only algorithm implementations with a fail-closed stub.
 * @param {string} source Combined UI JavaScript.
 * @param {string[]} functionNames Function declarations to remove.
 * @returns {string} Production-only source.
 */
function removeNamedFunctions(source, functionNames) {
  let output = source;
  for (const functionName of functionNames) {
    const expression = new RegExp(`function\\s+${functionName}\\s*\\(`, "u");
    const match = expression.exec(output);
    if (!match) throw new Error(`Required development function was not found: ${functionName}`);
    const openingBrace = findFunctionBodyStart(output, match.index + match[0].length);
    const functionEnd = findFunctionEnd(output, openingBrace);
    const stub = `function ${functionName}(){throw new Error("ENGINE_PRODUCTION_DEPENDENCY_MISSING")}`;
    output = `${output.slice(0, match.index)}${stub}${output.slice(functionEnd)}`;
  }
  return output;
}

/**
 * Removes readable development algorithm bodies from the production UI bundle.
 * @param {string} source Combined UI source.
 * @returns {string} Production UI source.
 */
function createProductionUiSource(source) {
  return removeNamedFunctions(source, [
    "decorateDevelopmentResult",
    "analyzeDevelopmentRepairTracking",
    "createDevelopmentJsAdapter",
  ]);
}

/**
 * Removes JavaScript copies of kernels that production Workers must execute in WASM.
 * The surrounding product orchestration remains JavaScript and fails closed if
 * the verified WASM instance was not initialized.
 * @param {string} source Combined product Worker source.
 * @returns {string} Worker source without protected fallback bodies.
 */
function createProductionAlgorithmWorkerSource(source) {
  return removeNamedFunctions(source, [
    "applyReferenceColorReplace",
    "applyReferenceFloodFillDespill",
    "selectReferenceProtectedColors",
    "computeDevelopmentLocalFrame",
    "checkDevelopmentShapeMatch",
    "applyDevelopmentReferenceEdgeColorRestore",
    "chamfer345Distance",
  ]);
}

module.exports = Object.freeze({
  createProductionAlgorithmWorkerSource,
  createProductionUiSource,
  findFunctionBodyStart,
  findFunctionEnd,
  removeNamedFunctions,
});
