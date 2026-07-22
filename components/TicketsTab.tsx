'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import type { InternalTicket, TicketsSubTab } from '@/components/DashboardClient'
import type { ParsedBug } from '@/lib/bugUtils'
import TicketsBoard from './TicketsBoard'
import TicketsList from './TicketsList'
import TicketCreateModal from './TicketCreateModal'
import { SkeletonCard } from '@/components/ui/Skeleton'
import PageInfo from './ui/PageInfo'
import toast from '@/lib/toast'
import { Plus, RefreshCw, LayoutGrid, List as ListIcon, Cloud, Loader2, Eye, EyeOff } from 'lucide-react'

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000
const HIDE_JIRA_KEY = 'yuzee-tickets-hide-jira'

interface Props {
  tickets: InternalTicket[]
  loading: boolean
  error: string | null
  refresh: () => void
  onOpen: (ticket: InternalTicket) => void
  onUpdated: (id: string, changes: Partial<InternalTicket>) => void
  onCreated: (ticket: InternalTicket) => void
  bugs: ParsedBug[]
}

const SUB_TABS: { id: TicketsSubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'board', label: 'Board', icon: <LayoutGrid size={13} /> },
  { id: 'list', label: 'List', icon: <ListIcon size={13} /> },
]

export default function TicketsTab({ tickets, loading, error, refresh, onOpen, onUpdated, onCreated, bugs }: Props) {
  const [sub, setSub] = useState<TicketsSubTab>('board')
  const [showCreate, setShowCreate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [hideJira, setHideJira] = useState(false)

  // Restore the hide-Jira preference after mount (localStorage is a genuine external
  // system, unavailable during SSR) — deferred a tick so the effect body itself never
  // synchronously calls a state setter.
  useEffect(() => {
    const id = setTimeout(() => {
      if (localStorage.getItem(HIDE_JIRA_KEY) === '1') setHideJira(true)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const toggleHideJira = () => {
    setHideJira(prev => {
      const next = !prev
      localStorage.setItem(HIDE_JIRA_KEY, next ? '1' : '0')
      return next
    })
  }

  const syncFromJira = useCallback(async (silent = false) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/jira/sync-tickets', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      if (!silent) {
        if (data.synced > 0) toast.success('Synced from Jira', `${data.synced} ticket${data.synced === 1 ? '' : 's'} up to date`)
        else toast.info('Nothing to sync', data.note || 'No YSC issues were returned from Jira')
      }
      refresh()
    } catch (err) {
      if (!silent) toast.error('Jira sync failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  // Background auto-sync so new/updated Jira tickets show up without a manual click.
  useEffect(() => {
    const id = setInterval(() => { syncFromJira(true) }, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [syncFromJira])

  const linkedJiraKeys = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const b of bugs) map[b.report_id] = b.jira_key
    return map
  }, [bugs])

  const jiraCount = useMemo(() => tickets.filter(t => t.source === 'jira').length, [tickets])
  const visibleTickets = useMemo(() => hideJira ? tickets.filter(t => t.source !== 'jira') : tickets, [tickets, hideJira])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageInfo storageKey="tickets">
        A lightweight internal alternative to Jira for work that isn&apos;t an automated bug report, shown alongside a
        mirror of every ticket in your team&apos;s Jira YSC project. Create tickets here, or link one to an existing
        bug from that bug&apos;s own detail panel. Jira tickets sync automatically every 5 minutes, or click{' '}
        <strong>Sync from Jira</strong> for the latest right away.
      </PageInfo>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3 }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: sub === t.id ? 600 : 400, padding: '5px 12px', borderRadius: 'var(--r-sm)',
              background: sub === t.id ? 'var(--orange-dim)' : 'transparent',
              color: sub === t.id ? 'var(--orange)' : 'var(--tx-3)',
              border: 'none', cursor: 'pointer', transition: 'all .15s',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {jiraCount > 0 && (
            <button
              onClick={toggleHideJira}
              title={hideJira ? 'Show tickets synced from Jira' : 'Hide tickets synced from Jira'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: hideJira ? 'var(--orange)' : 'var(--tx-3)', background: hideJira ? 'var(--orange-dim)' : 'var(--surface-2)', border: `1px solid ${hideJira ? 'rgba(249,115,22,.3)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', padding: '6px 11px', cursor: 'pointer' }}
            >
              {hideJira ? <EyeOff size={12} /> : <Eye size={12} />} {hideJira ? `Jira hidden (${jiraCount})` : `Showing Jira (${jiraCount})`}
            </button>
          )}
          <button onClick={() => syncFromJira(false)} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--tx-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 11px', cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.6 : 1 }}>
            {syncing ? <Loader2 size={12} className="anim-spin" /> : <Cloud size={12} />} Sync from Jira
          </button>
          <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 11px', cursor: 'pointer' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--orange)', border: 'none', borderRadius: 'var(--r-md)', padding: '6px 13px', cursor: 'pointer' }}>
            <Plus size={13} /> New Ticket
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonCard h={320} />
      ) : error ? (
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
      ) : tickets.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>No internal tickets yet</p>
          <p style={{ fontSize: 12, color: 'var(--tx-3)', maxWidth: 360 }}>
            Create a ticket here for internal work — refactors, investigations, anything that isn&apos;t an automated bug report — or link one from an existing bug&apos;s detail panel.
          </p>
          <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--orange)', border: 'none', borderRadius: 'var(--r-md)', padding: '7px 14px', cursor: 'pointer', marginTop: 6 }}>
            <Plus size={13} /> Create your first ticket
          </button>
        </div>
      ) : visibleTickets.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--tx-3)', textAlign: 'center', padding: 40 }}>
          All tickets are hidden by the Jira filter — <button onClick={toggleHideJira} style={{ color: 'var(--orange)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>show them again</button>.
        </p>
      ) : sub === 'board' ? (
        <TicketsBoard tickets={visibleTickets} onOpen={onOpen} onUpdated={onUpdated} />
      ) : (
        <TicketsList tickets={visibleTickets} onOpen={onOpen} linkedJiraKeys={linkedJiraKeys} />
      )}

      {showCreate && (
        <TicketCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={onCreated}
          bugs={bugs}
        />
      )}
    </div>
  )
}
