import type { BugReport } from '@/components/DashboardClient'

/**
 * full_data is double-encoded: the column itself is a JSON string whose
 * `.full_data` property is a *second* JSON string containing the real
 * `{ headers, params, query, body }` intake payload. Both layers must be
 * unwrapped to reach things like `context.user_id` or the `user-agent` header.
 */
function parseFullDataLayers(record: BugReport): { outer: Record<string, unknown> | null; inner: Record<string, unknown> | null } {
  let outer: Record<string, unknown> | null = null
  try {
    outer = (typeof record.full_data === 'string' ? JSON.parse(record.full_data) : record.full_data) as Record<string, unknown> | null
  } catch { outer = null }

  let inner: Record<string, unknown> | null = null
  try {
    const innerRaw = (outer as Record<string, unknown> | null)?.full_data
    inner = (typeof innerRaw === 'string' ? JSON.parse(innerRaw) : innerRaw) as Record<string, unknown> | null
  } catch { inner = null }

  return { outer, inner }
}

export function getField(record: BugReport, key: string): unknown {
  const direct = record[key as keyof BugReport]
  if (direct !== null && direct !== undefined) return direct
  const { outer, inner } = parseFullDataLayers(record)
  const outerBody = outer?.body as Record<string, unknown> | undefined
  const innerBody = inner?.body as Record<string, unknown> | undefined
  const innerCtx = innerBody?.context as Record<string, unknown> | undefined
  return outer?.[key] ?? outerBody?.[key] ?? innerBody?.[key] ?? innerCtx?.[key] ?? null
}

/** Raw user-agent string from the intake request headers, if captured. */
export function getUserAgentString(record: BugReport): string | null {
  const { outer, inner } = parseFullDataLayers(record)
  const innerHeaders = inner?.headers as Record<string, unknown> | undefined
  const outerHeaders = outer?.headers as Record<string, unknown> | undefined
  const ua = innerHeaders?.['user-agent'] ?? outerHeaders?.['user-agent'] ?? null
  return typeof ua === 'string' ? ua : null
}

const BOT_UA = /^(python-requests|axios|curl|PostmanRuntime|okhttp|Go-http-client)/i

/** Best-effort browser + device model parse from a raw user-agent string. */
export function parseUserAgent(ua: string | null): { browser: string | null; deviceModel: string | null } {
  if (!ua || BOT_UA.test(ua)) return { browser: null, deviceModel: null }

  let browser: string | null = null
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet'
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari'

  let deviceModel: string | null = null
  if (/iPhone/.test(ua)) deviceModel = 'iPhone'
  else if (/iPad/.test(ua)) deviceModel = 'iPad'
  else if (/iPod/.test(ua)) deviceModel = 'iPod'
  else {
    const androidMatch = ua.match(/Android[^;]*;\s*([^)]+)\)/)
    if (androidMatch) deviceModel = androidMatch[1].split('Build/')[0].trim()
    else if (/Macintosh/.test(ua)) deviceModel = 'Mac'
    else if (/Windows/.test(ua)) deviceModel = 'Windows PC'
  }

  return { browser, deviceModel }
}

/** OS label derived from platform + rollbar_project_type + source, per the dashboard spec. */
export function deriveOS(record: BugReport): string {
  const plat = (record.platform || '').toLowerCase()
  const rpt = ((getField(record, 'rollbar_project_type') as string) || '').toLowerCase()
  if (plat === 'ios') return 'iOS'
  if (plat === 'android') return 'Android'
  if (plat === 'browser' || rpt === 'rollbar-web') return 'Website'
  if (plat === 'linux' || plat === 'server' || rpt === 'rollbar-java') return 'Server'
  if (record.source === 'cloudwatch_poller') return 'Server'
  return record.platform || '—'
}

/** reporter_email, falling back to full_data.context.user_id — null for automated sources. */
export function getReporterIdentity(record: BugReport): string | null {
  if (record.reporter_email) return record.reporter_email
  const uid = getField(record, 'user_id')
  return uid ? String(uid) : null
}

/** Legacy data cutoff — records before this are considered historical. */
export const LEGACY_CUTOFF_ISO = '2026-07-10T00:00:00Z'

export function isLegacy(record: BugReport): boolean {
  return new Date(record.created_at).getTime() < new Date(LEGACY_CUTOFF_ISO).getTime()
}

export function parseLabels(record: BugReport): string[] {
  const raw = getField(record, 'labels')
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function parseFeatureFlags(record: BugReport): Record<string, unknown> {
  const raw = getField(record, 'feature_flags')
  if (!raw) return {}
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch { return {} }
}

export function deriveRoutingToken(record: BugReport): 'BACKEND' | 'MOBILE' | 'WEB' | null {
  // 1. Rollbar project ID — set at ingest time, most reliable signal for Rollbar bugs.
  //    782547 = NewYuzeeApp (mobile). 748047 = YuzeeWebRollbar (Java backend).
  if (record.rollbar_project_id === '782547') return 'MOBILE'
  if (record.rollbar_project_id === '748047') return 'BACKEND'

  // 2. Platform field — a hardware-level signal that can't be confused by Gemini's
  //    'frontend_error' category which fires for both mobile and browser errors.
  const platform = (record.platform || '').toLowerCase()
  if (platform === 'ios' || platform === 'android') return 'MOBILE'
  if (platform === 'linux') return 'BACKEND'
  if (platform === 'browser') return 'WEB'

  // 3. Device OS (populated from user-agent / device metadata)
  const deviceOs = (record.device_os || '').toLowerCase()
  if (deviceOs === 'ios' || deviceOs === 'android') return 'MOBILE'

  // 4. Source — 'yuzee_app' is the mobile SDK, 'cloudwatch_poller' is a server job
  if (record.source === 'yuzee_app')           return 'MOBILE'
  if (record.source === 'cloudwatch_poller')   return 'BACKEND'

  // 5. Category (AI-derived, comes AFTER hardware signals to prevent
  //    'frontend_error' on a Flutter/React-Native screen being misrouted to WEB)
  const cat = record.category || ''
  if (cat.includes('backend'))  return 'BACKEND'
  if (cat.includes('mobile'))   return 'MOBILE'
  if (cat.includes('frontend')) return 'WEB'

  // 6. Backend service name present → server-side error
  const svc = (record.backend_service || record.backend_service_name || '').trim()
  if (svc.length > 2) return 'BACKEND'

  // 7. Jira summary keyword — set after ticketing, last resort
  if (record.jira_key) {
    const summary = getField(record, 'jira_summary') as string
    if (summary?.includes('BACKEND')) return 'BACKEND'
    if (summary?.includes('MOBILE'))  return 'MOBILE'
    if (summary?.includes('WEB'))     return 'WEB'
  }

  return null
}

export function buildCloudWatchUrl(record: BugReport): string | null {
  if (!record.correlation_id) return null
  const logGroup = deriveLogGroup(record.location || '')
  const ts    = new Date(record.timestamp_utc || record.created_at).getTime()
  const start = ts - 600_000
  const end   = ts + 300_000
  const encoded = encodeURIComponent(logGroup)
  return `https://console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1`
    + `#logsV2:log-groups/log-group/${encoded}`
    + `/log-events?filterPattern="${record.correlation_id}"&start=${start}&end=${end}`
}

function deriveLogGroup(location: string): string {
  const l = location.toLowerCase()
  if (l.includes('/courses'))    return '/aws/yuzee/course-service'
  if (l.includes('/institutes')) return '/aws/yuzee/institute-service'
  if (l.includes('/search'))     return '/aws/yuzee/search-service'
  if (l.includes('/payment'))    return '/aws/yuzee/payment-service'
  return '/aws/yuzee/user-service'
}

export function rollbarUrl(record: BugReport): string | null {
  if (!record.rollbar_id) return null
  const project = record.rollbar_project_id === '782547' ? 'NewYuzeeApp' : 'YuzeeWebRollbar'
  return `https://rollbar.com/yuzee/${project}/items/${record.rollbar_id}/`
}

/**
 * Rollbar session replay is only playable when both a replay ID exists AND
 * replay was enabled for that session (`rollbar_replay_enabled`) — a replay
 * ID alone doesn't guarantee the recording was actually captured/kept.
 */
export function rollbarReplayUrl(record: BugReport): string | null {
  if (!record.rollbar_replay_id || record.rollbar_replay_enabled !== true) return null
  const sessionId = record.rollbar_session_id
  if (!sessionId) return null
  const project = record.rollbar_project_id === '782547' ? 'NewYuzeeApp' : 'YuzeeWebRollbar'
  const env = record.environment || 'production'
  const replayId = record.rollbar_replay_id
  return `https://app.rollbar.com/a/yuzee/replays/p/${project}/env/${env}/session/${sessionId}/replay/${replayId}`
    + `?prj=782547&projectSlug=${project}&env=${env}&sessionId=${sessionId}&replayId=${replayId}`
}

export function jiraUrl(jiraKey: string | null): string | null {
  if (!jiraKey) return null
  return `https://yuzeeau.atlassian.net/browse/${jiraKey}`
}

export function formatTimestamp(record: BugReport): string {
  const ts = record.timestamp_utc || record.created_at
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function relativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export const ROUTING_COLORS = {
  BACKEND: { bg: 'rgba(139,92,246,.12)', color: '#a78bfa', border: 'rgba(139,92,246,.25)' },
  MOBILE:  { bg: 'rgba(20,184,166,.12)', color: '#2dd4bf', border: 'rgba(20,184,166,.25)' },
  WEB:     { bg: 'rgba(34,197,94,.12)',  color: '#4ade80', border: 'rgba(34,197,94,.25)'  },
} as const

/**
 * Infer which product component a bug belongs to when `component` is null or 'Unknown'.
 * Returns the existing component unchanged if it is already meaningful.
 *
 * Signal priority (highest → lowest):
 *   component_ucl (set by some ingest paths) → api_endpoint/location path segments →
 *   backend_service name → description/category keywords
 */
export function inferComponent(bug: BugReport): string | null {
  const comp = bug.component
  if (comp && comp !== 'Unknown' && comp !== 'unknown') return comp

  // component_ucl is populated by some ingest paths and is more precise than category
  const ucl = (bug.component_ucl || '').trim()
  if (ucl && ucl !== 'Unknown' && ucl !== 'unknown') return ucl

  const endpoint   = (bug.api_endpoint || bug.location || bug.frontend_route || '').toLowerCase()
  const service    = (bug.backend_service || bug.backend_service_name || '').toLowerCase()
  const desc       = (bug.description || '').toLowerCase()
  const category   = (bug.category || '').toLowerCase()
  const page       = (bug.page_url || bug.page_name || '').toLowerCase()
  const controller = (bug.controller || bug.handler_method || '').toLowerCase()
  const operation  = (bug.operation || '').toLowerCase()
  const excClass   = (bug.exception_class || '').toLowerCase()
  const all = `${endpoint} ${service} ${desc} ${page} ${category} ${controller} ${operation} ${excClass}`

  // ── Auth / Identity ──────────────────────────────────────────────────────
  // Endpoints: /auth /login /logout /signup /register /onboarding /password /token /oauth /session /verify /credential
  // Yuzee backend: /users/api/v1/public/users/signup, /users/api/v1/auth/...
  if (/\/(auth|login|logout|signup|register|onboarding|password|token|oauth|session|verify|credential)/.test(endpoint) ||
      /\b(useronboarding|onboardingcontroller|onboardingprocessor)\b/.test(controller) ||
      /\b(authentication|unauthorized|forbidden|token.?expired|invalid.?token|login.?failed)\b/.test(all))
    return 'Auth'

  // ── Payment / Billing ────────────────────────────────────────────────────
  if (/\/(payment|order|invoice|billing|checkout|subscription|stripe|refund|wallet|cart|transaction)/.test(endpoint) ||
      /\b(payment|paymentservice|invoice|billing|checkout|stripe|refund|transaction|wallet)\b/.test(all))
    return 'Payment'

  // ── Search / Discovery ───────────────────────────────────────────────────
  if (/\/(search|discovery|explore|filter|recommend)/.test(endpoint) ||
      service.includes('search') ||
      /\b(searchcontroller|searchservice|searchresult|full.?text.?search)\b/.test(all))
    return 'Search'

  // ── Admissions / Courses ─────────────────────────────────────────────────
  // Yuzee backend: /courses/api /institutes/api → course-service / institute-service
  if (/\/(admissions?|application|enroll|scholarship|course|university|institute|program|degree|intake)/.test(endpoint) ||
      service.includes('course') || service.includes('institute') ||
      /\b(admission|application|enrol|scholarship|courseservice|instituteservice)\b/.test(all))
    return 'Admissions'

  // ── Profile / Account ────────────────────────────────────────────────────
  // /users/api/v1/public/users/* → user-service → Profile
  if (/\/(profile|account|settings|preferences|document|upload|kyc)/.test(endpoint) ||
      /\/users\/api/.test(endpoint) ||
      /\b(userprofile|usercontroller|userservice|userprocessor|userdao|userimpl)\b/.test(controller + ' ' + excClass) ||
      /\b(profile|account.?setting|user.?document)\b/.test(all))
    return 'Profile'

  // ── Dashboard / Analytics ────────────────────────────────────────────────
  if (/\/(dashboard|home|overview|analytics|report|stat)/.test(endpoint) ||
      /\bdashboard\b/.test(page + ' ' + desc))
    return 'Dashboard'

  return null
}
