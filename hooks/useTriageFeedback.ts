'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { TriageFeedback } from '@/components/DashboardClient'

async function fetchTriageFeedback(): Promise<{ feedback: TriageFeedback[]; error: string | null }> {
  const supabase = createClient()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('triage_feedback').select('*').order('created_at', { ascending: false })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    return { feedback: (data || []) as TriageFeedback[], error: null }
  } catch (err) {
    return { feedback: [], error: err instanceof Error ? err.message : 'Failed to load triage feedback' }
  }
}

export function useTriageFeedback() {
  const [feedback, setFeedback] = useState<TriageFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchTriageFeedback()
      if (cancelled) return
      setFeedback(result.feedback)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { feedback, loading, error, refresh }
}
