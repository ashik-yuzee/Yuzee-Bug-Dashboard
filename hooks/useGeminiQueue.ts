'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { GeminiQueueItem } from '@/components/DashboardClient'

export interface GeminiQueueStats {
  queued: number
  processed: number
  stale: number
  failed: number
  avgMinutes: number | null
  stuckItems: GeminiQueueItem[]
  recentItems: GeminiQueueItem[]
}

const EMPTY_STATS: GeminiQueueStats = {
  queued: 0, processed: 0, stale: 0, failed: 0,
  avgMinutes: null, stuckItems: [], recentItems: [],
}

/** Pure data fetch — no component state, so it can be called from anywhere without tripping
 * the "don't call state setters as a bare effect body" lint rule. */
async function fetchQueueStats(): Promise<{ stats: GeminiQueueStats; error: string | null }> {
  const supabase = createClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000).toISOString()

  try {
    const [recentRes, stuckRes] = await Promise.all([
      supabase
        .from('gemini_queue')
        .select('*')
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false }),
      supabase
        .from('gemini_queue')
        .select('*')
        .eq('status', 'queued')
        .lt('created_at', thirtyMinsAgo),
    ])

    if (recentRes.error) throw recentRes.error

    const items = (recentRes.data || []) as GeminiQueueItem[]
    const stuckItems = (stuckRes.data || []) as GeminiQueueItem[]

    const counts = { queued: 0, processed: 0, stale: 0, failed: 0 }
    let totalMs = 0, processedCount = 0

    for (const item of items) {
      const s = item.status as keyof typeof counts
      if (s in counts) counts[s]++
      if (item.status === 'processed' && item.processed_at && item.queued_at) {
        const ms = new Date(item.processed_at).getTime() - new Date(item.queued_at).getTime()
        if (ms > 0) { totalMs += ms; processedCount++ }
      }
    }

    return {
      stats: {
        ...counts,
        avgMinutes: processedCount > 0 ? Math.round((totalMs / processedCount / 60_000) * 10) / 10 : null,
        stuckItems,
        recentItems: items,
      },
      error: null,
    }
  } catch (err) {
    return { stats: EMPTY_STATS, error: err instanceof Error ? err.message : 'Failed to load queue data' }
  }
}

export function useGeminiQueue() {
  const [stats, setStats] = useState<GeminiQueueStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchQueueStats()
      if (cancelled) return
      setStats(result.stats)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { stats, loading, error, refresh }
}
