'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGeminiQueue } from '@/hooks/useGeminiQueue'
import type { GeminiQueueItem, PipelineSubTab } from './DashboardClient'
import CloudWatchMonitorTab from './CloudWatchMonitorTab'
import PageInfo from './ui/PageInfo'
import toast from '@/lib/toast'
import { AlertTriangle, RefreshCw, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react'

/* ─── Status badge ─────────────────────────────────────────── */
const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  queued:    { bg: 'rgba(88,166,255,.10)',  color: 'var(--info)',    border: 'rgba(88,166,255,.22)'  },
  processed: { bg: 'rgba(63,185,80,.10)',   color: 'var(--success)', border: 'rgba(63,185,80,.22)'  },
  stale:     { bg: 'rgba(125,133,144,.10)', color: 'var(--tx-3)',    border: 'rgba(125,133,144,.22)' },
  failed:    { bg: 'rgba(248,81,73,.10)',   color: 'var(--danger)',  border: 'rgba(248,81,73,.22)'   },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.stale
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase' }}>
      {status}
    </span>
  )
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)} min`
}

function fmtTs(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/* ─── Data quality fetch (pure — no component state) ────────── */
async function fetchDataQualityCounts(): Promise<Record<string, number>> {
  const supabase = createClient()
  const [
    missingCorrel,
    jiraPendingCount,
    aiSummaryNull,
    unknownComp,
    missingSev,
    missingJiraNotPending,
  ] = await Promise.all([
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).is('correlation_id', null).eq('source', 'rollbar_auto'),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('jira_pending', true),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).is('ai_summary', null),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('component', 'Unknown'),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).is('severity', null),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).is('jira_key', null).not('status', 'eq', 'pending').not('is_duplicate', 'eq', true).is('jira_pending', null),
  ])
  return {
    missingCorrel: missingCorrel.count ?? 0,
    jiraPending: jiraPendingCount.count ?? 0,
    aiSummaryNull: aiSummaryNull.count ?? 0,
    unknownComp: unknownComp.count ?? 0,
    missingSev: missingSev.count ?? 0,
    missingJiraNotPending: missingJiraNotPending.count ?? 0,
  }
}

/* ─── Data quality row ─────────────────────────────────────── */
interface QualityRow { issue: string; count: number | null; loading: boolean; action?: () => Promise<void>; actionLabel?: string; actionLoading?: boolean }

function QualityTable({ rows }: { rows: QualityRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          {(['Issue', 'Count', ''].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
          )))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--tx-1)' }}>{row.issue}</td>
            <td style={{ padding: '9px 10px' }}>
              {row.loading ? (
                <Loader2 size={13} className="anim-spin" color="var(--tx-3)" aria-hidden />
              ) : row.count === null ? (
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>—</span>
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700, color: row.count > 0 ? 'var(--warning)' : 'var(--success)' }}>{row.count}</span>
              )}
            </td>
            <td style={{ padding: '9px 10px' }}>
              {row.action && row.count !== null && row.count > 0 && (
                <button onClick={row.action} disabled={row.actionLoading} style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-sm)', padding: '3px 9px', cursor: row.actionLoading ? 'not-allowed' : 'pointer', opacity: row.actionLoading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {row.actionLoading ? <Loader2 size={10} className="anim-spin" /> : null}
                  {row.actionLabel || 'Retry all →'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ─── Main ─────────────────────────────────────────────────── */
const SUB_TABS: { id: PipelineSubTab; label: string }[] = [
  { id: 'queue', label: 'Queue Health' },
  { id: 'quality', label: 'Data Quality' },
  { id: 'cloudwatch', label: 'CloudWatch' },
]

export default function PipelineTab() {
  const [subTab, setSubTab] = useState<PipelineSubTab>('queue')
  const { stats, loading: queueLoading, error: queueError, refresh } = useGeminiQueue()
  const [requeueingId, setRequeuingId] = useState<string | null>(null)
  const [requeueingAll, setRequeuingAll] = useState(false)

  // Data quality state — lazy: only fetched when the "quality" sub-tab is actually open.
  // This avoids firing 6 parallel HEAD queries on every Pipeline page mount.
  const [dq, setDq] = useState<Record<string, number | null>>({})
  const [dqLoading, setDqLoading] = useState(false)
  const [dqRefreshToken, setDqRefreshToken] = useState(0)

  useEffect(() => {
    if (subTab !== 'quality') return
    let cancelled = false
    async function load() {
      setDqLoading(true)
      try {
        const counts = await fetchDataQualityCounts()
        if (!cancelled) setDq(counts)
      } catch { /* ignore */ }
      finally { if (!cancelled) setDqLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [subTab, dqRefreshToken])

  const refreshDataQuality = useCallback(() => setDqRefreshToken(t => t + 1), [])

  const requeueSingle = async (item: GeminiQueueItem) => {
    setRequeuingId(item.id)
    try {
      const res = await fetch(`/api/requeue-bug?id=${item.id}`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Re-queued', `${item.report_id} queued`)
      refresh()
    } catch (err) {
      toast.error('Re-queue failed', err instanceof Error ? err.message : 'Unknown')
    } finally { setRequeuingId(null) }
  }

  const requeueAll = async () => {
    setRequeuingAll(true)
    try {
      const res = await fetch('/api/requeue-bug?all=true', { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Re-queued', `${data.requeued} items re-queued`)
      refresh()
    } catch (err) {
      toast.error('Re-queue failed', err instanceof Error ? err.message : 'Unknown')
    } finally { setRequeuingAll(false) }
  }

  const [retryingJira, setRetryingJira] = useState(false)
  const retryJira = async () => {
    setRetryingJira(true)
    try {
      const res  = await fetch('/api/jira/retry', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast.success(
        'Jira retry complete',
        `${data.succeeded}/${data.retried} tickets created${data.failed ? ` · ${data.failed} failed` : ''}`,
      )
      refresh()
    } catch (err) {
      toast.error('Jira retry failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setRetryingJira(false)
    }
  }

  const qualityRows: QualityRow[] = [
    { issue: 'Missing correlation_id (Rollbar bugs only)', count: dq.missingCorrel ?? null, loading: dqLoading },
    { issue: 'Missing rollbar_id (user-submitted — expected)', count: null, loading: false },
    { issue: 'Missing jira_key AND NOT jira_pending (pipeline gap)', count: dq.missingJiraNotPending ?? null, loading: dqLoading },
    { issue: 'jira_pending = true (ticket creation failed)', count: dq.jiraPending ?? null, loading: dqLoading, action: retryJira, actionLabel: 'Retry all →', actionLoading: retryingJira },
    { issue: 'ai_summary null (Gemini triage incomplete)', count: dq.aiSummaryNull ?? null, loading: dqLoading },
    { issue: 'component = Unknown (Gemini couldn\'t classify)', count: dq.unknownComp ?? null, loading: dqLoading },
    { issue: 'Missing severity (triage not run)', count: dq.missingSev ?? null, loading: dqLoading },
  ]

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

      <PageInfo storageKey="pipeline">
        Health of the automation itself, not the bugs it produces. <strong>Queue Health</strong> tracks Gemini AI
        triage throughput, <strong>Data Quality</strong> flags gaps in the pipeline (missing severities, incomplete
        triage), and <strong>CloudWatch</strong> shows when each log group was last scanned.
      </PageInfo>

      {/* ─── Sub-nav ─── */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3, width: 'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            fontSize: 12, fontWeight: subTab === t.id ? 600 : 400, padding: '5px 12px', borderRadius: 'var(--r-sm)',
            background: subTab === t.id ? 'var(--orange-dim)' : 'transparent',
            color: subTab === t.id ? 'var(--orange)' : 'var(--tx-3)',
            border: 'none', cursor: 'pointer', transition: 'all .15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'cloudwatch' && <CloudWatchMonitorTab />}

      {subTab === 'queue' && <>
      {/* ─── Stuck warning ─── */}
      {stats.stuckItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.28)', borderRadius: 'var(--r-lg)' }}>
          <AlertTriangle size={15} color="var(--warning)" />
          <p style={{ fontSize: 13, color: 'var(--warning)', flex: 1 }}>
            <strong>{stats.stuckItems.length} bug{stats.stuckItems.length > 1 ? 's' : ''}</strong> have been queued for over 30 minutes — the n8n scheduler may be stuck.
          </p>
          <button onClick={requeueAll} disabled={requeueingAll}
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', background: 'rgba(227,179,65,.15)', border: '1px solid rgba(227,179,65,.35)', borderRadius: 'var(--r-md)', padding: '6px 12px', cursor: requeueingAll ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            {requeueingAll ? <Loader2 size={12} className="anim-spin" /> : <RefreshCw size={12} />}
            Re-queue all stuck
          </button>
        </div>
      )}

      {/* ─── Stats row ─── */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--tx-1)' }}>Gemini Queue Health</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Last 7 days · gemini_queue table</p>
          </div>
          <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        {queueLoading ? (
          <div style={{ display: 'flex', gap: 10 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ flex: 1, height: 60, borderRadius: 'var(--r-md)' }} />)}
          </div>
        ) : queueError ? (
          <p style={{ fontSize: 13, color: 'var(--danger)' }}>{queueError}</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
              {([
                ['queued', stats.queued, 'var(--info)', <Clock size={16} key="q" />],
                ['processed', stats.processed, 'var(--success)', <CheckCircle2 size={16} key="p" />],
                ['stale', stats.stale, 'var(--tx-3)', <RefreshCw size={16} key="s" />],
                ['failed', stats.failed, 'var(--danger)', <XCircle size={16} key="f" />],
              ] as const).map(([label, count, color, icon]) => (
                <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ color }}>{icon}</div>
                    <span style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{count}</span>
                  </div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</p>
                </div>
              ))}
            </div>
            {stats.avgMinutes !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 12 }}>
                <Clock size={13} color="var(--tx-3)" />
                <span style={{ color: 'var(--tx-2)' }}>Avg triage time:</span>
                <strong style={{ color: stats.avgMinutes > 5 ? 'var(--warning)' : 'var(--success)' }}>{stats.avgMinutes} min</strong>
                {stats.avgMinutes > 5 && <span style={{ color: 'var(--warning)', fontSize: 11 }}>· above 5 min target</span>}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Queue table ─── */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Recent Queue Items</p>
          {stats.stuckItems.length > 0 && (
            <button onClick={requeueAll} disabled={requeueingAll}
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.28)', borderRadius: 'var(--r-sm)', padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={11} /> Re-queue all stuck ({stats.stuckItems.length})
            </button>
          )}
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 400 }}>
          {stats.recentItems.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--tx-3)', padding: '24px 16px', textAlign: 'center' }}>No queue items in the last 7 days</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  {['Report ID', 'Status', 'Queued At', 'Processed At', 'Time in Queue', ''].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recentItems.slice(0, 50).map(item => {
                  const isStuck = stats.stuckItems.some(s => s.id === item.id)
                  const timeInQueue = item.status === 'processed' ? formatDuration(item.queued_at, item.processed_at)
                    : item.status === 'queued' ? formatDuration(item.queued_at, new Date().toISOString()) + (isStuck ? ' ⚠' : '')
                    : '—'
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: isStuck ? 'rgba(227,179,65,.04)' : 'transparent' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <span className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)' }}>{item.report_id}</span>
                      </td>
                      <td style={{ padding: '8px 12px' }}><StatusBadge status={item.status} /></td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(item.queued_at)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(item.processed_at)}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: isStuck ? 'var(--warning)' : 'var(--tx-2)', fontWeight: isStuck ? 600 : 400 }}>{timeInQueue}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {(item.status === 'failed' || item.status === 'stale' || isStuck) && (
                          <button
                            onClick={() => requeueSingle(item)}
                            disabled={requeueingId === item.id}
                            style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-sm)', padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {requeueingId === item.id ? <Loader2 size={10} className="anim-spin" /> : <RefreshCw size={10} />} Re-queue
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>}

      {subTab === 'quality' && (
      /* ─── Data quality panel ─── */
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Data Quality</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Pipeline integrity checks across all bug reports</p>
          </div>
          <button onClick={refreshDataQuality} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        <div style={{ padding: '0 4px' }}>
          <QualityTable rows={qualityRows} />
        </div>
      </div>
      )}

    </div>
  )
}
