'use strict';
const itemSvc = require('./items');

// Value expression: current_value_cents else acquired_price_cents else 0.
// Excludes former statuses (sold/traded/gifted) and wishlist.
const VALUE_EXPR = `CASE WHEN status IN ('sold','traded','gifted','wishlist') THEN 0
                        ELSE COALESCE(current_value_cents, acquired_price_cents, 0) END`;

function dashboard(db) {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(${VALUE_EXPR}), 0) AS valueCents
       FROM items WHERE deleted_at IS NULL`
    )
    .get();
  const collectionsCount = db.prepare('SELECT COUNT(*) AS c FROM collections').get().c;

  const byCollection = db
    .prepare(
      `SELECT c.id, c.name, c.icon, c.color,
              COUNT(i.id) AS count,
              COALESCE(SUM(CASE WHEN i.id IS NULL THEN 0 ELSE ${VALUE_EXPR} END), 0) AS valueCents
       FROM collections c
       LEFT JOIN items i ON i.collection_id = c.id AND i.deleted_at IS NULL
       GROUP BY c.id ORDER BY c.sort_order, c.id`
    )
    .all()
    .map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, count: r.count, valueCents: r.valueCents }));

  const recentItems = db
    .prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 8')
    .all()
    .map((row) => itemSvc.buildSummary(db, row));

  const recentLogs = db
    .prepare(
      `SELECT l.id, l.item_id AS itemId, i.name AS itemName, i.collection_id AS collectionId,
              l.log_type_key AS logTypeKey, l.date, l.title
       FROM logs l JOIN items i ON i.id = l.item_id
       WHERE i.deleted_at IS NULL
       ORDER BY l.date DESC, l.id DESC LIMIT 10`
    )
    .all()
    .map((r) => {
      const lt = db.prepare('SELECT label FROM log_types WHERE collection_id = ? AND key = ?').get(r.collectionId, r.logTypeKey);
      return { ...r, logTypeLabel: lt ? lt.label : r.logTypeKey };
    });

  // Acquisition timeline: cumulative value + count by acquisition month.
  const monthly = db
    .prepare(
      `SELECT substr(acquired_date, 1, 7) AS month,
              COALESCE(SUM(${VALUE_EXPR}), 0) AS valueCents,
              COUNT(*) AS count
       FROM items
       WHERE deleted_at IS NULL AND acquired_date IS NOT NULL AND length(acquired_date) >= 7
       GROUP BY month ORDER BY month`
    )
    .all();
  let cumV = 0;
  let cumC = 0;
  const acquisitionTimeline = monthly.map((r) => {
    cumV += r.valueCents;
    cumC += r.count;
    return { month: r.month, valueCents: cumV, count: cumC };
  });

  // Low-stock alerts
  const alerts = db
    .prepare(
      `SELECT id AS itemId, name, quantity, min_quantity AS minQuantity
       FROM items
       WHERE deleted_at IS NULL AND min_quantity IS NOT NULL AND quantity <= min_quantity
       ORDER BY (quantity - min_quantity) ASC`
    )
    .all()
    .map((r) => ({ type: 'low_stock', itemId: r.itemId, name: r.name, quantity: itemSvc.displayQuantity(r.quantity), minQuantity: r.minQuantity }));

  return {
    totals: { items: totals.items, valueCents: totals.valueCents, collections: collectionsCount },
    byCollection,
    recentItems,
    recentLogs,
    acquisitionTimeline,
    alerts,
  };
}

module.exports = { dashboard, VALUE_EXPR };
