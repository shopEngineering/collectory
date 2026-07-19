// Renders a single dynamic field input by FieldDef.type. Shared by item form
// and inline log-add form. Values are the raw field values; currency is handled
// as dollars-in / cents-out by the parent (this renders a dollars input).
import { Icon } from './Icon';
import type { FieldDef, FieldValue } from '../api/types';
import { centsToDollars, dollarsToCents } from '../lib/format';
import { AmmoPicker } from './AmmoPicker';
import { ItemRefPicker, ItemRefsPicker } from './ItemRefPicker';

interface FieldInputProps {
  def: FieldDef;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  id?: string;
  // For ammo_ref in a range-log context: the gun's associated_ammo ids, pinned first.
  associatedIds?: number[];
}

export function FieldInput({ def, value, onChange, id, associatedIds }: FieldInputProps) {
  const fid = id ?? `f-${def.key}`;

  switch (def.type) {
    case 'textarea':
      return (
        <textarea
          id={fid}
          className="textarea"
          value={(value as string) ?? ''}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'number':
      return (
        <div className={`input-affix ${def.unit ? '' : ''}`}>
          <input
            id={fid}
            className="input"
            type="number"
            inputMode="decimal"
            value={value === null || value === undefined ? '' : String(value)}
            placeholder={def.placeholder}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {def.unit && <span className="input-suffix">{def.unit}</span>}
        </div>
      );

    case 'currency':
      // Value stored/returned in cents; input shows dollars.
      return (
        <div className="input-affix prefix">
          <span className="input-prefix">$</span>
          <input
            id={fid}
            className="input"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value === null || value === undefined ? '' : centsToDollars(value as number)}
            placeholder="0.00"
            onChange={(e) => onChange(e.target.value === '' ? null : dollarsToCents(e.target.value))}
          />
        </div>
      );

    case 'date':
      return (
        <input
          id={fid}
          className="input"
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case 'year':
      return (
        <input
          id={fid}
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={3000}
          placeholder={def.placeholder ?? 'YYYY'}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );

    case 'select':
      return (
        <select
          id={fid}
          className="select"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— Select —</option>
          {(def.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) => {
        onChange(arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]);
      };
      return (
        <div className="pill-group">
          {(def.options ?? []).map((opt) => (
            <button
              type="button"
              key={opt}
              className={`pill ${arr.includes(opt) ? 'selected' : ''}`}
              onClick={() => toggle(opt)}
            >
              {arr.includes(opt) && <Icon name="check" size={13} />}
              {opt}
            </button>
          ))}
        </div>
      );
    }

    case 'checkbox':
      return (
        <label className="checkbox-row">
          <input
            type="checkbox"
            className="sr-only"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={`checkbox-box ${value ? 'checked' : ''}`}>
            <Icon name="check" size={14} />
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{def.label}</span>
        </label>
      );

    case 'url':
      return (
        <input
          id={fid}
          className="input"
          type="url"
          inputMode="url"
          placeholder={def.placeholder ?? 'https://…'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case 'rating': {
      const rating = typeof value === 'number' ? value : 0;
      return (
        <div className="rating" role="radiogroup" aria-label={def.label}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              className={n <= rating ? 'on' : ''}
              onClick={() => onChange(n === rating ? 0 : n)}
              aria-label={`${n} of 5`}
            >
              <Icon name="star" size={20} />
            </button>
          ))}
        </div>
      );
    }

    case 'ammo_ref':
      return (
        <AmmoPicker
          value={typeof value === 'number' ? value : null}
          onChange={(v) => onChange(v)}
          associatedIds={associatedIds}
        />
      );

    case 'item_ref':
      return (
        <ItemRefPicker
          value={typeof value === 'number' ? value : null}
          onChange={(v) => onChange(v)}
          refTemplate={def.refTemplate}
        />
      );

    case 'item_refs':
      return (
        <ItemRefsPicker
          value={Array.isArray(value) ? value.map((x) => Number(x)) : null}
          onChange={(v) => onChange(v)}
          refTemplate={def.refTemplate}
        />
      );

    case 'text':
    default:
      return (
        <input
          id={fid}
          className="input"
          type="text"
          placeholder={def.placeholder}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

// Field wrapper with label + help. Checkbox renders its own inline label.
export function Field({
  def,
  value,
  onChange,
  associatedIds,
}: {
  def: FieldDef;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  associatedIds?: number[];
}) {
  if (def.type === 'checkbox') {
    return (
      <div className="field">
        <FieldInput def={def} value={value} onChange={onChange} />
        {def.help && <span className="field-help">{def.help}</span>}
      </div>
    );
  }
  const fullWidth = def.type === 'textarea' || def.type === 'multiselect' || def.type === 'item_refs';
  return (
    <div className={`field ${fullWidth ? 'full' : ''}`}>
      <label className="field-label" htmlFor={`f-${def.key}`}>
        {def.label}
        {def.required && <span className="field-req">*</span>}
      </label>
      <FieldInput def={def} value={value} onChange={onChange} associatedIds={associatedIds} />
      {def.help && <span className="field-help">{def.help}</span>}
    </div>
  );
}
