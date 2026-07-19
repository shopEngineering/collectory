'use strict';
const m = require('../util/mappers');

// Insert field_defs rows for a collection from an array of FieldDef-shaped objects.
function insertFields(db, collectionId, fields) {
  const stmt = db.prepare(
    `INSERT INTO field_defs
     (collection_id, key, label, type, options_json, unit, required, show_in_table, show_on_card, section, placeholder, help, sort_order)
     VALUES (@collection_id, @key, @label, @type, @options_json, @unit, @required, @show_in_table, @show_on_card, @section, @placeholder, @help, @sort_order)`
  );
  fields.forEach((f, i) => {
    const row = m.fieldDefFromApi(f, i);
    stmt.run({ collection_id: collectionId, ...row });
  });
}

// Insert log_types rows. Each logType's `fields` array is stored as fields_json.
function insertLogTypes(db, collectionId, logTypes) {
  const stmt = db.prepare(
    `INSERT INTO log_types (collection_id, key, label, icon, color, fields_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  logTypes.forEach((lt, i) => {
    stmt.run(
      collectionId,
      lt.key,
      lt.label != null ? lt.label : lt.key,
      lt.icon || 'note',
      lt.color || '#6b7280',
      JSON.stringify(lt.fields || []),
      i
    );
  });
}

const NOTE_LOG_TYPE = { key: 'note', label: 'Note', icon: 'note', color: '#6b7280', fields: [] };

// Guarantee a 'note' log type exists on a collection (idempotent).
function ensureNoteLogType(db, collectionId) {
  const exists = db.prepare('SELECT 1 FROM log_types WHERE collection_id = ? AND key = ?').get(collectionId, 'note');
  if (exists) return;
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS s FROM log_types WHERE collection_id = ?').get(collectionId).s;
  db.prepare(
    `INSERT INTO log_types (collection_id, key, label, icon, color, fields_json, sort_order)
     VALUES (?, 'note', 'Note', 'note', '#6b7280', '[]', ?)`
  ).run(collectionId, maxSort + 1);
}

// Create a collection, optionally from a template. Returns the new collection id.
function createCollection(db, templatesByKey, body) {
  const now = new Date().toISOString();
  const tpl = body.templateKey ? templatesByKey.get(body.templateKey) : null;
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS s FROM collections').get().s;
  const info = db
    .prepare(
      `INSERT INTO collections (name, icon, color, description, template_key, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      body.name,
      body.icon || (tpl ? tpl.icon : 'box'),
      body.color || (tpl ? tpl.color : '#6b7280'),
      body.description != null ? body.description : (tpl ? tpl.description : ''),
      body.templateKey || null,
      maxSort + 1,
      now,
      now
    );
  const id = info.lastInsertRowid;
  if (tpl) {
    insertFields(db, id, tpl.fields);
    insertLogTypes(db, id, tpl.logTypes);
  }
  ensureNoteLogType(db, id); // always
  return id;
}

module.exports = { insertFields, insertLogTypes, ensureNoteLogType, createCollection, NOTE_LOG_TYPE };
