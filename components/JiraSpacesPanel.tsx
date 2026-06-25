'use client'

import { ExternalLink, RefreshCw, AlertTriangle, CheckCircle, Clock, User, ArrowRight, Copy } from 'lucide-react'
import { useJiraSpaces } from '@/hooks/useJiraSpaces'
import type { JiraTicket } from '@/hooks/useJiraSpaces'
import { relativeTime } from '@/lib/utils'
import type { ParsedBug } from '@/lib/bugUtils'

interface Props {
  bugs: ParsedBug[]
}

/* ── Helpers ──────────────────────────────────────────────────── */

function priorityToSev(priority: string): string {
  switch (priority.toLowerCase()) {
    case 'highest': case 'critical': return 'P1'
    case 'high':    return 'P2'
    case 'medium':  return 'P3'
    case 'low':     return 'P4'
    default:        return priority.slice(0, 2).toUpperCase()
  }
}

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

/* Checks if a Jira key is linked to any bug_report row */
function hasBugReport(bugs: ParsedBug[], jiraKey: string): boolean {
  return bugs.some(b => b.jira_key === jiraKey)
}

/* Counts how many bug_reports are marked as duplicates of this Jira ticket */
function duplicateReportCount(bugs: ParsedBug[], jiraKey: string): number {
  return bugs.filter(b => b.jira_key === jiraKey && b.is_duplicate === true).length
}

/* Counts all bug_reports linked to this Jira ticket */
function linkedReportCount(bugs: ParsedBug[], jiraKey: string): number {
  return bugs.filter(b => b.jira_key === jiraKey).length
}

/* ── TicketRow ─────────────────────────────────────────────────── */
function TicketRow({
  ticket,
  showEscalation,
  isDuplicate,
  dupCount,
  linkedCount,
}: {
  ticket: JiraTicket
  showEscalation: boolean
  isDuplicate: boolean
  dupCount: number
  linkedCount: number
}) {
  const pColor = priorityColor(ticket.priority)
  const sevLabel = priorityToSev(ticket.priority)
  const isHighPriority = ticket.priority === 'Highest' || ticket.priority === 'High'
  const badgeStyle = statusBadgeStyle(ticket.statusCategory)

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9,
        padding: '8px 10px',
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-md)',
        borderTop: `2px solid ${pColor}`,
        transition: 'opacity .15s',
        position: 'relative',
      }}
    >
      {/* Severity pill */}
      <span style={{
        fontSize: 10, fontWeight: 700, flexShrink: 0,
        padding: '2px 5px', borderRadius: 3,
        background: pColor + '18', color: pColor, border: `1px solid ${pColor}30`,
        minWidth: 26, textAlign: 'center',
      }}>
        {sevLabel}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top row: key + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, fontWeight: 700, color: '#58a6ff', textDecoration: 'none', fontFamily: 'monospace', flexShrink: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {ticket.key}
          </a>

          {/* Escalated to YSDT for P1/P2 in YSC */}
          {showEscalation && isHighPriority && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 2,
              fontSize: 9, fontWeight: 700,
              color: '#f59e0b', background: 'rgba(245,158,11,.10)',
              border: '1px solid rgba(245,158,11,.25)',
              padding: '1px 5px', borderRadius: 3, flexShrink: 0,
            }}>
              <ArrowRight size={7} /> YSDT
            </span>
          )}

          {/* Cross-referenced in our bug_reports */}
          {isDuplicate && (
            <span
              title={`${linkedCount} bug report${linkedCount !== 1 ? 's' : ''} linked · ${dupCount} marked duplicate`}
              style={{
                fontSize: 9, fontWeight: 600,
                color: '#a78bfa', background: 'rgba(139,92,246,.10)',
                border: '1px solid rgba(139,92,246,.25)',
                padding: '1px 5px', borderRadius: 3, flexShrink: 0,
              }}
            >
              {linkedCount} report{linkedCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Duplicate report count badge */}
          {dupCount > 0 && (
            <span
              title={`${dupCount} bug report${dupCount !== 1 ? 's' : ''} flagged as duplicate of this ticket`}
              style={{
                fontSize: 9, fontWeight: 700,
                color: '#f59e0b', background: 'rgba(245,158,11,.10)',
                border: '1px solid rgba(245,158,11,.25)',
                padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                cursor: 'default',
              }}
            >
              {dupCount} dup{dupCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Status */}
          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, marginLeft: 'auto', flexShrink: 0, ...badgeStyle }}>
            {ticket.status}
          </span>
        </div>

        {/* Summary */}
        <p style={{
          fontSize: 11, color: 'var(--tx-1)', lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 4,
        }}>
          {ticket.summary}
        </p>

        {/* Footer: assignee + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {ticket.assignee ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--tx-3)' }}>
              {ticket.assignee.avatar
                ? <img src={ticket.assignee.avatar} alt="" width={12} height={12} style={{ borderRadius: '50%' }} />
                : <User size={9} />}
              {ticket.assignee.name.split(' ')[0]}
            </span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>Unassigned</span>
          )}

          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto' }}>
            <Clock size={9} /> {relativeTime(ticket.updated)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── SpaceColumn ───────────────────────────────────────────────── */
function SpaceColumn({
  space,
  label,
  description,
  accentColor,
  tickets,
  total,
  showEscalation,
  bugs,
}: {
  space: string
  label: string
  description: string
  accentColor: string
  tickets: JiraTicket[]
  total: number
  showEscalation: boolean
  bugs: ParsedBug[]
}) {
  const overflowCount = total > tickets.length ? total - tickets.length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Column header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8, paddingBottom: 10,
        borderBottom: `1px solid var(--border)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '.05em',
            color: accentColor, background: accentColor + '14',
            border: `1px solid ${accentColor}30`,
            padding: '2px 9px', borderRadius: 4,
          }}>
            {space}
          </span>
          <span style={{ fontSize: 12, color: 'var(--tx-1)', fontWeight: 600 }}>{label}</span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: total > 0 ? accentColor : 'var(--tx-3)',
            background: total > 0 ? accentColor + '10' : 'var(--surface-2)',
            border: `1px solid ${total > 0 ? accentColor + '25' : 'var(--border)'}`,
            padding: '1px 7px', borderRadius: 10,
          }}>
            {total}
          </span>
        </div>
        <a
          href={`https://yuzeeau.atlassian.net/jira/software/projects/${space}/boards`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#58a6ff', textDecoration: 'none' }}
        >
          Open board <ExternalLink size={9} />
        </a>
      </div>

      <p style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 10 }}>{description}</p>

      {/* Ticket list */}
      {tickets.length === 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 12px',
          background: 'rgba(34,197,94,.06)',
          border: '1px solid rgba(34,197,94,.18)',
          borderRadius: 'var(--r-md)',
        }}>
          <CheckCircle size={13} color="#22c55e" />
          <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>All clear — no open tickets</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tickets.map(ticket => (
            <TicketRow
              key={ticket.key}
              ticket={ticket}
              showEscalation={showEscalation}
              isDuplicate={hasBugReport(bugs, ticket.key)}
              dupCount={duplicateReportCount(bugs, ticket.key)}
              linkedCount={linkedReportCount(bugs, ticket.key)}
            />
          ))}

          {overflowCount > 0 && (
            <a
              href={`https://yuzeeau.atlassian.net/jira/software/projects/${space}/boards`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', textAlign: 'center', fontSize: 11,
                color: '#58a6ff', padding: '7px 0',
                borderTop: '1px solid var(--border)', marginTop: 2,
                textDecoration: 'none',
              }}
            >
              +{overflowCount} more in {space} →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/* Checks if a YSDT ticket key is referenced from any YSC bug (via description or jira_key prefix) */
function ysdtLinkedToYsc(ysdtKey: string, yscTickets: import('@/hooks/useJiraSpaces').JiraTicket[]): boolean {
  // YSDT tickets often have the same number as YSC (e.g. YSDT-44 ↔ YSC-44)
  const num = ysdtKey.split('-')[1]
  return yscTickets.some(t => t.key.split('-')[1] === num || t.summary?.includes(ysdtKey))
}

/* ── JiraSpacesPanel ───────────────────────────────────────────── */
export default function JiraSpacesPanel({ bugs }: Props) {
  const { data, loading, error, refresh } = useJiraSpaces()

  // Cross-reference: how many of our current bug_reports map to open Jira tickets?
  const linkedCount = data.ysc.filter(t => hasBugReport(bugs, t.key)).length
    + data.ysdp.filter(t => hasBugReport(bugs, t.key)).length
    + data.ysdt.filter(t => hasBugReport(bugs, t.key)).length

  // Unlinked YSC tickets (Jira has them but our pipeline didn't create a bug_report entry)
  const yscUnlinked = data.ysc.filter(t => !hasBugReport(bugs, t.key)).length

  // Summary stats
  const totalOpen = data.ysdpTotal + data.yscTotal + data.ysdtTotal

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 18,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <p className="font-brand" style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx-1)' }}>
              Jira Spaces
            </p>
            {!loading && (
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: totalOpen > 0 ? '#f59e0b' : '#22c55e',
                background: totalOpen > 0 ? 'rgba(245,158,11,.10)' : 'rgba(34,197,94,.10)',
                border: `1px solid ${totalOpen > 0 ? 'rgba(245,158,11,.25)' : 'rgba(34,197,94,.25)'}`,
                padding: '1px 8px', borderRadius: 10,
              }}>
                {totalOpen} open
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            YSDP · manual reports &nbsp;·&nbsp; YSC · automated P1–P3 &nbsp;·&nbsp; YSDT · dev tracking &amp; escalations
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Cross-reference pill */}
          {!loading && linkedCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: '#a78bfa', background: 'rgba(139,92,246,.10)',
              border: '1px solid rgba(139,92,246,.25)',
              padding: '3px 9px', borderRadius: 10,
            }}>
              {linkedCount} linked to dashboard
            </span>
          )}

          {/* Unlinked warning */}
          {!loading && yscUnlinked > 0 && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600,
              color: '#f59e0b', background: 'rgba(245,158,11,.10)',
              border: '1px solid rgba(245,158,11,.25)',
              padding: '3px 9px', borderRadius: 10,
            }}>
              <AlertTriangle size={10} />
              {yscUnlinked} not in dashboard
            </span>
          )}

          {data.lastFetched && (
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
              {relativeTime(data.lastFetched)}
            </span>
          )}

          <button
            onClick={refresh}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)', padding: '4px 9px',
              color: 'var(--tx-3)', fontSize: 11, cursor: 'pointer',
            }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="skeleton" style={{ height: 22, width: 160, borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 11, width: '80%', borderRadius: 3 }} />
              {[0, 1, 2, 3].map(j => (
                <div key={j} className="skeleton" style={{ height: 66, borderRadius: 8 }} />
              ))}
            </div>
          ))}
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
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <SpaceColumn
            space="YSDP"
            label="Manual Reports"
            description="User-submitted bugs via the Yuzee Bug Form. Review and triage manually."
            accentColor="#4ade80"
            tickets={data.ysdp}
            total={data.ysdpTotal}
            showEscalation={false}
            bugs={bugs}
          />
          <SpaceColumn
            space="YSC"
            label="Active Bugs (P1–P3)"
            description="Auto-created by n8n pipeline from Rollbar. P1/P2 auto-escalated to YSDT with assignee."
            accentColor="#f97316"
            tickets={data.ysc}
            total={data.yscTotal}
            showEscalation
            bugs={bugs}
          />
          <SpaceColumn
            space="YSDT"
            label="Dev Tracking"
            description="Escalated P1/P2 bugs assigned to developers. Tracks active investigation and resolution."
            accentColor="#58a6ff"
            tickets={data.ysdt}
            total={data.ysdtTotal}
            showEscalation={false}
            bugs={bugs}
          />
        </div>
      )}

      {/* Legend */}
      {!loading && !error && (data.ysdp.length > 0 || data.ysc.length > 0 || data.ysdt.length > 0) && (
        <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, color: '#a78bfa' }}>linked</span> — ticket key matches a bug_report row in the dashboard. &nbsp;
          <span style={{ fontWeight: 700, color: '#f59e0b' }}>not in dashboard</span> — YSC ticket exists but no matching bug_report (pipeline gap or pre-dashboard). &nbsp;
          <span style={{ fontWeight: 700, color: '#58a6ff' }}>YSDT</span> — P1/P2 tickets escalated from YSC for developer assignment.
        </p>
      )}
    </div>
  )
}
