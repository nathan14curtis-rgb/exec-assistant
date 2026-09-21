import type {
  Capture,
  Channel,
  ContentIdea,
  Item,
  ItemWithContent,
} from '../types';
import type { ItemFilter, Store, Theme } from './index';

export const CAPTURE_COLUMNS = [
  'id', 'created_at', 'channel', 'source_id', 'input_kind', 'raw_text',
  'transcript_raw', 'transcript_repaired', 'audio_r2_key', 'item_count', 'status', 'error',
] as const satisfies readonly (keyof Capture)[];

export const ITEM_COLUMNS = [
  'id', 'capture_id', 'bucket', 'title', 'body', 'status', 'area', 'due_at',
  'related_item_id', 'data', 'created_at', 'updated_at',
] as const satisfies readonly (keyof Item)[];

export const CONTENT_COLUMNS = [
  'item_id', 'cleaned_idea', 'type', 'theme', 'tags', 'suggested_new_tags',
  'audience_pain', 'content_format', 'lockii_fit', 'lockii_fit_reason',
  'possible_duplicate_of', 'stage', 'titles_draft', 'hooks_draft',
  'clip_moments_draft', 'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes',
] as const satisfies readonly (keyof ContentIdea)[];

function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
}

/**
 * Build `UPDATE … SET a = ?, b = ?` from a patch, restricted to known
 * columns so a caller can never inject a column name. Returns null for an
 * empty patch.
 */
export function updateSql<T extends object>(
  table: string,
  allowed: readonly (keyof T & string)[],
  patch: Partial<T>,
  keyColumn: string,
  key: string,
): { sql: string; params: unknown[] } | null {
  const cols = allowed.filter((c) => patch[c] !== undefined);
  if (!cols.length) return null;
  return {
    sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${keyColumn} = ?`,
    params: [...cols.map((c) => patch[c]), key],
  };
}

function values<T extends object>(row: T, columns: readonly (keyof T)[]): unknown[] {
  return columns.map((c) => row[c]);
}

/** A joined items ⨝ content_ideas row, content columns prefixed `c_`. */
type JoinedRow = Record<string, unknown>;

export function splitJoinedRow(row: JoinedRow): ItemWithContent {
  const item = {} as Record<string, unknown>;
  const content = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('c_')) content[k.slice(2)] = v;
    else item[k] = v;
  }
  const hasContent = typeof content.item_id === 'string' && content.item_id !== '';
  return { ...(item as unknown as Item), content: hasContent ? (content as unknown as ContentIdea) : null };
}

const ITEM_SELECT = `SELECT i.*, ${CONTENT_COLUMNS.map((c) => `c.${c} AS c_${c}`).join(', ')}
  FROM items i LEFT JOIN content_ideas c ON c.item_id = i.id`;

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async createCapture(capture: Capture): Promise<void> {
    await this.db
      .prepare(insertSql('captures', CAPTURE_COLUMNS))
      .bind(...values(capture, CAPTURE_COLUMNS))
      .run();
  }

  async findCaptureBySource(channel: Channel, sourceId: string): Promise<Capture | null> {
    return (
      (await this.db
        .prepare('SELECT * FROM captures WHERE channel = ? AND source_id = ?')
        .bind(channel, sourceId)
        .first<Capture>()) ?? null
    );
  }

  async getCapture(id: string): Promise<Capture | null> {
    return (await this.db.prepare('SELECT * FROM captures WHERE id = ?').bind(id).first<Capture>()) ?? null;
  }

  async listCaptures(limit: number): Promise<Capture[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM captures ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all<Capture>();
    return results;
  }

  async updateCapture(id: string, patch: Partial<Capture>): Promise<void> {
    const u = updateSql<Capture>('captures', CAPTURE_COLUMNS, patch, 'id', id);
    if (u) await this.db.prepare(u.sql).bind(...u.params).run();
  }

  async createItem(item: Item, content?: ContentIdea): Promise<void> {
    const stmts = [
      this.db.prepare(insertSql('items', ITEM_COLUMNS)).bind(...values(item, ITEM_COLUMNS)),
    ];
    if (content) {
      stmts.push(
        this.db
          .prepare(insertSql('content_ideas', CONTENT_COLUMNS))
          .bind(...values(content, CONTENT_COLUMNS)),
      );
    }
    // One transaction: an item can never exist without its content row.
    await this.db.batch(stmts);
  }

  async getItem(id: string): Promise<ItemWithContent | null> {
    const row = await this.db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first<JoinedRow>();
    return row ? splitJoinedRow(row) : null;
  }

  async listItems(filter: ItemFilter): Promise<ItemWithContent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.bucket) { where.push('i.bucket = ?'); params.push(filter.bucket); }
    if (filter.status) { where.push('i.status = ?'); params.push(filter.status); }
    if (filter.stage) { where.push('c.stage = ?'); params.push(filter.stage); }
    if (filter.capture_id) { where.push('i.capture_id = ?'); params.push(filter.capture_id); }
    const sql = `${ITEM_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY i.created_at DESC LIMIT ?`;
    params.push(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    const { results } = await this.db.prepare(sql).bind(...params).all<JoinedRow>();
    return results.map(splitJoinedRow);
  }

  async updateItem(id: string, patch: Partial<Item>): Promise<void> {
    const u = updateSql<Item>('items', ITEM_COLUMNS, { ...patch, updated_at: new Date().toISOString() }, 'id', id);
    if (u) await this.db.prepare(u.sql).bind(...u.params).run();
  }

  async updateContentIdea(itemId: string, patch: Partial<ContentIdea>): Promise<void> {
    const u = updateSql<ContentIdea>('content_ideas', CONTENT_COLUMNS, patch, 'item_id', itemId);
    if (!u) return;
    await this.db.batch([
      this.db.prepare(u.sql).bind(...u.params),
      this.db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), itemId),
    ]);
  }

  async getThemes(): Promise<Theme[]> {
    const { results } = await this.db
      .prepare('SELECT theme, description, idea_count FROM themes ORDER BY idea_count DESC, theme')
      .all<Theme>();
    return results;
  }

  async upsertTheme(name: string, description: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO themes (theme, description, idea_count, created_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (theme) DO UPDATE SET idea_count = idea_count + 1`,
      )
      .bind(name.trim(), description, new Date().toISOString())
      .run();
  }

  async getTagVocab(): Promise<string[]> {
    const { results } = await this.db.prepare('SELECT tag FROM tags ORDER BY tag').all<{ tag: string }>();
    return results.map((r) => r.tag);
  }

  async getRecentContentIdeas(limit: number): Promise<{ id: string; title: string }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, title FROM items WHERE bucket = 'content_idea'
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{ id: string; title: string }>();
    return results.reverse();
  }

  async log(sourceId: string, level: 'info' | 'error', event: string, detail: string): Promise<void> {
    try {
      await this.db
        .prepare('INSERT INTO log (ts, source_id, level, event, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(new Date().toISOString(), sourceId, level, event, detail.slice(0, 4000))
        .run();
    } catch (err) {
      console.error('log write failed', err);
    }
  }
}
