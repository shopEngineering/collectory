// ⌘K command palette: search items/collections + quick actions, arrow-key nav.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Portal } from './ui';
import { Icon } from './Icon';
import { Kbd } from './ui';
import { useCollections, useSearch } from '../api/hooks';
import { useDebouncedValue } from '../lib/hooks';

interface Row {
  id: string;
  label: string;
  sub?: string;
  icon: string;
  color?: string;
  action: () => void;
  group: string;
}

export function CommandPalette({
  open,
  onClose,
  onNewCollection,
}: {
  open: boolean;
  onClose: () => void;
  onNewCollection: () => void;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 200);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: collections } = useCollections();
  const { data: search } = useSearch(debounced);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const actions: Row[] = [
      {
        id: 'a-new-item',
        label: 'New Item',
        icon: 'plus',
        group: 'Actions',
        action: () => {
          const first = collections?.[0];
          if (first) navigate(`/c/${first.id}/new`);
        },
      },
      { id: 'a-new-coll', label: 'New Collection', icon: 'layers', group: 'Actions', action: onNewCollection },
      { id: 'a-backup', label: 'Backup Now', icon: 'download', group: 'Actions', action: () => navigate('/settings') },
      { id: 'a-import', label: 'Import CSV', icon: 'upload', group: 'Actions', action: () => navigate('/import') },
      { id: 'a-report', label: 'Insurance Report', icon: 'print', group: 'Actions', action: () => navigate('/report') },
      { id: 'a-settings', label: 'Settings', icon: 'settings', group: 'Actions', action: () => navigate('/settings') },
    ];

    const colRows: Row[] = (collections ?? []).map((c) => ({
      id: `c-${c.id}`,
      label: c.name,
      sub: `${c.itemCount ?? 0} items`,
      icon: c.icon,
      color: c.color,
      group: 'Collections',
      action: () => navigate(`/c/${c.id}`),
    }));

    const itemRows: Row[] = (search?.results ?? []).map((r) => ({
      id: `i-${r.item.id}`,
      label: r.item.name,
      sub: r.collectionName,
      icon: 'box',
      group: 'Items',
      action: () => navigate(`/items/${r.item.id}`),
    }));

    const query = debounced.trim().toLowerCase();
    if (!query) return [...actions, ...colRows];

    const filteredActions = actions.filter((a) => a.label.toLowerCase().includes(query));
    const filteredCols = colRows.filter((c) => c.label.toLowerCase().includes(query));
    return [...filteredActions, ...filteredCols, ...itemRows];
  }, [collections, search, debounced, navigate, onNewCollection]);

  useEffect(() => {
    setActive(0);
  }, [debounced]);

  if (!open) return null;

  const run = (row: Row) => {
    row.action();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) run(row);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Group rows preserving order.
  const groups: { name: string; rows: Row[] }[] = [];
  for (const row of rows) {
    let g = groups.find((x) => x.name === row.group);
    if (!g) {
      g = { name: row.group, rows: [] };
      groups.push(g);
    }
    g.rows.push(row);
  }

  let flatIndex = -1;

  return (
    <Portal>
      <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ paddingTop: '12vh' }}>
        <div className="cmdk" onKeyDown={onKeyDown}>
          <div className="cmdk-input-row">
            <Icon name="search" size={18} style={{ color: 'var(--ink-3)' }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search items, collections, actions…"
              aria-label="Command palette search"
            />
            <Kbd>esc</Kbd>
          </div>
          <div className="cmdk-list">
            {rows.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                No results
              </div>
            )}
            {groups.map((g) => (
              <div key={g.name}>
                <div className="cmdk-group-label eyebrow">{g.name}</div>
                {g.rows.map((row) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <div
                      key={row.id}
                      className={`cmdk-item ${idx === active ? 'active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(row)}
                    >
                      <span className="cmdk-icon" style={row.color ? { color: row.color } : undefined}>
                        <Icon name={row.icon} size={16} />
                      </span>
                      <span>{row.label}</span>
                      {row.sub && <span className="cmdk-sub">{row.sub}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="cmdk-foot">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span>
              <Kbd>↵</Kbd> select
            </span>
            <span>
              <Kbd>esc</Kbd> close
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
