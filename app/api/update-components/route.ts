import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase/server'
import type { BugReport } from '@/components/DashboardClient'
import { inferComponent } from '@/lib/utils'

const BATCH = 500

function inferCategory(row: BugReport): string | null {
  if (row.category) return null // already set
  const p = (row.platform || '').toLowerCase()
  if (p === 'linux') return 'backend_error'
  if (p === 'ios' || p === 'android') return 'mobile_error'
  if (p === 'browser') return 'frontend_error'
  return null
}

/**
 * POST /api/update-components
 * Fetches bug_reports where component IS NULL or = 'Unknown', OR where category
 * is NULL but platform can give us a routing signal. Writes inferred values back.
 * Returns { updatedComponent, updatedCategory, skipped }
 */
export async function POST() {
  const denied = await checkAuth()
  if (denied) return denied

  const supabase = await createClient()

  let from = 0
  let updatedComponent = 0
  let updatedCategory = 0
  let skipped = 0

  while (true) {
    const { data, error } = await supabase
      .from('bug_reports')
      .select('*')
      .or('component.is.null,component.eq.Unknown,category.is.null')
      .range(from, from + BATCH - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break

    const componentUpdates: { report_id: string; component: string }[] = []
    const categoryUpdates: { report_id: string; category: string }[] = []

    for (const row of data as BugReport[]) {
      let didUpdate = false
      if (!row.component || row.component === 'Unknown') {
        const inferred = inferComponent(row)
        if (inferred && inferred !== 'Unknown') {
          componentUpdates.push({ report_id: row.report_id, component: inferred })
          didUpdate = true
        }
      }
      const inferredCat = inferCategory(row)
      if (inferredCat) {
        categoryUpdates.push({ report_id: row.report_id, category: inferredCat })
        didUpdate = true
      }
      if (!didUpdate) skipped++
    }

    if (componentUpdates.length > 0) {
      const { error: upErr } = await supabase
        .from('bug_reports')
        .upsert(componentUpdates, { onConflict: 'report_id' })
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      updatedComponent += componentUpdates.length
    }

    if (categoryUpdates.length > 0) {
      const { error: upErr } = await supabase
        .from('bug_reports')
        .upsert(categoryUpdates, { onConflict: 'report_id' })
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      updatedCategory += categoryUpdates.length
    }

    if (data.length < BATCH) break
    from += BATCH
  }

  return NextResponse.json({ updatedComponent, updatedCategory, skipped })
}
