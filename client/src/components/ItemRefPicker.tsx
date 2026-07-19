// item_ref (single) / item_refs (multi) picker: search-as-you-type over
// /api/item-choices, scoped by refTemplate. Single = select-with-search;
// multi = chip list + search dropdown. (DESIGN §5.2)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useItemChoices, useItem } from '../api/hooks';
import { useDebouncedValue } from '../lib/hooks';
import { formatQuantity } from '../lib/format';
import type { ItemChoice } from '../api/types';

interface BaseProps {
  refTemplate?: string;
  excludeItemId?: number;
}

// Resolve a chosen id's display name; falls back through choices then a fetch.
function ChosenChip({
  id,
  choices,
  onRemove,
}: {
  id: number;
  choices: ItemChoice[] | undefined;
  onRemove?: () => void;
}) {
  const known = choices?.find((c) => c.id === id);
  // Only fetch when not already in the choices list (e.g. a former/other-collection ref).
  const { data: fetched } = useItem(known ? undefined : id);
  const name = known?.name ?? fetched?.name ?? `#${id}`;
  const hint = known?.hint ?? null;
  return (
    <span className="ref-chip">
      {known?.thumbUrl ? (
        <img className="ref-chip-thumb" src={known.thumbUrl} alt="" />
      ) : (
        <Icon name="box" size={13} />
      )}
      <span className="ref-chip-name">{name}</span>
      {hint && <span className="ref-chip-hint">{hint}</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

// Shared search dropdown. Renders an input + a filtered list of choices.
function SearchDropdown({
  refTemplate,
  excludeItemId,
  selectedIds,
  onPick,
  placeholder,
}: BaseProps & {
  selectedIds: number[];
  onPick: (choice: ItemChoice) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 180);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { data: choices, isLoading } = useItemChoices(refTemplate, debounced, open);

  const visible = useMemo(
    () => (choices ?? []).filter((c) => !selectedIds.includes(c.id) && c.id !== excludeItemId),
    [choices, selectedIds, excludeItemId],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="ref-search" ref={rootRef}>
      <div className="ref-search-input">
        <Icon name="search" size={15} />
        <input
          className="input"
          type="text"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter') {
              e.preventDefault();
              if (visible.length) {
                onPick(visible[0]);
                setQuery('');
              }
            }
          }}
        />
      </div>
      {open && (
        <div className="ref-menu" role="listbox">
          {isLoading && <div className="ref-menu-empty">Searching…</div>}
          {!isLoading && visible.length === 0 && (
            <div className="ref-menu-empty">
              {query ? 'No matches' : 'No items available'}
            </div>
          )}
          {visible.map((c) => (
            <button
              type="button"
              key={c.id}
              className="ref-option"
              role="option"
              onClick={() => {
                onPick(c);
                setQuery('');
              }}
            >
              {c.thumbUrl ? (
                <img className="ref-opt-thumb" src={c.thumbUrl} alt="" />
              ) : (
                <span className="ref-opt-thumb placeholder"><Icon name="box" size={14} /></span>
              )}
              <span className="ref-opt-body">
                <span className="ref-opt-name">{c.name}</span>
                <span className="ref-opt-meta">
                  {c.collectionName}
                  {c.hint ? ` · ${c.hint}` : ''}
                  {c.quantity != null ? ` · ${formatQuantity(c.quantity)}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Single reference: shows the chosen chip (with clear) or a search box.
export function ItemRefPicker({
  value,
  onChange,
  refTemplate,
  excludeItemId,
}: BaseProps & { value: number | null; onChange: (v: number | null) => void }) {
  const { data: choices } = useItemChoices(refTemplate, '', false);
  const selected = typeof value === 'number' ? value : null;

  if (selected != null) {
    return (
      <div className="ref-single">
        <ChosenChip id={selected} choices={choices} onRemove={() => onChange(null)} />
      </div>
    );
  }
  return (
    <SearchDropdown
      refTemplate={refTemplate}
      excludeItemId={excludeItemId}
      selectedIds={[]}
      onPick={(c) => onChange(c.id)}
      placeholder="Search items…"
    />
  );
}

// Multi reference: chip list + search dropdown to add more.
export function ItemRefsPicker({
  value,
  onChange,
  refTemplate,
  excludeItemId,
}: BaseProps & { value: number[] | null; onChange: (v: number[] | null) => void }) {
  const ids = Array.isArray(value) ? value.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [];
  const { data: choices } = useItemChoices(refTemplate, '', ids.length > 0);

  const add = (id: number) => {
    if (ids.includes(id)) return;
    onChange([...ids, id]);
  };
  const remove = (id: number) => {
    const next = ids.filter((x) => x !== id);
    onChange(next.length ? next : null);
  };

  return (
    <div className="ref-multi">
      {ids.length > 0 && (
        <div className="ref-chips">
          {ids.map((id) => (
            <ChosenChip key={id} id={id} choices={choices} onRemove={() => remove(id)} />
          ))}
        </div>
      )}
      <SearchDropdown
        refTemplate={refTemplate}
        excludeItemId={excludeItemId}
        selectedIds={ids}
        onPick={(c) => add(c.id)}
        placeholder={ids.length ? 'Add another…' : 'Search items to link…'}
      />
    </div>
  );
}
