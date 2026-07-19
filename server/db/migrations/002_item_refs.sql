-- v1.1 magazines & item references (DESIGN §5.2)
-- field_defs gains ref_template for item_ref / item_refs / ammo_ref field types
-- (a template key the referenced item must belong to, or NULL = any item).
ALTER TABLE field_defs ADD COLUMN ref_template TEXT;
