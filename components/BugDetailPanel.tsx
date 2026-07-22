'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ParsedBug } from '@/lib/bugUtils'
import {
  getField, parseLabels, parseFeatureFlags, buildCloudWatchUrl,
  rollbarUrl, rollbarReplayUrl, jiraUrl, formatTimestamp, relativeTime, ROUTING_COLORS,
  getReporterIdentity, getUserAgentString, parseUserAgent, deriveOS,
} from '@/lib/utils'
import { useJiraStatuses } from '@/hooks/useJiraStatuses'
import { createClient } from '@/lib/supabase/client'
import type { GeminiQueueItem, TriageFeedback, InternalTicket } from '@/components/DashboardClient'
import TicketCreateModal from './TicketCreateModal'
import toast from '@/lib/toast'
import {
  X, ExternalLink, Copy, Check, AlertTriangle, Cloud,
  Play, Link2, RefreshCw, CheckCircle2, GitMerge, ChevronDown, BarChart2, Ticket as TicketIcon,
} from 'lucide-react'

interface Props {
  bug: ParsedBug
  onClose: () => void
  onBugUpdated?: (reportId: string, changes: Partial<ParsedBug>) => void
  onOpenTicket?: (ticket: InternalTicket) => void
}

const SEV_COL: Record<string, string> = { P1:'var(--p1)', P2:'var(--p2)', P3:'var(--p3)', P4:'var(--p4)' }

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
        {title}
        {sub && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', marginLeft: 6, color: 'var(--tx-3)' }}>{sub}</span>}
      </p>
      {children}
    </div>
  )
}

/** A field grid row that renders nothing when the value is null/empty — used for the
 * "only render fields that actually have data" prominent + collapsible sections. */
function FieldRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--tx-2)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function Collapsible({ title, fields }: { title: string; fields: [string, string | number | null | undefined][] }) {
  const [open, setOpen] = useState(false)
  const populated = fields.filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (populated.length === 0) return null
  return (
    <div style={{ marginBottom: 20, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface-2)', border: 'none', padding: '8px 12px', cursor: 'pointer',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-2)', letterSpacing: '.05em', textTransform: 'uppercase' }}>{title}</span>
        <ChevronDown size={13} color="var(--tx-3)" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} aria-hidden />
      </button>
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {populated.map(([label, value]) => <FieldRow key={label} label={label} value={value} />)}
        </div>
      )}
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  return (
    <button onClick={copy} aria-label={copied ? 'Copied!' : label} title={copied ? 'Copied!' : 'Copy to clipboard'}
      style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--tx-3)', display: 'inline-flex', alignItems: 'center', transition: 'color .15s' }}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function QuickLinkBtn({ href, icon, label, disabled, warning }: {
  href?: string | null; icon: React.ReactNode; label: string
  disabled?: boolean; warning?: boolean
}) {
  const dim = disabled || !href
  return (
    <a
      href={dim ? undefined : href}
      target={dim ? undefined : '_blank'}
      rel="noopener noreferrer"
      aria-label={label}
      title={warning ? 'Ticket creation failed' : label}
      style={{
        display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px',
        borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500,
        textDecoration: 'none', userSelect: 'none',
        background: dim ? 'transparent' : (warning ? 'rgba(227,179,65,.08)' : 'var(--surface-2)'),
        color: dim ? 'var(--tx-3)' : (warning ? 'var(--warning)' : 'var(--tx-1)'),
        border: `1px solid ${dim ? 'var(--border)' : (warning ? 'rgba(227,179,65,.28)' : 'var(--border-hi)')}`,
        opacity: dim && !warning ? 0.4 : 1,
        cursor: dim ? 'not-allowed' : 'pointer',
        transition: 'all .15s',
      }}
    >
      {icon}
      <span>{label}</span>
      {!dim && <ExternalLink size={10} style={{ opacity: 0.6 }} aria-hidden />}
    </a>
  )
}

export default function BugDetailPanel({ bug, onClose, onBugUpdated, onOpenTicket }: Props) {
  const [acting, setActing] = useState<'requeue' | 'resolve' | 'duplicate' | null>(null)
  const [linkedTicket, setLinkedTicket] = useState<InternalTicket | null | undefined>(undefined)
  const [showTicketModal, setShowTicketModal] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Backfill missing reporter/environment/exception_class/server_name from a live Rollbar
  // lookup (rollbar_id required) and persist it, so it's retained instead of re-fetched.
  useEffect(() => {
    if (!bug.rollbar_id) return
    const needsEnrichment = !bug.reporter_email || !bug.environment || !bug.exception_class || !bug.server_name
    if (!needsEnrichment) return

    let cancelled = false
    fetch(`/api/enrich-bug?report_id=${encodeURIComponent(bug.report_id)}`, { method: 'PATCH' })
      .then(res => res.json())
      .then(data => {
        if (cancelled || !data?.enriched) return
        onBugUpdated?.(bug.report_id, data.updates)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug.report_id, bug.rollbar_id])

  const sevCol = SEV_COL[bug.severity || ''] || 'var(--tx-2)'
  const routeStyle = bug.routingToken ? ROUTING_COLORS[bug.routingToken] : null

  const labels = parseLabels(bug)
  const featureFlags = parseFeatureFlags(bug)
  const cwUrl = buildCloudWatchUrl(bug)
  const rbUrl = rollbarUrl(bug)
  const jiraLink = jiraUrl(bug.jira_key)
  const replayUrl = rollbarReplayUrl(bug)
  const posthogSessionUrl = getField(bug, 'posthog_session_url') as string | null

  const fullParsed = (() => {
    try { return typeof bug.full_data === 'string' ? JSON.parse(bug.full_data) : bug.full_data }
    catch { return null }
  })()
  const rollbarPreload = fullParsed?.body?.rollbar_preload ?? null
  const telemetry = rollbarPreload?.telemetry as Array<{timestamp?: string; type?: string; level?: string; body?: {subtype?: string; from?: string; to?: string; url?: string; method?: string; status?: number; message?: string; extra?: string}}> | null
  const rollbarFrames = rollbarPreload?.frames as Array<{filename?: string; lineno?: number; colno?: number; method?: string}> | null

  const confidence = getField(bug, 'confidence') as number | null

  const reporter = getReporterIdentity(bug)
  const ua = parseUserAgent(getUserAgentString(bug))
  const os = deriveOS(bug)
  const jiraKeysForStatus = useMemo(() => [bug.jira_key], [bug.jira_key])
  const { statuses: jiraStatuses } = useJiraStatuses(jiraKeysForStatus)
  const jiraStatus = bug.jira_key ? jiraStatuses[bug.jira_key] : undefined

  const supabase = createClient()

  // Internal ticket linked to this bug, if one has been created.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase.from('internal_tickets').select('*').eq('linked_report_id', bug.report_id).maybeSingle()
        if (!cancelled) setLinkedTicket((data as InternalTicket | null) || null)
      } catch {
        if (!cancelled) setLinkedTicket(null)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug.report_id])

  // AI pipeline status for this report — gemini_queue rows + any human triage_feedback corrections.
  const [queueRows, setQueueRows] = useState<GeminiQueueItem[]>([])
  const [feedbackRows, setFeedbackRows] = useState<TriageFeedback[]>([])
  const [pipelineLoading, setPipelineLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setPipelineLoading(true)
      try {
        const [queueRes, feedbackRes] = await Promise.all([
          supabase.from('gemini_queue').select('*').eq('report_id', bug.report_id).order('created_at', { ascending: false }),
          supabase.from('triage_feedback').select('*').or(`report_id.eq.${bug.report_id}${bug.jira_key ? `,jira_key.eq.${bug.jira_key}` : ''}`),
        ])
        if (cancelled) return
        setQueueRows((queueRes.data || []) as GeminiQueueItem[])
        setFeedbackRows((feedbackRes.data || []) as TriageFeedback[])
      } catch { /* ignore */ }
      finally { if (!cancelled) setPipelineLoading(false) }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug.report_id, bug.jira_key])

  const handleRequeue = useCallback(async () => {
    setActing('requeue')
    try {
      const { error } = await supabase
        .from('gemini_queue')
        .update({ status: 'queued' })
        .eq('report_id', bug.report_id)
        .in('status', ['failed', 'stale'])
      if (error) throw error
      toast.success('Re-queued', `${bug.report_id} queued for AI triage`)
    } catch (err) {
      toast.error('Re-queue failed', err instanceof Error ? err.message : 'Unknown')
    } finally { setActing(null) }
  }, [bug.report_id, supabase])

  const handleMarkResolved = useCallback(async () => {
    setActing('resolve')
    try {
      const { error } = await supabase
        .from('bug_reports')
        .update({ status: 'resolved' })
        .eq('report_id', bug.report_id)
      if (error) throw error
      toast.success('Marked resolved', bug.report_id)
      onBugUpdated?.(bug.report_id, { status: 'resolved' })
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Unknown')
    } finally { setActing(null) }
  }, [bug.report_id, supabase, onBugUpdated])

  const handleMarkDuplicate = useCallback(async () => {
    setActing('duplicate')
    try {
      const { error } = await supabase
        .from('bug_reports')
        .update({ is_duplicate: true })
        .eq('report_id', bug.report_id)
      if (error) throw error
      toast.success('Marked duplicate', bug.report_id)
      onBugUpdated?.(bug.report_id, { is_duplicate: true })
    } catch (err) {
      toast.error('Update failed', err instanceof Error ? err.message : 'Unknown')
    } finally { setActing(null) }
  }, [bug.report_id, supabase, onBugUpdated])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bug detail: ${bug.jira_key || bug.report_id}`}
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
    >
      <div
        className="anim-slidein"
        onClick={e => e.stopPropagation()}
        style={{ width: '46%', minWidth: 480, maxWidth: 720, height: '100vh', overflowY: 'auto', background: 'var(--surface-1)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}
      >
        {/* ─── Sticky header ─── */}
        <div style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 2, borderBottom: '1px solid var(--border)', padding: '12px 18px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-sm)', background: sevCol + '18', color: sevCol, border: `1px solid ${sevCol}30`, fontFamily: 'monospace' }}>
                {bug.severity || '??'}
              </span>
              {routeStyle && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: routeStyle.bg, color: routeStyle.color, border: `1px solid ${routeStyle.border}` }}>
                  {bug.routingToken}
                </span>
              )}
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)' }}>{bug.report_id}</span>
            </div>
            <button onClick={onClose} aria-label="Close detail panel" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 6, color: 'var(--tx-2)', display: 'flex', flexShrink: 0, transition: 'all .15s' }}>
              <X size={15} aria-hidden />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--tx-3)' }}>
            <span>{formatTimestamp(bug)}</span>
            {bug.environment && (
              <span style={{ color: bug.environment === 'production' ? 'var(--danger)' : 'var(--tx-3)', fontWeight: bug.environment === 'production' ? 600 : 400 }}>
                {bug.environment}
              </span>
            )}
            {bug.source && <span style={{ color: 'var(--tx-3)' }}>{bug.source.replace(/_/g, ' ')}</span>}
          </div>
        </div>

        {/* ─── Body ─── */}
        <div style={{ padding: '16px 18px', flex: 1 }}>

          {/* Quick links bar */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 20 }}>
            <QuickLinkBtn
              href={jiraLink}
              icon={<Link2 size={13} aria-hidden />}
              label={bug.jira_key ? `Jira ${bug.jira_key}` : 'No Jira ticket'}
              disabled={!bug.jira_key}
              warning={bug.jira_pending === true}
            />
            <QuickLinkBtn
              href={rbUrl}
              icon={<ExternalLink size={13} aria-hidden />}
              label={bug.rollbar_id ? `Rollbar #${bug.rollbar_id}` : 'No Rollbar'}
              disabled={!rbUrl}
            />
            <QuickLinkBtn
              href={cwUrl}
              icon={<Cloud size={13} aria-hidden />}
              label="CloudWatch"
              disabled={!cwUrl}
            />
            <QuickLinkBtn
              href={replayUrl}
              icon={<Play size={13} aria-hidden />}
              label="Watch Replay"
              disabled={!replayUrl}
            />
            <QuickLinkBtn
              href={posthogSessionUrl}
              icon={<BarChart2 size={13} aria-hidden />}
              label="PostHog Session"
              disabled={!posthogSessionUrl}
            />
          </div>

          {/* Reporter & Device */}
          <Section title="Reporter & Device">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
              <FieldRow label="User" value={reporter || '—'} />
              <FieldRow label="Jira Status" value={bug.jira_key ? (jiraStatus?.status ?? 'loading…') : '—'} />
              <FieldRow label="Device Model" value={ua.deviceModel || '—'} />
              <FieldRow label="OS" value={os} />
              <FieldRow label="Browser" value={ua.browser || '—'} />
            </div>
          </Section>

          {/* AI Triage */}
          <Section title="AI Triage" sub="gemini-2.0-flash-lite">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', marginBottom: 10 }}>
              {([
                ['Severity',    bug.severity || '—', bug.severity ? sevCol : 'var(--tx-2)'],
                ['Component',   bug.component || '—', 'var(--tx-2)'],
                ['Category',    bug.category?.replace(/_/g, ' ') || '—', 'var(--tx-2)'],
                ['Confidence',  confidence != null ? `${Math.round(Number(confidence) * 100)}%` : (confidence === 0 ? '0%' : '—'), confidence === 0 || confidence === null ? 'var(--warning)' : 'var(--tx-2)'],
              ] as [string, string, string][]).map(([lbl, val, col]) => (
                <div key={lbl} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, minWidth: 70, flexShrink: 0 }}>{lbl}</span>
                  <span style={{ fontSize: 11, color: col, wordBreak: 'break-word', textTransform: 'capitalize' }}>{val}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Summary</span>
              {bug.ai_summary ? (
                <p style={{ fontSize: 12, color: 'var(--tx-1)', lineHeight: 1.6, background: 'rgba(163,113,247,.06)', border: '1px solid rgba(163,113,247,.15)', borderRadius: 'var(--r-sm)', padding: '8px 10px' }}>
                  {bug.ai_summary}
                </p>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>
                  {confidence === 0 ? (
                    <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlertTriangle size={13} /> Triage incomplete — confidence 0%
                    </span>
                  ) : 'Manual review needed'}
                </p>
              )}
            </div>
            {labels.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {labels.map(l => (
                  <span key={l} style={{ fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 20, background: 'var(--surface-2)', color: l.includes('human-review') ? 'var(--warning)' : 'var(--tx-2)', border: '1px solid var(--border)' }}>
                    {l}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Ownership & Routing */}
          <Section title="Ownership & Routing">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px' }}>
              <FieldRow label="Assigned owner" value={bug.assigned_owner} />
              <FieldRow label="Ownership team" value={bug.ownership_team} />
              <FieldRow label="Ticket action" value={bug.ticket_action} />
              <FieldRow label="Occurrences" value={bug.occurrence_count} />
              <FieldRow label="API endpoint" value={bug.api_endpoint} />
              <FieldRow label="Error source" value={bug.error_source} />
              <FieldRow label="Exception class" value={bug.exception_class} />
              <FieldRow label="Backend service" value={bug.backend_service} />
              <FieldRow label="Frontend route" value={bug.frontend_route} />
              <FieldRow label="Page URL" value={bug.page_url} />
            </div>
          </Section>

          {/* AI Pipeline Status */}
          <Section title="AI Pipeline Status" sub="gemini_queue · triage_feedback">
            {pipelineLoading ? (
              <div className="skeleton" style={{ height: 40, borderRadius: 6 }} />
            ) : queueRows.length === 0 && feedbackRows.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No queue history for this report</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queueRows.map(q => (
                  <div key={q.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, textTransform: 'uppercase',
                      color: q.status === 'processed' ? 'var(--success)' : q.status === 'failed' ? 'var(--danger)' : q.status === 'stale' ? 'var(--tx-3)' : 'var(--info)',
                      background: q.status === 'processed' ? 'rgba(63,185,80,.10)' : q.status === 'failed' ? 'rgba(255,123,114,.10)' : q.status === 'stale' ? 'var(--surface-3)' : 'rgba(88,166,255,.10)',
                    }}>{q.status}</span>
                    <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>queued {relativeTime(q.queued_at)}</span>
                    {q.processed_at && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>processed {relativeTime(q.processed_at)}</span>}
                    {q.retry_count > 0 && <span style={{ fontSize: 11, color: 'var(--warning)' }}>{q.retry_count} retries</span>}
                    {q.error_message && <span style={{ fontSize: 11, color: 'var(--danger)' }} title={q.error_message}>{q.error_message.slice(0, 60)}</span>}
                  </div>
                ))}
                {feedbackRows.map(f => (
                  <div key={f.id} style={{ padding: '6px 10px', background: 'rgba(163,113,247,.06)', border: '1px solid rgba(163,113,247,.15)', borderRadius: 'var(--r-sm)' }}>
                    <p style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600, marginBottom: 2 }}>Human correction</p>
                    <p style={{ fontSize: 11, color: 'var(--tx-2)' }}>
                      {f.original_tier && f.correct_tier && f.original_tier !== f.correct_tier && `${f.original_tier} → ${f.correct_tier}`}
                      {f.correction_reason && ` — ${f.correction_reason}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Description */}
          <Section title="What Was Reported">
            <p style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.6, wordBreak: 'break-word', fontFamily: bug.description?.includes('Exception') || bug.description?.includes('Error') ? 'monospace' : undefined }}>
              {bug.description || <span style={{ color: 'var(--tx-3)', fontStyle: 'italic' }}>No description</span>}
            </p>
          </Section>

          {/* Rollbar exception */}
          {(bug.rollbar_id || rollbarPreload) && (
            <Section title={`Exception${bug.rollbar_id ? ` — Rollbar #${bug.rollbar_id}` : ''}`}>
              {rollbarPreload ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rollbarPreload.title && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 3 }}>Error</span>
                      <code style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.4 }}>{rollbarPreload.title}</code>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {rollbarPreload.level && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Level: <strong style={{ color: 'var(--tx-1)' }}>{rollbarPreload.level}</strong></span>}
                    {rollbarPreload.occurrences != null && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Count: <strong style={{ color: 'var(--tx-1)' }}>{rollbarPreload.occurrences} occurrence(s)</strong></span>}
                  </div>
                  {rollbarFrames && rollbarFrames.length > 0 && (
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', marginBottom: 6 }}>Stack Trace (app frames only)</p>
                      <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                        {rollbarFrames.slice(0, 8).map((f, i) => (
                          <div key={i} style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-2)' }}>
                            <span style={{ color: 'var(--tx-3)', marginRight: 8 }}>{f.filename?.split('/').pop() || '?'}{f.lineno ? `:${f.lineno}` : ''}</span>
                            {f.method && <span style={{ color: 'var(--info)' }}> — {f.method}</span>}
                          </div>
                        ))}
                        {rollbarFrames.length > 8 && (
                          <div style={{ padding: '5px 10px', fontSize: 11, color: 'var(--tx-3)', fontStyle: 'italic' }}>
                            +{rollbarFrames.length - 8} more frames
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {rbUrl && (
                    <a href={rbUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--info)', textDecoration: 'none' }}>
                      View full item on Rollbar <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--tx-3)' }}>Rollbar preload not available in full_data</p>
              )}
            </Section>
          )}

          {/* Telemetry timeline */}
          {telemetry && telemetry.length > 0 && (
            <Section title="User Actions Before Crash">
              <div style={{ background: '#0d1117', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', padding: '10px 12px', maxHeight: 220, overflowY: 'auto' }}>
                {telemetry.slice(0, 20).map((t, i) => {
                  const ts = t.timestamp ? new Date(t.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
                  const isErr = t.level === 'error' || t.level === 'critical'
                  const isNav = t.type === 'navigation'
                  const evtLabel = t.body?.subtype || t.body?.url || t.body?.message || t.body?.extra || t.type || '?'
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: isErr ? '#f85149' : isNav ? '#58a6ff' : '#8b949e' }}>
                      <span style={{ minWidth: 56, flexShrink: 0 }}>{ts}</span>
                      <span style={{ minWidth: 40, flexShrink: 0, fontWeight: isErr ? 700 : 400 }}>{t.type}</span>
                      <span style={{ flex: 1, wordBreak: 'break-all' }}>{String(evtLabel).slice(0, 120)}</span>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Feature flags */}
          {Object.keys(featureFlags).length > 0 && (
            <Section title="Active Feature Flags at Time of Bug">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {Object.entries(featureFlags).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)', flex: 1 }}>{key}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: val === true ? 'var(--success)' : val === false ? 'var(--tx-3)' : 'var(--info)' }}>
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Debug links */}
          {(bug.correlation_id || bug.location || cwUrl) && (
            <Section title="Debug Links">
              {bug.correlation_id && (
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Correlation ID</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-2)', background: 'var(--surface-2)', padding: '3px 7px', borderRadius: 'var(--r-sm)', flex: 1, wordBreak: 'break-all' }}>{bug.correlation_id}</code>
                    <CopyBtn text={bug.correlation_id} label="Copy correlation ID" />
                  </div>
                </div>
              )}
              {bug.location && (
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Location</span>
                  <code className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)', background: 'var(--surface-2)', padding: '3px 7px', borderRadius: 'var(--r-sm)', display: 'block', wordBreak: 'break-all' }}>{bug.location}</code>
                </div>
              )}
              {cwUrl && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 4 }}>CloudWatch</span>
                  <a href={cwUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--info)', textDecoration: 'none' }}>
                    Open in CloudWatch (±15 min window) <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </Section>
          )}

          {/* Collapsed-by-default diagnostic detail */}
          <Collapsible title="Triage Reasoning & Scores" fields={[
            ['Triage reasoning', bug.triage_reasoning],
            ['Ticketability score', bug.ticketability_score],
            ['Evidence score', bug.evidence_score],
            ['Impact score', bug.impact_score],
            ['Ticketability confidence', bug.ticketability_confidence_score],
            ['Ticketability reason', bug.ticketability_reason],
            ['Review reason', bug.review_reason],
            ['Ownership reason', bug.ownership_reason],
            ['Suppression reason', bug.suppression_reason],
          ]} />

          <Collapsible title="Request / Technical Shape" fields={[
            ['Request body shape', bug.request_body_shape],
            ['Request headers shape', bug.request_headers_shape],
            ['Query params shape', bug.query_params_shape],
            ['CloudWatch log stream', bug.cw_log_stream],
            ['CloudWatch source group', bug.cw_source_group],
            ['Rollbar replay API path', bug.rollbar_replay_api_path],
            ['n8n execution ID', bug.n8n_execution_id],
          ]} />

          {/* Timestamps */}
          <Section title="Timestamps">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                ['Reported at', formatTimestamp(bug)],
                ['Relative', relativeTime(bug.timestamp_utc || bug.created_at)],
                ...(bug.triaged_at ? [['Triaged at', new Date(bug.triaged_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })] as [string, string]] : []),
                ...(bug.retry_count != null ? [['Retry count', String(bug.retry_count)] as [string, string]] : []),
              ] as [string, string][]).map(([lbl, val]) => (
                <div key={lbl}>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, display: 'block', marginBottom: 2 }}>{lbl}</span>
                  <span style={{ fontSize: 12, color: 'var(--tx-1)' }}>{val}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Manual actions */}
          <Section title="Actions">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(bug.status === 'triaging' || bug.status === 'pending') && (
                <button
                  onClick={handleRequeue}
                  disabled={acting !== null}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--surface-2)', color: 'var(--tx-1)', border: '1px solid var(--border)', cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.5 : 1, transition: 'opacity .15s' }}
                >
                  <RefreshCw size={12} aria-hidden />
                  Re-queue for AI triage
                </button>
              )}
              {bug.status !== 'resolved' && bug.status !== 'complete' && (
                <button
                  onClick={handleMarkResolved}
                  disabled={acting !== null}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'rgba(63,185,80,.08)', color: 'var(--success)', border: '1px solid rgba(63,185,80,.25)', cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.5 : 1 }}
                >
                  <CheckCircle2 size={12} aria-hidden />
                  Mark as Resolved
                </button>
              )}
              {!bug.is_duplicate && (
                <button
                  onClick={handleMarkDuplicate}
                  disabled={acting !== null}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--surface-2)', color: 'var(--purple)', border: '1px solid rgba(163,113,247,.25)', cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.5 : 1 }}
                >
                  <GitMerge size={12} aria-hidden />
                  Mark as Duplicate
                </button>
              )}
              {bug.is_duplicate && (
                <p style={{ fontSize: 11, color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <GitMerge size={12} /> Marked as duplicate
                </p>
              )}
              {linkedTicket === undefined ? null : linkedTicket ? (
                <button
                  onClick={() => onOpenTicket?.(linkedTicket)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--orange-dim)', color: 'var(--orange)', border: '1px solid rgba(249,115,22,.25)', cursor: 'pointer' }}
                >
                  <TicketIcon size={12} aria-hidden />
                  View Ticket {linkedTicket.ticket_key}
                </button>
              ) : (
                <button
                  onClick={() => setShowTicketModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--surface-2)', color: 'var(--tx-1)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  <TicketIcon size={12} aria-hidden />
                  Create Internal Ticket
                </button>
              )}
            </div>
          </Section>

        </div>
      </div>

      {showTicketModal && (
        <TicketCreateModal
          onClose={() => setShowTicketModal(false)}
          onCreated={(t) => setLinkedTicket(t)}
          prefill={{
            title: bug.jira_key ? `[${bug.jira_key}] ${(bug.description || '').slice(0, 80)}` : (bug.description || '').slice(0, 80),
            description: bug.ai_summary || bug.description || undefined,
            priority: bug.severity || undefined,
            linkedReportId: bug.report_id,
            linkedLabel: bug.jira_key || bug.report_id,
          }}
        />
      )}
    </div>
  )
}
