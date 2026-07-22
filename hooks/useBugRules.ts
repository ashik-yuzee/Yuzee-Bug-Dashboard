'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { BugRule } from '@/components/DashboardClient'

async function fetchBugRules(): Promise<{ rules: BugRule[]; error: string | null }> {
  const supabase = createClient()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('bug_rules').select('*').order('priority', { ascending: true })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    return { rules: (data || []) as BugRule[], error: null }
  } catch (err) {
    return { rules: [], error: err instanceof Error ? err.message : 'Failed to load bug rules' }
  }
}

export function useBugRules() {
  const [rules, setRules] = useState<BugRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchBugRules()
      if (cancelled) return
      setRules(result.rules)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { rules, loading, error, refresh }
}
