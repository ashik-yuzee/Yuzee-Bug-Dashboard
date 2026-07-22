'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InternalTicket } from '@/components/DashboardClient'
import type { ParsedBug } from '@/lib/bugUtils'
import { TICKET_ASSIGNEES, TICKET_TYPES } from '@/lib/tickets'
import toast from '@/lib/toast'
import { X, Loader2, Link2 } from 'lucide-react'

interface Props {
  onClose: () => void
  onCreated: (ticket: InternalTicket) => void
  /** Pre-fill fields (used by BugDetailPanel's "Create Internal Ticket" action). */
  prefill?: { title?: string; description?: string; priority?: string; linkedReportId?: string; linkedLabel?: string }
  /** Only needed when the user should be able to search & link an existing bug from the modal itself. */
  bugs?: ParsedBug[]
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', color: 'var(--tx-1)',
  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
  padding: '8px 11px', fontSize: 13, fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase',
  letterSpacing: '.06em', marginBottom: 6, display: 'block',
}

export default function TicketCreateModal({ onClose, onCreated, prefill, bugs }: Props) {
  const [title, setTitle] = useState(prefill?.title || '')
  const [description, setDescription] = useState(prefill?.description || '')
  const [type, setType] = useState('task')
  const [priority, setPriority] = useState(prefill?.priority || '')
  const [assignee, setAssignee] = useState('')
  const [linkedReportId, setLinkedReportId] = useState(prefill?.linkedReportId || '')
  const [linkedLabel, setLinkedLabel] = useState(prefill?.linkedLabel || '')
  const [linkSearch, setLinkSearch] = useState('')
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkResults = useMemo(() => {
    if (!bugs || !linkSearch.trim()) return []
    const q = linkSearch.toLowerCase()
    return bugs.filter(b =>
      b.report_id.toLowerCase().includes(q) ||
      b.description?.toLowerCase().includes(q) ||
      b.jira_key?.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [bugs, linkSearch])

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: err } = await supabase
        .from('internal_tickets')
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          type,
          priority: priority || null,
          assignee: assignee || null,
          linked_report_id: linkedReportId || null,
        })
        .select('*')
        .single()
      if (err) throw err
      toast.success('Ticket created', (data as InternalTicket).ticket_key)
      onCreated(data as InternalTicket)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      toast.error('Could not create ticket', msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create internal ticket"
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div className="anim-fadein" style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)' }}>New Internal Ticket</p>
          <button onClick={onClose} aria-label="Close" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6, color: 'var(--tx-2)', display: 'flex' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="ticket-title">Title *</label>
            <input id="ticket-title" style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Refactor auth token refresh logic" autoFocus />
          </div>

          <div>
            <label style={labelStyle} htmlFor="ticket-desc">Description</label>
            <textarea id="ticket-desc" style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional detail…" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle} htmlFor="ticket-type">Type</label>
              <select id="ticket-type" style={inputStyle} value={type} onChange={e => setType(e.target.value)}>
                {TICKET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="ticket-priority">Priority</label>
              <select id="ticket-priority" style={inputStyle} value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="">None</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
                <option value="P4">P4</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="ticket-assignee">Assignee</label>
            <select id="ticket-assignee" style={inputStyle} value={assignee} onChange={e => setAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {TICKET_ASSIGNEES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {linkedReportId ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 11px' }}>
              <Link2 size={13} color="var(--tx-3)" />
              <span style={{ fontSize: 12, color: 'var(--tx-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Linked to {linkedLabel || linkedReportId}
              </span>
              <button onClick={() => { setLinkedReportId(''); setLinkedLabel('') }} style={{ fontSize: 11, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
            </div>
          ) : bugs && bugs.length > 0 ? (
            <div>
              <label style={labelStyle}>Link to an existing bug (optional)</label>
              {!showLinkSearch ? (
                <button onClick={() => setShowLinkSearch(true)} style={{ fontSize: 12, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', padding: '7px 11px', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                  + Search bug reports…
                </button>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input
                    style={inputStyle}
                    value={linkSearch}
                    onChange={e => setLinkSearch(e.target.value)}
                    placeholder="Search by report ID, description, Jira key…"
                    autoFocus
                  />
                  {linkResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
                      {linkResults.map(b => (
                        <button
                          key={b.report_id}
                          onClick={() => {
                            setLinkedReportId(b.report_id)
                            setLinkedLabel(b.jira_key || b.report_id)
                            setShowLinkSearch(false)
                            setLinkSearch('')
                          }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 11px', fontSize: 12, color: 'var(--tx-2)', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        >
                          <span className="font-mono" style={{ color: 'var(--orange)' }}>{b.jira_key || b.report_id}</span>
                          {' — '}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{(b.description || '').slice(0, 60)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} disabled={saving} style={{ fontSize: 13, fontWeight: 500, color: 'var(--tx-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 16px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={saving || !title.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--orange)', border: 'none', borderRadius: 'var(--r-md)', padding: '8px 16px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || !title.trim() ? 0.6 : 1 }}>
              {saving && <Loader2 size={13} className="anim-spin" />}
              Create Ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
