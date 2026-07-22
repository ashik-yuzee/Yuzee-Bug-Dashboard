import type { SupabaseClient } from '@supabase/supabase-js'
import type { TicketStatus, TicketType } from '@/components/DashboardClient'

/** The same 5-person roster already used in DeveloperView.tsx, reused here so
 * ticket assignees line up with the routing-based bug ownership elsewhere. */
export const TICKET_ASSIGNEES = ['Junaid', 'Shaqeeba', 'Ramzan', 'Asif', 'Ashik'] as const

export const TICKET_STATUSES: { id: TicketStatus; label: string; color: string }[] = [
  { id: 'todo',        label: 'To Do',       color: 'var(--tx-3)' },
  { id: 'in_progress', label: 'In Progress', color: 'var(--info)' },
  { id: 'in_review',   label: 'In Review',   color: 'var(--purple)' },
  { id: 'done',        label: 'Done',        color: 'var(--success)' },
]

export const TICKET_TYPES: { id: TicketType; label: string; icon: string; color: string }[] = [
  { id: 'task',        label: 'Task',        icon: '✓', color: 'var(--info)' },
  { id: 'bug',         label: 'Bug',         icon: '🐞', color: 'var(--danger)' },
  { id: 'story',       label: 'Story',       icon: '📗', color: 'var(--success)' },
  { id: 'improvement', label: 'Improvement', icon: '⬆', color: 'var(--purple)' },
]

export const TICKET_PRIORITY_COLOR: Record<string, string> = {
  P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)',
}

export function ticketStatusMeta(status: string) {
  return TICKET_STATUSES.find(s => s.id === status) || TICKET_STATUSES[0]
}

export function ticketTypeMeta(type: string) {
  return TICKET_TYPES.find(t => t.id === type) || TICKET_TYPES[0]
}

export function formatTicketTs(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Writes a single ticket field and logs it to internal_ticket_activity in one
 * place — used by both the board's "Move to" menu and the detail panel's
 * dropdowns so the activity log can never drift out of sync with an edit path.
 */
export async function updateTicketField(
  supabase: SupabaseClient,
  ticketId: string,
  field: 'status' | 'priority' | 'assignee' | 'type',
  oldValue: string | null,
  newValue: string,
): Promise<{ error: string | null }> {
  if (oldValue === newValue) return { error: null }
  const { error } = await supabase.from('internal_tickets').update({ [field]: newValue }).eq('id', ticketId)
  if (error) return { error: error.message }
  await supabase.from('internal_ticket_activity').insert({ ticket_id: ticketId, field, old_value: oldValue, new_value: newValue })
  return { error: null }
}
