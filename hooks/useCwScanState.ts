'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { CwScanState } from '@/components/DashboardClient'

async function fetchCwScanState(): Promise<{ groups: CwScanState[]; error: string | null }> {
  const supabase = createClient()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('cw_scan_state').select('*').order('log_group', { ascending: true })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    return { groups: (data || []) as CwScanState[], error: null }
  } catch (err) {
    return { groups: [], error: err instanceof Error ? err.message : 'Failed to load CloudWatch scan state' }
  }
}

export function useCwScanState() {
  const [groups, setGroups] = useState<CwScanState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchCwScanState()
      if (cancelled) return
      setGroups(result.groups)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { groups, loading, error, refresh }
}
