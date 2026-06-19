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
      .on<BugReport>(
        'postgres_changes' as Parameters<typeof channel.on>[0],
        { event: 'INSERT', schema: 'public', table: 'bug_reports' },
        payload => {
          setNewBugs(prev => [payload.new as BugReport, ...prev])
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED')   setStatus('connected')
        else if (status === 'CLOSED')  setStatus('closed')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('error')
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
