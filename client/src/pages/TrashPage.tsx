// Trash (route "/trash") — restore or permanently delete soft-deleted items. DESIGN §6.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LoadingBlock, ErrorBlock, ConfirmDialog } from '../components/ui';
import { EmptyState, CollectionDot } from '../components/bits';
import { useToast } from '../components/Toast';
import { useTrash, useRestoreItem, useDeleteItem } from '../api/hooks';
import { relativeDate } from '../lib/format';
import type { Item } from '../api/types';

function TrashRow({ item }: { item: Item }) {
  const toast = useToast();
  const restoreItem = useRestoreItem();
  const deleteItem = useDeleteItem();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const thumb = item.photos[0]?.thumbUrl ?? null;

  async function handleRestore() {
    try {
      await restoreItem.mutateAsync(item.id);
      toast.success(`${item.name} restored`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeleteForever() {
    try {
      await deleteItem.mutateAsync({ id: item.id, permanent: true });
      toast.success(`${item.name} deleted permanently`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmOpen(false);
    }
  }

  return (
    <div className="card row" style={{ alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-3) var(--sp-4)' }}>
      <div style={{ width: 48, height: 48, flex: 'none', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--surface-2)' }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
            <Icon name="photo" size={18} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="serif" style={{ fontSize: 15 }}>
          {item.name}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 4 }}>
          <span className="chip">
            <CollectionDot color={item.collection.color} />
            {item.collection.name}
          </span>
          {item.deletedAt && (
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Deleted {relativeDate(item.deletedAt)}</span>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 8, flex: 'none' }}>
        <button className="btn btn-sm" onClick={handleRestore} disabled={restoreItem.isPending}>
          <Icon name="restore" size={15} /> Restore
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => setConfirmOpen(true)} disabled={deleteItem.isPending}>
          <Icon name="trash" size={15} /> Delete forever
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete forever?"
        message="This permanently deletes the item and its files. This cannot be undone."
        confirmLabel="Delete forever"
        danger
        onConfirm={handleDeleteForever}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export function TrashPage() {
  const { data: items, isLoading, isError, error, refetch } = useTrash();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title serif">Trash</h1>
          <p className="page-sub">
            Items you've deleted stay here until you restore them or delete them forever.
          </p>
        </div>
        <Link to="/" className="back-link">
          <Icon name="back" size={16} /> Back
        </Link>
      </div>

      {isLoading ? (
        <LoadingBlock label="Loading trash…" />
      ) : isError ? (
        <ErrorBlock message={(error as Error)?.message ?? 'Could not load trash.'} onRetry={() => refetch()} />
      ) : !items || items.length === 0 ? (
        <EmptyState
          illustration={<Icon name="trash" size={40} />}
          title="Trash is empty"
          message="Deleted items will appear here, safe to restore, until you clear them for good."
        />
      ) : (
        <div className="col" style={{ gap: 'var(--sp-3)' }}>
          {items.map((item) => (
            <TrashRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
