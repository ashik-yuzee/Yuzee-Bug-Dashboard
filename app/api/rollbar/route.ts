import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'

const ROLLBAR_BASE = 'https://api.rollbar.com/api/1'

function getToken(module: string): string {
  if (module === 'APP' || module === 'BACKEND') {
    return process.env.ROLLBAR_READ_APP || ''
  }
  return process.env.ROLLBAR_READ_WEB || ''
}

export async function GET(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const itemId = searchParams.get('itemId')
  const module = searchParams.get('module') || 'WEB'

  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 })

  const token = getToken(module)
  if (!token) return NextResponse.json({ error: 'Rollbar token not configured' }, { status: 503 })

  // Also get the alternate token in case the item is in the other project
  const altToken = (module === 'APP' || module === 'BACKEND')
    ? (process.env.ROLLBAR_READ_WEB || '')
    : (process.env.ROLLBAR_READ_APP || '')

  async function tryFetch(tok: string): Promise<Response | null> {
    const h = { 'X-Rollbar-Access-Token': tok, 'Content-Type': 'application/json' }
    let res = await fetch(`${ROLLBAR_BASE}/item/${itemId}`, { headers: h })
    if (res.status === 404) res = await fetch(`${ROLLBAR_BASE}/item_by_counter/?counter=${itemId}`, { headers: h })
    return res.ok ? res : null
  }

  try {
    // Try primary token, then alternate (handles module misclassification between projects)
    let itemRes = await tryFetch(token)
    let activeToken = token
    if (!itemRes && altToken && altToken !== token) {
      itemRes = await tryFetch(altToken)
      if (itemRes) activeToken = altToken
    }

    if (!itemRes) {
      return NextResponse.json({ error: `Rollbar item not found (ID: ${itemId}). The item may have been resolved or the access tokens may lack permission.`, itemId }, { status: 404 })
    }

    const headers = { 'X-Rollbar-Access-Token': activeToken, 'Content-Type': 'application/json' }

    const itemData = await itemRes.json()
    const resolvedId = itemData.result?.id

    const instancesRes = await fetch(`${ROLLBAR_BASE}/item/${resolvedId}/instances?count=5`, { headers })
    const instancesData = instancesRes.ok ? await instancesRes.json() : { result: { instances: [] } }

    const item = itemData.result
    const instances = instancesData.result?.instances || []

    const latestInstance = instances[0]
    let stackFrames: unknown[] = []
    let rawBody: unknown = null

    if (latestInstance?.id) {
      const occRes = await fetch(`${ROLLBAR_BASE}/instance/${latestInstance.id}`, { headers })
      if (occRes.ok) {
        const occData = await occRes.json()
        rawBody = occData.result?.data?.body
        const frames = occData.result?.data?.body?.trace?.frames
          || occData.result?.data?.body?.trace_chain?.[0]?.frames
          || []
        stackFrames = frames
      }
    }

    return NextResponse.json({
      item: {
        id: item.id,
        counter: item.counter,
        title: item.title,
        level: item.level,
        status: item.status,
        occurrences: item.total_occurrences,
        uniqueOccurrences: item.unique_occurrences,
        lastOccurrenceAt: item.last_occurrence_timestamp,
        firstOccurrenceAt: item.first_occurrence_timestamp,
        environment: item.environment,
        platform: item.platform,
        framework: item.framework,
        language: item.language,
        url: `https://rollbar.com/${process.env.ROLLBAR_ACCOUNT}/${module === 'APP' ? 'yuzee-app' : 'yuzee-web'}/items/${item.counter}`,
      },
      stackFrames,
      instances: instances.slice(0, 5).map((inst: { id: string; timestamp: number; data?: { request?: { url?: string; method?: string }; server?: { host?: string }; person?: { email?: string } } }) => ({
        id: inst.id,
        timestamp: inst.timestamp,
        request_url: inst.data?.request?.url,
        request_method: inst.data?.request?.method,
        server_host: inst.data?.server?.host,
        person_email: inst.data?.person?.email,
      })),
      rawBody,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
