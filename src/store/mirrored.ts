import type { Capture, Channel, ContentIdea, Item, ItemWithContent } from '../types';
import type { ItemFilter, Store, Theme } from './index';
import type { SheetsMirror } from './mirror';

/**
 * Writes go to the primary store first; the mirror is best-effort and can
 * never fail a job. A mirror failure is logged to the primary store so it is
 * visible, not silent.
 */
export class MirroredStore implements Store {
  constructor(
    private readonly primary: Store,
    private readonly mirror: SheetsMirror,
  ) {}

  private async reflect(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`mirror ${what} failed`, message);
      await this.primary.log('', 'error', 'mirror_failed', `${what}: ${message}`);
    }
  }

  async createCapture(capture: Capture): Promise<void> {
    await this.primary.createCapture(capture);
    await this.reflect(`capture ${capture.id}`, () => this.mirror.appendCapture(capture));
  }

  findCaptureBySource(channel: Channel, sourceId: string): Promise<Capture | null> {
    return this.primary.findCaptureBySource(channel, sourceId);
  }

  getCapture(id: string): Promise<Capture | null> {
    return this.primary.getCapture(id);
  }

  listCaptures(limit: number): Promise<Capture[]> {
    return this.primary.listCaptures(limit);
  }

  async updateCapture(id: string, patch: Partial<Capture>): Promise<void> {
    await this.primary.updateCapture(id, patch);
    const full = await this.primary.getCapture(id);
    if (full) await this.reflect(`capture ${id}`, () => this.mirror.updateCapture(full));
  }

  async createItem(item: Item, content?: ContentIdea): Promise<void> {
    await this.primary.createItem(item, content);
    await this.reflect(`item ${item.id}`, () => this.mirror.appendItem(item, content ?? null));
  }

  getItem(id: string): Promise<ItemWithContent | null> {
    return this.primary.getItem(id);
  }

  listItems(filter: ItemFilter): Promise<ItemWithContent[]> {
    return this.primary.listItems(filter);
  }

  async updateItem(id: string, patch: Partial<Item>): Promise<void> {
    await this.primary.updateItem(id, patch);
    await this.reflectItem(id);
  }

  async updateContentIdea(itemId: string, patch: Partial<ContentIdea>): Promise<void> {
    await this.primary.updateContentIdea(itemId, patch);
    await this.reflectItem(itemId);
  }

  private async reflectItem(id: string): Promise<void> {
    const full = await this.primary.getItem(id);
    if (full) await this.reflect(`item ${id}`, () => this.mirror.updateItem(full, full.content));
  }

  getThemes(): Promise<Theme[]> {
    return this.primary.getThemes();
  }

  async upsertTheme(name: string, description: string): Promise<void> {
    await this.primary.upsertTheme(name, description);
    const themes = await this.primary.getThemes();
    const theme = themes.find((t) => t.theme.toLowerCase() === name.trim().toLowerCase());
    if (theme) await this.reflect(`theme ${name}`, () => this.mirror.upsertTheme(theme));
  }

  getTagVocab(): Promise<string[]> {
    return this.primary.getTagVocab();
  }

  getRecentContentIdeas(limit: number): Promise<{ id: string; title: string }[]> {
    return this.primary.getRecentContentIdeas(limit);
  }

  log(sourceId: string, level: 'info' | 'error', event: string, detail: string): Promise<void> {
    return this.primary.log(sourceId, level, event, detail);
  }
}
