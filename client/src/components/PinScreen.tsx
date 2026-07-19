// Full-screen PIN entry, shown when an API returns 401 PIN_REQUIRED.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api/client';
import { Icon } from './Icon';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function PinScreen({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/pin', { pin: value });
      qc.invalidateQueries();
      onSuccess();
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : 'Incorrect PIN';
      setError(msg || 'Incorrect PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (busy) return;
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!k) return;
    setPin((p) => {
      const next = (p + k).slice(0, 8);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 1) submit(pin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, busy]);

  return (
    <div className="pin-screen">
      <div className="pin-card">
        <div className="pin-mark">
          <Icon name="lock" size={26} />
        </div>
        <h1 className="serif">Collectory</h1>
        <p className="pin-sub">Enter your access PIN</p>

        <div className={`pin-dots ${error ? 'shake' : ''}`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
          ))}
        </div>
        {error && <div className="pin-error">{error}</div>}

        <div className="pin-pad">
          {KEYS.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : (
              <button key={i} className="pin-key" onClick={() => press(k)} disabled={busy}>
                {k === 'del' ? <Icon name="back" size={20} /> : k}
              </button>
            ),
          )}
        </div>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || pin.length < 1} onClick={() => submit(pin)} style={{ marginTop: 20 }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
