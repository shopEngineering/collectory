// Item create/edit route wrapper. Resolves the collection + existing item, then
// renders the reusable ItemForm (variant 'page'). The form body itself lives in
// components/ItemForm.tsx and is shared with the Browse slide-over edit pane.
// See DESIGN §6.
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ItemForm } from '../components/ItemForm';
import { LoadingBlock, ErrorBlock } from '../components/ui';
import { useCollection, useItem } from '../api/hooks';
import type { CollectionFull, Item } from '../api/types';

export function ItemFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams();

  if (mode === 'edit') {
    return <EditLoader itemId={Number(params.itemId)} />;
  }
  return <CreateLoader collectionId={Number(params.collectionId)} />;
}

// ---- Loaders (resolve collection + existing item before rendering form) ----
function CreateLoader({ collectionId }: { collectionId: number }) {
  const { data: collection, isLoading, isError, error, refetch } = useCollection(collectionId);
  if (isLoading) return <div className="page"><LoadingBlock label="Loading collection…" /></div>;
  if (isError || !collection)
    return (
      <div className="page">
        <ErrorBlock message={(error as Error)?.message ?? 'Collection not found'} onRetry={() => refetch()} />
      </div>
    );
  return <PageForm mode="create" collection={collection} item={null} />;
}

function EditLoader({ itemId }: { itemId: number }) {
  const { data: item, isLoading, isError, error, refetch } = useItem(itemId);
  const { data: collection, isLoading: cLoading } = useCollection(item?.collectionId);
  if (isLoading || cLoading) return <div className="page"><LoadingBlock label="Loading item…" /></div>;
  if (isError || !item)
    return (
      <div className="page">
        <ErrorBlock message={(error as Error)?.message ?? 'Item not found'} onRetry={() => refetch()} />
      </div>
    );
  if (!collection) return <div className="page"><LoadingBlock /></div>;
  return <PageForm mode="edit" collection={collection} item={item} />;
}

// ---- Page chrome around the shared form ------------------------------------
function PageForm({
  mode,
  collection,
  item,
}: {
  mode: 'create' | 'edit';
  collection: CollectionFull;
  item: Item | null;
}) {
  const navigate = useNavigate();
  const backTo = mode === 'edit' && item ? `/items/${item.id}` : `/c/${collection.id}`;
  const title = mode === 'create' ? `New ${collection.name}` : `Edit ${item?.name ?? 'item'}`;

  return (
    <div className="page">
      <Link to={backTo} className="back-link">
        <Icon name="chevron-left" size={16} /> Back
      </Link>
      <div className="page-head">
        <h1 className="page-title serif">{title}</h1>
      </div>

      <ItemForm
        collection={collection}
        item={item}
        variant="page"
        onSaved={(saved, opts) => {
          // Save & add another stays put (form resets itself); plain Save navigates.
          if (!opts.addAnother) navigate(`/items/${saved.id}`);
        }}
        onCancel={() => navigate(backTo)}
      />
    </div>
  );
}
