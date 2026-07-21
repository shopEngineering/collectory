// Reusable item create/edit form body. Renders core fields + dynamic sections
// from FieldDefs (NFA-style collapse), a photo manager, and a tag picker.
// Used by ItemFormPage (variant 'page', both /new and /edit) and by the Browse
// slide-over edit pane (variant 'pane', edit-only). See DESIGN §6.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Field } from './FieldInput';
import { TagPicker } from './TagPicker';
import { ConfirmDialog, Spinner } from './ui';
import { useToast } from './Toast';
import { api, ApiRequestError } from '../api/client';
import {
  useCreateItem,
  useUpdateItem,
  useSetCover,
  useDeletePhoto,
  useUpdatePhoto,
} from '../api/hooks';
import type {
  CollectionFull,
  FieldDef,
  FieldValue,
  FieldValues,
  Item,
  ItemCoreInput,
  ItemStatus,
  Photo,
} from '../api/types';
import { ITEM_STATUSES } from '../api/types';
import { STATUS_LABELS, centsToDollars, dollarsToCents } from '../lib/format';
import { makeThumbnail, isImageFile } from '../lib/image';
import { useBeforeUnload, useNavigationBlocker } from '../lib/hooks';

export type ItemFormVariant = 'page' | 'pane';

// ---- Core form value shape -------------------------------------------------
interface CoreState {
  name: string;
  status: ItemStatus;
  quantity: string; // kept as string for controlled number input
  minQuantity: string;
  acquiredDate: string;
  acquiredPriceCents: number | null;
  acquiredFrom: string;
  currentValueCents: number | null;
  notes: string;
}

function emptyCore(): CoreState {
  return {
    name: '',
    status: 'owned',
    quantity: '1',
    minQuantity: '',
    acquiredDate: '',
    acquiredPriceCents: null,
    acquiredFrom: '',
    currentValueCents: null,
    notes: '',
  };
}

function coreFromItem(item: Item): CoreState {
  return {
    name: item.name,
    status: item.status,
    quantity: item.quantity != null ? String(item.quantity) : '1',
    minQuantity: item.minQuantity != null ? String(item.minQuantity) : '',
    acquiredDate: item.acquiredDate ?? '',
    acquiredPriceCents: item.acquiredPriceCents,
    acquiredFrom: item.acquiredFrom ?? '',
    currentValueCents: item.currentValueCents,
    notes: item.notes ?? '',
  };
}

function isAmmoish(collection: CollectionFull): boolean {
  return collection.templateKey === 'ammunition';
}

// Group fields by section, preserving first-seen order.
function groupBySection(fields: FieldDef[]): Array<[string, FieldDef[]]> {
  const order: string[] = [];
  const map = new Map<string, FieldDef[]>();
  for (const f of fields) {
    const sec = f.section || 'Details';
    if (!map.has(sec)) {
      map.set(sec, []);
      order.push(sec);
    }
    map.get(sec)!.push(f);
  }
  return order.map((sec) => [sec, map.get(sec)!]);
}

function fieldIsEmpty(v: FieldValue): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v === false) return true;
  return false;
}

// ---- Queued (pre-upload) photo for create mode -----------------------------
interface QueuedPhoto {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
}

// ---- Main form ------------------------------------------------------------
export function ItemForm({
  collection,
  item,
  variant,
  onSaved,
  onCancel,
  registerRequestClose,
}: {
  collection: CollectionFull;
  item: Item | null;
  variant: ItemFormVariant;
  // Called after a successful save. In 'page' variant, page navigation happens here.
  onSaved: (saved: Item, opts: { addAnother: boolean }) => void;
  onCancel: () => void;
  // Lets a host (e.g. the slide-over pane) route scrim/Esc closes through the
  // same unsaved-changes guard as the Cancel button.
  registerRequestClose?: (fn: () => void) => void;
}) {
  const mode: 'create' | 'edit' = item ? 'edit' : 'create';
  const toast = useToast();
  const ammoish = isAmmoish(collection);

  const initialCore = useMemo(() => (item ? coreFromItem(item) : emptyCore()), [item]);
  const initialFields = useMemo<FieldValues>(() => ({ ...(item?.fields ?? {}) }), [item]);
  const initialTags = useMemo<string[]>(() => (item?.tags ?? []).map((t) => t.name), [item]);

  const [core, setCore] = useState<CoreState>(initialCore);
  const [fields, setFields] = useState<FieldValues>(initialFields);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [queued, setQueued] = useState<QueuedPhoto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const createItem = useCreateItem();
  const updateItem = useUpdateItem(item?.id ?? 0);
  const isPending = createItem.isPending || updateItem.isPending;

  useBeforeUnload(dirty);
  const disarmNavGuard = useNavigationBlocker(dirty);

  const markDirty = useCallback(() => setDirty(true), []);

  const setCoreField = useCallback(
    <K extends keyof CoreState>(k: K, v: CoreState[K]) => {
      setCore((prev) => ({ ...prev, [k]: v }));
      markDirty();
    },
    [markDirty],
  );

  const setDynField = useCallback(
    (key: string, v: FieldValue) => {
      setFields((prev) => ({ ...prev, [key]: v }));
      markDirty();
    },
    [markDirty],
  );

  const sections = useMemo(() => groupBySection(collection.fields), [collection.fields]);

  // Assemble the ItemCoreInput payload from local state.
  const buildPayload = useCallback((): ItemCoreInput => {
    const qty = core.quantity.trim() === '' ? 1 : Number(core.quantity);
    const payload: ItemCoreInput = {
      name: core.name.trim(),
      status: core.status,
      quantity: Number.isNaN(qty) ? 1 : qty,
      acquiredDate: core.acquiredDate || null,
      acquiredPriceCents: core.acquiredPriceCents,
      acquiredFrom: core.acquiredFrom.trim() || null,
      currentValueCents: core.currentValueCents,
      notes: core.notes,
      fields,
      tags,
    };
    if (ammoish) {
      payload.minQuantity = core.minQuantity.trim() === '' ? null : Number(core.minQuantity);
    }
    if (mode === 'create') payload.collectionId = collection.id;
    return payload;
  }, [core, fields, tags, ammoish, mode, collection.id]);

  // Upload one queued photo to a known item id (create-mode deferred upload).
  const uploadQueued = useCallback(async (itemId: number, qp: QueuedPhoto) => {
    const form = new FormData();
    form.append('photo', qp.file, qp.file.name);
    try {
      const { thumb, width, height } = await makeThumbnail(qp.file);
      form.append('thumb', thumb, 'thumb.jpg');
      form.append('width', String(width));
      form.append('height', String(height));
    } catch {
      // thumbnail generation failed — server falls back to copying original
    }
    if (qp.caption.trim()) form.append('caption', qp.caption.trim());
    await api.upload<Photo>(`/items/${itemId}/photos`, form);
  }, []);

  const uploadAllQueued = useCallback(
    async (itemId: number) => {
      for (const qp of queued) {
        try {
          await uploadQueued(itemId, qp);
        } catch (e) {
          toast.error(`Photo "${qp.file.name}" failed: ${(e as Error).message}`);
        }
      }
    },
    [queued, uploadQueued, toast],
  );

  const doSave = useCallback(
    async (opts: { addAnother: boolean }) => {
      if (!core.name.trim()) {
        toast.error('Name is required');
        return;
      }
      try {
        const payload = buildPayload();
        if (mode === 'create') {
          const created = await createItem.mutateAsync(payload);
          await uploadAllQueued(created.id);
          setDirty(false);
          if (opts.addAnother) {
            // Reset to a blank same-collection form; stay in place.
            setCore(emptyCore());
            setFields({});
            setTags([]);
            for (const qp of queued) URL.revokeObjectURL(qp.previewUrl);
            setQueued([]);
            toast.success('Saved — ready for the next one');
          } else {
            disarmNavGuard(); // saved cleanly — don't prompt on the ensuing nav
          }
          onSaved(created, opts);
        } else if (item) {
          const updated = await updateItem.mutateAsync(payload);
          setDirty(false);
          if (opts.addAnother) toast.success('Saved');
          else disarmNavGuard();
          onSaved(updated, opts);
        }
      } catch (e) {
        const msg = e instanceof ApiRequestError ? e.message : (e as Error).message;
        toast.error(msg || 'Save failed');
      }
    },
    [core.name, buildPayload, mode, createItem, updateItem, item, uploadAllQueued, queued, onSaved, toast, disarmNavGuard],
  );

  const attemptCancel = useCallback(() => {
    if (dirty) setConfirmCancel(true);
    else onCancel();
  }, [dirty, onCancel]);

  // Expose the guarded close to a host (pane scrim/Esc) via a stable callback.
  useEffect(() => {
    registerRequestClose?.(attemptCancel);
  }, [registerRequestClose, attemptCancel]);

  return (
    <div className={`item-form ${variant === 'pane' ? 'in-pane' : ''}`}>
      <div className="form-layout">
        {/* MAIN COLUMN */}
        <div>
          {/* Core section */}
          <section className="form-section">
            <div className="form-section-head">
              <span className="eyebrow">Item</span>
            </div>
            <div className="form-grid">
              <div className="field full">
                <label className="field-label" htmlFor="core-name">
                  Name<span className="field-req">*</span>
                </label>
                <input
                  id="core-name"
                  className="input"
                  type="text"
                  value={core.name}
                  required
                  placeholder="What is it?"
                  onChange={(e) => setCoreField('name', e.target.value)}
                />
              </div>

              <div className="field full">
                <span className="field-label">Status</span>
                <div className="segmented" role="group" aria-label="Status">
                  {ITEM_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={core.status === s ? 'active' : ''}
                      aria-pressed={core.status === s}
                      onClick={() => setCoreField('status', s)}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="core-qty">
                  Quantity
                </label>
                <input
                  id="core-qty"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={core.quantity}
                  onChange={(e) => setCoreField('quantity', e.target.value)}
                />
              </div>

              {ammoish && (
                <div className="field">
                  <label className="field-label" htmlFor="core-minqty">
                    Low-stock threshold
                  </label>
                  <div className="input-affix">
                    <input
                      id="core-minqty"
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="Alert below…"
                      value={core.minQuantity}
                      onChange={(e) => setCoreField('minQuantity', e.target.value)}
                    />
                    <span className="input-suffix">rds</span>
                  </div>
                  <span className="field-help">Warn when rounds on hand drop below this.</span>
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="core-acqdate">
                  Acquired
                </label>
                <input
                  id="core-acqdate"
                  className="input"
                  type="date"
                  value={core.acquiredDate}
                  onChange={(e) => setCoreField('acquiredDate', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="core-acqprice">
                  Acquired price
                </label>
                <DollarsInput
                  id="core-acqprice"
                  cents={core.acquiredPriceCents}
                  onChange={(c) => setCoreField('acquiredPriceCents', c)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="core-acqfrom">
                  Acquired from
                </label>
                <input
                  id="core-acqfrom"
                  className="input"
                  type="text"
                  placeholder="Dealer, estate, private sale…"
                  value={core.acquiredFrom}
                  onChange={(e) => setCoreField('acquiredFrom', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="core-value">
                  Current value
                </label>
                <DollarsInput
                  id="core-value"
                  cents={core.currentValueCents}
                  onChange={(c) => setCoreField('currentValueCents', c)}
                />
              </div>

              <div className="field full">
                <label className="field-label" htmlFor="core-notes">
                  Notes
                </label>
                <textarea
                  id="core-notes"
                  className="textarea"
                  value={core.notes}
                  placeholder="Anything worth remembering…"
                  onChange={(e) => setCoreField('notes', e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Dynamic sections */}
          {sections.map(([sectionName, secFields]) => (
            <DynamicSection
              key={sectionName}
              sectionName={sectionName}
              secFields={secFields}
              accent={collection.color}
              values={fields}
              onChange={setDynField}
            />
          ))}

          {/* Sticky actions */}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={attemptCancel} disabled={isPending}>
              Cancel
            </button>
            <div className="spacer" />
            {mode === 'create' && (
              <button
                type="button"
                className="btn"
                onClick={() => doSave({ addAnother: true })}
                disabled={isPending}
              >
                {isPending ? <Spinner /> : <Icon name="plus" size={16} />} Save &amp; add another
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => doSave({ addAnother: false })}
              disabled={isPending}
            >
              {isPending ? <Spinner /> : <Icon name="save" size={16} />} Save
            </button>
          </div>
        </div>

        {/* ASIDE */}
        <aside className="form-aside">
          <section className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Photos</div>
            <PhotoUploader
              mode={mode}
              itemId={item?.id ?? null}
              existing={item?.photos ?? []}
              coverPhotoId={item?.coverPhotoId ?? null}
              queued={queued}
              setQueued={setQueued}
              markDirty={markDirty}
            />
          </section>

          <section className="card" style={{ padding: 'var(--sp-4)' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Tags</div>
            <TagPicker
              tags={tags}
              onChange={(t) => {
                setTags(t);
                markDirty();
              }}
            />
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Discard changes?"
        message="You have unsaved changes. Leaving now will lose them."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setConfirmCancel(false);
          setDirty(false);
          disarmNavGuard(); // user already confirmed discard here
          onCancel();
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

// ---- Dollars input storing cents ($ prefix) --------------------------------
function DollarsInput({
  id,
  cents,
  onChange,
}: {
  id?: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
}) {
  return (
    <div className="input-affix prefix">
      <span className="input-prefix">$</span>
      <input
        id={id}
        className="input"
        type="number"
        inputMode="decimal"
        step="0.01"
        min={0}
        placeholder="0.00"
        value={cents == null ? '' : centsToDollars(cents)}
        onChange={(e) => onChange(e.target.value === '' ? null : dollarsToCents(e.target.value))}
      />
    </div>
  );
}

// ---- A dynamic section, with NFA-style collapse ----------------------------
function DynamicSection({
  sectionName,
  secFields,
  accent,
  values,
  onChange,
}: {
  sectionName: string;
  secFields: FieldDef[];
  accent: string;
  values: FieldValues;
  onChange: (key: string, v: FieldValue) => void;
}) {
  const lead = secFields[0];
  const allEmpty = secFields.every((f) => fieldIsEmpty(values[f.key]));
  const leadIsCheckbox = lead?.type === 'checkbox';
  const leadUnchecked = leadIsCheckbox && !values[lead.key];
  // Collapse when every field is empty AND the lead field is an unchecked checkbox.
  const collapsible = leadIsCheckbox && allEmpty && leadUnchecked;

  const [open, setOpen] = useState(false);

  if (collapsible && !open) {
    return (
      <div className="disclosure">
        <button type="button" className="disclosure-head" onClick={() => setOpen(true)}>
          <Icon name="chevron-right" size={15} />
          <span style={{ flex: 1, textAlign: 'left' }}>{sectionName}</span>
          <span className="eyebrow" style={{ opacity: 0.6 }}>Optional</span>
        </button>
      </div>
    );
  }

  return (
    <section className="form-section">
      <div className="form-section-head">
        <span className="spec-rule" style={{ '--sec-accent': accent } as React.CSSProperties} />
        <span className="eyebrow">{sectionName}</span>
      </div>
      <div className="form-grid">
        {secFields.map((def) => (
          <Field key={def.key} def={def} value={values[def.key] ?? null} onChange={(v) => onChange(def.key, v)} />
        ))}
      </div>
    </section>
  );
}

// ---- Photo uploader --------------------------------------------------------
function PhotoUploader({
  mode,
  itemId,
  existing,
  coverPhotoId,
  queued,
  setQueued,
  markDirty,
}: {
  mode: 'create' | 'edit';
  itemId: number | null;
  existing: Photo[];
  coverPhotoId: number | null;
  queued: QueuedPhoto[];
  setQueued: React.Dispatch<React.SetStateAction<QueuedPhoto[]>>;
  markDirty: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const setCover = useSetCover(itemId ?? 0);
  const deletePhoto = useDeletePhoto(itemId ?? 0);
  const updatePhoto = useUpdatePhoto(itemId ?? 0);

  // Queue a file (create mode) or upload immediately (edit mode).
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(isImageFile);
      if (mode === 'create' || itemId == null) {
        const additions: QueuedPhoto[] = list.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          caption: '',
        }));
        if (additions.length) {
          setQueued((prev) => [...prev, ...additions]);
          markDirty();
        }
        return;
      }
      // edit mode: upload each immediately
      for (const file of list) {
        const key = `${file.name}-${Date.now()}`;
        try {
          const form = new FormData();
          form.append('photo', file, file.name);
          try {
            const { thumb, width, height } = await makeThumbnail(file);
            form.append('thumb', thumb, 'thumb.jpg');
            form.append('width', String(width));
            form.append('height', String(height));
          } catch {
            /* server falls back to copying original */
          }
          await api.upload<Photo>(`/items/${itemId}/photos`, form, (frac) =>
            setProgress((p) => ({ ...p, [key]: frac })),
          );
        } catch (e) {
          toast.error(`Upload failed: ${(e as Error).message}`);
        } finally {
          setProgress((p) => {
            const { [key]: _drop, ...rest } = p;
            return rest;
          });
        }
      }
    },
    [mode, itemId, setQueued, markDirty, toast],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  };

  const removeQueued = (id: string) => {
    setQueued((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  };

  const activeUploads = Object.entries(progress);

  return (
    <div>
      <div
        className={`uploader ${drag ? 'drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <Icon name="upload" size={22} />
        <div style={{ marginTop: 6, fontSize: 13 }}>Drop photos or tap to add</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 2 }}>
          {mode === 'create' ? 'Uploaded after you save' : 'Uploads immediately'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {activeUploads.length > 0 && (
        <div style={{ marginTop: 'var(--sp-3)', display: 'grid', gap: 6 }}>
          {activeUploads.map(([key, frac]) => (
            <div key={key} className="progress">
              <div className="progress-bar" style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
          ))}
        </div>
      )}

      {/* Queued (create-mode, not-yet-uploaded) previews */}
      {queued.length > 0 && (
        <div className="upload-grid">
          {queued.map((qp) => (
            <div key={qp.id} className="upload-tile">
              <img src={qp.previewUrl} alt={qp.file.name} />
              <div className="tile-actions">
                <button
                  type="button"
                  className="btn-icon btn-ghost"
                  aria-label="Remove"
                  onClick={() => removeQueued(qp.id)}
                  style={{ color: '#fff' }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Existing (edit-mode) photos with cover/delete/caption */}
      {existing.length > 0 && (
        <div className="upload-grid">
          {existing.map((photo) => (
            <ExistingPhotoTile
              key={photo.id}
              photo={photo}
              isCover={coverPhotoId === photo.id}
              onSetCover={() => setCover.mutate(photo.id)}
              onDelete={() => deletePhoto.mutate(photo.id)}
              onCaption={(caption) => updatePhoto.mutate({ id: photo.id, body: { caption } })}
              onMove={(dir) =>
                updatePhoto.mutate({ id: photo.id, body: { sortOrder: photo.sortOrder + (dir === 'up' ? -1 : 1) } })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExistingPhotoTile({
  photo,
  isCover,
  onSetCover,
  onDelete,
  onCaption,
  onMove,
}: {
  photo: Photo;
  isCover: boolean;
  onSetCover: () => void;
  onDelete: () => void;
  onCaption: (caption: string) => void;
  onMove: (dir: 'up' | 'down') => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  return (
    <div className="upload-tile" style={{ aspectRatio: 'auto' }}>
      <div style={{ position: 'relative', aspectRatio: '1' }}>
        <img src={photo.thumbUrl} alt={photo.caption || 'Photo'} />
        {isCover && <span className="tile-cover">Cover</span>}
        <div className="tile-actions">
          {!isCover && (
            <button type="button" className="btn-icon btn-ghost" aria-label="Set as cover" onClick={onSetCover} style={{ color: '#fff' }}>
              <Icon name="check" size={16} />
            </button>
          )}
          <button type="button" className="btn-icon btn-ghost" aria-label="Move up" onClick={() => onMove('up')} style={{ color: '#fff' }}>
            <Icon name="chevron-up" size={16} />
          </button>
          <button type="button" className="btn-icon btn-ghost" aria-label="Move down" onClick={() => onMove('down')} style={{ color: '#fff' }}>
            <Icon name="chevron-down" size={16} />
          </button>
          <button type="button" className="btn-icon btn-ghost" aria-label="Delete photo" onClick={onDelete} style={{ color: '#fff' }}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
      <input
        className="input"
        style={{ fontSize: 11.5, marginTop: 4, height: 28 }}
        value={caption}
        placeholder="Caption…"
        onChange={(e) => setCaption(e.target.value)}
        onBlur={() => caption !== (photo.caption ?? '') && onCaption(caption)}
      />
    </div>
  );
}
