'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { FeedbackReport } from '@/components/DashboardClient'

async function fetchFeedbackReports(): Promise<{ reports: FeedbackReport[]; error: string | null }> {
  const supabase = createClient()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('feedback_reports').select('*').order('created_at', { ascending: false })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    return { reports: (data || []) as FeedbackReport[], error: null }
  } catch (err) {
    return { reports: [], error: err instanceof Error ? err.message : 'Failed to load feedback reports' }
  }
}

export function useFeedbackReports() {
  const [reports, setReports] = useState<FeedbackReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchFeedbackReports()
      if (cancelled) return
      setReports(result.reports)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { reports, loading, error, refresh }
}
