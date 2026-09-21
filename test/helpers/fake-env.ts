import type { Capture, CaptureJob, ContentIdea, Env, Item, ItemWithContent } from '../../src/types';
import { setStore, type ItemFilter, type Store, type Theme } from '../../src/store';
import worker from '../../src/index';

/**
 * An in-memory Store plus the few bindings the dashboard touches, so the
 * routes can be exercised end to end without D1, R2 or a queue.
 */
export class MemoryStore implements Store {
  captures = new Map<string, Capture>();
  items = new Map<string, Item>();
  contents = new Map<string, ContentIdea>();
  themes = new Map<string, Theme>();
  tags: string[] = ['pricing', 'booking'];
  logs: { level: string; event: string; detail: string }[] = [];

  private join(item: Item): ItemWithContent {
    return { ...item, content: this.contents.get(item.id) ?? null };
  }

  async createCapture(c: Capture): Promise<void> {
    this.captures.set(c.id, { ...c });
  }
  async findCaptureBySource(channel: string, sourceId: string): Promise<Capture | null> {
    return [...this.captures.values()].find((c) => c.channel === channel && c.source_id === sourceId) ?? null;
  }
  async getCapture(id: string): Promise<Capture | null> {
    return this.captures.get(id) ?? null;
  }
  async listCaptures(limit: number): Promise<Capture[]> {
    return [...this.captures.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async updateCapture(id: string, patch: Partial<Capture>): Promise<void> {
    const c = this.captures.get(id);
    if (c) this.captures.set(id, { ...c, ...patch });
  }

  async createItem(item: Item, content?: ContentIdea): Promise<void> {
    this.items.set(item.id, { ...item });
    if (content) this.contents.set(item.id, { ...content });
  }
  async getItem(id: string): Promise<ItemWithContent | null> {
    const item = this.items.get(id);
    return item ? this.join(item) : null;
  }
  async listItems(filter: ItemFilter): Promise<ItemWithContent[]> {
    return [...this.items.values()]
      .filter((i) => !filter.capture_id || i.capture_id === filter.capture_id)
      .filter((i) => !filter.bucket || i.bucket === filter.bucket)
      .filter((i) => !filter.status || i.status === filter.status)
      .map((i) => this.join(i))
      .filter((i) => !filter.stage || i.content?.stage === filter.stage);
  }
  async listItemsForCaptures(ids: string[]): Promise<ItemWithContent[]> {
    return [...this.items.values()]
      .filter((i) => ids.includes(i.capture_id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((i) => this.join(i));
  }
  async updateItem(id: string, patch: Partial<Item>): Promise<void> {
    const i = this.items.get(id);
    if (i) this.items.set(id, { ...i, ...patch, updated_at: new Date().toISOString() });
  }
  async updateContentIdea(itemId: string, patch: Partial<ContentIdea>): Promise<void> {
    const c = this.contents.get(itemId);
    if (c) this.contents.set(itemId, { ...c, ...patch });
  }
  async deleteItem(id: string): Promise<void> {
    this.items.delete(id);
    this.contents.delete(id);
  }
  async countItemsByBucket(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const i of this.items.values()) if (i.status === 'open') out[i.bucket] = (out[i.bucket] ?? 0) + 1;
    return out;
  }

  async getThemes(): Promise<Theme[]> {
    return [...this.themes.values()];
  }
  async upsertTheme(name: string, description: string): Promise<void> {
    const key = name.toLowerCase();
    const t = this.themes.get(key);
    this.themes.set(key, { theme: name, description, idea_count: (t?.idea_count ?? 0) + 1 });
  }
  async getTagVocab(): Promise<string[]> {
    return this.tags;
  }
  async getRecentContentIdeas(limit: number): Promise<{ id: string; title: string }[]> {
    return [...this.items.values()]
      .filter((i) => i.bucket === 'content_idea')
      .slice(-limit)
      .map((i) => ({ id: i.id, title: i.title }));
  }
  async log(_sourceId: string, level: 'info' | 'error', event: string, detail: string): Promise<void> {
    this.logs.push({ level, event, detail });
  }
}

export interface TestEnv {
  env: Env;
  store: MemoryStore;
  queue: CaptureJob[];
  vars: Record<string, string>;
}

const NOW = new Date('2026-09-21T18:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function seed(store: MemoryStore): void {
  const item = (o: Partial<Item>): Item => ({
    id: 'ITM', capture_id: 'CAP', bucket: 'content_idea', title: '', body: '',
    status: 'open', area: '', due_at: '', related_item_id: '', data: '{}',
    created_at: ago(0), updated_at: ago(0), ...o,
  }) as Item;

  store.captures.set('CAP-A', {
    id: 'CAP-A', created_at: ago(2 * 60_000), channel: 'sendblue', source_id: 'src-a',
    input_kind: 'voice', raw_text: '', transcript_raw: '', transcript_repaired: '',
    audio_r2_key: '', item_count: 0, status: 'processing', error: '',
  });
  store.captures.set('CAP-B', {
    id: 'CAP-B', created_at: ago(12 * 60_000), channel: 'sendblue', source_id: 'src-b',
    input_kind: 'voice', raw_text: '',
    transcript_raw: 'Okay so two things. The teardown format. Then call marchus about the lift.',
    transcript_repaired: 'Okay so two things. The teardown format. Then call Marcus about the lift.',
    audio_r2_key: 'audio/2026/09/b.caf', item_count: 3, status: 'processed', error: '',
  });
  store.captures.set('CAP-C', {
    id: 'CAP-C', created_at: ago(3600_000), channel: 'sendblue', source_id: 'src-c',
    input_kind: 'text', raw_text: 'Why most shop tours are boring.', transcript_raw: '',
    transcript_repaired: '', audio_r2_key: '', item_count: 1, status: 'processed', error: '',
  });
  store.captures.set('CAP-D', {
    id: 'CAP-D', created_at: ago(3 * 3600_000), channel: 'sendblue', source_id: 'src-d',
    input_kind: 'voice',
    raw_text: '', transcript_raw: 'Remind me to pull the bead breaker spec before Thursday.',
    transcript_repaired: '', audio_r2_key: '', item_count: 0, status: 'error',
    error: 'the sorter timed out',
  });

  store.items.set('ITM-B1', item({ id: 'ITM-B1', capture_id: 'CAP-B', bucket: 'content_idea', title: 'The 90-second garage teardown format', body: 'Strip one job down to ninety seconds.', created_at: ago(12 * 60_000) }));
  store.contents.set('ITM-B1', {
    item_id: 'ITM-B1', cleaned_idea: '', type: 'idea', theme: 'format tests', tags: 'shorts',
    suggested_new_tags: '', audience_pain: '', content_format: 'short', lockii_fit: 4,
    lockii_fit_reason: '', possible_duplicate_of: '', stage: 'enriched', titles_draft: '',
    hooks_draft: '', clip_moments_draft: '', cta_deliverable_draft: '', picked_on: '',
    posted_url: '', notes: '',
  });
  store.items.set('ITM-B2', item({
    id: 'ITM-B2', capture_id: 'CAP-B', bucket: 'todo', title: 'Call Marcus about the lift install quote',
    body: 'He quoted around eleven before, but that was before the concrete work. Ask whether the anchor depth changes anything.',
    area: 'hafens', created_at: ago(12 * 60_000 - 1000),
  }));
  store.items.set('ITM-B3', item({ id: 'ITM-B3', capture_id: 'CAP-B', bucket: 'decision', title: 'Whether Lockii ships with the metal keyfob', created_at: ago(12 * 60_000 - 2000) }));
  store.items.set('ITM-C1', item({ id: 'ITM-C1', capture_id: 'CAP-C', bucket: 'content_idea', title: 'Why most shop tours are boring', created_at: ago(3600_000) }));
}

export function makeTestEnv(): TestEnv {
  const store = new MemoryStore();
  seed(store);
  const queue: CaptureJob[] = [];
  const vars: Record<string, string> = { USER_TZ: 'UTC', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };

  const audio = new Map<string, { body: string; type: string }>([
    ['audio/2026/09/b.caf', { body: 'fake-audio', type: 'audio/x-caf' }],
  ]);

  const env = {
    API_TOKEN: 'test-token',
    CAPTURE_QUEUE: { send: async (job: CaptureJob) => void queue.push(job) },
    AUDIO: {
      get: async (key: string) => {
        const a = audio.get(key);
        return a ? { body: a.body, size: a.body.length, httpMetadata: { contentType: a.type } } : null;
      },
    },
    DB: {},
    get USER_TZ() { return vars.USER_TZ; },
    get ACCESS_TEAM_DOMAIN() { return vars.ACCESS_TEAM_DOMAIN; },
    get ACCESS_AUD() { return vars.ACCESS_AUD; },
  } as unknown as Env;

  // The dashboard resolves its store through getStore(env); install the
  // in-memory one so no D1 binding is needed.
  setStore(store);

  return { env, store, queue, vars };
}

export async function get(
  t: TestEnv,
  path: string,
  opts: { auth?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.auth) headers.cookie = `inbox_session=${encodeURIComponent('test-token')}`;
  return worker.fetch(new Request(`https://x${path}`, { headers }), t.env);
}

export async function post(
  t: TestEnv,
  path: string,
  fields: Record<string, string>,
  opts: { auth?: boolean } = {},
): Promise<Response> {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (opts.auth) headers.cookie = `inbox_session=${encodeURIComponent('test-token')}`;
  return worker.fetch(new Request(`https://x${path}`, { method: 'POST', headers, body }), t.env);
}
