# Design Brief — Idea Pipeline Console

**Deliverable:** a visual + interaction design for a private single-page web app
that makes the "Ideas" Google Sheet readable, plannable and editable.

**Audience:** one person (the operator). No onboarding, no marketing, no
multi-user affordances. Optimise for a daily 10-minute triage session and a
weekly 30-minute planning session.

---

## 1. Problem

Ideas arrive by voice note or text, get enriched by an LLM, and land as rows in a
Google Sheet with **27 columns**. The sheet is a fine database and a terrible
interface:

- Long-form fields (`cleaned_idea`, `audience_pain`, four `*_draft` columns) are
  unreadable in cells — they truncate or force 400px row heights.
- Planning means comparing ideas side by side. A 27-column grid scrolls
  horizontally; you can never see the whole idea at once.
- Moving an idea through its lifecycle is a manual cell edit with no sense of
  where the pipeline is backed up.

The sheet **remains the source of truth**. This app is a lens and an editor over
it, not a replacement.

## 2. What success looks like

1. Open the app and know, in under five seconds, how many ideas are waiting and
   which stage is the bottleneck.
2. Read one idea in full — no truncation, no scrolling sideways — and judge it.
3. Move an idea to the next stage in one gesture.
4. Edit the draft fields (titles, hooks, clip moments, CTA) in place without
   opening the sheet.
5. Assign ideas to dates to produce a publishing plan.

## 3. The real data

One row = one idea. Fields the design must account for:

**Identity / provenance**
| Field | Shape | Notes |
|---|---|---|
| `id` | `IDEA-20260918-7K3` | dated, sortable. Show it — it's how you talk about an idea |
| `created_at` | ISO timestamp | |
| `source` | `voice` \| `text` \| `voice+text` | small provenance indicator |
| `raw_text` / `transcript` | long text | the unedited original; secondary, collapsible |
| `audio_r2_key` | string | implies a "play the original voice note" affordance |

**LLM enrichment — the content of the card**
| Field | Shape | Notes |
|---|---|---|
| `title` | short string | primary label |
| `cleaned_idea` | 1–3 paragraphs | the thing you actually read |
| `type` | `theme` \| `idea` \| `concept` | |
| `theme` | string, ~10–30 distinct values | the main grouping axis |
| `tags` | comma-separated, from a fixed vocabulary of 18 | see appendix |
| `suggested_new_tags` | comma-separated | **needs a review affordance** — these are proposals awaiting a human yes/no |
| `audience_pain` | 1–2 sentences | |
| `content_format` | `youtube_pillar` \| `short` \| `linkedin_post` \| `carousel` \| `newsletter` | drives very different production effort — should be visually distinct |
| `lockii_fit` | integer 1–5 | the priority signal. Needs a compact, scannable form |
| `lockii_fit_reason` | 1–2 sentences | the justification behind the score |
| `possible_duplicate_of` | an `id` or empty | **needs a resolve affordance** — link to the other idea, then merge or dismiss |

**Pipeline**
| Field | Shape | Notes |
|---|---|---|
| `status` | `enriched` → `drafted` → `picked` → `filmed` → `posted`, plus `error` | `error` is off-pipeline and must not read as a sixth stage |
| `titles_draft`, `hooks_draft`, `clip_moments_draft`, `cta_deliverable_draft` | multi-line, often several options separated by newlines | written by an automated task, **edited by the human** |
| `picked_on` | date | the planning slot |
| `posted_url` | URL | terminal state |
| `notes` | free text | human-only scratch field |
| `error` | string | only populated on failure |

Design against realistic volume: **low hundreds of rows**, single digits per day,
5–15 in flight at any moment. Do not design for 10,000 rows or for empty state
as the common case.

## 4. Screens

### 4.1 Board (default view)
Five columns by `status`. The core object is a card showing `title`,
`content_format`, `lockii_fit`, `theme`, and age. Dragging a card between
columns is the status change.

Design decisions needed:
- What lives on the card versus only in the detail view. The card must stay
  scannable; resist showing all 27 fields.
- How `lockii_fit` 1–5 reads at card size — number, dots, bar, or a colour ramp.
- How `content_format` is distinguished without a rainbow of tag chips.
- How a card carrying an unresolved `possible_duplicate_of` or
  `suggested_new_tags` signals "needs your attention" without becoming an alarm.
- Column headers: count, and some sense of whether a stage is backed up.
- `error` rows — a separate tray, a filter, or a badge. Argue for one.

### 4.2 Detail panel
Opened from a card. Must show the full idea and be the primary edit surface.

- `cleaned_idea` and `audience_pain` read as prose, not as form fields.
- The four `*_draft` fields are editable multi-line text, often containing
  several newline-separated options. Consider whether options should render as a
  list you pick from rather than raw text.
- `raw_text` / `transcript` / audio are collapsed by default.
- Editing model: show a clear saved/unsaved/saving state. Writes go to a remote
  sheet and can fail — design the failure state, not just the happy path.
- Panel versus full page versus modal: your call, but state the reasoning.

### 4.3 Plan
Assigning `picked_on` dates to produce a publishing schedule. A calendar,
a week-slot layout, or an ordered queue — pick one and justify it against the
volume above (single digits per week).

### 4.4 Filter / find
Filter by `theme`, `tags`, `content_format`, `lockii_fit`. Free-text search over
`title` and `cleaned_idea`. Design where these controls live so they don't
dominate the board.

## 5. Constraints

**Hard technical constraints** — the app is served as a single HTML response
from an existing Cloudflare Worker:

- **No build step.** Vanilla HTML + CSS + JS, or a CDN-loaded library. No
  bundler, no framework requiring compilation.
- **One file** for the page. External CSS/JS only from a CDN.
- **No design-system dependency.** No Tailwind config, no component library
  assumed to exist.
- All data arrives from one JSON endpoint; every edit is an HTTP request that
  can be slow (a Google Sheets write, ~300–800ms) or fail.

**Other constraints**

- **Dark and light mode both.** Assume this gets used late at night.
- **Mobile must work** — triage happens on a phone. The board can degrade to a
  single-column list; the detail view must be fully usable at 390px.
- **Keyboard-driven where it's cheap.** Arrow keys through cards, a key to
  advance status, escape to close. This is a power tool for one person.
- No login screen to design — access control happens at the network layer.

## 6. Out of scope

- The capture pipeline (voice → transcript → enrichment). Already built.
- Analytics, view counts, performance data. Not in the sheet yet.
- Anything multi-user: avatars, assignment, comments, permissions.
- Editing the `Themes` or `Tags` reference tables.
- A logo or brand identity. Type, spacing and colour only.

## 7. Deliverables requested

1. **Board view** — desktop and mobile, light and dark.
2. **Card anatomy** — the card at rest, hovered, dragging, and in its
   needs-attention state.
3. **Detail panel** — with realistic content at realistic length, including one
   long `cleaned_idea` and one `hooks_draft` with four options.
4. **Plan view.**
5. **States** — loading, save-in-flight, save-failed, empty column, `error` row.
6. **A short rationale** — the three or four decisions you made and why,
   especially anything where you disagreed with this brief.

Static mockups are fine; a clickable prototype is better. Annotate spacing,
type scale and colour tokens so the build can be literal rather than
interpretive.

## 8. Open questions for the designer

- Is a kanban board actually right here, or does a ranked list sorted by
  `lockii_fit` serve the weekly planning session better? The board makes stage
  visible; a list makes priority visible. Argue for one, or show both.
- Should `theme` be a grouping axis of its own (a swimlane, a second board) or
  just a filter?
- With single-digit weekly volume, does the Plan view need a calendar at all, or
  is an ordered "next up" queue more honest?

## Appendix — tag vocabulary

`branding`, `ad-creative`, `graphic-design`, `logo`, `physical-space`,
`customer-comms`, `booking`, `access-control`, `pricing`, `unstaffed-ops`,
`shrinkage`, `hiring`, `growth-pains`, `expansion`, `capital`, `mistakes`,
`numbers`, `tools-stack`

18 fixed tags. Anything outside this list arrives in `suggested_new_tags` and
awaits human review — so tag chips have a bounded, designable set.
