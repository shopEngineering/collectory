'use strict';
const m = require('../util/mappers');
const { num } = require('./items');

// ---------------------------------------------------------------------------
// Ammo & quantity linkage (DESIGN.md §3, unified rules). All callers run these
// inside a single better-sqlite3 transaction.
//
// Rule 1 (quantity effects): on items in ammunition-template collections, a
//   log's data.rounds_used decrements item.quantity (floor 0); data.rounds_added
//   increments it. Deleting reverses; editing applies the delta.
// Rule 2 (auto-usage link): when a log has data.ammo_item_id (an ammo item) and
//   numeric data.rounds_fired > 0, auto-create a 'usage' log on that ammo item
//   (same date, data:{rounds_used, source_item_id}, linked_log_id back to source);
//   the source log's linked_log_id points to the new usage log. Rule 1 then does
//   the quantity math on the ammo item.
// ---------------------------------------------------------------------------

function isAmmoCollection(db, collectionId) {
  const row = db.prepare('SELECT template_key FROM collections WHERE id = ?').get(collectionId);
  return !!row && row.template_key === 'ammunition';
}

function itemIsAmmo(db, itemId) {
  const row = db.prepare('SELECT collection_id FROM items WHERE id = ?').get(itemId);
  return !!row && isAmmoCollection(db, row.collection_id);
}

// Store the TRUE signed quantity — do NOT clamp on write. Clamping here would make
// a log-sourced decrement non-reversible (firing 300 from 100 floors to 0, but the
// nominal reversal on delete adds back 300 → phantom rounds). The floor-at-0 UX is
// applied at read/display time (see displayQuantity + buildSummary / itemCoreToApi).
function adjustQuantity(db, itemId, delta) {
  if (!delta) return;
  const row = db.prepare('SELECT quantity FROM items WHERE id = ?').get(itemId);
  if (!row) return;
  const q = num(row.quantity) + delta;
  db.prepare('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?').run(q, new Date().toISOString(), itemId);
}

// Net quantity delta a log's data implies for the item it lives on (rule 1).
// Applying = +netQtyEffect; reversing = -netQtyEffect.
function netQtyEffect(data) {
  const used = num(data && data.rounds_used);
  const added = num(data && data.rounds_added);
  return added - used; // rounds_added increments, rounds_used decrements
}

// Apply rule-1 quantity effect for a log that lives on an ammo item.
function applyQtyEffect(db, itemId, data) {
  if (!itemIsAmmo(db, itemId)) return;
  const eff = netQtyEffect(data);
  if (eff) adjustQuantity(db, itemId, eff);
}

function reverseQtyEffect(db, itemId, data) {
  if (!itemIsAmmo(db, itemId)) return;
  const eff = netQtyEffect(data);
  if (eff) adjustQuantity(db, itemId, -eff);
}

// Determine whether a source log should spawn a linked usage log (rule 2).
// `hostItemId` is the item the source log lives on. Rule 2 must NOT fire when:
//   - the host item is itself an ammunition item (rule 1 already decrements it via
//     rounds_used, so auto-linking would double-count), or
//   - ammo_item_id points back at the host item (self-reference double-hit).
function shouldLink(db, data, hostItemId) {
  if (!data) return null;
  const ammoItemId = data.ammo_item_id;
  const roundsFired = num(data.rounds_fired);
  if (ammoItemId == null || ammoItemId === '' || roundsFired <= 0) return null;
  const id = Number(ammoItemId);
  if (!Number.isInteger(id)) return null;
  if (hostItemId != null && id === Number(hostItemId)) return null; // self-reference → double-hit
  if (hostItemId != null && itemIsAmmo(db, hostItemId)) return null; // ammo host → rule 1 already handles it
  if (!itemIsAmmo(db, id)) return null; // only link to real ammo items
  return { ammoItemId: id, roundsFired };
}

// Create the linked usage log on the ammo item, wire linked_log_id both ways,
// and apply the quantity effect. Returns the new usage log id.
function createLinkedUsage(db, sourceLog, link) {
  const now = new Date().toISOString();
  const usageData = { rounds_used: link.roundsFired, source_item_id: sourceLog.item_id };
  const info = db
    .prepare(
      `INSERT INTO logs (item_id, log_type_key, date, title, notes, data_json, linked_log_id, created_at, updated_at)
       VALUES (?, 'usage', ?, ?, '', ?, ?, ?, ?)`
    )
    .run(
      link.ammoItemId,
      sourceLog.date,
      'Range usage',
      JSON.stringify(usageData),
      sourceLog.id,
      now,
      now
    );
  const usageId = info.lastInsertRowid;
  db.prepare('UPDATE logs SET linked_log_id = ? WHERE id = ?').run(usageId, sourceLog.id);
  applyQtyEffect(db, link.ammoItemId, usageData);
  return usageId;
}

// Delete a linked usage log and reverse its quantity effect (called when its
// source is deleted or unlinked).
function deleteLinkedUsage(db, usageLogId) {
  const usage = db.prepare('SELECT * FROM logs WHERE id = ?').get(usageLogId);
  if (!usage) return;
  reverseQtyEffect(db, usage.item_id, m.parseJson(usage.data_json, {}));
  db.prepare('DELETE FROM logs WHERE id = ?').run(usageLogId);
}

module.exports = {
  isAmmoCollection,
  itemIsAmmo,
  adjustQuantity,
  netQtyEffect,
  applyQtyEffect,
  reverseQtyEffect,
  shouldLink,
  createLinkedUsage,
  deleteLinkedUsage,
};
