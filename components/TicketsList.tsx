'use client'

import { useMemo, useState } from 'react'
import type { InternalTicket } from '@/components/DashboardClient'
import { TICKET_ASSIGNEES, TICKET_STATUSES, TICKET_TYPES, TICKET_PRIORITY_COLOR, ticketStatusMeta, ticketTypeMeta, formatTicketTs } from '@/lib/tickets'
import { jiraUrl } from '@/lib/utils'
import { Cloud, PenLine } from 'lucide-react'

interface Props {
  tickets: InternalTicket[]
  onOpen: (ticket: InternalTicket) => void
  linkedJiraKeys: Record<string, string | null>
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: color + '18', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export default function TicketsList({ tickets, onOpen, linkedJiraKeys }: Props) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const filtered = useMemo(() => tickets.filter(t =>
    (statusFilter === 'all' || t.status === statusFilter) &&
    (priorityFilter === 'all' || t.priority === priorityFilter) &&
    (assigneeFilter === 'all' || t.assignee === assigneeFilter) &&
    (typeFilter === 'all' || t.type === typeFilter)
  ), [tickets, statusFilter, priorityFilter, assigneeFilter, typeFilter])

  const selectStyle: React.CSSProperties = { fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {TICKET_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select style={selectStyle} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="all">All priorities</option>
          <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option>
        </select>
        <select style={selectStyle} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
          <option value="all">All assignees</option>
          {TICKET_ASSIGNEES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {TICKET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--tx-3)', alignSelf: 'center', marginLeft: 'auto' }}>{filtered.length} of {tickets.length}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              {['Key', 'Source', 'Title', 'Type', 'Priority', 'Status', 'Assignee', 'Linked Bug', 'Created', 'Updated'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: 'var(--tx-3)' }}>No tickets match your filters</td></tr>
            ) : filtered.map(t => {
              const statusMeta = ticketStatusMeta(t.status)
              const typeMeta = ticketTypeMeta(t.type)
              const linkedJira = t.linked_report_id ? linkedJiraKeys[t.linked_report_id] : null
              return (
                <tr key={t.id} onClick={() => onOpen(t)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--orange)', fontWeight: 700 }}>{t.ticket_key}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {t.source === 'jira' ? (
                      <span title="Synced from Jira" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--info)', background: 'rgba(88,166,255,.10)', border: '1px solid rgba(88,166,255,.22)', borderRadius: 20, padding: '2px 7px' }}>
                        <Cloud size={9} /> Jira
                      </span>
                    ) : (
                      <span title="Created in this dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px' }}>
                        <PenLine size={9} /> Internal
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--tx-1)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                  <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{typeMeta.icon} {typeMeta.label}</td>
                  <td style={{ padding: '9px 12px' }}>{t.priority ? <Pill label={t.priority} color={TICKET_PRIORITY_COLOR[t.priority]} /> : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}</td>
                  <td style={{ padding: '9px 12px' }}><Pill label={statusMeta.label} color={statusMeta.color} /></td>
                  <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{t.assignee || 'Unassigned'}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {t.linked_report_id ? (
                      <a href={jiraUrl(linkedJira) || '#'} onClick={e => e.stopPropagation()} target={jiraUrl(linkedJira) ? '_blank' : undefined} rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>
                        {linkedJira || t.linked_report_id}
                      </a>
                    ) : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{formatTicketTs(t.created_at)}</td>
                  <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{formatTicketTs(t.updated_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
