import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE  = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL    || ''
const JIRA_KEY   = process.env.JIRA_API_KEY  || ''

function basicAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

const H = () => ({
  Authorization: basicAuth(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

interface JiraIssueRaw {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { name: string } }
    priority: { name: string }
    assignee: {
      displayName: string
      emailAddress: string
      avatarUrls: Record<string, string>
    } | null
    created: string
    updated: string
    labels: string[]
    issuetype: { name: string }
  }
}

interface JiraSearchResult {
  issues: JiraIssueRaw[]
  total: number
}

async function searchJira(jql: string, maxResults = 20): Promise<JiraSearchResult> {
  const url =
    `${JIRA_BASE}/rest/api/3/search` +
    `?jql=${encodeURIComponent(jql)}` +
    `&maxResults=${maxResults}` +
    `&fields=summary,status,assignee,priority,labels,issuetype,created,updated`

  const res = await fetch(url, { headers: H() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Jira search ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function normalize(issues: JiraIssueRaw[]) {
  return issues.map(issue => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? 'Unknown',
    statusCategory: issue.fields.status?.statusCategory?.name ?? 'Unknown',
    priority: issue.fields.priority?.name ?? 'Medium',
    assignee: issue.fields.assignee
      ? {
          name: issue.fields.assignee.displayName,
          email: issue.fields.assignee.emailAddress,
          avatar: issue.fields.assignee.avatarUrls?.['24x24'] ?? '',
        }
      : null,
    created: issue.fields.created,
    updated: issue.fields.updated,
    labels: issue.fields.labels ?? [],
    url: `${JIRA_BASE}/browse/${issue.key}`,
  }))
}

/* GET /api/jira/spaces
 * Returns open tickets from YSDP (manual reports), YSC (auto P1–P3), and YSDT (dev tracking / escalated).
 */
export async function GET() {
  const denied = await checkAuth()
  if (denied) return denied

  if (!JIRA_KEY) {
    return NextResponse.json({ error: 'Jira not configured — JIRA_API_KEY missing' }, { status: 503 })
  }

  try {
    const [ysdpRes, yscRes, ysdtRes] = await Promise.all([
      // YSDP — all open manual reports, newest first
      searchJira(
        'project = YSDP AND statusCategory != Done ORDER BY priority ASC, updated DESC',
        25
      ),
      // YSC — open P1/P2/P3 only (P4 is noise at this view level), newest first
      searchJira(
        'project = YSC AND statusCategory != Done AND priority in (Highest, High, Medium) ORDER BY priority ASC, updated DESC',
        25
      ),
      // YSDT — developer tracking board, P1/P2 escalated from YSC
      searchJira(
        'project = YSDT AND statusCategory != Done ORDER BY priority ASC, updated DESC',
        25
      ),
    ])

    return NextResponse.json({
      ysdp: normalize(ysdpRes.issues),
      ysdpTotal: ysdpRes.total,
      ysc: normalize(yscRes.issues),
      yscTotal: yscRes.total,
      ysdt: normalize(ysdtRes.issues),
      ysdtTotal: ysdtRes.total,
      lastFetched: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch Jira spaces'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
