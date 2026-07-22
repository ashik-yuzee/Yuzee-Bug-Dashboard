# Changelog — Yuzee Bug Dashboard

Everything built, fixed, and changed across this conversation, in chronological order. For the full architecture/schema reference, see `CLAUDE.md`. For a narrative walkthrough of how to use the dashboard, see the in-app **Guide** tab.

---

## 1. Pipeline schema catch-up + five new tabs

The dashboard's schema knowledge had fallen behind the live n8n pipeline. Verified the *live* Supabase schema directly rather than trusting existing docs, and closed the gap:

- Extended the `BugReport` TypeScript type with ~30 real columns that existed live but weren't modeled yet (device/browser info, Rollbar replay fields, feature flags, ownership fields, ticketability scoring).
- **Fixed a real bug:** the "Session Replay" quick-link was wired to a PostHog field that's null on every row. Added a proper Rollbar replay URL builder (`rollbarReplayUrl()` in `lib/utils.ts`) and verified it against a bug with real replay data.
- Added read-only RLS policies (with sign-off) so five previously-unreadable tables could be surfaced: `bug_rules`, `triage_feedback`, `jira_comment_actions`, `cw_scan_state`, `feedback_reports`.
- Built five new pieces of UI: **Triage & Rules** tab (Bug Rules / Triage Feedback / Jira Comments sub-views), a **CloudWatch** pane inside Pipeline, a **Feedback** tab, and a **Daily Digest** placeholder tab.
- Made the nav horizontally scrollable so it wouldn't break as tabs grew.

## 2. Internal Tickets ("Jira-lite") + PDF documentation

Built a full internal ticketing system for work that isn't an automated bug report:

- **Schema:** `internal_tickets`, `internal_ticket_comments`, `internal_ticket_activity` — auto-generated `TIX-#` keys via a Postgres sequence + trigger.
- **UI:** a Kanban board (4-column workflow), a sortable/filterable list view, a detail panel with comments and a field-change activity log, and a creation modal.
- **Integration:** a bug's detail panel can create or jump to its linked ticket; the Overview tab shows a ticket-status summary widget; each Developer card shows their open ticket count.
- Added read/write RLS policies (SELECT/INSERT/UPDATE, no DELETE, with sign-off).
- Produced a full PDF guide (`docs/Yuzee_Bug_Dashboard_Guide.pdf`) — later superseded by the in-app Guide tab (see §4).

## 3. UX overhaul — sidebar navigation

The horizontal top nav had grown to 10 tabs and was truncating badly. Replaced it wholesale:

- **Collapsible left sidebar** — full labels + badges when expanded, icon-only with tooltips when collapsed; state persists across reloads.
- **Decluttered top bar** — page title, connection status, and compact icon buttons for the AI Analyse action, Refresh, and Sign out (previously long text labels/toggle switches).
- **Hardened all 7 Supabase data hooks** (`useGeminiQueue`, `useInternalTickets`, `useBugRules`, `useTriageFeedback`, `useJiraCommentActions`, `useCwScanState`, `useFeedbackReports`) with retry-with-backoff, after finding the "failed to load queue data" errors were genuine intermittent 500s from Supabase (confirmed via network logs — identical requests succeeded on retry).
- **Fixed a real bug:** opening a ticket from a bug's detail panel wasn't closing the bug panel underneath it, leaving two overlapping side panels.
- Added a `/guide` page (later folded into the dashboard itself — see §4).

## 4. This session — Jira sync, Storage-based digest, in-app Guide, interactivity pass

### Jira integration diagnosis
Investigated why "failed to load" errors appeared and why a Jira sync seemed impossible. Root-caused precisely rather than guessing:
- Confirmed the Jira API token authenticates fine (200, not 401) using the correct Basic-auth format (verified Bearer auth is *wrong* for this token type before ruling it out).
- Initially misdiagnosed as a missing Jira permission on `ashik@yuzee.com` (project search returned 0 results, a known real issue returned 404). **The actual cause: `JIRA_EMAIL` in `.env.local` was simply the wrong account.** The correct account is `design@freshfutures.com` — once corrected, the exact same token immediately returned real data (confirmed via a direct API call before touching any application code).
- This also fixed the previously-empty Jira Spaces panel on Overview, which uses the same credentials — no code changes were needed there, just the corrected email.

### Jira YSC ticket sync
- **Schema:** added `source`, `jira_key`, `jira_url`, `jira_status`, `jira_created_at`, `jira_updated_at` to `internal_tickets` (additive, nothing existing touched) plus a unique index on `jira_key` for safe re-syncing.
- **`lib/jiraClient.ts`:** added pagination support (`searchJiraJqlAll`) to page through an entire Jira project via cursor-based `nextPageToken`.
- **New route `/api/jira/sync-tickets`:** pulls every YSC issue, maps Jira priority → P1–P4 and Jira status → the dashboard's 4-column workflow, and upserts (safe to re-run — updates changed tickets, adds new ones, never duplicates or deletes anything).
- **Fixed a real bug found on the first real sync:** the upsert originally targeted the `jira_key` unique index, but `internal_tickets`'s pre-existing `ticket_key` unique constraint fires on every re-sync too (Jira rows always set `ticket_key = jira_key`), and Postgres can't reconcile two different unique constraints inside one upsert — this raised `duplicate key value violates ... ticket_key_key` (23505) on the very first re-sync. Fixed by targeting `ticket_key` for conflict resolution instead. Caught by reproducing the exact failure directly against Supabase rather than guessing from the generic error message the route surfaced.
- **UI:** a "Sync from Jira" button, automatic background re-sync every 5 minutes so new/updated Jira tickets show up without manual action, a "hide Jira tickets" toggle (persisted), and clear Jira badges on cards/rows/detail panel. Jira-sourced tickets are read-only in the dashboard (status/priority/assignee/comments happen in Jira — a link jumps straight there) so there's no risk of local edits silently drifting from or being overwritten by Jira.
- **Verified against real production data:** synced all 244 real YSC tickets, confirmed a second sync run is fully idempotent (no duplicates, no errors), spot-checked a real ticket's detail panel (correct "Open in Jira" link, correct read-only behavior) and the List/Board views.

### Daily Digest → Supabase Storage
The `daily_bug_reports` table was replaced by the n8n workflow now saving straight to a `bug-reports` Storage bucket. Updated the tab to match reality:
- Added a narrow, read-only Storage RLS policy scoped to just that bucket (with sign-off).
- Rebuilt the tab to list real files (`bug-report-YYYY-MM-DD.html`), most recent first, with an inline iframe preview and a "View Full Report" link — verified against the real report already in the bucket.

### Guide — now a real tab, not a separate window
Converted `/guide` from a `target="_blank"` page into `components/GuideTab.tsx`, rendered inside the dashboard's own sidebar+content shell with a jump-to pill nav. The standalone `/guide` route was removed to avoid maintaining two copies of the same content. Content was also updated to describe the sidebar (not the old top nav), Tickets, and Jira sync.

### Every page now explains itself
Added a small collapsible info banner (`components/ui/PageInfo.tsx`) to the top of all ten tabs, explaining what the page shows in plain language. Collapsed state is remembered per page.

### Interactive charts everywhere
Made the KPI/severity/status/routing/component breakdowns, the daily volume bar chart, and — in Reports — the volume trend, component bar chart, routing donut, and per-row breakdowns (module/environment/source/error-type) all clickable, jumping straight to the matching filtered view in Bug Reports.

### Reports — more depth
Added two new sections: a **Duplicate Rate Over Time** chart and a **Component × Severity Matrix** table (both clickable).

### Error Clusters — filtering and sorting
Added severity, routing, and component filters plus a search box, and five sort modes (most reports, highest severity, most recent, oldest, component A–Z) — previously only four coarse quick-filters existed.

### Legacy toggle — readable again
The icon-only legacy-data button from the earlier redesign was genuinely unclear on hover-only. It now reads "Legacy on"/"Legacy off" directly.

### Bugs found and fixed while doing all of the above
Two earlier fixes (a `Date.now()` purity issue in `Reports.tsx`'s P1/P2 response-time chart, and a synchronous-setState-in-effect issue in `AIAnalysisPanel.tsx`) and one full feature integration (`DeveloperView.tsx`'s ticket-count cards) had not persisted to disk from an earlier point in this conversation — caught via a routine `tsc`/`eslint` re-check rather than assumed still-correct, and re-applied.

---

## Verification

Every change in this session was checked against real data, not just compiled:
- `npx tsc --noEmit` and `npx eslint .` clean at every step (zero errors; only 3 pre-existing, unrelated warnings remain).
- `npm run build` succeeds.
- Logged into the running app and clicked through all 11 tabs/sub-views, confirming: no console errors, no horizontal overflow at 1024px–1440px, the Jira sync completes gracefully against the real (currently permission-blocked) API, the Daily Digest tab shows the real report file from Storage, and cross-navigation (bug ↔ ticket, chart click → filtered Bug Reports) all work.
- Test data created during verification (2 sample tickets) was deleted from the production database afterward.

## 5. Follow-up — Jira sync showing 0 tickets

Reported after §4 shipped. Traced to the real cause rather than re-guessing at permissions: `.env.local`'s `JIRA_EMAIL` was `ashik@yuzee.com`, but the account that actually owns the configured API token is `design@freshfutures.com`. Corrected the email, verified real data flows through immediately, then found and fixed the `ticket_key`/`jira_key` dual-unique-constraint bug described in §4 that surfaced only once real data was flowing. All 244 real YSC tickets are now synced and confirmed idempotent on re-sync.

---

## 6. Polish pass — UX fixes, pipeline accuracy, YSDT sync, Jira pagination

Seven targeted changes requested after §5. All implemented in one pass; `npx tsc --noEmit` and `npx eslint .` clean (0 errors, 3 pre-existing warnings unchanged), `npm run build` succeeds.

### Ticket description field too small
`TicketDetailPanel.tsx` — increased the description textarea `minHeight` from `80` to `200`. The field is also `resize: vertical` so the user can drag it taller if needed.

### Bug Rules name overflow
`TriageRulesTab.tsx` — the Name column already had `maxWidth: 220` but was missing truncation CSS. Added `overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`, and a `title` tooltip on the `<td>` so hovering reveals the full rule name.

### Pipeline tab slow to load
`PipelineTab.tsx` — the "Data Quality" panel fires 6 parallel `COUNT(*)` HEAD queries against Supabase. Previously these ran on every Pipeline page mount regardless of which sub-tab was active. Changed the `useEffect` to include `subTab` in its dependency array and return early when `subTab !== 'quality'`, so the 6 queries only fire when the user actually opens the Data Quality pane. Also initialised `dqLoading` to `false` instead of `true` so the Queue Health sub-tab renders immediately without spurious spinners.

### Overview "Data Pipeline & Integrations" — accuracy fix
`Overview.tsx` — the section incorrectly listed "n8n / Gemini" as a data *source* alongside Rollbar and CloudWatch, even though n8n/Gemini is the *processing* layer that every bug passes through. Fixed:

- Section renamed to **"Bug Sources & Integration Health"**.
- Added an explanatory subtitle: *"Bugs enter via Rollbar, CloudWatch, or user submission. All are then processed by n8n and triaged by Gemini — 100% of bugs go through that pipeline."*
- Replaced the "n8n / Gemini" card with a **"User-Reported"** card showing what percentage of recent bugs came from `source = 'user_report'` or `'yuzee_app'` (manually submitted).
- Renamed the old "PostHog" card to **"AI Triage (Gemini)"** — shows what % of recent bugs have a Gemini `ai_summary`, a genuine pipeline-health indicator.
- Removed the now-unused `getField` import that was previously used for the PostHog session URL check.

The four cards now tell a coherent story: Rollbar (auto-detected errors), CloudWatch (log scanning), User-Reported (manual submissions), AI Triage (Gemini coverage).

### Jira Spaces panel — pagination + YSDT default
`JiraSpacesPanel.tsx`:

- Added client-side pagination capped at **20 tickets per page**. A Prev / Next row sits below the table showing the current range ("1–20 of 244") and total count. If the API returned more tickets than were fetched (i.e. `isLast = false`), an "Open in Jira →" link appears alongside the page controls.
- Per-space page state is tracked separately so switching from YSDT to YSC and back doesn't reset either space's position.
- **Changed the default active tab from `YSC` to `YSDT`** — matching the user's request that the overview should "mainly show the YSDT space tickets".

### YSDT sync
`app/api/jira/sync-tickets/route.ts` — previously only synced the YSC project. Extended to also sync **YSDT** in the same POST request:

- Both spaces are fetched in parallel with `Promise.all([searchJiraJqlAll(YSC), searchJiraJqlAll(YSDT)])`.
- Row mapping is extracted into a local `mapIssues()` helper and called on both result sets before a single combined upsert.
- YSDT ticket keys are `YSDT-xxx` and YSC keys are `YSC-xxx` — they are distinct so there is no conflict on the `ticket_key` unique constraint.
- The response body now includes `{ synced, ysc, ysdt }` counts.
- The sync toast in `TicketsTab` was updated to display `"YSC: N · YSDT: M tickets up to date"`.

### Tickets tab — YSC / YSDT / Internal space switcher
`TicketsTab.tsx` — replaced the coarse "hide Jira" toggle with a proper **space switcher** pill bar:

- Four options: **All** · **YSDT** · **YSC** · **Internal**, each showing a live count badge.
- Space is derived from the `ticket_key` prefix at the point of filtering — no schema change needed: `YSC-*` → YSC, `YSDT-*` → YSDT, `TIX-*` → Internal.
- Selected space is persisted in `localStorage` under `yuzee-tickets-space` so the preference survives page reloads.
- `Eye`/`EyeOff` lucide imports removed (no longer needed); empty-state message updated to reference "this space" rather than the old Jira filter copy.
- `PageInfo` text updated to mention both YSC and YSDT sync.
