// ammo_ref picker: fed by /api/ammo-choices, shows name + remaining qty.
import { useAmmoChoices } from '../api/hooks';
import { formatQuantity } from '../lib/format';

export function AmmoPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { data: choices, isLoading } = useAmmoChoices();

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
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.caliber ? ` · ${c.caliber}` : ''} ({formatQuantity(c.quantity)} rds)
        </option>
      ))}
    </select>
  );
}
