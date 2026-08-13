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

type SpaceFilter    = 'all' | 'YSC' | 'YSDT'
type PlatformFilter = 'all' | 'BACKEND' | 'MOBILE' | 'WEB'

function ticketSpace(key: string): 'internal' | 'YSC' | 'YSDT' {
  if (key.startsWith('YSC-'))  return 'YSC'
  if (key.startsWith('YSDT-')) return 'YSDT'
  return 'internal'
}

/* ── Platform helpers ────────────────────────────────────────────── */

function parseRoutingFromTitle(title: string | null | undefined): PlatformFilter {
  if (!title) return 'all'
  if (title.includes('[BACKEND]')) return 'BACKEND'
  if (title.includes('[MOBILE]'))  return 'MOBILE'
  if (title.includes('[WEB]'))     return 'WEB'
  return 'all'
}

const PLATFORM_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  BACKEND: { bg: 'rgba(139,92,246,.12)', color: '#a78bfa', border: 'rgba(139,92,246,.25)' },
  MOBILE:  { bg: 'rgba(20,184,166,.12)', color: '#2dd4bf', border: 'rgba(20,184,166,.25)' },
  WEB:     { bg: 'rgba(34,197,94,.12)',  color: '#4ade80', border: 'rgba(34,197,94,.25)'  },
}

/* ── YSC helpers ─────────────────────────────────────────────────── */

function yscClassifyLabel(labels: string[] | null): 'auto-bug' | 'user-bug' | 'user-feedback' | 'other' {
  if (!labels) return 'other'
  if (labels.includes('user-feedback')) return 'user-feedback'
  if (labels.includes('user-report'))   return 'user-bug'
  if (labels.includes('auto-bug'))      return 'auto-bug'
  return 'other'
}

function yscPrioritySortKey(p: string | null): number {
  if (!p) return 5
  const n = parseInt(p.replace('P', ''), 10)
  return isNaN(n) ? 5 : n
}

const YSC_PRIORITY_COLOR: Record<string, string> = {
  P1: '#ef4444', P2: '#f59e0b', P3: '#3b82f6', P4: '#6b7280',
}

const YSC_LABEL_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  'auto-bug':      { color: '#f87171', bg: 'rgba(248,113,113,.10)', border: '1px solid rgba(248,113,113,.25)' },
  'user-bug':      { color: '#fb923c', bg: 'rgba(251,146,60,.10)',  border: '1px solid rgba(251,146,60,.25)' },
  'user-feedback': { color: '#a78bfa', bg: 'rgba(167,139,250,.10)', border: '1px solid rgba(167,139,250,.25)' },
}

type YscLabelFilter = 'all' | 'auto-bug' | 'user-bug' | 'user-feedback'

/* ── YSC Board columns ───────────────────────────────────────────── */

const YSC_BOARD_COLS: { id: 'auto-bug' | 'user-bug' | 'user-feedback' | 'other' | 'closed'; label: string; color: string }[] = [
  { id: 'auto-bug',      label: 'Auto Bug', color: '#f87171' },
  { id: 'user-bug',      label: 'User Bug', color: '#fb923c' },
  { id: 'user-feedback', label: 'Feedback', color: '#a78bfa' },
  { id: 'other',         label: 'Other',    color: '#6b7280' },
  { id: 'closed',        label: 'Closed',   color: '#22c55e' },
]

function YscBoardCard({ ticket, onOpen }: { ticket: InternalTicket; onOpen: () => void }) {
  const pColor = YSC_PRIORITY_COLOR[ticket.priority ?? ''] ?? '#6b7280'
  const href   = ticket.jira_url || `https://yuzeeau.atlassian.net/browse/${ticket.ticket_key}`
  return (
    <div onClick={onOpen} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hi)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', textDecoration: 'none', fontFamily: 'monospace' }}>
        {ticket.ticket_key}
      </a>
      <p style={{ fontSize: 12.5, color: 'var(--tx-1)', fontWeight: 500, lineHeight: 1.4, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
        {ticket.title}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {ticket.priority && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 12, background: pColor + '18', color: pColor, border: `1px solid ${pColor}40` }}>
            {ticket.priority}
          </span>
        )}
        {ticket.assignee && (
          <span title={ticket.assignee} style={{ fontSize: 9, fontWeight: 700, width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--tx-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {ticket.assignee[0]}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {new Date(ticket.jira_created_at || ticket.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
        </span>
      </div>
    </div>
  )
}

function YscBoard({ tickets, onOpen }: { tickets: InternalTicket[]; onOpen: (t: InternalTicket) => void }) {
  const colTickets = (colId: typeof YSC_BOARD_COLS[number]['id']) => {
    if (colId === 'closed') return tickets.filter(t => t.status === 'done').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const open = tickets.filter(t => t.status !== 'done')
    if (colId === 'other') return open.filter(t => yscClassifyLabel(t.labels) === 'other').sort((a, b) => yscPrioritySortKey(a.priority) - yscPrioritySortKey(b.priority) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return open.filter(t => yscClassifyLabel(t.labels) === colId).sort((a, b) => yscPrioritySortKey(a.priority) - yscPrioritySortKey(b.priority) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, alignItems: 'start' }}>
      {YSC_BOARD_COLS.map(col => {
        const rows = colTickets(col.id)
        return (
          <div key={col.id} style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: 10, minHeight: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', background: 'var(--surface-1)', borderRadius: 10, padding: '1px 8px' }}>{rows.length}</span>
            </div>
            {rows.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--tx-3)', textAlign: 'center', padding: '16px 4px', fontStyle: 'italic' }}>No tickets</p>
            ) : rows.map(t => (
              <YscBoardCard key={t.id} ticket={t} onOpen={() => onOpen(t)} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function YscTicketsView({ tickets, onOpen, layout }: { tickets: InternalTicket[]; onOpen: (t: InternalTicket) => void; layout: 'board' | 'list' }) {
  const [view, setView]     = useState<'open' | 'closed'>('open')
  const [label, setLabel]   = useState<YscLabelFilter>('all')

  const open   = tickets.filter(t => t.status !== 'done')
  const closed = tickets.filter(t => t.status === 'done')

  const LABEL_FILTERS: { id: YscLabelFilter; label: string }[] = [
    { id: 'all',           label: 'All' },
    { id: 'auto-bug',      label: 'Auto Bug' },
    { id: 'user-bug',      label: 'User Bug' },
    { id: 'user-feedback', label: 'Feedback' },
  ]

  const openCounts: Record<YscLabelFilter, number> = {
    all:             open.length,
    'auto-bug':      open.filter(t => yscClassifyLabel(t.labels) === 'auto-bug').length,
    'user-bug':      open.filter(t => yscClassifyLabel(t.labels) === 'user-bug').length,
    'user-feedback': open.filter(t => yscClassifyLabel(t.labels) === 'user-feedback').length,
  }

  const sortFn = (a: InternalTicket, b: InternalTicket) => {
    const pd = yscPrioritySortKey(a.priority) - yscPrioritySortKey(b.priority)
    if (pd !== 0) return pd
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }

  const rows = (view === 'open'
    ? (label === 'all' ? open : open.filter(t => yscClassifyLabel(t.labels) === label))
    : closed
  ).slice().sort(sortFn)

  if (layout === 'board') return <YscBoard tickets={tickets} onOpen={onOpen} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Primary Open / Closed toggle */}
      <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3, width: 'fit-content' }}>
        {(['open', 'closed'] as const).map(v => {
          const active = view === v
          const count  = v === 'open' ? open.length : closed.length
          return (
            <button key={v} onClick={() => setView(v)} style={{
              fontSize: 12, fontWeight: active ? 700 : 500,
              padding: '4px 14px', borderRadius: 'var(--r-sm)',
              display: 'flex', alignItems: 'center', gap: 5,
              background: active
                ? (v === 'open' ? 'rgba(34,197,94,.15)' : 'rgba(107,114,128,.15)')
                : 'transparent',
              color: active ? (v === 'open' ? '#22c55e' : 'var(--tx-2)') : 'var(--tx-3)',
              border: active
                ? (v === 'open' ? '1px solid rgba(34,197,94,.3)' : '1px solid rgba(107,114,128,.3)')
                : '1px solid transparent',
              cursor: 'pointer', transition: 'all .12s', textTransform: 'capitalize',
            }}>
              {v}
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'rgba(255,255,255,.08)' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Label sub-filter — only in Open view */}
      {view === 'open' && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {LABEL_FILTERS.map(lf => {
            const active = label === lf.id
            const ls = lf.id !== 'all' ? YSC_LABEL_STYLE[lf.id] : null
            return (
              <button key={lf.id} onClick={() => setLabel(lf.id)} style={{
                fontSize: 11, fontWeight: active ? 700 : 500,
                padding: '3px 10px', borderRadius: 'var(--r-sm)',
                display: 'flex', alignItems: 'center', gap: 4,
                background: active ? (ls ? ls.bg      : 'rgba(249,115,22,.15)') : 'var(--surface-2)',
                color:      active ? (ls ? ls.color   : 'var(--orange)')        : 'var(--tx-3)',
                border:     active ? (ls ? ls.border  : '1px solid rgba(249,115,22,.35)') : '1px solid var(--border)',
                cursor: 'pointer', transition: 'all .12s',
              }}>
                {lf.label}
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: 'rgba(255,255,255,.08)' }}>
                  {openCounts[lf.id]}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Ticket table */}
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--tx-3)', textAlign: 'center', padding: 32 }}>No tickets here.</p>
      ) : (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  {['Key', 'Title', 'Priority', 'Category', 'Assignee', 'Created'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const pColor = YSC_PRIORITY_COLOR[t.priority ?? ''] ?? '#6b7280'
                  const cat    = yscClassifyLabel(t.labels)
                  const ls     = cat !== 'other' ? YSC_LABEL_STYLE[cat] : null
                  const catLabel = cat === 'auto-bug' ? 'Auto Bug' : cat === 'user-bug' ? 'User Bug' : cat === 'user-feedback' ? 'Feedback' : '—'
                  const href   = t.jira_url || `https://yuzeeau.atlassian.net/browse/${t.ticket_key}`
                  return (
                    <tr key={t.id} onClick={() => onOpen(t)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', textDecoration: 'none', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {t.ticket_key}
                        </a>
                      </td>
                      <td style={{ padding: '8px 12px', maxWidth: 360 }}>
                        <span style={{ fontSize: 12, color: 'var(--tx-1)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>
                          {t.title}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {t.priority
                          ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: pColor + '18', color: pColor, border: `1px solid ${pColor}30`, whiteSpace: 'nowrap' }}>{t.priority}</span>
                          : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {ls
                          ? <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: ls.bg, color: ls.color, border: ls.border, whiteSpace: 'nowrap' }}>{catLabel}</span>
                          : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontSize: 11, color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>{t.assignee ?? '—'}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}
                          title={new Date(t.jira_created_at || t.created_at).toLocaleString('en-AU')}>
                          {new Date(t.jira_created_at || t.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Props ───────────────────────────────────────────────────────── */
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

const SPACE_FILTERS: { id: SpaceFilter; label: string; main?: boolean }[] = [
  { id: 'all',  label: 'All' },
  { id: 'YSDT', label: 'YSDT', main: true },
  { id: 'YSC',  label: 'YSC' },
]

export default function TicketsTab({ tickets, loading, error, refresh, onOpen, onUpdated, onCreated, bugs }: Props) {
  const [sub, setSub] = useState<TicketsSubTab>('board')
  const [showCreate, setShowCreate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>('YSDT')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')

  // Restore the space preference after mount (localStorage is a genuine external
  // system, unavailable during SSR) — deferred a tick so the effect body itself never
  // synchronously calls a state setter.
  useEffect(() => {
    const id = setTimeout(() => {
      const saved = localStorage.getItem(SPACE_KEY) as SpaceFilter | null
      if (saved && ['all', 'YSC', 'YSDT'].includes(saved)) setSpaceFilter(saved as SpaceFilter)
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

  // Sync on mount so the board reflects the latest Jira state immediately.
  // setTimeout defers the setState call inside syncFromJira out of the effect body.
  useEffect(() => {
    const id = setTimeout(() => { syncFromJira(true) }, 0)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Background auto-sync so new/updated Jira tickets stay current.
  useEffect(() => {
    const id = setInterval(() => { syncFromJira(true) }, AUTO_SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [syncFromJira])

  const linkedJiraKeys = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const b of bugs) map[b.report_id] = b.jira_key
    return map
  }, [bugs])

  // Bug-derived routing map so we can filter tickets by platform
  const jiraKeyToRouting = useMemo(() => {
    const map: Record<string, PlatformFilter> = {}
    for (const b of bugs) {
      if (b.jira_key && b.routingToken) map[b.jira_key] = b.routingToken as PlatformFilter
    }
    return map
  }, [bugs])

  const ticketRouting = (t: InternalTicket): PlatformFilter =>
    jiraKeyToRouting[t.ticket_key] ?? parseRoutingFromTitle(t.title)

  const spaceCounts = useMemo(() => ({
    all:  tickets.filter(t => t.status !== 'done').length,
    YSDT: tickets.filter(t => ticketSpace(t.ticket_key) === 'YSDT' && t.status !== 'done').length,
    YSC:  tickets.filter(t => ticketSpace(t.ticket_key) === 'YSC'  && t.status !== 'done').length,
  }), [tickets])

  const spaceTickets = useMemo(() => {
    if (spaceFilter === 'all') return tickets.filter(t => ticketSpace(t.ticket_key) !== 'internal')
    return tickets.filter(t => ticketSpace(t.ticket_key) === spaceFilter)
  }, [tickets, spaceFilter])

  // Platform counts over all spaceTickets (before assignee filter)
  const platformCounts = useMemo(() => ({
    all:     spaceTickets.filter(t => t.status !== 'done').length,
    BACKEND: spaceTickets.filter(t => t.status !== 'done' && ticketRouting(t) === 'BACKEND').length,
    MOBILE:  spaceTickets.filter(t => t.status !== 'done' && ticketRouting(t) === 'MOBILE').length,
    WEB:     spaceTickets.filter(t => t.status !== 'done' && ticketRouting(t) === 'WEB').length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [spaceTickets, jiraKeyToRouting])

  // Unique assignees across ALL non-internal tickets so the dropdown is always
  // comprehensive — not scoped to the current space filter.
  const assignees = useMemo(() => {
    const set = new Set<string>()
    for (const t of tickets) if (t.assignee && ticketSpace(t.ticket_key) !== 'internal') set.add(t.assignee)
    return Array.from(set).sort()
  }, [tickets])

  const visibleTickets = useMemo(() => {
    let out = spaceTickets
    if (platformFilter !== 'all') out = out.filter(t => ticketRouting(t) === platformFilter)
    if (assigneeFilter !== 'all') out = out.filter(t => t.assignee === assigneeFilter)
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceTickets, platformFilter, assigneeFilter, jiraKeyToRouting])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageInfo storageKey="tickets">
        A lightweight internal ticketing system plus a live mirror of every ticket in your Jira{' '}
        <strong>YSC</strong> and <strong>YSDT</strong> projects. Switch between spaces with the filter pills.
        Create internal tickets here, or link one from a bug&apos;s detail panel. Jira syncs automatically every 5
        minutes, or click <strong>Sync from Jira</strong> to pull the latest now.
      </PageInfo>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        {/* Left: view switcher + space filter + platform filter + assignee filter */}
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
              const count = spaceCounts[sf.id as keyof typeof spaceCounts]
              const active = spaceFilter === sf.id
              return (
                <button key={sf.id} onClick={() => handleSpaceFilter(sf.id)} style={{
                  fontSize: 11, fontWeight: active ? 700 : 400, padding: '4px 10px', borderRadius: 'var(--r-sm)',
                  background: active ? 'var(--orange-dim)' : 'transparent',
                  color: active ? 'var(--orange)' : 'var(--tx-3)',
                  border: sf.main && !active ? '1px solid rgba(249,115,22,.3)' : 'none',
                  cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {sf.label}
                  {sf.main && <span style={{ fontSize: 9, color: active ? 'var(--orange)' : '#f97316', fontWeight: 700 }}>★</span>}
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: active ? 'rgba(249,115,22,.2)' : 'rgba(255,255,255,.07)', color: active ? 'var(--orange)' : 'var(--tx-3)' }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Platform filter */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3 }}>
            {(['all', 'BACKEND', 'MOBILE', 'WEB'] as PlatformFilter[]).map(pf => {
              const pc      = pf !== 'all' ? PLATFORM_COLORS[pf] : null
              const active  = platformFilter === pf
              const cnt     = platformCounts[pf]
              return (
                <button key={pf} onClick={() => setPlatformFilter(pf)} style={{
                  fontSize: 11, fontWeight: active ? 700 : 400, padding: '4px 10px', borderRadius: 'var(--r-sm)',
                  background: active ? (pc ? pc.bg : 'rgba(255,255,255,.08)') : 'transparent',
                  color:      active ? (pc ? pc.color : 'var(--tx-1)') : 'var(--tx-3)',
                  border:     active ? `1px solid ${pc ? pc.border : 'rgba(255,255,255,.15)'}` : 'none',
                  cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {pf === 'all' ? 'All platforms' : pf}
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: 'rgba(255,255,255,.07)', color: active ? (pc?.color ?? 'var(--tx-2)') : 'var(--tx-3)' }}>
                    {cnt}
                  </span>
                </button>
              )
            })}
          </div>
          {/* Assignee filter */}
          {assignees.length > 0 && (
            <select
              value={assigneeFilter}
              onChange={e => setAssigneeFilter(e.target.value)}
              style={{
                fontSize: 11, padding: '5px 9px', borderRadius: 'var(--r-md)',
                background: assigneeFilter !== 'all' ? 'rgba(249,115,22,.12)' : 'var(--surface-2)',
                color: assigneeFilter !== 'all' ? 'var(--orange)' : 'var(--tx-2)',
                border: `1px solid ${assigneeFilter !== 'all' ? 'rgba(249,115,22,.35)' : 'var(--border)'}`,
                cursor: 'pointer', outline: 'none', appearance: 'none',
                paddingRight: 28,
                backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236b7280\' stroke-width=\'2\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
              }}>
              <option value="all">All assignees</option>
              {assignees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
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
      ) : spaceFilter === 'YSC' ? (
        <YscTicketsView tickets={visibleTickets} onOpen={onOpen} layout={sub} />
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
