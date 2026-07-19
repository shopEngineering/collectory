// Item detail: ambient banner + computed-stat chips, photo gallery + lightbox,
// spec sheet grouped by section, and tabs for Activity / Provenance / Value / Files.
// Everything renders dynamically from the collection's field & log-type defs. DESIGN §6.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Field } from '../components/FieldInput';
import { Lightbox } from '../components/Lightbox';
import { CollectionDot, StatusBadge } from '../components/bits';
import { ConfirmDialog, LoadingBlock, ErrorBlock, Menu, Spinner } from '../components/ui';
import type { MenuItemDef } from '../components/ui';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import {
  qk,
  useAttachments,
  useCollection,
  useCreateLog,
  useCreateProvenance,
  useCreateValuation,
  useDeleteAttachment,
  useDeleteItem,
  useDeleteLog,
  useDeleteProvenance,
  useDeleteValuation,
  useDuplicateItem,
  useItem,
  useLogs,
  useProvenance,
  useRelated,
  useUpdateLog,
  useUpdateProvenance,
  useValuations,
} from '../api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Attachment,
  CollectionFull,
  FieldDef,
  FieldValue,
  FieldValues,
  Item,
  ItemChoice,
  LogEntry,
  LogTypeDef,
  Photo,
  Provenance,
  RelatedGroup,
  Valuation,
  ValuationSource,
} from '../api/types';
import {
  formatDate,
  formatFileSize,
  formatMoney,
  formatNumber,
  todayISO,
  dollarsToCents,
  centsToDollars,
} from '../lib/format';
import { isImageFile } from '../lib/image';
import { uploadPhotoFile } from '../lib/photoUpload';

// A note log type is always valid even if the collection didn't define one.
const NOTE_LOGTYPE: LogTypeDef = { key: 'note', label: 'Note', icon: 'note', color: '#6b7280', fields: [] };

function logTypeFor(collection: CollectionFull, key: string): LogTypeDef {
  return collection.logTypes.find((lt) => lt.key === key) ?? { ...NOTE_LOGTYPE, key, label: key };
}

// Resolve the cover photo: coverPhotoId if present, else first photo.
function coverPhoto(item: Item): Photo | null {
  if (item.coverPhotoId != null) {
    const found = item.photos.find((p) => p.id === item.coverPhotoId);
    if (found) return found;
  }
  return item.photos[0] ?? null;
}

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

function isEmptyValue(v: FieldValue): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function ItemDetailPage() {
  const params = useParams();
  const id = Number(params.itemId);
  const navigate = useNavigate();
  const toast = useToast();

  const { data: item, isLoading, isError, error, refetch } = useItem(id);
  const { data: collection } = useCollection(item?.collectionId);

  const duplicate = useDuplicateItem();
  const deleteItem = useDeleteItem();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (isLoading) return <div className="page"><LoadingBlock label="Loading item…" /></div>;
  if (isError)
    return (
      <div className="page">
        <ErrorBlock message={(error as Error)?.message ?? 'Could not load item'} onRetry={() => refetch()} />
      </div>
    );
  if (!item) return <div className="page"><ErrorBlock message="Item not found" /></div>;
  if (!collection) return <div className="page"><LoadingBlock /></div>;

  const cover = coverPhoto(item);
  const cs = item.computedStats;

  const menuItems: MenuItemDef[] = [
    {
      label: 'Duplicate',
      icon: 'duplicate',
      onClick: async () => {
        try {
          const copy = await duplicate.mutateAsync(item.id);
          navigate(`/items/${copy.id}`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    },
    { label: 'Print', icon: 'print', onClick: () => window.print() },
    { divider: true, label: '', onClick: () => {} },
    { label: 'Move to trash', icon: 'trash', danger: true, onClick: () => setConfirmDelete(true) },
  ];

  return (
    <div className="page">
      <Link to={`/c/${item.collectionId}`} className="back-link no-print">
        <Icon name="chevron-left" size={16} /> Back to {collection.name}
      </Link>

      {/* Ambient banner */}
      <div className={`item-banner ${cover ? '' : 'no-photo'}`}>
        {cover && (
          <>
            <div className="banner-bg" style={{ backgroundImage: `url("${cover.url}")` }} aria-hidden />
            <div className="banner-scrim" aria-hidden />
          </>
        )}
        <div className="banner-content">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <Link to={`/c/${item.collectionId}`} className="banner-crumb">
                <CollectionDot color={collection.color} />
                {collection.name}
              </Link>
              <h1 className="banner-name serif">{item.name}</h1>
            </div>
            <div className="row no-print" style={{ gap: 8, flex: 'none' }}>
              <button
                type="button"
                className="btn"
                onClick={() => navigate(`/items/${item.id}/edit`)}
              >
                <Icon name="edit" size={15} /> Edit
              </button>
              <Menu
                align="right"
                items={menuItems}
                trigger={({ toggle, ref }) => (
                  <button
                    ref={(el) => ref(el)}
                    className="btn-icon btn-ghost"
                    aria-label="Item actions"
                    onClick={toggle}
                  >
                    <Icon name="kebab" size={20} />
                  </button>
                )}
              />
            </div>
          </div>
          <div className="banner-chips">
            <StatusBadge status={item.status} />
            {cs.roundsFired != null && (
              <span className="stat-chip"><b>{formatNumber(cs.roundsFired)}</b> rounds fired</span>
            )}
            {cs.lastCleaned && (
              <span className="stat-chip">Cleaned <b>{formatDate(cs.lastCleaned)}</b></span>
            )}
            {cs.roundsSinceCleaned != null && (
              <span className="stat-chip"><b>{formatNumber(cs.roundsSinceCleaned)}</b> since cleaned</span>
            )}
            {cs.lastActivity && (
              <span className="stat-chip">Last activity <b>{formatDate(cs.lastActivity)}</b></span>
            )}
          </div>
        </div>
      </div>

      <div className="detail-layout">
        {/* LEFT */}
        <div>
          <div className="gallery" style={{ marginBottom: 'var(--sp-5)' }}>
            {item.photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                className="gallery-thumb"
                onClick={() => setLightboxIndex(i)}
                aria-label={photo.caption || `Photo ${i + 1}`}
              >
                <img src={photo.thumbUrl} alt={photo.caption || `Photo ${i + 1}`} />
                {item.coverPhotoId === photo.id && <span className="cover-badge">Cover</span>}
              </button>
            ))}
            <GalleryAddTile itemId={item.id} />
          </div>

          <TabbedPanels item={item} collection={collection} />
        </div>

        {/* RIGHT: spec sheet + related */}
        <aside>
          <SpecSheet item={item} collection={collection} />
          <RelatedCard itemId={item.id} />
        </aside>
      </div>

      {lightboxIndex != null && (
        <Lightbox
          photos={item.photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Move to trash?"
        message={`"${item.name}" will be moved to the trash. You can restore it later.`}
        confirmLabel="Move to trash"
        danger
        onConfirm={async () => {
          setConfirmDelete(false);
          try {
            await deleteItem.mutateAsync({ id: item.id });
            navigate(`/c/${item.collectionId}`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// ---- Gallery add tile ------------------------------------------------------
// Always-visible "add" square at the end of the thumbnail strip: uploads
// straight to the item (no edit mode), then refreshes item + list queries.
function GalleryAddTile({ itemId }: { itemId: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList) => {
    const list = Array.from(files).filter(isImageFile);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        try {
          await uploadPhotoFile(`/items/${itemId}/photos`, file);
        } catch (e) {
          toast.error(`Upload failed: ${(e as Error).message}`);
        }
      }
      qc.invalidateQueries({ queryKey: qk.item(itemId) });
      qc.invalidateQueries({ queryKey: ['items'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="gallery-add no-print" title="Add photos">
      {busy ? <Spinner /> : <Icon name="camera" size={22} />}
      <span>{busy ? 'Uploading…' : 'Add photo'}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// ---- Tabs ------------------------------------------------------------------
type TabKey = 'activity' | 'provenance' | 'value' | 'files';

function TabbedPanels({ item, collection }: { item: Item; collection: CollectionFull }) {
  const [tab, setTab] = useState<TabKey>('activity');
  const { data: logs } = useLogs(item.id);
  const { data: provenance } = useProvenance(item.id);
  const { data: valuations } = useValuations(item.id);
  const { data: attachments } = useAttachments(item.id);

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: 'activity', label: 'Activity', count: logs?.length ?? 0 },
    { key: 'provenance', label: 'Provenance', count: provenance?.length ?? 0 },
    { key: 'value', label: 'Value', count: valuations?.length ?? 0 },
    { key: 'files', label: 'Files', count: attachments?.length ?? 0 },
  ];

  return (
    <div>
      <div className="tabs no-print" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count > 0 && <span className="count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--sp-4)' }}>
        {tab === 'activity' && <ActivityTab item={item} collection={collection} logs={logs ?? []} />}
        {tab === 'provenance' && <ProvenanceTab item={item} entries={provenance ?? []} />}
        {tab === 'value' && <ValueTab item={item} valuations={valuations ?? []} />}
        {tab === 'files' && <FilesTab item={item} attachments={attachments ?? []} />}
      </div>
    </div>
  );
}

// ---- Activity tab ----------------------------------------------------------
function ActivityTab({
  item,
  collection,
  logs,
}: {
  item: Item;
  collection: CollectionFull;
  logs: LogEntry[];
}) {
  return (
    <div>
      <LogAddForm item={item} collection={collection} />
      {logs.length === 0 ? (
        <p style={{ color: 'var(--ink-4)', fontSize: 13, padding: '12px 0' }}>No activity logged yet.</p>
      ) : (
        <LogTimeline item={item} collection={collection} logs={logs} />
      )}
    </div>
  );
}

// A photo picked for the log form before the log exists (uploaded on submit).
interface QueuedLogPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

function LogAddForm({ item, collection }: { item: Item; collection: CollectionFull }) {
  const toast = useToast();
  const qc = useQueryClient();
  const createLog = useCreateLog(item.id);
  const logTypes = collection.logTypes.length ? collection.logTypes : [NOTE_LOGTYPE];

  const [typeKey, setTypeKey] = useState<string>(logTypes[0]?.key ?? 'note');
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [data, setData] = useState<FieldValues>({});
  const [queuedPhotos, setQueuedPhotos] = useState<QueuedLogPhoto[]>([]);
  const [photoDrag, setPhotoDrag] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const activeType = logTypeFor(collection, typeKey);
  const typeFields = activeType.fields ?? [];
  const pending = createLog.isPending || uploadingPhotos;
  // The gun's associated ammo, pinned first in the range-log ammo picker (§5.2).
  const associatedIds = useMemo(() => {
    const raw = item.fields.associated_ammo;
    return Array.isArray(raw) ? raw.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [];
  }, [item.fields.associated_ammo]);

  const queuePhotos = (files: FileList | File[]) => {
    const additions: QueuedLogPhoto[] = Array.from(files)
      .filter(isImageFile)
      .map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    if (additions.length) setQueuedPhotos((prev) => [...prev, ...additions]);
  };

  const removeQueuedPhoto = (id: string) => {
    setQueuedPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const reset = () => {
    setTitle('');
    setNotes('');
    setData({});
    setDate(todayISO());
    setQueuedPhotos((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  };

  const submit = async () => {
    try {
      const cleanData: Record<string, FieldValue> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && v !== undefined && v !== '') cleanData[k] = v;
      }
      const created = await createLog.mutateAsync({
        logTypeKey: typeKey,
        date,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        data: cleanData,
      });
      // Log exists — now attach any queued photos, then refresh the timeline.
      if (queuedPhotos.length) {
        setUploadingPhotos(true);
        try {
          for (const qp of queuedPhotos) {
            try {
              await uploadPhotoFile(`/logs/${created.id}/photos`, qp.file);
            } catch (e) {
              toast.error(`Photo "${qp.file.name}" failed: ${(e as Error).message}`);
            }
          }
        } finally {
          setUploadingPhotos(false);
        }
        qc.invalidateQueries({ queryKey: qk.logs(item.id) });
      }
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="card no-print" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
      <div className="segmented" role="group" aria-label="Log type" style={{ marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {logTypes.map((lt) => (
          <button
            key={lt.key}
            type="button"
            className={typeKey === lt.key ? 'active' : ''}
            aria-pressed={typeKey === lt.key}
            onClick={() => {
              setTypeKey(lt.key);
              setData({});
            }}
            style={{ '--tl-color': lt.color } as React.CSSProperties}
          >
            {lt.icon && <Icon name={lt.icon} size={14} />}
            {lt.label}
          </button>
        ))}
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="log-date">Date</label>
          <input id="log-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="log-title">Title</label>
          <input id="log-title" className="input" type="text" placeholder="Optional" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {typeFields.map((def) => (
          <Field
            key={def.key}
            def={def}
            value={data[def.key] ?? null}
            onChange={(v) => setData((d) => ({ ...d, [def.key]: v }))}
            associatedIds={def.type === 'ammo_ref' ? associatedIds : undefined}
          />
        ))}

        <div className="field full">
          <label className="field-label" htmlFor="log-notes">Notes</label>
          <textarea id="log-notes" className="textarea" value={notes} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Photo attach: queue files now, upload to the log after it's created. */}
      <div
        className={`log-photo-add ${photoDrag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setPhotoDrag(true);
        }}
        onDragLeave={() => setPhotoDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setPhotoDrag(false);
          if (e.dataTransfer.files?.length) queuePhotos(e.dataTransfer.files);
        }}
      >
        <label className="log-photo-btn">
          <Icon name="camera" size={15} /> Add photos
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) queuePhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {queuedPhotos.length === 0 ? (
          <span className="log-photo-hint">Drop images here — attached when you save</span>
        ) : (
          <div className="log-photo-queue">
            {queuedPhotos.map((qp) => (
              <span key={qp.id} className="log-photo-thumb">
                <img src={qp.previewUrl} alt={qp.file.name} />
                <button
                  type="button"
                  aria-label={`Remove ${qp.file.name}`}
                  onClick={() => removeQueuedPhoto(qp.id)}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending ? <Spinner /> : <Icon name="plus" size={16} />}{' '}
          {uploadingPhotos ? 'Attaching photos…' : `Add ${activeType.label.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

function LogTimeline({
  item,
  collection,
  logs,
}: {
  item: Item;
  collection: CollectionFull;
  logs: LogEntry[];
}) {
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);
  return (
    <div className="timeline">
      {logs.map((log) => (
        <LogEntryRow
          key={log.id}
          item={item}
          collection={collection}
          log={log}
          onOpenPhotos={(photos, index) => setLightbox({ photos, index })}
        />
      ))}
      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
        />
      )}
    </div>
  );
}

// Inline reference to another item (ammo used, source firearm): resolves the name, links through.
function ItemNameRef({ id }: { id: number }) {
  const { data } = useItem(id);
  return (
    <Link to={`/items/${id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
      {data?.name ?? `#${id}`}
    </Link>
  );
}

// Format one log-data value using its field def (currency -> money, append units).
function formatLogValue(def: FieldDef | undefined, v: FieldValue): string {
  if (v === null || v === undefined || v === '') return '';
  if (def?.type === 'currency') return formatMoney(typeof v === 'number' ? v : Number(v));
  if (def?.type === 'date') return formatDate(String(v));
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const base = String(v);
  return def?.unit ? `${base} ${def.unit}` : base;
}

function LogEntryRow({
  item,
  collection,
  log,
  onOpenPhotos,
}: {
  item: Item;
  collection: CollectionFull;
  log: LogEntry;
  onOpenPhotos: (photos: Photo[], index: number) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const type = logTypeFor(collection, log.logTypeKey);
  const updateLog = useUpdateLog(item.id);
  const deleteLog = useDeleteLog(item.id);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [draftNotes, setDraftNotes] = useState(log.notes);
  const [draftTitle, setDraftTitle] = useState(log.title);
  const [draftDate, setDraftDate] = useState(log.date);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);

  const addPhotos = async (files: FileList) => {
    const list = Array.from(files).filter(isImageFile);
    if (!list.length) return;
    setAddingPhotos(true);
    try {
      for (const file of list) {
        try {
          await uploadPhotoFile(`/logs/${log.id}/photos`, file);
        } catch (e) {
          toast.error(`Upload failed: ${(e as Error).message}`);
        }
      }
      qc.invalidateQueries({ queryKey: qk.logs(item.id) });
    } finally {
      setAddingPhotos(false);
    }
  };

  const fieldDefs = type.fields ?? [];
  const defByKey = useMemo(() => new Map(fieldDefs.map((f) => [f.key, f])), [fieldDefs]);
  const dataEntries = Object.entries(log.data).filter(([, v]) => v !== null && v !== undefined && v !== '');

  const saveEdit = async () => {
    try {
      await updateLog.mutateAsync({ id: log.id, body: { title: draftTitle, notes: draftNotes, date: draftDate } });
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const menuItems: MenuItemDef[] = [
    { label: 'Edit', icon: 'edit', onClick: () => setEditing(true) },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) },
  ];

  return (
    <div className="tl-entry">
      <div className="tl-node" style={{ '--tl-color': type.color } as React.CSSProperties}>
        <Icon name={type.icon ?? 'note'} size={13} />
      </div>
      <div className="tl-card">
        <div className="tl-head">
          <span className="tl-type" style={{ '--tl-color': type.color } as React.CSSProperties}>
            {type.label}
            {log.title ? ` · ${log.title}` : ''}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="tl-date">{formatDate(log.date)}</span>
            <button
              type="button"
              className="btn-icon btn-ghost no-print"
              aria-label="Add photo"
              title="Add photo"
              disabled={addingPhotos}
              onClick={() => photoInputRef.current?.click()}
              style={{ width: 24, height: 24 }}
            >
              {addingPhotos ? <Spinner /> : <Icon name="camera" size={15} />}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void addPhotos(e.target.files);
                e.target.value = '';
              }}
            />
            <Menu
              align="right"
              items={menuItems}
              trigger={({ toggle, ref }) => (
                <button
                  ref={(el) => ref(el)}
                  className="btn-icon btn-ghost no-print"
                  aria-label="Log actions"
                  onClick={toggle}
                  style={{ width: 24, height: 24 }}
                >
                  <Icon name="kebab" size={15} />
                </button>
              )}
            />
          </span>
        </div>

        {editing ? (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field">
              <label className="field-label">Date</label>
              <input className="input" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Title</label>
              <input className="input" type="text" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div className="field full">
              <label className="field-label">Notes</label>
              <textarea className="textarea" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
            </div>
            <div className="field full row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={updateLog.isPending}>Save</button>
            </div>
          </div>
        ) : (
          <>
            {log.notes && <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{log.notes}</p>}
            {dataEntries.length > 0 && (
              <div className="tl-data">
                {dataEntries.map(([key, v]) => {
                  const def = defByKey.get(key);
                  if (def?.type === 'ammo_ref' || key === 'source_item_id') {
                    return (
                      <span key={key}>
                        <b>{def?.type === 'ammo_ref' ? def.label : 'Used with'}</b>{' '}
                        <ItemNameRef id={Number(v)} />
                      </span>
                    );
                  }
                  const formatted = formatLogValue(def, v);
                  if (!formatted) return null;
                  return (
                    <span key={key}>
                      <b>{def?.label ?? key}</b> {formatted}
                    </span>
                  );
                })}
              </div>
            )}
            {log.photos.length > 0 && (
              <div className="tl-photos">
                {log.photos.map((photo, i) => (
                  <img
                    key={photo.id}
                    src={photo.thumbUrl}
                    alt={photo.caption || 'Log photo'}
                    onClick={() => onOpenPhotos(log.photos, i)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel}
        title="Delete log entry?"
        message="This cannot be undone. Any linked ammo usage will be reversed."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          setConfirmDel(false);
          try {
            await deleteLog.mutateAsync(log.id);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

// ---- Provenance tab --------------------------------------------------------
function ProvenanceTab({ item, entries }: { item: Item; entries: Provenance[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {entries.length === 0 && !adding && (
        <p style={{ color: 'var(--ink-4)', fontSize: 13, padding: '12px 0' }}>No ownership history recorded yet.</p>
      )}
      <div>
        {entries.map((entry, i) => (
          <ProvenanceRow key={entry.id} item={item} entry={entry} isLast={i === entries.length - 1} />
        ))}
      </div>
      {adding ? (
        <ProvenanceForm item={item} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn no-print" style={{ marginTop: 'var(--sp-3)' }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add owner
        </button>
      )}
    </div>
  );
}

function ProvenanceRow({ item, entry, isLast }: { item: Item; entry: Provenance; isLast: boolean }) {
  const toast = useToast();
  const del = useDeleteProvenance(item.id);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  if (editing) {
    return <ProvenanceForm item={item} entry={entry} onDone={() => setEditing(false)} />;
  }

  const range = [entry.fromDate, entry.toDate].filter(Boolean).map((d) => formatDate(d)).join(' – ');

  return (
    <div className="prov-entry">
      <div className="prov-marker">
        <div className="prov-dot" />
        {!isLast && <div className="prov-line" />}
      </div>
      <div className="tl-card" style={{ flex: 1, marginBottom: 'var(--sp-3)' }}>
        <div className="tl-head">
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{entry.ownerName}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {range && <span className="tl-date">{range}</span>}
            <Menu
              align="right"
              items={[
                { label: 'Edit', icon: 'edit', onClick: () => setEditing(true) },
                { label: 'Delete', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) },
              ]}
              trigger={({ toggle, ref }) => (
                <button ref={(el) => ref(el)} className="btn-icon btn-ghost no-print" aria-label="Owner actions" onClick={toggle} style={{ width: 24, height: 24 }}>
                  <Icon name="kebab" size={15} />
                </button>
              )}
            />
          </span>
        </div>
        {entry.howAcquired && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>{entry.howAcquired}</div>}
        {entry.notes && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.5 }}>{entry.notes}</p>}
      </div>

      <ConfirmDialog
        open={confirmDel}
        title="Delete owner?"
        message={`Remove "${entry.ownerName}" from the ownership chain?`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          setConfirmDel(false);
          try {
            await del.mutateAsync(entry.id);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

function ProvenanceForm({ item, entry, onDone }: { item: Item; entry?: Provenance; onDone: () => void }) {
  const toast = useToast();
  const create = useCreateProvenance(item.id);
  const update = useUpdateProvenance(item.id);
  const [ownerName, setOwnerName] = useState(entry?.ownerName ?? '');
  const [fromDate, setFromDate] = useState(entry?.fromDate ?? '');
  const [toDate, setToDate] = useState(entry?.toDate ?? '');
  const [howAcquired, setHowAcquired] = useState(entry?.howAcquired ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    if (!ownerName.trim()) {
      toast.error('Owner name is required');
      return;
    }
    const body = {
      ownerName: ownerName.trim(),
      fromDate: fromDate || null,
      toDate: toDate || null,
      howAcquired: howAcquired.trim(),
      notes: notes.trim(),
    };
    try {
      if (entry) await update.mutateAsync({ id: entry.id, body });
      else await create.mutateAsync(body);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
      <div className="form-grid">
        <div className="field full">
          <label className="field-label">Owner name</label>
          <input className="input" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Who owned it?" />
        </div>
        <div className="field">
          <label className="field-label">From</label>
          <input className="input" type="text" value={fromDate} placeholder="1968, 1968-05, or full date" onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">To</label>
          <input className="input" type="text" value={toDate} placeholder="blank if to present" onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="field full">
          <label className="field-label">How acquired</label>
          <input className="input" type="text" value={howAcquired} placeholder="Purchase, inheritance, gift, trade…" onChange={(e) => setHowAcquired(e.target.value)} />
        </div>
        <div className="field full">
          <label className="field-label">Notes</label>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 'var(--sp-3)' }}>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>Save</button>
      </div>
    </div>
  );
}

// ---- Value tab -------------------------------------------------------------
function ValueTab({ item, valuations }: { item: Item; valuations: Valuation[] }) {
  const toast = useToast();
  const create = useCreateValuation(item.id);
  const del = useDeleteValuation(item.id);

  const [date, setDate] = useState(todayISO());
  const [valueCents, setValueCents] = useState<number | null>(null);
  const [source, setSource] = useState<ValuationSource>('estimate');
  const [notes, setNotes] = useState('');

  const current = item.currentValueCents;
  const acquired = item.acquiredPriceCents;
  const delta = current != null && acquired != null ? current - acquired : null;

  // Chronological points for the sparkline.
  const points = useMemo(
    () => [...valuations].sort((a, b) => a.date.localeCompare(b.date)).map((v) => ({ date: v.date, value: v.valueCents })),
    [valuations],
  );

  const submit = async () => {
    if (valueCents == null) {
      toast.error('Enter a value');
      return;
    }
    try {
      await create.mutateAsync({ date, valueCents, source, notes: notes.trim() || undefined });
      setValueCents(null);
      setNotes('');
      setDate(todayISO());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <div className="card" style={{ padding: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
        <div className="row" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow">Current value</div>
            <div className="serif tnum" style={{ fontSize: 26, color: 'var(--brass)' }}>{formatMoney(current)}</div>
          </div>
          {delta != null && (
            <span className={`delta-badge ${delta >= 0 ? 'delta-up' : 'delta-down'}`}>
              <Icon name={delta >= 0 ? 'arrow-up' : 'arrow-down'} size={13} />
              {formatMoney(Math.abs(delta))}
            </span>
          )}
        </div>
        {points.length > 1 && <Sparkline points={points.map((p) => p.value)} />}
      </div>

      {points.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 'var(--sp-4)' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th className="num">Value</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {[...valuations].sort((a, b) => b.date.localeCompare(a.date)).map((v) => (
                <tr key={v.id}>
                  <td>{formatDate(v.date)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{v.source}</td>
                  <td className="num cell-money">{formatMoney(v.valueCents)}</td>
                  <td className="no-print">
                    <button
                      type="button"
                      className="btn-icon btn-ghost"
                      aria-label="Delete valuation"
                      onClick={async () => {
                        try {
                          await del.mutateAsync(v.id);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card no-print" style={{ padding: 'var(--sp-4)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Add valuation</div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Value</label>
            <div className="input-affix prefix">
              <span className="input-prefix">$</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                placeholder="0.00"
                value={valueCents == null ? '' : centsToDollars(valueCents)}
                onChange={(e) => setValueCents(e.target.value === '' ? null : dollarsToCents(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Source</label>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value as ValuationSource)}>
              <option value="purchase">Purchase</option>
              <option value="appraisal">Appraisal</option>
              <option value="market">Market</option>
              <option value="estimate">Estimate</option>
              <option value="sale">Sale</option>
            </select>
          </div>
          <div className="field full">
            <label className="field-label">Notes</label>
            <input className="input" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Icon name="plus" size={16} />} Add valuation
          </button>
        </div>
      </div>
    </div>
  );
}

// Hand-rolled SVG sparkline over a series of cent values.
function Sparkline({ points }: { points: number[] }) {
  const W = 300;
  const H = 60;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (H - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${H - pad} L${coords[0][0].toFixed(1)},${H - pad} Z`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Value history">
      <path d={area} fill="var(--brass)" opacity={0.1} />
      <path d={line} fill="none" stroke="var(--brass)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.8} fill="var(--brass)" />
      ))}
    </svg>
  );
}

// ---- Files tab -------------------------------------------------------------
function FilesTab({ item, attachments }: { item: Item; attachments: Attachment[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const del = useDeleteAttachment(item.id);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmDel, setConfirmDel] = useState<Attachment | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      await api.upload<Attachment>(`/items/${item.id}/attachments`, form, setProgress);
      qc.invalidateQueries({ queryKey: qk.attachments(item.id) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div>
      {attachments.length === 0 && (
        <p style={{ color: 'var(--ink-4)', fontSize: 13, padding: '12px 0' }}>No files attached yet.</p>
      )}
      {attachments.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 'var(--sp-4)' }}>
          {attachments.map((att) => (
            <div key={att.id} className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="file" size={20} />
              <a href={att.url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)' }}>
                {att.originalName}
              </a>
              <span className="tnum" style={{ fontSize: 12, color: 'var(--ink-4)' }}>{formatFileSize(att.sizeBytes)}</span>
              <button type="button" className="btn-icon btn-ghost no-print" aria-label="Delete file" onClick={() => setConfirmDel(att)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="no-print">
        <label className="btn" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={16} /> {uploading ? 'Uploading…' : 'Add file'}
          <input
            type="file"
            hidden
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </label>
        {uploading && (
          <div className="progress" style={{ marginTop: 8 }}>
            <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel != null}
        title="Delete file?"
        message={confirmDel ? `Remove "${confirmDel.originalName}"?` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const target = confirmDel;
          setConfirmDel(null);
          if (!target) return;
          try {
            await del.mutateAsync(target.id);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ---- Spec sheet (right column) ---------------------------------------------
function SpecSheet({ item, collection }: { item: Item; collection: CollectionFull }) {
  const sections = useMemo(() => groupBySection(collection.fields), [collection.fields]);

  // Acquisition meta block from core fields.
  const acqRows: Array<[string, React.ReactNode]> = [];
  if (item.acquiredDate) acqRows.push(['Acquired', formatDate(item.acquiredDate)]);
  if (item.acquiredPriceCents != null)
    acqRows.push(['Acquired price', <span className="spec-val-money">{formatMoney(item.acquiredPriceCents)}</span>]);
  if (item.acquiredFrom) acqRows.push(['Acquired from', item.acquiredFrom]);
  if (item.currentValueCents != null)
    acqRows.push(['Current value', <span className="spec-val-money">{formatMoney(item.currentValueCents)}</span>]);
  acqRows.push(['Quantity', formatNumber(item.quantity)]);

  return (
    <div>
      {acqRows.length > 0 && (
        <section className="spec-section">
          <div className="spec-head">
            <span className="spec-rule" style={{ '--sec-accent': collection.color } as React.CSSProperties} />
            <span className="eyebrow">Acquisition</span>
          </div>
          <dl className="deflist">
            {acqRows.map(([label, value], i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {sections.map(([sectionName, secFields]) => {
        const rows = secFields
          .map((def) => ({ def, value: item.fields[def.key] ?? null }))
          .filter((r) => !isEmptyValue(r.value) && !(r.def.type === 'checkbox' && r.value === false));
        if (rows.length === 0) return null;
        return (
          <section key={sectionName} className="spec-section">
            <div className="spec-head">
              <span className="spec-rule" style={{ '--sec-accent': collection.color } as React.CSSProperties} />
              <span className="eyebrow">{sectionName}</span>
            </div>
            <dl className="deflist">
              {rows.map(({ def, value }) => (
                <div key={def.key} style={{ display: 'contents' }}>
                  <dt>{def.label}</dt>
                  <dd>{renderSpecValue(def, value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      {item.notes && (
        <section className="spec-section">
          <div className="spec-head">
            <span className="spec-rule" style={{ '--sec-accent': collection.color } as React.CSSProperties} />
            <span className="eyebrow">Notes</span>
          </div>
          <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.notes}</p>
        </section>
      )}
    </div>
  );
}

// ---- Related card (right column) ------------------------------------------
// A linked item chip: thumbnail (or icon) + name, links to the item.
function RefChipLink({ choice }: { choice: ItemChoice }) {
  return (
    <Link to={`/items/${choice.id}`} className="ref-chip ref-chip-link">
      {choice.thumbUrl ? (
        <img className="ref-chip-thumb" src={choice.thumbUrl} alt="" />
      ) : (
        <Icon name="box" size={13} />
      )}
      <span className="ref-chip-name">{choice.name}</span>
      {choice.hint && <span className="ref-chip-hint">{choice.hint}</span>}
    </Link>
  );
}

function RelatedGroupBlock({ group }: { group: RelatedGroup }) {
  return (
    <div className="related-group">
      <div className="related-group-label">{group.fieldLabel}</div>
      <div className="ref-chips">
        {group.items.map((c) => (
          <RefChipLink key={c.id} choice={c} />
        ))}
      </div>
    </div>
  );
}

function RelatedCard({ itemId }: { itemId: number }) {
  const { data } = useRelated(itemId);
  const references = data?.references ?? [];
  const referencedBy = data?.referencedBy ?? [];
  // Skip rendering entirely when both are empty (per §5.2).
  if (references.length === 0 && referencedBy.length === 0) return null;

  return (
    <section className="spec-section related-card">
      <div className="spec-head">
        <span className="spec-rule" style={{ '--sec-accent': 'var(--brass)' } as React.CSSProperties} />
        <span className="eyebrow">Related</span>
      </div>
      {references.map((g) => (
        <RelatedGroupBlock key={`ref-${g.fieldKey}`} group={g} />
      ))}
      {referencedBy.map((g) => (
        <RelatedGroupBlock key={`by-${g.fieldKey}-${g.templateKey ?? ''}`} group={g} />
      ))}
    </section>
  );
}

function isMonoField(def: FieldDef): boolean {
  const k = def.key.toLowerCase();
  return k.includes('serial') || k.includes('number');
}

function renderSpecValue(def: FieldDef, value: FieldValue): React.ReactNode {
  switch (def.type) {
    case 'item_ref':
    case 'ammo_ref':
      return (
        <span className="spec-refs">
          <ItemNameRef id={Number(value)} />
        </span>
      );
    case 'item_refs': {
      const ids = Array.isArray(value) ? value.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [];
      if (!ids.length) return '—';
      return (
        <span className="spec-refs">
          {ids.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <ItemNameRef id={id} />
            </span>
          ))}
        </span>
      );
    }
    case 'currency':
      return <span className="spec-val-money">{formatMoney(typeof value === 'number' ? value : Number(value))}</span>;
    case 'date':
      return formatDate(String(value));
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'checkbox':
      return value ? 'Yes' : '—';
    case 'rating': {
      const n = typeof value === 'number' ? value : 0;
      return `${n}/5`;
    }
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {String(value).replace(/^https?:\/\//, '')} <Icon name="external" size={13} />
        </a>
      );
    case 'number': {
      const base = String(value);
      return def.unit ? `${base} ${def.unit}` : base;
    }
    default:
      if (isMonoField(def)) return <span className="spec-val-mono">{String(value)}</span>;
      return String(value);
  }
}
