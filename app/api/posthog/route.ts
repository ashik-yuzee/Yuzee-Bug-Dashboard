import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const POSTHOG_BASE = 'https://us.posthog.com'
const PH_KEY       = process.env.POSTHOG_API_KEY || ''
const PH_PROJECT   = process.env.POSTHOG_PROJECT_ID || ''

/* GET /api/posthog?sessionId=xxx  — fetch events for a PostHog session */
export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  if (!PH_KEY)     return NextResponse.json({ error: 'PostHog API key not configured', code: 'no_key' }, { status: 503 })
  if (!PH_PROJECT) return NextResponse.json({ error: 'PostHog project ID not configured (set POSTHOG_PROJECT_ID)', code: 'no_project' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const sessionId  = searchParams.get('sessionId')
  const distinctId = searchParams.get('distinctId')

  if (!sessionId && !distinctId) {
    return NextResponse.json({ error: 'sessionId or distinctId is required' }, { status: 400 })
  }

  const headers = {
    Authorization: `Bearer ${PH_KEY}`,
    Accept: 'application/json',
  }

  try {
    let url = `${POSTHOG_BASE}/api/projects/${PH_PROJECT}/events/?limit=50&order_by=-timestamp`
    if (sessionId)  url += `&properties=%5B%7B%22key%22%3A%22%24session_id%22%2C%22value%22%3A%22${encodeURIComponent(sessionId)}%22%7D%5D`
    if (distinctId) url += `&distinct_id=${encodeURIComponent(distinctId)}`

    const res = await fetch(url, { headers })

    if (!res.ok) {
      const txt = await res.text()
      return NextResponse.json({ error: `PostHog error ${res.status}`, detail: txt }, { status: res.status })
    }

    const data = await res.json()
    const events = (data.results || []).map((evt: {
      id: string
      event: string
      timestamp: string
      distinct_id: string
      properties?: Record<string, unknown>
    }) => ({
      id: evt.id,
      event: evt.event,
      timestamp: evt.timestamp,
      distinctId: evt.distinct_id,
      url: evt.properties?.['$current_url'],
      browser: evt.properties?.['$browser'],
      os: evt.properties?.['$os'],
      screen: evt.properties?.['$screen_width'] && evt.properties?.['$screen_height']
        ? `${evt.properties['$screen_width']}×${evt.properties['$screen_height']}`
        : undefined,
    }))

    return NextResponse.json({
      count: events.length,
      hasMore: !!data.next,
      events,
      sessionRecordingUrl: sessionId
        ? `${POSTHOG_BASE}/project/${PH_PROJECT}/replay/${sessionId}`
        : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
