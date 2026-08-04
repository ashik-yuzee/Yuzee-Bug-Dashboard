'use client'

import { useState } from 'react'
import Image from 'next/image'
import { RefreshCw, AlertTriangle, CheckCircle, User } from 'lucide-react'
import { useJiraSpaces } from '@/hooks/useJiraSpaces'
import type { JiraTicket } from '@/hooks/useJiraSpaces'
import { relativeTime } from '@/lib/utils'
import type { ParsedBug } from '@/lib/bugUtils'

interface Props {
  bugs: ParsedBug[]
}

type SpaceId = 'YSC' | 'YSDT'
type YscLabelFilter = 'all' | 'auto-bug' | 'user-bug' | 'user-feedback'

/* ── Helpers ──────────────────────────────────────────────────── */

function priorityToP(priority: string): string {
  switch (priority.toLowerCase()) {
    case 'critical': case 'highest': return 'P0'
    case 'high':     return 'P1'
    case 'medium':   return 'P2'
    case 'low':      return 'P3'
    case 'lowest': case 'minor': return 'P4'
    default:         return priority
  }
}

const PRIORITY_SORT_ORDER: Record<string, number> = {
  critical: 0, highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4, minor: 4,
}

function prioritySortKey(p: string): number {
  return PRIORITY_SORT_ORDER[p.toLowerCase()] ?? 5
}

function priorityColor(priority: string): string {
  const p = priorityToP(priority)
  switch (p) {
    case 'P0': return '#ef4444'
    case 'P1': return '#f59e0b'
    case 'P2': return '#3b82f6'
    case 'P3': return '#22c55e'
    default:   return '#6b7280'
  }
}

function statusBadgeStyle(statusCategory: string): React.CSSProperties {
  const lower = statusCategory.toLowerCase()
  if (lower === 'done') return { color: '#22c55e', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)' }
  if (lower.includes('progress')) return { color: '#3b82f6', background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.25)' }
  return { color: '#6b7280', background: 'rgba(107,114,128,.12)', border: '1px solid rgba(107,114,128,.25)' }
}

function classifyLabel(labels: string[]): 'auto-bug' | 'user-bug' | 'user-feedback' | 'other' {
  if (labels.includes('user-feedback')) return 'user-feedback'
  if (labels.includes('user-report'))   return 'user-bug'
  if (labels.includes('auto-bug'))      return 'auto-bug'
  return 'other'
}

function labelCategoryStyle(cat: YscLabelFilter): React.CSSProperties {
  switch (cat) {
    case 'auto-bug':      return { color: '#f87171', background: 'rgba(248,113,113,.10)', border: '1px solid rgba(248,113,113,.25)' }
    case 'user-bug':      return { color: '#fb923c', background: 'rgba(251,146,60,.10)', border: '1px solid rgba(251,146,60,.25)' }
    case 'user-feedback': return { color: '#a78bfa', background: 'rgba(167,139,250,.10)', border: '1px solid rgba(167,139,250,.25)' }
    default:              return { color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)' }
  }
}

function labelCategoryLabel(cat: string): string {
  switch (cat) {
    case 'auto-bug':      return 'Auto Bug'
    case 'user-bug':      return 'User Bug'
    case 'user-feedback': return 'Feedback'
    default:              return 'Other'
  }
}

/** How many bug_reports rows are linked to this Jira ticket. */
function linkedReportCount(bugs: ParsedBug[], jiraKey: string): number {
  return bugs.filter(b => b.jira_key === jiraKey).length
}

const PAGE_SIZE = 20

/* ── Shared ticket row renderer ─────────────────────────────────── */
function TicketRow({ ticket, bugs, showLabelBadge }: { ticket: JiraTicket; bugs: ParsedBug[]; showLabelBadge?: boolean }) {
  const pColor = priorityColor(ticket.priority)
  const pLabel = priorityToP(ticket.priority)
  const badgeStyle = statusBadgeStyle(ticket.statusCategory)
  const linked = linkedReportCount(bugs, ticket.key)
  const cat = classifyLabel(ticket.labels)

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '7px 10px' }}>
        <a href={ticket.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', textDecoration: 'none', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {ticket.key}
        </a>
        {linked > 0 && (
          <span title={`${linked} bug report${linked !== 1 ? 's' : ''} linked`} style={{
            marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#a78bfa',
            background: 'rgba(139,92,246,.10)', border: '1px solid rgba(139,92,246,.25)',
            padding: '1px 5px', borderRadius: 3,
          }}>
            {linked}×
          </span>
        )}
      </td>
      <td style={{ padding: '7px 10px', maxWidth: 320 }}>
        <span style={{ fontSize: 12, color: 'var(--tx-1)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ticket.summary}>
          {ticket.summary}
        </span>
      </td>
      <td style={{ padding: '7px 10px' }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: pColor + '18', color: pColor, border: `1px solid ${pColor}30`, whiteSpace: 'nowrap' }}>
          {pLabel}
        </span>
      </td>
      <td style={{ padding: '7px 10px' }}>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', ...badgeStyle }}>{ticket.status}</span>
      </td>
      {showLabelBadge && (
        <td style={{ padding: '7px 10px' }}>
          {cat !== 'other' && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', ...labelCategoryStyle(cat) }}>
              {labelCategoryLabel(cat)}
            </span>
          )}
        </td>
      )}
      <td style={{ padding: '7px 10px' }}>
        {ticket.assignee ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>
            {ticket.assignee.avatar
              ? <Image src={ticket.assignee.avatar} alt="" width={14} height={14} unoptimized style={{ borderRadius: '50%' }} />
              : <User size={11} />}
            {ticket.assignee.name}
          </span>
        ) : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Unassigned</span>}
      </td>
      <td style={{ padding: '7px 10px' }}>
        <span style={{ fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }} title={new Date(ticket.created).toLocaleString('en-AU')}>
          {relativeTime(ticket.created)}
        </span>
      </td>
    </tr>
  )
}

/* ── YSDT table view (existing layout, improved) ────────────────── */
function YsdtTable({ tickets, allTickets, isLast, bugs, page, onPageChange }: {
  tickets: JiraTicket[]
  allTickets: JiraTicket[]
  isLast: boolean
  bugs: ParsedBug[]
  page: number
  onPageChange: (p: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(allTickets.length / PAGE_SIZE))
  const rangeStart = page * PAGE_SIZE + 1
  const rangeEnd   = Math.min((page + 1) * PAGE_SIZE, allTickets.length)

  if (allTickets.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '14px 12px',
        background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.18)', borderRadius: 'var(--r-md)',
      }}>
        <CheckCircle size={13} color="#22c55e" />
        <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>All clear — no open tickets in YSDT</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Key', 'Summary', 'Priority', 'Status', 'Assignee', 'Created'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map(ticket => <TicketRow key={ticket.key} ticket={ticket} bugs={bugs} />)}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 2px', borderTop: '1px solid var(--border)', marginTop: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
          {rangeStart}–{rangeEnd} of {allTickets.length}{!isLast && ' (more in Jira)'}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => onPageChange(page - 1)} disabled={page === 0}
            style={{ fontSize: 11, padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: page === 0 ? 'var(--tx-3)' : 'var(--tx-2)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 11, color: 'var(--tx-3)', padding: '0 4px' }}>{page + 1} / {totalPages}</span>
          <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1}
            style={{ fontSize: 11, padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: page >= totalPages - 1 ? 'var(--tx-3)' : 'var(--tx-2)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Next →
          </button>
          {!isLast && (
            <a href="https://yuzeeau.atlassian.net/jira/software/projects/YSDT/boards"
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#58a6ff', marginLeft: 4, textDecoration: 'none' }}>
              Open in Jira →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── YSC view — Open/Closed toggle, label sub-filter within Open ─── */
function YscView({ tickets, isLast, bugs }: { tickets: JiraTicket[]; isLast: boolean; bugs: ParsedBug[] }) {
  const [view, setView]         = useState<'open' | 'closed'>('open')
  const [labelFilter, setLabel] = useState<YscLabelFilter>('all')

  const isOpen = (t: JiraTicket) => t.statusCategory.toLowerCase() !== 'done'

  const openTickets   = tickets.filter(isOpen)
  const closedTickets = tickets.filter(t => !isOpen(t))

  const LABEL_FILTERS: { id: YscLabelFilter; label: string }[] = [
    { id: 'all',           label: 'All' },
    { id: 'auto-bug',      label: 'Auto Bug' },
    { id: 'user-bug',      label: 'User Bug' },
    { id: 'user-feedback', label: 'Feedback' },
  ]

  const openLabelCounts: Record<YscLabelFilter, number> = {
    all:             openTickets.length,
    'auto-bug':      openTickets.filter(t => classifyLabel(t.labels) === 'auto-bug').length,
    'user-bug':      openTickets.filter(t => classifyLabel(t.labels) === 'user-bug').length,
    'user-feedback': openTickets.filter(t => classifyLabel(t.labels) === 'user-feedback').length,
  }

  function sortTickets(rows: JiraTicket[]) {
    return [...rows].sort((a, b) => {
      const pd = prioritySortKey(a.priority) - prioritySortKey(b.priority)
      return pd !== 0 ? pd : new Date(b.created).getTime() - new Date(a.created).getTime()
    })
  }

  const visibleRows = sortTickets(
    view === 'open'
      ? (labelFilter === 'all' ? openTickets : openTickets.filter(t => classifyLabel(t.labels) === labelFilter))
      : closedTickets
  )

  const TABLE_HEADERS = ['Key', 'Summary', 'Priority', 'Category', 'Assignee', 'Created']

  return (
    <div>
      {/* Primary toggle: Open / Closed */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3, gap: 2 }}>
          <button onClick={() => setView('open')} style={{
            fontSize: 12, fontWeight: view === 'open' ? 700 : 500,
            padding: '4px 14px', borderRadius: 'var(--r-sm)',
            background: view === 'open' ? 'rgba(34,197,94,.15)' : 'transparent',
            color: view === 'open' ? '#22c55e' : 'var(--tx-3)',
            border: view === 'open' ? '1px solid rgba(34,197,94,.3)' : '1px solid transparent',
            cursor: 'pointer', transition: 'all .12s', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            Open
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'rgba(255,255,255,.08)' }}>
              {openTickets.length}
            </span>
          </button>
          <button onClick={() => setView('closed')} style={{
            fontSize: 12, fontWeight: view === 'closed' ? 700 : 500,
            padding: '4px 14px', borderRadius: 'var(--r-sm)',
            background: view === 'closed' ? 'rgba(107,114,128,.15)' : 'transparent',
            color: view === 'closed' ? 'var(--tx-2)' : 'var(--tx-3)',
            border: view === 'closed' ? '1px solid rgba(107,114,128,.3)' : '1px solid transparent',
            cursor: 'pointer', transition: 'all .12s', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            Closed
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'rgba(255,255,255,.08)' }}>
              {closedTickets.length}
            </span>
          </button>
        </div>
        {!isLast && (
          <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
            showing latest 100 · <a href="https://yuzeeau.atlassian.net/jira/software/projects/YSC/boards" target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff' }}>see all in Jira</a>
          </span>
        )}
      </div>

      {/* Label sub-filter — only shown in Open view */}
      {view === 'open' && (
        <div style={{ display: 'flex', gap: 3, marginBottom: 12, flexWrap: 'wrap' }}>
          {LABEL_FILTERS.map(lf => {
            const active = labelFilter === lf.id
            const cs = lf.id !== 'all' ? labelCategoryStyle(lf.id) : {}
            return (
              <button key={lf.id} onClick={() => setLabel(lf.id)} style={{
                fontSize: 11, fontWeight: active ? 700 : 500,
                padding: '3px 10px', borderRadius: 'var(--r-sm)',
                display: 'flex', alignItems: 'center', gap: 4,
                background: active ? (lf.id === 'all' ? 'rgba(249,115,22,.15)' : (cs as React.CSSProperties).background as string) : 'var(--surface-2)',
                color:      active ? (lf.id === 'all' ? 'var(--orange)'         : (cs as React.CSSProperties).color      as string) : 'var(--tx-3)',
                border:     active ? (lf.id === 'all' ? '1px solid rgba(249,115,22,.35)' : (cs as React.CSSProperties).border as string) : '1px solid var(--border)',
                cursor: 'pointer', transition: 'all .12s',
              }}>
                {lf.label}
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: 'rgba(255,255,255,.08)' }}>
                  {openLabelCounts[lf.id]}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Ticket table */}
      {visibleRows.length === 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '14px 12px',
          background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.18)', borderRadius: 'var(--r-md)',
        }}>
          <CheckCircle size={13} color="#22c55e" />
          <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>No tickets here</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {TABLE_HEADERS.map(h => (
                  <th key={h} style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(t => <TicketRow key={t.key} ticket={t} bugs={bugs} showLabelBadge />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── JiraSpacesPanel — YSDT (main) / YSC tab switcher ───────────────── */
export default function JiraSpacesPanel({ bugs }: Props) {
  const { data, loading, error, refresh } = useJiraSpaces()
  const [activeSpace, setActiveSpace] = useState<SpaceId>('YSDT')
  const [ysdtPage, setYsdtPage] = useState(0)

  const TABS: { id: SpaceId; label: string; count: number; accent: string; main?: boolean }[] = [
    { id: 'YSDT', label: 'YSDT · Developer Tracking', count: data.ysdt.length, accent: '#58a6ff', main: true },
    { id: 'YSC',  label: 'YSC · Reported Issues',     count: data.ysc.length,  accent: '#f97316' },
  ]

  const ysdtPageTickets = data.ysdt.slice(ysdtPage * PAGE_SIZE, (ysdtPage + 1) * PAGE_SIZE)

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 18,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <p className="font-brand" style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx-1)', marginBottom: 3 }}>
            Jira Tracker
          </p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            YSDT · main developer bug tracking &nbsp;·&nbsp; YSC · all reported issues (auto-created, user bugs, feedback)
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {data.lastFetched && (
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{relativeTime(data.lastFetched)}</span>
          )}
          <button onClick={refresh} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--r-sm)', padding: '4px 9px',
            color: 'var(--tx-3)', fontSize: 11, cursor: 'pointer',
          }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(tab => {
          const active = activeSpace === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveSpace(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 14px', marginBottom: -1,
              background: 'transparent',
              color: active ? tab.accent : 'var(--tx-3)',
              border: 'none', borderBottom: `2px solid ${active ? tab.accent : 'transparent'}`,
              fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', transition: 'all .12s',
            }}>
              {tab.label}
              {tab.main && (
                <span style={{ fontSize: 9, fontWeight: 700, color: active ? tab.accent : '#6b7280', marginRight: -2 }}>★</span>
              )}
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                background: active ? tab.accent + '18' : 'var(--surface-2)',
                color: active ? tab.accent : 'var(--tx-3)',
              }}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 32, borderRadius: 6 }} />)}
        </div>
      ) : error ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
          background: 'rgba(255,123,114,.06)', border: '1px solid rgba(255,123,114,.22)', borderRadius: 'var(--r-md)',
        }}>
          <AlertTriangle size={14} color="#f87171" />
          <div>
            <p style={{ fontSize: 12, color: '#f87171', fontWeight: 600, marginBottom: 2 }}>Could not load Jira tickets</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>{error}</p>
          </div>
        </div>
      ) : activeSpace === 'YSDT' ? (
        <YsdtTable
          tickets={ysdtPageTickets}
          allTickets={data.ysdt}
          isLast={data.ysdtIsLast}
          bugs={bugs}
          page={ysdtPage}
          onPageChange={setYsdtPage}
        />
      ) : (
        <YscView
          tickets={data.ysc}
          isLast={data.yscIsLast}
          bugs={bugs}
        />
      )}

      {/* Footnote */}
      <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        P4 bugs are logged in Supabase only and do not generate Jira tickets.
      </p>
    </div>
  )
}
