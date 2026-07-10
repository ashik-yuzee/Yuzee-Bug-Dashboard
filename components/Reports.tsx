'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import type { ParsedBug, DashboardStats } from '@/lib/bugUtils'
import { computeStats } from '@/lib/bugUtils'
import { useGeminiQueue } from '@/hooks/useGeminiQueue'
import { Cloud, Sparkles, Loader2 } from 'lucide-react'
import geminiLimiter from '@/lib/rateLimiter'
import { withRetry } from '@/lib/withRetry'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Props { bugs: ParsedBug[]; stats: DashboardStats }
type TimeRange = 'today' | '7d' | '30d'

const P_COLORS: Record<string, string> = { P1: '#ef4444', P2: '#f59e0b', P3: '#3b82f6', P4: '#6b7280' }
const ROUTE_COLORS: Record<string, string> = { BACKEND: '#a78bfa', MOBILE: '#2dd4bf', WEB: '#4ade80', Unknown: '#6b7280' }

const MODULE_COLOR: Record<string, string> = {
  WEB: 'var(--module-web)', APP: 'var(--module-app)',
  BACKEND: 'var(--module-be)', INFRASTRUCTURE: 'var(--module-infra)',
}
const SOURCE_LABEL: Record<string, string> = {
  rollbar_auto: 'Rollbar (automated)', user_report: 'User reports', yuzee_app: 'Yuzee App',
}

const TOOLTIP_STYLE = {
  background: '#1c2128', border: '1px solid #30363d', borderRadius: 6, fontSize: 12, color: '#c9d1d9',
}

function filterByTime(bugs: ParsedBug[], range: TimeRange): ParsedBug[] {
  if (range === '30d') return bugs
  const cutoff = new Date()
  if (range === 'today') cutoff.setHours(0, 0, 0, 0)
  else cutoff.setDate(cutoff.getDate() - 7)
  return bugs.filter(b => new Date(b.created_at) >= cutoff)
}

function Bar2({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${max ? Math.round((value / max) * 100) : 0}%`, height: '100%', background: color, borderRadius: 4, minWidth: value > 0 ? 4 : 0, transition: 'width .4s ease' }} aria-hidden />
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

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 18 }}>
      <Section title={title} sub={sub} />
      {children}
    </div>
  )
}

/* ─── Volume trend data ─── */
function buildVolumeTrend(bugs: ParsedBug[], days: number) {
  const map: Record<string, Record<string, number>> = {}
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    map[k] = { P1: 0, P2: 0, P3: 0, P4: 0, other: 0 }
  }
  for (const b of bugs) {
    const d = (b.timestamp_utc || b.created_at).slice(0, 10)
    if (map[d]) {
      const sev = (b.severity || 'other') as string
      const key = ['P1', 'P2', 'P3', 'P4'].includes(sev) ? sev : 'other'
      map[d][key]++
    }
  }
  return Object.entries(map).map(([date, counts]) => ({
    date: date.slice(5), // MM-DD
    ...counts,
  }))
}

/* ─── Resolution rate per week ─── */
function buildResolutionRate(bugs: ParsedBug[], weeks: number) {
  const now = Date.now()
  const result: { week: string; rate: number; total: number; resolved: number }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = now - (w + 1) * 7 * 86_400_000
    const end   = now - w * 7 * 86_400_000
    const weekBugs = bugs.filter(b => {
      const t = new Date(b.timestamp_utc || b.created_at).getTime()
      return t >= start && t < end
    })
    const resolved = weekBugs.filter(b => b.status === 'complete' || b.status === 'resolved').length
    result.push({
      week: `W-${w === 0 ? 'now' : w}`,
      total: weekBugs.length,
      resolved,
      rate: weekBugs.length > 0 ? Math.round((resolved / weekBugs.length) * 100) : 0,
    })
  }
  return result
}

export default function Reports({ bugs }: Props) {
  // Captured once per mount rather than read live during render (react-hooks/purity).
  const [nowMs] = useState(() => Date.now())
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [aiSummary, setAiSummary]   = useState('')
  const [aiLoading, setAiLoading]   = useState(false)
  const [countdown, setCountdown]   = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const { stats: queueStats } = useGeminiQueue()

  const filtered = useMemo(() => filterByTime(bugs, timeRange), [bugs, timeRange])
  const s = useMemo(() => computeStats(filtered), [filtered])

  const volumeTrend = useMemo(() => buildVolumeTrend(filtered, timeRange === '30d' ? 30 : timeRange === '7d' ? 7 : 1), [filtered, timeRange])
  const resolutionRate = useMemo(() => buildResolutionRate(filtered, 12), [filtered])

  const componentData = useMemo(() => s.componentBreakdown.slice(0, 10).map(c => ({ name: c.component, value: c.count, p1: c.P1, p2: c.P2 })), [s.componentBreakdown])
  const routingData = useMemo(() => s.routingBreakdown.map(r => ({ name: r.routing, value: r.count })), [s.routingBreakdown])

  /* Avg triage time per day from gemini_queue */
  const triageTrend = useMemo(() => {
    if (!queueStats.recentItems.length) return []
    const map: Record<string, { sum: number; count: number }> = {}
    for (const item of queueStats.recentItems) {
      if (item.status !== 'processed' || !item.processed_at) continue
      const d = item.queued_at.slice(0, 10)
      const ms = new Date(item.processed_at).getTime() - new Date(item.queued_at).getTime()
      if (ms <= 0) continue
      if (!map[d]) map[d] = { sum: 0, count: 0 }
      map[d].sum += ms / 60_000
      map[d].count++
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, { sum, count }]) => ({
      date: date.slice(5),
      avgMin: Math.round((sum / count) * 10) / 10,
      target: 5,
    }))
  }, [queueStats.recentItems])

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
        const res = await fetch('/api/gemini', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortRef.current!.signal,
          body: JSON.stringify({ prompt })
        })
        if (!res.ok) throw new Error(`Gemini ${res.status}`)
        return res.json()
      }, { maxRetries: 2, signal: abortRef.current!.signal })
      setAiSummary(data?.text || data?.raw?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.')
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError')
        setAiSummary(`Error: ${(err as Error).message}`)
    } finally { setAiLoading(false) }
  }, [s, filtered, timeRange])

  const maxMod = s.moduleBreakdown[0]?.count || 1
  const maxEnv = s.environmentBreakdown[0]?.count || 1
  const maxSrc = s.sourceBreakdown[0]?.count || 1

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="anim-fadein">

      {/* Time range selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', fontWeight: 500, marginRight: 4 }}>Time range:</span>
        {(['today', '7d', '30d'] as TimeRange[]).map(r => (
          <button key={r} onClick={() => setTimeRange(r)} style={{ padding: '6px 14px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: timeRange === r ? 'var(--orange)' : 'var(--surface-2)', color: timeRange === r ? '#fff' : 'var(--tx-2)', border: `1px solid ${timeRange === r ? 'var(--orange)' : 'var(--border)'}`, transition: 'all .15s', cursor: 'pointer' }}>
            {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--tx-3)', marginLeft: 8 }}>{filtered.length} bugs in range</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Chart 1 — Bug Volume Trend */}
        <Card title="Bug Volume Trend" sub={`Bugs per day by severity · last ${timeRange === '30d' ? '30' : timeRange === '7d' ? '7' : '1'} day(s)`}>
          {volumeTrend.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={volumeTrend} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {['P1', 'P2', 'P3', 'P4'].map(sev => (
                  <Line key={sev} type="monotone" dataKey={sev} stroke={P_COLORS[sev]} strokeWidth={2} dot={false} name={sev} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Chart 2 — Mean Time to Triage + Chart 5 Resolution Rate side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card title="Mean Time to Triage" sub="Avg minutes from queued → processed · 5 min target">
            {triageTrend.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No processed queue items yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={triageTrend} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis dataKey="date" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} unit=" min" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val: unknown) => [`${val} min`, 'Avg triage']} />
                  <Line type="monotone" dataKey="avgMin" stroke="#58a6ff" strokeWidth={2} dot={false} name="Avg triage time" />
                  <Line type="monotone" dataKey="target" stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 3" dot={false} name="5 min target" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Resolution Rate Over Time" sub="% of bugs resolved · last 12 weeks">
            {resolutionRate.every(r => r.total === 0) ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={resolutionRate} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis dataKey="week" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val: unknown) => [`${val}%`, 'Resolution rate']} />
                  <Line type="monotone" dataKey="rate" stroke="#3fb950" strokeWidth={2} dot={false} name="Resolution %" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Chart 3 — Bugs by Component + Chart 4 — Routing Donut side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <Card title="Bugs by Component" sub="Top 10 components · last 30 days">
            {componentData.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No component data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={componentData} layout="vertical" margin={{ top: 4, right: 50, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#c9d1d9', fontSize: 11 }} width={80} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" fill="#f97316" radius={[0, 3, 3, 0]} name="Bugs" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="By Platform / Routing" sub="BACKEND · MOBILE · WEB · Unknown">
            {routingData.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No routing data</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={routingData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={3} dataKey="value">
                      {routingData.map((entry, i) => (
                        <Cell key={entry.name} fill={ROUTE_COLORS[entry.name] || `hsl(${i * 90}, 60%, 55%)`} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 }}>
                  {routingData.map(r => (
                    <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: ROUTE_COLORS[r.name] || '#666' }} />
                      <span style={{ fontSize: 11, color: 'var(--tx-2)' }}>{r.name}: {r.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Chart 6 — P1/P2 response time proxy */}
        <Card title="P1/P2 Bug Response Time" sub="Days from bug creation to Jira ticket · by week">
          {(() => {
            const p12 = filtered.filter(b => (b.severity === 'P1' || b.severity === 'P2') && b.jira_key && b.triaged_at)
            if (p12.length === 0) return <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No P1/P2 bugs with Jira tickets yet</p>
            const weeks: Record<string, { sum: number; count: number }> = {}
            for (const b of p12) {
              const t = new Date(b.timestamp_utc || b.created_at).getTime()
              const triagedAt = new Date(b.triaged_at!).getTime()
              const days = Math.round((triagedAt - t) / 86_400_000 * 10) / 10
              if (days < 0 || days > 30) continue
              const weeksAgo = Math.floor((nowMs - t) / (7 * 86_400_000))
              const wk = `W-${Math.min(weeksAgo, 11)}`
              if (!weeks[wk]) weeks[wk] = { sum: 0, count: 0 }
              weeks[wk].sum += days
              weeks[wk].count++
            }
            const data = Object.entries(weeks).sort(([a], [b]) => b.localeCompare(a)).map(([week, { sum, count }]) => ({
              week, avgDays: Math.round((sum / count) * 10) / 10,
            }))
            return (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis dataKey="week" tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} tickLine={false} axisLine={false} unit="d" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: unknown) => [`${v} days`, 'Avg response']} />
                  <Bar dataKey="avgDays" fill="#ef4444" radius={[3, 3, 0, 0]} name="Avg days to Jira" />
                </BarChart>
              </ResponsiveContainer>
            )
          })()}
        </Card>

        {/* Existing charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card title="By Module" sub="Classified by platform and source">
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
                          </div>
                        </div>
                        <Bar2 value={m.count} max={maxMod} color={col} />
                      </div>
                    )
                  })}
                </div>
            }
          </Card>

          <Card title="By Environment" sub="Where bugs are occurring">
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
                        <Bar2 value={e.count} max={maxEnv} color={col} />
                      </div>
                    )
                  })}
                </div>
            }
          </Card>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card title="By Source" sub="Origin of bug reports">
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
                        <Bar2 value={src.count} max={maxSrc} color={col} />
                      </div>
                    )
                  })}
                </div>
            }
          </Card>

          <Card title="Bug Classification by Type" sub="Error types across all modules">
            {s.errorTypeBreakdown.length === 0
              ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {s.errorTypeBreakdown.map(et => {
                    const pct = s.total > 0 ? Math.round((et.count / s.total) * 100) : 0
                    const maxEt = s.errorTypeBreakdown[0]?.count || 1
                    return (
                      <div key={et.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="font-mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-2)', minWidth: 80, flexShrink: 0 }}>{et.type}</span>
                        <Bar2 value={et.count} max={maxEt} color="var(--orange)" />
                        <span style={{ fontSize: 11, color: 'var(--tx-2)', minWidth: 22, textAlign: 'right' }}>{et.count}</span>
                        <span style={{ fontSize: 10, color: 'var(--tx-3)', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                      </div>
                    )
                  })}
                </div>
            }
          </Card>
        </div>

        {/* AI Standup Summary */}
        <div style={{ background: 'var(--surface-1)', border: '1px solid rgba(163,113,247,.25)', borderRadius: 'var(--r-lg)', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p className="font-brand" style={{ fontWeight: 600, fontSize: 14, color: 'var(--tx-1)', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={15} color="var(--purple)" aria-hidden /> AI Standup Summary
              </p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Gemini-generated report from current bug data</p>
            </div>
            <button onClick={generateSummary} disabled={aiLoading || countdown > 0}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 600, background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', border: 'none', cursor: (aiLoading || countdown > 0) ? 'not-allowed' : 'pointer', opacity: (aiLoading || countdown > 0) ? 0.55 : 1, transition: 'opacity .15s' }}>
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
              Click &quot;Generate Report&quot; to get an AI-generated standup summary.
            </p>
          )}
        </div>

        {/* Infrastructure placeholder */}
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
    </div>
  )
}
