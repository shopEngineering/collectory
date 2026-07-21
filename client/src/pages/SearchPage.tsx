// Global search (route "/search?q="). DESIGN §6.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LoadingBlock, Kbd } from '../components/ui';
import { EmptyState } from '../components/bits';
import { useSearch } from '../api/hooks';
import { useDebouncedValue } from '../lib/hooks';
import { formatMoney } from '../lib/format';
import type { SearchResult } from '../api/types';

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const debouncedInput = useDebouncedValue(input, 250);

  // Keep local input in sync if the URL changes from elsewhere (e.g. command palette).
  useEffect(() => {
    setInput(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (debouncedInput === q) return;
    const next = new URLSearchParams(params);
    if (debouncedInput.trim()) next.set('q', debouncedInput);
    else next.delete('q');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput]);

  // Single debounce: drive the query directly off the debounced input (the URL
  // is a write-only mirror for shareability). Avoids the old ~500ms double-debounce.
  const { data, isLoading } = useSearch(debouncedInput);

  const groups = useMemo(() => {
    const byCollection = new Map<string, SearchResult[]>();
    for (const r of data?.results ?? []) {
      const list = byCollection.get(r.collectionName) ?? [];
      list.push(r);
      byCollection.set(r.collectionName, list);
    }
    return Array.from(byCollection.entries());
  }, [data]);

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title serif">Search</h1>
        <p className="page-sub">
          Search across every collection. <Kbd>⌘K</Kbd> opens the command palette from anywhere.
        </p>
      </div>

      <div className="input-affix prefix" style={{ marginBottom: 24 }}>
        <span className="input-prefix">
          <Icon name="search" size={16} />
        </span>
        <input
          className="input"
          style={{ fontSize: 16, height: 48 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search items across all collections…"
          autoFocus
        />
      </div>

      {isLoading ? (
        <LoadingBlock label="Searching…" />
      ) : !debouncedInput.trim() ? (
        <EmptyState
          illustration={<Icon name="search" size={40} />}
          title="Type to search"
          message="Search by name, notes, serial number, or any field value — across every collection."
        />
      ) : groups.length === 0 ? (
        <EmptyState title="No matches" message={`No matches for "${debouncedInput}".`} />
      ) : (
        groups.map(([collectionName, results]) => (
          <div key={collectionName} className="dash-section">
            <div className="dash-section-head">
              <span className="eyebrow">
                {collectionName} · {results.length}
              </span>
            </div>
            <div className="card" style={{ padding: 0 }}>
              {results.map((r) => (
                <Link
                  key={r.item.id}
                  to={`/items/${r.item.id}`}
                  className="feed-item"
                  style={{ padding: '12px 16px', textDecoration: 'none' }}
                >
                  <span className="feed-icon" style={{ background: 'var(--surface-2)' }}>
                    {r.item.thumbUrl ? (
                      <img
                        src={r.item.thumbUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-sm)' }}
                      />
                    ) : (
                      <Icon name="photo" size={16} />
                    )}
                  </span>
                  <div className="feed-body">
                    <div className="feed-title serif" style={{ fontSize: 14, whiteSpace: 'normal' }}>
                      {r.item.name}
                    </div>
                    {r.snippet && (
                      <div className="feed-meta" style={{ whiteSpace: 'normal' }}>
                        {r.snippet}
                      </div>
                    )}
                  </div>
                  <div className="tnum serif" style={{ color: 'var(--brass)', flex: 'none', alignSelf: 'center' }}>
                    {formatMoney(r.item.currentValueCents)}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
