import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE  = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL   || ''
const JIRA_KEY   = process.env.JIRA_API_KEY || ''

function basicAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

/* GET /api/jira/users?query=shaqeeba — search for Jira users */
export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const query = new URL(req.url).searchParams.get('query') || ''

  const res = await fetch(
    `${JIRA_BASE}/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=10`,
    {
      headers: {
        Authorization: basicAuth(),
        Accept: 'application/json',
      },
    }
  )

  if (!res.ok) {
    const txt = await res.text()
    return NextResponse.json({ error: `Jira error ${res.status}`, detail: txt }, { status: res.status })
  }

  const users = await res.json() as Array<{
    accountId: string
    displayName: string
    emailAddress?: string
    avatarUrls: Record<string, string>
    active: boolean
  }>

  return NextResponse.json({
    users: users.filter(u => u.active).map(u => ({
      accountId: u.accountId,
      displayName: u.displayName,
      email: u.emailAddress,
      avatar: u.avatarUrls?.['24x24'],
    })),
  })
}
