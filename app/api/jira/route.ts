import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE   = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL  = process.env.JIRA_EMAIL    || ''
const JIRA_KEY    = process.env.JIRA_API_KEY  || ''
const SPACE_YSC   = process.env.JIRA_SPACE_YSC || 'YSC'

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

const jiraHeaders = () => ({
  Authorization: basicAuth(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

/* GET /api/jira?key=YSC-123  — fetch issue details */
export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  const key = new URL(req.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const res = await fetch(
    `${JIRA_BASE}/rest/api/3/issue/${key}?fields=summary,status,assignee,priority,description,created,updated,labels,issuetype`,
    { headers: jiraHeaders() }
  )

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `Jira error ${res.status}`, detail: txt }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({
    key: data.key,
    summary: data.fields.summary,
    status: data.fields.status?.name,
    statusCategory: data.fields.status?.statusCategory?.name,
    assignee: data.fields.assignee ? {
      name: data.fields.assignee.displayName,
      email: data.fields.assignee.emailAddress,
      avatar: data.fields.assignee.avatarUrls?.['24x24'],
    } : null,
    priority: data.fields.priority?.name,
    labels: data.fields.labels || [],
    created: data.fields.created,
    updated: data.fields.updated,
    url: `${JIRA_BASE}/browse/${data.key}`,
  })
}

/* POST /api/jira  — create issue in YSC */
export async function POST(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const body = await req.json() as {
    summary: string
    description: string
    severity: string
    module: string
    reportId: string
    source: string
  }

  const { summary, description, severity, module, reportId, source } = body

  const priorityMap: Record<string, string> = {
    P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low',
  }

  const payload = {
    fields: {
      project:   { key: SPACE_YSC },
      issuetype: { name: 'Bug' },
      summary:   summary?.slice(0, 255) || 'Bug report',
      priority:  { name: priorityMap[severity] || 'Medium' },
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description || '' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `Report ID: ${reportId} | Source: ${source} | Module: ${module} | Severity: ${severity}` }],
          },
        ],
      },
      labels: ['yuzee-bug-dashboard', module?.toLowerCase(), severity?.toLowerCase()].filter(Boolean),
    },
  }

  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue`, {
    method: 'POST',
    headers: jiraHeaders(),
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `Jira create error ${res.status}`, detail: txt }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({
    key: data.key,
    id: data.id,
    url: `${JIRA_BASE}/browse/${data.key}`,
  })
}
