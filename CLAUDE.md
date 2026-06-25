# Claude Code Prompt — Yuzee Bug Dashboard Update

## Instructions for Claude Code

Read `CLAUDE.md` in this project first. It documents the project structure, Supabase schema, coding conventions, and component patterns. Every decision you make should be consistent with what is already there.

This prompt describes the full set of changes to make to the Yuzee Bug Dashboard. Read this entire prompt before writing a single line of code. Do not make changes incrementally asking for approval between each step — implement everything described here in one pass, then summarise what was changed.

---

## Context — What the Dashboard Currently Is

The Yuzee Bug Dashboard is a Next.js internal tool for the Yuzee engineering team. It reads from a Supabase database (`bug_reports` table and `gemini_queue` table) in real time. It is admin-only and uses dark theme throughout.

The current dashboard has five tabs:
- **Overview** — metric cards, daily bug volume chart, distribution breakdown, top error clusters, actionable insights
- **All Bugs** — table of all bug reports
- **Error Clusters** — grouped bugs by error pattern
- **Developer** — per-developer bug queue
- **Reports** — analytics

The n8n bug automation pipeline has been significantly updated. Many new columns are now populated in `bug_reports` that were previously always null. The dashboard needs to surface all of this new data. No PostHog integration in this update — that comes later.

---

## New and Updated Supabase Schema

### `bug_reports` table — new columns now populated

These columns now have real data coming from the n8n pipeline. The dashboard must use them:

```typescript
interface BugReport {
  // Existing columns (already in use)
  id:           string;
  report_id:    string;       // RPT-YYYYMMDD-xxxxxx
  source:       string;       // 'rollbar_auto' | 'user_report'
  description:  string;
  platform:     string;       // 'Linux' | 'ios' | 'android' | 'browser'
  status:       string;       // 'pending' | 'triaging' | 'triaged' | 'resolved' | 'complete'
  full_data:    string;       // JSON.stringify of everything — use as fallback only
  created_at:   string;
  
  // NOW POPULATED — surface these everywhere
  severity:          string | null;   // 'P1' | 'P2' | 'P3' | 'P4'
  ai_summary:        string | null;   // Gemini 2-sentence developer summary
  labels:            string | null;   // JSON array string: '["mobile","auth","needs-human-review"]'
  component:         string | null;   // 'Auth' | 'Payment' | 'Search' | 'Profile' | 'Admissions' | 'Dashboard'
  category:          string | null;   // 'backend_error' | 'mobile_error' | 'frontend_error' OR Gemini feature category
  correlation_id:    string | null;   // UUID — use for CloudWatch deep link
  rollbar_id:        string | null;   // Rollbar item counter e.g. "44"
  rollbar_project_id: string | null;  // "748047" (backend) | "782547" (mobile)
  timestamp_utc:     string | null;   // ISO — accurate error time, prefer over created_at
  environment:       string | null;   // 'production' | 'staging' | 'kubernetes'
  jira_key:          string | null;   // 'YSC-157' — link to yuzeeau.atlassian.net/browse/YSC-157
  is_duplicate:      boolean | null;  // true if a Jira ticket already existed
  jira_pending:      boolean | null;  // true if Jira ticket creation failed — needs attention
  posthog_session_url: string | null; // session replay URL — display if present but don't build PostHog features yet
  feature_flags:     string | null;   // JSON string of PostHog flags at crash time
}
```

### `gemini_queue` table — new table, needs a pipeline health view

```typescript
interface GeminiQueueItem {
  id:           string;   // UUID
  report_id:    string;   // links to bug_reports.report_id
  status:       string;   // 'queued' | 'processed' | 'stale' | 'failed'
  queued_at:    string;   // ISO timestamp
  processed_at: string | null;
  created_at:   string;
}
```

### `getField()` utility — REQUIRED, create this once and use everywhere

The `full_data` column stores a JSON.stringify of the complete payload at intake time. For records created before the new n8n pipeline went live, the new columns may be null but the data may exist in `full_data`. Always use this fallback pattern:

```typescript
// Create in lib/utils.ts or equivalent shared utils location
export function getField(record: BugReport, key: string): any {
  const direct = record[key as keyof BugReport];
  if (direct !== null && direct !== undefined) return direct;
  try {
    const full = typeof record.full_data === 'string'
      ? JSON.parse(record.full_data)
      : record.full_data;
    return full?.[key] ?? full?.body?.[key] ?? null;
  } catch { return null; }
}

export function parseLabels(record: BugReport): string[] {
  const raw = getField(record, 'labels');
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return []; }
}

export function parseFeatureFlags(record: BugReport): Record<string, unknown> {
  const raw = getField(record, 'feature_flags');
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return {}; }
}

export function deriveRoutingToken(record: BugReport): 'BACKEND' | 'MOBILE' | 'WEB' | null {
  // Try to extract from Jira summary format: [P2][BACKEND] [#44] ...
  if (record.jira_key) {
    const summary = getField(record, 'jira_summary') as string;
    if (summary?.includes('BACKEND')) return 'BACKEND';
    if (summary?.includes('MOBILE'))  return 'MOBILE';
    if (summary?.includes('WEB'))     return 'WEB';
  }
  // Fall back to category field
  const cat = record.category || '';
  if (cat.includes('backend')) return 'BACKEND';
  if (cat.includes('mobile'))  return 'MOBILE';
  if (cat.includes('frontend')) return 'WEB';
  // Fall back to platform
  const platform = record.platform || '';
  if (platform === 'Linux') return 'BACKEND';
  if (['ios', 'android'].includes(platform.toLowerCase())) return 'MOBILE';
  if (platform === 'browser') return 'WEB';
  return null;
}

export function buildCloudWatchUrl(record: BugReport): string | null {
  if (!record.correlation_id) return null;
  const logGroup = deriveLogGroup(record.location || '');
  const ts  = new Date(record.timestamp_utc || record.created_at).getTime();
  const start = ts - 600_000;
  const end   = ts + 300_000;
  const encoded = encodeURIComponent(logGroup);
  return `https://console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1`
    + `#logsV2:log-groups/log-group/${encoded}`
    + `/log-events?filterPattern="${record.correlation_id}"&start=${start}&end=${end}`;
}

function deriveLogGroup(location: string): string {
  const l = location.toLowerCase();
  if (l.includes('/courses'))    return '/aws/yuzee/course-service';
  if (l.includes('/institutes')) return '/aws/yuzee/institute-service';
  if (l.includes('/search'))     return '/aws/yuzee/search-service';
  if (l.includes('/payment'))    return '/aws/yuzee/payment-service';
  return '/aws/yuzee/user-service';
}

export function rollbarUrl(record: BugReport): string | null {
  if (!record.rollbar_id) return null;
  const project = record.rollbar_project_id === '782547' ? 'NewYuzeeApp' : 'YuzeeWebRollbar';
  return `https://rollbar.com/yuzee/${project}/items/${record.rollbar_id}/`;
}

export function jiraUrl(jiraKey: string | null): string | null {
  if (!jiraKey) return null;
  return `https://yuzeeau.atlassian.net/browse/${jiraKey}`;
}

export function formatTimestamp(record: BugReport): string {
  const ts = record.timestamp_utc || record.created_at;
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}
```

---

## Design Guidelines — Maintain These Throughout

- **Dark theme only.** Keep the existing dark background, card styling, and colour palette exactly as is.
- **Severity colours:** P1 = `#ef4444` (red), P2 = `#f59e0b` (amber/yellow), P3 = `#3b82f6` (blue), P4 = `#6b7280` (grey). These already exist in the codebase — reuse them.
- **Routing token colours:** BACKEND = indigo/purple, MOBILE = teal/cyan, WEB = green. Pick from the existing colour system.
- **Status colours:** complete = green, pending = amber, triaging = purple, resolved = green.
- **Badges must be compact** — pill shape, small text. Never take up more than the column needs.
- **Links open in new tab** (`target="_blank" rel="noopener noreferrer"`).
- **Warning states for data problems** (jira_pending = true, queue stuck > 30 min) use amber `#f59e0b`.
- **Empty states** — every table and list needs a sensible empty state message, not a blank space.
- **Loading states** — skeleton loaders for all async data, consistent with what already exists.
- **Do not change the navigation structure** — same five tabs, same order.

---

## Changes Required Per Section

### 1. Add `getField()` and all utility functions

Create `lib/utils.ts` (or add to existing utils file) with every function listed in the schema section above. Import and use `getField()` everywhere the dashboard reads from `bug_reports`. Replace any existing direct property access (`record.jira_key`) with `getField(record, 'jira_key')` where the column might be null for older records.

---

### 2. Overview Tab — Major Enhancements

#### 2a. Metric Cards Row

Keep the existing 6 cards but update their content and add 2 new cards. Make the cards scroll horizontally on narrow screens. Cards should show:

**Keep and update:**
- **Total Bugs** — keep as is, but subtitle should show date range using `timestamp_utc`
- **P1 Critical** — keep as is
- **P2 High** — keep as is
- **No Jira Ticket** — keep, but also show `jira_pending` count as a sub-label: "39 missing · X failed"
- **Resolved** — keep as is
- **Needs Review** — keep (low-confidence AI triage)

**Add 2 new cards:**
- **Duplicates** — count of `is_duplicate = true`. Subtitle: "already ticketed". Colour: neutral grey.
- **Jira Pending** — count of `jira_pending = true`. Subtitle: "ticket creation failed — needs action". Colour: amber warning. Clicking this card should filter All Bugs to `jira_pending = true` only.

#### 2b. Daily Bug Volume Chart

Keep the chart but improve it:
- Use `timestamp_utc` (not `created_at`) for the date grouping
- Extend to show last 30 days instead of the current 10
- Add a date range picker above the chart (7 days / 14 days / 30 days buttons)
- Show a tooltip on hover with the exact count per severity per day

#### 2c. Distribution Panel

Keep severity and status bars, but add a third section:

**Add: Platform/Routing breakdown**
```
ROUTING
BACKEND  ████████████████████  47
MOBILE   ████████  23
WEB      ████  12
Unknown  ░  5
```
Derive the routing token using `deriveRoutingToken()` for each record.

**Add: Top Components**
```
COMPONENT
Auth      █████████████  31
Payment   ████████  22
Search    █████  14
Profile   ████  11
Other     ███  10
```
Read from `component` column (with `getField()` fallback).

#### 2d. Gemini Pipeline Health — New Widget

Add a new widget below the distribution panel titled **"AI Triage Pipeline"**. Read from `gemini_queue` table.

```
AI Triage Pipeline                        [Last 7 days]
┌────────────┬────────────┬────────────┬────────────┐
│  queued    │ processed  │   stale    │   failed   │
│    3       │   127      │    8       │    2       │
└────────────┴────────────┴────────────┴────────────┘
Avg triage time: 2.4 min

⚠ 2 bugs have been queued > 30 minutes — scheduler may be stuck
   [Re-queue all stuck →]   (calls PATCH /api/requeue-bug?all=true)
```

- Count each status from `gemini_queue` records in the last 7 days
- Calculate avg time as `avg(processed_at - queued_at)` in minutes
- Show warning banner if any row has `status = 'queued'` AND `created_at < now() - 30 minutes`
- The "Re-queue all stuck" button calls a Next.js API route `PATCH /api/requeue-bug?all=true` which updates those rows to `status = 'queued'` in Supabase

#### 2e. Top Error Clusters — Minor Improvements

Keep the existing cluster list but:
- Add a routing token badge (BACKEND / MOBILE / WEB) next to the severity badge on each row
- Make each cluster row clickable — clicking opens All Bugs filtered to that error pattern
- Show the component most common in that cluster as a small tag

#### 2f. Actionable Insights — Add New Insight Types

Add these insight types alongside existing ones:

- **Jira Pending Alert** (amber) — "X bugs failed to create a Jira ticket. Review and retry." — shown if `jira_pending = true` count > 0
- **Pipeline Stuck Alert** (red) — "Gemini triage queue has X bugs stuck > 30 minutes." — shown if stuck queue items exist
- **New Component Spike** (blue) — "Auth component has X new bugs in the last 24 hours — up Y% from yesterday"
- **Duplicate Rate** (neutral) — "X% of bugs this week are duplicates of existing tickets"

---

### 3. All Bugs Tab — Full Rebuild of the Table

The All Bugs table needs to be completely rethought. Keep the same overall layout (filter bar above, table below) but upgrade both significantly.

#### 3a. Filter Bar

Replace or extend existing filters to include all of:

```
[Search by description, report ID, Jira key, error class...]

[Severity ▼]  [Platform ▼]  [Component ▼]  [Source ▼]  [Status ▼]  [Environment ▼]

[Date range: From _____  To _____]   [Has Jira ▼]  [Is Duplicate ▼]  [Jira Pending ▼]

                                                          [Clear filters]  [X active filters]
```

Filter values:
- **Severity:** All / P1 / P2 / P3 / P4
- **Platform:** All / BACKEND / MOBILE / WEB (derived via `deriveRoutingToken()`)
- **Component:** All / Auth / Payment / Search / Profile / Admissions / Dashboard / Unknown
- **Source:** All / rollbar_auto / user_report
- **Status:** All / pending / triaging / triaged / resolved / complete
- **Environment:** All / production / staging
- **Has Jira:** All / Has ticket / No ticket
- **Is Duplicate:** All / Duplicates only / Non-duplicates only
- **Jira Pending:** All / Pending only

The search box should search across: `description`, `report_id`, `jira_key`, `ai_summary`, `component`, `category`, and the error class inside `full_data`.

Show an "X active filters" pill when any non-default filter is applied. Clicking it clears all filters.

#### 3b. Table Columns

Replace the current table columns with:

| Column | Content | Width | Sortable |
|---|---|---|---|
| Severity | P1/P2/P3/P4 pill, colour-coded | 60px | Yes |
| Platform | BACKEND/MOBILE/WEB pill | 80px | Yes |
| Component | Text tag (Auth, Payment, etc.) | 90px | Yes |
| Description | First 80 chars of description. Below it: `ai_summary` in muted grey if available | Fill | No |
| Source | rollbar_auto or user_report, styled differently | 90px | No |
| Environment | production / staging pill | 80px | Yes |
| Jira | YSC-xxx as clickable link, or ⚠ amber if `jira_pending = true`, or — if none | 90px | Yes |
| Rollbar | 🔗 icon link if `rollbar_id` exists | 50px | No |
| Time | Formatted `timestamp_utc` or `created_at`. Show relative time (e.g. "2h ago") with tooltip showing exact datetime | 100px | Yes |
| Flags | 🔄 icon if `is_duplicate`, ⚠ icon if `jira_pending` | 50px | No |

Default sort: `timestamp_utc` descending.

Pagination: 25 rows per page with Previous/Next. Show total count and current range ("1–25 of 137").

#### 3c. Row Click → Bug Detail Side Panel

Clicking any row opens a **side panel** (sliding in from the right, ~45% width, not a full-page navigation). The side panel stays open while the user continues browsing the list — they can close it with Escape or an X button.

The side panel layout from top to bottom:

**Header:**
```
[P2] [MOBILE]  Report ID: RPT-20260623-ak8s2o            [×]
Timestamp: 23 Jun 2026 08:35 AEST  ·  Environment: production  ·  Source: rollbar_auto
```

**Quick Links bar (icon buttons, all open in new tab):**
```
[📋 Jira YSC-44]  [📊 Rollbar #44]  [☁️ CloudWatch]  [▶ Session Replay]
```
- Jira button: disabled and greyed out if no `jira_key`, amber if `jira_pending = true` with tooltip "Ticket creation failed"
- CloudWatch button: disabled and greyed out if no `correlation_id`
- Session Replay button: disabled if no `posthog_session_url` (do not build PostHog features — just show the link if the column has data)

**AI Triage section:**
```
AI Triage                                              [gemini-2.0-flash-lite]
──────────────────────────────────────────────────────
Severity:    P2
Component:   Auth
Category:    mobile_error
Confidence:  95%
Summary:     [ai_summary text here — 1-2 sentences]
Labels:      [mobile]  [auth]  [needs-human-review]
```
Show all fields from the Gemini triage. Parse `labels` JSON array and display as pill badges. If `ai_summary` is null or empty, show "Manual review needed" in muted text. If `confidence` is 0 or missing, show "Triage incomplete" with amber warning.

**Description / What Was Reported:**
```
What Was Reported
──────────────────────────────────────────────────────
[description text]
```

**Rollbar Exception section** (only if `rollbar_id` is present):
```
Exception — Rollbar #44
──────────────────────────────────────────────────────
Error:    org.springframework.core.convert.ConverterNotFoundException
Level:    error
Count:    1 occurrence(s)

Stack Trace (app frames only):
  UserOnboardingController.java:69 — getOnboardingProgress
  UserOnboardingProcessor.java:189 — getProgress
  UserProcessor.java:336 — getUserDocDbById
  UserDaoImpl.java:58 — findUserById
  MappingMongoConverter.java:1137 — readCollectionOrArray
  GenericConversionService.java:322 — handleConverterNotFound

[View full item on Rollbar →]
```
Read this from `full_data.body.rollbar_preload`. The frames array is already filtered to app frames only by the n8n pipeline.

**Rollbar Telemetry section** (only if telemetry array exists in `full_data.body.rollbar_preload.telemetry`):
```
User Actions Before Crash
──────────────────────────────────────────────────────
[08:34:01]  nav:   /guest-user → /login-welcome
[08:34:38]  ERROR  GET https://api.yuzee.com/users/api/... → FAILED (status 0)
[08:35:57]  nav:   /login-welcome → /onboarding-progress
```
Display the telemetry array as a timeline. Use monospace font. Colour-code: network errors red, navigation blue, log entries grey.

**Feature Flags section** (only if `feature_flags` column has data):
```
Active Feature Flags at Time of Bug
──────────────────────────────────────────────────────
new_ai_pathway_prompt_v2:  true
show_session_replay_consent: false
```
Parse the JSON string. Display as key-value pairs.

**Correlation ID / Debug Links section:**
```
Debug Links
──────────────────────────────────────────────────────
Correlation ID:  fee41bce-fb61-4fa1-a428-3cd241054b09  [📋 copy]
Location:        /users/api/v1/onboarding/user/{id}/onboarding-progress
CloudWatch:      [Open in CloudWatch (±15 min window) →]
```
The CloudWatch link is built using `buildCloudWatchUrl()`. Show the correlation_id with a copy-to-clipboard button.

**Manual Actions section (bottom of panel):**
```
Actions
──────────────────────────────────────────────────────
[Re-queue for AI triage]   — only if status = 'triaging' or gemini_queue has a failed/stale row
[Mark as Resolved]         — sets status to 'resolved'
[Mark as Duplicate]        — sets is_duplicate = true
```

---

### 4. Error Clusters Tab — Minor Improvements

Keep the existing cluster grouping logic. Improve the cluster rows to show:
- The routing token badge (BACKEND/MOBILE/WEB) for the cluster's dominant platform
- The most common component in that cluster
- A "View N bugs →" link that opens All Bugs filtered to that error pattern
- A count of P1/P2 bugs in the cluster (critical clusters should be visually distinguished)

---

### 5. Developer Tab — Improve Per-Developer View

The Developer tab should show a clean breakdown per developer. Developers are: Junaid (backend/BACKEND), Shaqeeba (mobile/MOBILE), Ramzan (web/WEB), Asif (AI/Gemini). Ashik is admin.

For each developer, show:
- Their name and role
- Count of bugs assigned to them by severity (P1, P2, P3, P4 pill counts)
- Count of bugs with no Jira ticket (`jira_key IS NULL AND jira_pending IS NULL`)
- Count of `jira_pending = true` (failed tickets needing manual retry)
- A horizontal severity bar similar to the existing distribution chart
- A "View their bugs →" link that opens All Bugs filtered to their routing token

Derive bug assignment from routing token:
- BACKEND → Junaid
- MOBILE → Shaqeeba  
- WEB → Ramzan
- AI/Unknown → Asif

Add a summary at the top: "Total unresolved bugs: X — distributed across Y developers"

---

### 6. New Tab — Pipeline Health

Add a new sixth tab called **"Pipeline"** between "Error Clusters" and "Developer" in the nav.

This tab monitors the health of the n8n bug automation pipeline. It has two sections:

#### 6a. Gemini Queue Health

Full version of the widget from Overview Tab 2d, with more detail:

- A table of recent `gemini_queue` rows (last 7 days): `id`, `report_id` (linked to side panel), `status` badge, `queued_at`, `processed_at`, time-in-queue calculated
- Status badge colours: queued=blue, processed=green, stale=grey, failed=red
- A warning banner at the top if any row has `status = 'queued'` AND `created_at < now() - 30 minutes`
- A "Re-queue" button per failed/stale row: calls `PATCH /api/requeue-bug` with the queue row ID
- A "Re-queue all stuck" button for bulk action
- A summary stats row: total queued / processed / stale / failed in the last 7 days, avg processing time

#### 6b. Data Quality Panel

Show data quality issues so Ashik can identify pipeline problems:

| Issue | Count | Action |
|---|---|---|
| Missing `correlation_id` | N bugs | Indicates CorrelationIdFilter not sending response header |
| Missing `rollbar_id` | N bugs | User-submitted bugs (expected) |
| Missing `jira_key` AND NOT `jira_pending` | N bugs | Pipeline gap — bug processed but no ticket |
| `jira_pending = true` | N bugs | [Retry all →] button |
| `ai_summary` null | N bugs | Gemini triage incomplete |
| `component` = 'Unknown' | N bugs | Gemini couldn't classify |
| Missing `severity` | N bugs | Triage not run |

Each row is a Supabase query result. The "Retry all →" button for jira_pending calls a Next.js API route.

#### 6c. API Route — /api/requeue-bug

Create this API route if it doesn't exist:

```typescript
// pages/api/requeue-bug.ts or app/api/requeue-bug/route.ts

// PATCH /api/requeue-bug?id=queue_row_id  → re-queue single item
// PATCH /api/requeue-bug?all=true         → re-queue all stuck items (queued > 30 min)

// Sets gemini_queue.status = 'queued' for the matched rows
// Returns { requeued: number }
```

---

### 7. Reports Tab — Add Missing Analytics

The Reports tab should have proper analytics. Add the following charts:

**Chart 1 — Bug Volume Trend (30 days)**
Line chart, one line per severity (P1/P2/P3/P4), using `timestamp_utc`, last 30 days.

**Chart 2 — Mean Time to Triage**
Line chart: avg `(gemini_queue.processed_at - gemini_queue.queued_at)` in minutes per day, last 30 days. Target line at 5 min.

**Chart 3 — Bugs by Component**
Horizontal bar chart: count per `component`, sorted descending, last 30 days.

**Chart 4 — Bugs by Platform/Routing**
Donut chart: BACKEND / MOBILE / WEB / Unknown counts, last 30 days.

**Chart 5 — Resolution Rate Over Time**
Line chart: `(count WHERE status = 'complete') / total * 100` per week, last 12 weeks.

**Chart 6 — P1/P2 Response Time**
Bar chart: time from `timestamp_utc` to when `jira_key` was set (if available), grouped by week. Shows how quickly critical bugs get ticketed.

Use whatever charting library is already in the project. If none exists, use `recharts` — it is already available in Next.js projects via npm.

---

### 8. Global — Alert Banner Improvements

The existing P1 alert banner at the top is good. Extend it to also show:
- `jira_pending` alerts: "X bugs failed to create a Jira ticket and need manual attention" — amber background
- Pipeline stuck alerts: "Gemini queue has X bugs stuck for > 30 minutes" — amber background

If no alerts, do not show the banner at all (don't show an empty green "all clear" bar).

Stack multiple banners vertically if multiple alerts exist. Each banner has its own dismiss button (session only — no persistence).

---

### 9. Supabase Queries to Add

Add these queries to the data layer (either in a hooks file or wherever existing Supabase calls live):

```typescript
// Severity distribution (last 30 days)
const { data: severityDist } = await supabase
  .from('bug_reports')
  .select('severity')
  .gte('timestamp_utc', thirtyDaysAgo)
  .not('severity', 'is', null);

// Gemini queue health
const { data: queueHealth } = await supabase
  .from('gemini_queue')
  .select('status, queued_at, processed_at')
  .gte('created_at', sevenDaysAgo);

// Stuck queue items
const { data: stuckItems } = await supabase
  .from('gemini_queue')
  .select('*')
  .eq('status', 'queued')
  .lt('created_at', thirtyMinutesAgo);

// Jira pending bugs
const { data: jiraPending } = await supabase
  .from('bug_reports')
  .select('report_id, description, severity, created_at')
  .eq('jira_pending', true)
  .is('jira_key', null)
  .order('created_at', { ascending: false });

// Component distribution
const { data: componentDist } = await supabase
  .from('bug_reports')
  .select('component')
  .gte('timestamp_utc', thirtyDaysAgo)
  .not('component', 'is', null);

// Data quality counts
const { count: missingCorrelation } = await supabase
  .from('bug_reports')
  .select('*', { count: 'exact', head: true })
  .is('correlation_id', null)
  .eq('source', 'rollbar_auto');  // only rollbar bugs should have correlation_id

const { count: missingJiraNotPending } = await supabase
  .from('bug_reports')
  .select('*', { count: 'exact', head: true })
  .is('jira_key', null)
  .not('status', 'eq', 'pending')  // should have been ticketed
  .not('is_duplicate', 'eq', true) // duplicates don't need tickets
  .is('jira_pending', null);
```

---

## What NOT to Change

- **Authentication flow** — leave admin login exactly as is
- **Supabase real-time subscription** — keep the existing subscription logic
- **Navigation structure** — same 5 tabs become 6 tabs (add Pipeline tab). Do not rename or reorder existing tabs.
- **Toast notifications** — keep the existing toast system
- **CLAUDE.md** — update it at the end to reflect all new components, schema fields, and utility functions added

---

## Order of Implementation

Do these in order so nothing is blocked:

1. Add `getField()` and all utility functions to `lib/utils.ts`
2. Update TypeScript types to include all new `BugReport` fields
3. Add the `GeminiQueueItem` type
4. Add all new Supabase queries
5. Create `/api/requeue-bug` API route
6. Update Overview tab (metric cards, chart, distribution panel, pipeline widget, insights)
7. Rebuild All Bugs tab (filter bar, table columns, side panel)
8. Improve Error Clusters tab
9. Build Pipeline tab (new)
10. Improve Developer tab
11. Improve Reports tab (add charts)
12. Update alert banners
13. Update CLAUDE.md

After all changes are complete, provide a summary of:
- Every file created or modified
- Every new Supabase query added
- Any new npm packages installed
- Any breaking changes or migration notes

---

## Final Checks Before Finishing

Before marking the task complete, verify:
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] `getField()` is used everywhere that reads a potentially-null new column
- [ ] All external links (`jira_key`, `rollbar_id`, `correlation_id`) open in `target="_blank"`
- [ ] All tables have empty state messages
- [ ] All async data has loading skeletons
- [ ] The dark theme is consistent on all new elements
- [ ] Severity colours are consistent (P1=red, P2=amber, P3=blue, P4=grey)
- [ ] The Pipeline tab and Gemini Queue widget reference the correct table (`gemini_queue`)
- [x] CLAUDE.md has been updated

---

## Implementation State (as of 2026-06-25)

All changes from this spec have been implemented. Below is the current state of new and modified files.

### New Files Created

| File | Purpose |
|---|---|
| `lib/utils.ts` | `getField()`, `parseLabels()`, `parseFeatureFlags()`, `deriveRoutingToken()`, `buildCloudWatchUrl()`, `rollbarUrl()`, `jiraUrl()`, `formatTimestamp()`, `relativeTime()`, `ROUTING_COLORS` |
| `hooks/useGeminiQueue.ts` | Fetches `gemini_queue` last 7 days + stuck items (>30 min). Returns `{ stats, loading, error, refresh }`. |
| `app/api/requeue-bug/route.ts` | `PATCH /api/requeue-bug?id=<id>` or `?all=true`. Updates `gemini_queue.status = 'queued'`. Uses `checkAuth()` from `lib/apiAuth`. |
| `components/BugDetailPanel.tsx` | Side panel (46% width, slides in from right) replacing `BugDetailModal`. Shows AI triage, Rollbar exception, telemetry timeline, feature flags, debug links, and actions. |
| `components/PipelineTab.tsx` | 6th tab ("Pipeline"). Shows Gemini queue health table, stuck warning, re-queue buttons, and data quality panel with Supabase counts. |

### Modified Files

| File | Key Changes |
|---|---|
| `lib/bugUtils.ts` | `ParsedBug` now includes `routingToken` (derived via `deriveRoutingToken()`). `DashboardStats` now has `jiraPendingCount`, `duplicateCount`, `routingBreakdown`, `componentBreakdown`. `computeStats()` uses `timestamp_utc \|\| created_at`. |
| `components/DashboardClient.tsx` | Tab type now `'overview' \| 'bugs' \| 'clusters' \| 'pipeline' \| 'developer' \| 'reports'`. Uses `BugDetailPanel` (not `BugDetailModal`). Alert banners for `jira_pending` and stuck pipeline (dismissable). `platform` filter now filters on `routingToken`. `hasJira` and `jiraPending` filters added. `FilterSidebar` removed (inline in BugTable). `BLANK_FILTERS` exported. |
| `components/Overview.tsx` | 8 KPI cards. 30-day chart with 7/14/30 day range picker. Routing + Component breakdown bars. `PipelineWidget` (uses `useGeminiQueue`). Actionable insights with new types. |
| `components/BugTable.tsx` | Inline filter bar (all filter dimensions). Columns: Severity, Platform (routing), Component, Description+ai_summary, Source, Environment, Jira (with jira_pending warning), Rollbar link, Time (relative), Flags. 25-row pagination. |
| `components/BugClusters.tsx` | Routing token badge, topComponent tag, "View N →" button calling `onNavigateToBugs`. |
| `components/DeveloperView.tsx` | Rebuilt as per-developer KPI cards. Junaid=BACKEND, Shaqeeba=MOBILE, Ramzan=WEB, Asif=Unknown. Severity pill counts, severity bar, no-Jira count, jira_pending warning. |
| `components/Reports.tsx` | Six recharts charts: Bug Volume Trend, Mean Time to Triage, Bugs by Component, By Routing (donut), Resolution Rate, P1/P2 Response Time. |
| `hooks/useRealtimeBugs.ts` | Fixed TypeScript circular reference in Supabase channel subscription. |

### New Supabase Queries (in hooks/useGeminiQueue.ts and PipelineTab.tsx)

```typescript
// gemini_queue — last 7 days
supabase.from('gemini_queue').select('*').gte('created_at', sevenDaysAgo)

// stuck items — queued > 30 min
supabase.from('gemini_queue').select('*').eq('status', 'queued').lt('created_at', thirtyMinutesAgo)

// re-queue — PATCH via /api/requeue-bug
supabase.from('gemini_queue').update({ status: 'queued' }).eq('id', id)

// data quality counts (PipelineTab)
supabase.from('bug_reports').select('*', { count: 'exact', head: true }).is('correlation_id', null).eq('source', 'rollbar_auto')
supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('jira_pending', true)
// ... etc (see PipelineTab.tsx for full list)
```

### npm Packages Installed

- `recharts` — charting library used in `Reports.tsx`

### Key Design Decisions

- **`platform` filter in `Filters` type** holds routing tokens (BACKEND/MOBILE/WEB), not raw `platform` values. Filter logic compares against `b.routingToken`.
- **`BLANK_FILTERS` is exported** from `DashboardClient.tsx` for use in `BugTable.tsx`.
- **`BugDetailPanel`** receives `ParsedBug` (not raw `BugReport`) — richer type with `routingToken`, `parsedLabels`, etc.
- **Alert banners are session-dismissed only** — no persistence. Reset on page reload.
- **`getField()`** is the canonical way to read any column that may be null in older records but present in `full_data`.