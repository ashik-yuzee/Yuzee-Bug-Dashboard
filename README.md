# Yuzee Bug Monitor — v3

```bash
npm install && npm run dev
```

## What changed in v3

### State handling
- **Toast system** — every action (refresh, copy, sign-out, AI, realtime, errors) produces a typed notification (success / error / warning / info / loading) that auto-dismisses with a progress bar
- **Real-time subscriptions** — Supabase Postgres changes channel watches for INSERT events; a banner appears when new bugs arrive with "Load now" / "Dismiss"
- **Network detection** — offline banner + auto-refresh on reconnect
- **Auth session monitor** — `onAuthStateChange` fires a toast and redirects on session expiry
- **Gemini rate limiter** — sliding 60s window, capped at 12 RPM (below Gemini's 15 RPM free tier limit). Shows a live countdown when rate-limited and auto-retries when the window clears. Tracks daily usage (cap: 1400/day)
- **Abort controller** — AI analysis can be cancelled mid-flight; unmount cleans up in-flight requests
- **60s timeout** — Gemini calls abort after 60s with a friendly message
- **Exponential backoff retry** — transient errors retry up to 2× with jitter; 429s use a hard 15s backoff; 4xx errors are never retried
- **Error boundaries** — each major section (sidebar, main content) is wrapped; one crash shows a scoped error UI with "Try again" rather than killing the whole page
- **Supabase error handling** — refresh distinguishes 429 (rate limit), offline, and generic errors with specific toast messages

### Accessibility (WCAG 2.1 AA)
- All interactive elements have `aria-label` or visible text
- Sortable table columns use `aria-sort` and descriptive `aria-label`
- Checkboxes use `role="checkbox"` with `aria-checked="mixed"` for indeterminate
- Filter groups use `<fieldset>` + `<legend>` (native semantics, no custom ARIA)
- Modals use `role="dialog" aria-modal="true"` + Escape key handler
- Loading indicators use `role="status"` or `aria-live="polite"` / `"assertive"`
- Icons are `aria-hidden`; icon-only buttons have `aria-label`
- `focus-visible` rings on all interactive elements (2px orange, offset 2px)
- Reduced-motion media query suppresses all animations

### Color system (verified WCAG AA+)
All text/background pairs verified with relative luminance calculation:
- Text primary `#E6EDF3`: 14.64:1 on surface ✅ AAA
- Text secondary `#8B949E`: 5.62:1 ✅ AA
- Text muted `#7D8590`: 4.64:1 ✅ AA
- P1 red `#FF7B72`: 4.88:1 ✅ AA
- P2 amber `#E3B341`: 8.89:1 ✅ AAA
- P3 blue `#58A6FF`: 6.85:1 ✅ AA
- Success `#3FB950`: 6.81:1 ✅ AA
- Orange `#F97316`: 6.17:1 ✅ AA

## Environment variables
Pre-filled in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_GEMINI_API_KEY` — Google AI Studio key
