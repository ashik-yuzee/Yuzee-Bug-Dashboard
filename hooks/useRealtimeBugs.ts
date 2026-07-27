'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BugReport } from '@/components/DashboardClient'

export type RealtimeStatus = 'connecting' | 'connected' | 'error' | 'closed'

interface UseRealtimeBugsResult {
  newBugs: BugReport[]
  status: RealtimeStatus
  clearNewBugs: () => void
}

export function useRealtimeBugs(): UseRealtimeBugsResult {
  const [newBugs, setNewBugs] = useState<BugReport[]>([])
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const supabase = useMemo(() => createClient(), [])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('bug_reports_live', { config: { broadcast: { ack: false } } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'bug_reports' },
        (payload: { new: BugReport }) => {
          // Cap at 50 to prevent unbounded memory growth in long-running sessions
          setNewBugs(prev => [payload.new, ...prev].slice(0, 50))
        }
      )
      .subscribe((s: string) => {
        if (s === 'SUBSCRIBED')   setStatus('connected')
        else if (s === 'CLOSED')  setStatus('closed')
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error')
        else setStatus('connecting')
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [supabase])

  const clearNewBugs = () => setNewBugs([])

  return { newBugs, status, clearNewBugs }
}
