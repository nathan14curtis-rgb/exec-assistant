import type { Capture, ContentIdea, Env, Item } from '../types';
import { appendValues, getValues, updateValues } from '../sheets';
import type { Theme } from './index';

/** Tab layouts. Setup script writes these headers; the Worker only writes rows. */
export const CAPTURES_HEADERS = [
  'id', 'created_at', 'channel', 'input_kind', 'status', 'item_count', 'raw_text',
  'transcript_raw', 'transcript_repaired', 'audio_r2_key', 'error',
] as const;

export const ITEMS_HEADERS = [
  'id', 'capture_id', 'created_at', 'bucket', 'status', 'area', 'title', 'body',
  'due_at', 'related_item_id', 'data', 'updated_at',
] as const;

export const CONTENT_HEADERS = [
  'item_id', 'title', 'stage', 'theme', 'type', 'tags', 'suggested_new_tags',
  'cleaned_idea', 'audience_pain', 'content_format', 'lockii_fit',
  'lockii_fit_reason', 'possible_duplicate_of', 'titles_draft', 'hooks_draft',
  'clip_moments_draft', 'cta_deliverable_draft', 'picked_on', 'posted_url', 'notes',
] as const;

export const THEMES_HEADERS = ['theme', 'description', 'idea_count'] as const;

export const MIRROR_TABS = {
  Captures: CAPTURES_HEADERS,
  Items: ITEMS_HEADERS,
  ContentIdeas: CONTENT_HEADERS,
  Themes: THEMES_HEADERS,
} as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

export function captureToValues(c: Capture): string[] {
  return CAPTURES_HEADERS.map((h) => cell(c[h]));
}

export function itemToValues(i: Item): string[] {
  return ITEMS_HEADERS.map((h) => cell(i[h]));
}

export function contentToValues(title: string, c: ContentIdea): string[] {
  return CONTENT_HEADERS.map((h) => (h === 'title' ? title : cell(c[h as keyof ContentIdea])));
}

function lastColumn(headers: readonly string[]): string {
  return String.fromCharCode(64 + headers.length);
}

/**
 * One-way Sheets mirror. Rows are keyed by id in column A; an update finds
 * the row by scanning that column, which is fine at this volume.
 */
export class SheetsMirror {
  constructor(private readonly env: Env) {}

  private async findRow(tab: string, id: string): Promise<number | null> {
    const ids = await getValues(this.env, `${tab}!A2:A`);
    const idx = ids.findIndex((r) => (r[0] ?? '') === id);
    return idx === -1 ? null : idx + 2;
  }

  private async upsertRow(tab: string, headers: readonly string[], row: string[]): Promise<void> {
    const n = await this.findRow(tab, row[0]);
    if (n === null) {
      await appendValues(this.env, `${tab}!A:${lastColumn(headers)}`, [row]);
    } else {
      await updateValues(this.env, `${tab}!A${n}:${lastColumn(headers)}${n}`, [row]);
    }
  }

  appendCapture(c: Capture): Promise<void> {
    return appendValues(this.env, `Captures!A:${lastColumn(CAPTURES_HEADERS)}`, [captureToValues(c)]);
  }

  updateCapture(c: Capture): Promise<void> {
    return this.upsertRow('Captures', CAPTURES_HEADERS, captureToValues(c));
  }

  async appendItem(item: Item, content: ContentIdea | null): Promise<void> {
    await appendValues(this.env, `Items!A:${lastColumn(ITEMS_HEADERS)}`, [itemToValues(item)]);
    if (content) {
      await appendValues(this.env, `ContentIdeas!A:${lastColumn(CONTENT_HEADERS)}`, [
        contentToValues(item.title, content),
      ]);
    }
  }

  async updateItem(item: Item, content: ContentIdea | null): Promise<void> {
    await this.upsertRow('Items', ITEMS_HEADERS, itemToValues(item));
    if (content) {
      await this.upsertRow('ContentIdeas', CONTENT_HEADERS, contentToValues(item.title, content));
    }
  }

  /** A deleted item keeps its row, with status set to `deleted`. */
  async markItemDeleted(id: string): Promise<void> {
    const n = await this.findRow('Items', id);
    if (n === null) return;
    const col = String.fromCharCode(65 + ITEMS_HEADERS.indexOf('status'));
    await updateValues(this.env, `Items!${col}${n}`, [['deleted']]);
  }

  upsertTheme(t: Theme): Promise<void> {
    return this.upsertRow('Themes', THEMES_HEADERS, [t.theme, t.description, String(t.idea_count)]);
  }
}
