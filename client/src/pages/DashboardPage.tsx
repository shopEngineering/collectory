// Dashboard (route "/") — stat cards, per-collection tiles, acquisition timeline chart,
// recent items strip, recent activity feed, low-stock alerts. DESIGN §6.
import { useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LoadingBlock, ErrorBlock, SectionLabel } from '../components/ui';
import { EmptyState } from '../components/bits';
import { useStats, useCollections } from '../api/hooks';
import { formatNumber, formatMoney, formatMoneyCompact, formatDate } from '../lib/format';
import type { StatsResponse } from '../api/types';

// Map known log-type keys → icon names (fallback: note).
const LOG_ICONS: Record<string, string> = {
  range_session: 'target',
  cleaning: 'brush',
  modification: 'wrench',
  appraisal: 'badge',
  usage: 'arrow-down',
  restock: 'arrow-up',
  grading_submission: 'badge',
  storage_change: 'archive',
  note: 'note',
};
function logIcon(key: string): string {
  return LOG_ICONS[key] ?? 'note';
}

type Timeline = StatsResponse['acquisitionTimeline'];

// Self-contained SVG area chart: cumulative value area + per-month count bars.
function AcquisitionChart({ data }: { data: Timeline }) {
  const gradId = useId();
  if (!data || data.length < 2) {
    return (
      <div className="chart-wrap">
        <p style={{ color: 'var(--ink-4)', fontSize: 13, padding: '32px 8px', textAlign: 'center' }}>
          Not enough history yet — add a few items with acquisition dates to see the timeline.
        </p>
      </div>
    );
  }

  const W = 640;
  const H = 220;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const axisH = 20;
  const barBandH = 34;
  const areaBottom = H - axisH - barBandH;
  const areaTop = padT;
  const plotW = W - padL - padR;

  const maxVal = Math.max(1, ...data.map((d) => d.valueCents));
  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => areaBottom - (v / maxVal) * (areaBottom - areaTop);

  const linePts = data.map((d, i) => `${x(i)},${y(d.valueCents)}`);
  const areaPath = `M ${x(0)},${areaBottom} L ${linePts.join(' L ')} L ${x(n - 1)},${areaBottom} Z`;
  const linePath = `M ${linePts.join(' L ')}`;

  // ~4 horizontal grid lines
  const gridLines = [0, 1, 2, 3, 4].map((g) => areaTop + (g / 4) * (areaBottom - areaTop));

  // x-axis labels: ~6 evenly spaced
  const labelStep = Math.max(1, Math.ceil(n / 6));
  const labels = data
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % labelStep === 0 || i === n - 1);

  const barW = Math.max(2, Math.min(14, (plotW / n) * 0.5));

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Acquisition timeline">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* horizontal grid lines */}
        {gridLines.map((gy, i) => (
          <line key={i} className="chart-grid-line" x1={padL} y1={gy} x2={W - padR} y2={gy} />
        ))}

        {/* baseline */}
        <line className="chart-grid-line" x1={padL} y1={areaBottom} x2={W - padR} y2={areaBottom} />

        {/* cumulative value area + line */}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke="var(--brass)" strokeWidth={1.75} strokeLinejoin="round" />

        {/* per-month count bars at the bottom band */}
        {data.map((d, i) => {
          const bh = (d.count / maxCount) * (barBandH - 6);
          const bx = x(i) - barW / 2;
          const by = H - axisH - bh;
          return (
            <rect
              key={i}
              x={bx}
              y={by}
              width={barW}
              height={Math.max(0, bh)}
              rx={1}
              fill="var(--ink-4)"
              opacity={0.5}
            />
          );
        })}

        {/* x-axis month labels */}
        {labels.map(({ d, i }) => (
          <text
            key={i}
            className="chart-axis"
            x={Math.max(padL + 14, Math.min(W - padR - 14, x(i)))}
            y={H - 5}
            textAnchor="middle"
          >
            {monthLabel(d.month)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nm = names[Number(m) - 1] ?? month;
  return `${nm} ${String(y).slice(2)}`;
}

export function DashboardPage({ onNewCollection }: { onNewCollection: () => void }) {
  const navigate = useNavigate();
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const { data: collections } = useCollections();

  if (isLoading) return <LoadingBlock label="Loading your archive…" />;
  if (isError || !stats)
    return <ErrorBlock message={(error as Error)?.message ?? 'Could not load stats.'} onRetry={() => refetch()} />;

  const { totals, byCollection, recentItems, recentLogs, acquisitionTimeline, alerts } = stats;

  // First-run empty state.
  if (totals.collections === 0) {
    return (
      <div className="page">
        <EmptyState
          title="Your archive is empty"
          message="Start by creating your first collection — firearms, coins, stamps, or anything you keep. Everything lives on this machine."
          trust
          action={
            <button className="btn btn-primary btn-lg" onClick={onNewCollection}>
              <Icon name="plus" size={17} /> New Collection
            </button>
          }
        />
      </div>
    );
  }

  const firstCollection = collections?.[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title serif">Archive</h1>
          <p className="page-sub">
            {formatNumber(totals.items)} {totals.items === 1 ? 'item' : 'items'} across{' '}
            {totals.collections} {totals.collections === 1 ? 'collection' : 'collections'} ·{' '}
            {formatMoney(totals.valueCents)} tracked
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {firstCollection && (
            <button className="btn" onClick={() => navigate(`/c/${firstCollection.id}/new`)}>
              <Icon name="plus" size={16} /> New Item
            </button>
          )}
          <button className="btn btn-primary" onClick={onNewCollection}>
            <Icon name="plus" size={16} /> New Collection
          </button>
        </div>
      </div>

      {/* Low-stock alerts */}
      {alerts.length > 0 && (
        <div className="alert-banner" role="alert">
          <span className="alert-icon">
            <Icon name="warning" size={18} />
          </span>
          <span>
            <strong>
              {alerts.length} {alerts.length === 1 ? 'item' : 'items'} low on stock
            </strong>
            {' — '}
            {alerts.slice(0, 4).map((a, i) => (
              <span key={a.itemId}>
                {i > 0 && ', '}
                <Link to={`/items/${a.itemId}`}>{a.name}</Link>
              </span>
            ))}
            {alerts.length > 4 && `, and ${alerts.length - 4} more`}
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="dash-stats">
        <div className="stat-card">
          <div className="stat-label">
            <span className="eyebrow">Total Items</span>
            <Icon name="box" size={14} />
          </div>
          <div className="stat-value serif tnum">{formatNumber(totals.items)}</div>
          <div className="stat-icon">
            <Icon name="box" size={64} />
          </div>
        </div>
        <div className="stat-card accent">
          <div className="stat-label">
            <span className="eyebrow">Total Value</span>
            <Icon name="dollar" size={14} />
          </div>
          <div className="stat-value serif tnum">{formatMoney(totals.valueCents)}</div>
          <div className="stat-icon">
            <Icon name="dollar" size={64} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="eyebrow">Collections</span>
            <Icon name="layers" size={14} />
          </div>
          <div className="stat-value serif tnum">{formatNumber(totals.collections)}</div>
          <div className="stat-icon">
            <Icon name="layers" size={64} />
          </div>
        </div>
      </div>

      {/* Per-collection tiles */}
      {byCollection.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-head">
            <SectionLabel>Collections</SectionLabel>
          </div>
          <div className="coll-tiles">
            {byCollection.map((c) => (
              <Link
                key={c.id}
                to={`/c/${c.id}`}
                className="coll-tile"
                style={{ '--tile-accent': c.color } as React.CSSProperties}
              >
                <span className="coll-tile-icon">
                  <Icon name={c.icon} size={20} />
                </span>
                <span className="coll-tile-name">{c.name}</span>
                <span className="coll-tile-meta">
                  <span className="coll-tile-count">
                    {formatNumber(c.count)} {c.count === 1 ? 'item' : 'items'}
                  </span>
                  <span className="coll-tile-value">{formatMoneyCompact(c.valueCents)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Two-column grid: acquisitions + recent items | activity feed */}
      <div className="dash-grid">
        <div>
          <section className="dash-section">
            <div className="dash-section-head">
              <SectionLabel>Acquisitions</SectionLabel>
            </div>
            <div className="panel" style={{ padding: 'var(--sp-4)' }}>
              <AcquisitionChart data={acquisitionTimeline} />
            </div>
          </section>

          {recentItems.length > 0 && (
            <section className="dash-section">
              <div className="dash-section-head">
                <SectionLabel>Recent items</SectionLabel>
              </div>
              <div className="recent-strip">
                {recentItems.map((item) => (
                  <Link key={item.id} to={`/items/${item.id}`} className="recent-thumb">
                    <div className="thumb-box">
                      {item.thumbUrl ? (
                        <img src={item.thumbUrl} alt={item.name} loading="lazy" />
                      ) : (
                        <div className="thumb-empty">
                          <Icon name="photo" size={22} />
                        </div>
                      )}
                    </div>
                    <div className="thumb-name">{item.name}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="dash-section">
          <div className="dash-section-head">
            <SectionLabel>Recent activity</SectionLabel>
          </div>
          <div className="panel" style={{ padding: '0 var(--sp-4)' }}>
            {recentLogs.length === 0 ? (
              <p style={{ color: 'var(--ink-4)', fontSize: 13, padding: 'var(--sp-4) 0' }}>
                No recent activity yet.
              </p>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="feed-item">
                  <span
                    className="feed-icon"
                    style={{
                      background: 'var(--brass-ghost)',
                      color: 'var(--brass)',
                    }}
                  >
                    <Icon name={logIcon(log.logTypeKey)} size={16} />
                  </span>
                  <div className="feed-body">
                    <div className="feed-title">
                      <Link to={`/items/${log.itemId}`}>{log.title || log.logTypeLabel}</Link>
                    </div>
                    <div className="feed-meta">
                      {log.logTypeLabel} · {log.itemName} · {formatDate(log.date)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
