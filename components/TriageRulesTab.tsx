'use client'

import { useState, useMemo } from 'react'
import { useBugRules } from '@/hooks/useBugRules'
import { useTriageFeedback } from '@/hooks/useTriageFeedback'
import { useJiraCommentActions } from '@/hooks/useJiraCommentActions'
import { jiraUrl } from '@/lib/utils'
import { SkeletonCard } from '@/components/ui/Skeleton'
import PageInfo from './ui/PageInfo'
import { RefreshCw, ShieldOff, ArrowRight, Check, Minus, ExternalLink } from 'lucide-react'
import type { TriageSubTab } from './DashboardClient'

const SEV_COL: Record<string, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)' }

const INTENT_STYLE: Record<string, { bg: string; color: string }> = {
  mark_duplicate:   { bg: 'rgba(139,92,246,.12)', color: 'var(--purple)' },
  reclassify_tier:  { bg: 'rgba(88,166,255,.12)', color: 'var(--info)' },
  change_severity:  { bg: 'rgba(227,179,65,.12)', color: 'var(--warning)' },
  close_ticket:     { bg: 'rgba(248,81,73,.12)', color: 'var(--danger)' },
  no_action:        { bg: 'rgba(125,133,144,.12)', color: 'var(--tx-3)' },
  skipped:          { bg: 'rgba(125,133,144,.12)', color: 'var(--tx-3)' },
}

function fmtTs(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Pill({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg || color + '18', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function TableShell({ headers, children, empty, colCount }: { headers: string[]; children: React.ReactNode; empty: boolean; colCount: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            {headers.map(h => (
              <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr><td colSpan={colCount} style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: 'var(--tx-3)' }}>No rows to show</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  )
}

/* ─── Bug Rules ─────────────────────────────────────────── */
function BugRulesView() {
  const { rules, loading, error, refresh } = useBugRules()
  const headers = ['Name', 'Match Field', 'Match Pattern', 'Force Tier', 'Force Category', 'Force Severity', 'Force Owner', 'Suppress', 'Priority', 'Enabled', 'Created By', 'Created At']

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Bug Rules</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Auto-triage overrides applied before Gemini AI triage · sorted by priority</p>
        </div>
        <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {loading ? <div style={{ padding: 16 }}><SkeletonCard h={200} /></div> : error ? (
        <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{error}</p>
      ) : (
        <TableShell headers={headers} empty={rules.length === 0} colCount={headers.length}>
          {rules.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', opacity: r.enabled === false ? 0.45 : 1 }}>
              <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--tx-1)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.match_field}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-2)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.match_pattern}>{r.match_pattern}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.force_tier || '—'}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.force_category || '—'}</td>
              <td style={{ padding: '9px 12px' }}>{r.force_severity ? <Pill label={r.force_severity} color={SEV_COL[r.force_severity] || 'var(--tx-2)'} /> : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.force_owner || '—'}</td>
              <td style={{ padding: '9px 12px' }}>{r.suppress_ticket ? <Pill label="Suppress" color="var(--warning)" /> : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}</td>
              <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--tx-2)', fontWeight: 600 }}>{r.priority ?? '—'}</td>
              <td style={{ padding: '9px 12px' }}>{r.enabled === false ? <Pill label="Disabled" color="var(--tx-3)" /> : <Pill label="Enabled" color="var(--success)" />}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)' }}>{r.created_by || '—'}</td>
              <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(r.created_at)}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  )
}

/* ─── Triage Feedback ───────────────────────────────────── */
function DiffCell({ from, to }: { from: string | null; to: string | null }) {
  if (!from && !to) return <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      <span style={{ color: 'var(--tx-3)' }}>{from || '—'}</span>
      <ArrowRight size={10} color="var(--tx-3)" />
      <span style={{ color: 'var(--tx-1)', fontWeight: 600 }}>{to || '—'}</span>
    </span>
  )
}

function TriageFeedbackView() {
  const { feedback, loading, error, refresh } = useTriageFeedback()
  const headers = ['Jira Key', 'Error Class', 'Endpoint Pattern', 'Tier', 'Category', 'Severity', 'Weight', 'Promoted', 'Source', 'Created At']

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Triage Feedback</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Human corrections from Jira comments · weight ≥ 3 auto-promotes to a Bug Rule</p>
        </div>
        <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {loading ? <div style={{ padding: 16 }}><SkeletonCard h={160} /></div> : error ? (
        <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{error}</p>
      ) : (
        <TableShell headers={headers} empty={feedback.length === 0} colCount={headers.length}>
          {feedback.map(f => {
            const jl = jiraUrl(f.jira_key)
            return (
              <tr key={f.id} style={{ borderBottom: '1px solid var(--border)', background: f.promoted ? 'rgba(63,185,80,.04)' : 'transparent' }}>
                <td style={{ padding: '9px 12px' }}>
                  {jl ? (
                    <a href={jl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {f.jira_key} <ExternalLink size={10} />
                    </a>
                  ) : <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>—</span>}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.error_class || ''}>{f.error_class || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.endpoint_pattern || ''}>{f.endpoint_pattern || '—'}</td>
                <td style={{ padding: '9px 12px' }}><DiffCell from={f.original_tier} to={f.correct_tier} /></td>
                <td style={{ padding: '9px 12px' }}><DiffCell from={f.original_category} to={f.correct_category} /></td>
                <td style={{ padding: '9px 12px' }}><DiffCell from={null} to={f.correct_severity} /></td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: (f.weight ?? 0) >= 3 ? 'var(--warning)' : 'var(--tx-2)' }}>{f.weight ?? 1}</td>
                <td style={{ padding: '9px 12px' }}>{f.promoted ? <Pill label="Promoted" color="var(--success)" /> : <Pill label="Pending" color="var(--tx-3)" />}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)' }}>{f.source || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(f.created_at)}</td>
              </tr>
            )
          })}
        </TableShell>
      )}
    </div>
  )
}

/* ─── Jira Comment Actions ──────────────────────────────── */
function JiraCommentsView() {
  const { actions, intentCounts, loading, error, refresh } = useJiraCommentActions()
  const [intentFilter, setIntentFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')

  const intents = useMemo(() => [...new Set(actions.map(a => a.intent || 'unknown'))].sort(), [actions])
  const actionTypes = useMemo(() => [...new Set(actions.map(a => a.action_taken || 'unknown'))].sort(), [actions])

  const filtered = useMemo(() => actions.filter(a =>
    (intentFilter === 'all' || a.intent === intentFilter) &&
    (actionFilter === 'all' || a.action_taken === actionFilter)
  ), [actions, intentFilter, actionFilter])

  const headers = ['Jira Key', 'Comment Author', 'Intent', 'Action Taken', 'Gemini Used', 'Processed At']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.keys(INTENT_STYLE).map(intent => {
          const count = intentCounts[intent] || 0
          const style = INTENT_STYLE[intent]
          return (
            <div key={intent} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 12px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: style.color }} />
              <span style={{ fontSize: 11, color: 'var(--tx-2)', textTransform: 'capitalize' }}>{intent.replace(/_/g, ' ')}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: style.color }}>{count}</span>
            </div>
          )
        })}
        <span style={{ fontSize: 10, color: 'var(--tx-3)', alignSelf: 'center', marginLeft: 4 }}>last 7 days</span>
      </div>

      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Jira Comment Actions</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Every comment the automation processed on auto-bug tickets</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={intentFilter} onChange={e => setIntentFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
              <option value="all">All intents</option>
              {intents.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
              <option value="all">All actions</option>
              {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
        </div>
        {loading ? <div style={{ padding: 16 }}><SkeletonCard h={220} /></div> : error ? (
          <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{error}</p>
        ) : (
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            <TableShell headers={headers} empty={filtered.length === 0} colCount={headers.length}>
              {filtered.map(a => {
                const jl = jiraUrl(a.jira_key)
                const style = INTENT_STYLE[a.intent || ''] || INTENT_STYLE.no_action
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 12px' }}>
                      {jl ? (
                        <a href={jl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          {a.jira_key} <ExternalLink size={10} />
                        </a>
                      ) : <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{a.comment_author || '—'}</td>
                    <td style={{ padding: '9px 12px' }}><Pill label={(a.intent || 'unknown').replace(/_/g, ' ')} color={style.color} bg={style.bg} /></td>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{(a.action_taken || '—').replace(/_/g, ' ')}</td>
                    <td style={{ padding: '9px 12px' }}>{a.gemini_used ? <Check size={13} color="var(--success)" /> : <Minus size={13} color="var(--tx-3)" />}</td>
                    <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(a.processed_at)}</td>
                  </tr>
                )
              })}
            </TableShell>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Main ──────────────────────────────────────────────── */
const SUB_TABS: { id: TriageSubTab; label: string }[] = [
  { id: 'rules', label: 'Bug Rules' },
  { id: 'feedback', label: 'Triage Feedback' },
  { id: 'jira', label: 'Jira Comments' },
]

export default function TriageRulesTab() {
  const [sub, setSub] = useState<TriageSubTab>('rules')

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageInfo storageKey="triage">
        The governance layer behind AI triage. <strong>Bug Rules</strong> are regex overrides applied before Gemini
        runs; <strong>Triage Feedback</strong> is human corrections from Jira comments (enough of them auto-promote
        into a rule); <strong>Jira Comments</strong> is the full log of what the automation has read and acted on.
      </PageInfo>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldOff size={15} color="var(--tx-3)" style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3 }}>
          {SUB_TABS.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)} style={{
              fontSize: 12, fontWeight: sub === t.id ? 600 : 400, padding: '5px 12px', borderRadius: 'var(--r-sm)',
              background: sub === t.id ? 'var(--orange-dim)' : 'transparent',
              color: sub === t.id ? 'var(--orange)' : 'var(--tx-3)',
              border: 'none', cursor: 'pointer', transition: 'all .15s',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {sub === 'rules' && <BugRulesView />}
      {sub === 'feedback' && <TriageFeedbackView />}
      {sub === 'jira' && <JiraCommentsView />}
    </div>
  )
}
