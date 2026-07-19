// Printable insurance report (route "/report?collectionId=&masked="). DESIGN §5.1 + §6.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { LoadingBlock } from '../components/ui';
import { EmptyState } from '../components/bits';
import { api } from '../api/client';
import { useCollections, useSettings } from '../api/hooks';
import { formatDate, formatMoney, todayISO } from '../lib/format';
import type { Collection, FieldValue, ItemListResponse, ItemSummary } from '../api/types';

// Mask all but the last 2 characters of a serial-like value: "1234ABCD" -> "●●●●●●CD".
function maskSerial(value: string): string {
  if (value.length <= 2) return '●'.repeat(value.length);
  return '●'.repeat(value.length - 2) + value.slice(-2);
}

// Render a cardFields record as identity text, masking any key that looks like a serial number.
function identityText(cardFields: Record<string, FieldValue>, masked: boolean): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(cardFields)) {
    if (value == null || value === '') continue;
    const raw = Array.isArray(value) ? value.join(', ') : String(value);
    const isSerial = /serial/i.test(key);
    const text = masked && isSerial ? maskSerial(raw) : raw;
    parts.push(text);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function conditionText(cardFields: Record<string, FieldValue>): string {
  const val = cardFields['condition'];
  if (val == null || val === '') return '—';
  return Array.isArray(val) ? val.join(', ') : String(val);
}

function itemValueCents(item: ItemSummary): number {
  return item.currentValueCents ?? item.acquiredPriceCents ?? 0;
}

function ReportGroup({
  collection,
  items,
  masked,
}: {
  collection: Collection;
  items: ItemSummary[];
  masked: boolean;
}) {
  const subtotal = items.reduce((sum, item) => sum + itemValueCents(item), 0);

  return (
    <section className="report-group">
      <h2>
        <span>{collection.name}</span>
        <span className="report-subtotal">{formatMoney(subtotal)}</span>
      </h2>
      <table className="report-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Item</th>
            <th>Identity</th>
            <th>Condition</th>
            <th>Acquired</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="r-photo">
                {item.thumbUrl ? (
                  <img src={item.thumbUrl} alt="" />
                ) : (
                  <div style={{ width: 48, height: 48 }} />
                )}
              </td>
              <td className="r-name">{item.name}</td>
              <td>{identityText(item.cardFields, masked)}</td>
              <td>{conditionText(item.cardFields)}</td>
              <td>
                {formatDate(item.acquiredDate)}
                {item.acquiredPriceCents != null ? ` · ${formatMoney(item.acquiredPriceCents)}` : ''}
              </td>
              <td className="r-num">{formatMoney(item.currentValueCents ?? item.acquiredPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ReportPage() {
  const [params, setParams] = useSearchParams();
  const collectionIdParam = params.get('collectionId');
  const masked = params.get('masked') === '1';

  const { data: collections, isLoading: collectionsLoading } = useCollections();
  const { data: settings } = useSettings();

  const selectedCollections = useMemo(() => {
    if (!collections) return [];
    if (!collectionIdParam) return collections;
    const id = Number(collectionIdParam);
    return collections.filter((c) => c.id === id);
  }, [collections, collectionIdParam]);

  const itemQueries = useQueries({
    queries: selectedCollections.map((c) => ({
      queryKey: ['report-items', c.id],
      queryFn: () =>
        api.get<ItemListResponse>(`/collections/${c.id}/items`, {
          status: 'owned,loaned',
          limit: 1000,
        }),
      enabled: true,
    })),
  });

  const itemsLoading = itemQueries.some((q) => q.isLoading);

  const groups = selectedCollections.map((collection, i) => ({
    collection,
    items: itemQueries[i]?.data?.items ?? [],
  }));
  const nonEmptyGroups = groups.filter((g) => g.items.length > 0);

  const grandCount = nonEmptyGroups.reduce((sum, g) => sum + g.items.length, 0);
  const grandTotal = nonEmptyGroups.reduce(
    (sum, g) => sum + g.items.reduce((s, item) => s + itemValueCents(item), 0),
    0,
  );

  function setCollectionFilter(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set('collectionId', value);
    else next.delete('collectionId');
    setParams(next, { replace: true });
  }

  function setMasked(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set('masked', '1');
    else next.delete('masked');
    setParams(next, { replace: true });
  }

  const loading = collectionsLoading || itemsLoading;

  return (
    <div className="page">
      <div className="toolbar no-print" style={{ marginBottom: 'var(--sp-5)' }}>
        <Link to="/" className="back-link">
          <Icon name="back" size={16} /> Back
        </Link>
        <span className="spacer grow" />
        <select
          className="select"
          value={collectionIdParam ?? ''}
          onChange={(e) => setCollectionFilter(e.target.value)}
          aria-label="Filter by collection"
        >
          <option value="">All collections</option>
          {collections?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Serial masking">
          <button type="button" className={!masked ? 'active' : ''} onClick={() => setMasked(false)}>
            Show serials
          </button>
          <button type="button" className={masked ? 'active' : ''} onClick={() => setMasked(true)}>
            Mask serials
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" size={16} /> Print / Save as PDF
        </button>
      </div>

      {loading ? (
        <LoadingBlock label="Building report…" />
      ) : nonEmptyGroups.length === 0 ? (
        <EmptyState
          title="Nothing to report"
          message="No owned or loaned items found for this selection. Add items or choose a different collection."
        />
      ) : (
        <div className="report">
          <div className="report-cover">
            <h1 className="serif">
              {collectionIdParam ? 'Collection Inventory' : 'Insurance Report'}
            </h1>
            <div className="report-meta">
              <span>
                Owner: <b>{settings?.reportOwner || '—'}</b>
              </span>
              <span>
                Generated: <b>{formatDate(todayISO(), { long: true })}</b>
              </span>
              <span>
                Items: <b>{grandCount}</b>
              </span>
              <span>
                Total value: <b>{formatMoney(grandTotal)}</b>
              </span>
            </div>
          </div>

          {nonEmptyGroups.map((g) => (
            <ReportGroup key={g.collection.id} collection={g.collection} items={g.items} masked={masked} />
          ))}

          <div className="report-total">
            <span>Grand Total</span>
            <span>{formatMoney(grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
