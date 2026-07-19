-- v1.1 (revised): magazines are CHILD RECORDS of a firearm item (like provenance),
-- not items in their own collection. A magazine can hold certain ammunition:
-- holds_ammo_json = ammo item ids it accepts; loaded_with = ammo item currently in it.
-- Loaded state has NO quantity effect on the ammo lot (only firing deducts).
CREATE TABLE magazines (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,  -- parent firearm
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  capacity REAL,                               -- rds
  caliber TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,            -- count of identical magazines
  holds_ammo_json TEXT NOT NULL DEFAULT '[]',  -- ammo item ids this magazine accepts
  loaded INTEGER NOT NULL DEFAULT 0,
  loaded_with INTEGER,                         -- ammo item id currently loaded (no FK; app-managed)
  loaded_rounds REAL,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_magazines_item ON magazines(item_id);
