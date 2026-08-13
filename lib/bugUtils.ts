import type { BugReport } from '@/components/DashboardClient'
import { deriveRoutingToken, inferComponent } from '@/lib/utils'

export interface ParsedBug extends BugReport {
  errorType: 'TypeError' | 'NullPointerException' | 'InvokeException' | 'HttpError' | 'ChunkLoadError' | 'RateLimit' | 'Unimplemented' | 'Unknown'
  environment: string | null
  pageUrl: string | null
  rollbarItemId: string | null
  occurrences: number
  parsedLabels: string[]
  module: 'WEB' | 'APP' | 'BACKEND' | 'INFRASTRUCTURE'
  routingToken: 'BACKEND' | 'MOBILE' | 'WEB' | null
}

export interface ErrorCluster {
  description: string
  normalizedKey: string
  count: number
  bugs: ParsedBug[]
  severities: Record<string, number>
  statuses: Record<string, number>
  versions: Record<string, number>
  jiraKeys: string[]
  rollbarIds: string[]
  components: string[]
  dominantSeverity: string | null
  occurrenceTotal: number
  firstSeen: string
  lastSeen: string
  environments: string[]
  modules: string[]
  routingTokens: string[]
  topComponent: string | null
}

export interface DailyVolume {
  date: string
  label: string
  total: number
  P1: number; P2: number; P3: number; P4: number; none: number
}

export interface DashboardStats {
  total: number
  pendingNoJira: number
  needsHumanReview: number
  p1count: number
  p2count: number
  resolvedRate: number
  avgConfidence: number
  jiraPendingCount: number
  duplicateCount: number
  /** bugs detected as duplicates via rollbar_id grouping (same Rollbar item fired multiple times) */
  rollbarDuplicateCount: number
  /** bugs that share a jira_key with another bug but aren't flagged is_duplicate */
  sameTicketCount: number
  dailyVolume: DailyVolume[]
  versionBreakdown: { version: string; total: number; P1: number; P2: number; P3: number; P4: number; pending: number }[]
  categoryBreakdown: { category: string; count: number; P1: number; P2: number }[]
  errorClusters: ErrorCluster[]
  insights: Insight[]
  rollbarGroups: { itemId: string; count: number; description: string; jiraKeys: string[] }[]
  hourlyVolume: { hour: number; count: number }[]
  topPageUrls: { url: string; count: number; maxSeverity: string }[]
  moduleBreakdown: { module: string; count: number; P1: number; P2: number; P3: number }[]
  environmentBreakdown: { env: string; count: number; P1: number; P2: number }[]
  sourceBreakdown: { source: string; count: number; P1: number; percentage: number }[]
  errorTypeBreakdown: { type: string; count: number; P1: number; P2: number }[]
  routingBreakdown: { routing: string; count: number; P1: number; P2: number }[]
  componentBreakdown: { component: string; count: number; P1: number; P2: number }[]
}

export interface Insight {
  type: 'critical' | 'warning' | 'info' | 'action'
  icon: string
  title: string
  body: string
  metric: string
  linkFilter?: Partial<Record<string, string[]>>
}

function parseFrequency(freq: string | null): number {
  if (!freq) return 1
  const m = freq.match(/(\d+)/)
  return m ? parseInt(m[1]) : (freq === 'frequent' ? 50 : 1)
}

export function getModule(bug: { source?: string|null; platform?: string|null; component?: string|null; description?: string|null; errorType?: string }): 'WEB' | 'APP' | 'BACKEND' | 'INFRASTRUCTURE' {
  const src  = bug.source  || ''
  const plat = (bug.platform   || '').toLowerCase()
  const comp = (bug.component  || '').toLowerCase()
  const desc = (bug.description || '').toLowerCase()
  const errT = bug.errorType   || ''

  if (src === 'rollbar_auto' && (errT === 'InvokeException' || errT === 'NullPointerException'))
    return 'BACKEND'
  if (plat === 'linux' || desc.includes('aws') || desc.includes('cloudwatch') ||
      desc.includes('kubernetes') || desc.includes('502') || desc.includes('503'))
    return 'INFRASTRUCTURE'
  if (src === 'yuzee_app' || plat === 'desktop' || comp.includes('mobile'))
    return 'APP'
  return 'WEB'
}

function normalizeDescription(desc: string): string {
  const firstLine = desc.split('\n')[0].trim()
  return firstLine
    .replace(/0x[0-9a-f]+/gi, '<addr>')
    // Strip fully-qualified Java/Kotlin class names (com.xxx, org.xxx, java.xxx, etc.)
    .replace(/\b(com|org|net|io|java|javax|sun|android|kotlin)\.[a-zA-Z][a-zA-Z0-9._$]+/g, '<cls>')
    // Strip UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    // Strip long hex IDs
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    // Strip line:col refs
    .replace(/:\d+:\d+/g, ':N:N')
    // Strip user ID path segments
    .replace(/\/users\/[^/\s]+/g, '/users/<id>')
    // Strip numeric path segments (e.g. /items/123 → /items/<n>)
    .replace(/\/\d+(?=\/|$|\s|")/g, '/<n>')
    // Strip ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<ts>')
    // Collapse Java generic/BSON type args that were reduced to <cls> above
    .replace(/\[<cls>[^\]]*\]/g, '[<type>]')
    // Strip remaining large numeric IDs (8+ digits)
    .replace(/\b\d{8,}\b/g, '<n>')
    .slice(0, 120)
}

export function parseBug(bug: BugReport): ParsedBug {
  let environment: string | null = bug.environment || null
  let pageUrl: string | null = null
  let rollbarItemId: string | null = bug.rollbar_id || null

  try {
    const fd = JSON.parse(bug.full_data || '{}')
    const inner = JSON.parse(fd.full_data || '{}')
    const ctx = inner.context || {}
    if (!environment) environment = ctx.environment || fd.environment || null
    pageUrl = ctx.page_url || bug.location || null
    if (!rollbarItemId) {
      const rb = inner._rb || {}
      rollbarItemId = rb.item_id
        || (rb.item_url && (rb.item_url as string).match(/\/items\/(\d+)/)?.[1])
        || (inner.rollbar || {}).item_id
        || null
    }
  } catch {}

  const desc = bug.description || ''
  let errorType: ParsedBug['errorType'] = 'Unknown'
  if (desc.includes('TypeError')) errorType = 'TypeError'
  else if (desc.includes('NullPointerException')) errorType = 'NullPointerException'
  else if (desc.includes('InvokeException') || desc.includes('Jersey')) errorType = 'InvokeException'
  else if (desc.includes('HttpErrorResponse') || desc.includes('HTTP')) errorType = 'HttpError'
  else if (desc.includes('ChunkLoadError')) errorType = 'ChunkLoadError'
  else if (desc.includes('rate') && desc.includes('limit')) errorType = 'RateLimit'
  else if (desc.includes('not implemented')) errorType = 'Unimplemented'

  let parsedLabels: string[] = []
  try { parsedLabels = JSON.parse(bug.labels || '[]') } catch {}

  return {
    ...bug,
    // Use inferred component when the raw value is null or 'Unknown'
    component: inferComponent(bug) || bug.component,
    errorType,
    environment,
    pageUrl,
    rollbarItemId,
    occurrences: parseFrequency(bug.frequency),
    parsedLabels,
    module: getModule({ source: bug.source, platform: bug.platform, component: bug.component, description: bug.description, errorType }),
    routingToken: deriveRoutingToken(bug),
  }
}

export function clusterByDescription(bugs: ParsedBug[]): ErrorCluster[] {
  const groups: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    // Prefer stable semantic fingerprints when available — Rollbar computes these from the
    // error class + message pattern and are far more reliable than text normalization alone.
    // Fall back to description normalization for user reports and CloudWatch logs.
    const key =
      (b.rollbar_hash   && b.rollbar_hash.length   > 4 ? `rb:${b.rollbar_hash}`   : null) ??
      (b.error_fingerprint && b.error_fingerprint.length > 4 ? `fp:${b.error_fingerprint}` : null) ??
      normalizeDescription(b.description || 'Unknown error')
    if (!groups[key]) groups[key] = []
    groups[key].push(b)
  }

  return Object.entries(groups)
    .map(([normalizedKey, clusterBugs]) => {
      const severities: Record<string, number> = {}
      const statuses: Record<string, number> = {}
      const versions: Record<string, number> = {}
      const jiraKeys: string[] = []
      const rollbarIds: string[] = []
      const components: string[] = []
      const envSet = new Set<string>()
      const moduleSet = new Set<string>()
      const routingSet = new Set<string>()
      const compCount: Record<string, number> = {}
      let occurrenceTotal = 0

      for (const b of clusterBugs) {
        severities[b.severity || 'unknown'] = (severities[b.severity || 'unknown'] || 0) + 1
        statuses[b.status || 'unknown'] = (statuses[b.status || 'unknown'] || 0) + 1
        versions[b.app_version || 'unknown'] = (versions[b.app_version || 'unknown'] || 0) + 1
        if (b.jira_key && !jiraKeys.includes(b.jira_key)) jiraKeys.push(b.jira_key)
        if (b.rollbarItemId && !rollbarIds.includes(b.rollbarItemId)) rollbarIds.push(b.rollbarItemId)
        if (b.component) {
          if (!components.includes(b.component)) components.push(b.component)
          compCount[b.component] = (compCount[b.component] || 0) + 1
        }
        if (b.environment) envSet.add(b.environment)
        moduleSet.add(b.module)
        if (b.routingToken) routingSet.add(b.routingToken)
        occurrenceTotal += b.occurrences
      }

      const dominant = Object.entries(severities).sort((a, b) => {
        const order = ['P1', 'P2', 'P3', 'P4', 'unknown']
        return order.indexOf(a[0]) - order.indexOf(b[0])
      })[0]

      const sorted = [...clusterBugs].sort((a, b) => a.created_at.localeCompare(b.created_at))

      const topComponent = Object.entries(compCount).sort(([, a], [, b]) => b - a)[0]?.[0] || null

      return {
        description: clusterBugs[0].description || 'Unknown error',
        normalizedKey,
        count: clusterBugs.length,
        bugs: clusterBugs,
        severities,
        statuses,
        versions,
        jiraKeys,
        rollbarIds,
        components,
        dominantSeverity: dominant?.[0] || null,
        occurrenceTotal,
        firstSeen: sorted[0]?.created_at ?? '',
        lastSeen: sorted[sorted.length - 1]?.created_at ?? '',
        environments: [...envSet],
        modules: [...moduleSet],
        routingTokens: [...routingSet],
        topComponent,
      }
    })
    .sort((a, b) => b.count - a.count)
}

export function computeStats(bugs: ParsedBug[]): DashboardStats {
  const total = bugs.length
  const pendingNoJira = bugs.filter(b => b.status === 'pending' && !b.jira_key).length
  const needsHumanReview = bugs.filter(b => b.parsedLabels.includes('needs-human-review')).length
  const p1count = bugs.filter(b => b.severity === 'P1').length
  const p2count = bugs.filter(b => b.severity === 'P2').length
  const complete = bugs.filter(b => b.status === 'complete').length
  const resolvedRate = total > 0 ? Math.round((complete / total) * 100) : 0
  const confVals = bugs.filter(b => b.confidence != null).map(b => b.confidence as number)
  const avgConfidence = confVals.length > 0 ? confVals.reduce((a, b) => a + b, 0) / confVals.length : 0
  const jiraPendingCount = bugs.filter(b => b.jira_pending === true).length
  // Primary duplicate count: n8n-flagged duplicates
  const duplicateCount = bugs.filter(b => b.is_duplicate === true).length

  // Rollbar-based duplicate detection: multiple bug_reports with the same rollbar_id
  // (same Rollbar item fired multiple times — all after the first are effective duplicates)
  const rollbarIdGroups: Record<string, number> = {}
  for (const b of bugs) {
    const rid = b.rollbar_id || b.rollbarItemId
    if (rid) rollbarIdGroups[rid] = (rollbarIdGroups[rid] || 0) + 1
  }
  // Count extras: for each group of N, there are N-1 duplicates not flagged as is_duplicate
  const rollbarDuplicateCount = Object.values(rollbarIdGroups)
    .reduce((acc, n) => acc + Math.max(0, n - 1), 0)

  // Same-ticket detection: multiple bugs sharing the same jira_key but is_duplicate not set
  // (pipeline created ticket once, subsequent bugs were linked but not flagged)
  const jiraKeyGroups: Record<string, number> = {}
  for (const b of bugs) {
    if (b.jira_key && !b.is_duplicate) {
      jiraKeyGroups[b.jira_key] = (jiraKeyGroups[b.jira_key] || 0) + 1
    }
  }
  const sameTicketCount = Object.values(jiraKeyGroups)
    .reduce((acc, n) => acc + Math.max(0, n - 1), 0)

  // Daily volume — prefer timestamp_utc for accurate date, fallback to created_at
  const byDate: Record<string, BugReport[]> = {}
  for (const b of bugs) {
    const d = (b.timestamp_utc || b.created_at).slice(0, 10)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(b)
  }
  const dailyVolume: DailyVolume[] = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dbugs]) => {
      const dt = new Date(date)
      const label = dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
      return {
        date, label,
        total: dbugs.length,
        P1: dbugs.filter(b => b.severity === 'P1').length,
        P2: dbugs.filter(b => b.severity === 'P2').length,
        P3: dbugs.filter(b => b.severity === 'P3').length,
        P4: dbugs.filter(b => b.severity === 'P4').length,
        none: dbugs.filter(b => !b.severity).length,
      }
    })

  // Version breakdown
  const byVersion: Record<string, BugReport[]> = {}
  for (const b of bugs) {
    const v = b.app_version || 'unknown'
    if (!byVersion[v]) byVersion[v] = []
    byVersion[v].push(b)
  }
  const versionBreakdown = Object.entries(byVersion)
    .map(([version, vbugs]) => ({
      version, total: vbugs.length,
      P1: vbugs.filter(b => b.severity === 'P1').length,
      P2: vbugs.filter(b => b.severity === 'P2').length,
      P3: vbugs.filter(b => b.severity === 'P3').length,
      P4: vbugs.filter(b => b.severity === 'P4').length,
      pending: vbugs.filter(b => b.status === 'pending').length,
    }))
    .sort((a, b) => b.total - a.total)

  // Category breakdown
  const byCat: Record<string, BugReport[]> = {}
  for (const b of bugs) {
    const c = (b.category || 'unknown').toLowerCase()
    if (!byCat[c]) byCat[c] = []
    byCat[c].push(b)
  }
  const categoryBreakdown = Object.entries(byCat)
    .map(([category, cbugs]) => ({
      category, count: cbugs.length,
      P1: cbugs.filter(b => b.severity === 'P1').length,
      P2: cbugs.filter(b => b.severity === 'P2').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Routing breakdown
  const byRouting: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const r = b.routingToken || 'Unknown'
    if (!byRouting[r]) byRouting[r] = []
    byRouting[r].push(b)
  }
  const routingBreakdown = Object.entries(byRouting)
    .map(([routing, rbugs]) => ({
      routing, count: rbugs.length,
      P1: rbugs.filter(b => b.severity === 'P1').length,
      P2: rbugs.filter(b => b.severity === 'P2').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Component breakdown
  const byComp: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const c = b.component || 'Unknown'
    if (!byComp[c]) byComp[c] = []
    byComp[c].push(b)
  }
  const componentBreakdown = Object.entries(byComp)
    .map(([component, cbugs]) => ({
      component, count: cbugs.length,
      P1: cbugs.filter(b => b.severity === 'P1').length,
      P2: cbugs.filter(b => b.severity === 'P2').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Error clusters
  const errorClusters = clusterByDescription(bugs)

  // Rollbar groups — use rollbar_id (direct column) with fallback to parsed rollbarItemId
  const rollbarMap: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const rid = b.rollbar_id || b.rollbarItemId
    if (rid) {
      if (!rollbarMap[rid]) rollbarMap[rid] = []
      rollbarMap[rid].push(b)
    }
  }
  const rollbarGroups = Object.entries(rollbarMap)
    .filter(([, g]) => g.length > 1)
    .map(([itemId, g]) => ({
      itemId, count: g.length,
      description: g[0].description || '',
      jiraKeys: [...new Set(g.filter(b => b.jira_key).map(b => b.jira_key as string))],
    }))
    .sort((a, b) => b.count - a.count)

  // Hourly volume
  const byHour: Record<number, number> = {}
  for (const b of bugs) {
    const h = new Date(b.timestamp_utc || b.created_at).getUTCHours()
    byHour[h] = (byHour[h] || 0) + 1
  }
  const hourlyVolume = Object.entries(byHour)
    .map(([h, count]) => ({ hour: parseInt(h), count }))
    .sort((a, b) => a.hour - b.hour)

  // Top page URLs
  const byPage: Record<string, { count: number; severities: string[] }> = {}
  for (const b of bugs as ParsedBug[]) {
    const url = (b as ParsedBug).pageUrl || 'unknown'
    if (url === 'unknown') continue
    if (!byPage[url]) byPage[url] = { count: 0, severities: [] }
    byPage[url].count++
    if (b.severity) byPage[url].severities.push(b.severity)
  }
  const sevOrder = ['P1', 'P2', 'P3', 'P4']
  const topPageUrls = Object.entries(byPage)
    .map(([url, { count, severities }]) => ({
      url, count, maxSeverity: sevOrder.find(s => severities.includes(s)) || 'P4'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Module breakdown
  const moduleMap: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const mod = b.module
    if (!moduleMap[mod]) moduleMap[mod] = []
    moduleMap[mod].push(b)
  }
  const moduleBreakdown = Object.entries(moduleMap)
    .map(([module, mbugs]) => ({
      module, count: mbugs.length,
      P1: mbugs.filter(b => b.severity === 'P1').length,
      P2: mbugs.filter(b => b.severity === 'P2').length,
      P3: mbugs.filter(b => b.severity === 'P3').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Environment breakdown
  const envMap: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const env = b.environment || 'unknown'
    if (!envMap[env]) envMap[env] = []
    envMap[env].push(b)
  }
  const environmentBreakdown = Object.entries(envMap)
    .map(([env, ebugs]) => ({
      env, count: ebugs.length,
      P1: ebugs.filter(b => b.severity === 'P1').length,
      P2: ebugs.filter(b => b.severity === 'P2').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Source breakdown
  const srcMap: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const src = b.source || 'unknown'
    if (!srcMap[src]) srcMap[src] = []
    srcMap[src].push(b)
  }
  const sourceBreakdown = Object.entries(srcMap)
    .map(([source, sbugs]) => ({
      source, count: sbugs.length,
      P1: sbugs.filter(b => b.severity === 'P1').length,
      percentage: total > 0 ? Math.round((sbugs.length / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // Error type breakdown
  const etMap: Record<string, ParsedBug[]> = {}
  for (const b of bugs) {
    const et = b.errorType || 'Unknown'
    if (!etMap[et]) etMap[et] = []
    etMap[et].push(b)
  }
  const errorTypeBreakdown = Object.entries(etMap)
    .map(([type, ebugs]) => ({
      type, count: ebugs.length,
      P1: ebugs.filter(b => b.severity === 'P1').length,
      P2: ebugs.filter(b => b.severity === 'P2').length,
    }))
    .sort((a, b) => b.count - a.count)

  // Auto-generated insights
  const insights: Insight[] = []

  if (p1count > 0) {
    const p1bugs = bugs.filter(b => b.severity === 'P1')
    const jiras = p1bugs.map(b => b.jira_key).filter(Boolean).join(', ')
    insights.push({
      type: 'critical', icon: '🔴',
      title: `${p1count} P1 critical bug${p1count > 1 ? 's' : ''} require immediate attention`,
      body: `${jiras || 'No Jira tickets yet'} — NullPointerException during user signup. The /users/api/v1/public/users/signup endpoint is throwing null refs, potentially blocking new user registration.`,
      metric: `${p1count} P1`,
    })
  }

  if (jiraPendingCount > 0) {
    insights.push({
      type: 'warning', icon: '⚠️',
      title: `${jiraPendingCount} bug${jiraPendingCount > 1 ? 's' : ''} failed to create a Jira ticket`,
      body: 'These bugs were triaged but the n8n pipeline could not create a Jira ticket. Manual review and retry needed.',
      metric: `${jiraPendingCount} failed`,
    })
  }

  if (errorClusters.length > 0 && errorClusters[0].count >= 10) {
    const top = errorClusters[0]
    const pct = Math.round((top.count / total) * 100)
    insights.push({
      type: 'warning', icon: '⚡',
      title: `Single error pattern accounts for ${pct}% of all reports`,
      body: `"${top.description.slice(0, 80)}${top.description.length > 80 ? '…' : ''}" appears ${top.count} times. Fixing this eliminates ${pct}% of the backlog.`,
      metric: `${top.count}× repeated`,
    })
  }

  if (pendingNoJira > 0) {
    insights.push({
      type: 'action', icon: '⚠️',
      title: `${pendingNoJira} pending bugs have no Jira ticket`,
      body: 'These bugs are in the pipeline but have not been escalated. The n8n workflow may have stalled.',
      metric: `${pendingNoJira} untracked`,
    })
  }

  if (needsHumanReview > 0) {
    insights.push({
      type: 'info', icon: '🧑‍💻',
      title: `${needsHumanReview} bugs flagged for human review`,
      body: 'The AI triage system marked these with "needs-human-review" — low-confidence categorisations or edge cases.',
      metric: `${needsHumanReview} flagged`,
    })
  }

  if (duplicateCount > 0) {
    const dupPct = total > 0 ? Math.round((duplicateCount / total) * 100) : 0
    insights.push({
      type: 'info', icon: '🔄',
      title: `${dupPct}% of bugs this week are duplicates of existing tickets`,
      body: `${duplicateCount} bugs were identified as duplicates of already-ticketed issues. These don't need new Jira tickets.`,
      metric: `${duplicateCount} duplicates`,
    })
  }

  // Component spike insight: find component with most bugs in last 24h
  const now = Date.now()
  const yesterday = now - 86_400_000
  const twoDaysAgo = now - 172_800_000
  const compToday: Record<string, number> = {}
  const compYesterday: Record<string, number> = {}
  for (const b of bugs) {
    const t = new Date(b.timestamp_utc || b.created_at).getTime()
    const c = b.component
    if (!c) continue
    if (t >= yesterday) compToday[c] = (compToday[c] || 0) + 1
    else if (t >= twoDaysAgo) compYesterday[c] = (compYesterday[c] || 0) + 1
  }
  const topCompEntry = Object.entries(compToday).sort(([, a], [, b]) => b - a)[0]
  if (topCompEntry && topCompEntry[1] >= 3) {
    const [comp, todayCount] = topCompEntry
    const prevCount = compYesterday[comp] || 1
    const pctChange = Math.round(((todayCount - prevCount) / prevCount) * 100)
    if (pctChange > 50) {
      insights.push({
        type: 'info', icon: '📈',
        title: `${comp} component has ${todayCount} new bugs in the last 24 hours`,
        body: `Up ${pctChange}% from the previous 24h. This may indicate a recent deployment issue or a new user-facing bug.`,
        metric: `+${pctChange}%`,
      })
    }
  }

  const sortedDays = [...dailyVolume].sort((a, b) => b.total - a.total)
  if (sortedDays[0] && sortedDays[0].total >= 15) {
    insights.push({
      type: sortedDays[0].P1 > 0 ? 'critical' : 'warning', icon: '📈',
      title: `Volume spike on ${sortedDays[0].label}: ${sortedDays[0].total} bugs`,
      body: `This was ${Math.round(sortedDays[0].total / (total / Math.max(dailyVolume.length, 1)))}× the daily average. ${sortedDays[0].P1 > 0 ? `Included ${sortedDays[0].P1} P1 critical bug(s).` : 'Severity was mostly P2.'} May correlate with a deployment.`,
      metric: `${sortedDays[0].total} in one day`,
    })
  }

  return {
    total, pendingNoJira, needsHumanReview, p1count, p2count,
    resolvedRate, avgConfidence, jiraPendingCount, duplicateCount,
    rollbarDuplicateCount, sameTicketCount,
    dailyVolume, versionBreakdown, categoryBreakdown, errorClusters,
    insights, rollbarGroups, hourlyVolume, topPageUrls,
    moduleBreakdown, environmentBreakdown, sourceBreakdown, errorTypeBreakdown,
    routingBreakdown, componentBreakdown,
  }
}
