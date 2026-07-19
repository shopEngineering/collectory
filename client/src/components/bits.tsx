// Small shared presentational bits used across pages.
import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import type { ItemStatus, Tag } from '../api/types';
import { STATUS_LABELS } from '../lib/format';

export function StatusBadge({ status }: { status: ItemStatus | string }) {
  return <span className={`status status-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function CollectionDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      className="nav-dot"
      style={{ background: color, width: size, height: size } as CSSProperties}
      aria-hidden
    />
  );
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="chip">
      <span className="chip-dot" style={{ background: tag.color }} />
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${tag.name}`} style={{ color: 'var(--ink-4)', display: 'grid', placeItems: 'center' }}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

// Photo tile with blurred cover-fill backdrop + contained hero (never crops).
export function PhotoFill({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={`photo-none ${className ?? ''}`}>
        <Icon name="photo" size={28} />
      </div>
    );
  }
  return (
    <>
      <div className="photo-blur" style={{ backgroundImage: `url("${src}")` }} aria-hidden />
      <img className="photo-main" src={src} alt={alt} loading="lazy" />
    </>
  );
}

export function ValueFigure({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`serif tnum ${className ?? ''}`} style={{ color: 'var(--brass)' }}>{children}</span>;
}

// Inline empty-state line illustration (consistent 1.5px stroke) + copy + action.
export function EmptyState({
  illustration,
  title,
  message,
  action,
  trust,
}: {
  illustration?: React.ReactNode;
  title: string;
  message: string;
  action?: React.ReactNode;
  trust?: boolean;
}) {
  return (
    <div className="empty">
      {illustration ?? <EmptyIllustration />}
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
      {trust && (
        <span className="trust">
          <Icon name="lock" size={13} /> Local-first. No servers, no cloud, no telemetry.
        </span>
      )}
    </div>
  );
}

// Default hand-drawn-feel line illustration: an open specimen drawer.
export function EmptyIllustration() {
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="14" y="26" width="64" height="44" rx="4" />
      <path d="M14 40h64" />
      <path d="M14 54h64" />
      <circle cx="46" cy="33" r="1.5" />
      <circle cx="46" cy="47" r="1.5" />
      <circle cx="46" cy="61" r="1.5" />
      <path d="M30 20l4-6h24l4 6" opacity="0.6" />
    </svg>
  );
}
