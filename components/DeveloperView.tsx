'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { ParsedBug, DashboardStats } from '@/lib/bugUtils'
import {
  ExternalLink, Search, Sparkles, Loader2, X, ChevronRight,
  RefreshCw, MessageSquare, MoveRight, Plus,
} from 'lucide-react'
import geminiLimiter from '@/lib/rateLimiter'
import { withRetry } from '@/lib/withRetry'
import toast from '@/lib/toast'

interface Props { bugs: ParsedBug[]; stats: DashboardStats }
type DevTab = 'rollbar' | 'posthog' | 'cloudwatch' | 'ai'

const SEV: Record<string, { bg: string; color: string; border: string }> = {
  P1:      { bg: 'var(--p1-dim)',         color: 'var(--p1)',   border: 'rgba(255,123,114,.22)' },
  P2:      { bg: 'var(--p2-dim)',         color: 'var(--p2)',   border: 'rgba(227,179,65,.22)'  },
  P3:      { bg: 'var(--p3-dim)',         color: 'var(--p3)',   border: 'rgba(88,166,255,.22)'  },
  P4:      { bg: 'rgba(139,148,158,.08)', color: 'var(--p4)',   border: 'rgba(139,148,158,.22)' },
  unknown: { bg: 'var(--surface-2)',      color: 'var(--tx-3)', border: 'var(--border)'         },
}
const MODULE_COLOR: Record<string, string> = {
  WEB: 'var(--module-web)', APP: 'var(--module-app)',
  BACKEND: 'var(--module-be)', INFRASTRUCTURE: 'var(--module-infra)',
}
const STATUS_COLOR: Record<string, string> = {
  complete: 'var(--success)', pending: 'var(--warning)', triaging: 'var(--purple)', unknown: 'var(--tx-3)',
}
const DEV_TABS: { id: DevTab; label: string }[] = [
  { id: 'rollbar',    label: 'Rollbar'     },
  { id: 'posthog',    label: 'PostHog'     },
  { id: 'cloudwatch', label: 'CloudWatch'  },
  { id: 'ai',         label: 'AI Analysis' },
]

/* ── Types ─────────────────────────────────────────────────── */
interface RollbarItem {
  id: string; title: string; level: string; status: string
  occurrences: number; uniqueOccurrences: number
  lastOccurrenceAt: number; environment: string; url: string
}
interface StackFrame { filename?: string; lineno?: number; colno?: number; method?: string; code?: string }
interface RollbarInstance { id: string; timestamp: number; request_url?: string; request_method?: string; server_host?: string; person_email?: string }
interface PosthogEvent { id: string; event: string; timestamp: string; distinctId: string; url?: unknown; browser?: unknown; os?: unknown }
interface CloudwatchEvent { timestamp: string; message: string; stream?: string }
interface JiraTransition { id: string; name: string; toStatus: string }

/* ── Full-data parser ──────────────────────────────────────── */
function parseFullData(fullDataStr: string | null) {
  if (!fullDataStr) return null
  try {
    const fd    = JSON.parse(fullDataStr)
    const inner = JSON.parse(fd.full_data || '{}')
    return {
      rb:   inner._rb         || {},
      ph:   inner._posthog    || {},
      cw:   inner._cloudwatch || {},
      ctx:  inner.context     || {},
      sess: inner.session     || {},
    }
  } catch { return null }
}

/* ── Loading / error helpers ───────────────────────────────── */
function TabLoader({ text = 'Loading…' }: { text?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--tx-3)' }}>
      <Loader2 size={16} className="anim-spin" aria-hidden /> {text}
    </div>
  )
}
function TabError({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <p style={{ fontSize: 13, color: 'var(--danger)' }}>{msg}</p>
      {onRetry && (
        <button onClick={onRetry} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '5px 12px', cursor: 'pointer' }}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  )
}
function NoData({ service, reason }: { service: string; reason?: string }) {
  return (
    <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: 0.65 }}>
      <span style={{ fontSize: 24 }}>🔌</span>
      <p style={{ fontSize: 13, color: 'var(--tx-2)', fontWeight: 500 }}>{service}</p>
      {reason && <p className="font-mono" style={{ fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>{reason}</p>}
    </div>
  )
}

export default function DeveloperView({ bugs }: Props) {
  const [search, setSearch]               = useState('')
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [devTab, setDevTab]               = useState<DevTab>('rollbar')

  // AI
  const [aiPrompt, setAiPrompt]   = useState('')
  const [aiOutput, setAiOutput]   = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // Rollbar
  const [rbData, setRbData]       = useState<{ item: RollbarItem; frames: StackFrame[]; instances: RollbarInstance[] } | null>(null)
  const [rbLoading, setRbLoading] = useState(false)
  const [rbError, setRbError]     = useState<string | null>(null)

  // PostHog
  const [phData, setPhData]       = useState<{ count: number; events: PosthogEvent[]; sessionRecordingUrl: string | null } | null>(null)
  const [phLoading, setPhLoading] = useState(false)
  const [phError, setPhError]     = useState<string | null>(null)

  // CloudWatch
  const [cwData, setCwData]       = useState<{ count: number; events: CloudwatchEvent[]; logGroup: string } | null>(null)
  const [cwLoading, setCwLoading] = useState(false)
  const [cwError, setCwError]     = useState<string | null>(null)

  // Jira
  const [jiraLoading, setJiraLoading]   = useState('')
  const [jiraComment, setJiraComment]   = useState('')
  const [commentOpen, setCommentOpen]   = useState(false)
  const [transitions, setTransitions]   = useState<JiraTransition[]>([])
  const [transOpen, setTransOpen]       = useState(false)

  const bug = useMemo(() => bugs.find(b => b.report_id === selectedId) || null, [bugs, selectedId])

  const fullData = useMemo(() => parseFullData(bug?.full_data || null), [bug?.full_data])
  const phSessionId  = fullData?.sess?.posthog_session_id  as string | undefined
  const phSessionUrl = fullData?.sess?.posthog_session_url as string | undefined

  const matchingBugs = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return bugs
    return bugs.filter(b =>
      b.jira_key?.toLowerCase().includes(q) ||
      b.report_id.toLowerCase().includes(q) ||
      b.description?.toLowerCase().slice(0, 100).includes(q)
    )
  }, [bugs, search])

  const relatedBugs = useMemo(() => {
    if (!bug) return []
    return bugs.filter(b =>
      b.report_id !== bug.report_id && (
        (bug.rollbarItemId && b.rollbarItemId === bug.rollbarItemId) ||
        (bug.description && b.description && b.description.slice(0, 60) === bug.description.slice(0, 60))
      )
    ).slice(0, 4)
  }, [bug, bugs])

  const selectBug = (b: ParsedBug) => {
    setSelectedId(b.report_id)
    setDevTab('rollbar')
    setAiOutput(''); setAiPrompt('')
    setRbData(null); setRbError(null)
    setPhData(null); setPhError(null)
    setCwData(null); setCwError(null)
    setCommentOpen(false); setTransOpen(false); setTransitions([])
  }

  /* ── Fetch functions (used by effect + refresh buttons) ───── */
  const fetchRollbar = useCallback(() => {
    if (!bug?.rollbarItemId) return
    setRbLoading(true); setRbError(null); setRbData(null)
    fetch(`/api/rollbar?itemId=${encodeURIComponent(bug.rollbarItemId)}&module=${bug.module}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setRbError(d.error) } else { setRbData({ item: d.item, frames: d.stackFrames || [], instances: d.instances || [] }) } })
      .catch((e: Error) => setRbError(e.message))
      .finally(() => setRbLoading(false))
  }, [bug?.rollbarItemId, bug?.module])

  const fetchPosthog = useCallback(() => {
    if (!phSessionId) return
    setPhLoading(true); setPhError(null); setPhData(null)
    fetch(`/api/posthog?sessionId=${encodeURIComponent(phSessionId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setPhError(d.error) } else { setPhData(d) } })
      .catch((e: Error) => setPhError(e.message))
      .finally(() => setPhLoading(false))
  }, [phSessionId])

  const fetchCloudwatch = useCallback(() => {
    if (!bug?.created_at) return
    setCwLoading(true); setCwError(null); setCwData(null)
    fetch(`/api/cloudwatch?timestamp=${encodeURIComponent(bug.created_at)}&minutes=15`)
      .then(r => r.json())
      .then(d => { if (d.error) { setCwError(d.error) } else { setCwData(d) } })
      .catch((e: Error) => setCwError(e.message))
      .finally(() => setCwLoading(false))
  }, [bug?.created_at])

  /* ── Auto-fetch on tab activation ───────────────────────── */
  useEffect(() => {
    if (!bug) return
    if (devTab === 'rollbar' && bug.rollbarItemId) fetchRollbar()
    if (devTab === 'posthog' && phSessionId)       fetchPosthog()
    if (devTab === 'cloudwatch')                   fetchCloudwatch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devTab, bug?.report_id])

  /* ── Jira actions ─────────────────────────────────────────── */
  const handleCreateTicket = async () => {
    if (!bug) return
    setJiraLoading('create')
    const tid = toast.loading('Creating Jira ticket in YSC…')
    try {
      const res = await fetch('/api/jira', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: bug.description?.slice(0, 200) || 'Bug report',
          description: bug.description || '',
          severity: bug.severity || 'P3',
          module: bug.module,
          reportId: bug.report_id,
          source: bug.source || 'unknown',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      toast.dismiss(tid)
      toast.success('Ticket created', `${data.key} created — auto-transfer to YSDT for P1/P2`)
      window.open(data.url, '_blank')
    } catch (err) {
      toast.dismiss(tid)
      toast.error('Create failed', err instanceof Error ? err.message : 'Unknown error')
    } finally { setJiraLoading('') }
  }

  const handleAddComment = async () => {
    if (!bug?.jira_key || !jiraComment.trim()) return
    setJiraLoading('comment')
    const tid = toast.loading('Adding comment…')
    try {
      const res = await fetch('/api/jira/comment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: bug.jira_key, comment: jiraComment }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      toast.dismiss(tid)
      toast.success('Comment added', `Posted to ${bug.jira_key}`)
      setJiraComment(''); setCommentOpen(false)
    } catch (err) {
      toast.dismiss(tid)
      toast.error('Comment failed', err instanceof Error ? err.message : 'Unknown error')
    } finally { setJiraLoading('') }
  }

  const handleLoadTransitions = async () => {
    if (!bug?.jira_key) return
    if (transitions.length > 0) { setTransOpen(v => !v); return }
    setJiraLoading('transitions')
    try {
      const res = await fetch(`/api/jira/transition?key=${bug.jira_key}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setTransitions(data.transitions || [])
      setTransOpen(true)
    } catch (err) {
      toast.error('Failed to load transitions', err instanceof Error ? err.message : 'Unknown error')
    } finally { setJiraLoading('') }
  }

  const handleTransition = async (id: string, name: string) => {
    if (!bug?.jira_key) return
    setJiraLoading('transition'); setTransOpen(false)
    const tid = toast.loading(`Moving to ${name}…`)
    try {
      const res = await fetch('/api/jira/transition', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: bug.jira_key, transitionId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      toast.dismiss(tid)
      toast.success('Status moved', `${bug.jira_key} → ${name}`)
    } catch (err) {
      toast.dismiss(tid)
      toast.error('Transition failed', err instanceof Error ? err.message : 'Unknown error')
    } finally { setJiraLoading('') }
  }

  /* ── AI analysis ──────────────────────────────────────────── */
  const handleAiAnalyse = useCallback(async () => {
    if (!bug) return
    const check = geminiLimiter.canRequest()
    if (!check.ok) {
      toast.warning('Rate limit', check.reason)
      const secs = Math.ceil(check.waitMs / 1000)
      setCountdown(secs)
      const iv = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(iv); return 0 } return c - 1 }), 1000)
      return
    }
    geminiLimiter.record()
    setAiLoading(true); setAiOutput('')
    abortRef.current = new AbortController()
    const prompt = aiPrompt.trim() ||
      `Analyse this bug and provide:\n1. Root cause (2-3 sentences)\n2. User impact\n3. Fix suggestion\n4. Priority justification\n\nBug: ${bug.description || 'No description'}\nSeverity: ${bug.severity}\nModule: ${bug.module}\nComponent: ${bug.component || 'unknown'}\nEnvironment: ${bug.environment || 'unknown'}\nAI Summary: ${bug.ai_summary || 'none'}`
    try {
      const data = await withRetry(async () => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortRef.current!.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
        )
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      }, { maxRetries: 2, signal: abortRef.current.signal })
      setAiOutput(data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.')
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') toast.error('Gemini failed', (err as Error).message)
    } finally { setAiLoading(false) }
  }, [bug, aiPrompt])

  const sev    = SEV[bug?.severity || 'unknown'] || SEV.unknown
  const modCol = MODULE_COLOR[bug?.module || ''] || 'var(--tx-3)'

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }} className="anim-fadein">

      {/* ── Bug list sidebar ──────────────────────────────────── */}
      <div style={{
        width: 264, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--surface-1)',
      }}>
        {/* Search / filter */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--tx-3)', pointerEvents: 'none' }} aria-hidden />
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter bugs…"
              style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 8px 6px 26px', fontSize: 12, color: 'var(--tx-1)', outline: 'none' }}
              onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--orange)'}
              onBlur={e  => (e.target as HTMLElement).style.borderColor = 'var(--border)'}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear filter"
                style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--tx-3)', display: 'flex', cursor: 'pointer' }}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>
        {/* Count */}
        <div style={{ padding: '5px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, fontSize: 10, color: 'var(--tx-3)' }}>
          {matchingBugs.length} of {bugs.length} reports
        </div>
        {/* Scrollable bug list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {matchingBugs.map(b => {
            const bs = SEV[b.severity || 'unknown'] || SEV.unknown
            const isSel = b.report_id === selectedId
            return (
              <div key={b.report_id} onClick={() => selectBug(b)}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--hover)' }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                style={{
                  padding: '9px 12px', cursor: 'pointer',
                  borderLeft: `3px solid ${isSel ? 'var(--orange)' : 'transparent'}`,
                  background: isSel ? 'var(--orange-dim)' : 'transparent',
                  borderBottom: '1px solid var(--border)', transition: 'background .1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: bs.bg, color: bs.color, flexShrink: 0 }}>{b.severity || '??'}</span>
                  {b.jira_key && <span style={{ fontSize: 10, color: 'var(--info)', fontWeight: 600, flexShrink: 0 }}>{b.jira_key}</span>}
                  <span style={{ fontSize: 9, color: 'var(--tx-3)', marginLeft: 'auto', flexShrink: 0 }}>{b.created_at.slice(0, 10)}</span>
                </div>
                <p className="font-mono" style={{ fontSize: 10, color: isSel ? 'var(--tx-1)' : 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                  {b.description?.slice(0, 65) || b.report_id}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Main area ─────────────────────────────────────────── */}
      {!bug ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--tx-3)' }}>
          <Sparkles size={36} style={{ opacity: 0.25 }} aria-hidden />
          <p style={{ fontSize: 14, fontWeight: 500 }}>Select a bug from the list</p>
          <p style={{ fontSize: 12 }}>{bugs.length} reports available</p>
        </div>
      ) : (
        /* ── Two-column layout ────────────────────────────────── */
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '2fr 3fr', overflow: 'hidden' }}>

          {/* ── LEFT (40%) ────────────────────────────────────── */}
          <div style={{ overflowY: 'auto', borderRight: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Metadata card */}
            <div style={{ background: 'var(--surface-1)', border: `1px solid ${sev.border}`, borderRadius: 'var(--r-lg)', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}>{bug.severity || 'UNKNOWN'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: `${modCol}22`, color: modCol, border: `1px solid ${modCol}44` }}>{bug.module}</span>
                <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: 'var(--surface-2)', color: STATUS_COLOR[bug.status || 'unknown'], border: '1px solid var(--border)' }}>{bug.status || 'unknown'}</span>
              </div>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--tx-1)', lineHeight: 1.5, marginBottom: 12, wordBreak: 'break-word' }}>
                {bug.description?.slice(0, 180) || 'No description'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {([
                  ['Report ID',   bug.report_id,                                  true ],
                  ['Component',   bug.component,                                  false],
                  ['Platform',    bug.platform,                                   false],
                  ['Environment', bug.environment,                                false],
                  ['App Version', bug.app_version,                                true ],
                  ['Reporter',    bug.reporter_email,                             false],
                  ['Created',     bug.created_at?.slice(0, 16).replace('T', ' '), false],
                  ['Triaged',     bug.triaged_at?.slice(0, 16).replace('T', ' '), false],
                ] as [string, string | null | undefined, boolean][]).filter(([, v]) => v).map(([lbl, val, mono]) => (
                  <div key={lbl} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 74, flexShrink: 0, paddingTop: 1 }}>{lbl}</span>
                    <span className={mono ? 'font-mono' : ''} style={{ fontSize: 11, color: lbl === 'Environment' && val === 'production' ? 'var(--danger)' : 'var(--tx-2)', wordBreak: 'break-all', lineHeight: 1.4 }}>{val}</span>
                  </div>
                ))}
              </div>
              {bug.jira_key && (
                <a href={bug.jira_url || '#'} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--info)', background: 'var(--info-dim)', padding: '5px 10px', borderRadius: 'var(--r-md)', border: '1px solid rgba(88,166,255,.2)', textDecoration: 'none' }}>
                  <ExternalLink size={11} aria-hidden /> {bug.jira_key}
                </a>
              )}
            </div>

            {/* AI Summary */}
            {bug.ai_summary && (
              <div style={{ background: 'var(--purple-dim)', border: '1px solid rgba(163,113,247,.25)', borderRadius: 'var(--r-lg)', padding: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>AI Summary</p>
                <p style={{ fontSize: 12, color: 'var(--tx-1)', lineHeight: 1.6 }}>{bug.ai_summary}</p>
              </div>
            )}

            {/* Jira Actions */}
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Jira Actions</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                {/* Create ticket (shown when no jira_key) */}
                {!bug.jira_key && (
                  <button onClick={handleCreateTicket} disabled={!!jiraLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 600, background: 'var(--orange)', color: '#fff', border: 'none', cursor: jiraLoading ? 'not-allowed' : 'pointer', opacity: jiraLoading ? 0.65 : 1, transition: 'opacity .15s' }}>
                    {jiraLoading === 'create' ? <Loader2 size={12} className="anim-spin" /> : <Plus size={12} />}
                    Create Jira ticket in YSC
                  </button>
                )}

                {/* Comment button (shown when has jira_key) */}
                {bug.jira_key && (
                  <>
                    <button onClick={() => setCommentOpen(v => !v)} disabled={!!jiraLoading}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                      {jiraLoading === 'comment' ? <Loader2 size={12} className="anim-spin" /> : <MessageSquare size={12} />}
                      Add comment to {bug.jira_key}
                    </button>
                    {commentOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <textarea
                          value={jiraComment}
                          onChange={e => setJiraComment(e.target.value)}
                          placeholder="Write your comment…"
                          rows={3}
                          style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '8px', fontSize: 12, color: 'var(--tx-1)', resize: 'vertical', outline: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={handleAddComment} disabled={!jiraComment.trim() || !!jiraLoading}
                            style={{ flex: 1, padding: '6px', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, background: 'var(--info)', color: '#fff', border: 'none', cursor: jiraComment.trim() ? 'pointer' : 'not-allowed', opacity: jiraComment.trim() ? 1 : 0.5 }}>
                            Post
                          </button>
                          <button onClick={() => { setCommentOpen(false); setJiraComment('') }}
                            style={{ padding: '6px 12px', borderRadius: 'var(--r-sm)', fontSize: 12, background: 'var(--surface-3)', color: 'var(--tx-2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Move status */}
                    <div style={{ position: 'relative' }}>
                      <button onClick={handleLoadTransitions} disabled={!!jiraLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', width: '100%', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                        {jiraLoading === 'transitions' || jiraLoading === 'transition' ? <Loader2 size={12} className="anim-spin" /> : <MoveRight size={12} />}
                        Move status
                      </button>
                      {transOpen && transitions.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
                          {transitions.map(t => (
                            <button key={t.id} onClick={() => handleTransition(t.id, t.name)}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', fontSize: 12, color: 'var(--tx-1)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }}>
                              <ChevronRight size={11} color="var(--tx-3)" />
                              {t.name}
                              <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto' }}>→ {t.toStatus}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Related bugs */}
            {relatedBugs.length > 0 && (
              <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Related Bugs ({relatedBugs.length})</p>
                {relatedBugs.map(rb => {
                  const rs = SEV[rb.severity || 'unknown'] || SEV.unknown
                  return (
                    <div key={rb.report_id} onClick={() => selectBug(rb)}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: rs.bg, color: rs.color, flexShrink: 0 }}>{rb.severity || '??'}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rb.description?.slice(0, 55) || rb.report_id}</span>
                      <ChevronRight size={11} color="var(--tx-3)" aria-hidden />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT (60%) ───────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Tab strip */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface-1)', flexShrink: 0, alignItems: 'center' }}>
              {DEV_TABS.map(t => {
                const active = devTab === t.id
                return (
                  <button key={t.id} onClick={() => setDevTab(t.id)} style={{
                    padding: '10px 16px', fontSize: 12, fontWeight: active ? 600 : 400,
                    color: active ? 'var(--orange)' : 'var(--tx-3)',
                    borderBottom: active ? '2px solid var(--orange)' : '2px solid transparent',
                    background: 'transparent', transition: 'all .15s', cursor: 'pointer',
                  }}>
                    {t.label}
                  </button>
                )
              })}
              {/* Refresh button for data tabs */}
              {devTab !== 'ai' && (
                <button onClick={() => {
                  if (devTab === 'rollbar') fetchRollbar()
                  else if (devTab === 'posthog') fetchPosthog()
                  else if (devTab === 'cloudwatch') fetchCloudwatch()
                }} aria-label="Refresh data" style={{ marginLeft: 'auto', marginRight: 12, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '3px 8px', cursor: 'pointer' }}>
                  <RefreshCw size={11} /> Refresh
                </button>
              )}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

              {/* ── Rollbar tab ────────────────────────────────── */}
              {devTab === 'rollbar' && (
                <div>
                  {rbLoading && <TabLoader text="Loading Rollbar data…" />}
                  {rbError && <TabError msg={rbError} onRetry={fetchRollbar} />}

                  {!rbLoading && !rbError && !bug.rollbarItemId && (
                    <NoData service="No Rollbar item ID for this bug" reason="Bug was not auto-detected via Rollbar" />
                  )}

                  {!rbLoading && !rbError && bug.rollbarItemId && !rbData && (
                    <NoData service="Rollbar" reason="No data loaded" />
                  )}

                  {rbData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Item header */}
                      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', lineHeight: 1.4, flex: 1 }}>{rbData.item.title}</p>
                          <a href={rbData.item.url} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--info)', flexShrink: 0, textDecoration: 'none' }}>
                            Rollbar <ExternalLink size={10} />
                          </a>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Level: <strong style={{ color: rbData.item.level === 'critical' || rbData.item.level === 'error' ? 'var(--danger)' : 'var(--warning)' }}>{rbData.item.level}</strong></span>
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Total: <strong style={{ color: 'var(--tx-1)' }}>{rbData.item.occurrences?.toLocaleString()}</strong> occurrences</span>
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Unique: <strong style={{ color: 'var(--tx-1)' }}>{rbData.item.uniqueOccurrences?.toLocaleString()}</strong> users</span>
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Env: <strong style={{ color: 'var(--tx-1)' }}>{rbData.item.environment}</strong></span>
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Status: <strong style={{ color: 'var(--tx-1)' }}>{rbData.item.status}</strong></span>
                          {rbData.item.lastOccurrenceAt && (
                            <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Last: <strong style={{ color: 'var(--tx-1)' }}>{new Date(rbData.item.lastOccurrenceAt * 1000).toLocaleString()}</strong></span>
                          )}
                        </div>
                      </div>

                      {/* Stack trace */}
                      {rbData.frames.length > 0 && (
                        <div>
                          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                            Stack Trace ({rbData.frames.length} frames)
                          </p>
                          <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            {rbData.frames.slice().reverse().map((frame, i) => (
                              <div key={i} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                                <span style={{ fontSize: 10, color: 'var(--tx-3)', minWidth: 24, textAlign: 'right', flexShrink: 0 }}>#{rbData.frames.length - i}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p className="font-mono" style={{ fontSize: 11, color: frame.filename?.includes('node_modules') ? 'var(--tx-3)' : 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {frame.filename || '?'}{frame.lineno ? `:${frame.lineno}` : ''}{frame.colno ? `:${frame.colno}` : ''}
                                  </p>
                                  {frame.method && <p className="font-mono" style={{ fontSize: 10, color: 'var(--info)', marginTop: 1 }}>{frame.method}</p>}
                                  {frame.code && <p className="font-mono" style={{ fontSize: 10, color: 'var(--tx-2)', marginTop: 2, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{frame.code}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recent occurrences */}
                      {rbData.instances.length > 0 && (
                        <div>
                          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Recent Occurrences</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {rbData.instances.map((inst, i) => (
                              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 11 }}>
                                <span style={{ color: 'var(--tx-3)', flexShrink: 0 }}>{new Date(inst.timestamp * 1000).toLocaleString()}</span>
                                {inst.person_email && <span style={{ color: 'var(--info)', flexShrink: 0 }}>{inst.person_email}</span>}
                                {inst.request_method && inst.request_url && (
                                  <span className="font-mono" style={{ color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {inst.request_method} {inst.request_url}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── PostHog tab ────────────────────────────────── */}
              {devTab === 'posthog' && (
                <div>
                  {phLoading && <TabLoader text="Loading PostHog events…" />}
                  {phError && <TabError msg={phError} onRetry={fetchPosthog} />}

                  {!phLoading && !phError && !phSessionId && (
                    <NoData service="No PostHog session ID for this bug" reason="session.posthog_session_id not in full_data" />
                  )}

                  {!phLoading && !phError && phSessionId && !phData && (
                    <NoData service="PostHog" reason="No data loaded" />
                  )}

                  {phData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: 'var(--tx-2)' }}>
                          <strong style={{ color: 'var(--tx-1)' }}>{phData.count}</strong> events in session
                        </span>
                        {(phSessionUrl || phData.sessionRecordingUrl) && (
                          <a href={(phSessionUrl || phData.sessionRecordingUrl)!} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--info)', background: 'var(--info-dim)', padding: '4px 10px', borderRadius: 'var(--r-md)', border: '1px solid rgba(88,166,255,.2)', textDecoration: 'none' }}>
                            <ExternalLink size={11} /> Watch replay
                          </a>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {phData.events.map((evt, i) => (
                          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 10px', background: i % 2 === 0 ? 'var(--surface-2)' : 'transparent', borderRadius: 'var(--r-sm)', fontSize: 11 }}>
                            <span className="font-mono" style={{ color: 'var(--tx-3)', flexShrink: 0, minWidth: 80 }}>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                            <span style={{ color: evt.event.startsWith('$') ? 'var(--tx-3)' : 'var(--success)', fontWeight: 600, flexShrink: 0, minWidth: 90 }}>{evt.event}</span>
                            {evt.url && <span className="font-mono" style={{ color: 'var(--info)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(evt.url)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── CloudWatch tab ─────────────────────────────── */}
              {devTab === 'cloudwatch' && (
                <div>
                  {cwLoading && <TabLoader text="Fetching CloudWatch logs…" />}
                  {cwError && <TabError msg={cwError} onRetry={fetchCloudwatch} />}

                  {!cwLoading && !cwError && cwData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
                        <span style={{ color: 'var(--tx-3)' }}>Log group: <strong className="font-mono" style={{ color: 'var(--info)' }}>{cwData.logGroup}</strong></span>
                        <span style={{ color: 'var(--tx-3)' }}>Found <strong style={{ color: cwData.count > 0 ? 'var(--tx-1)' : 'var(--tx-3)' }}>{cwData.count}</strong> matching lines</span>
                        <span style={{ color: 'var(--tx-3)' }}>±15 min window around bug timestamp</span>
                      </div>
                      {cwData.events.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--tx-3)', textAlign: 'center', padding: 20 }}>No log lines matched the ERROR filter in the time window</p>
                      ) : (
                        <div style={{ background: '#0d1117', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: 14, maxHeight: 480, overflowY: 'auto' }}>
                          {cwData.events.map((evt, i) => (
                            <div key={i} className="font-mono" style={{ fontSize: 11, lineHeight: 1.6, color: evt.message.toLowerCase().includes('error') ? '#f85149' : '#c9d1d9', marginBottom: 2 }}>
                              <span style={{ color: '#8b949e', marginRight: 10 }}>{evt.timestamp.slice(11, 23)}</span>
                              {evt.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── AI Analysis tab ────────────────────────────── */}
              {devTab === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 7 }}>
                      Custom prompt (optional)
                    </label>
                    <textarea
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      placeholder="Ask a specific question about this bug, or leave blank for a default root-cause analysis…"
                      rows={3}
                      style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', fontSize: 12, color: 'var(--tx-1)', resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
                    />
                  </div>
                  <button
                    onClick={handleAiAnalyse}
                    disabled={aiLoading || countdown > 0}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 600, background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', border: 'none', cursor: (aiLoading || countdown > 0) ? 'not-allowed' : 'pointer', opacity: (aiLoading || countdown > 0) ? 0.55 : 1, transition: 'opacity .15s' }}
                  >
                    {aiLoading    ? <><Loader2 size={13} className="anim-spin" aria-hidden /> Analysing…</> :
                     countdown > 0 ? `Wait ${countdown}s` :
                     <><Sparkles size={13} aria-hidden /> Analyse with Gemini</>}
                  </button>
                  {aiOutput && (
                    <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(163,113,247,.2)', borderRadius: 'var(--r-lg)', padding: 16 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Gemini Analysis</p>
                      <p style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiOutput}</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>

        </div>
      )}
    </div>
  )
}
