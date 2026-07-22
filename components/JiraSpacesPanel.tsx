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

/* ── Helpers ──────────────────────────────────────────────────── */

function priorityColor(priority: string): string {
  switch (priority.toLowerCase()) {
    case 'highest': case 'critical': return '#ef4444'
    case 'high':    return '#f59e0b'
    case 'medium':  return '#3b82f6'
    default:        return '#6b7280'
  }
}

function statusBadgeStyle(statusCategory: string): React.CSSProperties {
  const lower = statusCategory.toLowerCase()
  if (lower === 'done') return { color: '#22c55e', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)' }
  if (lower.includes('progress')) return { color: '#3b82f6', background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.25)' }
  return { color: '#6b7280', background: 'rgba(107,114,128,.12)', border: '1px solid rgba(107,114,128,.25)' }
}

/** How many bug_reports rows are linked to this Jira ticket. */
function linkedReportCount(bugs: ParsedBug[], jiraKey: string): number {
  return bugs.filter(b => b.jira_key === jiraKey).length
}

const PAGE_SIZE = 20

/* ── Table ─────────────────────────────────────────────────────── */
function SpaceTable({ tickets, allTickets, isLast, space, bugs, page, onPageChange }: {
  tickets: JiraTicket[]
  allTickets: JiraTicket[]
  isLast: boolean
  space: SpaceId
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
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '14px 12px',
        background: 'rgba(34,197,94,.06)',
        border: '1px solid rgba(34,197,94,.18)',
        borderRadius: 'var(--r-md)',
      }}>
        <CheckCircle size={13} color="#22c55e" />
        <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>All clear — no open tickets in {space}</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Key', 'Summary', 'Status', 'Assignee', 'Priority', 'Created', 'Labels'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map(ticket => {
              const pColor = priorityColor(ticket.priority)
              const badgeStyle = statusBadgeStyle(ticket.statusCategory)
              const linked = linkedReportCount(bugs, ticket.key)
              return (
                <tr key={ticket.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px' }}>
                    <a href={ticket.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, fontWeight: 700, color: '#58a6ff', textDecoration: 'none', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {ticket.key}
                    </a>
                    {linked > 0 && (
                      <span title={`${linked} bug report${linked !== 1 ? 's' : ''} linked to this ticket`} style={{
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
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', ...badgeStyle }}>{ticket.status}</span>
                  </td>
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
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: pColor + '18', color: pColor, border: `1px solid ${pColor}30` }}>
                      {ticket.priority}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{ fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }} title={new Date(ticket.created).toLocaleString('en-AU')}>
                      {relativeTime(ticket.created)}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180 }}>
                      {ticket.labels.slice(0, 3).map(l => (
                        <span key={l} style={{ fontSize: 9, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>{l}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 2px', borderTop: '1px solid var(--border)', marginTop: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
          {rangeStart}–{rangeEnd} of {allTickets.length}
          {!isLast && ' (more in Jira)'}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            style={{ fontSize: 11, padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: page === 0 ? 'var(--tx-3)' : 'var(--tx-2)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}
          >← Prev</button>
          <span style={{ fontSize: 11, color: 'var(--tx-3)', padding: '0 4px' }}>{page + 1} / {totalPages}</span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1}
            style={{ fontSize: 11, padding: '3px 9px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', color: page >= totalPages - 1 ? 'var(--tx-3)' : 'var(--tx-2)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}
          >Next →</button>
          {!isLast && (
            <a
              href={`https://yuzeeau.atlassian.net/jira/software/projects/${space}/boards`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#58a6ff', marginLeft: 4, textDecoration: 'none' }}
            >
              Open in Jira →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── JiraSpacesPanel — YSC / YSDT tab switcher ───────────────────── */
export default function JiraSpacesPanel({ bugs }: Props) {
  const { data, loading, error, refresh } = useJiraSpaces()
  const [activeSpace, setActiveSpace] = useState<SpaceId>('YSDT')
  const [pages, setPages] = useState<Record<SpaceId, number>>({ YSC: 0, YSDT: 0 })

  function handleSpaceChange(space: SpaceId) {
    setActiveSpace(space)
  }

  function handlePageChange(p: number) {
    setPages(prev => ({ ...prev, [activeSpace]: p }))
  }

  const TABS: { id: SpaceId; label: string; count: number; accent: string }[] = [
    { id: 'YSC',  label: 'YSC · Auto-created (P0–P3)',      count: data.ysc.length,  accent: '#f97316' },
    { id: 'YSDT', label: 'YSDT · Developer tracking (P0–P2)', count: data.ysdt.length, accent: '#58a6ff' },
  ]

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
            YSC · all auto-created tickets &nbsp;·&nbsp; YSDT · P0–P2 assigned to developers
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
            <button key={tab.id} onClick={() => handleSpaceChange(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 14px', marginBottom: -1,
              background: 'transparent',
              color: active ? tab.accent : 'var(--tx-3)',
              border: 'none', borderBottom: `2px solid ${active ? tab.accent : 'transparent'}`,
              fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', transition: 'all .12s',
            }}>
              {tab.label}
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
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 14px',
          background: 'rgba(255,123,114,.06)',
          border: '1px solid rgba(255,123,114,.22)',
          borderRadius: 'var(--r-md)',
        }}>
          <AlertTriangle size={14} color="#f87171" />
          <div>
            <p style={{ fontSize: 12, color: '#f87171', fontWeight: 600, marginBottom: 2 }}>Could not load Jira tickets</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>{error}</p>
          </div>
        </div>
      ) : activeSpace === 'YSC' ? (
        <SpaceTable
          tickets={data.ysc.slice(pages.YSC * PAGE_SIZE, (pages.YSC + 1) * PAGE_SIZE)}
          allTickets={data.ysc}
          isLast={data.yscIsLast}
          space="YSC"
          bugs={bugs}
          page={pages.YSC}
          onPageChange={handlePageChange}
        />
      ) : (
        <SpaceTable
          tickets={data.ysdt.slice(pages.YSDT * PAGE_SIZE, (pages.YSDT + 1) * PAGE_SIZE)}
          allTickets={data.ysdt}
          isLast={data.ysdtIsLast}
          space="YSDT"
          bugs={bugs}
          page={pages.YSDT}
          onPageChange={handlePageChange}
        />
      )}

      {/* Footnote */}
      <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        P4 bugs are logged in Supabase only and do not generate Jira tickets.
      </p>
    </div>
  )
}
