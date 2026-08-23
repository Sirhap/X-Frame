"use strict";

/**
 * Runtime validation for the JSON Schema subset the XSXB MCP tools declare.
 *
 * The catalog advertises `additionalProperties: false`, `required`, `enum` and
 * numeric bounds, but the dispatcher used to pass arguments straight through,
 * so a misspelled property was silently ignored and the tool quietly ran with
 * its defaults. This module closes that gap without narrowing what already
 * works: the handlers deliberately accept the stringified numbers and booleans
 * that agents send, so those keep passing. Only input that cannot be
 * interpreted at all is rejected.
 */

const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no", "1", "0"]);

/**
 * Reads a value's JSON Schema type name.
 * @param {unknown} value Candidate value.
 * @returns {string} Schema type name.
 */
function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Whether a value satisfies one declared property type, allowing the string and
 * numeric spellings the tool handlers already normalize.
 * @param {unknown} value Candidate value.
 * @param {string} expected Declared JSON Schema type.
 * @returns {boolean} Whether the value is usable as that type.
 */
function parseNumeric(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);
  const trimmed = value.trim();
  const fraction = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : NaN;
  }
  return trimmed ? Number(trimmed) : NaN;
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some((candidate) => matchesType(value, candidate));
  const actual = typeOf(value);
  if (expected === "string") return actual === "string";
  if (expected === "array") return actual === "array";
  if (expected === "object") return actual === "object";
  if (expected === "boolean") {
    if (actual === "boolean") return true;
    if (actual === "number") return value === 0 || value === 1;
    return actual === "string" && BOOLEAN_WORDS.has(value.trim().toLowerCase());
  }
  if (expected === "number" || expected === "integer") {
    const numeric = parseNumeric(value);
    if (!Number.isFinite(numeric)) return false;
    return expected === "number" || Number.isInteger(numeric);
  }
  return true;
}

/**
 * Reads a declared numeric property as a number for bound checks.
 * @param {unknown} value Candidate value.
 * @returns {number} Parsed number, or NaN.
 */
function asNumber(value) {
  return parseNumeric(value);
}

/**
 * Finds the declared property name closest to an unknown one, so a typo points
 * at its intended target instead of just failing.
 * @param {string} unknown Rejected property name.
 * @param {string[]} candidates Declared property names.
 * @returns {string} Closest name, or an empty string when nothing is close.
 */
function closestName(unknown, candidates) {
  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    const shorter = unknown.length < candidate.length ? unknown : candidate;
    const longer = unknown.length < candidate.length ? candidate : unknown;
    if (!longer.startsWith(shorter.slice(0, Math.min(3, shorter.length)))) continue;
    let shared = 0;
    while (shared < shorter.length && shorter[shared] === longer[shared]) shared += 1;
    const score = shared / longer.length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 0.6 ? best : "";
}

/**
 * Validates one tool call's arguments against its declared input schema.
 * @param {string} toolName Tool being called.
 * @param {object} schema Declared input schema.
 * @param {object} args Caller-supplied arguments.
 * @returns {object} The same arguments, once they are known to be usable.
 * @throws {Error} When an argument is missing, unknown, or unusable.
 */
function validateToolArguments(toolName, schema, args) {
  /**
   * Raises a validation failure naming the tool and the property at fault.
   * @param {string} message Problem description.
   * @returns {never}
   */
  const reject = (message) => {
    const error = new Error(`${toolName}: ${message}`);
    error.code = "xsxb_invalid_arguments";
    throw error;
  };

  /**
   * Recursively validates the schema subset used by tool descriptors.
   * @param {object} nodeSchema Current schema node.
   * @param {unknown} value Current value.
   * @param {string} location Human-readable argument path.
   */
  function validateNode(nodeSchema, value, location) {
    if (value === undefined) return;
    if (nodeSchema?.type && !matchesType(value, nodeSchema.type)) {
      reject(
        `${location} must be ${Array.isArray(nodeSchema.type) ? nodeSchema.type.join(" or ") : nodeSchema.type}, received ${typeOf(value)}.`,
      );
    }
    if (Array.isArray(nodeSchema?.enum) && !nodeSchema.enum.includes(value)) {
      reject(`${location} must be one of: ${nodeSchema.enum.join(", ")}. Received "${value}".`);
    }
    if (nodeSchema?.minimum !== undefined && asNumber(value) < nodeSchema.minimum) {
      reject(`${location} must be at least ${nodeSchema.minimum}. Received ${value}.`);
    }
    if (nodeSchema?.exclusiveMinimum !== undefined && asNumber(value) <= nodeSchema.exclusiveMinimum) {
      reject(`${location} must be greater than ${nodeSchema.exclusiveMinimum}. Received ${value}.`);
    }
    if (nodeSchema?.maximum !== undefined && asNumber(value) > nodeSchema.maximum) {
      reject(`${location} must be at most ${nodeSchema.maximum}. Received ${value}.`);
    }
    if (nodeSchema?.type === "array" && Array.isArray(value) && nodeSchema.items) {
      value.forEach((item, index) => validateNode(nodeSchema.items, item, `${location}[${index}]`));
    }
    if (nodeSchema?.type !== "object" || !value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    const properties = nodeSchema.properties || {};
    const declared = Object.keys(properties);
    for (const name of nodeSchema.required || []) {
      const requiredValue = value[name];
      if (requiredValue === undefined || requiredValue === null || requiredValue === "") {
        reject(`${location} is missing required property "${name}".`);
      }
    }
    for (const [name, child] of Object.entries(value)) {
      const property = properties[name];
      if (!property) {
        if (nodeSchema.additionalProperties !== false) continue;
        const suggestion = closestName(name, declared);
        reject(
          `${location} has unknown property "${name}".${suggestion ? ` Did you mean "${suggestion}"?` : ""} ` +
            `Accepted properties: ${declared.length ? declared.join(", ") : "none"}.`,
        );
      }
      validateNode(property, child, `${location}.${name}`);
    }
  }

  const root = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const properties = schema?.properties || {};
  for (const name of schema?.required || []) {
    const value = root[name];
    if (value === undefined || value === null || value === "") {
      reject(`missing required argument "${name}".`);
    }
  }
  for (const [name, value] of Object.entries(root)) {
    const property = properties[name];
    if (!property) {
      if (schema?.additionalProperties !== false) continue;
      const declared = Object.keys(properties);
      const suggestion = closestName(name, declared);
      reject(
        `unknown argument "${name}".${suggestion ? ` Did you mean "${suggestion}"?` : ""} ` +
          `Accepted arguments: ${declared.length ? declared.join(", ") : "none"}.`,
      );
    }
    validateNode(property, value, `argument "${name}"`);
  }
  return args;
}

/**
 * Validates the stable root type promised by an MCP tool output schema.
 * @param {string} toolName Tool name.
 * @param {object|undefined} schema Declared output schema.
 * @param {unknown} result Successful handler result.
 * @returns {unknown} Original result.
 */
function validateToolResult(toolName, schema, result) {
  if (schema?.type === "object" && (!result || typeof result !== "object" || Array.isArray(result))) {
    const error = new Error(`${toolName} output must be object, received ${typeOf(result)}.`);
    error.code = "xsxb_invalid_tool_result";
    throw error;
  }
  validateToolArguments(`${toolName} output`, schema, result);
  return result;
}

module.exports = { validateToolArguments, validateToolResult };
