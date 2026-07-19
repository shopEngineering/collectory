// Full REST API contract types (DESIGN §4). API JSON is camelCase; money is integer cents.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'year'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'url'
  | 'rating'
  | 'ammo_ref';

export type ItemStatus = 'owned' | 'wishlist' | 'loaned' | 'sold' | 'traded' | 'gifted';

export const ITEM_STATUSES: ItemStatus[] = ['owned', 'wishlist', 'loaned', 'sold', 'traded', 'gifted'];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  required?: boolean;
  showInTable?: boolean;
  showOnCard?: boolean;
  section?: string;
  placeholder?: string;
  help?: string;
}

export interface LogTypeDef {
  key: string;
  label: string;
  icon?: string;
  color?: string;
  fields?: FieldDef[];
}

export interface Collection {
  id: number;
  name: string;
  icon: string;
  color: string;
  description: string;
  templateKey: string | null;
  sortOrder?: number;
  itemCount?: number;
  valueCents?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollectionFull extends Collection {
  fields: FieldDef[];
  logTypes: LogTypeDef[];
}

export interface Template {
  key: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  fields: FieldDef[];
  logTypes: LogTypeDef[];
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

// Dynamic field values. null clears a key on PATCH.
export type FieldValue = string | number | boolean | string[] | null;
export type FieldValues = Record<string, FieldValue>;

export interface Photo {
  id: number;
  url: string;
  thumbUrl: string;
  caption: string;
  width?: number | null;
  height?: number | null;
  sortOrder: number;
}

export interface ItemSummary {
  id: number;
  collectionId: number;
  name: string;
  status: ItemStatus;
  quantity: number;
  acquiredDate: string | null;
  acquiredPriceCents: number | null;
  currentValueCents: number | null;
  thumbUrl: string | null;
  cardFields: Record<string, FieldValue>;
  tags: Tag[];
  updatedAt: string;
}

export interface ComputedStats {
  roundsFired?: number;
  lastCleaned?: string;
  roundsSinceCleaned?: number;
  lastActivity?: string;
}

export interface Item {
  id: number;
  collectionId: number;
  name: string;
  status: ItemStatus;
  quantity: number;
  minQuantity: number | null;
  acquiredDate: string | null;
  acquiredPriceCents: number | null;
  acquiredFrom: string | null;
  currentValueCents: number | null;
  valueUpdatedAt: string | null;
  notes: string;
  fields: FieldValues;
  photos: Photo[];
  tags: Tag[];
  computedStats: ComputedStats;
  collection: {
    id: number;
    name: string;
    icon: string;
    color: string;
    templateKey: string | null;
  };
  coverPhotoId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface LogEntry {
  id: number;
  itemId: number;
  logTypeKey: string;
  date: string;
  title: string;
  notes: string;
  data: Record<string, FieldValue>;
  linkedLogId: number | null;
  photos: Photo[];
  createdAt: string;
  updatedAt: string;
}

export interface Provenance {
  id: number;
  itemId: number;
  ownerName: string;
  fromDate: string | null;
  toDate: string | null;
  howAcquired: string;
  notes: string;
  sortOrder: number;
}

export type ValuationSource = 'purchase' | 'appraisal' | 'market' | 'estimate' | 'sale';

export interface Valuation {
  id: number;
  itemId: number;
  date: string;
  valueCents: number;
  source: ValuationSource;
  notes: string;
}

export interface Attachment {
  id: number;
  itemId?: number;
  url: string;
  originalName: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt?: string;
}

export type ItemSort =
  | 'name'
  | 'acquiredDate'
  | 'acquiredPrice'
  | 'currentValue'
  | 'createdAt'
  | 'updatedAt'
  | 'quantity';
export type SortDir = 'asc' | 'desc';

export interface ItemQuery {
  q?: string;
  status?: string; // csv
  tag?: string;
  sort?: ItemSort;
  dir?: SortDir;
  fieldFilters?: Record<string, string>; // field.<key>=<value>
  limit?: number;
  offset?: number;
}

export interface ItemListResponse {
  items: ItemSummary[];
  total: number;
}

export interface StatsResponse {
  totals: { items: number; valueCents: number; collections: number };
  byCollection: Array<{
    id: number;
    name: string;
    icon: string;
    color: string;
    count: number;
    valueCents: number;
  }>;
  recentItems: ItemSummary[];
  recentLogs: Array<{
    id: number;
    itemId: number;
    itemName: string;
    collectionId: number;
    logTypeKey: string;
    logTypeLabel: string;
    date: string;
    title: string;
  }>;
  acquisitionTimeline: Array<{ month: string; valueCents: number; count: number }>;
  alerts: Array<{
    type: 'low_stock';
    itemId: number;
    name: string;
    quantity: number;
    minQuantity: number;
  }>;
}

export interface AmmoChoice {
  id: number;
  name: string;
  quantity: number;
  caliber?: string;
}

export interface SearchResult {
  item: ItemSummary;
  collectionName: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface Settings {
  lanEnabled: boolean;
  lanPinSet: boolean;
  currency: string;
  theme: string;
  port: number;
  dataDir: string;
  version: string;
  lanUrls: string[];
  qrDataUrl: string;
  reportOwner?: string;
}

export interface ImportPreview {
  token: string;
  headers: string[];
  sampleRows: string[][];
  suggestedMapping: Record<string, string>; // header -> target
}

export type ImportTarget = string; // core:<name> | field:<key> | new:<type> | skip

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ApiError {
  message: string;
  code?: string;
}

// Core (non-dynamic) item fields editable on the form.
export interface ItemCoreInput {
  collectionId?: number;
  name?: string;
  status?: ItemStatus;
  quantity?: number;
  minQuantity?: number | null;
  acquiredDate?: string | null;
  acquiredPriceCents?: number | null;
  acquiredFrom?: string | null;
  currentValueCents?: number | null;
  notes?: string;
  fields?: FieldValues;
  tags?: string[];
}
