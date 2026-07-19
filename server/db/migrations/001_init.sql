-- Collectory initial schema (DESIGN.md §3, authoritative DDL)
-- Tables created in dependency order so forward FK references resolve.

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  color TEXT NOT NULL DEFAULT '#6b7280',
  description TEXT NOT NULL DEFAULT '',
  template_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE field_defs (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  options_json TEXT,
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  show_in_table INTEGER NOT NULL DEFAULT 0,
  show_on_card INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT 'Details',
  placeholder TEXT, help TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(collection_id, key)
);

CREATE TABLE log_types (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'note',
  color TEXT NOT NULL DEFAULT '#6b7280',
  fields_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(collection_id, key)
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'owned',
  quantity REAL NOT NULL DEFAULT 1,
  min_quantity REAL,
  acquired_date TEXT, acquired_price_cents INTEGER, acquired_from TEXT,
  current_value_cents INTEGER, value_updated_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '{}',
  cover_photo_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_items_collection ON items(collection_id, deleted_at);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  log_type_key TEXT NOT NULL,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  linked_log_id INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_logs_item ON logs(item_id, date);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  log_id INTEGER REFERENCES logs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT, width INTEGER, height INTEGER, size_bytes INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE provenance (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL,
  from_date TEXT, to_date TEXT,
  how_acquired TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE valuations (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date TEXT NOT NULL, value_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'estimate',
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL, mime TEXT, size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#6b7280');
CREATE TABLE item_tags (item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                        PRIMARY KEY (item_id, tag_id));

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

-- content='' + contentless_delete=1 so per-row DELETE/rebuild works (SQLite >=3.43).
CREATE VIRTUAL TABLE items_fts USING fts5(name, notes, field_text, content='', contentless_delete=1);
