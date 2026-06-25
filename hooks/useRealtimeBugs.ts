'use client'

import { useEffect, useRef, useState } from 'react'
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
  const supabase = createClient()
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('bug_reports_live', { config: { broadcast: { ack: false } } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'bug_reports' },
        (payload: { new: BugReport }) => {
          setNewBugs(prev => [payload.new, ...prev])
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
  }, [])

  const clearNewBugs = () => setNewBugs([])

  return { newBugs, status, clearNewBugs }
}
