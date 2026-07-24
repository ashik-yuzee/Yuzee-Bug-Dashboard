# Changelog

## 2026-07-24

### Bug Fixes

**Re-queue button in Pipeline → Queue Health**
- Added `UPDATE` RLS policy to `gemini_queue` in Supabase. The table previously had only `SELECT` access for the anon key, so every update was silently blocked at the database level.
- Fixed `app/api/requeue-bug/route.ts` single-item requeue to use `.select('id')` after the update so the returned count reflects rows actually updated (previously always returned `{ requeued: 1 }` regardless).

**HogQL "Window function inside aggregate" error**
- `new_vs_returning` case in `app/api/posthog/analytics/route.ts` used `min(timestamp) OVER (PARTITION BY distinct_id)` inside `uniqExactIf()`. HogQL rejects this even inside a subquery because its planner inlines window functions back into the outer aggregate.
- Replaced with two parallel `GROUP BY` queries joined in JavaScript: one for total active users per day, one for each user's all-time first pageview day. Zero window functions.

### New Features

**Geographic heatmap in Heatmap tab**
- Added `WorldMapHeatmap` component using `react-simple-maps` + world-atlas topojson (CDN). Countries are filled with a teal gradient scaled to user count (sqrt scale keeps low-user countries visible). Hover tooltip shows country + user count. Legend shows the full scale.
- View toggle at top of Heatmap section: **Activity** (existing day × hour grid) and **Geography** (world map). Geography tab lazy-loads platform country data.
- Below the world map, a 12-country ranked card grid with progress bars.
- `COUNTRY_NAME_MAP` normalises PostHog country name strings to world-atlas topology names (e.g. "United States" → "United States of America", "Czech Republic" → "Czechia").

**Platform tab — Geography / Devices / Network sub-tabs**
- New 4-tab sub-nav: Overview / Geography / Devices / Network.
- Geography: continent donut, timezone ranked list, full countries bar, cities table, states/regions table.
- Devices: OS versions, browser versions, screen resolutions (Mobile/Tablet/Desktop labels), device models.
- Network: carrier breakdown + info card explaining battery/power data is unavailable (Browser Battery Status API deprecated, not captured by PostHog).

**Heatmap — module filter**
- Dropdown filters the activity heatmap by app module. API `heatmap` case now accepts `module` and `page` query params, filtering events by `$screen_name` or `$pathname`.

**PostHog Overview — New vs Returning Users chart**
- Stacked bar chart added below KPI cards, showing new vs returning users per day.

**User IDs — name/email alongside ID**
- User journey search dropdown and selected-user header now show name (bold), email, and UUID in monospace with graceful fallback when empty.

**Color guide fix — Retention tab**
- Replaced cramped text-in-a-box pill with solid color swatch + separate colored label + muted description.

---

## 2026-07-24 (session 2)

### Bug Fixes

**"Daily active users" / New vs Returning chart showing "fetch failed"**
- Root cause: the `new_vs_returning` HogQL query used a nested `IN (SELECT ...)` correlated subquery which PostHog rejects with a fetch-level error. The chart is subtitled "Daily breakdown" so the user read it as a DAU failure.
- Fix: replaced with two parallel, simple `GROUP BY` queries joined in JavaScript — one for total active users per day, one for first-ever pageview day per user filtered to the window. No window functions, no nested IN subqueries.

**Jira ticket retry was a stub (showed a toast but did nothing)**
- `retryJira` in `PipelineTab.tsx` was `toast.info('Manual retry not automated yet')`.
- `bug_reports` table only had a `SELECT` RLS policy; updates were silently blocked.
- Fix:
  1. Added `UPDATE` RLS policy to `bug_reports` in Supabase.
  2. Created `app/api/jira/retry/route.ts` — `POST /api/jira/retry` fetches all `jira_pending = true` bugs (or a single bug via `{ reportId }` body), creates Jira tickets using the same format as the n8n pipeline, then writes the resulting `jira_key` back to Supabase and clears `jira_pending`.
  3. Wired up `PipelineTab.tsx` "Retry all →" button to call the new route with a spinner state.
  4. Added amber "Retry Jira Ticket Creation" button in `BugDetailPanel.tsx` Actions section — shown only when `jira_pending === true && !jira_key`, triggers a single-bug retry.

**Geographic heatmap (from session 1)**
- Added `WorldMapHeatmap` component and "Activity / Geography" view toggle to Heatmap sub-tab.
- Re-queue button was wired but Supabase UPDATE was blocked by RLS — fixed by adding UPDATE policy to `gemini_queue` (session 1).

### New Files
- `app/api/jira/retry/route.ts` — Jira ticket retry endpoint

### Packages Added
- `react-simple-maps` — world map SVG rendering
- `@types/react-simple-maps` (dev) — TypeScript types
