import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { searchJiraJql, jiraConfigured, jiraBrowseUrl, type JiraSearchResult } from '@/lib/jiraClient'

const SPACE_YSC  = process.env.JIRA_SPACE_YSC  || 'YSC'
const SPACE_YSDT = process.env.JIRA_SPACE_YSDT || 'YSDT'

const FIELDS = ['summary', 'status', 'assignee', 'priority', 'labels', 'issuetype', 'created', 'updated']

interface RawFields {
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
}

function normalize(result: JiraSearchResult) {
  return result.issues.map(issue => {
    const f = issue.fields as unknown as RawFields
    return {
      key: issue.key,
      summary: f.summary,
      status: f.status?.name ?? 'Unknown',
      statusCategory: f.status?.statusCategory?.name ?? 'Unknown',
      priority: f.priority?.name ?? 'Medium',
      assignee: f.assignee
        ? {
            name: f.assignee.displayName,
            email: f.assignee.emailAddress,
            avatar: f.assignee.avatarUrls?.['24x24'] ?? '',
          }
        : null,
      created: f.created,
      updated: f.updated,
      labels: f.labels ?? [],
      url: jiraBrowseUrl(issue.key),
    }
  })
}

/* GET /api/jira/spaces
 * Returns open tickets from YSC (auto-created, all severities) and YSDT
 * (P0–P2 escalations assigned to developers).
 */
export async function GET() {
  const denied = await checkAuth()
  if (denied) return denied

  if (!jiraConfigured()) {
    return NextResponse.json({ error: 'Jira not configured — JIRA_API_KEY missing' }, { status: 503 })
  }

  try {
    const [yscRes, ysdtRes] = await Promise.all([
      searchJiraJql(`project = ${SPACE_YSC} AND labels = "auto-bug" ORDER BY created DESC`, FIELDS, 50),
      searchJiraJql(`project = ${SPACE_YSDT} ORDER BY created DESC`, FIELDS, 50),
    ])

    return NextResponse.json({
      ysc: normalize(yscRes),
      yscIsLast: yscRes.isLast ?? true,
      ysdt: normalize(ysdtRes),
      ysdtIsLast: ysdtRes.isLast ?? true,
      lastFetched: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch Jira spaces'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
