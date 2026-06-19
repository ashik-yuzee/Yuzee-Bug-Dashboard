# Yuzee Bug Dashboard — Claude Code Instructions

## Read this before touching anything

1. Run `find . -type f | grep -v node_modules | grep -v .next | grep -v .git | sort`
   to see the actual file tree. It may differ from what this document describes.
2. Read `app/globals.css` — all colours and design tokens live there.
3. Read `lib/bugUtils.ts` — all data transformation and stats live there.
4. Read `components/DashboardClient.tsx` — this is the top-level state manager.
5. Use this document for **intent and domain context**, not as a source of truth
   about the current code. The user has made manual edits — trust the files.

---

## What this project is

**Yuzee Bug Dashboard** — internal engineering dashboard for Yuzee, an Australian
university admissions platform (yuzeeau.atlassian.net). It reads bug reports from
a Supabase table populated by an n8n automation pipeline and gives the dev team a
single place to monitor, triage, and act on production bugs.

**Engineering team:**
- Ashik — technical lead (primary user of this dashboard)
- Junaid — backend (Java Spring Boot + Jersey)
- Ramzan — web frontend (Angular + Ionic)
- Shaqeeba — mobile frontend (Ionic + Capacitor)

---

## Changes already made to v3 (apply these if not already present)

These prompts were run on the v3 codebase. Check each one — if the change is
already in the code, skip it. If it is not, apply it.

### 1. No registration page — hardcoded admin login

Remove the `/register` route entirely (delete `app/register/` folder and all links
to it). The app has exactly one set of credentials:

```
Username / email : admin
Password         : yuzeeadmin@2026
```

Because Supabase Auth requires a real email address, the actual Supabase account
must be created manually in the Supabase dashboard once:

1. Go to Supabase project → Authentication → Users → Add user
2. Email: `admin@yuzee.internal` (or any internal address — doesn't matter)
3. Password: `yuzeeadmin@2026`
4. On the login page, the label should say "Username" not "Email", the placeholder
   should say "admin", but the actual value submitted to Supabase must be the real
   email address (`admin@yuzee.internal`). Map it on submit:
   ```typescript
   const emailMap: Record<string, string> = {
     admin: 'admin@yuzee.internal',
   }
   const actualEmail = emailMap[email.toLowerCase()] ?? email
   await supabase.auth.signInWithPassword({ email: actualEmail, password })
   ```
5. The "No account? Create one" link must be removed from the login page.

### 2. App name is "Yuzee Bug Dashboard"

Every instance of "Yuzee Bug Monitor" → "Yuzee Bug Dashboard" (page title,
header logo text, metadata, README).

### 3. Error Clusters page — fix the UI

The clusters page was showing broken lines instead of proper cards. Ensure:
- Each cluster renders as a self-contained card with a visible border and
  background (`var(--surface-1)` card on `var(--bg)` page background)
- The card has: rank number, severity badge, error type badge, description
  (truncated, monospace), occurrence count, severity mini-bar, status mini-bar,
  Jira links, and an AI analysis button
- Expandable section shows individual bugs in a clean sub-list
- No raw `<div>` lines bleeding into each other — each card must be visually
  separated with `gap` or `margin`, not just borders on a flat list

### 4. Duplicate grouping

The Error Clusters tab must explicitly call out duplicates:

- At the top of the clusters list, show a banner: "X bugs are marked as duplicates
  — Y unique root errors identified" 
- `is_duplicate: true` bugs are grouped under their parent cluster and shown
  with a "DUPLICATE" tag in the expanded list
- The cluster count badge shows total reports AND unique root errors separately:
  e.g. "14 reports / 1 root error"
- In the Overview tab, the duplicate stat card should link to the Clusters tab

### 5. Module classification

Every bug must be classified into one of four modules based on existing fields:

```typescript
function getModule(bug: ParsedBug): 'WEB' | 'APP' | 'BACKEND' | 'INFRASTRUCTURE' {
  const src  = bug.source || ''
  const plat = (bug.platform || '').toLowerCase()
  const comp = (bug.component || '').toLowerCase()
  const desc = (bug.description || '').toLowerCase()
  const errT = bug.errorType

  if (src === 'rollbar_auto' && (errT === 'InvokeException' || errT === 'NullPointerException'))
    return 'BACKEND'
  if (plat === 'linux' || desc.includes('aws') || desc.includes('cloudwatch') ||
      desc.includes('kubernetes') || desc.includes('502') || desc.includes('503'))
    return 'INFRASTRUCTURE'
  if (src === 'yuzee_app' || plat === 'desktop' || comp.includes('mobile'))
    return 'APP'
  return 'WEB'
}
```

Add `module` as a derived field in `parseBug()` inside `lib/bugUtils.ts`.

Module badge colours:
- WEB — `var(--p3)` (blue)
- APP — `var(--purple)` (purple)
- BACKEND — `var(--warning)` (amber)
- INFRASTRUCTURE — `var(--danger)` (red)

Module filter must be added to `FilterSidebar.tsx`. The Overview tab must show
a "By Module" breakdown bar chart.

### 6. Dashboard layout — five sections

The dashboard now has **five tabs**, not three. Update `DashboardClient.tsx`:

```
Overview      — Executive summary (see below)
All Bugs      — Sortable, filterable table (existing)
Error Clusters— Grouped by root error (existing, fixed)
Developer View— Deep technical detail per bug (NEW — see below)
Reports       — Aggregated summaries by module/environment/time (NEW — see below)
```

---

## Sections to build (static layout for now, real data later)

These two sections are NEW. Build them with static/placeholder data first.
Real data will be wired in once the API keys are provided.

### Developer View tab

This is the **one-stop technical view** for an engineer debugging a specific bug.
It is NOT the same as the detail modal. It is a full-page view.

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ Bug selector (search/dropdown to pick a bug by Jira key │
│ or report ID)                                           │
└─────────────────────────────────────────────────────────┘

┌─── Left column (40%) ───────┐ ┌─── Right column (60%) ──────┐
│ Bug metadata card            │ │ Tab strip:                   │
│  • Severity badge            │ │   Rollbar | PostHog |        │
│  • Module badge              │ │   CloudWatch | AI Analysis   │
│  • Status                    │ │                              │
│  • Component                 │ │ [Rollbar tab]                │
│  • Platform / environment    │ │   Error title                │
│  • Jira link                 │ │   Level + occurrences        │
│  • Reporter                  │ │   Stack trace (scrollable,   │
│  • Created / triaged         │ │   monospace, line numbers)   │
│                              │ │                              │
│ AI Summary card              │ │ [PostHog tab]                │
│  (purple highlight box)      │ │   Event count                │
│                              │ │   User trail timeline        │
│ Jira actions                 │ │   (timestamp → event name)   │
│  • Add comment               │ │                              │
│  • Move status               │ │ [CloudWatch tab]             │
│  • Create ticket (if none)   │ │   Log line count             │
│                              │ │   Raw log output             │
│ Related bugs                 │ │   (monospace, copyable)      │
│  (same Rollbar item or       │ │                              │
│   same description)          │ │ [AI Analysis tab]            │
│                              │ │   Gemini prompt input        │
│                              │ │   Analysis output            │
└──────────────────────────────┘ └──────────────────────────────┘
```

For now, build this layout with placeholder text everywhere data will come from
external APIs (Rollbar, PostHog, CloudWatch). Clearly mark placeholders:
```tsx
<div className="placeholder-block">
  🔌 Rollbar data will appear here once ROLLBAR_API_KEY is configured
</div>
```

### Reports tab

Executive summary view. Think of it as what you'd show in a standup.

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ Time range selector: Today | Last 7 days | Last 30 days │
└─────────────────────────────────────────────────────────┘

┌── By Module ──────────────────────────────────────────┐
│  WEB: 42 bugs  ████████████████░░░░  P1:2 P2:14       │
│  APP: 31 bugs  ████████████░░░░░░░░  P1:0 P2:8        │
│  BACKEND: 28   ███████████░░░░░░░░░  P1:1 P2:11       │
│  INFRA:   16   ██████░░░░░░░░░░░░░░  P1:1 P2:3        │
└───────────────────────────────────────────────────────┘

┌── By Environment ─────────────────────────────────────┐
│  production:  89 bugs  (76%)                           │
│  kubernetes:  23 bugs  (20%)                           │
│  unknown:      5 bugs   (4%)                           │
└───────────────────────────────────────────────────────┘

┌── By Source ──────────────────────────────────────────┐
│  Rollbar (automated):  94   ██████████████████         │
│  User reports:         14   ███                        │
│  Yuzee App:             9   ██                         │
└───────────────────────────────────────────────────────┘

┌── Where complaints come from ─────────────────────────┐
│ This section shows user-reported bugs only             │
│ • Top affected pages/endpoints (from full_data)        │
│ • Top reporting users (anonymised if needed)           │
│ • Frequency of "company profile", "signup", etc.       │
└───────────────────────────────────────────────────────┘

┌── Bug classification by type ─────────────────────────┐
│  TypeError          ████████████ 33                    │
│  Backend exception  ████████     17                    │
│  HTTP errors        █████        12                    │
│  Null pointer       ████         9                     │
│  Chunk load         ██           5                     │
│  Other              ████         11                    │
└───────────────────────────────────────────────────────┘

┌── Infrastructure issues ──────────────────────────────┐
│ Placeholder — will show AWS CloudWatch metrics,        │
│ EC2 / ECS health, and deployment correlation once      │
│ AWS credentials are configured.                        │
│ 🔌 Awaiting: AWS_ACCESS_KEY, AWS_SECRET_KEY, AWS_REGION│
└───────────────────────────────────────────────────────┘
```

All of this is derived from existing Supabase data except the infrastructure
section. Build everything except that section with live data. Show the
infrastructure section as a clearly marked placeholder.

---

## API keys and external services — what to ask the user for

Before wiring up the Developer View's external data panels, ask Ashik for:

| What you need | Where it goes | What it unlocks |
|---------------|---------------|-----------------|
| Rollbar API key (read token) | `ROLLBAR_API_KEY` in .env.local | Stack traces, occurrence counts, deploy tracking |
| Rollbar account slug | `ROLLBAR_ACCOUNT` in .env.local | e.g. "yuzee" |
| Rollbar project names | `ROLLBAR_PROJECT_WEB`, `ROLLBAR_PROJECT_APP` | Which project to query |
| PostHog project API key | `POSTHOG_API_KEY` in .env.local | User journey replays, event trails |
| PostHog project ID | `POSTHOG_PROJECT_ID` in .env.local | e.g. 436283 |
| AWS Access Key ID | `AWS_ACCESS_KEY_ID` in .env.local | CloudWatch log queries |
| AWS Secret Access Key | `AWS_SECRET_ACCESS_KEY` in .env.local | CloudWatch log queries |
| AWS Region | `AWS_REGION` in .env.local | e.g. ap-southeast-2 |
| CloudWatch log group name(s) | `CLOUDWATCH_LOG_GROUP` in .env.local | Which logs to query |
| Jira API key | `JIRA_API_KEY` in .env.local | Create/update tickets from dashboard |
| Jira email | `JIRA_EMAIL` in .env.local | Atlassian account email for the key |
| Teams webhook URL | `TEAMS_WEBHOOK_URL` in .env.local | Push alerts to dev channel |
| n8n workflow JSON | Upload the file | Understand the full automation pipeline |

**Do not ask for all of these at once.** Ask only for what is needed for the
specific feature being built. Start with Jira (most immediately useful) and
Rollbar (needed for Developer View).

**Never expose server-side keys to the browser.** Any key without `NEXT_PUBLIC_`
prefix must only be used in `app/api/**` server routes.

---

## Supabase schema (current — verify against live DB)

**Table: `bug_reports`**

| Column | Type | Notes |
|--------|------|-------|
| report_id | text PK | Format: RPT-YYYYMMDD-xxxxxx |
| source | text | rollbar_auto \| user_report \| yuzee_app |
| reporter_email | text | null for automated |
| description | text | Raw error message |
| platform | text | browser \| Linux \| desktop \| web |
| app_version | text | e.g. 0.0.1(1275), 1.0.0.RC1 |
| severity | text | P1 \| P2 \| P3 \| P4 |
| ai_summary | text | Gemini-generated summary |
| jira_key | text | e.g. YSC-43 (null if not yet created) |
| jira_url | text | Full Jira browse URL |
| status | text | pending \| triaging \| complete |
| created_at | timestamptz | |
| full_data | text | Double-encoded JSON (see below) |
| category | text | auth \| backend_error \| crash \| payment \| infrastructure \| other |
| location | text | Affected page or endpoint |
| frequency | text | "5 occurrence(s)" etc. |
| labels | text | JSON array string e.g. '["bug","needs-human-review"]' |
| component | text | Auth \| Profile \| Admissions \| Payment \| Unknown |
| confidence | float | 0.0–1.0 AI triage confidence |
| is_duplicate | bool | |
| triaged_at | timestamptz | |
| screenshot_url | text | S3 URL |
| jira_pending | bool | Jira creation failed, needs retry |
| retry_count | int | |

**Parsing `full_data`** (double-encoded — parse twice):
```typescript
const fd    = JSON.parse(bug.full_data || '{}')
const inner = JSON.parse(fd.full_data  || '{}')

const rb   = inner._rb         || {}  // Rollbar: title, level, occurrences, frames, item_url
const ph   = inner._posthog    || {}  // PostHog: event_count, trail
const cw   = inner._cloudwatch || {}  // CloudWatch: line_count, logs
const ctx  = inner.context     || {}  // environment, page_url, timestamp_utc
const sess = inner.session     || {}  // posthog_session_id, posthog_session_url
```

---

## Design system (do not change these)

All colours are CSS variables. Never hardcode hex. Read `app/globals.css` for
the full list. Key ones:

```
Backgrounds : --bg --surface-1 --surface-2 --surface-3 --hover
Borders     : --border --border-hi
Text        : --tx-1 (primary) --tx-2 (secondary) --tx-3 (muted)
Brand       : --orange --orange-dim --orange-ring
Severity    : --p1 (red) --p2 (amber) --p3 (blue) --p4 (grey)
Semantic    : --success --warning --danger --info --purple
Status      : --complete --pending --triaging
Radii       : --r-sm --r-md --r-lg --r-xl
```

Module badge colours (new — add to globals.css if not there):
```css
--module-web:   var(--p3)       /* blue */
--module-app:   var(--purple)   /* purple */
--module-be:    var(--warning)  /* amber */
--module-infra: var(--danger)   /* red */
```

Typography helpers (CSS classes): `.font-brand` (Space Grotesk), `.font-mono`
(JetBrains Mono). Use `.font-mono` for all error messages, IDs, stack traces,
log output.

Animation classes: `.anim-fadeup .anim-fadein .anim-slidein .anim-spin .anim-pulse`
Loading skeleton: `.skeleton` (shimmer animation).
Badge base: `.badge` with `.badge-p1 .badge-p2 .badge-p3 .badge-p4`.

---

## Toast system

Module singleton — no context needed. Import anywhere:

```typescript
import toast from '@/lib/toast'

toast.success('Done')
toast.error('Failed', errorMessage, 8000)  // 8s duration
toast.warning('Watch out', 'Details here')
toast.info('FYI', 'Details')
const id = toast.loading('Working…')       // sticky
toast.dismiss(id)
```

`ToastContainer` is already rendered in `app/layout.tsx`.

---

## Gemini AI

Model: `gemini-2.0-flash-lite`
Key: `NEXT_PUBLIC_GEMINI_API_KEY` (browser-safe, in .env.local)

Always check rate limiter before calling:
```typescript
import geminiLimiter from '@/lib/rateLimiter'
const check = geminiLimiter.canRequest()
if (!check.ok) { /* show countdown */ return }
geminiLimiter.record()
// now call Gemini
```

Always wrap the fetch in `withRetry` from `lib/withRetry.ts` and use an
`AbortController` so the request can be cancelled.

---

## Conventions

**Styling:** Use inline styles with CSS variables. The project does NOT use
Tailwind utility classes — Tailwind is imported only for its base reset.

**State:** All dashboard state lives in `DashboardClient.tsx`. Prop-drill down.
No Zustand, no Redux, no React Query.

**Error handling:** Every async action → try/catch → `toast.error()`. Loading
states use `toast.loading()` + `toast.dismiss()`.

**Accessibility:** All icon-only buttons need `aria-label`. Interactive elements
need `focus-visible` (already in globals.css). Modals need `role="dialog"
aria-modal="true"` and Escape key handler.

**API routes** (`app/api/**`): Always auth-check first:
```typescript
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

**Adding a new tab:**
1. Add to the `Tab` type union in `DashboardClient.tsx`
2. Add to the `tabs` array (with icon + optional badge)
3. Add the render block in the `<main>` section
4. Create the component in `components/`
5. Wrap in `<ErrorBoundary>`

**Adding a new filter:**
1. Add field to `Filters` type in `DashboardClient.tsx`
2. Add to `BLANK_FILTERS`
3. Add filter logic in the `filtered` useMemo
4. Add UI in `FilterSidebar.tsx`
5. Include in `activeFilterCount`

---

## What NOT to do

- Do not add a registration page or any public sign-up flow
- Do not expose `JIRA_API_KEY`, `ROLLBAR_API_KEY`, `AWS_*`, or `TEAMS_WEBHOOK_URL`
  to the browser — these are server-only
- Do not hardcode hex colours — use CSS variables
- Do not install new UI component libraries (no shadcn, MUI, Chakra, etc.)
- Do not add Zustand, React Query, or similar state libraries
- Do not change the toast singleton pattern to a context/provider

---

## Current state summary (as of the prompts run on v3)

| Feature | Status |
|---------|--------|
| Auth — admin-only login, no registration | Applied |
| App renamed to "Yuzee Bug Dashboard" | Applied |
| Error Clusters UI fixed | Applied |
| Duplicate grouping in clusters | Applied |
| Module classification (WEB/APP/BACKEND/INFRA) | Applied |
| Developer View tab — static layout | Applied |
| Reports tab — static layout | Applied |
| Module filter in sidebar | Applied |
| By-Module breakdown in Overview | Applied |
| Jira API routes (create/comment/transition) | In v3 code |
| Teams API route | In v3 code |
| Rollbar data in Developer View — live | Awaiting ROLLBAR_API_KEY |
| PostHog data in Developer View — live | Awaiting POSTHOG_API_KEY |
| CloudWatch data in Developer View — live | Awaiting AWS_* keys |
| Gemini queue (5-min batching in n8n) | Awaiting n8n workflow changes |

If any "Applied" item is missing from the actual codebase, implement it now
before moving on to new features.
