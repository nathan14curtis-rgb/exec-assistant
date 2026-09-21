import type {
  Bucket,
  Capture,
  Channel,
  ContentIdea,
  ContentStage,
  Env,
  Item,
  ItemStatus,
  ItemWithContent,
} from '../types';
import { D1Store } from './d1';
import { SheetsMirror } from './mirror';
import { MirroredStore } from './mirrored';

export interface Theme {
  theme: string;
  description: string;
  idea_count: number;
}

export interface ItemFilter {
  bucket?: Bucket;
  status?: ItemStatus;
  stage?: ContentStage;
  capture_id?: string;
  limit?: number;
}

/**
 * Everything the pipeline persists goes through this. D1 implements it; the
 * Sheets mirror decorates it. Swapping the backing store later is a new
 * implementation of this interface, not a rewrite of the consumer.
 */
export interface Store {
  createCapture(capture: Capture): Promise<void>;
  findCaptureBySource(channel: Channel, sourceId: string): Promise<Capture | null>;
  getCapture(id: string): Promise<Capture | null>;
  listCaptures(limit: number): Promise<Capture[]>;
  updateCapture(id: string, patch: Partial<Capture>): Promise<void>;

  createItem(item: Item, content?: ContentIdea): Promise<void>;
  getItem(id: string): Promise<ItemWithContent | null>;
  listItems(filter: ItemFilter): Promise<ItemWithContent[]>;
  updateItem(id: string, patch: Partial<Item>): Promise<void>;
  updateContentIdea(itemId: string, patch: Partial<ContentIdea>): Promise<void>;

  getThemes(): Promise<Theme[]>;
  /** Insert or bump idea_count; atomic in D1 so concurrent consumers can't race. */
  upsertTheme(name: string, description: string): Promise<void>;
  getTagVocab(): Promise<string[]>;
  /** Newest-last content ideas for duplicate detection. */
  getRecentContentIdeas(limit: number): Promise<{ id: string; title: string }[]>;

  log(sourceId: string, level: 'info' | 'error', event: string, detail: string): Promise<void>;
}

let cached: Store | null = null;

export function getStore(env: Env): Store {
  if (cached) return cached;
  const d1 = new D1Store(env.DB);
  cached = env.SHEET_ID ? new MirroredStore(d1, new SheetsMirror(env)) : d1;
  return cached;
}

/** Test hook. */
export function resetStore(): void {
  cached = null;
}
