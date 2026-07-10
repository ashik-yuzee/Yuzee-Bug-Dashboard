'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { ParsedBug, DashboardStats } from '@/lib/bugUtils'
import geminiLimiter from '@/lib/rateLimiter'
import { withRetry } from '@/lib/withRetry'
import toast from '@/lib/toast'
import { X, Sparkles, AlertTriangle, Copy, CheckCheck, ChevronDown, ChevronRight, RefreshCw, Clock, Zap } from 'lucide-react'

interface Props { bugs: ParsedBug[]; stats: DashboardStats; onClose: () => void }

const TIMEOUT_MS = 60_000

const LOADING_MESSAGES = [
  'Reading nested Rollbar context…',
  'Cross-referencing error patterns…',
  'Mapping affected endpoints…',
  'Formulating root cause hypotheses…',
  'Drafting action plan…',
]

/* ─── Prompt builder ─────────────────────────────────────── */
function buildPrompt(bugs: ParsedBug[], stats: DashboardStats): string {
  const details = bugs.map((b, i) => {
    let ctxStr = ''
    try {
      const fd = JSON.parse(b.full_data || '{}')
      const inner = JSON.parse(fd.full_data || '{}')
      const ctx = inner.context || {}
      const rb  = inner.rollbar || {}
      const sess = inner.session || {}
      ctxStr = [
        ctx.environment && `Environment: ${ctx.environment}`,
        ctx.page_url    && `Page/Endpoint: ${ctx.page_url}`,
        rb.item_id      && `Rollbar item: #${rb.item_id}`,
        sess.posthog_session_id && `PostHog session: ${sess.posthog_session_id}`,
      ].filter(Boolean).join('\n')
    } catch {}

    return `
=== Bug ${i + 1}/${bugs.length} ===
ID: ${b.report_id}  |  Jira: ${b.jira_key ? `${b.jira_key} (${b.jira_url})` : 'NONE'}
Severity: ${b.severity || 'unclassified'}  |  Status: ${b.status}
Error type: ${b.errorType}  |  Confidence: ${b.confidence != null ? `${(b.confidence * 100).toFixed(0)}%` : '?'}
Category: ${b.category}  |  Component: ${b.component}
Platform: ${b.platform}  |  Version: ${b.app_version}
Source: ${b.source}  |  Reporter: ${b.reporter_email || 'automated'}
Error: ${b.description}
Frequency: ${b.frequency || '?'}  |  Total ~occurrences: ${b.occurrences}
Labels: ${b.parsedLabels.join(', ') || 'none'}
${ctxStr}
AI summary: ${b.ai_summary || 'none'}
Notes: ${b.anything_else || 'none'}`.trim()
  }).join('\n\n')

  const clusterNote = (() => {
    const c = stats.errorClusters.find(c => c.description === bugs[0]?.description)
    if (c && c.count > bugs.length)
      return `\nNOTE: The primary error appears ${c.count}× total across versions ${Object.keys(c.versions).join(', ')}. You are analysing ${bugs.length} of them. Full cluster Jira tickets: ${c.jiraKeys.join(', ') || 'none'}.`
    return ''
  })()

  const rollbarNote = stats.rollbarGroups.length
    ? `\nROLLBAR GROUPS: ${stats.rollbarGroups.map(g => `#${g.itemId}=${g.count}reports(${g.jiraKeys.join(',')||'no Jira'})`).join('; ')}`
    : ''

  return `You are a senior engineer at Yuzee, an Australian university admissions platform (Angular/Ionic frontend, Java Spring Boot + Jersey backend). Team: Junaid=backend, Ramzan & Shaqeeba=frontend.

Analysing ${bugs.length} bug report${bugs.length > 1 ? 's' : ''} from a 10-day incident window (Jun 10–19 2026).${clusterNote}${rollbarNote}

${details}

Provide a structured engineering analysis:

**Executive Summary**
2–3 sentences. Specific endpoint/component/version. User impact (signup blocked? payment broken?).

**Root Cause Analysis**
For each distinct error: likely cause, what property is null/undefined, why. Distinguish frontend TS from backend Java.

**Impact Assessment**
Rating: Critical/High/Medium/Low. Estimated affected user journeys. Evidence from occurrence counts.

**Pattern & Correlation**
Related bugs? Same version trigger? Rollbar clustering pointing to single root cause?

**Triage Gaps**
No Jira? Mis-categorised? Low confidence? Missing context?

**Recommended Actions** (prioritised)
Specific steps. Reference Jira keys, team (Junaid/Ramzan/Shaqeeba), endpoints.

**Quick Wins**
One-liners, null-guards, config fixes — easy to ship fast.`
}

/* ─── Gemini call ────────────────────────────────────────── */
async function callGemini(prompt: string, signal: AbortSignal): Promise<string> {
  const resp = await fetch('/api/gemini', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, generationConfig: { temperature: 0.3, maxOutputTokens: 3000 } }),
  })

  if (resp.status === 429) {
    const retryAfter = resp.headers.get('Retry-After')
    throw new Error(`429: Rate limit. ${retryAfter ? `Retry after ${retryAfter}s.` : 'Please wait before retrying.'}`)
  }
  if (resp.status === 503) throw new Error('503: Gemini is temporarily unavailable.')
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err?.error || `Gemini API error ${resp.status}`)
  }

  const data = await resp.json()
  return data.text || 'Gemini returned an empty response.'
}

/* ─── Rich markdown renderer ─────────────────────────────── */
function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  let key = 0
  const els: React.ReactNode[] = []

  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--tx-1)">$1</strong>')
    .replace(/`(.+?)`/g, '<code style="font-family:monospace;font-size:11px;background:var(--surface-2);padding:1px 5px;border-radius:3px;color:var(--info)">$1</code>')

  for (const line of lines) {
    const t = line.trim()
    if (!t) { els.push(<div key={key++} style={{ height: 6 }} aria-hidden />); continue }

    if (/^\*\*[^*]+\*\*$/.test(t)) {
      const heading = t.replace(/^\*\*|\*\*$/g, '')
      els.push(
        <div key={key++} style={{ display:'flex', alignItems:'center', gap:8, marginTop:22, marginBottom:10, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>
          <span style={{ width:3, height:16, borderRadius:2, background:'var(--orange)', flexShrink:0 }} aria-hidden />
          <h3 className="font-brand" style={{ fontWeight:700, fontSize:14, color:'var(--orange)' }}>{heading}</h3>
        </div>
      )
      continue
    }
    if (/^[-•*]\s/.test(t)) {
      const c = t.replace(/^[-•*]\s+/, '')
      els.push(
        <div key={key++} style={{ display:'flex', gap:9, marginBottom:6, paddingLeft:4 }}>
          <span style={{ color:'var(--orange)', fontWeight:700, flexShrink:0, marginTop:3, fontSize:12 }} aria-hidden>›</span>
          <p style={{ fontSize:13, color:'var(--tx-2)', lineHeight:1.65 }} dangerouslySetInnerHTML={{ __html: inline(c) }} />
        </div>
      )
      continue
    }
    if (/^\d+\.\s/.test(t)) {
      const [num, ...rest] = t.split(/\.\s+/)
      els.push(
        <div key={key++} style={{ display:'flex', gap:9, marginBottom:8, paddingLeft:4 }}>
          <span style={{
            width:20, height:20, borderRadius:'50%', flexShrink:0, marginTop:2,
            background:'var(--orange-dim)', border:'1px solid rgba(249,115,22,.22)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:10, fontWeight:700, color:'var(--orange)'
          }} aria-hidden>{num}</span>
          <p style={{ fontSize:13, color:'var(--tx-2)', lineHeight:1.65 }} dangerouslySetInnerHTML={{ __html: inline(rest.join('. ')) }} />
        </div>
      )
      continue
    }
    els.push(
      <p key={key++} style={{ fontSize:13, color:'var(--tx-2)', lineHeight:1.7, marginBottom:5 }}
        dangerouslySetInnerHTML={{ __html: inline(t) }} />
    )
  }

  return <>{els}</>
}

/* ─── Rate limit countdown ───────────────────────────────── */
function RateCountdown({ waitMs, onReady }: { waitMs: number; onReady: () => void }) {
  const [remaining, setRemaining] = useState(Math.ceil(waitMs / 1000))
  // Keep the latest onReady in a ref so the interval always calls the current
  // version without needing to restart the countdown whenever the parent re-renders.
  const onReadyRef = useRef(onReady)
  useEffect(() => { onReadyRef.current = onReady }, [onReady])

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) { clearInterval(interval); onReadyRef.current(); return 0 }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'40px 20px', textAlign:'center' }}>
      <Clock size={32} color="var(--warning)" aria-hidden />
      <div>
        <p style={{ fontWeight:600, color:'var(--tx-1)', marginBottom:5 }}>Rate limit reached</p>
        <p style={{ fontSize:13, color:'var(--tx-2)' }}>Gemini allows {12} requests/min. Auto-retrying in</p>
        <p style={{ fontSize:36, fontWeight:700, color:'var(--warning)', fontFamily:'monospace', margin:'8px 0' }}
          aria-live="polite" aria-atomic="true">
          {remaining}s
        </p>
      </div>
    </div>
  )
}

/* ─── Main component ─────────────────────────────────────── */
export default function AIAnalysisPanel({ bugs, stats, onClose }: Props) {
  const [analysis, setAnalysis]   = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [rateLimited, setRateLimited] = useState<{ waitMs: number } | null>(null)
  const [attempt, setAttempt]     = useState(0)
  const [copied, setCopied]       = useState(false)
  const [showBugs, setShowBugs]   = useState(false)
  const [elapsed, setElapsed]     = useState(0)
  const abortRef  = useRef<AbortController | null>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const remaining = geminiLimiter.remaining()

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const runAnalysis = useCallback(async () => {
    // Rate limit pre-check
    const check = geminiLimiter.canRequest()
    if (!check.ok) {
      if (check.waitMs > 120_000) {
        setError(check.reason || 'Daily quota exceeded.')
        return
      }
      setRateLimited({ waitMs: check.waitMs })
      return
    }

    setLoading(true)
    setError(null)
    setRateLimited(null)
    setElapsed(0)

    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    // Elapsed timer
    const start = Date.now()
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)

    // Request timeout
    const timeoutId = setTimeout(() => abortRef.current?.abort(), TIMEOUT_MS)

    try {
      geminiLimiter.record()
      const prompt = buildPrompt(bugs, stats)
      const result = await withRetry(
        () => callGemini(prompt, signal),
        {
          maxRetries: 2,
          baseDelayMs: 1500,
          signal,
          onRetry: (n, err, delay) => {
            toast.warning(`Gemini retry ${n}/2`, `${err.message}. Retrying in ${Math.ceil(delay / 1000)}s…`, 4000)
            setAttempt(n)
          }
        }
      )
      setAnalysis(result)
      setAttempt(0)
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (err as Error).message.includes('aborted')) {
        setError('Analysis cancelled.')
      } else if ((err as Error).message.includes('429')) {
        // Rate limit hit mid-flight — show countdown
        setRateLimited({ waitMs: 15_000 })
      } else {
        const msg = (err instanceof Error ? err.message : 'Unknown error')
        setError(msg)
        toast.error('Gemini analysis failed', msg, 8000)
      }
    } finally {
      clearTimeout(timeoutId)
      if (timerRef.current) clearInterval(timerRef.current)
      setLoading(false)
    }
  }, [bugs, stats])

  // Auto-start on mount
  useEffect(() => {
    let cancelled = false
    async function start() { if (!cancelled) await runAnalysis() }
    start()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = () => {
    abortRef.current?.abort()
    setLoading(false)
    setError('Analysis cancelled.')
  }

  const handleCopy = () => {
    if (!analysis) return
    navigator.clipboard.writeText(analysis).then(() => {
      setCopied(true)
      toast.success('Analysis copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => toast.error('Copy failed', 'Browser blocked clipboard access.'))
  }

  const [msgIdx, setMsgIdx] = useState(0)
  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 2400)
    return () => clearInterval(t)
  }, [loading])

  /* ── Layout ──────────────────────────────────────────────── */
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gemini AI Analysis"
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position:'fixed', inset:0, zIndex:200,
        background:'rgba(0,0,0,.72)', backdropFilter:'blur(5px)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:20,
      }}
    >
      <div
        className="anim-fadeup"
        style={{
          width:'100%', maxWidth:820, maxHeight:'90vh',
          background:'var(--surface-1)', border:'1px solid var(--border)',
          borderRadius:'var(--r-xl)', display:'flex', flexDirection:'column',
          overflow:'hidden', boxShadow:'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 18px', borderBottom:'1px solid var(--border)',
          background:'rgba(139,92,246,.08)', flexShrink:0,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{
              width:32, height:32, borderRadius:'var(--r-md)',
              background:'linear-gradient(135deg,#8b5cf6,#6d28d9)',
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <Sparkles size={15} color="#fff" aria-hidden />
            </div>
            <div>
              <p className="font-brand" style={{ fontWeight:700, fontSize:15, color:'var(--tx-1)' }}>
                Gemini AI Analysis
              </p>
              <p style={{ fontSize:11, color:'var(--tx-3)' }}>
                gemini-2.0-flash-lite · {bugs.length} bug{bugs.length !== 1 ? 's' : ''} · {remaining} req/min remaining
              </p>
            </div>
          </div>

          <div style={{ display:'flex', gap:7, alignItems:'center' }}>
            {analysis && !loading && (
              <button
                onClick={handleCopy}
                aria-label="Copy analysis to clipboard"
                style={{
                  display:'flex', alignItems:'center', gap:5,
                  background: copied ? 'rgba(63,185,80,.10)' : 'var(--surface-2)',
                  border:`1px solid ${copied ? 'rgba(63,185,80,.25)' : 'var(--border)'}`,
                  borderRadius:'var(--r-md)', padding:'6px 10px',
                  fontSize:12, color: copied ? 'var(--success)' : 'var(--tx-2)',
                  transition:'all .15s',
                }}
              >
                {copied ? <CheckCheck size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}

            {!loading && (
              <button
                onClick={runAnalysis}
                disabled={!!(rateLimited)}
                aria-label="Re-run analysis"
                style={{
                  display:'flex', alignItems:'center', gap:5,
                  background:'rgba(139,92,246,.10)', border:'1px solid rgba(139,92,246,.25)',
                  borderRadius:'var(--r-md)', padding:'6px 10px',
                  fontSize:12, color:'var(--purple)',
                  opacity: rateLimited ? 0.5 : 1,
                  cursor: rateLimited ? 'not-allowed' : 'pointer',
                }}
              >
                <RefreshCw size={12} aria-hidden /> Retry
              </button>
            )}

            {loading && (
              <button
                onClick={handleCancel}
                aria-label="Cancel analysis"
                style={{
                  display:'flex', alignItems:'center', gap:5,
                  background:'var(--surface-2)', border:'1px solid var(--border)',
                  borderRadius:'var(--r-md)', padding:'6px 10px',
                  fontSize:12, color:'var(--tx-2)',
                }}
              >
                <X size={12} aria-hidden /> Cancel
              </button>
            )}

            <button
              onClick={onClose}
              aria-label="Close panel"
              style={{
                background:'var(--surface-2)', border:'1px solid var(--border)',
                borderRadius:'var(--r-md)', padding:'6px', color:'var(--tx-2)',
                display:'flex', alignItems:'center', transition:'all .15s',
              }}
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        </div>

        {/* Bug list toggle */}
        <button
          onClick={() => setShowBugs(v => !v)}
          aria-expanded={showBugs}
          aria-controls="bug-list-panel"
          style={{
            display:'flex', alignItems:'center', gap:7, padding:'8px 18px',
            background:'var(--surface-2)', border:'none', borderBottom:'1px solid var(--border)',
            cursor:'pointer', color:'var(--tx-3)', fontSize:12, textAlign:'left', flexShrink:0,
          }}
        >
          {showBugs ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          Analysing: {bugs.map(b => b.jira_key || b.report_id.slice(-8)).join(' · ')}
        </button>

        {showBugs && (
          <div id="bug-list-panel" style={{ padding:'10px 18px', background:'var(--surface-2)', borderBottom:'1px solid var(--border)', display:'flex', flexWrap:'wrap', gap:5, flexShrink:0 }}>
            {bugs.map(b => (
              <span key={b.report_id} style={{
                fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20,
                background:'var(--surface-1)', color:'var(--info)',
                border:'1px solid var(--border)', fontFamily:'monospace',
              }}>
                {b.jira_key || b.report_id.slice(-10)} · {b.severity || '??'} · {b.errorType}
              </span>
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex:1, overflowY:'auto', padding:20 }} role="region" aria-label="Analysis results" aria-live="polite">

          {/* Rate limited */}
          {rateLimited && !loading && (
            <RateCountdown waitMs={rateLimited.waitMs} onReady={() => { setRateLimited(null); runAnalysis() }} />
          )}

          {/* Loading */}
          {loading && !rateLimited && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:'50px 20px', textAlign:'center' }}>
              <div style={{
                width:44, height:44, borderRadius:'50%',
                background:'linear-gradient(135deg,#8b5cf6,#6d28d9)',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <Sparkles size={20} color="#fff" className="anim-pulse" aria-hidden />
              </div>
              <div>
                <p style={{ fontWeight:600, color:'var(--tx-1)', marginBottom:6, fontSize:15 }}>
                  {attempt > 0 ? `Retry attempt ${attempt}…` : `Analysing ${bugs.length} bug${bugs.length > 1 ? 's' : ''}…`}
                </p>
                <p style={{ fontSize:12, color:'var(--tx-3)' }} aria-live="polite">{LOADING_MESSAGES[msgIdx]}</p>
                {elapsed > 8 && (
                  <p style={{ fontSize:11, color:'var(--tx-3)', marginTop:6 }}>
                    {elapsed}s elapsed — complex analysis may take up to {TIMEOUT_MS / 1000}s
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && !rateLimited && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'40px 20px', textAlign:'center' }}>
              <AlertTriangle size={32} color="var(--warning)" aria-hidden />
              <div>
                <p style={{ fontWeight:600, color:'var(--tx-1)', marginBottom:6 }}>Analysis failed</p>
                <p style={{ fontSize:13, color:'var(--tx-2)', maxWidth:420, lineHeight:1.6 }}>{error}</p>
                <p style={{ fontSize:12, color:'var(--tx-3)', marginTop:8 }}>
                  Ensure the Gemini API key is configured on the server (set <code style={{ background:'var(--surface-2)', padding:'1px 5px', borderRadius:3, color:'var(--info)' }}>GEMINI_API_KEY_SERVER</code> in your deployment environment). Do NOT expose server keys as NEXT_PUBLIC_ variables.
                </p>
              </div>
              {!error.includes('cancelled') && (
                <button onClick={runAnalysis} style={{
                  display:'flex', alignItems:'center', gap:6,
                  background:'rgba(139,92,246,.10)', border:'1px solid rgba(139,92,246,.25)',
                  borderRadius:'var(--r-md)', padding:'8px 16px',
                  fontSize:13, fontWeight:600, color:'var(--purple)', cursor:'pointer',
                }}>
                  <Zap size={14} aria-hidden /> Try again
                </button>
              )}
            </div>
          )}

          {/* Result */}
          {analysis && !loading && (
            <article aria-label="Gemini analysis output">
              <RichText text={analysis} />
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
