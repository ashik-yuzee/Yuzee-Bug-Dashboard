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
import { Plus, RefreshCw, LayoutGrid, List as ListIcon, Cloud, Loader2 } from 'lucide-react'

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000
const SPACE_KEY = 'yuzee-tickets-space'

type SpaceFilter = 'all' | 'internal' | 'YSC' | 'YSDT'

function ticketSpace(key: string): 'internal' | 'YSC' | 'YSDT' {
  if (key.startsWith('YSC-'))  return 'YSC'
  if (key.startsWith('YSDT-')) return 'YSDT'
  return 'internal'
}

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

const SPACE_FILTERS: { id: SpaceFilter; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'YSDT',     label: 'YSDT' },
  { id: 'YSC',      label: 'YSC' },
  { id: 'internal', label: 'Internal' },
]

export default function TicketsTab({ tickets, loading, error, refresh, onOpen, onUpdated, onCreated, bugs }: Props) {
  const [sub, setSub] = useState<TicketsSubTab>('board')
  const [showCreate, setShowCreate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>('all')

  // Restore the space preference after mount (localStorage is a genuine external
  // system, unavailable during SSR) — deferred a tick so the effect body itself never
  // synchronously calls a state setter.
  useEffect(() => {
    const id = setTimeout(() => {
      const saved = localStorage.getItem(SPACE_KEY) as SpaceFilter | null
      if (saved && ['all', 'internal', 'YSC', 'YSDT'].includes(saved)) setSpaceFilter(saved)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  const handleSpaceFilter = (sf: SpaceFilter) => {
    setSpaceFilter(sf)
    localStorage.setItem(SPACE_KEY, sf)
  }

  const syncFromJira = useCallback(async (silent = false) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/jira/sync-tickets', { method: 'POST' })
      const data = await res.json() as { synced?: number; ysc?: number; ysdt?: number; note?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      if (!silent) {
        if ((data.synced ?? 0) > 0) {
          toast.success('Synced from Jira', `YSC: ${data.ysc ?? 0}  ·  YSDT: ${data.ysdt ?? 0} tickets up to date`)
        } else {
          toast.info('Nothing to sync', data.note || 'No issues returned from Jira')
        }
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

  const spaceCounts = useMemo(() => ({
    all:      tickets.length,
    YSDT:     tickets.filter(t => ticketSpace(t.ticket_key) === 'YSDT').length,
    YSC:      tickets.filter(t => ticketSpace(t.ticket_key) === 'YSC').length,
    internal: tickets.filter(t => ticketSpace(t.ticket_key) === 'internal').length,
  }), [tickets])

  const visibleTickets = useMemo(() => {
    if (spaceFilter === 'all') return tickets
    return tickets.filter(t => ticketSpace(t.ticket_key) === spaceFilter)
  }, [tickets, spaceFilter])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageInfo storageKey="tickets">
        A lightweight internal ticketing system plus a live mirror of every ticket in your Jira{' '}
        <strong>YSC</strong> and <strong>YSDT</strong> projects. Switch between spaces with the filter pills.
        Create internal tickets here, or link one from a bug&apos;s detail panel. Jira syncs automatically every 5
        minutes, or click <strong>Sync from Jira</strong> to pull the latest now.
      </PageInfo>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        {/* Left: view switcher + space filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
          {/* Space filter */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3 }}>
            {SPACE_FILTERS.map(sf => {
              const count = spaceCounts[sf.id]
              const active = spaceFilter === sf.id
              return (
                <button key={sf.id} onClick={() => handleSpaceFilter(sf.id)} style={{
                  fontSize: 11, fontWeight: active ? 700 : 400, padding: '4px 10px', borderRadius: 'var(--r-sm)',
                  background: active ? 'var(--orange-dim)' : 'transparent',
                  color: active ? 'var(--orange)' : 'var(--tx-3)',
                  border: 'none', cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {sf.label}
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: active ? 'rgba(249,115,22,.2)' : 'rgba(255,255,255,.07)', color: active ? 'var(--orange)' : 'var(--tx-3)' }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        {/* Right: actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
          No tickets in this space — <button onClick={() => handleSpaceFilter('all')} style={{ color: 'var(--orange)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0 }}>show all spaces</button>.
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
