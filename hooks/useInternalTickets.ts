'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withRetry } from '@/lib/withRetry'
import type { InternalTicket } from '@/components/DashboardClient'

async function fetchTickets(): Promise<{ tickets: InternalTicket[]; error: string | null }> {
  const supabase = createClient()
  try {
    const { data } = await withRetry(async () => {
      const res = await supabase.from('internal_tickets').select('*').order('created_at', { ascending: false })
      if (res.error) throw res.error
      return res
    }, { maxRetries: 2, baseDelayMs: 700 })
    return { tickets: (data || []) as InternalTicket[], error: null }
  } catch (err) {
    return { tickets: [], error: err instanceof Error ? err.message : 'Failed to load tickets' }
  }
}

export function useInternalTickets() {
  const [tickets, setTickets] = useState<InternalTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchTickets()
      if (cancelled) return
      setTickets(result.tickets)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { tickets, loading, error, refresh }
}
