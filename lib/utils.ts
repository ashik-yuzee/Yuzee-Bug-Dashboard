import type { BugReport } from '@/components/DashboardClient'

export function getField(record: BugReport, key: string): unknown {
  const direct = record[key as keyof BugReport]
  if (direct !== null && direct !== undefined) return direct
  try {
    const full = typeof record.full_data === 'string'
      ? JSON.parse(record.full_data)
      : record.full_data
    return full?.[key] ?? full?.body?.[key] ?? null
  } catch { return null }
}

export function parseLabels(record: BugReport): string[] {
  const raw = getField(record, 'labels')
  if (!raw) return []
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw as string[]) }
  catch { return [] }
}

export function parseFeatureFlags(record: BugReport): Record<string, unknown> {
  const raw = getField(record, 'feature_flags')
  if (!raw) return {}
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) }
  catch { return {} }
}

export function deriveRoutingToken(record: BugReport): 'BACKEND' | 'MOBILE' | 'WEB' | null {
  if (record.jira_key) {
    const summary = getField(record, 'jira_summary') as string
    if (summary?.includes('BACKEND')) return 'BACKEND'
    if (summary?.includes('MOBILE'))  return 'MOBILE'
    if (summary?.includes('WEB'))     return 'WEB'
  }
  const cat = record.category || ''
  if (cat.includes('backend'))  return 'BACKEND'
  if (cat.includes('mobile'))   return 'MOBILE'
  if (cat.includes('frontend')) return 'WEB'
  const platform = record.platform || ''
  if (platform === 'Linux') return 'BACKEND'
  if (['ios', 'android'].includes(platform.toLowerCase())) return 'MOBILE'
  if (platform === 'browser') return 'WEB'
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
