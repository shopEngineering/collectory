'use strict';

// snake_case DB rows <-> camelCase API JSON. These transform whole entities per
// the DESIGN.md §3/§4 contract. Money stays integer cents throughout.

const bool = (v) => v === 1 || v === true;
const parseJson = (s, fallback) => {
  if (s === null || s === undefined) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// ---- FieldDef ----
// DB row (field_defs) -> API FieldDef
function fieldDefToApi(row) {
  const out = {
    key: row.key,
    label: row.label,
    type: row.type,
    section: row.section,
    required: bool(row.required),
    showInTable: bool(row.show_in_table),
    showOnCard: bool(row.show_on_card),
    sortOrder: row.sort_order,
  };
  const opts = parseJson(row.options_json, null);
  if (opts != null) out.options = opts;
  if (row.unit != null) out.unit = row.unit;
  if (row.placeholder != null) out.placeholder = row.placeholder;
  if (row.help != null) out.help = row.help;
  return out;
}

// API FieldDef (or template field) -> DB column values (partial row, no id/collection_id)
function fieldDefFromApi(f, sortOrder) {
  return {
    key: f.key,
    label: f.label != null ? f.label : f.key,
    type: f.type || 'text',
    options_json: f.options != null ? JSON.stringify(f.options) : null,
    unit: f.unit != null ? f.unit : null,
    required: f.required ? 1 : 0,
    show_in_table: f.showInTable ? 1 : 0,
    show_on_card: f.showOnCard ? 1 : 0,
    section: f.section != null ? f.section : 'Details',
    placeholder: f.placeholder != null ? f.placeholder : null,
    help: f.help != null ? f.help : null,
    sort_order: sortOrder != null ? sortOrder : (f.sortOrder != null ? f.sortOrder : 0),
  };
}

// ---- LogTypeDef ----
// LogType fields_json entries are the same FieldDef shape minus table/card flags.
function logTypeFieldToApi(f) {
  const out = { key: f.key, label: f.label != null ? f.label : f.key, type: f.type || 'text' };
  if (f.options != null) out.options = f.options;
  if (f.unit != null) out.unit = f.unit;
  if (f.section != null) out.section = f.section;
  if (f.placeholder != null) out.placeholder = f.placeholder;
  if (f.help != null) out.help = f.help;
  if (f.required != null) out.required = !!f.required;
  return out;
}

function logTypeToApi(row) {
  return {
    key: row.key,
    label: row.label,
    icon: row.icon,
    color: row.color,
    fields: parseJson(row.fields_json, []).map(logTypeFieldToApi),
    sortOrder: row.sort_order,
  };
}

// ---- Collection ----
function collectionToApi(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    description: row.description,
    templateKey: row.template_key,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- Item (full/core) ----
function itemCoreToApi(row) {
  return {
    id: row.id,
    collectionId: row.collection_id,
    name: row.name,
    status: row.status,
    quantity: row.quantity,
    minQuantity: row.min_quantity,
    acquiredDate: row.acquired_date,
    acquiredPriceCents: row.acquired_price_cents,
    acquiredFrom: row.acquired_from,
    currentValueCents: row.current_value_cents,
    valueUpdatedAt: row.value_updated_at,
    notes: row.notes,
    fields: parseJson(row.fields_json, {}),
    coverPhotoId: row.cover_photo_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// ---- Photo ----
function photoToApi(row) {
  return {
    id: row.id,
    url: `/images/orig/${row.filename}`,
    thumbUrl: `/images/thumb/${thumbName(row.filename)}`,
    filename: row.filename,
    originalName: row.original_name,
    caption: row.caption,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// thumbnails are always uuid.jpg regardless of original extension
function thumbName(filename) {
  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  return `${base}.jpg`;
}

function attachmentToApi(row) {
  return {
    id: row.id,
    url: `/attachments/${row.filename}`,
    originalName: row.original_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function logToApi(row, photos) {
  return {
    id: row.id,
    itemId: row.item_id,
    logTypeKey: row.log_type_key,
    date: row.date,
    title: row.title,
    notes: row.notes,
    data: parseJson(row.data_json, {}),
    linkedLogId: row.linked_log_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: photos || [],
  };
}

function provenanceToApi(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    ownerName: row.owner_name,
    fromDate: row.from_date,
    toDate: row.to_date,
    howAcquired: row.how_acquired,
    notes: row.notes,
    sortOrder: row.sort_order,
  };
}

function valuationToApi(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    date: row.date,
    valueCents: row.value_cents,
    source: row.source,
    notes: row.notes,
  };
}

function tagToApi(row) {
  return { id: row.id, name: row.name, color: row.color };
}

module.exports = {
  bool,
  parseJson,
  thumbName,
  fieldDefToApi,
  fieldDefFromApi,
  logTypeToApi,
  logTypeFieldToApi,
  collectionToApi,
  itemCoreToApi,
  photoToApi,
  attachmentToApi,
  logToApi,
  provenanceToApi,
  valuationToApi,
  tagToApi,
};
