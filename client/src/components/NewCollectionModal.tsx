// New collection modal: template picker (rich cards) + name/icon/color.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './ui';
import { Icon, COLLECTION_ICON_KEYS } from './Icon';
import { useCreateCollection, useTemplates } from '../api/hooks';
import { useToast } from './Toast';
import type { Template } from '../api/types';

const SWATCHES = [
  '#52684f', '#7d5a34', '#64748b', '#8a6d3b', '#46647a', '#8a4b3b',
  '#6b7280', '#4f7038', '#9d7f42', '#5b6e8c', '#8c5b6e', '#3f6b6b',
];

type Step = 'template' | 'details';

export function NewCollectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: templates } = useTemplates();
  const create = useCreateCollection();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('template');
  const [chosen, setChosen] = useState<Template | null>(null);
  const [blank, setBlank] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('box');
  const [color, setColor] = useState(SWATCHES[0]);

  const reset = () => {
    setStep('template');
    setChosen(null);
    setBlank(false);
    setName('');
    setIcon('box');
    setColor(SWATCHES[0]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickTemplate = (t: Template | null) => {
    if (t) {
      setChosen(t);
      setBlank(false);
      setName(t.name);
      setIcon(t.icon);
      setColor(t.color);
    } else {
      setChosen(null);
      setBlank(true);
      setName('');
      setIcon('box');
      setColor(SWATCHES[0]);
    }
    setStep('details');
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Please enter a name');
      return;
    }
    try {
      const coll = await create.mutateAsync({
        name: name.trim(),
        icon,
        color,
        templateKey: chosen ? chosen.key : undefined,
      });
      toast.success(`Created ${coll.name}`);
      close();
      navigate(`/c/${coll.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create collection');
    }
  };

  const cards = useMemo(() => templates ?? [], [templates]);

  return (
    <Modal
      open={open}
      onClose={close}
      title="New Collection"
      width={620}
      footer={
        step === 'details' ? (
          <>
            <button className="btn btn-ghost" onClick={() => setStep('template')}>
              <Icon name="back" size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create Collection'}
            </button>
          </>
        ) : undefined
      }
    >
      {step === 'template' ? (
        <div className="tpl-grid">
          {cards.map((t) => (
            <button key={t.key} className="tpl-card" onClick={() => pickTemplate(t)}>
              <span className="tpl-icon" style={{ color: t.color, background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
                <Icon name={t.icon} size={22} />
              </span>
              <span className="tpl-name">{t.name}</span>
              <span className="tpl-desc">{t.description}</span>
              <span className="tpl-count">{t.fields.length} fields · {t.logTypes.length} log types</span>
            </button>
          ))}
          <button className="tpl-card blank" onClick={() => pickTemplate(null)}>
            <span className="tpl-icon" style={{ color: 'var(--ink-3)', background: 'var(--surface-2)' }}>
              <Icon name="plus" size={22} />
            </span>
            <span className="tpl-name">Start Blank</span>
            <span className="tpl-desc">An empty collection with just core fields. Add your own fields later.</span>
          </button>
        </div>
      ) : (
        <>
          <div className="field">
            <label className="field-label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Collection" autoFocus />
          </div>

          <div className="field">
            <label className="field-label">Icon</label>
            <div className="icon-picker">
              {COLLECTION_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`icon-swatch ${icon === k ? 'active' : ''}`}
                  onClick={() => setIcon(k)}
                  aria-label={k}
                >
                  <Icon name={k} size={20} />
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Accent color</label>
            <div className="color-picker">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
              <label className="color-swatch custom" style={{ background: color }}>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
            </div>
          </div>

          {(chosen || blank) && (
            <div className="preview-line">
              <span className="coll-tile-icon" style={{ '--tile-accent': color, color, background: `color-mix(in srgb, ${color} 15%, transparent)` } as React.CSSProperties}>
                <Icon name={icon} size={18} />
              </span>
              <div>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>{name || 'Untitled'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                  {chosen ? `${chosen.fields.length} fields from ${chosen.name} template` : 'Blank collection'}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
