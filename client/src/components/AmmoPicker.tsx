// ammo_ref picker: fed by /api/ammo-choices, shows name + remaining qty.
// In a range-log context, the gun's associated_ammo ids are sorted first and
// tagged with an "associated" marker (DESIGN §5.2).
import { useMemo } from 'react';
import { useAmmoChoices } from '../api/hooks';
import { formatQuantity } from '../lib/format';

export function AmmoPicker({
  value,
  onChange,
  associatedIds,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  associatedIds?: number[];
}) {
  const { data: choices, isLoading } = useAmmoChoices();
  const assoc = useMemo(() => new Set(associatedIds ?? []), [associatedIds]);

  // Associated ammo first (preserving name order within each group).
  const ordered = useMemo(() => {
    if (!choices) return [];
    if (assoc.size === 0) return choices;
    const first = choices.filter((c) => assoc.has(c.id));
    const rest = choices.filter((c) => !assoc.has(c.id));
    return [...first, ...rest];
  }, [choices, assoc]);

  if (isLoading) {
    return <div className="input" style={{ color: 'var(--ink-4)' }}>Loading ammo…</div>;
  }
  if (!choices || choices.length === 0) {
    return (
      <div className="input" style={{ color: 'var(--ink-4)', display: 'flex', alignItems: 'center' }}>
        No ammunition inventory yet
      </div>
    );
  }

  return (
    <select
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">— None —</option>
      {ordered.map((c) => (
        <option key={c.id} value={c.id}>
          {assoc.has(c.id) ? '★ ' : ''}
          {c.name}
          {c.caliber ? ` · ${c.caliber}` : ''} ({formatQuantity(c.quantity)} rds)
          {assoc.has(c.id) ? ' — associated' : ''}
        </option>
      ))}
    </select>
  );
}
