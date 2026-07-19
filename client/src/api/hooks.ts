// React Query hooks per resource with sane invalidation (DESIGN §4).
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  AmmoChoice,
  Attachment,
  Collection,
  CollectionFull,
  FieldDef,
  Item,
  ItemChoice,
  ItemCoreInput,
  ItemListResponse,
  ItemQuery,
  LogEntry,
  LogTypeDef,
  Provenance,
  RelatedResponse,
  SearchResponse,
  Settings,
  StatsResponse,
  Template,
  Valuation,
} from './types';

// ---- Query keys -----------------------------------------------------------
export const qk = {
  collections: ['collections'] as const,
  collection: (id: number) => ['collection', id] as const,
  items: (collectionId: number, query: ItemQuery) => ['items', collectionId, query] as const,
  item: (id: number) => ['item', id] as const,
  logs: (itemId: number) => ['logs', itemId] as const,
  provenance: (itemId: number) => ['provenance', itemId] as const,
  valuations: (itemId: number) => ['valuations', itemId] as const,
  attachments: (itemId: number) => ['attachments', itemId] as const,
  stats: ['stats'] as const,
  templates: ['templates'] as const,
  ammoChoices: ['ammo-choices'] as const,
  itemChoices: (template: string | undefined, q: string) => ['item-choices', template ?? '', q] as const,
  related: (id: number) => ['related', id] as const,
  search: (q: string) => ['search', q] as const,
  settings: ['settings'] as const,
  trash: ['trash'] as const,
};

// ---- Collections ----------------------------------------------------------
export function useCollections() {
  return useQuery({ queryKey: qk.collections, queryFn: () => api.get<Collection[]>('/collections') });
}

export function useCollection(id: number | undefined) {
  return useQuery({
    queryKey: id ? qk.collection(id) : ['collection', 'none'],
    queryFn: () => api.get<CollectionFull>(`/collections/${id}`),
    enabled: id != null && !Number.isNaN(id),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      icon?: string;
      color?: string;
      description?: string;
      templateKey?: string;
    }) => api.post<CollectionFull>('/collections', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useUpdateCollection(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Collection>) => api.patch<Collection>(`/collections/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: qk.collection(id) });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) =>
      api.del<void>(`/collections/${id}`, force ? { force: true } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useSaveFields(collectionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: FieldDef[]) =>
      api.put<CollectionFull>(`/collections/${collectionId}/fields`, { fields }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collection(collectionId) }),
  });
}

export function useSaveLogTypes(collectionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logTypes: LogTypeDef[]) =>
      api.put<CollectionFull>(`/collections/${collectionId}/logtypes`, { logTypes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collection(collectionId) }),
  });
}

// ---- Templates ------------------------------------------------------------
export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: () => api.get<Template[]>('/templates') });
}

// ---- Items ----------------------------------------------------------------
function itemsPath(collectionId: number, query: ItemQuery): [string, Record<string, unknown>] {
  const params: Record<string, unknown> = {
    q: query.q,
    status: query.status,
    tag: query.tag,
    sort: query.sort,
    dir: query.dir,
    limit: query.limit,
    offset: query.offset,
  };
  if (query.fieldFilters) {
    for (const [k, v] of Object.entries(query.fieldFilters)) {
      if (v) params[`field.${k}`] = v;
    }
  }
  return [`/collections/${collectionId}/items`, params];
}

export function useItems(collectionId: number | undefined, query: ItemQuery) {
  return useQuery({
    queryKey: collectionId ? qk.items(collectionId, query) : ['items', 'none'],
    queryFn: () => {
      const [path, params] = itemsPath(collectionId!, query);
      return api.get<ItemListResponse>(path, params);
    },
    enabled: collectionId != null && !Number.isNaN(collectionId),
    placeholderData: keepPreviousData,
  });
}

export function useItem(id: number | undefined) {
  return useQuery({
    queryKey: id ? qk.item(id) : ['item', 'none'],
    queryFn: () => api.get<Item>(`/items/${id}`),
    enabled: id != null && !Number.isNaN(id),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCoreInput) => api.post<Item>('/items', body),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: ['item-choices'] });
      qc.invalidateQueries({ queryKey: ['related'] });
      if (item?.id) qc.setQueryData(qk.item(item.id), item);
    },
  });
}

export function useUpdateItem(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCoreInput) => api.patch<Item>(`/items/${id}`, body),
    onSuccess: (item) => {
      qc.setQueryData(qk.item(id), item);
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: ['item-choices'] });
      qc.invalidateQueries({ queryKey: ['related'] });
    },
  });
}

export function useDuplicateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Item>(`/items/${id}/duplicate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permanent }: { id: number; permanent?: boolean }) =>
      api.del<void>(`/items/${id}`, permanent ? { permanent: true } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: qk.trash });
    },
  });
}

export function useRestoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<Item>(`/items/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.trash });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useTrash() {
  return useQuery({ queryKey: qk.trash, queryFn: () => api.get<{ items: Item[] }>('/trash').then((r) => r.items) });
}

// ---- Logs -----------------------------------------------------------------
export function useLogs(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? qk.logs(itemId) : ['logs', 'none'],
    queryFn: () => api.get<{ logs: LogEntry[] }>(`/items/${itemId}/logs`).then((r) => r.logs),
    enabled: itemId != null && !Number.isNaN(itemId),
  });
}

function invalidateItemDerived(qc: ReturnType<typeof useQueryClient>, itemId: number) {
  qc.invalidateQueries({ queryKey: qk.logs(itemId) });
  qc.invalidateQueries({ queryKey: qk.item(itemId) });
  qc.invalidateQueries({ queryKey: ['items'] });
  qc.invalidateQueries({ queryKey: qk.ammoChoices });
  qc.invalidateQueries({ queryKey: ['item-choices'] });
  qc.invalidateQueries({ queryKey: ['related'] });
  qc.invalidateQueries({ queryKey: qk.stats });
}

export function useCreateLog(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      logTypeKey: string;
      date: string;
      title?: string;
      notes?: string;
      data?: Record<string, unknown>;
    }) => api.post<LogEntry>(`/items/${itemId}/logs`, body),
    onSuccess: () => invalidateItemDerived(qc, itemId),
  });
}

export function useUpdateLog(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<LogEntry> }) =>
      api.patch<LogEntry>(`/logs/${id}`, body),
    onSuccess: () => invalidateItemDerived(qc, itemId),
  });
}

export function useDeleteLog(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/logs/${id}`),
    onSuccess: () => invalidateItemDerived(qc, itemId),
  });
}

// ---- Provenance -----------------------------------------------------------
export function useProvenance(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? qk.provenance(itemId) : ['provenance', 'none'],
    queryFn: () => api.get<{ provenance: Provenance[] }>(`/items/${itemId}/provenance`).then((r) => r.provenance),
    enabled: itemId != null && !Number.isNaN(itemId),
  });
}

export function useCreateProvenance(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Provenance>) =>
      api.post<Provenance>(`/items/${itemId}/provenance`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.provenance(itemId) }),
  });
}

export function useUpdateProvenance(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Provenance> }) =>
      api.patch<Provenance>(`/provenance/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.provenance(itemId) }),
  });
}

export function useDeleteProvenance(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/provenance/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.provenance(itemId) }),
  });
}

// ---- Valuations -----------------------------------------------------------
export function useValuations(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? qk.valuations(itemId) : ['valuations', 'none'],
    queryFn: () => api.get<{ valuations: Valuation[] }>(`/items/${itemId}/valuations`).then((r) => r.valuations),
    enabled: itemId != null && !Number.isNaN(itemId),
  });
}

export function useCreateValuation(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date: string; valueCents: number; source: string; notes?: string }) =>
      api.post<Valuation>(`/items/${itemId}/valuations`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.valuations(itemId) });
      qc.invalidateQueries({ queryKey: qk.item(itemId) });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useDeleteValuation(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/valuations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.valuations(itemId) });
      qc.invalidateQueries({ queryKey: qk.item(itemId) });
    },
  });
}

// ---- Attachments ----------------------------------------------------------
export function useAttachments(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? qk.attachments(itemId) : ['attachments', 'none'],
    queryFn: () => api.get<{ attachments: Attachment[] }>(`/items/${itemId}/attachments`).then((r) => r.attachments),
    enabled: itemId != null && !Number.isNaN(itemId),
  });
}

export function useDeleteAttachment(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.attachments(itemId) }),
  });
}

// ---- Photos ---------------------------------------------------------------
export function useSetCover(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.post<void>(`/items/${itemId}/cover`, { photoId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.item(itemId) });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useDeletePhoto(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.del<void>(`/photos/${photoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.item(itemId) });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useUpdatePhoto(itemId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { caption?: string; sortOrder?: number } }) =>
      api.patch<void>(`/photos/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.item(itemId) }),
  });
}

// ---- Cross-cutting --------------------------------------------------------
export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: () => api.get<StatsResponse>('/stats') });
}

export function useAmmoChoices(enabled = true) {
  return useQuery({
    queryKey: qk.ammoChoices,
    queryFn: () => api.get<AmmoChoice[]>('/ammo-choices'),
    enabled,
  });
}

// Item-choices picker source, parameterized by refTemplate (§5.2).
export function useItemChoices(refTemplate: string | undefined, q = '', enabled = true) {
  return useQuery({
    queryKey: qk.itemChoices(refTemplate, q),
    queryFn: () => {
      const params: Record<string, unknown> = {};
      if (refTemplate) params.template = refTemplate;
      if (q.trim()) params.q = q.trim();
      return api.get<ItemChoice[]>('/item-choices', params);
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}

// Related items for the detail "Related" card (§5.2).
export function useRelated(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? qk.related(itemId) : ['related', 'none'],
    queryFn: () => api.get<RelatedResponse>(`/items/${itemId}/related`),
    enabled: itemId != null && !Number.isNaN(itemId),
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: qk.search(q),
    queryFn: () => api.get<SearchResponse>('/search', { q }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.get<Settings>('/settings') });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      lanEnabled?: boolean;
      lanPin?: string;
      currency?: string;
      theme?: string;
      reportOwner?: string;
    }) => api.patch<Settings>('/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(qk.settings, data);
      qc.invalidateQueries({ queryKey: qk.settings });
    },
  });
}
