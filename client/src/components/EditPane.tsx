// Right slide-over edit pane for Browse (grid + table). Edit-only: loads an
// existing item + its collection and renders the shared ItemForm (variant 'pane')
// in a full-height drawer with a backdrop scrim. Esc / scrim / Cancel close via
// the form's unsaved-changes guard. See DESIGN §6.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Portal, LoadingBlock, ErrorBlock } from './ui';
import { ItemForm } from './ItemForm';
import { useCollection, useItem } from '../api/hooks';
import type { Item } from '../api/types';

export function EditPane({
  itemId,
  onClose,
  onSaved,
}: {
  itemId: number;
  onClose: () => void;
  // Fires after a successful save (before the pane closes) so the host can toast.
  onSaved?: (saved: Item) => void;
}) {
  // The form registers its guarded-close here; scrim/Esc route through it.
  const requestCloseRef = useRef<() => void>(onClose);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    requestCloseRef.current();
  }, []);

  // Esc closes (through the guard); lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [requestClose]);

  return (
    <Portal>
      <div
        className={`pane-scrim ${closing ? 'closing' : ''}`}
        onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      >
        <div className="edit-pane" role="dialog" aria-modal="true" aria-label="Edit item">
          <PaneContent
            itemId={itemId}
            registerRequestClose={(fn) => (requestCloseRef.current = fn)}
            onCancel={() => {
              setClosing(true);
              onClose();
            }}
            onSaved={(saved) => {
              onSaved?.(saved);
              setClosing(true);
              onClose();
            }}
          />
        </div>
      </div>
    </Portal>
  );
}

function PaneContent({
  itemId,
  registerRequestClose,
  onCancel,
  onSaved,
}: {
  itemId: number;
  registerRequestClose: (fn: () => void) => void;
  onCancel: () => void;
  onSaved: (saved: Item) => void;
}) {
  const { data: item, isLoading, isError, error, refetch } = useItem(itemId);
  const { data: collection, isLoading: cLoading } = useCollection(item?.collectionId);

  const loading = isLoading || cLoading;

  return (
    <>
      <div className="pane-head">
        <h2 className="pane-title serif">{item ? `Edit ${item.name}` : 'Edit item'}</h2>
        <button className="btn-icon btn-ghost" onClick={onCancel} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="pane-body">
        {loading ? (
          <LoadingBlock label="Loading item…" />
        ) : isError || !item ? (
          <ErrorBlock message={(error as Error)?.message ?? 'Item not found'} onRetry={() => refetch()} />
        ) : !collection ? (
          <LoadingBlock />
        ) : (
          <ItemForm
            collection={collection}
            item={item}
            variant="pane"
            registerRequestClose={registerRequestClose}
            onSaved={(saved) => onSaved(saved)}
            onCancel={onCancel}
          />
        )}
      </div>
    </>
  );
}
