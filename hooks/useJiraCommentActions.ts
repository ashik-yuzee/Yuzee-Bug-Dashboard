'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { JiraCommentAction } from '@/components/DashboardClient'

export interface JiraCommentActionsResult {
  /** All rows (comment log is small — a few hundred at most) so the table shows full history. */
  actions: JiraCommentAction[]
  /** Intent counts scoped to the last 7 days, per the spec's summary bar. */
  intentCounts: Record<string, number>
}

async function fetchJiraCommentActions(): Promise<{ result: JiraCommentActionsResult; error: string | null }> {
  const supabase = createClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('jira_comment_actions').select('*').order('processed_at', { ascending: false })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    const actions = (data || []) as JiraCommentAction[]
    const intentCounts: Record<string, number> = {}
    for (const a of actions) {
      if (!a.processed_at || a.processed_at < sevenDaysAgo) continue
      const key = a.intent || 'unknown'
      intentCounts[key] = (intentCounts[key] || 0) + 1
    }
    return { result: { actions, intentCounts }, error: null }
  } catch (err) {
    return { result: { actions: [], intentCounts: {} }, error: err instanceof Error ? err.message : 'Failed to load Jira comment actions' }
  }
}

export function useJiraCommentActions() {
  const [result, setResult] = useState<JiraCommentActionsResult>({ actions: [], intentCounts: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const res = await fetchJiraCommentActions()
      if (cancelled) return
      setResult(res.result)
      setError(res.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { actions: result.actions, intentCounts: result.intentCounts, loading, error, refresh }
}
