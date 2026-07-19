// Settings (route "/settings") — appearance, currency, report owner, LAN access + PIN,
// data (backup/restore/export), about. DESIGN §6.
import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useCollections, useSettings, useUpdateSettings } from '../api/hooks';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { ConfirmDialog, ErrorBlock, LoadingBlock, Switch } from '../components/ui';
import { useTheme, type ThemeMode } from '../lib/theme';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];

// ---- Small in-file helpers -------------------------------------------------

function SettingRow({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: 'var(--sp-3) 0' }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {help && <div className="field-help">{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — copy it manually');
    }
  };
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={copy} aria-label="Copy">
      <Icon name="duplicate" size={14} />
    </button>
  );
}

// ---- Page -------------------------------------------------------------

export function SettingsPage() {
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const { data: collections } = useCollections();
  const updateSettings = useUpdateSettings();
  const { mode, setMode } = useTheme();
  const toast = useToast();

  const [reportOwner, setReportOwner] = useState('');
  const [reportOwnerInit, setReportOwnerInit] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);

  if (!reportOwnerInit && settings) {
    setReportOwner(settings.reportOwner ?? '');
    setReportOwnerInit(true);
  }

  if (isLoading) return <LoadingBlock label="Loading settings…" />;
  if (isError || !settings) {
    return <ErrorBlock message={(error as Error)?.message ?? 'Could not load settings.'} onRetry={() => refetch()} />;
  }

  const currencyOptions = CURRENCIES.includes(settings.currency)
    ? CURRENCIES
    : [settings.currency, ...CURRENCIES];

  const setThemeMode = (m: ThemeMode) => {
    setMode(m);
    updateSettings.mutate(
      { theme: m },
      {
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const onCurrencyChange = (currency: string) => {
    updateSettings.mutate(
      { currency },
      {
        onSuccess: () => toast.success('Currency updated'),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const saveReportOwner = () => {
    updateSettings.mutate(
      { reportOwner },
      {
        onSuccess: () => toast.success('Report owner saved'),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const toggleLan = (on: boolean) => {
    updateSettings.mutate(
      { lanEnabled: on },
      {
        onSuccess: () => toast.success(on ? 'LAN access enabled' : 'LAN access disabled'),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const savePin = () => {
    if (!pinValue) return;
    updateSettings.mutate(
      { lanPin: pinValue },
      {
        onSuccess: () => {
          toast.success('PIN set');
          setPinValue('');
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const clearPin = () => {
    updateSettings.mutate(
      { lanPin: '' },
      {
        onSuccess: () => toast.success('PIN cleared'),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const onRestorePick = (file: File | null) => {
    setRestoreFile(file);
    if (file) setConfirmRestoreOpen(true);
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    setConfirmRestoreOpen(false);
    setRestoring(true);
    try {
      const form = new FormData();
      form.append('file', restoreFile);
      await api.upload('/restore', form);
      toast.success('Restore complete');
      setRestoreDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestoring(false);
      setRestoreFile(null);
    }
  };

  const cancelRestore = () => {
    setConfirmRestoreOpen(false);
    setRestoreFile(null);
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title serif">Settings</h1>
        </div>
      </div>

      {/* Appearance */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Appearance</div>
        <SettingRow label="Theme" help="System follows your device's light/dark setting.">
          <div className="segmented">
            <button
              type="button"
              className={`pill ${mode === 'system' ? 'selected' : ''}`}
              onClick={() => setThemeMode('system')}
            >
              <Icon name="settings" size={14} /> System
            </button>
            <button
              type="button"
              className={`pill ${mode === 'light' ? 'selected' : ''}`}
              onClick={() => setThemeMode('light')}
            >
              <Icon name="sun" size={14} /> Light
            </button>
            <button
              type="button"
              className={`pill ${mode === 'dark' ? 'selected' : ''}`}
              onClick={() => setThemeMode('dark')}
            >
              <Icon name="moon" size={14} /> Dark
            </button>
          </div>
        </SettingRow>
      </section>

      {/* Currency */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Currency</div>
        <SettingRow label="Display currency" help="Money re-formats app-wide.">
          <select
            className="select"
            style={{ minWidth: 120 }}
            value={settings.currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </SettingRow>
      </section>

      {/* Report owner */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Report owner name</div>
        <div className="field">
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              type="text"
              value={reportOwner}
              placeholder="Your name"
              onChange={(e) => setReportOwner(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={saveReportOwner}>
              Save
            </button>
          </div>
          <div className="field-help">Used on the cover page of insurance reports.</div>
        </div>
      </section>

      {/* LAN Access */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>LAN Access</div>
        <SettingRow label="Allow access from other devices on your network" help="Lets an iPad or phone open this archive over Wi-Fi.">
          <Switch on={settings.lanEnabled} onChange={toggleLan} label="LAN access" />
        </SettingRow>

        {settings.lanEnabled && (
          <>
            <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)' }}>
              <div style={{ flex: '1 1 240px' }}>
                <div className="field-label" style={{ marginBottom: 'var(--sp-2)' }}>Addresses</div>
                {settings.lanUrls.length === 0 ? (
                  <p className="field-help">No addresses detected yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {settings.lanUrls.map((url) => (
                      <div key={url} className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span className="mono" style={{ fontSize: 12.5 }}>{url}</span>
                        <CopyButton value={url} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 'var(--sp-4)' }}>
                  <div className="field-label" style={{ marginBottom: 'var(--sp-2)' }}>On your iPad</div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.7 }}>
                    <li>Open Safari and go to this address</li>
                    <li>Tap the Share button</li>
                    <li>Add to Home Screen</li>
                  </ol>
                </div>
              </div>

              {settings.qrDataUrl && (
                <div>
                  <div className="field-label" style={{ marginBottom: 'var(--sp-2)' }}>Scan to open</div>
                  <img
                    src={settings.qrDataUrl}
                    alt="QR code to open this archive on another device"
                    width={180}
                    height={180}
                    style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--hairline)' }}
                  />
                </div>
              )}
            </div>

            <div className="rule" style={{ margin: 'var(--sp-4) 0' }} />

            <div className="field-label" style={{ marginBottom: 'var(--sp-2)' }}>PIN protection</div>
            <p className="field-help" style={{ marginBottom: 'var(--sp-3)' }}>
              {settings.lanPinSet ? 'A PIN is currently set for network access.' : 'No PIN set — anyone on your network can open this archive.'}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                placeholder="New PIN"
                style={{ maxWidth: 160 }}
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
              />
              <button type="button" className="btn" onClick={savePin} disabled={!pinValue}>
                Set PIN
              </button>
              {settings.lanPinSet && (
                <button type="button" className="btn btn-ghost" onClick={clearPin}>
                  Clear PIN
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* Data */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Data</div>

        <SettingRow label="Data folder">
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12.5 }}>{settings.dataDir}</span>
            <CopyButton value={settings.dataDir} />
          </div>
        </SettingRow>

        <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />

        <SettingRow label="Backup now" help="Automatic backups also run daily, keeping the last 10.">
          <button type="button" className="btn" onClick={() => (window.location.href = api.downloadUrl('/backup'))}>
            <Icon name="download" size={15} /> Backup Now
          </button>
        </SettingRow>

        <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />

        <SettingRow label="Restore from backup" help="Restoring replaces all current data. A safety backup is taken first.">
          <label className="btn btn-ghost" style={{ cursor: restoring ? 'default' : 'pointer' }}>
            {restoring ? 'Restoring…' : 'Choose file…'}
            <input
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              disabled={restoring}
              onChange={(e) => onRestorePick(e.target.files?.[0] ?? null)}
              value=""
            />
          </label>
        </SettingRow>
        {restoreDone && (
          <p className="field-help" style={{ marginTop: 'var(--sp-2)' }}>
            Restore complete.{' '}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
              Reload now
            </button>
          </p>
        )}

        <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />

        <SettingRow label="Export full archive (JSON)" help="A full-fidelity dump of all your data.">
          <button type="button" className="btn" onClick={() => (window.location.href = api.downloadUrl('/export/json'))}>
            <Icon name="download" size={15} /> Export JSON
          </button>
        </SettingRow>

        <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />

        <div className="field-label" style={{ marginBottom: 'var(--sp-2)' }}>Export CSV per collection</div>
        {!collections || collections.length === 0 ? (
          <p className="field-help">No collections yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {collections.map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>{c.name}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => (window.location.href = api.downloadUrl('/export/csv', { collectionId: c.id }))}
                >
                  <Icon name="download" size={13} /> CSV
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* About */}
      <section className="panel" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>About</div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="serif" style={{ fontSize: 16 }}>Collectory</div>
            <div className="field-help">Version {settings.version}</div>
          </div>
        </div>
        <div className="rule" style={{ margin: 'var(--sp-3) 0' }} />
        <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          <Icon name="lock" size={14} />
          <span>
            Local-first. No servers, no cloud, no accounts, no telemetry. Your records never leave your
            machine unless you export them.
          </span>
        </p>
      </section>

      <ConfirmDialog
        open={confirmRestoreOpen}
        title="Restore from backup?"
        message="Restoring replaces all current data. A safety backup is taken first. Continue?"
        confirmLabel="Restore"
        danger
        onConfirm={doRestore}
        onCancel={cancelRestore}
      />
    </div>
  );
}
