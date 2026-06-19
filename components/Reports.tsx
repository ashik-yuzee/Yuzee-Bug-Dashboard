'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import type { ParsedBug, DashboardStats } from '@/lib/bugUtils'
import { computeStats } from '@/lib/bugUtils'
import { Cloud, Sparkles, Loader2 } from 'lucide-react'
import geminiLimiter from '@/lib/rateLimiter'
import { withRetry } from '@/lib/withRetry'

interface Props { bugs: ParsedBug[]; stats: DashboardStats }
type TimeRange = 'today' | '7d' | '30d'

const MODULE_COLOR: Record<string, string> = {
  WEB: 'var(--module-web)', APP: 'var(--module-app)',
  BACKEND: 'var(--module-be)', INFRASTRUCTURE: 'var(--module-infra)',
}
const SOURCE_LABEL: Record<string, string> = {
  rollbar_auto: 'Rollbar (automated)', user_report: 'User reports', yuzee_app: 'Yuzee App',
}

function filterByTime(bugs: ParsedBug[], range: TimeRange): ParsedBug[] {
  if (range === '30d') return bugs
  const cutoff = new Date()
  if (range === 'today') cutoff.setHours(0, 0, 0, 0)
  else cutoff.setDate(cutoff.getDate() - 7)
  return bugs.filter(b => new Date(b.created_at) >= cutoff)
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        width: `${max ? Math.round((value / max) * 100) : 0}%`, height: '100%',
        background: color, borderRadius: 4, minWidth: value > 0 ? 4 : 0, transition: 'width .4s ease',
      }} aria-hidden />
    </div>
  )
}

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p className="font-brand" style={{ fontWeight: 600, fontSize: 14, color: 'var(--tx-1)' }}>{title}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>{sub}</p>}
    </div>
  )
}

export default function Reports({ bugs }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [aiSummary, setAiSummary]   = useState('')
  const [aiLoading, setAiLoading]   = useState(false)
  const [countdown, setCountdown]   = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const filtered = useMemo(() => filterByTime(bugs, timeRange), [bugs, timeRange])
  const s = useMemo(() => computeStats(filtered), [filtered])

  const generateSummary = useCallback(async () => {
    const check = geminiLimiter.canRequest()
    if (!check.ok) {
      const secs = Math.ceil(check.waitMs / 1000)
      setCountdown(secs)
      const iv = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(iv); return 0 } return c - 1 }), 1000)
      return
    }
    geminiLimiter.record()
    setAiLoading(true); setAiSummary('')
    abortRef.current = new AbortController()

    const p3count    = filtered.filter(b => b.severity === 'P3').length
    const pending    = filtered.filter(b => b.status === 'pending').length
    const triaging   = filtered.filter(b => b.status === 'triaging').length
    const complete   = filtered.filter(b => b.status === 'complete').length
    const duplicates = filtered.filter(b => b.is_duplicate).length

    const rangeLabel = timeRange === 'today' ? 'today' : timeRange === '7d' ? 'the last 7 days' : 'the last 30 days'
    const modLines = s.moduleBreakdown.map(m => `  ${m.module}: ${m.count} bugs (P1:${m.P1}, P2:${m.P2})`).join('\n')
    const envLines = s.environmentBreakdown.map(e => `  ${e.env}: ${e.count} bugs`).join('\n')
    const etLines  = s.errorTypeBreakdown.slice(0, 6).map(e => `  ${e.type}: ${e.count}`).join('\n')

    const prompt = `You are a technical lead generating a brief engineering standup report for the Yuzee platform (Australian university admissions app).

Bug data for ${rangeLabel}:
- Total bugs: ${s.total}
- P1 critical: ${s.p1count}, P2 high: ${s.p2count}, P3 medium: ${p3count}
- Open/pending: ${pending}, Triaging: ${triaging}, Resolved: ${complete}
- Duplicates identified: ${duplicates}

By module:
${modLines || '  No data'}

By environment:
${envLines || '  No data'}

Top error types:
${etLines || '  No data'}

Write a concise standup-style report (3-5 sentences) covering:
1. Current bug situation summary
2. Most critical areas needing attention (P1/P2)
3. Any patterns or trends
4. Recommended immediate actions

Be specific, actionable, and professional. No fluff.`

    try {
      const data = await withRetry(async () => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.NEXT_PUBLIC_GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortRef.current!.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
        )
        if (!res.ok) throw new Error(`Gemini ${res.status}`)
        return res.json()
      }, { maxRetries: 2, signal: abortRef.current!.signal })
      setAiSummary(data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.')
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError')
        setAiSummary(`Error: ${(err as Error).message}`)
    } finally { setAiLoading(false) }
  }, [s, filtered, timeRange])

  const userBugs = filtered.filter(b => b.source === 'user_report' || b.source === 'yuzee_app')

  const topPages = useMemo(() => {
    const map: Record<string, number> = {}
    for (const b of userBugs) {
      const page = b.pageUrl || b.location
      if (page) map[page] = (map[page] || 0) + 1
    }
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 8)
  }, [userBugs])

  const topReporters = useMemo(() => {
    const map: Record<string, number> = {}
    for (const b of userBugs) {
      if (b.reporter_email) map[b.reporter_email] = (map[b.reporter_email] || 0) + 1
    }
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 5)
  }, [userBugs])

  const maxMod = s.moduleBreakdown[0]?.count || 1
  const maxEnv = s.environmentBreakdown[0]?.count || 1
  const maxSrc = s.sourceBreakdown[0]?.count || 1
  const maxEt  = s.errorTypeBreakdown[0]?.count || 1

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="anim-fadein">

      {/* ── Time range selector ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', fontWeight: 500, marginRight: 4 }}>Time range:</span>
        {(['today', '7d', '30d'] as TimeRange[]).map(r => (
          <button key={r} onClick={() => setTimeRange(r)} style={{
            padding: '6px 14px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500,
            background: timeRange === r ? 'var(--orange)' : 'var(--surface-2)',
            color: timeRange === r ? '#fff' : 'var(--tx-2)',
            border: `1px solid ${timeRange === r ? 'var(--orange)' : 'var(--border)'}`,
            transition: 'all .15s', cursor: 'pointer',
          }}>
            {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--tx-3)', marginLeft: 8 }}>{filtered.length} bugs in range</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* ── By Module ────────────────────────────────────── */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
          <Section title="By Module" sub="Classified by platform and source" />
          {s.moduleBreakdown.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data for this period</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {s.moduleBreakdown.map(m => {
                  const col = MODULE_COLOR[m.module] || 'var(--orange)'
                  return (
                    <div key={m.module}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 12, background: `${col}22`, color: col, border: `1px solid ${col}44` }}>{m.module}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{m.count}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                          {m.P1 > 0 && <span style={{ color: 'var(--p1)', fontWeight: 600 }}>P1:{m.P1}</span>}
                          {m.P2 > 0 && <span style={{ color: 'var(--p2)', fontWeight: 600 }}>P2:{m.P2}</span>}
                          {m.P3 > 0 && <span style={{ color: 'var(--tx-3)' }}>P3:{m.P3}</span>}
                        </div>
                      </div>
                      <Bar value={m.count} max={maxMod} color={col} />
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* ── By Environment ───────────────────────────────── */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
          <Section title="By Environment" sub="Where bugs are occurring" />
          {s.environmentBreakdown.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No environment data</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {s.environmentBreakdown.map(e => {
                  const isProd = e.env === 'production'
                  const col = isProd ? 'var(--danger)' : e.env === 'kubernetes' ? 'var(--warning)' : 'var(--tx-3)'
                  const pct = s.total > 0 ? Math.round((e.count / s.total) * 100) : 0
                  return (
                    <div key={e.env}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, color: col, fontWeight: isProd ? 600 : 400 }}>{e.env}</span>
                          {isProd && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--danger-dim)', color: 'var(--danger)' }}>PROD</span>}
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>{e.count} <span style={{ color: 'var(--tx-3)' }}>({pct}%)</span></span>
                      </div>
                      <Bar value={e.count} max={maxEnv} color={col} />
                    </div>
                  )
                })}
              </div>
          }
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* ── By Source ────────────────────────────────────── */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
          <Section title="By Source" sub="Origin of bug reports" />
          {s.sourceBreakdown.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {s.sourceBreakdown.map(src => {
                  const col = src.source === 'rollbar_auto' ? 'var(--info)' : src.source === 'user_report' ? 'var(--warning)' : 'var(--success)'
                  return (
                    <div key={src.source}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--tx-1)' }}>{SOURCE_LABEL[src.source] || src.source}</span>
                        <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>{src.count} <span style={{ color: 'var(--tx-3)' }}>({src.percentage}%)</span></span>
                      </div>
                      <Bar value={src.count} max={maxSrc} color={col} />
                    </div>
                  )
                })}
              </div>
          }
        </div>

        {/* ── Where complaints come from ───────────────────── */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
          <Section title="Where Complaints Come From" sub={`${userBugs.length} user-submitted report${userBugs.length !== 1 ? 's' : ''}`} />
          {topPages.length === 0 && topReporters.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No user-reported bugs in this period</p>
            : <>
                {topPages.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Top pages / endpoints</p>
                    {topPages.map(([page, count]) => (
                      <div key={page} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                        <span className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{page}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-1)', flexShrink: 0 }}>{count}</span>
                      </div>
                    ))}
                  </>
                )}
                {topReporters.length > 0 && (
                  <>
                    <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 14, marginBottom: 8 }}>Top reporters</p>
                    {topReporters.map(([email, count]) => {
                      const anon = email.replace(/(.{2}).*(@.*)/, '$1***$2')
                      return (
                        <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--tx-2)' }}>{anon}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-1)' }}>{count}</span>
                        </div>
                      )
                    })}
                  </>
                )}
              </>
          }
        </div>
      </div>

      {/* ── Bug classification by type ───────────────────────── */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18, marginBottom: 16 }}>
        <Section title="Bug Classification by Type" sub="Error types across all modules" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {s.errorTypeBreakdown.map(et => {
            const pct = s.total > 0 ? Math.round((et.count / s.total) * 100) : 0
            return (
              <div key={et.type} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span className="font-mono" style={{ fontSize: 12, color: 'var(--tx-1)', fontWeight: 600 }}>{et.type}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--tx-1)', lineHeight: 1 }}>{et.count}</span>
                </div>
                <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--orange)', borderRadius: 3, minWidth: et.count > 0 ? 3 : 0 }} aria-hidden />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{pct}% of total</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {et.P1 > 0 && <span style={{ fontSize: 10, color: 'var(--p1)', fontWeight: 600 }}>P1:{et.P1}</span>}
                    {et.P2 > 0 && <span style={{ fontSize: 10, color: 'var(--p2)', fontWeight: 600 }}>P2:{et.P2}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── AI Standup Summary ──────────────────────────────── */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid rgba(163,113,247,.25)', borderRadius: 'var(--r-lg)', padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <p className="font-brand" style={{ fontWeight: 600, fontSize: 14, color: 'var(--tx-1)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Sparkles size={15} color="var(--purple)" aria-hidden /> AI Standup Summary
            </p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Gemini-generated report from current bug data</p>
          </div>
          <button
            onClick={generateSummary}
            disabled={aiLoading || countdown > 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 16px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 600,
              background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff',
              border: 'none', cursor: (aiLoading || countdown > 0) ? 'not-allowed' : 'pointer',
              opacity: (aiLoading || countdown > 0) ? 0.55 : 1, transition: 'opacity .15s',
            }}
          >
            {aiLoading ? <><Loader2 size={13} className="anim-spin" /> Generating…</> :
             countdown > 0 ? `Wait ${countdown}s` :
             <><Sparkles size={13} /> Generate Report</>}
          </button>
        </div>
        {aiSummary && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(163,113,247,.15)', borderRadius: 'var(--r-md)', padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiSummary}</p>
          </div>
        )}
        {!aiSummary && !aiLoading && (
          <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>
            Click "Generate Report" to get an AI-generated standup summary based on the current {timeRange === 'today' ? "today's" : timeRange === '7d' ? '7-day' : '30-day'} data.
          </p>
        )}
      </div>

      {/* ── Infrastructure placeholder ───────────────────────── */}
      <div style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)', borderRadius: 'var(--r-lg)', padding: 18, opacity: 0.75 }}>
        <Section title="Infrastructure Issues" sub="AWS CloudWatch metrics and deployment correlation" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14 }}>
          <Cloud size={20} color="var(--tx-3)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <div>
            <p style={{ fontSize: 13, color: 'var(--tx-2)', marginBottom: 6, lineHeight: 1.5 }}>
              AWS CloudWatch metrics, EC2/ECS health, and deployment correlation will appear here once AWS credentials are configured.
            </p>
            <p className="font-mono" style={{ fontSize: 11, color: 'var(--tx-3)' }}>
              🔌 Awaiting: AWS_ACCESS_KEY_ID · AWS_SECRET_ACCESS_KEY · AWS_REGION · CLOUDWATCH_LOG_GROUP
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
