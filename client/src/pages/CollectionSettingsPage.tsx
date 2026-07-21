// Collection settings (route "/c/:collectionId/settings"): meta, field editor,
// log-type editor, danger zone. DESIGN §6.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, COLLECTION_ICON_KEYS } from '../components/Icon';
import { Modal, ConfirmDialog, LoadingBlock, ErrorBlock, Switch } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  useCollection,
  useCollections,
  useTemplates,
  useUpdateCollection,
  useSaveFields,
  useSaveLogTypes,
  useDeleteCollection,
} from '../api/hooks';
import { useBeforeUnload, useNavigationBlocker } from '../lib/hooks';
import type { FieldDef, FieldType, LogTypeDef } from '../api/types';

const COLOR_SWATCHES = [
  '#52684f', '#7d5a34', '#64748b', '#8a6d3b', '#46647a', '#8a4b3b',
  '#6b7280', '#4f7038', '#9d7f42', '#5b6e8c', '#8c5b6e', '#3f6b6b',
];

const LOG_TYPE_ICON_KEYS = [
  'target', 'brush', 'wrench', 'badge', 'arrow-up', 'arrow-down', 'archive', 'note', 'droplet', 'edge',
] as const;

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text (multi-line)' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'year', label: 'Year' },
  { value: 'select', label: 'Select (one)' },
  { value: 'multiselect', label: 'Select (multiple)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
  { value: 'rating', label: 'Rating' },
  { value: 'item_ref', label: 'Item reference (one)' },
  { value: 'item_refs', label: 'Item reference (multiple)' },
  { value: 'ammo_ref', label: 'Ammunition reference' },
];

// snake_case key from a human label, e.g. "Barrel Length" -> "barrel_length".
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';
}

// Ensure a key is unique among existing keys (append _2, _3, ... on collision).
function uniqueKey(base: string, existing: string[], skip?: string): string {
  if (base !== skip && !existing.includes(base)) return base;
  if (base === skip) return base;
  let i = 2;
  let candidate = `${base}_${i}`;
  while (existing.includes(candidate)) {
    i += 1;
    candidate = `${base}_${i}`;
  }
  return candidate;
}

export function CollectionSettingsPage() {
  const cid = Number(useParams().collectionId);
  const navigate = useNavigate();
  const toast = useToast();

  const { data: collection, isLoading, error } = useCollection(cid);
  const { data: templates } = useTemplates();
  const { data: collections } = useCollections();
  const updateCollection = useUpdateCollection(cid);
  const saveFields = useSaveFields(cid);
  const saveLogTypes = useSaveLogTypes(cid);
  const deleteCollection = useDeleteCollection();

  // Item count for the delete-collection copy. The list endpoint carries
  // itemCount; fall back to the (possibly present) detail value.
  const itemCount = collections?.find((c) => c.id === cid)?.itemCount ?? collection?.itemCount ?? 0;

  // Template keys a ref field can target (built-in templates + any template a
  // collection was created from). Deduped, used by the FieldModal refTemplate picker.
  const refTemplateOptions: { value: string; label: string }[] = (() => {
    const seen = new Map<string, string>();
    for (const t of templates ?? []) seen.set(t.key, t.name);
    for (const c of collections ?? []) {
      if (c.templateKey && !seen.has(c.templateKey)) seen.set(c.templateKey, c.templateKey);
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  })();

  // ---- Meta form state ----
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('box');
  const [color, setColor] = useState(COLOR_SWATCHES[0]);
  const [description, setDescription] = useState('');
  const [metaDirty, setMetaDirty] = useState(false);

  // ---- Fields working copy ----
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldDef | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<FieldDef | null>(null);
  const [dragFieldIdx, setDragFieldIdx] = useState<number | null>(null);

  // ---- Log types working copy ----
  const [logTypes, setLogTypes] = useState<LogTypeDef[]>([]);
  const [logTypesDirty, setLogTypesDirty] = useState(false);
  const [logTypeModalOpen, setLogTypeModalOpen] = useState(false);
  const [editingLogType, setEditingLogType] = useState<LogTypeDef | null>(null);
  const [deleteLogTypeTarget, setDeleteLogTypeTarget] = useState<LogTypeDef | null>(null);

  // ---- Danger zone ----
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmForceDelete, setConfirmForceDelete] = useState(false);

  useEffect(() => {
    if (!collection) return;
    setName(collection.name);
    setIcon(collection.icon);
    setColor(collection.color);
    setDescription(collection.description ?? '');
    setMetaDirty(false);
    setFields(collection.fields);
    setFieldsDirty(false);
    setLogTypes(collection.logTypes);
    setLogTypesDirty(false);
  }, [collection]);

  // Unsaved-work guard: field/log-type/meta edits are client-only until saved.
  const anyDirty = metaDirty || fieldsDirty || logTypesDirty;
  useBeforeUnload(anyDirty);
  const disarmNavGuard = useNavigationBlocker(anyDirty);

  if (isLoading) return <LoadingBlock label="Loading collection…" />;
  if (error || !collection) return <ErrorBlock message={error instanceof Error ? error.message : 'Collection not found'} />;

  const existingFieldKeys = fields.map((f) => f.key);
  const existingLogTypeKeys = logTypes.map((l) => l.key);

  // ---- Meta handlers ----
  const saveMeta = async () => {
    try {
      await updateCollection.mutateAsync({ name, icon, color, description });
      setMetaDirty(false);
      toast.success('Collection updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update collection');
    }
  };

  // ---- Field handlers ----
  const openNewField = () => {
    setEditingField(null);
    setFieldModalOpen(true);
  };
  const openEditField = (f: FieldDef) => {
    setEditingField(f);
    setFieldModalOpen(true);
  };
  const upsertField = (f: FieldDef) => {
    setFields((prev) => {
      const idx = prev.findIndex((x) => x.key === f.key);
      if (idx === -1) return [...prev, f];
      const copy = [...prev];
      copy[idx] = f;
      return copy;
    });
    setFieldsDirty(true);
    setFieldModalOpen(false);
  };
  const removeField = (f: FieldDef) => {
    setFields((prev) => prev.filter((x) => x.key !== f.key));
    setFieldsDirty(true);
    setDeleteFieldTarget(null);
  };
  const reorderFields = (from: number, to: number) => {
    setFields((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
    setFieldsDirty(true);
  };
  const commitFields = async () => {
    try {
      await saveFields.mutateAsync(fields);
      setFieldsDirty(false);
      toast.success('Fields saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save fields');
    }
  };

  // ---- Log-type handlers ----
  const openNewLogType = () => {
    setEditingLogType(null);
    setLogTypeModalOpen(true);
  };
  const openEditLogType = (lt: LogTypeDef) => {
    setEditingLogType(lt);
    setLogTypeModalOpen(true);
  };
  const upsertLogType = (lt: LogTypeDef) => {
    setLogTypes((prev) => {
      const idx = prev.findIndex((x) => x.key === lt.key);
      if (idx === -1) return [...prev, lt];
      const copy = [...prev];
      copy[idx] = lt;
      return copy;
    });
    setLogTypesDirty(true);
    setLogTypeModalOpen(false);
  };
  const removeLogType = (lt: LogTypeDef) => {
    if (lt.key === 'note') return;
    setLogTypes((prev) => prev.filter((x) => x.key !== lt.key));
    setLogTypesDirty(true);
    setDeleteLogTypeTarget(null);
  };
  const commitLogTypes = async () => {
    try {
      await saveLogTypes.mutateAsync(logTypes);
      setLogTypesDirty(false);
      toast.success('Activity log types saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save log types');
    }
  };

  // ---- Danger zone handlers ----
  const doDelete = async (force: boolean) => {
    try {
      await deleteCollection.mutateAsync({ id: cid, force });
      // Collection is gone — bypass the nav guard so it doesn't prompt on exit.
      disarmNavGuard();
      toast.success('Collection deleted');
      navigate('/');
    } catch (e) {
      if (!force) {
        // 409 = non-empty collection; offer force delete.
        setConfirmDelete(false);
        setConfirmForceDelete(true);
        return;
      }
      toast.error(e instanceof Error ? e.message : 'Could not delete collection');
    }
  };

  return (
    <div className="page page-narrow">
      <Link to={`/c/${cid}`} className="back-link">
        <Icon name="back" size={14} /> Back to {collection.name}
      </Link>

      <div className="page-head">
        <h1 className="page-title serif">Collection Settings</h1>
        <p className="page-sub">Customize {collection.name}'s appearance, fields, and activity log types.</p>
      </div>

      {/* ---- Meta section ---- */}
      <div className="panel" style={{ marginBottom: 32 }}>
        <span className="eyebrow">Details</span>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field full">
            <label className="field-label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setMetaDirty(true);
              }}
            />
          </div>

          <div className="field full">
            <label className="field-label">Icon</label>
            <div className="icon-picker">
              {COLLECTION_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`icon-swatch ${icon === k ? 'active' : ''}`}
                  onClick={() => {
                    setIcon(k);
                    setMetaDirty(true);
                  }}
                  aria-label={k}
                >
                  <Icon name={k} size={20} />
                </button>
              ))}
            </div>
          </div>

          <div className="field full">
            <label className="field-label">Accent color</label>
            <div className="color-picker">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setMetaDirty(true);
                  }}
                  aria-label={c}
                />
              ))}
              <label className="color-swatch custom" style={{ background: color }}>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setMetaDirty(true);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="field full">
            <label className="field-label">Description</label>
            <textarea
              className="textarea"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setMetaDirty(true);
              }}
            />
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={saveMeta} disabled={!metaDirty || updateCollection.isPending}>
            {updateCollection.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ---- Field editor ---- */}
      <div style={{ marginBottom: 32 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <span className="eyebrow">Fields</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={openNewField}>
            <Icon name="plus" size={14} /> Add field
          </button>
        </div>

        {fields.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 13 }}>No fields yet.</p>
        ) : (
          <div className="card">
            {fields.map((f, idx) => (
              <FieldRow
                key={f.key}
                field={f}
                index={idx}
                dragging={dragFieldIdx === idx}
                onDragStart={() => setDragFieldIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFieldIdx !== null && dragFieldIdx !== idx) reorderFields(dragFieldIdx, idx);
                  setDragFieldIdx(null);
                }}
                onDragEnd={() => setDragFieldIdx(null)}
                onToggleShowInTable={(v) => upsertField({ ...f, showInTable: v })}
                onToggleShowOnCard={(v) => upsertField({ ...f, showOnCard: v })}
                onEdit={() => openEditField(f)}
                onDelete={() => setDeleteFieldTarget(f)}
              />
            ))}
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" onClick={commitFields} disabled={!fieldsDirty || saveFields.isPending}>
            {saveFields.isPending ? 'Saving…' : 'Save fields'}
          </button>
        </div>
      </div>

      {/* ---- Log-type editor ---- */}
      <div style={{ marginBottom: 32 }}>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <span className="eyebrow">Activity log types</span>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={openNewLogType}>
            <Icon name="plus" size={14} /> Add log type
          </button>
        </div>

        <div className="card">
          {logTypes.map((lt) => (
            <LogTypeRow
              key={lt.key}
              logType={lt}
              onEdit={() => openEditLogType(lt)}
              onDelete={() => setDeleteLogTypeTarget(lt)}
            />
          ))}
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={commitLogTypes} disabled={!logTypesDirty || saveLogTypes.isPending}>
            {saveLogTypes.isPending ? 'Saving…' : 'Save log types'}
          </button>
        </div>
      </div>

      {/* ---- Danger zone ---- */}
      <div className="panel" style={{ borderColor: 'var(--danger, #a34a3f)' }}>
        <span className="eyebrow" style={{ color: 'var(--danger, #a34a3f)' }}>
          Danger zone
        </span>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '8px 0 16px' }}>
          {itemCount > 0
            ? `Permanently delete this collection and all ${itemCount} item${itemCount === 1 ? '' : 's'} it contains, including their photos. This cannot be undone.`
            : 'Permanently delete this empty collection. This cannot be undone.'}
        </p>
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={14} /> Delete collection
        </button>
      </div>

      {/* ---- Field modal ---- */}
      {fieldModalOpen && (
        <FieldModal
          field={editingField}
          existingKeys={existingFieldKeys}
          refTemplateOptions={refTemplateOptions}
          onCancel={() => setFieldModalOpen(false)}
          onSave={upsertField}
        />
      )}

      <ConfirmDialog
        open={!!deleteFieldTarget}
        title="Delete field"
        message={
          deleteFieldTarget
            ? `Delete "${deleteFieldTarget.label}"? Existing values are retained on items — this only removes the field from the editor.`
            : ''
        }
        confirmLabel="Delete field"
        danger
        onConfirm={() => deleteFieldTarget && removeField(deleteFieldTarget)}
        onCancel={() => setDeleteFieldTarget(null)}
      />

      {/* ---- Log-type modal ---- */}
      {logTypeModalOpen && (
        <LogTypeModal
          logType={editingLogType}
          existingKeys={existingLogTypeKeys}
          refTemplateOptions={refTemplateOptions}
          onCancel={() => setLogTypeModalOpen(false)}
          onSave={upsertLogType}
        />
      )}

      <ConfirmDialog
        open={!!deleteLogTypeTarget}
        title="Delete log type"
        message={
          deleteLogTypeTarget
            ? `Delete "${deleteLogTypeTarget.label}"? Existing log entries of this type are retained.`
            : ''
        }
        confirmLabel="Delete log type"
        danger
        onConfirm={() => deleteLogTypeTarget && removeLogType(deleteLogTypeTarget)}
        onCancel={() => setDeleteLogTypeTarget(null)}
      />

      {/* ---- Danger zone dialogs ---- */}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete collection"
        message={
          itemCount > 0
            ? `Permanently delete "${collection.name}" and all ${itemCount} item${itemCount === 1 ? '' : 's'} it contains, along with their photos? This cannot be undone.`
            : `Delete "${collection.name}"? This cannot be undone.`
        }
        confirmLabel={itemCount > 0 ? `Delete ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Delete'}
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void doDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={confirmForceDelete}
        title="Collection isn't empty"
        message={`This collection still has ${itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'items'}. Deleting it will permanently remove every item and its photos — this cannot be undone.`}
        confirmLabel="Permanently delete"
        danger
        onConfirm={() => {
          setConfirmForceDelete(false);
          void doDelete(true);
        }}
        onCancel={() => setConfirmForceDelete(false)}
      />
    </div>
  );
}

// ============================================================================
// FieldRow — draggable row for the field list.
// ============================================================================
function FieldRow({
  field,
  index,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggleShowInTable,
  onToggleShowOnCard,
  onEdit,
  onDelete,
}: {
  field: FieldDef;
  index: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onToggleShowInTable: (v: boolean) => void;
  onToggleShowOnCard: (v: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="feed-item"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ padding: '10px 14px', alignItems: 'center', opacity: dragging ? 0.4 : 1, cursor: 'grab' }}
      data-index={index}
    >
      <span style={{ color: 'var(--ink-faint)', display: 'flex', alignItems: 'center' }}>
        <Icon name="drag-handle" size={16} />
      </span>
      <div className="feed-body" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {field.label}
        </span>
        <span className="chip" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {field.type}
        </span>
        {field.unit && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{field.unit}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 'none' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-4)' }}>
          <Switch on={!!field.showInTable} onChange={onToggleShowInTable} />
          In table
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-4)' }}>
          <Switch on={!!field.showOnCard} onChange={onToggleShowOnCard} />
          On card
        </label>
        <button className="btn-icon btn-ghost" onClick={onEdit} aria-label="Edit field">
          <Icon name="edit" size={15} />
        </button>
        <button className="btn-icon btn-ghost" onClick={onDelete} aria-label="Delete field">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// OptionsEditor — list of text inputs with add/remove, for select/multiselect.
// ============================================================================
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const update = (idx: number, value: string) => {
    const copy = [...options];
    copy[idx] = value;
    onChange(copy);
  };
  const remove = (idx: number) => onChange(options.filter((_, i) => i !== idx));
  const add = () => onChange([...options, '']);

  return (
    <div className="field full">
      <label className="field-label">Options</label>
      {options.map((opt, idx) => (
        <div key={idx} className="row" style={{ marginBottom: 8, gap: 8 }}>
          <input
            className="input"
            value={opt}
            onChange={(e) => update(idx, e.target.value)}
            placeholder={`Option ${idx + 1}`}
          />
          <button type="button" className="btn-icon btn-ghost" onClick={() => remove(idx)} aria-label="Remove option">
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={add}>
        <Icon name="plus" size={14} /> Add option
      </button>
    </div>
  );
}

// ============================================================================
// FieldModal — create/edit a FieldDef.
// ============================================================================
function FieldModal({
  field,
  existingKeys,
  refTemplateOptions,
  onCancel,
  onSave,
}: {
  field: FieldDef | null;
  existingKeys: string[];
  refTemplateOptions: { value: string; label: string }[];
  onCancel: () => void;
  onSave: (f: FieldDef) => void;
}) {
  const isEdit = !!field;
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [section, setSection] = useState(field?.section ?? 'Details');
  const [unit, setUnit] = useState(field?.unit ?? '');
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '');
  const [help, setHelp] = useState(field?.help ?? '');
  const [required, setRequired] = useState(!!field?.required);
  const [options, setOptions] = useState<string[]>(field?.options ?? []);
  // ammo_ref is sugar for item_ref restricted to the ammunition template.
  const [refTemplate, setRefTemplate] = useState<string>(
    field?.refTemplate ?? (field?.type === 'ammo_ref' ? 'ammunition' : ''),
  );
  const toast = useToast();

  const needsOptions = type === 'select' || type === 'multiselect';
  const needsRef = type === 'item_ref' || type === 'item_refs';

  // Build the FieldDef to save. Merge the ORIGINAL field first so properties
  // the modal doesn't edit (showInTable/showOnCard, and any future keys) are
  // preserved; then override editable fields and prune type-specific keys that
  // no longer apply. (FC4: editing a field must not wipe table/card/refTemplate.)
  const buildDef = (): FieldDef => {
    const key = isEdit ? field!.key : uniqueKey(slugify(label), existingKeys);
    const def: FieldDef = {
      ...(field ?? {}),
      key,
      label: label.trim(),
      type,
      section: section.trim() || 'Details',
      required,
    };
    // Unit (number only)
    if (type === 'number' && unit.trim()) def.unit = unit.trim();
    else delete def.unit;
    // Options (select/multiselect only)
    if (needsOptions) def.options = options.map((o) => o.trim()).filter(Boolean);
    else delete def.options;
    // refTemplate (ref types only); ammo_ref pins ammunition.
    if (type === 'ammo_ref') def.refTemplate = 'ammunition';
    else if (needsRef && refTemplate) def.refTemplate = refTemplate;
    else delete def.refTemplate;
    // Placeholder / help are optional across all types.
    if (placeholder.trim()) def.placeholder = placeholder.trim();
    else delete def.placeholder;
    if (help.trim()) def.help = help.trim();
    else delete def.help;
    return def;
  };

  const save = () => {
    if (!label.trim()) {
      toast.error('Please enter a label'); // FC5: required field with no label is rejected.
      return;
    }
    // FC5: warn when an existing field's type changes destructively — stored
    // values for the old type may not convert to the new one.
    if (isEdit && field!.type !== type) {
      const ok = window.confirm(
        `Changing the type from "${field!.type}" to "${type}" may make existing values on items unreadable or blank — they are not converted. Continue?`,
      );
      if (!ok) return;
    }
    onSave(buildDef());
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={isEdit ? 'Edit Field' : 'Add Field'}
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label className="field-label">Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </div>

        {isEdit && (
          <div className="field full">
            <label className="field-label">Key</label>
            <input className="input mono" value={field!.key} disabled />
          </div>
        )}

        <div className="field">
          <label className="field-label">Type</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">Section</label>
          <input className="input" value={section} onChange={(e) => setSection(e.target.value)} />
        </div>

        {needsRef && (
          <div className="field full">
            <label className="field-label">References</label>
            <select
              className="select"
              value={refTemplate}
              onChange={(e) => setRefTemplate(e.target.value)}
            >
              <option value="">Any item</option>
              {refTemplateOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field-help">Restrict the picker to items from this template.</span>
          </div>
        )}

        {type === 'ammo_ref' && (
          <div className="field full">
            <span className="field-help">Links to items in ammunition collections.</span>
          </div>
        )}

        {type === 'number' && (
          <div className="field">
            <label className="field-label">Unit</label>
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="in, rds, lbs…" />
          </div>
        )}

        <div className="field full">
          <label className="field-label">Placeholder</label>
          <input className="input" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
        </div>

        <div className="field full">
          <label className="field-label">Help text</label>
          <input className="input" value={help} onChange={(e) => setHelp(e.target.value)} />
        </div>

        <div className="field full">
          <label className="checkbox-row">
            <input type="checkbox" className="sr-only" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span className={`checkbox-box ${required ? 'checked' : ''}`}>
              <Icon name="check" size={14} />
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Required</span>
          </label>
        </div>

        {needsOptions && <OptionsEditor options={options} onChange={setOptions} />}
      </div>
    </Modal>
  );
}

// ============================================================================
// LogTypeRow
// ============================================================================
function LogTypeRow({
  logType,
  onEdit,
  onDelete,
}: {
  logType: LogTypeDef;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const undeletable = logType.key === 'note';
  return (
    <div className="feed-item" style={{ padding: '10px 14px', alignItems: 'center' }}>
      <span
        className="feed-icon"
        style={{
          color: logType.color ?? 'var(--ink-3)',
          background: logType.color ? `color-mix(in srgb, ${logType.color} 15%, transparent)` : 'var(--surface-2)',
        }}
      >
        <Icon name={logType.icon ?? 'note'} size={16} />
      </span>
      <div className="feed-body" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{logType.label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
          {(logType.fields ?? []).length} field{(logType.fields ?? []).length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <button className="btn-icon btn-ghost" onClick={onEdit} aria-label="Edit log type">
          <Icon name="edit" size={15} />
        </button>
        <button
          className="btn-icon btn-ghost"
          onClick={onDelete}
          disabled={undeletable}
          aria-label="Delete log type"
          title={undeletable ? 'The Note log type cannot be deleted' : undefined}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// LogTypeModal — create/edit a LogTypeDef, with a compact nested field list.
// ============================================================================
function LogTypeModal({
  logType,
  existingKeys,
  refTemplateOptions,
  onCancel,
  onSave,
}: {
  logType: LogTypeDef | null;
  existingKeys: string[];
  refTemplateOptions: { value: string; label: string }[];
  onCancel: () => void;
  onSave: (lt: LogTypeDef) => void;
}) {
  const isEdit = !!logType;
  const [label, setLabel] = useState(logType?.label ?? '');
  const [icon, setIcon] = useState(logType?.icon ?? 'note');
  const [color, setColor] = useState(logType?.color ?? COLOR_SWATCHES[0]);
  const [ltFields, setLtFields] = useState<FieldDef[]>(logType?.fields ?? []);
  const [subFieldModalOpen, setSubFieldModalOpen] = useState(false);
  const [editingSubField, setEditingSubField] = useState<FieldDef | null>(null);
  const toast = useToast();

  const save = () => {
    if (!label.trim()) {
      toast.error('Please enter a label');
      return;
    }
    const key = isEdit ? logType!.key : uniqueKey(slugify(label), existingKeys);
    onSave({ key, label: label.trim(), icon, color, fields: ltFields });
  };

  const upsertSubField = (f: FieldDef) => {
    setLtFields((prev) => {
      const idx = prev.findIndex((x) => x.key === f.key);
      if (idx === -1) return [...prev, f];
      const copy = [...prev];
      copy[idx] = f;
      return copy;
    });
    setSubFieldModalOpen(false);
  };
  const removeSubField = (key: string) => setLtFields((prev) => prev.filter((f) => f.key !== key));

  return (
    <Modal
      open
      onClose={onCancel}
      title={isEdit ? 'Edit Log Type' : 'Add Log Type'}
      width={560}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label className="field-label">Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </div>

        {isEdit && (
          <div className="field full">
            <label className="field-label">Key</label>
            <input className="input mono" value={logType!.key} disabled />
          </div>
        )}

        <div className="field full">
          <label className="field-label">Icon</label>
          <div className="icon-picker">
            {LOG_TYPE_ICON_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={`icon-swatch ${icon === k ? 'active' : ''}`}
                onClick={() => setIcon(k)}
                aria-label={k}
              >
                <Icon name={k} size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="field full">
          <label className="field-label">Color</label>
          <div className="color-picker">
            {COLOR_SWATCHES.map((c) => (
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

        <div className="field full">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <label className="field-label" style={{ margin: 0 }}>
              Fields
            </label>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditingSubField(null);
                setSubFieldModalOpen(true);
              }}
            >
              <Icon name="plus" size={14} /> Add field
            </button>
          </div>

          {ltFields.length === 0 ? (
            <p style={{ color: 'var(--ink-4)', fontSize: 12.5 }}>No structured fields — entries will use notes only.</p>
          ) : (
            <div className="card">
              {ltFields.map((f) => (
                <div key={f.key} className="feed-item" style={{ padding: '8px 12px', alignItems: 'center' }}>
                  <div className="feed-body" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>{f.label}</span>
                    <span className="chip" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                      {f.type}
                    </span>
                    {f.unit && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{f.unit}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button
                      type="button"
                      className="btn-icon btn-ghost"
                      onClick={() => {
                        setEditingSubField(f);
                        setSubFieldModalOpen(true);
                      }}
                      aria-label="Edit field"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-ghost"
                      onClick={() => removeSubField(f.key)}
                      aria-label="Remove field"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {subFieldModalOpen && (
        <FieldModal
          field={editingSubField}
          existingKeys={ltFields.map((f) => f.key)}
          refTemplateOptions={refTemplateOptions}
          onCancel={() => setSubFieldModalOpen(false)}
          onSave={upsertSubField}
        />
      )}
    </Modal>
  );
}
