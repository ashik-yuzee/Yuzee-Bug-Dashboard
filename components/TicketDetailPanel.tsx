'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InternalTicket, TicketComment, TicketActivity } from '@/components/DashboardClient'
import type { ParsedBug } from '@/lib/bugUtils'
import { TICKET_ASSIGNEES, TICKET_STATUSES, TICKET_TYPES, TICKET_PRIORITY_COLOR, formatTicketTs, updateTicketField } from '@/lib/tickets'
import toast from '@/lib/toast'
import { X, ArrowRight, Link2, Send, Loader2, Cloud, ExternalLink } from 'lucide-react'

interface Props {
  ticket: InternalTicket
  onClose: () => void
  onUpdated: (id: string, changes: Partial<InternalTicket>) => void
  onOpenBug?: (reportId: string) => void
  bugs?: ParsedBug[]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
        {title}
      </p>
      {children}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', color: 'var(--tx-1)',
  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
  padding: '7px 9px', fontSize: 12, fontFamily: 'inherit',
}
const fieldLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5, display: 'block' }

export default function TicketDetailPanel({ ticket, onClose, onUpdated, onOpenBug, bugs }: Props) {
  const supabase = createClient()
  const [comments, setComments] = useState<TicketComment[]>([])
  const [activity, setActivity] = useState<TicketActivity[]>([])
  const [loadingThread, setLoadingThread] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // Free-text edit buffers only need resetting when the panel switches to a genuinely
  // different ticket — done during render (React's "adjusting state when a prop
  // changes" pattern) rather than in an effect, both to satisfy react-hooks/set-state-in-effect
  // and so mid-edit text isn't wiped out by unrelated optimistic updates to this same ticket
  // (which create a new `ticket` object but keep the same id).
  const [openTicketId, setOpenTicketId] = useState(ticket.id)
  const [title, setTitle] = useState(ticket.title)
  const [description, setDescription] = useState(ticket.description || '')
  const [labelsInput, setLabelsInput] = useState((ticket.labels || []).join(', '))
  if (ticket.id !== openTicketId) {
    setOpenTicketId(ticket.id)
    setTitle(ticket.title)
    setDescription(ticket.description || '')
    setLabelsInput((ticket.labels || []).join(', '))
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingThread(true)
      try {
        const [commentsRes, activityRes] = await Promise.all([
          supabase.from('internal_ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
          supabase.from('internal_ticket_activity').select('*').eq('ticket_id', ticket.id).order('changed_at', { ascending: false }),
        ])
        if (cancelled) return
        setComments((commentsRes.data || []) as TicketComment[])
        setActivity((activityRes.data || []) as TicketActivity[])
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingThread(false) }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id])

  const linkedBug = ticket.linked_report_id ? bugs?.find(b => b.report_id === ticket.linked_report_id) : undefined
  const isJira = ticket.source === 'jira'

  const updateField = useCallback(async (field: 'status' | 'priority' | 'assignee' | 'type', value: string) => {
    const oldValue = ticket[field] as string | null
    if (oldValue === value) return
    onUpdated(ticket.id, { [field]: value } as Partial<InternalTicket>)
    const { error } = await updateTicketField(supabase, ticket.id, field, oldValue, value)
    if (error) {
      toast.error('Update failed', error)
      onUpdated(ticket.id, { [field]: oldValue } as Partial<InternalTicket>)
      return
    }
    setActivity(prev => [{ id: `local-${Date.now()}`, ticket_id: ticket.id, field, old_value: oldValue, new_value: value, changed_by: 'admin', changed_at: new Date().toISOString() }, ...prev])
    toast.success('Updated', `${field} → ${value}`)
  }, [ticket, supabase, onUpdated])

  const saveTitleDescription = useCallback(async () => {
    const trimmedTitle = title.trim()
    const trimmedDesc = description.trim() || null
    const labels = labelsInput.split(',').map(l => l.trim()).filter(Boolean)
    if (trimmedTitle === ticket.title && trimmedDesc === ticket.description && JSON.stringify(labels) === JSON.stringify(ticket.labels || [])) return
    try {
      const { error } = await supabase.from('internal_tickets').update({ title: trimmedTitle || ticket.title, description: trimmedDesc, labels }).eq('id', ticket.id)
      if (error) throw error
      onUpdated(ticket.id, { title: trimmedTitle || ticket.title, description: trimmedDesc, labels })
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Unknown')
    }
  }, [title, description, labelsInput, ticket, supabase, onUpdated])

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return
    setPostingComment(true)
    try {
      const { data, error } = await supabase.from('internal_ticket_comments')
        .insert({ ticket_id: ticket.id, comment_text: newComment.trim() })
        .select('*').single()
      if (error) throw error
      setComments(prev => [...prev, data as TicketComment])
      setNewComment('')
    } catch (err) {
      toast.error('Comment failed', err instanceof Error ? err.message : 'Unknown')
    } finally {
      setPostingComment(false)
    }
  }, [newComment, ticket.id, supabase])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ticket detail: ${ticket.ticket_key}`}
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
    >
      <div
        className="anim-slidein"
        onClick={e => e.stopPropagation()}
        style={{ width: '46%', minWidth: 480, maxWidth: 720, height: '100vh', overflowY: 'auto', background: 'var(--surface-1)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 2, borderBottom: '1px solid var(--border)', padding: '12px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
              <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>{ticket.ticket_key}</span>
              <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{TICKET_TYPES.find(t => t.id === ticket.type)?.icon} {TICKET_TYPES.find(t => t.id === ticket.type)?.label}</span>
              {isJira && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--info)', background: 'rgba(88,166,255,.10)', border: '1px solid rgba(88,166,255,.22)', borderRadius: 20, padding: '2px 8px' }}>
                  <Cloud size={9} /> Synced from Jira
                </span>
              )}
            </div>
            <button onClick={onClose} aria-label="Close ticket detail panel" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6, color: 'var(--tx-2)', display: 'flex', flexShrink: 0 }}>
              <X size={15} />
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 4 }}>Created {formatTicketTs(ticket.created_at)} · Reporter {ticket.reporter}</p>
          {isJira && ticket.jira_url && (
            <a href={ticket.jira_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--info)', marginTop: 8 }}>
              Open in Jira <ExternalLink size={11} />
            </a>
          )}
        </div>

        <div style={{ padding: '16px 18px', flex: 1 }}>

          {linkedBug && (
            <button
              onClick={() => onOpenBug?.(linkedBug.report_id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px', marginBottom: 18, cursor: 'pointer' }}
            >
              <Link2 size={13} color="var(--tx-3)" />
              <span style={{ fontSize: 12, color: 'var(--tx-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Linked bug: <strong style={{ color: 'var(--orange)' }}>{linkedBug.jira_key || linkedBug.report_id}</strong> — {(linkedBug.description || '').slice(0, 60)}
              </span>
              <ArrowRight size={13} color="var(--tx-3)" />
            </button>
          )}

          <Section title="Title & Description">
            {isJira && (
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 8, fontStyle: 'italic' }}>
                Mirrored from Jira — edit in Jira and it&apos;ll update here on the next sync.
              </p>
            )}
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={saveTitleDescription}
              readOnly={isJira}
              style={{ width: '100%', background: 'var(--surface-2)', color: 'var(--tx-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 11px', fontSize: 14, fontWeight: 600, marginBottom: 8, opacity: isJira ? 0.75 : 1, cursor: isJira ? 'default' : 'text' }}
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={saveTitleDescription}
              readOnly={isJira}
              placeholder="No description"
              style={{ width: '100%', minHeight: 80, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 11px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', opacity: isJira ? 0.75 : 1, cursor: isJira ? 'default' : 'text' }}
            />
          </Section>

          <Section title="Workflow">
            {isJira && (
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 8, fontStyle: 'italic' }}>
                Status, priority, assignee, and type are managed in Jira (current Jira status: <strong>{ticket.jira_status || '—'}</strong>).
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={fieldLabelStyle}>Status</label>
                <select style={selectStyle} value={ticket.status} onChange={e => updateField('status', e.target.value)} disabled={isJira}>
                  {TICKET_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabelStyle}>Priority</label>
                <select style={{ ...selectStyle, color: ticket.priority ? TICKET_PRIORITY_COLOR[ticket.priority] : selectStyle.color, fontWeight: ticket.priority ? 700 : 400 }} value={ticket.priority || ''} onChange={e => updateField('priority', e.target.value)} disabled={isJira}>
                  <option value="">None</option>
                  <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option>
                </select>
              </div>
              <div>
                <label style={fieldLabelStyle}>Assignee</label>
                <select style={selectStyle} value={ticket.assignee || ''} onChange={e => updateField('assignee', e.target.value)} disabled={isJira}>
                  <option value="">Unassigned</option>
                  {TICKET_ASSIGNEES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabelStyle}>Type</label>
                <select style={selectStyle} value={ticket.type} onChange={e => updateField('type', e.target.value)} disabled={isJira}>
                  {TICKET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <label style={fieldLabelStyle}>Labels (comma-separated)</label>
            <input
              value={labelsInput}
              onChange={e => setLabelsInput(e.target.value)}
              onBlur={saveTitleDescription}
              readOnly={isJira}
              placeholder="e.g. auth, tech-debt"
              style={{ ...selectStyle, opacity: isJira ? 0.75 : 1 }}
            />
          </Section>

          <Section title="Comments">
            {loadingThread ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)' }}>Loading…</p>
            ) : comments.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No comments yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                {comments.map(c => (
                  <div key={c.id} style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '8px 11px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)' }}>{c.author}</span>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{formatTicketTs(c.created_at)}</span>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--tx-2)', whiteSpace: 'pre-wrap' }}>{c.comment_text}</p>
                  </div>
                ))}
              </div>
            )}
            {isJira ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>
                This ticket&apos;s conversation lives in Jira — {ticket.jira_url ? <a href={ticket.jira_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info)' }}>comment there</a> : 'comment there'} instead.
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddComment() }}
                  placeholder="Add a comment…"
                  style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--tx-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px 11px', fontSize: 12.5 }}
                />
                <button onClick={handleAddComment} disabled={postingComment || !newComment.trim()} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--orange-dim)', color: 'var(--orange)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-md)', padding: '0 12px', cursor: 'pointer', opacity: postingComment || !newComment.trim() ? 0.5 : 1 }}>
                  {postingComment ? <Loader2 size={13} className="anim-spin" /> : <Send size={13} />}
                </button>
              </div>
            )}
          </Section>

          <Section title="Activity">
            {activity.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No changes recorded yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activity.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span style={{ color: 'var(--tx-3)', width: 90, flexShrink: 0 }}>{formatTicketTs(a.changed_at)}</span>
                    <span style={{ color: 'var(--tx-2)' }}>
                      <strong>{a.changed_by}</strong> changed <strong>{a.field}</strong>: {a.old_value || '—'} <ArrowRight size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> {a.new_value || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

        </div>
      </div>
    </div>
  )
}
