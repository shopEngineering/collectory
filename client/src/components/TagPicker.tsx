// Tag input: token list + free-text entry (creates unknown tags on save).
import { useState } from 'react';
import { Icon } from './Icon';

export function TagPicker({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...tags, name]);
    setDraft('');
  };

  const remove = (name: string) => onChange(tags.filter((t) => t !== name));

  return (
    <div
      className="tag-input"
      onClick={(e) => {
        const input = (e.currentTarget.querySelector('input') as HTMLInputElement) ?? null;
        input?.focus();
      }}
    >
      {tags.map((t) => (
        <span key={t} className="tag-token">
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={tags.length ? 'Add tag…' : 'Add tags…'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}
