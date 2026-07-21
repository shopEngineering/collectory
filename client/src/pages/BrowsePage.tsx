// Browse (route "/c/:collectionId") — grid/table toggle, search, status/field/tag filters,
// sort menu, batch select → status/tag/delete. All filter/sort state mirrored to the URL.
// View mode + grid density persist per-collection in localStorage. DESIGN §6.
// Table view supports spreadsheet-style inline cell editing (double-click a cell);
// grid + table rows expose a pencil affordance that opens a right slide-over edit pane
// (mirrored to `?edit=<itemId>`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Menu, LoadingBlock, ErrorBlock, ConfirmDialog } from '../components/ui';
import { StatusBadge, PhotoFill, EmptyState } from '../components/bits';
import { EditPane } from '../components/EditPane';
import {
  InlineCellEditor,
  CELL_STATUS_OPTIONS,
  CELL_STATUS_LABELS,
  type EditableCell,
  type CellEditorKind,
} from '../components/InlineCellEditor';
import { useToast } from '../components/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { useCollection, useItems, useDeleteItem } from '../api/hooks';
import { useDebouncedValue, usePersistentState } from '../lib/hooks';
import { formatMoney, formatDate, formatQuantity, STATUS_LABELS } from '../lib/format';
import { api } from '../api/client';
import type {
  CollectionFull,
  FieldDef,
  FieldValue,
  ItemQuery,
  ItemSort,
  ItemStatus,
  ItemSummary,
  SortDir,
} from '../api/types';

// ---- constants -------------------------------------------------------------
const STATUS_OPTIONS: ItemStatus[] = ['owned', 'loaned', 'wishlist', 'sold', 'traded', 'gifted'];
const DEFAULT_STATUSES = 'owned,loaned,wishlist';

const SORT_OPTIONS: { key: ItemSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'acquiredDate', label: 'Date acquired' },
  { key: 'acquiredPrice', label: 'Price acquired' },
  { key: 'currentValue', label: 'Current value' },
  { key: 'createdAt', label: 'Recently added' },
  { key: 'updatedAt', label: 'Recently updated' },
  { key: 'quantity', label: 'Quantity' },
];
const SORT_LABELS: Record<string, string> = Object.fromEntries(SORT_OPTIONS.map((s) => [s.key, s.label]));

// Field key → server sort key, for sortable table headers.
const FIELD_SORT_KEY: Record<string, ItemSort> = {
  acquired_date: 'acquiredDate',
  acquired_price: 'acquiredPrice',
};

// Dynamic field types that support inline editing. multiselect/ammo_ref fall back
// to the edit pane. textarea edits as a single-line text cell.
const INLINE_EDITABLE_TYPES: Record<string, CellEditorKind | undefined> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  currency: 'currency',
  date: 'date',
  year: 'year',
  select: 'select',
  checkbox: 'checkbox',
  url: 'url',
  rating: 'rating',
};

// ---- value formatting ------------------------------------------------------
function formatCardFieldValue(def: FieldDef, value: FieldValue): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (def.type === 'currency') return formatMoney(typeof value === 'number' ? value : Number(value));
  if (def.type === 'date') return formatDate(String(value));
  if (def.type === 'number' && def.unit) return `${value} ${def.unit}`;
  return String(value);
}

function isAmmoish(collection: CollectionFull): boolean {
  return collection.templateKey === 'ammunition';
}

// ---- Status filter chips ---------------------------------------------------
function StatusChips({
  active,
  onToggle,
}: {
  active: Set<string>;
  onToggle: (status: string) => void;
}) {
  return (
    <div className="chip-row">
      {STATUS_OPTIONS.map((s) => (
        <button
          key={s}
          className={`chip interactive ${active.has(s) ? 'active' : ''}`}
          onClick={() => onToggle(s)}
          type="button"
        >
          {STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

// ---- Sort control ----------------------------------------------------------
function SortControl({
  sort,
  dir,
  onSort,
  onToggleDir,
}: {
  sort: ItemSort;
  dir: SortDir;
  onSort: (s: ItemSort) => void;
  onToggleDir: () => void;
}) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Menu
        items={SORT_OPTIONS.map((o) => ({
          label: o.label,
          icon: sort === o.key ? 'check' : undefined,
          onClick: () => onSort(o.key),
        }))}
        trigger={({ toggle, ref }) => (
          <button className="btn" ref={ref as React.Ref<HTMLButtonElement>} onClick={toggle} type="button">
            <Icon name="sort" size={16} /> {SORT_LABELS[sort]}
          </button>
        )}
      />
      <button
        className="btn btn-icon"
        onClick={onToggleDir}
        title={dir === 'asc' ? 'Ascending' : 'Descending'}
        aria-label="Toggle sort direction"
        type="button"
      >
        <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} />
      </button>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------
export function BrowsePage() {
  const { collectionId } = useParams();
  const cid = Number(collectionId);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();

  const { data: collection, isError: collError, error: collErr } = useCollection(cid);

  // View mode + density persist per-collection (not in URL).
  const [view, setView] = usePersistentState<'grid' | 'table'>(`collectory:view:${cid}`, 'grid');
  const [density, setDensity] = usePersistentState<number>(`collectory:density:${cid}`, 1);

  // Search: local input state for responsiveness, debounced value → URL.
  const urlQ = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(urlQ);
  const debouncedSearch = useDebouncedValue(searchInput, 250);

  // Keep local input in sync when q changes externally (back button etc.).
  useEffect(() => {
    setSearchInput(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  // Push debounced search into the URL.
  useEffect(() => {
    if (debouncedSearch === urlQ) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch) next.set('q', debouncedSearch);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // ---- Derived URL state ----
  const statusParam = searchParams.get('status') ?? '';
  const activeStatuses = useMemo(
    () => new Set(statusParam ? statusParam.split(',').filter(Boolean) : DEFAULT_STATUSES.split(',')),
    [statusParam],
  );
  const sort = (searchParams.get('sort') as ItemSort) || 'updatedAt';
  const dir = (searchParams.get('dir') as SortDir) || 'desc';
  const tag = searchParams.get('tag') ?? '';

  const fieldFilters = useMemo(() => {
    const ff: Record<string, string> = {};
    searchParams.forEach((v, k) => {
      if (k.startsWith('field.') && v) ff[k.slice('field.'.length)] = v;
    });
    return ff;
  }, [searchParams]);

  const hasActiveFilters =
    !!urlQ || !!statusParam || !!tag || Object.keys(fieldFilters).length > 0;

  // ---- Edit-pane URL state (?edit=<itemId>) ----
  const editParam = searchParams.get('edit');
  const editItemId = editParam && !Number.isNaN(Number(editParam)) ? Number(editParam) : null;
  const openEdit = useCallback(
    (id: number) => patchParams((p) => p.set('edit', String(id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const closeEdit = useCallback(
    () => patchParams((p) => p.delete('edit')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- Query ----
  const query: ItemQuery = useMemo(
    () => ({
      q: urlQ || undefined,
      status: statusParam || undefined,
      tag: tag || undefined,
      sort,
      dir,
      fieldFilters: Object.keys(fieldFilters).length ? fieldFilters : undefined,
    }),
    [urlQ, statusParam, tag, sort, dir, fieldFilters],
  );

  const { data, isLoading } = useItems(Number.isNaN(cid) ? undefined : cid, query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // ---- URL mutation helpers ----
  const patchParams = (mut: (p: URLSearchParams) => void, replace = false) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mut(next);
        return next;
      },
      { replace },
    );
  };

  const toggleStatus = (status: string) => {
    // Start from the effective active set (defaults when no param present).
    const set = new Set(activeStatuses);
    if (set.has(status)) set.delete(status);
    else set.add(status);
    patchParams((p) => {
      const csv = [...set].join(',');
      // Empty selection or exactly the default set → drop param (server default).
      if (!csv || csv === DEFAULT_STATUSES) p.delete('status');
      else p.set('status', csv);
    });
  };

  const setSort = (s: ItemSort) => patchParams((p) => p.set('sort', s));
  const toggleDir = () => patchParams((p) => p.set('dir', dir === 'asc' ? 'desc' : 'asc'));
  const setFieldFilter = (key: string, value: string) =>
    patchParams((p) => {
      if (value) p.set(`field.${key}`, value);
      else p.delete(`field.${key}`);
    });
  const setTag = (value: string) =>
    patchParams((p) => {
      if (value) p.set('tag', value);
      else p.delete('tag');
    });
  const clearFilters = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      // preserve only sort/dir
      const s = prev.get('sort');
      const d = prev.get('dir');
      if (s) next.set('sort', s);
      if (d) next.set('dir', d);
      return next;
    });

  // ---- Inline cell commit (table view) ----
  // Applied to a single dynamic item id; useUpdateItem is per-id (rules of hooks),
  // so we PATCH via the api client and invalidate the shared queries once (mirrors
  // BatchBar). react-query re-fetch supplies the revert on error.
  const commitCell = useCallback(
    async (itemId: number, patch: Record<string, unknown>) => {
      try {
        await api.patch(`/items/${itemId}`, patch);
        qc.invalidateQueries({ queryKey: ['items'] });
        qc.invalidateQueries({ queryKey: ['item', itemId] });
        qc.invalidateQueries({ queryKey: ['stats'] });
        qc.invalidateQueries({ queryKey: ['collections'] });
      } catch (e) {
        toast.error((e as Error).message);
        // Revert: re-fetch the list so the cell snaps back to server truth.
        qc.invalidateQueries({ queryKey: ['items'] });
        throw e;
      }
    },
    [qc, toast],
  );

  // ---- Batch selection ----
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Select-field filters (first 3 select fields flagged showInTable).
  const selectFilterFields = useMemo(
    () =>
      (collection?.fields ?? [])
        .filter((f) => f.type === 'select' && f.showInTable)
        .slice(0, 3),
    [collection],
  );

  // Tag options seen in current results (for the tag select).
  const tagOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) for (const t of it.tags) seen.set(t.name, t.color);
    // ensure the active tag remains selectable even if not in current page
    if (tag && !seen.has(tag)) seen.set(tag, '#6b7280');
    return [...seen.keys()].sort();
  }, [items, tag]);

  // ---- Collection not found ----
  if (collError) {
    return (
      <div className="page">
        <Link to="/" className="back-link">
          <Icon name="back" size={16} /> Archive
        </Link>
        <ErrorBlock message={(collErr as Error)?.message ?? 'Collection not found.'} />
      </div>
    );
  }

  const accent = collection?.color ?? 'var(--brass)';
  const tableFields = (collection?.fields ?? []).filter((f) => f.showInTable);

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <Icon name="back" size={16} /> Archive
      </Link>

      <div className="page-head">
        <div>
          <h1 className="page-title serif">{collection?.name ?? 'Collection'}</h1>
          <p className="page-sub">
            {total} {total === 1 ? 'item' : 'items'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/c/${cid}/new`)}>
            <Icon name="plus" size={16} /> Add Item
          </button>
          <Menu
            items={[
              {
                label: 'Collection settings',
                icon: 'settings',
                onClick: () => navigate(`/c/${cid}/settings`),
              },
              {
                label: 'Export CSV',
                icon: 'download',
                onClick: () => {
                  window.location.href = api.downloadUrl('/export/csv', { collectionId: cid });
                },
              },
              {
                label: 'Insurance report',
                icon: 'print',
                onClick: () => navigate(`/report?collectionId=${cid}`),
              },
            ]}
            trigger={({ toggle, ref }) => (
              <button
                className="btn btn-icon"
                ref={ref as React.Ref<HTMLButtonElement>}
                onClick={toggle}
                aria-label="More actions"
                type="button"
              >
                <Icon name="kebab" size={18} />
              </button>
            )}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          className="input grow"
          type="search"
          placeholder="Search this collection…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search"
        />

        <SortControl sort={sort} dir={dir} onSort={setSort} onToggleDir={toggleDir} />

        {selectFilterFields.map((f) => (
          <select
            key={f.key}
            className="select"
            value={fieldFilters[f.key] ?? ''}
            onChange={(e) => setFieldFilter(f.key, e.target.value)}
            aria-label={f.label}
          >
            <option value="">{f.label}: All</option>
            {(f.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ))}

        {tagOptions.length > 0 && (
          <select
            className="select"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <div className="segmented" role="group" aria-label="View mode">
          <button
            className={view === 'grid' ? 'active' : ''}
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            type="button"
          >
            <Icon name="grid" size={16} />
          </button>
          <button
            className={view === 'table' ? 'active' : ''}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            aria-label="Table view"
            type="button"
          >
            <Icon name="table-view" size={16} />
          </button>
        </div>

        {view === 'grid' && (
          <label className="density-slider" title="Card density">
            <Icon name="grid" size={14} />
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
              aria-label="Card density"
            />
          </label>
        )}

        <button
          className={`btn ${selectMode ? 'btn-primary' : ''}`}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          type="button"
        >
          <Icon name="check" size={16} /> Select
        </button>
      </div>

      {/* Status filter chips */}
      <div style={{ margin: 'var(--sp-3) 0 var(--sp-4)' }}>
        <StatusChips active={activeStatuses} onToggle={toggleStatus} />
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <LoadingBlock label="Loading items…" />
      ) : items.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            title="No matches"
            message="No items match the current filters. Try clearing them to see everything in this collection."
            action={
              <button className="btn" onClick={clearFilters}>
                <Icon name="close" size={16} /> Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No items yet"
            message="This collection is empty. Add your first item to start building the archive."
            action={
              <button className="btn btn-primary" onClick={() => navigate(`/c/${cid}/new`)}>
                <Icon name="plus" size={16} /> Add Item
              </button>
            }
          />
        )
      ) : view === 'grid' ? (
        <GridView
          items={items}
          collection={collection}
          accent={accent}
          density={density}
          selectMode={selectMode}
          selected={selected}
          onToggleSelected={toggleSelected}
          onOpen={(id) => navigate(`/items/${id}`)}
          onEdit={openEdit}
          onEnterSelect={(id) => {
            setSelectMode(true);
            setSelected(new Set([id]));
          }}
          longPressTimer={longPressTimer}
        />
      ) : (
        <TableView
          items={items}
          tableFields={tableFields}
          selectMode={selectMode}
          selected={selected}
          onToggleSelected={toggleSelected}
          onOpen={(id) => navigate(`/items/${id}`)}
          onEdit={openEdit}
          onCommitCell={commitCell}
          sort={sort}
          dir={dir}
          onSort={setSort}
          onToggleDir={toggleDir}
        />
      )}

      {/* Batch bar */}
      {selected.size > 0 && (
        <BatchBar
          selectedIds={[...selected]}
          items={items}
          onDone={exitSelect}
          toastError={toast.error}
          toastSuccess={toast.success}
        />
      )}

      {/* Slide-over edit pane (edit-only, existing items) */}
      {editItemId != null && (
        <EditPane
          key={editItemId}
          itemId={editItemId}
          onClose={closeEdit}
          onSaved={() => toast.success('Saved')}
        />
      )}
    </div>
  );
}

// ---- Grid view -------------------------------------------------------------
function GridView({
  items,
  collection,
  accent,
  density,
  selectMode,
  selected,
  onToggleSelected,
  onOpen,
  onEdit,
  onEnterSelect,
  longPressTimer,
}: {
  items: ItemSummary[];
  collection: CollectionFull | undefined;
  accent: string;
  density: number;
  selectMode: boolean;
  selected: Set<number>;
  onToggleSelected: (id: number) => void;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onEnterSelect: (id: number) => void;
  longPressTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const fieldMap = useMemo(() => {
    const m = new Map<string, FieldDef>();
    for (const f of collection?.fields ?? []) m.set(f.key, f);
    return m;
  }, [collection]);
  const ammoish = collection ? isAmmoish(collection) : false;

  return (
    <div
      className={`grid-cards ${selectMode ? 'select-mode' : ''}`}
      data-density={density}
    >
      {items.map((item, i) => {
        const isSel = selected.has(item.id);
        const cardFieldEntries = Object.entries(item.cardFields)
          .map(([key, value]) => {
            const def = fieldMap.get(key);
            if (!def) return null;
            const text = formatCardFieldValue(def, value);
            if (!text) return null;
            return { key, label: def.label, text };
          })
          .filter((x): x is { key: string; label: string; text: string } => x !== null)
          .slice(0, 4);

        return (
          <div
            key={item.id}
            className={`item-card stagger ${isSel ? 'selected' : ''}`}
            style={
              { '--card-accent': accent, animationDelay: `${Math.min(i, 12) * 30}ms` } as React.CSSProperties
            }
            onClick={() => {
              if (selectMode) onToggleSelected(item.id);
              else onOpen(item.id);
            }}
            onPointerDown={() => {
              if (selectMode) return;
              longPressTimer.current = setTimeout(() => onEnterSelect(item.id), 500);
            }}
            onPointerUp={() => {
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
            }}
            onPointerLeave={() => {
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
            }}
          >
            <label
              className="card-select"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelected(item.id);
              }}
            >
              <span className={`checkbox-box ${isSel ? 'checked' : ''}`}>
                {isSel && <Icon name="check" size={13} />}
              </span>
            </label>

            {/* Edit affordance — hover (desktop) + always-visible kebab-style on touch */}
            {!selectMode && (
              <button
                type="button"
                className="card-edit"
                aria-label={`Edit ${item.name}`}
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(item.id);
                }}
              >
                <Icon name="edit" size={15} />
              </button>
            )}

            <div className="card-photo">
              <PhotoFill src={item.thumbUrl} alt={item.name} />
            </div>
            <div className="card-body">
              <div className="card-name">{item.name}</div>
              {cardFieldEntries.length > 0 && (
                <div className="card-fields">
                  {cardFieldEntries.map((f) => (
                    <span key={f.key}>
                      {f.label}: {f.text}
                    </span>
                  ))}
                </div>
              )}
              <div className="card-foot">
                {item.currentValueCents != null && (
                  <span className="card-value">{formatMoney(item.currentValueCents)}</span>
                )}
                {(item.quantity > 1 || ammoish) && (
                  <span className="card-qty">
                    {ammoish ? `${formatQuantity(item.quantity)} rds` : `× ${formatQuantity(item.quantity)}`}
                  </span>
                )}
              </div>
              {item.tags.length > 0 && (
                <div className="card-tags">
                  {item.tags.map((t) => (
                    <span key={t.id} className="chip">
                      <span className="chip-dot" style={{ background: t.color }} />
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Table view ------------------------------------------------------------
// Column identity for an open inline editor: which item row + which cell.
interface OpenCell {
  itemId: number;
  cellId: string;
}

function TableView({
  items,
  tableFields,
  selectMode,
  selected,
  onToggleSelected,
  onOpen,
  onEdit,
  onCommitCell,
  sort,
  dir,
  onSort,
  onToggleDir,
}: {
  items: ItemSummary[];
  tableFields: FieldDef[];
  selectMode: boolean;
  selected: Set<number>;
  onToggleSelected: (id: number) => void;
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onCommitCell: (itemId: number, patch: Record<string, unknown>) => Promise<void>;
  sort: ItemSort;
  dir: SortDir;
  onSort: (s: ItemSort) => void;
  onToggleDir: () => void;
}) {
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);
  // Single-click navigates, double-click edits. A short timer defers the row's
  // click nav so an incoming dblclick can cancel it and open the editor instead.
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingNav = useCallback(() => {
    if (navTimer.current) {
      clearTimeout(navTimer.current);
      navTimer.current = null;
    }
  }, []);
  // Clean up any pending nav timer on unmount.
  useEffect(() => cancelPendingNav, [cancelPendingNav]);

  const sortHandler = (key: ItemSort) => () => {
    if (sort === key) onToggleDir();
    else onSort(key);
  };
  const sortIndicator = (key: ItemSort) =>
    sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '';

  const fmtCell = (def: FieldDef, value: FieldValue): string => {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (def.type === 'currency') return formatMoney(typeof value === 'number' ? value : Number(value));
    if (def.type === 'date') return formatDate(String(value));
    if (def.type === 'number' && def.unit) return `${value} ${def.unit}`;
    return String(value);
  };

  // Ordered editable cell ids per row, for Tab traversal.
  const editableFieldDefs = useMemo(
    () => tableFields.filter((f) => INLINE_EDITABLE_TYPES[f.type]),
    [tableFields],
  );
  const rowCellOrder = useMemo(() => {
    // name, [dynamic editable fields in column order], status, value, quantity
    const order = ['name', ...editableFieldDefs.map((f) => `field:${f.key}`), 'status', 'currentValueCents', 'quantity'];
    return order;
  }, [editableFieldDefs]);

  // Build the EditableCell descriptor for a given row + cellId.
  const buildCell = useCallback(
    (item: ItemSummary, cellId: string): EditableCell | null => {
      if (cellId === 'name')
        return { cellId, kind: 'text', value: item.name, toPatch: (v) => ({ name: v ?? '' }) };
      if (cellId === 'status')
        return {
          cellId,
          kind: 'select',
          value: item.status,
          options: CELL_STATUS_OPTIONS,
          optionLabels: CELL_STATUS_LABELS,
          toPatch: (v) => ({ status: v || 'owned' }),
        };
      if (cellId === 'quantity')
        return {
          cellId,
          kind: 'number',
          value: item.quantity,
          toPatch: (v) => ({ quantity: v == null ? 1 : v }),
        };
      if (cellId === 'currentValueCents')
        return {
          cellId,
          kind: 'currency',
          value: item.currentValueCents,
          toPatch: (v) => ({ currentValueCents: v }),
        };
      if (cellId === 'acquiredDate')
        return {
          cellId,
          kind: 'date',
          value: item.acquiredDate,
          toPatch: (v) => ({ acquiredDate: v }),
        };
      if (cellId === 'acquiredPriceCents')
        return {
          cellId,
          kind: 'currency',
          value: item.acquiredPriceCents,
          toPatch: (v) => ({ acquiredPriceCents: v }),
        };
      if (cellId.startsWith('field:')) {
        const key = cellId.slice('field:'.length);
        const def = tableFields.find((f) => f.key === key);
        if (!def) return null;
        const kind = INLINE_EDITABLE_TYPES[def.type];
        if (!kind) return null;
        return {
          cellId,
          kind,
          value: item.cardFields[key] ?? null,
          options: def.type === 'select' ? def.options : undefined,
          toPatch: (v) => ({ fields: { [key]: v } }),
        };
      }
      return null;
    },
    [tableFields],
  );

  const closeEditor = useCallback(() => setOpenCell(null), []);

  const commitOpen = useCallback(
    async (itemId: number, patch: Record<string, unknown>) => {
      await onCommitCell(itemId, patch);
      setOpenCell(null);
    },
    [onCommitCell],
  );

  // Tab traversal: commit (fire-and-forget) then open the next editable cell.
  const advance = useCallback(
    (item: ItemSummary, fromCellId: string, patch: Record<string, unknown> | null, dirStep: 1 | -1) => {
      if (patch) void onCommitCell(item.id, patch);
      const idx = rowCellOrder.indexOf(fromCellId);
      let nextIdx = idx;
      // Find the next cell id that yields a valid editable cell for this row.
      for (let step = 0; step < rowCellOrder.length; step++) {
        nextIdx += dirStep;
        if (nextIdx < 0 || nextIdx >= rowCellOrder.length) {
          setOpenCell(null);
          return;
        }
        const candidate = rowCellOrder[nextIdx];
        if (buildCell(item, candidate)) {
          setOpenCell({ itemId: item.id, cellId: candidate });
          return;
        }
      }
      setOpenCell(null);
    },
    [rowCellOrder, buildCell, onCommitCell],
  );

  // Render an editable <td> that becomes an editor on double-click. This is a
  // plain render helper (not a component) so React keeps stable <td> identity and
  // the open editor doesn't remount on parent re-renders.
  const renderEditableTd = (
    item: ItemSummary,
    cellId: string,
    children: React.ReactNode,
    className?: string,
  ) => {
    const isOpen = openCell?.itemId === item.id && openCell.cellId === cellId;
    const cell = isOpen ? buildCell(item, cellId) : null;
    return (
      <td
        key={cellId}
        className={`editable-cell ${className ?? ''} ${isOpen ? 'editing' : ''}`}
        onDoubleClick={(e) => {
          if (selectMode) return;
          e.stopPropagation();
          cancelPendingNav(); // beat the deferred single-click nav
          if (buildCell(item, cellId)) setOpenCell({ itemId: item.id, cellId });
        }}
        // While editing, swallow row-nav clicks for this cell.
        onClick={isOpen ? (e) => e.stopPropagation() : undefined}
      >
        {isOpen && cell ? (
          <InlineCellEditor
            cell={cell}
            onCommit={(patch) => commitOpen(item.id, patch)}
            onCancel={closeEditor}
            onCommitAndAdvance={(patch, step) => advance(item, cellId, patch, step)}
          />
        ) : (
          children
        )}
      </td>
    );
  };

  return (
    <div className="table-wrap">
      <table className="data editable">
        <thead>
          <tr>
            {selectMode && <th style={{ width: 36 }} aria-label="Select" />}
            <th className="sortable" onClick={sortHandler('name')}>
              Name{sortIndicator('name')}
            </th>
            {tableFields.map((f) => {
              const skey: ItemSort = FIELD_SORT_KEY[f.key] ?? `field:${f.key}`;
              return (
                <th key={f.key} className="sortable" onClick={sortHandler(skey)}>
                  {f.label}
                  {sortIndicator(skey)}
                </th>
              );
            })}
            <th className="sortable" onClick={sortHandler('status')}>
              Status{sortIndicator('status')}
            </th>
            <th className="sortable num" onClick={sortHandler('currentValue')}>
              Value{sortIndicator('currentValue')}
            </th>
            <th className="sortable num" onClick={sortHandler('quantity')}>
              Qty{sortIndicator('quantity')}
            </th>
            <th className="col-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSel = selected.has(item.id);
            const rowEditing = openCell?.itemId === item.id;
            return (
              <tr
                key={item.id}
                onClick={() => {
                  // Suppress row nav while any cell in this row is being edited.
                  if (rowEditing) return;
                  if (selectMode) {
                    onToggleSelected(item.id);
                    return;
                  }
                  // Defer nav so a double-click (to edit) can cancel it first.
                  cancelPendingNav();
                  navTimer.current = setTimeout(() => {
                    navTimer.current = null;
                    onOpen(item.id);
                  }, 220);
                }}
                style={{ cursor: 'pointer' }}
                className={isSel ? 'selected' : ''}
              >
                {selectMode && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <label
                      style={{ display: 'inline-flex' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelected(item.id);
                      }}
                    >
                      <span className={`checkbox-box ${isSel ? 'checked' : ''}`}>
                        {isSel && <Icon name="check" size={13} />}
                      </span>
                    </label>
                  </td>
                )}
                {renderEditableTd(item, 'name', item.name, 'cell-name')}
                {tableFields.map((f) => {
                  const cellId = `field:${f.key}`;
                  const kind = INLINE_EDITABLE_TYPES[f.type];
                  if (!kind) {
                    // Not inline-editable (multiselect / ammo_ref) — display only.
                    return <td key={f.key}>{fmtCell(f, item.cardFields[f.key])}</td>;
                  }
                  return renderEditableTd(item, cellId, fmtCell(f, item.cardFields[f.key]));
                })}
                {renderEditableTd(item, 'status', <StatusBadge status={item.status} />)}
                {renderEditableTd(
                  item,
                  'currentValueCents',
                  formatMoney(item.currentValueCents),
                  'cell-money num',
                )}
                {renderEditableTd(item, 'quantity', formatQuantity(item.quantity), 'num')}
                <td className="col-actions">
                  {/* Clicks outside the pencil fall through to the row (nav). */}
                  <span className="row-actions">
                    <button
                      type="button"
                      className="btn-icon btn-ghost row-edit"
                      aria-label={`Edit ${item.name}`}
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(item.id);
                      }}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <span className="row-go" aria-hidden="true">
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Batch bar -------------------------------------------------------------
function BatchBar({
  selectedIds,
  items,
  onDone,
  toastError,
  toastSuccess,
}: {
  selectedIds: number[];
  items: ItemSummary[];
  onDone: () => void;
  toastError: (m: string) => void;
  toastSuccess: (m: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const deleteItem = useDeleteItem();

  // Status/tag are per-id PATCHes. useUpdateItem(id) is a per-id hook and can't be
  // called inside a loop (rules of hooks), so we PATCH via the api client directly and
  // invalidate the shared queries once afterwards (per DESIGN §4 / prompt guidance).
  const invalidateAfterBatch = () => {
    qc.invalidateQueries({ queryKey: ['items'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['collections'] });
  };

  const summaryById = useMemo(() => {
    const m = new Map<number, ItemSummary>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const runStatus = async (status: ItemStatus) => {
    if (busy) return;
    setBusy(true);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        await api.patch(`/items/${id}`, { status });
        ok++;
      } catch (e) {
        toastError((e as Error).message);
      }
    }
    setBusy(false);
    invalidateAfterBatch();
    if (ok) toastSuccess(`Set status on ${ok} ${ok === 1 ? 'item' : 'items'}`);
    onDone();
  };

  const runAddTag = async () => {
    if (busy) return;
    const raw = window.prompt('Add tag to selected items:');
    const newTag = raw?.trim();
    if (!newTag) return;
    setBusy(true);
    let ok = 0;
    for (const id of selectedIds) {
      const summary = summaryById.get(id);
      const existing = summary ? summary.tags.map((t) => t.name) : [];
      const tags = existing.includes(newTag) ? existing : [...existing, newTag];
      try {
        await api.patch(`/items/${id}`, { tags });
        ok++;
      } catch (e) {
        toastError((e as Error).message);
      }
    }
    setBusy(false);
    invalidateAfterBatch();
    if (ok) toastSuccess(`Tagged ${ok} ${ok === 1 ? 'item' : 'items'}`);
    onDone();
  };

  const runDelete = async () => {
    setConfirmDelete(false);
    if (busy) return;
    setBusy(true);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        await deleteItem.mutateAsync({ id });
        ok++;
      } catch (e) {
        toastError((e as Error).message);
      }
    }
    setBusy(false);
    if (ok) toastSuccess(`Deleted ${ok} ${ok === 1 ? 'item' : 'items'}`);
    onDone();
  };

  return (
    <>
      <div className="batch-bar">
        <span className="batch-count">{selectedIds.length} selected</span>
        <Menu
          items={STATUS_OPTIONS.map((s) => ({
            label: STATUS_LABELS[s],
            onClick: () => void runStatus(s),
          }))}
          trigger={({ toggle, ref }) => (
            <button
              className="btn btn-sm"
              ref={ref as React.Ref<HTMLButtonElement>}
              onClick={toggle}
              disabled={busy}
              type="button"
            >
              Set status
            </button>
          )}
        />
        <button className="btn btn-sm" onClick={() => void runAddTag()} disabled={busy} type="button">
          <Icon name="tag" size={15} /> Add tag
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          type="button"
        >
          <Icon name="trash" size={15} /> Delete
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDone} disabled={busy} type="button">
          Clear
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Delete items"
        message={`Move ${selectedIds.length} ${selectedIds.length === 1 ? 'item' : 'items'} to Trash? You can restore them later.`}
        confirmLabel="Delete"
        onConfirm={() => void runDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
