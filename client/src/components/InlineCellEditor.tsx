// Spreadsheet-style in-place cell editor for the Browse table view. Renders the
// right control for the cell's type, commits on Enter/blur, reverts on Esc, and
// shows a subtle pending indicator while the PATCH is in flight. Tab commits and
// advances to the next editable cell in the row. See DESIGN §6.
import { useEffect, useRef, useState } from 'react';
import type { FieldValue, ItemStatus } from '../api/types';
import { ITEM_STATUSES } from '../api/types';
import { STATUS_LABELS, centsToDollars, dollarsToCents } from '../lib/format';

// The kinds of editor an editable cell can use.
export type CellEditorKind =
  | 'text'
  | 'textarea' // edited as single-line text
  | 'number'
  | 'currency' // dollars in UI, cents on the wire
  | 'date'
  | 'year'
  | 'select'
  | 'checkbox'
  | 'url'
  | 'rating';

export interface EditableCell {
  // Stable identifier for the cell within a row (core key or `field:<key>`).
  cellId: string;
  kind: CellEditorKind;
  // The raw value as stored (cents for currency, boolean for checkbox, etc.).
  value: FieldValue;
  options?: string[]; // for select
  optionLabels?: Record<string, string>; // display labels for select options (e.g. status keys)
  // Build the PATCH body from the committed raw value.
  toPatch: (next: FieldValue) => Record<string, unknown>;
}

// Convert the stored value into the string the input control shows.
function toInputString(cell: EditableCell): string {
  const v = cell.value;
  if (v == null) return '';
  if (cell.kind === 'currency') return centsToDollars(typeof v === 'number' ? v : Number(v));
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

// Parse the input string back into the stored raw value for the given kind.
// checkbox/rating are toggled by dedicated controls that pass a canonical string
// ('true'/'' for checkbox, the numeric rating), parsed here into their real types.
function parseValue(kind: CellEditorKind, raw: string): FieldValue {
  const trimmed = raw.trim();
  switch (kind) {
    case 'number':
    case 'year':
    case 'rating':
      return trimmed === '' ? null : Number(trimmed);
    case 'currency':
      return trimmed === '' ? null : dollarsToCents(trimmed);
    case 'checkbox':
      return trimmed === 'true';
    case 'date':
    case 'url':
    case 'select':
      return trimmed === '' ? null : trimmed;
    case 'text':
    case 'textarea':
    default:
      return trimmed === '' ? null : raw;
  }
}

export function InlineCellEditor({
  cell,
  onCommit,
  onCancel,
  onCommitAndAdvance,
}: {
  cell: EditableCell;
  // Commit the raw value; returns a promise so the cell can show pending state.
  onCommit: (patch: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  // Tab: commit, then open the next editable cell in the row.
  onCommitAndAdvance: (patch: Record<string, unknown> | null, dir: 1 | -1) => void;
}) {
  const [draft, setDraft] = useState<string>(() => toInputString(cell));
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  // Guard so a blur triggered by our own commit/cancel doesn't double-fire.
  const settled = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement && el.type !== 'date') {
      el.select();
    }
  }, []);

  const buildPatch = (raw: string): Record<string, unknown> => {
    const next = parseValue(cell.kind, raw);
    return cell.toPatch(next);
  };

  const commit = async (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    setPending(true);
    try {
      await onCommit(buildPatch(raw));
    } finally {
      setPending(false);
    }
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit(draft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      settled.current = true;
      onCommitAndAdvance(buildPatch(draft), e.shiftKey ? -1 : 1);
    }
  };

  // Checkbox commits immediately on toggle (no text entry).
  if (cell.kind === 'checkbox') {
    const checked = !!cell.value;
    return (
      <div className="cell-editor checkbox" data-pending={pending || undefined}>
        <button
          type="button"
          ref={(el) => (inputRef.current = el as unknown as HTMLInputElement)}
          className={`checkbox-box ${checked ? 'checked' : ''}`}
          aria-label="Toggle"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          onClick={() => void commit(checked ? '' : 'true')}
          onBlur={cancel}
        >
          <Check checked={checked} />
        </button>
      </div>
    );
  }

  // Rating commits immediately on star click.
  if (cell.kind === 'rating') {
    const rating = typeof cell.value === 'number' ? cell.value : 0;
    return (
      <div
        className="cell-editor rating"
        role="radiogroup"
        aria-label="Rating"
        data-pending={pending || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        tabIndex={-1}
        ref={(el) => (inputRef.current = el as unknown as HTMLInputElement)}
        onBlur={(e) => {
          // Only cancel when focus leaves the whole group.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) cancel();
        }}
      >
        <div className="rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              className={n <= rating ? 'on' : ''}
              aria-label={`${n} of 5`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void commit(String(n === rating ? 0 : n))}
            >
              <Star />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (cell.kind === 'select') {
    const opts = cell.options ?? [];
    return (
      <div className="cell-editor" data-pending={pending || undefined}>
        <select
          ref={(el) => (inputRef.current = el)}
          className="select cell-input"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit(draft)}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {cell.optionLabels?.[o] ?? o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const inputType =
    cell.kind === 'number' || cell.kind === 'currency' || cell.kind === 'year'
      ? 'number'
      : cell.kind === 'date'
        ? 'date'
        : cell.kind === 'url'
          ? 'url'
          : 'text';

  return (
    <div className={`cell-editor ${cell.kind === 'currency' ? 'currency' : ''}`} data-pending={pending || undefined}>
      {cell.kind === 'currency' && <span className="cell-prefix">$</span>}
      <input
        ref={(el) => (inputRef.current = el)}
        className="input cell-input"
        type={inputType}
        inputMode={
          cell.kind === 'number' || cell.kind === 'currency'
            ? 'decimal'
            : cell.kind === 'year'
              ? 'numeric'
              : undefined
        }
        step={cell.kind === 'currency' ? '0.01' : undefined}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit(draft)}
      />
    </div>
  );
}

// Small inline glyphs (avoid importing Icon just for these two).
function Check({ checked }: { checked: boolean }) {
  if (!checked) return null;
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}
function Star() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}

// Re-exported helpers so BrowsePage can build EditableCell descriptors without
// duplicating the status/currency knowledge.
export const CELL_STATUS_OPTIONS: ItemStatus[] = ITEM_STATUSES;
export const CELL_STATUS_LABELS = STATUS_LABELS;
