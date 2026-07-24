import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const POSTHOG_BASE = 'https://us.posthog.com'
const PH_KEY       = process.env.POSTHOG_API_KEY || ''
const PH_PROJECT   = process.env.POSTHOG_PROJECT_ID || ''

const headers = () => ({
  Authorization: `Bearer ${PH_KEY}`,
  'Content-Type': 'application/json',
})

/* Run a HogQL query and return results[][]. Throws on non-2xx. */
async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${POSTHOG_BASE}/api/projects/${PH_PROJECT}/query`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`HogQL ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return (data.results ?? []) as unknown[][]
}

/* Run a PostHog REST API GET endpoint */
async function phGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${POSTHOG_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PH_KEY}` },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`PostHog GET ${path} → ${res.status}: ${txt.slice(0, 300)}`)
  }
  return res.json()
}

function num(v: unknown): number  { return typeof v === 'number' ? v : Number(v ?? 0) }
function str(v: unknown): string  { return v == null ? '' : String(v) }

/* ─────────────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  if (!PH_KEY)     return NextResponse.json({ error: 'PostHog API key not configured', code: 'no_key' }, { status: 503 })
  if (!PH_PROJECT) return NextResponse.json({ error: 'PostHog project ID not configured', code: 'no_project' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'overview'
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10), 1), 90)

  try {
    switch (type) {
      /* ── overview: combined KPIs ─────────────────────────────────────── */
      case 'overview': {
        const [
          dauRow, mauRow, sessionRow,
          todayEventsRow, totalEventsRow,
          customTopRows,
          bounceRows,
          avgDurRows,
        ] = await Promise.all([
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= today()`),
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= toStartOfMonth(now())`),
          hogql(`SELECT uniqExact(properties.$session_id) FROM events WHERE timestamp >= today() AND notEmpty(toString(properties.$session_id))`),
          hogql(`SELECT count() FROM events WHERE timestamp >= today()`),
          hogql(`SELECT count() FROM events WHERE timestamp >= now() - INTERVAL 30 DAY`),
          hogql(`
            SELECT event, count() as c, uniqExact(distinct_id) as u
            FROM events
            WHERE timestamp >= now() - INTERVAL 7 DAY
              AND event NOT LIKE '$%'
            GROUP BY event ORDER BY c DESC LIMIT 5
          `),
          hogql(`
            SELECT
              countIf(session_events = 1) as bounced,
              count() as total
            FROM (
              SELECT properties.$session_id as sid, count() as session_events
              FROM events
              WHERE timestamp >= now() - INTERVAL 7 DAY
                AND notEmpty(toString(properties.$session_id))
              GROUP BY sid
            )
          `),
          hogql(`
            SELECT avg(session_duration) as avg_sec
            FROM (
              SELECT
                properties.$session_id as sid,
                dateDiff('second', min(timestamp), max(timestamp)) as session_duration
              FROM events
              WHERE timestamp >= now() - INTERVAL 7 DAY
                AND notEmpty(toString(properties.$session_id))
              GROUP BY sid
              HAVING session_duration > 0
            )
          `),
        ])

        const bounced = num(bounceRows[0]?.[0])
        const totalSessions = num(bounceRows[0]?.[1])
        const bounceRate = totalSessions > 0 ? Math.round((bounced / totalSessions) * 100) : 0

        return NextResponse.json({
          dau:         num(dauRow[0]?.[0]),
          mau:         num(mauRow[0]?.[0]),
          sessions:    num(sessionRow[0]?.[0]),
          eventsToday: num(todayEventsRow[0]?.[0]),
          events30d:   num(totalEventsRow[0]?.[0]),
          bounceRate,
          avgSessionSec: Math.round(num(avgDurRows[0]?.[0])),
          topCustomEvents: customTopRows.map(r => ({ event: str(r[0]), count: num(r[1]), users: num(r[2]) })),
        })
      }

      /* ── dau: daily active users trend ──────────────────────────────── */
      case 'dau': {
        const rows = await hogql(`
          SELECT toDate(timestamp) as day, uniqExact(distinct_id) as users
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY day ORDER BY day
        `)
        return NextResponse.json(rows.map(r => ({ date: str(r[0]), users: num(r[1]) })))
      }

      /* ── events_trend: total events per day ─────────────────────────── */
      case 'events_trend': {
        const rows = await hogql(`
          SELECT
            toDate(timestamp) as day,
            countIf(NOT startsWith(event, '$')) as custom_events,
            countIf(startsWith(event, '$'))     as auto_events,
            count() as total,
            uniqExact(distinct_id) as users
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY day ORDER BY day
        `)
        return NextResponse.json(rows.map(r => ({
          date:         str(r[0]),
          customEvents: num(r[1]),
          autoEvents:   num(r[2]),
          total:        num(r[3]),
          users:        num(r[4]),
        })))
      }

      /* ── top_events: top events by count ────────────────────────────── */
      case 'top_events': {
        const [allRows, prevRows] = await Promise.all([
          hogql(`
            SELECT
              event,
              count() as total,
              uniqExact(distinct_id) as unique_users,
              countIf(timestamp >= now() - INTERVAL 1 DAY) as today
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY event
            ORDER BY total DESC LIMIT 40
          `),
          hogql(`
            SELECT event, count() as total
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days * 2} DAY
              AND timestamp < now() - INTERVAL ${days} DAY
            GROUP BY event
          `),
        ])
        const prevMap = new Map(prevRows.map(r => [str(r[0]), num(r[1])]))
        return NextResponse.json(allRows.map(r => {
          const ev    = str(r[0])
          const total = num(r[1])
          const prev  = prevMap.get(ev) ?? 0
          const pct   = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null
          return { event: ev, total, uniqueUsers: num(r[2]), today: num(r[3]), prevTotal: prev, changePct: pct }
        }))
      }

      /* ── pages: pageview paths ──────────────────────────────────────── */
      case 'pages': {
        const rows = await hogql(`
          SELECT
            coalesce(nullIf(toString(properties.$pathname), ''), nullIf(toString(properties.$current_url), ''), '(unknown)') as path,
            count() as views,
            uniqExact(distinct_id) as unique_users,
            uniqExact(properties.$session_id) as sessions,
            avg(dateDiff('second', timestamp, timestamp)) as avg_time_sec
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
            AND event = '$pageview'
          GROUP BY path
          ORDER BY views DESC LIMIT 30
        `)
        return NextResponse.json(rows.map(r => ({
          path:        str(r[0]),
          views:       num(r[1]),
          uniqueUsers: num(r[2]),
          sessions:    num(r[3]),
        })))
      }

      /* ── screens: same as pages but for mobile $screen events ──────── */
      case 'screens': {
        const rows = await hogql(`
          SELECT
            coalesce(nullIf(toString(properties.$screen_name), ''), '(unknown)') as screen,
            count() as views,
            uniqExact(distinct_id) as users
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
            AND event = '$screen'
          GROUP BY screen
          ORDER BY views DESC LIMIT 30
        `)
        return NextResponse.json(rows.map(r => ({ screen: str(r[0]), views: num(r[1]), users: num(r[2]) })))
      }

      /* ── sessions: recent sessions ──────────────────────────────────── */
      case 'sessions': {
        const rows = await hogql(`
          SELECT
            toString(properties.$session_id) as session_id,
            any(distinct_id) as user_id,
            any(properties.$browser) as browser,
            any(properties.$os) as os,
            any(properties.$device_type) as device_type,
            any(properties.$geoip_country_name) as country,
            min(timestamp) as started_at,
            max(timestamp) as last_event_at,
            dateDiff('second', min(timestamp), max(timestamp)) as duration_sec,
            count() as event_count,
            uniqExact(properties.$pathname) as pages_visited,
            countIf(event = '$pageview') as pageviews,
            any(properties.$initial_referring_domain) as referrer
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
            AND notEmpty(toString(properties.$session_id))
          GROUP BY session_id
          ORDER BY started_at DESC
          LIMIT 100
        `)
        return NextResponse.json(rows.map(r => ({
          sessionId:   str(r[0]),
          userId:      str(r[1]),
          browser:     str(r[2]),
          os:          str(r[3]),
          deviceType:  str(r[4]),
          country:     str(r[5]),
          startedAt:   str(r[6]),
          lastEventAt: str(r[7]),
          durationSec: num(r[8]),
          eventCount:  num(r[9]),
          pages:       num(r[10]),
          pageviews:   num(r[11]),
          referrer:    str(r[12]),
        })))
      }

      /* ── platforms: OS / browser / device breakdown ─────────────────── */
      case 'platforms': {
        const [osRows, browserRows, deviceRows, countryRows] = await Promise.all([
          hogql(`
            SELECT coalesce(nullIf(toString(properties.$os),''),'Unknown') as os,
              uniqExact(distinct_id) as users
            FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY os ORDER BY users DESC LIMIT 12
          `),
          hogql(`
            SELECT coalesce(nullIf(toString(properties.$browser),''),'Unknown') as b,
              uniqExact(distinct_id) as users
            FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY b ORDER BY users DESC LIMIT 12
          `),
          hogql(`
            SELECT coalesce(nullIf(toString(properties.$device_type),''),'Unknown') as d,
              uniqExact(distinct_id) as users
            FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY d ORDER BY users DESC LIMIT 8
          `),
          hogql(`
            SELECT coalesce(nullIf(toString(properties.$geoip_country_name),''),'Unknown') as country,
              uniqExact(distinct_id) as users
            FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY country ORDER BY users DESC LIMIT 15
          `),
        ])
        return NextResponse.json({
          os:      osRows.map(r      => ({ name: str(r[0]), users: num(r[1]) })),
          browser: browserRows.map(r => ({ name: str(r[0]), users: num(r[1]) })),
          device:  deviceRows.map(r  => ({ name: str(r[0]), users: num(r[1]) })),
          country: countryRows.map(r => ({ name: str(r[0]), users: num(r[1]) })),
        })
      }

      /* ── users: recent distinct users ───────────────────────────────── */
      case 'users': {
        const rows = await hogql(`
          SELECT
            distinct_id,
            any(properties.$email) as email,
            any(properties.$name) as name,
            any(properties.$geoip_country_name) as country,
            any(properties.$os) as os,
            any(properties.$browser) as browser,
            min(timestamp) as first_seen,
            max(timestamp) as last_seen,
            uniqExact(toString(properties.$session_id)) as sessions,
            count() as events
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
          GROUP BY distinct_id
          ORDER BY last_seen DESC
          LIMIT 100
        `)
        return NextResponse.json(rows.map(r => ({
          distinctId: str(r[0]),
          email:      str(r[1]),
          name:       str(r[2]),
          country:    str(r[3]),
          os:         str(r[4]),
          browser:    str(r[5]),
          firstSeen:  str(r[6]),
          lastSeen:   str(r[7]),
          sessions:   num(r[8]),
          events:     num(r[9]),
        })))
      }

      /* ── feature_flags: flags list from PostHog API ─────────────────── */
      case 'feature_flags': {
        const data = await phGet(`/api/projects/${PH_PROJECT}/feature_flags/?limit=100&active=true`)
        const results = (data.results ?? []) as Record<string, unknown>[]
        return NextResponse.json(results.map(f => {
          const filters = (f.filters ?? {}) as Record<string, unknown>
          const groups  = (filters.groups ?? []) as Record<string, unknown>[]
          const rollout = groups[0]?.rollout_percentage ?? null
          const mv      = filters.multivariate as Record<string, unknown> | undefined
          return {
            id:                 num(f.id),
            key:                str(f.key),
            name:               str(f.name),
            enabled:            Boolean(f.active),
            rolloutPercentage:  rollout != null ? num(rollout) : null,
            hasVariants:        Boolean(mv?.variants),
            variants:           mv?.variants ?? null,
            groupCount:         groups.length,
            createdAt:          str(f.created_at),
            updatedAt:          str(f.last_modified),
          }
        }))
      }

      /* ── funnel: critical path conversion analysis ───────────────────── */
      case 'funnel': {
        // DAU split by whether they hit key screens/pages
        const [signupRows, onboardRows, searchRows, applyRows, completedRows] = await Promise.all([
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND event IN ('user_signed_up', 'Signed Up', '$identify')`),
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND (event = 'onboarding_started' OR properties.$pathname LIKE '%onboard%' OR properties.$screen_name LIKE '%onboard%')`),
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND (event = 'search_performed' OR properties.$pathname LIKE '%search%' OR properties.$screen_name LIKE '%search%')`),
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND (event LIKE '%apply%' OR event LIKE '%application%' OR properties.$pathname LIKE '%appl%' OR properties.$screen_name LIKE '%appl%')`),
          hogql(`SELECT uniqExact(distinct_id) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND (event LIKE '%complete%' OR event LIKE '%submitted%' OR event = 'application_submitted')`),
        ])
        const steps = [
          { label: 'Signed Up / Identified', count: num(signupRows[0]?.[0]) },
          { label: 'Reached Onboarding',     count: num(onboardRows[0]?.[0]) },
          { label: 'Used Search',             count: num(searchRows[0]?.[0]) },
          { label: 'Started Application',     count: num(applyRows[0]?.[0]) },
          { label: 'Completed / Submitted',   count: num(completedRows[0]?.[0]) },
        ]
        const top = steps[0].count || 1
        return NextResponse.json(steps.map((s, i) => ({
          ...s,
          pct: Math.round((s.count / top) * 100),
          dropPct: i > 0 && steps[i - 1].count > 0
            ? Math.round(((steps[i - 1].count - s.count) / steps[i - 1].count) * 100)
            : 0,
        })))
      }

      /* ── new_vs_returning: user retention signal ────────────────────── */
      case 'new_vs_returning': {
        // Two separate GROUP BY queries — no window functions, no IN subqueries.
        // Query 1: total active users per day in the window.
        // Query 2: users whose all-time first pageview falls inside the window, grouped by that first day.
        // Returning = total - new for each day.
        const [totalRows, firstSeenRows] = await Promise.all([
          hogql(`
            SELECT toDate(timestamp) as day, uniqExact(distinct_id) as total_users
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
              AND event = '$pageview'
            GROUP BY day ORDER BY day
          `),
          hogql(`
            SELECT day, count() as new_users
            FROM (
              SELECT distinct_id, toDate(min(timestamp)) as day
              FROM events
              WHERE event = '$pageview'
              GROUP BY distinct_id
            )
            WHERE day >= toDate(now() - INTERVAL ${days} DAY)
            GROUP BY day ORDER BY day
          `),
        ])
        const newMap = new Map(firstSeenRows.map(r => [str(r[0]), num(r[1])]))
        return NextResponse.json(totalRows.map(r => {
          const day   = str(r[0])
          const total = num(r[1])
          const newU  = newMap.get(day) ?? 0
          return { date: day, newUsers: newU, returningUsers: Math.max(0, total - newU) }
        }))
      }

      /* ── retention: weekly cohort retention (simplified) ────────────── */
      case 'retention': {
        const rows = await hogql(`
          SELECT
            toStartOfWeek(first_seen) as cohort_week,
            dateDiff('week', toStartOfWeek(first_seen), toStartOfWeek(last_seen)) as weeks_retained,
            uniqExact(distinct_id) as users
          FROM (
            SELECT
              distinct_id,
              min(timestamp) as first_seen,
              max(timestamp) as last_seen
            FROM events
            WHERE timestamp >= now() - INTERVAL 12 WEEK
            GROUP BY distinct_id
          )
          GROUP BY cohort_week, weeks_retained
          ORDER BY cohort_week, weeks_retained
          LIMIT 200
        `)
        return NextResponse.json(rows.map(r => ({
          cohortWeek: str(r[0]), weeksRetained: num(r[1]), users: num(r[2]),
        })))
      }

      /* ── dropoff: exit pages, last action, session depth ───────────── */
      case 'dropoff': {
        const [exitScreens, exitPages, lastAction, depthRows, entryRows] = await Promise.all([
          // Last mobile screen before session ended
          hogql(`
            SELECT
              coalesce(nullIf(toString(last_screen),''),'(unknown)') as screen,
              count() as exits,
              uniqExact(user) as users
            FROM (
              SELECT
                properties.$session_id as sid,
                any(distinct_id) as user,
                argMax(properties.$screen_name, timestamp) as last_screen
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString(properties.$session_id))
                AND event = '$screen'
              GROUP BY sid
            )
            GROUP BY screen ORDER BY exits DESC LIMIT 20
          `),
          // Last web page before session ended
          hogql(`
            SELECT
              coalesce(nullIf(toString(last_page),''),'(unknown)') as page,
              count() as exits,
              uniqExact(user) as users
            FROM (
              SELECT
                properties.$session_id as sid,
                any(distinct_id) as user,
                argMax(properties.$pathname, timestamp) as last_page
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString(properties.$session_id))
                AND event = '$pageview'
              GROUP BY sid
            )
            GROUP BY page ORDER BY exits DESC LIMIT 20
          `),
          // Last event before session ended (what did they do last?)
          hogql(`
            SELECT
              last_event,
              count() as sessions,
              uniqExact(user) as users
            FROM (
              SELECT
                properties.$session_id as sid,
                any(distinct_id) as user,
                argMax(event, timestamp) as last_event
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString(properties.$session_id))
              GROUP BY sid
            )
            GROUP BY last_event ORDER BY sessions DESC LIMIT 20
          `),
          // Session depth distribution (events per session)
          hogql(`
            SELECT
              CASE
                WHEN event_count = 1  THEN '1 event'
                WHEN event_count <= 3 THEN '2-3 events'
                WHEN event_count <= 5 THEN '4-5 events'
                WHEN event_count <= 10 THEN '6-10 events'
                WHEN event_count <= 20 THEN '11-20 events'
                ELSE '20+ events'
              END as depth_bucket,
              count() as sessions,
              avg(duration_sec) as avg_duration
            FROM (
              SELECT
                properties.$session_id as sid,
                count() as event_count,
                dateDiff('second', min(timestamp), max(timestamp)) as duration_sec
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString(properties.$session_id))
              GROUP BY sid
            )
            GROUP BY depth_bucket ORDER BY min(event_count)
          `),
          // Entry screens (first screen in session - where did they start?)
          hogql(`
            SELECT
              coalesce(nullIf(toString(first_screen),''),'(unknown)') as screen,
              count() as sessions,
              avg(session_events) as avg_events_after
            FROM (
              SELECT
                properties.$session_id as sid,
                argMin(properties.$screen_name, timestamp) as first_screen,
                count() as session_events
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString(properties.$session_id))
              GROUP BY sid
            )
            GROUP BY screen ORDER BY sessions DESC LIMIT 15
          `),
        ])

        return NextResponse.json({
          exitScreens: exitScreens.map(r => ({ screen: str(r[0]), exits: num(r[1]), users: num(r[2]) })),
          exitPages:   exitPages.map(r   => ({ page: str(r[0]),   exits: num(r[1]), users: num(r[2]) })),
          lastAction:  lastAction.map(r  => ({ event: str(r[0]),  sessions: num(r[1]), users: num(r[2]) })),
          depth:       depthRows.map(r   => ({ bucket: str(r[0]), sessions: num(r[1]), avgDuration: Math.round(num(r[2])) })),
          entryScreens: entryRows.map(r  => ({ screen: str(r[0]), sessions: num(r[1]), avgEventsAfter: Math.round(num(r[2])) })),
        })
      }

      /* ── modules: module visit frequency + engagement time ──────────── */
      case 'modules': {
        const moduleCase = (field: string) => `
          CASE
            WHEN lower(${field}) LIKE '%home%'        THEN 'Home'
            WHEN lower(${field}) LIKE '%search%'       THEN 'Search'
            WHEN lower(${field}) LIKE '%institute%'    THEN 'Institutes'
            WHEN lower(${field}) LIKE '%course%'       THEN 'Courses'
            WHEN lower(${field}) LIKE '%application%'  THEN 'Applications'
            WHEN lower(${field}) LIKE '%apply%'        THEN 'Applications'
            WHEN lower(${field}) LIKE '%profile%'      THEN 'Profile'
            WHEN lower(${field}) LIKE '%onboard%'      THEN 'Onboarding'
            WHEN lower(${field}) LIKE '%login%'        THEN 'Auth'
            WHEN lower(${field}) LIKE '%signup%'       THEN 'Auth'
            WHEN lower(${field}) LIKE '%register%'     THEN 'Auth'
            WHEN lower(${field}) LIKE '%welcome%'      THEN 'Auth'
            WHEN lower(${field}) LIKE '%setting%'      THEN 'Settings'
            WHEN lower(${field}) LIKE '%notification%' THEN 'Notifications'
            WHEN lower(${field}) LIKE '%chat%'         THEN 'Chat'
            WHEN lower(${field}) LIKE '%message%'      THEN 'Chat'
            WHEN lower(${field}) LIKE '%document%'     THEN 'Documents'
            WHEN lower(${field}) LIKE '%upload%'       THEN 'Documents'
            WHEN lower(${field}) LIKE '%dashboard%'    THEN 'Dashboard'
            WHEN lower(${field}) LIKE '%explore%'      THEN 'Explore'
            WHEN ${field} = '' OR ${field} IS NULL     THEN '(unknown)'
            ELSE 'Other'
          END
        `

        const [screenModules, pageModules, sessionModuleTime] = await Promise.all([
          // Mobile screen module breakdown
          hogql(`
            SELECT
              ${moduleCase('toString(properties.$screen_name)')} as module,
              count() as views,
              uniqExact(distinct_id) as users,
              uniqExact(properties.$session_id) as sessions
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND event = '$screen'
            GROUP BY module ORDER BY views DESC
          `),
          // Web page module breakdown
          hogql(`
            SELECT
              ${moduleCase('toString(properties.$pathname)')} as module,
              count() as views,
              uniqExact(distinct_id) as users,
              uniqExact(properties.$session_id) as sessions
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND event = '$pageview'
            GROUP BY module ORDER BY views DESC
          `),
          // Avg events per session per module (proxy for time/engagement)
          hogql(`
            SELECT
              ${moduleCase('toString(properties.$screen_name)')} as module,
              count() as total_events,
              uniqExact(properties.$session_id) as sessions,
              round(count() / uniqExact(properties.$session_id), 1) as avg_events_per_session
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
              AND notEmpty(toString(properties.$screen_name))
            GROUP BY module ORDER BY total_events DESC
          `),
        ])

        // Merge screen + page module data
        const merged: Record<string, { views: number; users: number; sessions: number; avgEventsPerSession: number }> = {}
        for (const r of screenModules) {
          const m = str(r[0]); merged[m] = { views: num(r[1]), users: num(r[2]), sessions: num(r[3]), avgEventsPerSession: 0 }
        }
        for (const r of pageModules) {
          const m = str(r[0])
          if (merged[m]) { merged[m].views += num(r[1]); merged[m].users = Math.max(merged[m].users, num(r[2])); merged[m].sessions += num(r[3]) }
          else merged[m] = { views: num(r[1]), users: num(r[2]), sessions: num(r[3]), avgEventsPerSession: 0 }
        }
        for (const r of sessionModuleTime) {
          const m = str(r[0]); if (merged[m]) merged[m].avgEventsPerSession = num(r[3])
        }

        const modules = Object.entries(merged)
          .map(([module, d]) => ({ module, ...d }))
          .sort((a, b) => b.views - a.views)

        return NextResponse.json({ modules })
      }

      /* ── ai_usage: AI feature events, tokens, cost per user ─────────── */
      case 'ai_usage': {
        const aiFilter = `(
          lower(event) LIKE '%ai%'
          OR lower(event) LIKE '%gemini%'
          OR lower(event) LIKE '%gpt%'
          OR lower(event) LIKE '%llm%'
          OR lower(event) LIKE '%recommend%'
          OR lower(event) LIKE '%suggest%'
          OR lower(event) LIKE '%generate%'
          OR lower(event) LIKE '%analyse%'
          OR lower(event) LIKE '%analyze%'
          OR lower(event) LIKE '%summariz%'
          OR lower(event) LIKE '%match%'
          OR notEmpty(toString(properties.ai_feature))
          OR notEmpty(toString(properties.model))
          OR toIntOrZero(toString(properties.tokens_used)) > 0
          OR toIntOrZero(toString(properties.prompt_tokens)) > 0
          OR toIntOrZero(toString(properties.completion_tokens)) > 0
        )`

        const [aiOverview, aiTrend, aiEvents, aiUsers, aiModels] = await Promise.all([
          // Overview counts
          hogql(`
            SELECT
              count() as total_requests,
              uniqExact(distinct_id) as unique_users,
              sum(toIntOrZero(toString(properties.tokens_used)) +
                  toIntOrZero(toString(properties.prompt_tokens)) +
                  toIntOrZero(toString(properties.completion_tokens))) as total_tokens
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND ${aiFilter}
          `),
          // Daily AI request trend
          hogql(`
            SELECT
              toDate(timestamp) as day,
              count() as requests,
              uniqExact(distinct_id) as users,
              sum(toIntOrZero(toString(properties.tokens_used)) +
                  toIntOrZero(toString(properties.prompt_tokens)) +
                  toIntOrZero(toString(properties.completion_tokens))) as tokens
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND ${aiFilter}
            GROUP BY day ORDER BY day
          `),
          // Top AI event types
          hogql(`
            SELECT
              event,
              count() as total,
              uniqExact(distinct_id) as users,
              sum(toIntOrZero(toString(properties.tokens_used)) +
                  toIntOrZero(toString(properties.prompt_tokens)) +
                  toIntOrZero(toString(properties.completion_tokens))) as tokens
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND ${aiFilter}
            GROUP BY event ORDER BY total DESC LIMIT 20
          `),
          // Per-user AI usage
          hogql(`
            SELECT
              distinct_id,
              any(properties.$email) as email,
              any(properties.$name) as name,
              count() as requests,
              sum(toIntOrZero(toString(properties.tokens_used)) +
                  toIntOrZero(toString(properties.prompt_tokens)) +
                  toIntOrZero(toString(properties.completion_tokens))) as tokens,
              uniqExact(toString(properties.$session_id)) as sessions_with_ai,
              max(timestamp) as last_used
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND ${aiFilter}
            GROUP BY distinct_id ORDER BY requests DESC LIMIT 50
          `),
          // AI model breakdown
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.model),''), nullIf(toString(properties.ai_model),''), 'unspecified') as model,
              count() as total,
              sum(toIntOrZero(toString(properties.tokens_used)) +
                  toIntOrZero(toString(properties.prompt_tokens)) +
                  toIntOrZero(toString(properties.completion_tokens))) as tokens
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY AND ${aiFilter}
            GROUP BY model ORDER BY total DESC LIMIT 10
          `),
        ])

        const totalTokens = num(aiOverview[0]?.[2])
        // Rough cost estimate: ~$0.000002/token (weighted avg of common models)
        const COST_PER_TOKEN = 0.000002
        const estimatedCost = totalTokens * COST_PER_TOKEN

        return NextResponse.json({
          overview: {
            totalRequests: num(aiOverview[0]?.[0]),
            uniqueUsers:   num(aiOverview[0]?.[1]),
            totalTokens,
            estimatedCost: Math.round(estimatedCost * 100) / 100,
          },
          trend: aiTrend.map(r => ({
            date: str(r[0]), requests: num(r[1]), users: num(r[2]), tokens: num(r[3]),
            cost: Math.round(num(r[3]) * COST_PER_TOKEN * 10000) / 10000,
          })),
          events: aiEvents.map(r => ({
            event: str(r[0]), total: num(r[1]), users: num(r[2]), tokens: num(r[3]),
            cost: Math.round(num(r[3]) * COST_PER_TOKEN * 10000) / 10000,
          })),
          users: aiUsers.map(r => ({
            distinctId: str(r[0]), email: str(r[1]), name: str(r[2]),
            requests: num(r[3]), tokens: num(r[4]), sessionsWithAI: num(r[5]), lastUsed: str(r[6]),
            cost: Math.round(num(r[4]) * COST_PER_TOKEN * 10000) / 10000,
          })),
          models: aiModels.map(r => ({
            model: str(r[0]), total: num(r[1]), tokens: num(r[2]),
            cost: Math.round(num(r[2]) * COST_PER_TOKEN * 10000) / 10000,
          })),
        })
      }

      /* ── pathways: screen-to-screen transitions + session duration ─── */
      case 'pathways': {
        const screenExpr = `coalesce(
          nullIf(toString(properties.$screen_name), ''),
          nullIf(toString(properties.$pathname), '')
        )`

        const [pathRows, durationBuckets, statsRows] = await Promise.all([
          // Top 5-step session paths (groupArray preserves ORDER BY from inner query)
          hogql(`
            SELECT
              arrayElement(screens, 1) as s1,
              arrayElement(screens, 2) as s2,
              arrayElement(screens, 3) as s3,
              arrayElement(screens, 4) as s4,
              arrayElement(screens, 5) as s5,
              count() as sessions,
              avg(toInt(dur_sec)) as avg_dur_sec
            FROM (
              SELECT
                toString($session_id) as sess,
                groupArray(screen_name) as screens,
                toInt(dateDiff('second', min(timestamp), max(timestamp))) as dur_sec
              FROM (
                SELECT
                  $session_id,
                  timestamp,
                  ${screenExpr} as screen_name
                FROM events
                WHERE (event = '$screen' OR event = '$pageview')
                  AND timestamp >= now() - INTERVAL ${days} DAY
                  AND notEmpty(toString($session_id))
                  AND notEmpty(${screenExpr})
                ORDER BY $session_id, timestamp
              )
              GROUP BY sess
            )
            WHERE s1 != ''
            GROUP BY s1, s2, s3, s4, s5
            ORDER BY sessions DESC
            LIMIT 50
          `),
          // Session duration buckets (how long before drop-off)
          hogql(`
            SELECT
              CASE
                WHEN dur_sec < 60   THEN '< 1 min'
                WHEN dur_sec < 300  THEN '1-5 min'
                WHEN dur_sec < 900  THEN '5-15 min'
                WHEN dur_sec < 1800 THEN '15-30 min'
                ELSE '30+ min'
              END as bucket,
              count() as sessions,
              avg(dur_sec) as avg_sec
            FROM (
              SELECT toInt(dateDiff('second', min(timestamp), max(timestamp))) as dur_sec
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString($session_id))
              GROUP BY $session_id
              HAVING dur_sec >= 0
            )
            GROUP BY bucket
          `),
          // Overall session stats
          hogql(`
            SELECT
              count() as total_sessions,
              avg(toInt(dur_sec)) as avg_dur_sec,
              quantile(0.5)(dur_sec) as median_dur_sec
            FROM (
              SELECT toInt(dateDiff('second', min(timestamp), max(timestamp))) as dur_sec
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
                AND notEmpty(toString($session_id))
              GROUP BY $session_id
              HAVING dur_sec > 0
            )
          `),
        ])

        // Derive A→B transitions from path data (server-side JS, no LEAD needed)
        const transMap = new Map<string, number>()
        for (const r of pathRows) {
          const steps = [str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4])].filter(Boolean)
          const count = num(r[5])
          for (let i = 0; i < steps.length - 1; i++) {
            const from = steps[i], to = steps[i + 1]
            if (!from || !to || from === to) continue
            const key = `${from}|||${to}`
            transMap.set(key, (transMap.get(key) ?? 0) + count)
          }
        }
        const transitions = [...transMap.entries()]
          .map(([key, count]) => { const [from, to] = key.split('|||'); return { from, to, count } })
          .sort((a, b) => b.count - a.count)
          .slice(0, 40)

        const bucketOrder = ['< 1 min', '1-5 min', '5-15 min', '15-30 min', '30+ min']

        return NextResponse.json({
          transitions,
          topPaths: pathRows.slice(0, 20).map(r => ({
            screens: [str(r[0]), str(r[1]), str(r[2])].filter(Boolean),
            count: num(r[5]),
            avgDurSec: Math.round(num(r[6])),
          })),
          timeBeforeDropoff: durationBuckets
            .map(r => ({ bucket: str(r[0]), sessions: num(r[1]), avgSec: Math.round(num(r[2])) }))
            .sort((a, b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket)),
          avgSessionSec:    Math.round(num(statsRows[0]?.[1])),
          medianSessionSec: Math.round(num(statsRows[0]?.[2])),
          totalSessions:    num(statsRows[0]?.[0]),
        })
      }

      /* ── errors: PostHog error events (app-captured exceptions) ─────── */
      case 'errors': {
        const rows = await hogql(`
          SELECT
            toDate(timestamp) as day,
            coalesce(
              nullIf(toString(properties.$exception_type),''),
              nullIf(toString(properties.error_class),''),
              event
            ) as error_type,
            count() as occurrences,
            uniqExact(distinct_id) as users_affected
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
            AND (
              event LIKE '%error%' OR event LIKE '%Error%' OR event LIKE '%exception%'
              OR event = '$exception'
              OR toUInt8OrZero(toString(properties.$exception_type)) > 0
            )
          GROUP BY day, error_type
          ORDER BY day DESC, occurrences DESC
          LIMIT 100
        `)
        return NextResponse.json(rows.map(r => ({
          date: str(r[0]), errorType: str(r[1]), occurrences: num(r[2]), usersAffected: num(r[3]),
        })))
      }

      /* ── user_search: find users by email / name / id ─────────────── */
      case 'user_search': {
        const q = searchParams.get('q') ?? ''
        if (!q.trim()) return NextResponse.json({ users: [] })
        const escaped = q.replace(/'/g, "''")
        const rows = await hogql(`
          SELECT
            distinct_id,
            any(properties.$email) as email,
            any(properties.$name) as name,
            max(timestamp) as last_seen,
            count() as events
          FROM events
          WHERE timestamp >= now() - INTERVAL 90 DAY
            AND (
              lower(toString(properties.$email)) LIKE lower('%${escaped}%')
              OR lower(toString(properties.$name)) LIKE lower('%${escaped}%')
              OR lower(distinct_id) LIKE lower('%${escaped}%')
            )
          GROUP BY distinct_id
          ORDER BY last_seen DESC
          LIMIT 10
        `)
        return NextResponse.json({
          users: rows.map(r => ({
            distinctId: str(r[0]), email: str(r[1]), name: str(r[2]),
            lastSeen: str(r[3]), events: num(r[4]),
          }))
        })
      }

      /* ── user_journey: all events for one user, ordered ────────────── */
      case 'user_journey': {
        const userId = searchParams.get('userId') ?? ''
        if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
        const escaped = userId.replace(/'/g, "''")
        const rows = await hogql(`
          SELECT
            event,
            timestamp,
            coalesce(
              nullIf(toString(properties.$screen_name), ''),
              nullIf(toString(properties.$pathname), ''),
              ''
            ) as screen,
            toString(properties.$session_id) as session_id,
            toString(properties.$os) as os,
            toString(properties.$browser) as browser,
            toString(properties.$device_type) as device
          FROM events
          WHERE distinct_id = '${escaped}'
            AND timestamp >= now() - INTERVAL ${days} DAY
          ORDER BY timestamp ASC
          LIMIT 500
        `)
        return NextResponse.json({
          userId,
          events: rows.map(r => ({
            event: str(r[0]), timestamp: str(r[1]), screen: str(r[2]),
            sessionId: str(r[3]), os: str(r[4]), browser: str(r[5]), device: str(r[6]),
          }))
        })
      }

      /* ── cohorts: weekly cohort retention grid ──────────────────────── */
      case 'cohorts': {
        const [firstRows, activityRows] = await Promise.all([
          hogql(`
            SELECT distinct_id, toStartOfWeek(min(timestamp)) as cohort_week
            FROM events
            WHERE timestamp >= now() - INTERVAL 12 WEEK
            GROUP BY distinct_id
          `),
          hogql(`
            SELECT distinct_id, toStartOfWeek(timestamp) as activity_week
            FROM events
            WHERE timestamp >= now() - INTERVAL 12 WEEK
            GROUP BY distinct_id, activity_week
          `),
        ])

        const cohortMap = new Map<string, { ids: Set<string>; weeks: Map<number, number> }>()
        for (const r of firstRows) {
          const uid = str(r[0]), week = str(r[1])
          if (!cohortMap.has(week)) cohortMap.set(week, { ids: new Set(), weeks: new Map() })
          cohortMap.get(week)!.ids.add(uid)
        }
        const userCohort = new Map(firstRows.map(r => [str(r[0]), str(r[1])]))
        for (const r of activityRows) {
          const uid = str(r[0]), actWeek = str(r[1])
          const cw = userCohort.get(uid)
          if (!cw) continue
          const cohort = cohortMap.get(cw)
          if (!cohort?.ids.has(uid)) continue
          const weekNum = Math.round((new Date(actWeek).getTime() - new Date(cw).getTime()) / (7 * 24 * 3600_000))
          cohort.weeks.set(weekNum, (cohort.weeks.get(weekNum) ?? 0) + 1)
        }

        const cohorts = [...cohortMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-12)
          .map(([week, data]) => ({
            week,
            size: data.ids.size,
            weeks: [...data.weeks.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([weekNum, retained]) => ({
                weekNum,
                retained,
                pct: Math.round((retained / Math.max(data.ids.size, 1)) * 100),
              })),
          }))

        return NextResponse.json({ cohorts })
      }

      /* ── heatmap: events by day-of-week × hour-of-day ───────────────── */
      case 'heatmap': {
        const module = searchParams.get('module') ?? ''
        const page   = searchParams.get('page') ?? ''
        let filterClause = ''
        if (module && module !== 'all') {
          const esc = module.replace(/'/g, "''").toLowerCase()
          filterClause = `AND (lower(toString(properties.$screen_name)) LIKE '%${esc}%' OR lower(toString(properties.$pathname)) LIKE '%${esc}%')`
        } else if (page && page !== 'all') {
          const esc = page.replace(/'/g, "''")
          filterClause = `AND toString(properties.$pathname) LIKE '%${esc}%'`
        }
        const rows = await hogql(`
          SELECT
            toDayOfWeek(timestamp) as dow,
            toHour(timestamp) as hour,
            count() as events,
            uniqExact(distinct_id) as users
          FROM events
          WHERE timestamp >= now() - INTERVAL ${days} DAY
            ${filterClause}
          GROUP BY dow, hour
          ORDER BY dow, hour
        `)
        return NextResponse.json(rows.map(r => ({
          dow: num(r[0]), hour: num(r[1]), events: num(r[2]), users: num(r[3]),
        })))
      }

      /* ── geo_detail: cities, timezones, continents ─────────────────────── */
      case 'geo_detail': {
        const [cities, timezones, continents, regions] = await Promise.all([
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.$geoip_city_name),''), 'Unknown') as city,
              coalesce(nullIf(toString(properties.$geoip_country_name),''), 'Unknown') as country,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY city, country ORDER BY users DESC LIMIT 30
          `),
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.$geoip_time_zone),''), 'Unknown') as tz,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY tz ORDER BY users DESC LIMIT 20
          `),
          hogql(`
            SELECT
              CASE
                WHEN toString(properties.$geoip_continent_code) = 'AF' THEN 'Africa'
                WHEN toString(properties.$geoip_continent_code) = 'AN' THEN 'Antarctica'
                WHEN toString(properties.$geoip_continent_code) = 'AS' THEN 'Asia'
                WHEN toString(properties.$geoip_continent_code) = 'EU' THEN 'Europe'
                WHEN toString(properties.$geoip_continent_code) = 'NA' THEN 'North America'
                WHEN toString(properties.$geoip_continent_code) = 'OC' THEN 'Oceania'
                WHEN toString(properties.$geoip_continent_code) = 'SA' THEN 'South America'
                ELSE 'Unknown'
              END as continent,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY continent ORDER BY users DESC
          `),
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.$geoip_subdivision_1_name),''), 'Unknown') as region,
              coalesce(nullIf(toString(properties.$geoip_country_name),''), 'Unknown') as country,
              uniqExact(distinct_id) as users
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY region, country ORDER BY users DESC LIMIT 25
          `),
        ])
        return NextResponse.json({
          cities:     cities.map(r     => ({ city: str(r[0]), country: str(r[1]), users: num(r[2]), events: num(r[3]) })),
          timezones:  timezones.map(r  => ({ tz: str(r[0]), users: num(r[1]), events: num(r[2]) })),
          continents: continents.map(r => ({ continent: str(r[0]), users: num(r[1]), events: num(r[2]) })),
          regions:    regions.map(r    => ({ region: str(r[0]), country: str(r[1]), users: num(r[2]) })),
        })
      }

      /* ── device_detail: OS versions, browser versions, screens, network ─── */
      case 'device_detail': {
        const [osVersions, browserVersions, screenSizes, deviceModels, networkTypes] = await Promise.all([
          hogql(`
            SELECT
              concat(
                coalesce(nullIf(toString(properties.$os),''), 'Unknown'), ' ',
                coalesce(nullIf(toString(properties.$os_version),''), '')
              ) as os_ver,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY os_ver ORDER BY users DESC LIMIT 15
          `),
          hogql(`
            SELECT
              concat(
                coalesce(nullIf(toString(properties.$browser),''), 'Unknown'), ' ',
                coalesce(nullIf(toString(properties.$browser_version),''), '')
              ) as browser_ver,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY browser_ver ORDER BY users DESC LIMIT 15
          `),
          hogql(`
            SELECT
              concat(
                toString(toIntOrZero(toString(properties.$screen_width))), '×',
                toString(toIntOrZero(toString(properties.$screen_height)))
              ) as screen_size,
              uniqExact(distinct_id) as users,
              count() as sessions
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
              AND toIntOrZero(toString(properties.$screen_width)) > 0
              AND toIntOrZero(toString(properties.$screen_height)) > 0
            GROUP BY screen_size ORDER BY users DESC LIMIT 15
          `),
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.$device),''), 'Unknown') as device_model,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY device_model ORDER BY users DESC LIMIT 15
          `),
          hogql(`
            SELECT
              coalesce(
                nullIf(toString(properties.$network_carrier),''),
                nullIf(toString(properties.$network_type),''),
                'Unknown'
              ) as network,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY network ORDER BY users DESC LIMIT 10
          `),
        ])
        return NextResponse.json({
          osVersions:     osVersions.map(r     => ({ version: str(r[0]).trim(), users: num(r[1]), events: num(r[2]) })),
          browserVersions: browserVersions.map(r => ({ version: str(r[0]).trim(), users: num(r[1]), events: num(r[2]) })),
          screenSizes:    screenSizes.map(r    => ({ size: str(r[0]), users: num(r[1]), sessions: num(r[2]) })),
          deviceModels:   deviceModels.map(r   => ({ model: str(r[0]), users: num(r[1]), events: num(r[2]) })),
          networkTypes:   networkTypes.map(r   => ({ network: str(r[0]), users: num(r[1]), events: num(r[2]) })),
        })
      }

      /* ── growth: new users trend, traffic sources, geography ────────── */
      case 'growth': {
        const [weeklyNew, sources, countries] = await Promise.all([
          hogql(`
            SELECT toStartOfWeek(first_seen) as week, count() as new_users
            FROM (
              SELECT distinct_id, min(timestamp) as first_seen
              FROM events
              WHERE timestamp >= now() - INTERVAL ${days} DAY
              GROUP BY distinct_id
            )
            GROUP BY week ORDER BY week
          `),
          hogql(`
            SELECT
              coalesce(
                nullIf(toString(properties.$initial_referring_domain), ''),
                nullIf(toString(properties.$referring_domain), ''),
                'direct'
              ) as source,
              uniqExact(distinct_id) as users,
              count() as events,
              uniqExact(toString(properties.$session_id)) as sessions
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY source ORDER BY users DESC LIMIT 15
          `),
          hogql(`
            SELECT
              coalesce(nullIf(toString(properties.$geoip_country_name), ''), 'Unknown') as country,
              uniqExact(distinct_id) as users,
              count() as events
            FROM events
            WHERE timestamp >= now() - INTERVAL ${days} DAY
            GROUP BY country ORDER BY users DESC LIMIT 20
          `),
        ])
        return NextResponse.json({
          weeklyNew: weeklyNew.map(r => ({ week: str(r[0]), newUsers: num(r[1]) })),
          sources:   sources.map(r   => ({ source: str(r[0]), users: num(r[1]), events: num(r[2]), sessions: num(r[3]) })),
          countries: countries.map(r => ({ country: str(r[0]), users: num(r[1]), events: num(r[2]) })),
        })
      }

      /* ── segments: classify users by engagement level ───────────────── */
      case 'segments': {
        const rows = await hogql(`
          SELECT
            distinct_id,
            any(properties.$email) as email,
            any(properties.$name) as name,
            count() as events,
            uniqExact(toString(properties.$session_id)) as sessions,
            min(timestamp) as first_seen,
            max(timestamp) as last_seen,
            dateDiff('day', max(timestamp), now()) as days_since_last
          FROM events
          WHERE timestamp >= now() - INTERVAL 90 DAY
          GROUP BY distinct_id
          ORDER BY events DESC
          LIMIT 500
        `)
        const users = rows.map(r => {
          const ev = num(r[3]), daysSince = num(r[7])
          const segment =
            daysSince > 60 ? 'Dormant' :
            daysSince > 30 ? 'At Risk' :
            ev >= 200      ? 'Power' :
            ev >= 50       ? 'Regular' : 'Casual'
          return {
            distinctId: str(r[0]), email: str(r[1]), name: str(r[2]),
            events: ev, sessions: num(r[4]), firstSeen: str(r[5]),
            lastSeen: str(r[6]), daysSinceLast: daysSince, segment,
          }
        })
        const summary: Record<string, number> = {}
        for (const u of users) summary[u.segment] = (summary[u.segment] ?? 0) + 1
        return NextResponse.json({ users, summary, totalUsers: users.length })
      }

      default:
        return NextResponse.json({ error: `Unknown analytics type: ${type}` }, { status: 400 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[PostHog analytics]', type, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
