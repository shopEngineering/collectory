'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Load and validate all built-in collection templates from server/templates/*.json.
// Invalid templates are logged and skipped (never crash startup). The loaded set
// is cached on the returned object; GET /api/templates serves it.
function loadTemplates(logger) {
  const log = logger || console;
  const templates = [];
  let files = [];
  try {
    files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  } catch (e) {
    log.warn(`[templates] cannot read templates dir: ${e.message}`);
    return { list: templates, byKey: new Map() };
  }
  for (const file of files.sort()) {
    const full = path.join(TEMPLATES_DIR, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      log.warn(`[templates] ${file}: invalid JSON, skipping (${e.message})`);
      continue;
    }
    const problems = validateTemplate(raw);
    if (problems.length) {
      log.warn(`[templates] ${file}: invalid shape, skipping — ${problems.join('; ')}`);
      continue;
    }
    templates.push(normalizeTemplate(raw));
  }
  const byKey = new Map(templates.map((t) => [t.key, t]));
  return { list: templates, byKey };
}

function validateTemplate(t) {
  const problems = [];
  if (!t || typeof t !== 'object') return ['not an object'];
  for (const k of ['key', 'name']) {
    if (typeof t[k] !== 'string' || !t[k]) problems.push(`missing ${k}`);
  }
  if (t.fields != null && !Array.isArray(t.fields)) problems.push('fields not an array');
  if (t.logTypes != null && !Array.isArray(t.logTypes)) problems.push('logTypes not an array');
  for (const f of t.fields || []) {
    if (!f || typeof f.key !== 'string' || !f.key) {
      problems.push('a field is missing key');
      break;
    }
    if (typeof f.type !== 'string' || !f.type) {
      problems.push(`field ${f.key} missing type`);
      break;
    }
  }
  for (const lt of t.logTypes || []) {
    if (!lt || typeof lt.key !== 'string' || !lt.key) {
      problems.push('a logType is missing key');
      break;
    }
    if (lt.fields != null && !Array.isArray(lt.fields)) {
      problems.push(`logType ${lt.key} fields not an array`);
      break;
    }
  }
  return problems;
}

function normalizeTemplate(t) {
  return {
    key: t.key,
    name: t.name,
    icon: t.icon || 'box',
    color: t.color || '#6b7280',
    description: t.description || '',
    fields: (t.fields || []).map((f) => ({ ...f })),
    logTypes: (t.logTypes || []).map((lt) => ({ ...lt, fields: lt.fields || [] })),
  };
}

module.exports = { loadTemplates, validateTemplate, TEMPLATES_DIR };
