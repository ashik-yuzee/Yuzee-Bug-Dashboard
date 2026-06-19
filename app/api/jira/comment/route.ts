import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE  = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL   || ''
const JIRA_KEY   = process.env.JIRA_API_KEY || ''

function basicAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

export async function POST(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const { key, comment } = await req.json() as { key: string; comment: string }
  if (!key || !comment) return NextResponse.json({ error: 'key and comment required' }, { status: 400 })

  const payload = {
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }],
    },
  }

  try {
    const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `Jira error ${res.status}`, detail: txt }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({ id: data.id, created: data.created })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error contacting Jira'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
