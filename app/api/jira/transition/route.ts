import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE  = process.env.JIRA_BASE_URL || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL   || ''
const JIRA_KEY   = process.env.JIRA_API_KEY || ''

function basicAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

const H = () => ({
  Authorization: basicAuth(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

/* GET /api/jira/transition?key=YSC-123 — list available transitions */
export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const key = new URL(req.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  try {
    const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/transitions`, { headers: H() })
    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `Jira error ${res.status}`, detail: txt }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json({
      transitions: (data.transitions as Array<{ id: string; name: string; to: { name: string } }>).map(t => ({
        id: t.id,
        name: t.name,
        toStatus: t.to?.name,
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error contacting Jira'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/* POST /api/jira/transition — move issue to a new status */
export async function POST(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const { key, transitionId } = await req.json() as { key: string; transitionId: string }
  if (!key || !transitionId) return NextResponse.json({ error: 'key and transitionId required' }, { status: 400 })

  try {
    const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ transition: { id: transitionId } }),
    })

    if (!res.ok && res.status !== 204) {
      const txt = await res.text()
      return NextResponse.json({ error: `Jira transition error ${res.status}`, detail: txt }, { status: res.status })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error contacting Jira'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
