"use strict";

const SERVING_STYLES = ["Hot", "Iced", "Blended"];

function key(value) { return String(value || "").trim().toLowerCase(); }

function fail(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}

function validate(optionCosts, inventory, groups) {
  if (!optionCosts || typeof optionCosts !== "object" || Array.isArray(optionCosts)) fail("Shared choice ingredients are invalid.");
  const temperatureId = Object.keys(groups || {}).find((id) => key(groups[id] && groups[id].name) === "temperature");
  const temperatureLabels = temperatureId ? (groups[temperatureId].choices || []).map((choice) => String(choice && choice.label || "")) : [];
  const allowedStyles = new Map(SERVING_STYLES.map((label) => [key(label), label]));
  let rows = 0;

  for (const groupId of Object.keys(optionCosts)) {
    const group = groups[groupId], choices = optionCosts[groupId];
    if (!group || !choices || typeof choices !== "object" || Array.isArray(choices)) fail(`Choice group ${groupId} is invalid.`);
    for (const choiceKey of Object.keys(choices)) {
      const entry = choices[choiceKey], lines = entry && entry.ings, coverage = {};
      if (!entry || !Array.isArray(lines) || !lines.length || lines.length > 20) fail(`Shared choice ${choiceKey} has invalid ingredient rows.`);
      for (const line of lines) {
        rows++;
        const ing = String(line && line.ing || ""), when = line && line.when || {}, scopeIds = Object.keys(when);
        if (!inventory[ing]) fail(`Shared choice ingredient ${ing || "(blank)"} is missing from Inventory.`);
        if (scopeIds.some((id) => id !== temperatureId) || scopeIds.some((id) => !temperatureLabels.includes(String(when[id])))) fail(`Shared choice ${choiceKey} has an invalid temperature assignment.`);
        if (line.useFor != null && (!Array.isArray(line.useFor) || !line.useFor.length)) fail(`Shared choice ${choiceKey} has an invalid serving-style assignment.`);
        if (line.useFor != null && scopeIds.length) fail(`Shared choice ${choiceKey} cannot combine legacy temperature and serving-style assignments.`);

        const rawStyles = Array.isArray(line.useFor) ? line.useFor : (when[temperatureId] ? [when[temperatureId]] : SERVING_STYLES);
        const styles = rawStyles.map((label) => allowedStyles.get(key(label)));
        if (styles.some((label) => !label) || new Set(styles).size !== styles.length) fail(`Shared choice ${choiceKey} has an invalid serving-style assignment.`);
        coverage[ing] = coverage[ing] || {};
        for (const label of styles) {
          if (coverage[ing][label]) fail(`Shared choice ${choiceKey} assigns ${ing} to ${label} more than once.`);
          coverage[ing][label] = true;
        }
        for (const size of ["S", "M", "L"]) {
          const qty = Number(line[`qty${size}`]);
          if (!Number.isFinite(qty) || qty < 0 || qty > 1000000) fail(`Shared choice ${choiceKey} has an invalid ${size} quantity.`);
        }
      }
    }
  }
  if (rows > 500) fail("Shared choice ingredients contain too many rows.");
  return {rows};
}

module.exports = {SERVING_STYLES, validate};
