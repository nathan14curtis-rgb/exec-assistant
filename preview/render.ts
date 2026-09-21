import { writeFileSync } from 'node:fs';
import { renderInbox } from '../src/dashboard/page';
import type { ViewContext } from '../src/dashboard/view';
import type { Capture, ItemWithContent } from '../src/types';

const now = new Date('2026-09-21T18:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

function item(o: Partial<ItemWithContent>): ItemWithContent {
  return {
    id: 'ITM-1', capture_id: 'CAP-1', bucket: 'content_idea', title: '', body: '',
    status: 'open', area: '', due_at: '', related_item_id: '', data: '{}',
    created_at: ago(0), updated_at: ago(0), content: null, ...o,
  } as ItemWithContent;
}
const content = (o: Record<string, unknown>) => ({
  item_id: '', cleaned_idea: '', type: 'idea', theme: '', tags: '', suggested_new_tags: '',
  audience_pain: '', content_format: 'short', lockii_fit: 0, lockii_fit_reason: '',
  possible_duplicate_of: '', stage: 'enriched', titles_draft: '', hooks_draft: '',
  clip_moments_draft: '', cta_deliverable_draft: '', picked_on: '', posted_url: '', notes: '', ...o,
}) as never;

function capture(o: Partial<Capture>): Capture {
  return {
    id: 'CAP-1', created_at: ago(0), channel: 'sendblue', source_id: 's', input_kind: 'voice',
    raw_text: '', transcript_raw: '', transcript_repaired: '', audio_r2_key: '',
    item_count: 0, status: 'processed', error: '', ...o,
  } as Capture;
}

const caps: Capture[] = [
  capture({ id: 'CAP-A', created_at: ago(2 * 60_000), status: 'processing' }),
  capture({
    id: 'CAP-B', created_at: ago(12 * 60_000), item_count: 3, audio_r2_key: 'a.caf',
    transcript_raw: "Okay so two things, three things. The teardown format — I keep thinking the ninety second thing would work if I cut the intro completely. Just hands. Then call marchus about the lift, the quote he gave was before the concrete work so it's probably moved. And the loki keyfob — metal or not, I still haven't decided, the tooling is the whole question.",
    transcript_repaired: "Okay so two things, three things. The teardown format — I keep thinking the ninety second thing would work if I cut the intro completely. Just hands. Then call Marcus about the lift, the quote he gave was before the concrete work so it's probably moved. And the Lockii keyfob — metal or not, I still haven't decided, the tooling is the whole question.",
  }),
  capture({ id: 'CAP-C', created_at: ago(60 * 60_000), input_kind: 'text', item_count: 1, raw_text: 'Why most shop tours are boring — nobody shows the actual work, just the tidy bays.' }),
  capture({
    id: 'CAP-D', created_at: ago(3 * 3600_000), status: 'error',
    error: 'The transcript came through but the sorter timed out.',
    transcript_raw: "Remind me to pull the bead breaker spec before Thursday, and the thing about the keyfob — actually that one's for Lockii —",
  }),
  capture({ id: 'CAP-E', created_at: ago(26 * 3600_000), item_count: 1 }),
];

const items: ItemWithContent[] = [
  item({ id: 'ITM-B1', capture_id: 'CAP-B', bucket: 'content_idea', title: 'The 90-second garage teardown format',
    body: 'Strip one job down to ninety seconds — no intro, no talking head, just the hands and a single caption line. Test it on the brake caliper rebuild first, since the sound alone carries it.',
    content: content({ item_id: 'ITM-B1', lockii_fit: 4, stage: 'enriched', tags: 'shorts, teardown', theme: 'format tests' }) }),
  item({ id: 'ITM-B2', capture_id: 'CAP-B', bucket: 'todo', title: 'Call Marcus about the lift install quote',
    body: 'He quoted around eleven before, but that was before the concrete work. Ask whether the anchor depth changes anything.',
    area: 'hafens', due_at: new Date('2026-09-25T12:00:00Z').toISOString() }),
  item({ id: 'ITM-B3', capture_id: 'CAP-B', bucket: 'decision', title: 'Whether Lockii ships with the metal keyfob' }),
  item({ id: 'ITM-C1', capture_id: 'CAP-C', bucket: 'content_idea', title: 'Why most shop tours are boring',
    body: 'Nobody shows the actual work, just the tidy bays.', content: content({ item_id: 'ITM-C1', lockii_fit: 3 }) }),
  item({ id: 'ITM-E1', capture_id: 'CAP-E', bucket: 'todo', title: 'Order the replacement bead breaker', status: 'done', area: 'hafens' }),
];

const byCapture = new Map<string, ItemWithContent[]>();
for (const i of items) byCapture.set(i.capture_id, [...(byCapture.get(i.capture_id) ?? []), i]);

const ctx: ViewContext = { now, tz: 'America/Denver', queryString: '', openItem: process.argv[3], openCapture: process.argv[4], openForm: process.argv[5] };

const res = renderInbox({
  captures: caps, itemsByCapture: byCapture,
  counts: { content_idea: 2, todo: 1, decision: 1 }, totalItems: 5,
  filters: {}, ctx,
});
res.text().then((t) => { writeFileSync(process.argv[2], t); console.log('wrote', process.argv[2], t.length, 'bytes'); });
