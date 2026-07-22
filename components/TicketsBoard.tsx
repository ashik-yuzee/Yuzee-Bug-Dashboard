'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InternalTicket, TicketStatus } from '@/components/DashboardClient'
import { TICKET_STATUSES, ticketTypeMeta, TICKET_PRIORITY_COLOR, updateTicketField } from '@/lib/tickets'
import toast from '@/lib/toast'
import { ChevronRight, Cloud } from 'lucide-react'

interface Props {
  tickets: InternalTicket[]
  onOpen: (ticket: InternalTicket) => void
  onUpdated: (id: string, changes: Partial<InternalTicket>) => void
}

function TicketCard({ ticket, onOpen, onMove }: { ticket: InternalTicket; onOpen: () => void; onMove: (status: TicketStatus) => void }) {
  const typeMeta = ticketTypeMeta(ticket.type)
  const idx = TICKET_STATUSES.findIndex(s => s.id === ticket.status)
  const next = TICKET_STATUSES[idx + 1]

  return (
    <div
      onClick={onOpen}
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--orange)' }}>{ticket.ticket_key}</span>
          {ticket.source === 'jira' && <Cloud size={10} color="var(--info)" aria-label="Synced from Jira" />}
        </span>
        <span title={typeMeta.label} style={{ fontSize: 12 }}>{typeMeta.icon}</span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--tx-1)', fontWeight: 500, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
        {ticket.title}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {ticket.priority && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 12, background: TICKET_PRIORITY_COLOR[ticket.priority] + '18', color: TICKET_PRIORITY_COLOR[ticket.priority], border: `1px solid ${TICKET_PRIORITY_COLOR[ticket.priority]}40` }}>
              {ticket.priority}
            </span>
          )}
          {ticket.assignee && (
            <span title={ticket.assignee} style={{ fontSize: 9, fontWeight: 700, width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--tx-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {ticket.assignee[0]}
            </span>
          )}
        </div>
        {next && (
          <button
            onClick={e => { e.stopPropagation(); onMove(next.id) }}
            title={`Move to ${next.label}`}
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 7px', cursor: 'pointer' }}
          >
            {next.label} <ChevronRight size={10} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function TicketsBoard({ tickets, onOpen, onUpdated }: Props) {
  const [movingId, setMovingId] = useState<string | null>(null)

  const handleMove = async (ticket: InternalTicket, newStatus: TicketStatus) => {
    setMovingId(ticket.id)
    onUpdated(ticket.id, { status: newStatus })
    const supabase = createClient()
    const { error } = await updateTicketField(supabase, ticket.id, 'status', ticket.status, newStatus)
    if (error) {
      toast.error('Move failed', error)
      onUpdated(ticket.id, { status: ticket.status })
    } else {
      toast.success('Moved', `${ticket.ticket_key} → ${TICKET_STATUSES.find(s => s.id === newStatus)?.label}`)
    }
    setMovingId(null)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'start' }}>
      {TICKET_STATUSES.map(col => {
        const colTickets = tickets.filter(t => t.status === col.id)
        return (
          <div key={col.id} style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: 10, minHeight: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '.05em' }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', background: 'var(--surface-1)', borderRadius: 10, padding: '1px 8px' }}>{colTickets.length}</span>
            </div>
            {colTickets.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--tx-3)', textAlign: 'center', padding: '16px 4px', fontStyle: 'italic' }}>No tickets</p>
            ) : colTickets.map(t => (
              <div key={t.id} style={{ opacity: movingId === t.id ? 0.5 : 1, transition: 'opacity .15s' }}>
                <TicketCard ticket={t} onOpen={() => onOpen(t)} onMove={s => handleMove(t, s)} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
