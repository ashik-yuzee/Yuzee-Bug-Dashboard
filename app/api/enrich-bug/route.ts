import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { checkAuth as checkApiAuth } from '@/lib/apiAuth'

const ROLLBAR_BASE = 'https://api.rollbar.com/api/1'

function getToken(rollbarProjectId: string | null): string {
  return rollbarProjectId === '782547'
    ? (process.env.ROLLBAR_READ_APP || '')
    : (process.env.ROLLBAR_READ_WEB || '')
}

async function fetchRollbarItem(itemId: string, token: string) {
  const headers = { 'X-Rollbar-Access-Token': token, 'Content-Type': 'application/json' }
  let res = await fetch(`${ROLLBAR_BASE}/item/${itemId}`, { headers })
  if (res.status === 404) res = await fetch(`${ROLLBAR_BASE}/item_by_counter/?counter=${itemId}`, { headers })
  if (!res.ok) return null

  const itemData = await res.json()
  const item = itemData.result
  if (!item) return null

  const instancesRes = await fetch(`${ROLLBAR_BASE}/item/${item.id}/instances?count=1`, { headers })
  const instancesData = instancesRes.ok ? await instancesRes.json() : { result: { instances: [] } }
  const latestInstance = instancesData.result?.instances?.[0]

  let occurrenceBody: Record<string, unknown> | null = null
  if (latestInstance?.id) {
    const occRes = await fetch(`${ROLLBAR_BASE}/instance/${latestInstance.id}`, { headers })
    if (occRes.ok) {
      const occData = await occRes.json()
      occurrenceBody = occData.result?.data?.body ?? null
    }
  }

  return { item, latestInstance, occurrenceBody }
}

/** Only fields we can map 1:1 from Rollbar's payload with no ambiguity. */
const ENRICHABLE_COLUMNS = ['reporter_email', 'environment', 'exception_class', 'server_name'] as const
type EnrichableColumn = typeof ENRICHABLE_COLUMNS[number]

// PATCH /api/enrich-bug?report_id=<report_id>
// Fills any of ENRICHABLE_COLUMNS that are currently null on the row, using live
// data pulled from Rollbar (keyed by rollbar_id/rollbar_project_id already on the row).
// Never overwrites a non-null value. If nothing new is found, it's a no-op.
export async function PATCH(request: NextRequest) {
  const authError = await checkApiAuth()
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const reportId = searchParams.get('report_id')
  if (!reportId) return NextResponse.json({ error: 'report_id is required' }, { status: 400 })

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
  )

  const { data: bug, error: fetchError } = await supabase
    .from('bug_reports')
    .select('report_id, rollbar_id, rollbar_project_id, reporter_email, environment, exception_class, server_name')
    .eq('report_id', reportId)
    .single()

  if (fetchError || !bug) return NextResponse.json({ error: 'Bug report not found' }, { status: 404 })
  if (!bug.rollbar_id) return NextResponse.json({ enriched: false, reason: 'no_rollbar_id' })

  const missing = ENRICHABLE_COLUMNS.filter(col => bug[col as keyof typeof bug] == null)
  if (missing.length === 0) return NextResponse.json({ enriched: false, reason: 'already_complete' })

  const token = getToken(bug.rollbar_project_id)
  if (!token) return NextResponse.json({ enriched: false, reason: 'no_rollbar_token' })

  try {
    const result = await fetchRollbarItem(bug.rollbar_id, token)
    if (!result) return NextResponse.json({ enriched: false, reason: 'rollbar_item_not_found' })

    const { item, latestInstance, occurrenceBody } = result
    const exceptionClass = (occurrenceBody?.trace as Record<string, unknown> | undefined)?.exception
      ?? (occurrenceBody?.trace_chain as Array<Record<string, unknown>> | undefined)?.[0]?.exception

    const candidates: Record<EnrichableColumn, unknown> = {
      reporter_email: latestInstance?.data?.person?.email ?? null,
      environment: item?.environment ?? null,
      exception_class: (exceptionClass as Record<string, unknown> | undefined)?.class_name ?? null,
      server_name: latestInstance?.data?.server?.host ?? null,
    }

    const updates: Partial<Record<EnrichableColumn, unknown>> = {}
    for (const col of missing) {
      const value = candidates[col]
      if (value !== null && value !== undefined && value !== '') updates[col] = value
    }

    if (Object.keys(updates).length === 0) return NextResponse.json({ enriched: false, reason: 'no_new_data' })

    const { error: updateError } = await supabase
      .from('bug_reports')
      .update(updates)
      .eq('report_id', reportId)
    if (updateError) throw updateError

    return NextResponse.json({ enriched: true, updates })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
