// Formatting helpers. Currency comes from settings; money is integer cents.

let currentCurrency = 'USD';
export function setCurrency(code: string) {
  currentCurrency = code || 'USD';
}
export function getCurrency() {
  return currentCurrency;
}

export function formatMoney(cents: number | null | undefined, opts?: { blank?: string }): string {
  if (cents == null) return opts?.blank ?? '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currentCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

// Compact money for tight stat spots (e.g. $12.4k)
export function formatMoneyCompact(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currentCurrency,
      notation: dollars >= 100000 ? 'compact' : 'standard',
      maximumFractionDigits: dollars >= 100000 ? 1 : 0,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(0)}`;
  }
}

// dollars string (from an input) -> integer cents
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === '' || input == null) return null;
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

export function formatNumber(n: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (n == null) return '—';
  return new Intl.NumberFormat(undefined, opts).format(n);
}

export function formatQuantity(n: number): string {
  // Show integers cleanly, fractional lots with up to 2 decimals.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function formatDate(iso: string | null | undefined, opts?: { long?: boolean }): string {
  if (!iso) return '—';
  // Accept 'YYYY', 'YYYY-MM', 'YYYY-MM-DD', full ISO.
  const parts = iso.split('T')[0].split('-');
  if (parts.length === 1 && parts[0]) return parts[0]; // year only
  const [y, m, d] = parts;
  if (!d) {
    if (!m) return y;
    return `${monthName(Number(m))} ${y}`;
  }
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: opts?.long ? 'long' : 'short',
    day: 'numeric',
  });
}

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatDate(iso);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function monthName(m: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? '';
}

export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const STATUS_LABELS: Record<string, string> = {
  owned: 'Owned',
  wishlist: 'Wishlist',
  loaned: 'Loaned',
  sold: 'Sold',
  traded: 'Traded',
  gifted: 'Gifted',
};

export function statusClass(status: string): string {
  return `status status-${status}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
