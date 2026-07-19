// Shared UI primitives: Modal, ConfirmDialog, Menu, Spinner, LoadingBlock,
// SectionLabel, Kbd, Switch. Used across all routes.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

// ---- Portal helper --------------------------------------------------------
export function Portal({ children }: { children: ReactNode }) {
  const [el] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [el]);
  return createPortal(children, el);
}

// ---- Modal ----------------------------------------------------------------
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}
export function Modal({ open, onClose, title, children, footer, width }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <Portal>
      <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={width ? { maxWidth: width } : undefined} role="dialog" aria-modal="true">
          {title !== undefined && (
            <div className="modal-head">
              <h2 className="modal-title">{title}</h2>
              <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

// ---- ConfirmDialog --------------------------------------------------------
interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={440}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={danger ? 'btn btn-primary btn-danger-solid' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>{message}</p>
    </Modal>
  );
}

// ---- Menu (dropdown, portal-positioned) -----------------------------------
export interface MenuItemDef {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  kbd?: string;
  divider?: boolean;
}
export function Menu({
  items,
  trigger,
  align = 'right',
}: {
  items: MenuItemDef[];
  trigger: (props: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 200;
    const left = align === 'right' ? r.right - width : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [align]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    const onDoc = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  return (
    <>
      {trigger({ open, toggle, ref: (el) => (anchorRef.current = el) })}
      {open && pos && (
        <Portal>
          <div
            className="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100, width: 200 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((it, i) =>
              it.divider ? (
                <div key={i} className="menu-sep" />
              ) : (
                <button
                  key={i}
                  className={`menu-item ${it.danger ? 'danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.icon && <Icon name={it.icon} size={16} />}
                  <span>{it.label}</span>
                  {it.kbd && <span className="kbd">{it.kbd}</span>}
                </button>
              ),
            )}
          </div>
        </Portal>
      )}
    </>
  );
}

// ---- Spinner / loading ----------------------------------------------------
export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '64px 16px', color: 'var(--ink-3)' }}>
      <Spinner />
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <Icon name="warning" size={44} />
      <h3>Something went wrong</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <Icon name="restore" size={16} /> Retry
        </button>
      )}
    </div>
  );
}

// ---- Small pieces ---------------------------------------------------------
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}
