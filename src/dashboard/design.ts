import type { Bucket } from '../types';

/**
 * The design system from the dashboard spec, as data.
 *
 * Bucket identity is carried by three signals in this order of reliability:
 * a distinct glyph silhouette, the word itself in mono caps, and only then
 * hue. Glyphs differ in fill and outline as well as shape, so they survive
 * greyscale and both themes.
 */
export interface BucketSpec {
  /** Mono-caps label on the item row. */
  label: string;
  /** Short label for the move-to buttons, where six sit side by side. */
  short: string;
  /** Primary glyph path, drawn in the bucket's hue. */
  g1: string;
  g1Fill: boolean;
  /** Secondary detail stroke, empty for single-path glyphs. */
  g2: string;
  /** CSS custom property holding the hue. */
  hue: string;
}

export const BUCKETS: Record<Bucket, BucketSpec> = {
  content_idea: {
    label: 'Content idea',
    short: 'Idea',
    // Solid triangle — the only filled glyph.
    g1: 'M4 3.1v9.8l8-4.9z',
    g1Fill: true,
    g2: '',
    hue: '--idea',
  },
  todo: {
    label: 'To-do',
    short: 'To-do',
    // Square, checked — the only square with a tick.
    g1: 'M5 2.6h6a2.4 2.4 0 0 1 2.4 2.4v6a2.4 2.4 0 0 1-2.4 2.4H5A2.4 2.4 0 0 1 2.6 11V5A2.4 2.4 0 0 1 5 2.6z',
    g1Fill: false,
    g2: 'M5.3 8.2l1.9 1.9 3.5-3.9',
    hue: '--todo',
  },
  follow_up: {
    label: 'Follow-up',
    short: 'Follow-up',
    // A person — the only round glyph.
    g1: 'M10.6 5.4a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0z',
    g1Fill: false,
    g2: 'M2.8 13.4c.7-2.6 2.7-3.9 5.2-3.9s4.5 1.3 5.2 3.9',
    hue: '--followup',
  },
  decision: {
    label: 'Decision',
    short: 'Decision',
    // A fork, two ends open.
    g1: 'M8 14V8.4M8 8.4L3.8 4.4M8 8.4l4.2-4M2.2 4.4h2.6M11.2 4.4h2.6',
    g1Fill: false,
    g2: '',
    hue: '--decision',
  },
  roadmap: {
    label: 'Roadmap',
    short: 'Roadmap',
    // Staggered bars — now, next, later.
    g1: 'M3.3 3.2h4.4a1.3 1.3 0 0 1 0 2.6H3.3a1.3 1.3 0 0 1 0-2.6zM5.9 6.7h4.4a1.3 1.3 0 0 1 0 2.6H5.9a1.3 1.3 0 0 1 0-2.6zM8.5 10.2h4.2a1.3 1.3 0 0 1 0 2.6H8.5a1.3 1.3 0 0 1 0-2.6z',
    g1Fill: true,
    g2: '',
    hue: '--roadmap',
  },
  journal: {
    label: 'Journal',
    short: 'Journal',
    // A written page — the only square frame.
    g1: 'M3.4 2.4h9.2v11.2H3.4z',
    g1Fill: false,
    g2: 'M5.8 5.6h4.4M5.8 8h4.4M5.8 10.4h2.4',
    hue: '--journal',
  },
};

/** Bucket order for the move-to grid and the filter rail. */
export const BUCKET_ORDER: Bucket[] = [
  'content_idea',
  'todo',
  'follow_up',
  'decision',
  'roadmap',
  'journal',
];

export const AREA_LABELS: Record<string, string> = {
  '': 'None',
  hafens: "Hafen's Garage",
  lockii: 'Lockii',
  content: 'Content',
  personal: 'Personal',
};

/** Compact area label for the item meta line. */
export const AREA_SHORT: Record<string, string> = {
  hafens: 'garage',
  lockii: 'lockii',
  content: 'content',
  personal: 'personal',
};

export const STAGE_ORDER = ['enriched', 'drafted', 'picked', 'filmed', 'posted'] as const;
export const STATUS_ORDER = ['open', 'done', 'dismissed'] as const;
