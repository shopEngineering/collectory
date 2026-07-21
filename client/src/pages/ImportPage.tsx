// Import (route "/import") — CSV import wizard: pick collection + file → map columns → commit → result.
// DESIGN §5.1 (CSV round-trip: core:id matches & updates existing rows) + §6.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useCollection, useCollections } from '../api/hooks';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { ErrorBlock, LoadingBlock, Spinner } from '../components/ui';
import type { ImportPreview, ImportResult } from '../api/types';

type Step = 'pick' | 'mapping' | 'result';

const CORE_TARGETS: { value: string; label: string }[] = [
  { value: 'core:id', label: 'ID (match & update existing)' },
  { value: 'core:name', label: 'Name' },
  { value: 'core:status', label: 'Status' },
  { value: 'core:quantity', label: 'Quantity' },
  { value: 'core:acquiredDate', label: 'Acquired date' },
  { value: 'core:acquiredPriceCents', label: 'Acquired price' },
  { value: 'core:acquiredFrom', label: 'Acquired from' },
  { value: 'core:currentValueCents', label: 'Current value' },
  { value: 'core:notes', label: 'Notes' },
  { value: 'core:tags', label: 'Tags' },
];

const NEW_FIELD_TARGETS: { value: string; label: string }[] = [
  { value: 'new:text', label: 'Create new field (text)' },
  { value: 'new:number', label: 'Create new field (number)' },
  { value: 'new:currency', label: 'Create new field (currency)' },
  { value: 'new:date', label: 'Create new field (date)' },
  { value: 'new:select', label: 'Create new field (select)' },
];

// ---- In-file helpers --------------------------------------------------

function CollectionPicker({
  collections,
  value,
  onChange,
}: {
  collections: { id: number; name: string; icon: string }[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {collections.map((c) => (
        <label
          key={c.id}
          className={`chip ${value === c.id ? 'active' : 'interactive'}`}
          style={{ justifyContent: 'flex-start', height: 40, padding: '0 14px', cursor: 'pointer' }}
        >
          <input
            type="radio"
            name="import-collection"
            checked={value === c.id}
            onChange={() => onChange(c.id)}
            style={{ marginRight: 8 }}
          />
          <Icon name={c.icon} size={16} />
          <span style={{ marginLeft: 6 }}>{c.name}</span>
        </label>
      ))}
    </div>
  );
}

function MappingRow({
  header,
  samples,
  target,
  onChange,
  fieldOptions,
}: {
  header: string;
  samples: string[];
  target: string;
  onChange: (target: string) => void;
  fieldOptions: { value: string; label: string }[];
}) {
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{header}</td>
      <td className="mono" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
        {samples.filter(Boolean).slice(0, 2).join(', ') || '—'}
      </td>
      <td>
        <select className="select" value={target} onChange={(e) => onChange(e.target.value)}>
          <optgroup label="Core fields">
            {CORE_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          {fieldOptions.length > 0 && (
            <optgroup label="Existing fields">
              {fieldOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="New field">
            {NEW_FIELD_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <option value="skip">Skip this column</option>
        </select>
      </td>
    </tr>
  );
}

function ResultStat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="serif tnum" style={{ fontSize: 40, lineHeight: 1 }}>{value}</div>
      <div className="eyebrow" style={{ marginTop: 6 }}>{label}</div>
    </div>
  );
}

// ---- Page ---------------------------------------------------------------

export function ImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: collections, isLoading, isError, error, refetch } = useCollections();

  const [step, setStep] = useState<Step>('pick');
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const { data: chosenCollection } = useCollection(collectionId ?? undefined);

  const fieldOptions = useMemo(
    () => (chosenCollection?.fields ?? []).map((f) => ({ value: `field:${f.key}`, label: f.label })),
    [chosenCollection],
  );

  if (isLoading) return <LoadingBlock label="Loading collections…" />;
  if (isError || !collections) {
    return <ErrorBlock message={(error as Error)?.message ?? 'Could not load collections.'} onRetry={() => refetch()} />;
  }

  const uploadAndPreview = async () => {
    if (!collectionId || !file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      // Pass the target collection so the server can suggest matches against its
      // fields (without it, only core columns map and everything else is "skip").
      const res = await api.upload<ImportPreview>(
        `/import/csv/preview?collectionId=${collectionId}`,
        form,
      );
      setPreview(res);
      setMapping({ ...res.suggestedMapping });
      // fill any header missing from suggestedMapping with 'skip'
      setMapping((prev) => {
        const next = { ...prev };
        for (const h of res.headers) if (!(h in next)) next[h] = 'skip';
        return next;
      });
      setStep('mapping');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const backToPick = () => {
    setStep('pick');
    setPreview(null);
  };

  const commitImport = async () => {
    if (!preview || !collectionId) return;
    setImporting(true);
    try {
      const res = await api.post<ImportResult>('/import/csv/commit', {
        token: preview.token,
        collectionId,
        mapping,
      });
      setResult(res);
      setStep('result');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const importAnother = () => {
    setStep('pick');
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    setErrorsOpen(false);
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title serif">Import</h1>
          <p className="page-sub">
            Tip: export a collection to CSV, edit in Excel, and re-import — rows matched by ID are
            updated, not duplicated.
          </p>
        </div>
      </div>

      {step === 'pick' && (
        <div className="panel">
          <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>1. Choose a collection</div>
          {collections.length === 0 ? (
            <p className="field-help">Create a collection first.</p>
          ) : (
            <CollectionPicker
              collections={collections}
              value={collectionId}
              onChange={setCollectionId}
            />
          )}

          <div className="rule" style={{ margin: 'var(--sp-4) 0' }} />

          <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>2. Choose a CSV file</div>
          <input
            type="file"
            accept=".csv"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <div className="form-actions" style={{ marginTop: 'var(--sp-5)' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!collectionId || !file || uploading}
              onClick={uploadAndPreview}
            >
              {uploading ? (
                <>
                  <Spinner /> Uploading…
                </>
              ) : (
                'Upload & preview'
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'mapping' && preview && (
        <div className="panel">
          <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Map columns</div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>CSV column</th>
                  <th>Sample values</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((header) => (
                  <MappingRow
                    key={header}
                    header={header}
                    samples={preview.sampleRows.map((row) => row[header] ?? '')}
                    target={mapping[header] ?? 'skip'}
                    fieldOptions={fieldOptions}
                    onChange={(target) => setMapping((prev) => ({ ...prev, [header]: target }))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions" style={{ marginTop: 'var(--sp-5)' }}>
            <button type="button" className="btn btn-ghost" onClick={backToPick} disabled={importing}>
              <Icon name="back" size={15} /> Back
            </button>
            <button type="button" className="btn btn-primary" onClick={commitImport} disabled={importing}>
              {importing ? (
                <>
                  <Spinner /> Importing…
                </>
              ) : (
                'Import'
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="panel">
          <div className="eyebrow" style={{ marginBottom: 'var(--sp-4)' }}>Import complete</div>
          <div className="row" style={{ justifyContent: 'space-around', gap: 16 }}>
            <ResultStat value={result.imported} label="Imported" />
            <ResultStat value={result.updated} label="Updated" />
            <ResultStat value={result.skipped} label="Skipped" />
          </div>

          {result.errors.length > 0 && (
            <div style={{ marginTop: 'var(--sp-5)' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setErrorsOpen((o) => !o)}
              >
                <Icon name={errorsOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                {result.errors.length} {result.errors.length === 1 ? 'error' : 'errors'}
              </button>
              {errorsOpen && (
                <div
                  className="mono"
                  style={{
                    marginTop: 'var(--sp-2)',
                    maxHeight: 220,
                    overflowY: 'auto',
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    background: 'var(--sunken)',
                    border: '1px solid var(--hairline)',
                    borderRadius: 'var(--r-sm)',
                    padding: 'var(--sp-3)',
                  }}
                >
                  {result.errors.map((err, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="form-actions" style={{ marginTop: 'var(--sp-5)' }}>
            <button type="button" className="btn" onClick={importAnother}>
              Import another
            </button>
            {collectionId && (
              <button type="button" className="btn btn-primary" onClick={() => navigate(`/c/${collectionId}`)}>
                View collection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
