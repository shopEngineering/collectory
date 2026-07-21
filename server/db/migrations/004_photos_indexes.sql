-- Performance: photos are looked up by item_id (cover thumb on every listing row,
-- N+1 without an index) and by log_id (log photo lists). Add both. logs(item_id)
-- is already covered by idx_logs_item(item_id, date) from 001, so no logs index here.
CREATE INDEX IF NOT EXISTS idx_photos_item ON photos(item_id);
CREATE INDEX IF NOT EXISTS idx_photos_log ON photos(log_id);
