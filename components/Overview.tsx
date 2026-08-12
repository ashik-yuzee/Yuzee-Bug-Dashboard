'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { DashboardStats, ParsedBug } from '@/lib/bugUtils'
import { computeStats } from '@/lib/bugUtils'
import { useGeminiQueue } from '@/hooks/useGeminiQueue'
import { useInternalTickets } from '@/hooks/useInternalTickets'
import { TICKET_STATUSES } from '@/lib/tickets'
import JiraSpacesPanel from './JiraSpacesPanel'
import PageInfo from './ui/PageInfo'
import {
  AlertTriangle, TrendingUp, Zap, Info, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, CheckCircle2,
  Radio, Cpu, Activity, Cloud, Globe, Server, Smartphone,
  Database, Package, BarChart2, Sparkles,
  Link, XCircle, Ticket as TicketIcon,
} from 'lucide-react'
import { ROUTING_COLORS, jiraUrl } from '@/lib/utils'

/* ─── design tokens (mirrors globals.css) ───────────────────────── */
const SEV: Record<string, string> = {
  P1: '#ff7b72', P2: '#e3b341', P3: '#58a6ff', P4: '#8b949e',
}
const CHART_FILL: Record<string, string> = {
  P1: '#ef4444', P2: '#f59e0b', P3: '#3b82f6', P4: '#6b7280', none: '#21262d',
}

type DayRange = 7 | 14 | 30
type RangeFilter = 'week' | 'month' | '3months' | 'year' | 'all'

const RANGE_LABELS: Record<RangeFilter, string> = {
  week: 'This Week', month: 'This Month', '3months': 'Last 3 Months', year: 'This Year', all: 'All Time',
}

function rangeCutoff(range: RangeFilter, nowMs: number): Date | null {
  const now = new Date(nowMs)
  switch (range) {
    case 'week': {
      const d = new Date(now)
      const dayIdx = (d.getDay() + 6) % 7 // Monday-start week
      d.setDate(d.getDate() - dayIdx)
      d.setHours(0, 0, 0, 0)
      return d
    }
    case 'month':    return new Date(now.getFullYear(), now.getMonth(), 1)
    case '3months':  return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
    case 'year':     return new Date(now.getFullYear(), 0, 1)
    case 'all':      return null
  }
}

/* ─── atoms ─────────────────────────────────────────────────────── */

function ProgressBar({ pct, color, h = 5 }: { pct: number; color: string; h?: number }) {
  return (
    <div style={{ flex: 1, height: h, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .4s ease', minWidth: pct > 0 ? 3 : 0 }} />
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.1em', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

/* ─── card shell ─────────────────────────────────────────────────── */
function Card({
  children, pad = 20, style, onClick,
}: {
  children: React.ReactNode
  pad?: number
  style?: React.CSSProperties
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => e.key === 'Enter' && onClick() : undefined}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: pad,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'border-color .15s, box-shadow .15s',
        ...style,
      }}
      onMouseEnter={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border-hi)'
        el.style.boxShadow = '0 0 0 1px var(--border-hi), 0 4px 20px rgba(0,0,0,.4)'
      } : undefined}
      onMouseLeave={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border)'
        el.style.boxShadow = 'none'
      } : undefined}
    >
      {children}
    </div>
  )
}

/* ─── KPI card ──────────────────────────────────────────────────── */
function Kpi({
  label, value, sub, accent, alert, warning, onClick, delta, trendGood, icon,
}: {
  label: string; value: string | number; sub?: string
  accent?: string; alert?: boolean; warning?: boolean
  onClick?: () => void
  delta?: { n: number; label: string }; trendGood?: boolean
  icon?: React.ReactNode
}) {
  const color = alert ? '#ef4444' : warning ? '#e3b341' : (accent ?? 'var(--tx-3)')
  const num   = alert ? '#ef4444' : warning ? '#e3b341' : (accent ?? 'var(--tx-1)')

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => e.key === 'Enter' && onClick() : undefined}
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderTop: `3px solid ${color}`,
        borderRadius: '0 0 10px 10px',
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : undefined,
        transition: 'border-color .12s, box-shadow .12s',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 108,
      }}
      onMouseEnter={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = `0 0 0 1px ${color}30, 0 4px 16px rgba(0,0,0,.35)`
      } : undefined}
      onMouseLeave={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = 'none'
      } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</span>
        {icon && <span style={{ color, opacity: .65 }}>{icon}</span>}
      </div>
      <span className="font-brand" style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: num, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.4 }}>{sub}</span>}
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {delta.n > 0
            ? <ArrowUpRight   size={10} color={trendGood ? '#3fb950' : '#ef4444'} />
            : delta.n < 0
            ? <ArrowDownRight size={10} color={trendGood ? '#ef4444' : '#3fb950'} />
            : <Minus          size={10} color="var(--tx-3)" />}
          <span style={{ fontSize: 10, fontWeight: 700, color: delta.n === 0 ? 'var(--tx-3)' : delta.n > 0 ? (trendGood ? '#3fb950' : '#ef4444') : (trendGood ? '#ef4444' : '#3fb950') }}>
            {delta.n > 0 ? '+' : ''}{delta.n}
          </span>
          <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{delta.label}</span>
        </div>
      )}
    </div>
  )
}

/* ─── chart tooltip ─────────────────────────────────────────────── */
function ChartTip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; fill: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  const rows  = payload.filter(p => p.value > 0).reverse()
  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>
      <p style={{ fontWeight: 700, color: '#e6edf3', marginBottom: 8, fontSize: 11 }}>{label} — <span style={{ color: '#f97316' }}>{total} bug{total !== 1 ? 's' : ''}</span></p>
      {rows.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#8b949e', minWidth: 26 }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.fill }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/* ─── distribution mini-card ────────────────────────────────────── */
function DistCard({ title, rows, onRowClick }: {
  title: string
  rows: { label: string; value: number; max: number; color: string; badge?: string }[]
  onRowClick?: (label: string) => void
}) {
  return (
    <Card pad={16}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div
            key={r.label}
            onClick={onRowClick ? () => onRowClick(r.label) : undefined}
            title={onRowClick ? `View ${r.label} bugs →` : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onRowClick ? 'pointer' : 'default', borderRadius: 6, margin: '-2px -4px', padding: '2px 4px', transition: 'background .12s' }}
            onMouseEnter={onRowClick ? e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' : undefined}
            onMouseLeave={onRowClick ? e => (e.currentTarget as HTMLElement).style.background = 'transparent' : undefined}
          >
            <span style={{ width: 56, fontSize: 11, color: r.color, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <ProgressBar pct={r.max > 0 ? (r.value / r.max) * 100 : 0} color={r.color} />
            <span style={{ fontSize: 11, color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 24, textAlign: 'right' }}>{r.value}</span>
            {r.badge && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>{r.badge}</span>}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ─── integration status card ───────────────────────────────────── */
function IntegCard({ name, icon, color, pct, detail, comingSoon }: {
  name: string; icon: React.ReactNode; color: string
  pct: number; detail: string; comingSoon?: boolean
}) {
  const live = !comingSoon && pct > 0
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 12,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: 3, background: comingSoon ? 'var(--border)' : live ? color : '#374151' }} />
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: comingSoon ? 'var(--tx-3)' : live ? color : '#4b5563' }}>{icon}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: comingSoon ? 'var(--tx-3)' : 'var(--tx-1)' }}>{name}</span>
          </div>
          {comingSoon
            ? <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 99 }}>SOON</span>
            : <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? color : '#374151', boxShadow: live ? `0 0 6px ${color}88` : 'none' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: live ? color : '#6b7280', letterSpacing: '.05em' }}>{live ? 'LIVE' : 'OFF'}</span>
              </span>
          }
        </div>
        {!comingSoon && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span className="font-brand" style={{ fontSize: 26, fontWeight: 800, color: live ? color : '#4b5563', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
              <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>coverage</span>
            </div>
            <ProgressBar pct={pct} color={live ? color : '#374151'} h={4} />
            <p style={{ fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.5, marginTop: 2 }}>{detail}</p>
          </>
        )}
        {comingSoon && (
          <p style={{ fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.5 }}>Set <code style={{ fontSize: 10, background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3, color: 'var(--tx-2)' }}>posthog_session_url</code> in n8n to activate session replay links</p>
        )}
      </div>
    </div>
  )
}

/* ─── pipeline widget ───────────────────────────────────────────── */
function PipelineWidget() {
  const { stats, loading, error, refresh } = useGeminiQueue()
  const requeueAll = async () => { await fetch('/api/requeue-bug?all=true', { method: 'PATCH' }); refresh() }
  const total = stats.queued + stats.processed + stats.stale + stats.failed
  const pct   = total > 0 ? Math.round((stats.processed / total) * 100) : 0

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>AI Triage Pipeline</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>gemini_queue · last 7 days</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!loading && stats.avgMinutes !== null && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 99, color: stats.avgMinutes > 5 ? '#e3b341' : '#3fb950', background: stats.avgMinutes > 5 ? 'rgba(227,179,65,.10)' : 'rgba(63,185,80,.10)', border: `1px solid ${stats.avgMinutes > 5 ? 'rgba(227,179,65,.25)' : 'rgba(63,185,80,.25)'}` }}>
              avg {stats.avgMinutes} min
            </span>
          )}
          <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--tx-3)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 68, borderRadius: 8 }} />)}
        </div>
      ) : error ? (
        <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 14 }}>
            {([['Queued','#3b82f6',stats.queued],['Processed','#3fb950',stats.processed],['Stale','#6b7280',stats.stale],['Failed','#ef4444',stats.failed]] as [string,string,number][]).map(([lbl,col,n]) => (
              <div key={lbl} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', borderTop: `2px solid ${col}` }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: col, lineHeight: 1, marginBottom: 3, fontVariantNumeric: 'tabular-nums' }}>{n}</p>
                <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{lbl}</p>
              </div>
            ))}
          </div>
          {total > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Throughput</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#3fb950' }}>{pct}% processed</span>
              </div>
              <ProgressBar pct={pct} color="#3fb950" h={5} />
            </div>
          )}
          {stats.stuckItems.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.22)', borderRadius: 8, padding: '9px 12px' }}>
              <AlertTriangle size={13} color="#e3b341" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#e3b341', flex: 1 }}>{stats.stuckItems.length} bug{stats.stuckItems.length > 1 ? 's' : ''} queued &gt;30 min</span>
              <button onClick={requeueAll} style={{ fontSize: 11, fontWeight: 600, color: '#e3b341', background: 'rgba(227,179,65,.15)', border: '1px solid rgba(227,179,65,.3)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                Re-queue all →
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={12} color="#3fb950" />
              <span style={{ fontSize: 11, color: '#3fb950' }}>Pipeline healthy — no stuck items</span>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/* ─── internal tickets widget ────────────────────────────────────── */
function TicketsWidget({ onNavigate }: { onNavigate?: () => void }) {
  const { tickets, loading, error } = useInternalTickets()
  // Only YSDT-prefixed Jira tickets, open only (not done/closed)
  const ysdtOpen = tickets.filter(t => {
    const key = t.jira_key ?? t.ticket_key ?? ''
    if (!key.startsWith('YSDT-')) return false
    const st = (t.jira_status ?? t.status ?? '').toLowerCase()
    return st !== 'done' && st !== 'closed' && st !== 'resolved'
  })
  const counts = TICKET_STATUSES.map(s => ({ ...s, n: ysdtOpen.filter(t => {
    const st = (t.jira_status ?? t.status ?? '').toLowerCase()
    if (s.id === 'todo') return st === 'to do' || st === 'todo' || st === 'open' || t.status === s.id
    if (s.id === 'in_progress') return st === 'in progress' || st === 'in-progress' || t.status === s.id
    if (s.id === 'in_review') return st === 'in review' || st === 'in-review' || t.status === s.id
    return t.status === s.id
  }).length }))
  const open = ysdtOpen.length

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>YSDT Open Tickets</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Jira YSDT project · open only</p>
        </div>
        <button onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <TicketIcon size={11} /> View board →
        </button>
      </div>
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {[0,1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 8 }} />)}
        </div>
      ) : error ? (
        <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      ) : ysdtOpen.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No open YSDT tickets found.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
            {counts.map(c => (
              <div key={c.id} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', borderTop: `2px solid ${c.color}` }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: c.color, lineHeight: 1, marginBottom: 3, fontVariantNumeric: 'tabular-nums' }}>{c.n}</p>
                <p style={{ fontSize: 9.5, color: 'var(--tx-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.label}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>{open} open YSDT ticket{open === 1 ? '' : 's'} · {tickets.filter(t => (t.jira_key ?? t.ticket_key ?? '').startsWith('YSDT-')).length} total</p>
        </>
      )}
    </Card>
  )
}

/* ─── posthog overview widget ───────────────────────────────────── */
interface PHSnap { dau: number; mau: number; sessions: number; bounceRate: number; avgSessionSec: number; topCustomEvents: { event: string; count: number }[] }

function PostHogOverviewWidget({ onNavigate }: { onNavigate?: () => void }) {
  const [data, setData]       = useState<PHSnap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/posthog/analytics?type=overview')
      .then(r => r.json())
      .then(j => { if (!cancelled) { if (j.error) setError(j.error); else setData(j as PHSnap) } })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const fmtN = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
  const fmtDur = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(139,92,246,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={13} color="#8b5cf6" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>PostHog Analytics</p>
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 3, marginLeft: 32 }}>Live product metrics · click for full analytics</p>
        </div>
        {onNavigate && (
          <button onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#8b5cf6', background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.3)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Full analytics →
          </button>
        )}
      </div>

      {error ? (
        <p style={{ fontSize: 11, color: 'var(--danger)', padding: '8px 12px', background: 'rgba(239,68,68,.08)', borderRadius: 6 }}>{error}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
          {[
            { label: 'DAU', value: loading ? '…' : fmtN(data?.dau ?? 0), color: '#8b5cf6', sub: 'today' },
            { label: 'MAU', value: loading ? '…' : fmtN(data?.mau ?? 0), color: '#14b8a6', sub: 'this month' },
            { label: 'Sessions', value: loading ? '…' : fmtN(data?.sessions ?? 0), color: '#3b82f6', sub: 'today' },
            { label: 'Bounce', value: loading ? '…' : `${data?.bounceRate ?? 0}%`, color: data && data.bounceRate > 65 ? '#ef4444' : '#22c55e', sub: '7-day rate' },
            { label: 'Avg Session', value: loading ? '…' : fmtDur(data?.avgSessionSec ?? 0), color: '#f97316', sub: '7-day avg' },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', borderTop: `2px solid ${k.color}` }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{k.label}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: k.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 2 }}>{k.value}</p>
              <p style={{ fontSize: 9, color: 'var(--tx-3)' }}>{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data?.topCustomEvents && data.topCustomEvents.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Top events (7d)</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.topCustomEvents.slice(0, 4).map(e => (
              <span key={e.event} style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 9px', color: 'var(--tx-2)' }}>
                {e.event} <strong style={{ color: '#8b5cf6' }}>{fmtN(e.count)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/* ─── window width hook ──────────────────────────────────────────── */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return width
}

/* ─── insight styles (module-level, not inside render) ───────────── */
const ISTYLE: Record<string, { border: string; bg: string; col: string }> = {
  critical: { border: 'rgba(255,123,114,.22)', bg: 'rgba(255,123,114,.06)', col: 'var(--danger)'  },
  warning:  { border: 'rgba(227,179,65,.22)',  bg: 'rgba(227,179,65,.06)',  col: 'var(--warning)' },
  action:   { border: 'rgba(163,113,247,.22)', bg: 'rgba(163,113,247,.06)', col: 'var(--purple)'  },
  info:     { border: 'rgba(88,166,255,.18)',  bg: 'rgba(88,166,255,.06)',  col: 'var(--info)'    },
}

/* ─── animated KPI tile ─────────────────────────────────────────── */
function KpiTile({ label, value, valueSuffix, sub, color, icon, onClick, delta, trendGood, animDelay = 0 }: {
  label: string; value: number; valueSuffix?: string; sub?: string; color: string
  icon?: React.ReactNode; onClick?: () => void
  delta?: { n: number; label: string }; trendGood?: boolean; animDelay?: number
}) {
  const [displayed, setDisplayed] = useState(0)
  useEffect(() => {
    if (value === 0) { setDisplayed(0); return }
    const start = Date.now()
    const duration = 700
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplayed(Math.round(eased * value))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [value])
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '18px 20px', cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color .18s, box-shadow .18s, transform .18s',
        animationDelay: `${animDelay}ms`,
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = color + '60'
        el.style.boxShadow = `0 0 0 1px ${color}25, 0 8px 24px rgba(0,0,0,.4)`
        el.style.transform = 'translateY(-2px)'
      } : undefined}
      onMouseLeave={onClick ? e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border)'
        el.style.boxShadow = 'none'
        el.style.transform = 'none'
      } : undefined}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '14px 14px 0 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.09em' }}>{label}</span>
        {icon && <span style={{ color: color + 'aa', opacity: .8 }}>{icon}</span>}
      </div>
      <div className="font-brand" style={{ fontSize: 38, fontWeight: 800, color: value === 0 ? 'var(--tx-3)' : color, lineHeight: 1, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
        {displayed.toLocaleString()}{valueSuffix ?? ''}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {delta.n > 0
            ? <ArrowUpRight size={10} color={trendGood ? '#3fb950' : '#ef4444'} />
            : delta.n < 0
            ? <ArrowDownRight size={10} color={trendGood ? '#ef4444' : '#3fb950'} />
            : <Minus size={10} color="var(--tx-3)" />}
          <span style={{ fontSize: 10, fontWeight: 700, color: delta.n === 0 ? 'var(--tx-3)' : delta.n > 0 ? (trendGood ? '#3fb950' : '#ef4444') : (trendGood ? '#ef4444' : '#3fb950') }}>
            {delta.n > 0 ? '+' : ''}{delta.n}
          </span>
          <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{delta.label}</span>
        </div>
      )}
    </div>
  )
}

/* ─── staggered animated progress bar ───────────────────────────── */
function AnimBar({ label, value, max, color, onClick, delay = 0, badge }: {
  label: string; value: number; max: number; color: string
  onClick?: () => void; delay?: number; badge?: string
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMounted(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onClick ? 'pointer' : 'default',
        padding: '4px 6px', borderRadius: 7, margin: '0 -6px', transition: 'background .12s' }}
      onMouseEnter={onClick ? e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3)' : undefined}
      onMouseLeave={onClick ? e => (e.currentTarget as HTMLElement).style.background = 'transparent' : undefined}
    >
      <span style={{ width: 68, fontSize: 11, color, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          width: mounted ? `${pct}%` : '0%', height: '100%', background: color, borderRadius: 99,
          transition: 'width .55s cubic-bezier(0.34,1.2,0.64,1)',
          minWidth: value > 0 && mounted ? 4 : 0,
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', flexShrink: 0, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {badge && <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>{badge}</span>}
    </div>
  )
}

/* ─── section heading with count + optional action link ──────────── */
function SectionHead({ label, count, action }: { label: string; count?: number; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--surface-2)', color: 'var(--tx-3)', border: '1px solid var(--border)' }}>{count}</span>
      )}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      {action && (
        <button onClick={action.onClick} style={{ fontSize: 11, color: 'var(--info)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, flexShrink: 0 }}>
          {action.label} →
        </button>
      )}
    </div>
  )
}

/* ─── main ──────────────────────────────────────────────────────── */
export default function Overview({ stats: _globalStats, bugs: allBugs, includeLegacy, onNavigateToBugs, onNavigateToClusters, onNavigateToTickets, onNavigateToPostHog }: {
  stats: DashboardStats
  bugs: ParsedBug[]
  includeLegacy: boolean
  onNavigateToBugs: (f: Record<string, string[] | string>) => void
  onNavigateToClusters?: () => void
  onNavigateToTickets?: () => void
  onNavigateToPostHog?: () => void
}) {
  void _globalStats

  const windowWidth = useWindowWidth()
  const wide = windowWidth >= 1024

  const [nowMs] = useState(() => Date.now())
  const [dayRange, setDayRange] = useState<DayRange>(30)

  const [range, setRange] = useState<RangeFilter>(() => includeLegacy ? 'all' : 'month')
  const [prevIncludeLegacy, setPrevIncludeLegacy] = useState(includeLegacy)
  if (includeLegacy !== prevIncludeLegacy) {
    setPrevIncludeLegacy(includeLegacy)
    setRange(includeLegacy ? 'all' : 'month')
  }

  const rangeStart = useMemo(() => rangeCutoff(range, nowMs), [range, nowMs])

  const [activeSevs, setActiveSevs]     = useState<Set<string>>(new Set())
  const [activeRoutes, setActiveRoutes] = useState<Set<string>>(new Set())

  const toggleSev = (s: string) => setActiveSevs(prev => {
    const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n
  })
  const toggleRoute = (r: string) => setActiveRoutes(prev => {
    const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n
  })

  const bugs = useMemo(() => {
    let b = rangeStart ? allBugs.filter(b => new Date(b.timestamp_utc || b.created_at) >= rangeStart) : allBugs
    if (activeSevs.size > 0)   b = b.filter(x => x.severity   && activeSevs.has(x.severity))
    if (activeRoutes.size > 0) b = b.filter(x => x.routingToken && activeRoutes.has(x.routingToken))
    return b
  }, [allBugs, rangeStart, activeSevs, activeRoutes])

  const stats = useMemo(() => computeStats(bugs), [bugs])

  const cutoff    = new Date(nowMs - dayRange * 86_400_000).toISOString().slice(0, 10)
  // Fill in zero-value days so the chart covers the full window with no whitespace
  const chartDays = useMemo(() => {
    const byDate = new Map(stats.dailyVolume.map(d => [d.date, d]))
    const days: typeof stats.dailyVolume = []
    for (let i = dayRange - 1; i >= 0; i--) {
      const date = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10)
      if (date >= cutoff) {
        days.push(byDate.get(date) ?? {
          date,
          label: new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
          P1: 0, P2: 0, P3: 0, P4: 0, none: 0, total: 0,
        })
      }
    }
    return days
  }, [stats.dailyVolume, dayRange, cutoff, nowMs])

  const dateRange = useMemo(() => {
    if (!stats.dailyVolume.length) return ''
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    return `${fmt(stats.dailyVolume[0].date)} – ${fmt(stats.dailyVolume[stats.dailyVolume.length - 1].date)}`
  }, [stats.dailyVolume])

  const todayStr     = new Date(nowMs).toISOString().slice(0, 10)
  const yesterdayStr = new Date(nowMs - 86_400_000).toISOString().slice(0, 10)
  const todayCount   = useMemo(() => bugs.filter(b => (b.timestamp_utc || b.created_at).slice(0,10) === todayStr).length,     [bugs, todayStr])
  const yestCount    = useMemo(() => bugs.filter(b => (b.timestamp_utc || b.created_at).slice(0,10) === yesterdayStr).length, [bugs, yesterdayStr])
  const dupRate      = stats.total > 0 ? Math.round((stats.duplicateCount / stats.total) * 100) : 0

  const integ = useMemo(() => {
    const n  = Math.max(bugs.length, 1)
    const rb = bugs.filter(b => b.rollbar_id || b.rollbarItemId).length
    const cw = bugs.filter(b => b.correlation_id).length
    const ai = bugs.filter(b => b.ai_summary).length
    const ur = bugs.filter(b => b.source === 'user_report' || b.source === 'yuzee_app').length
    return {
      total:       n,
      rollbar:     { pct: Math.round(rb/n*100), n: rb },
      cloudwatch:  { pct: Math.round(cw/n*100), n: cw },
      aiTriage:    { pct: Math.round(ai/n*100), n: ai },
      userReports: { pct: Math.round(ur/n*100), n: ur },
    }
  }, [bugs])

  const maxCluster = stats.errorClusters[0]?.count || 1

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ padding: '16px 20px 32px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1400, margin: '0 auto', width: '100%' }}>

        <PageInfo storageKey="overview">
          A live snapshot of the whole bug pipeline: KPIs, volume trends, severity/status/routing/component
          breakdowns, AI triage health, and auto-generated insights. Most charts and numbers are clickable — click a
          bar, slice, or KPI to jump to the matching bugs in Bug Reports.
        </PageInfo>

        {/* B ── STICKY FILTER BAR ────────────────────────────────── */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '8px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3, flexShrink: 0 }}>
            {(Object.keys(RANGE_LABELS) as RangeFilter[]).map(r => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                background: range === r ? 'var(--surface-1)' : 'transparent',
                color: range === r ? 'var(--tx-1)' : 'var(--tx-3)',
                border: range === r ? '1px solid var(--border)' : '1px solid transparent',
                cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
              }}>{RANGE_LABELS[r]}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
          {(['P1','P2','P3','P4'] as const).map(s => (
            <button key={s} onClick={() => toggleSev(s)} style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
              background: activeSevs.has(s) ? SEV[s]+'22' : 'transparent',
              color: activeSevs.has(s) ? SEV[s] : 'var(--tx-3)',
              border: `1px solid ${activeSevs.has(s) ? SEV[s]+'55' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
            }}>{s}</button>
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
          {(['BACKEND','MOBILE','WEB'] as const).map(rt => {
            const rc = ROUTING_COLORS[rt]
            return (
              <button key={rt} onClick={() => toggleRoute(rt)} style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                background: activeRoutes.has(rt) ? rc.bg : 'transparent',
                color: activeRoutes.has(rt) ? rc.color : 'var(--tx-3)',
                border: `1px solid ${activeRoutes.has(rt) ? rc.border : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
              }}>{rt}</button>
            )
          })}
          {(activeSevs.size > 0 || activeRoutes.size > 0) && (
            <button onClick={() => { setActiveSevs(new Set()); setActiveRoutes(new Set()) }} style={{
              marginLeft: 'auto', padding: '3px 9px', borderRadius: 6, fontSize: 11, color: 'var(--tx-3)',
              background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit',
            }}>Clear</button>
          )}
          <span style={{ marginLeft: activeSevs.size > 0 || activeRoutes.size > 0 ? 0 : 'auto', fontSize: 11, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 5px #3fb95088', display: 'inline-block' }} />
            {bugs.length} bug{bugs.length !== 1 ? 's' : ''} in view
          </span>
        </div>

        {/* C ── HERO KPI TILES ──────────────────────────────────── */}
        <section>
          <SectionHead label="Key Metrics" count={bugs.length} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            <KpiTile label="Total Bugs"   value={stats.total}            color="var(--tx-2)"    icon={<BarChart2 size={15}/>}      animDelay={0}   sub={dateRange} />
            <KpiTile label="P1 Critical"  value={stats.p1count}          color="#ef4444"         icon={<AlertTriangle size={15}/>}  animDelay={60}  sub="needs immediate action" onClick={() => onNavigateToBugs({ severity: ['P1'] })} delta={{ n: todayCount - yestCount, label: 'vs yesterday' }} />
            <KpiTile label="P2 High"      value={stats.p2count}          color="#f59e0b"         icon={<TrendingUp size={15}/>}     animDelay={120} sub="high priority" onClick={() => onNavigateToBugs({ severity: ['P2'] })} />
            <KpiTile label="Resolved"     value={stats.resolvedRate}     color="#3fb950"         icon={<CheckCircle2 size={15}/>}   animDelay={180} valueSuffix="%" sub={`${bugs.filter(b => b.status === 'complete').length} complete`} trendGood />
            <KpiTile label="Needs Review" value={stats.needsHumanReview} color="#a371f7"         icon={<Sparkles size={15}/>}       animDelay={240} sub="low-confidence triage" onClick={() => onNavigateToBugs({ labels: ['needs-human-review'] })} />
            <KpiTile label="Jira Gap"     value={stats.pendingNoJira}    color={stats.pendingNoJira > 0 ? '#f59e0b' : 'var(--tx-3)'} icon={<XCircle size={15}/>} animDelay={300} sub="bugs without ticket" onClick={() => onNavigateToBugs({ hasJira: 'no' })} />
            <KpiTile label="Duplicates"   value={stats.duplicateCount}   color="#6b7280"         icon={<Link size={15}/>}           animDelay={360} sub={`${dupRate}% of total`} onClick={onNavigateToClusters} />
            <KpiTile label="Jira Pending" value={stats.jiraPendingCount} color={stats.jiraPendingCount > 0 ? '#f59e0b' : 'var(--tx-3)'} icon={<TicketIcon size={15}/>} animDelay={420} sub="ticket creation failed" onClick={() => onNavigateToBugs({ jiraPending: 'yes' })} />
          </div>
        </section>

        {/* D ── TWO-COLUMN MAIN GRID ────────────────────────────── */}
        <section>
          <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1fr) minmax(0,380px)' : '1fr', gap: 16 }}>

            {/* LEFT column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

              {/* Daily Volume Chart */}
              <Card pad={20}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 2 }}>Daily Bug Volume</p>
                    <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>Stacked by severity · click a bar to filter</p>
                  </div>
                  <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
                    {([7, 14, 30] as DayRange[]).map(r => (
                      <button key={r} onClick={() => setDayRange(r)} style={{
                        padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                        background: dayRange === r ? 'var(--surface-1)' : 'transparent',
                        color: dayRange === r ? 'var(--tx-1)' : 'var(--tx-3)',
                        border: dayRange === r ? '1px solid var(--border)' : '1px solid transparent',
                        cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
                      }}>{r}d</button>
                    ))}
                  </div>
                </div>
                {chartDays.length === 0 ? (
                  <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data for this date range</p>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={chartDays} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                        <defs>
                          <linearGradient id="gP1"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#ef4444" stopOpacity={0.6}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/></linearGradient>
                          <linearGradient id="gP2"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.6}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05}/></linearGradient>
                          <linearGradient id="gP3"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.6}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/></linearGradient>
                          <linearGradient id="gP4"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#6b7280" stopOpacity={0.5}/><stop offset="95%" stopColor="#6b7280" stopOpacity={0.05}/></linearGradient>
                          <linearGradient id="gNone" x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#3d444d" stopOpacity={0.4}/><stop offset="95%" stopColor="#3d444d" stopOpacity={0.02}/></linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(48,54,61,.5)" strokeDasharray="3 6" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7d8590' }} axisLine={false} tickLine={false} interval={dayRange === 7 ? 0 : dayRange === 14 ? 1 : 'preserveStartEnd'} />
                        <YAxis tick={{ fontSize: 11, fill: '#7d8590' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                        <Tooltip content={<ChartTip />} />
                        <Area type="monotone" dataKey="none" stackId="s" stroke="#3d444d" strokeWidth={1.5} fill="url(#gNone)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="P4"   stackId="s" stroke={CHART_FILL.P4} strokeWidth={1.5} fill="url(#gP4)"   isAnimationActive={false} />
                        <Area type="monotone" dataKey="P3"   stackId="s" stroke={CHART_FILL.P3} strokeWidth={1.5} fill="url(#gP3)"   isAnimationActive={false} />
                        <Area type="monotone" dataKey="P2"   stackId="s" stroke={CHART_FILL.P2} strokeWidth={1.5} fill="url(#gP2)"   isAnimationActive={false} />
                        <Area type="monotone" dataKey="P1"   stackId="s" stroke={CHART_FILL.P1} strokeWidth={1.5} fill="url(#gP1)"   isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                      {[['P1 Critical','#ef4444'],['P2 High','#f59e0b'],['P3 Medium','#3b82f6'],['P4 / None','#3d444d']].map(([l,c]) => (
                        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
                          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{l}</span>
                        </div>
                      ))}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {chartDays.reduce((s, d) => s + d.total, 0)} total in window
                      </span>
                    </div>
                  </>
                )}
              </Card>

              {/* Top Error Clusters */}
              <Card pad={20}>
                <SectionHead
                  label="Top Error Clusters"
                  count={stats.errorClusters.length}
                  action={onNavigateToClusters ? { label: 'View all', onClick: onNavigateToClusters } : undefined}
                />
                {stats.errorClusters.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No error clusters detected</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {stats.errorClusters.slice(0, 8).map((c, i) => {
                      const sev   = c.dominantSeverity || 'unknown'
                      const col   = SEV[sev] ?? 'var(--tx-3)'
                      const route = (c.routingTokens[0] as 'BACKEND' | 'MOBILE' | 'WEB' | undefined) ?? null
                      const rc    = route ? ROUTING_COLORS[route] : null
                      const critP = c.count > 0 ? Math.round(((c.severities.P1 || 0) + (c.severities.P2 || 0)) / c.count * 100) : 0
                      return (
                        <div key={i} onClick={() => onNavigateToBugs({ search: c.normalizedKey.slice(0, 40) })}
                          style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--surface-2)', borderRadius:9, borderLeft:`3px solid ${col}`, cursor:'pointer', transition:'opacity .12s, transform .12s' }}
                          onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.opacity='.8'; (e.currentTarget as HTMLElement).style.transform='translateX(2px)' }}
                          onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.opacity='1'; (e.currentTarget as HTMLElement).style.transform='none' }}
                        >
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4, flexWrap:'wrap' }}>
                              <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4, background:col+'18', color:col, border:`1px solid ${col}28` }}>{sev}</span>
                              {rc && <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:3, background:rc.bg, color:rc.color, border:`1px solid ${rc.border}` }}>{route}</span>}
                              {c.topComponent && <span style={{ fontSize:9, color:'var(--tx-3)', background:'var(--surface-3)', padding:'1px 5px', borderRadius:3 }}>{c.topComponent}</span>}
                              {critP>50 && <span style={{ fontSize:9, color:'var(--danger)', fontWeight:700 }}>{critP}% critical</span>}
                            </div>
                            <p className="font-mono" style={{ fontSize:11, color:'var(--tx-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {c.description.length>70 ? c.description.slice(0,70)+'…' : c.description}
                            </p>
                            <div style={{ height:3, background:'var(--surface-3)', borderRadius:99, marginTop:6, overflow:'hidden' }}>
                              <div style={{ width:`${(c.count/maxCluster)*100}%`, height:'100%', background:col+'99', borderRadius:99 }} />
                            </div>
                          </div>
                          <span className="font-brand" style={{ fontSize:20, fontWeight:800, color:'var(--tx-1)', flexShrink:0, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{c.count}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* RIGHT column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>

              {/* Distribution */}
              <Card pad={18}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 16 }}>Distribution</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Severity</p>
                    {(['P1','P2','P3','P4'] as const).map((s, i) => {
                      const n = bugs.filter(b => b.severity === s).length
                      return <AnimBar key={s} label={s} value={n} max={stats.total || 1} color={SEV[s]} onClick={() => onNavigateToBugs({ severity: [s] })} delay={i * 80} />
                    })}
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Status</p>
                    {[
                      { label:'complete', color:'#3fb950' },
                      { label:'triaging', color:'#a371f7' },
                      { label:'pending',  color:'#e3b341' },
                      { label:'resolved', color:'#58a6ff' },
                    ].map(({ label, color }, i) => (
                      <AnimBar key={label} label={label} value={bugs.filter(b => b.status === label).length} max={stats.total || 1} color={color} onClick={() => onNavigateToBugs({ status: [label] })} delay={100 + i * 70} />
                    ))}
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Routing</p>
                    {stats.routingBreakdown.slice(0,4).map((r, i) => {
                      const col = r.routing === 'BACKEND' ? '#a371f7' : r.routing === 'MOBILE' ? '#2dd4bf' : r.routing === 'WEB' ? '#3fb950' : 'var(--tx-3)'
                      return <AnimBar key={r.routing} label={r.routing} value={r.count} max={stats.routingBreakdown[0]?.count || 1} color={col} onClick={() => onNavigateToBugs({ platform: [r.routing] })} delay={200 + i * 60} badge={r.P1 > 0 ? `P1:${r.P1}` : undefined} />
                    })}
                  </div>
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Component</p>
                    {stats.componentBreakdown.slice(0,5).map((c, i) => (
                      <AnimBar key={c.component} label={c.component} value={c.count} max={stats.componentBreakdown[0]?.count || 1} color="#f97316" onClick={() => onNavigateToBugs({ component: [c.component] })} delay={280 + i * 55} badge={c.P1 > 0 ? `P1:${c.P1}` : undefined} />
                    ))}
                  </div>
                </div>
              </Card>

              <PipelineWidget />

              {/* Jira Coverage */}
              <Card pad={16}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Jira Coverage</p>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  {[
                    { label: 'Ticketed', value: bugs.filter(b => !!b.jira_key).length, color: '#3fb950' },
                    { label: 'Missing',  value: stats.pendingNoJira,                   color: stats.pendingNoJira > 0 ? '#e3b341' : 'var(--tx-3)' },
                    { label: 'Failed',   value: stats.jiraPendingCount,                color: stats.jiraPendingCount > 0 ? '#ef4444' : 'var(--tx-3)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign: 'center', flex: 1 }}>
                      <p className="font-brand" style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</p>
                      <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>{label}</p>
                    </div>
                  ))}
                </div>
                <AnimBar label="Coverage" value={bugs.filter(b => !!b.jira_key).length} max={stats.total || 1} color="#3fb950" delay={300} />
              </Card>
            </div>
          </div>
        </section>

        {/* D2 ── RECENT P1/P2 + INSIGHTS (full width) ──────────── */}
        {(() => {
          const critBugs = bugs.filter(b => b.severity === 'P1' || b.severity === 'P2').slice(0, 6)
          return critBugs.length === 0 ? null : (
            <Card pad={20}>
              <SectionHead label="Recent P1/P2 Bugs" count={critBugs.length} />
              <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : '1fr', gap: 2 }}>
                {critBugs.map(b => {
                  const col = b.severity === 'P1' ? '#ef4444' : '#f59e0b'
                  const ts  = b.timestamp_utc || b.created_at
                  const ms  = Date.now() - new Date(ts).getTime()
                  const ago = ms < 3_600_000 ? `${Math.round(ms/60000)}m ago`
                    : ms < 86_400_000 ? `${Math.round(ms/3_600_000)}h ago`
                    : `${Math.round(ms/86_400_000)}d ago`
                  return (
                    <div key={b.report_id} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 10px', borderRadius:8, transition:'background .12s', minWidth:0 }}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--surface-2)'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
                    >
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99, background:col+'18', color:col, border:`1px solid ${col}30`, flexShrink:0, marginTop:1 }}>{b.severity}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:12, color:'var(--tx-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.description?.slice(0,80) ?? b.report_id}</p>
                        {b.ai_summary && <p style={{ fontSize:11, color:'var(--tx-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:1 }}>{b.ai_summary}</p>}
                      </div>
                      <div style={{ flexShrink:0, textAlign:'right' }}>
                        <p style={{ fontSize:10, color:'var(--tx-3)' }}>{ago}</p>
                        {b.routingToken && <p style={{ fontSize:9, fontWeight:700, color: b.routingToken === 'BACKEND' ? '#a371f7' : b.routingToken === 'MOBILE' ? '#2dd4bf' : '#3fb950', marginTop:2 }}>{b.routingToken}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })()}

        {/* Actionable Insights */}
        <Card pad={20}>
          <SectionHead label="Actionable Insights" count={stats.insights.length} />
          {stats.insights.length === 0 ? (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 12px', background:'rgba(63,185,80,.06)', border:'1px solid rgba(63,185,80,.18)', borderRadius:8 }}>
              <CheckCircle2 size={13} color="#3fb950" />
              <span style={{ fontSize:12, color:'#3fb950' }}>No critical insights — all looks healthy</span>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns: wide ? 'repeat(2, 1fr)' : '1fr', gap:8 }}>
              {stats.insights.slice(0, 6).map((ins, i) => {
                const s = ISTYLE[ins.type] ?? ISTYLE.info
                return (
                  <div key={i} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:8, padding:'10px 12px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                      {ins.type === 'critical' && <AlertTriangle size={13} color={s.col} style={{ flexShrink:0, marginTop:1 }} />}
                      {ins.type === 'warning'  && <TrendingUp    size={13} color={s.col} style={{ flexShrink:0, marginTop:1 }} />}
                      {ins.type === 'action'   && <Zap           size={13} color={s.col} style={{ flexShrink:0, marginTop:1 }} />}
                      {ins.type === 'info'     && <Info          size={13} color={s.col} style={{ flexShrink:0, marginTop:1 }} />}
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:12, fontWeight:700, color:'var(--tx-1)', marginBottom:2, lineHeight:1.4 }}>{ins.title}</p>
                        <p style={{ fontSize:11, color:'var(--tx-2)', lineHeight:1.5 }}>{ins.body}</p>
                        <span style={{ display:'inline-block', marginTop:5, fontSize:10, fontWeight:700, padding:'1px 8px', borderRadius:99, background:s.bg, color:s.col, border:`1px solid ${s.border}` }}>{ins.metric}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* E ── INTEGRATION HEALTH ───────────────────────────────── */}
        <section>
          <SectionHead label="Integration Health" />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${wide ? 4 : 2}, minmax(0, 1fr))`, gap: 12 }}>
            <IntegCard name="Rollbar"       icon={<Radio    size={15}/>} color="#3b82f6" pct={integ.rollbar.pct}     detail={`${integ.rollbar.n} of ${integ.total} bugs — auto-detected errors with stack traces`} />
            <IntegCard name="CloudWatch"    icon={<Activity size={15}/>} color="#2dd4bf" pct={integ.cloudwatch.pct}  detail={`${integ.cloudwatch.n} of ${integ.total} bugs have correlation_id`} />
            <IntegCard name="User-Reported" icon={<Cloud    size={15}/>} color="#f97316" pct={integ.userReports.pct} detail={`${integ.userReports.n} of ${integ.total} bugs were manually submitted`} />
            <IntegCard name="AI Triage"     icon={<Cpu      size={15}/>} color="#a371f7" pct={integ.aiTriage.pct}    detail={`${integ.aiTriage.n} of ${integ.total} bugs have Gemini ai_summary`} />
          </div>
        </section>

        {/* F ── JIRA SPACES ─────────────────────────────────────── */}
        <section>
          <SectionHead label="Jira Spaces" />
          <JiraSpacesPanel bugs={bugs} />
        </section>

        {/* G ── INTERNAL TICKETS ────────────────────────────────── */}
        <section>
          <SectionHead label="Internal Tickets" />
          <TicketsWidget onNavigate={onNavigateToTickets} />
        </section>

        {/* H ── POSTHOG ─────────────────────────────────────────── */}
        <section>
          <SectionHead label="Product Analytics (PostHog)" />
          <PostHogOverviewWidget onNavigate={onNavigateToPostHog} />
        </section>

        {/* I ── SECONDARY BREAKDOWNS ────────────────────────────── */}
        <section>
          <SectionHead label="Breakdown Details" />
          <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : '1fr', gap: 16 }}>

            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>By Category</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>AI triage classification</p>
              {stats.categoryBreakdown.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No category data yet</p>
                : stats.categoryBreakdown.slice(0, 7).map(c => {
                    const maxCat = stats.categoryBreakdown[0]?.count || 1
                    const col    = c.P1 > 0 ? 'var(--danger)' : c.P2 > 0 ? 'var(--warning)' : 'var(--info)'
                    return (
                      <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                        <span style={{ width: 92, fontSize: 11, color: 'var(--tx-2)', textTransform: 'capitalize', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.category.replace(/_/g, ' ')}</span>
                        <ProgressBar pct={(c.count / maxCat) * 100} color={col} />
                        <span style={{ fontSize: 11, color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 22, textAlign: 'right' }}>{c.count}</span>
                      </div>
                    )
                  })
              }
            </Card>

            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>By App Version</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>P1+P2 = release risk indicator</p>
              {stats.versionBreakdown.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No version data yet</p>
                : stats.versionBreakdown.slice(0, 6).map(v => {
                    const maxV = stats.versionBreakdown[0]?.total || 1
                    const col  = v.P1 > 0 ? 'var(--danger)' : (v.P1 + v.P2) / v.total > .5 ? 'var(--warning)' : 'var(--info)'
                    return (
                      <div key={v.version} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-1)' }}>{v.version}</span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {v.P1 > 0 && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>P1:{v.P1}</span>}
                            {v.P2 > 0 && <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 700 }}>P2:{v.P2}</span>}
                            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{v.total}</span>
                          </div>
                        </div>
                        <ProgressBar pct={(v.total / maxV) * 100} color={col} />
                      </div>
                    )
                  })
              }
            </Card>

            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Peak Hours (UTC)</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Hourly bug arrival pattern</p>
              {stats.hourlyVolume.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No timing data</p>
                : (
                  <div role="img" aria-label="Bug count by UTC hour" style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                    {stats.hourlyVolume.map(h => {
                      const maxH  = Math.max(...stats.hourlyVolume.map(x => x.count), 1)
                      const isPeak = h.count === maxH
                      return (
                        <div key={h.hour} title={`${h.hour}:00 UTC — ${h.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <div style={{ width: '100%', height: `${Math.max(3, (h.count / maxH) * 68)}px`, background: isPeak ? 'var(--orange)' : 'var(--surface-3)', borderRadius: '2px 2px 0 0' }} />
                          <span style={{ fontSize: 8, color: 'var(--tx-3)' }}>{h.hour}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              }
              {stats.rollbarGroups.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Same Rollbar item</p>
                  {stats.rollbarGroups.slice(0, 3).map(g => (
                    <div key={g.itemId} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'rgba(255,123,114,.10)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{g.count}×</span>
                      <div style={{ minWidth: 0 }}>
                        <p className="font-mono" style={{ fontSize: 10, color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.description.slice(0, 46)}…</p>
                        {g.jiraKeys.slice(0, 2).map(k => (
                          <a key={k} href={jiraUrl(k) ?? '#'} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--info)', marginRight: 4 }}>{k}</a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* J ── ENVIRONMENT & SOURCE ────────────────────────────── */}
        <section>
          <SectionHead label="Environment &amp; Source" />
          <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 16 }}>
            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>By Environment</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Where bugs are occurring</p>
              {stats.environmentBreakdown.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No environment data yet</p>
                : stats.environmentBreakdown.map(e => {
                    const isProd = e.env.toLowerCase().includes('prod')
                    const col    = isProd ? 'var(--danger)' : e.env.toLowerCase().includes('stag') ? 'var(--warning)' : 'var(--info)'
                    const maxE   = stats.environmentBreakdown[0].count
                    return (
                      <div key={e.env} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--tx-1)', fontWeight: isProd ? 600 : 400 }}>{e.env}</span>
                            {isProd && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', background: 'rgba(255,123,114,.10)', padding: '1px 6px', borderRadius: 99 }}>PROD</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {e.P1 > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>P1:{e.P1}</span>}
                            {e.P2 > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)' }}>P2:{e.P2}</span>}
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{e.count}</span>
                          </div>
                        </div>
                        <ProgressBar pct={(e.count / maxE) * 100} color={col} />
                      </div>
                    )
                  })
              }
            </Card>
            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Report Sources</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Where reports originate</p>
              {bugs.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No source data yet</p>
                : ([
                    ['Rollbar',       bugs.filter(b => b.source === 'rollbar_auto').length,                               'var(--info)'],
                    ['CloudWatch',    bugs.filter(b => b.source === 'cloudwatch_poller').length,                          '#2dd4bf'],
                    ['User-reported', bugs.filter(b => b.source === 'user_report' || b.source === 'yuzee_app').length,    'var(--warning)'],
                  ] as [string, number, string][]).map(([label, n, col]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span style={{ width: 96, fontSize: 11, color: 'var(--tx-2)', flexShrink: 0 }}>{label}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '3px 10px', background: n > 0 ? col + '14' : 'var(--surface-2)', border: `1px solid ${n > 0 ? col + '30' : 'var(--border)'}`, borderRadius: 20 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: n > 0 ? col : 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                      </div>
                    </div>
                  ))
              }
              {stats.moduleBreakdown.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>By Module</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    {stats.moduleBreakdown.map(m => {
                      const COLS: Record<string, string> = { WEB: 'var(--module-web)', APP: 'var(--module-app)', BACKEND: 'var(--module-be)', INFRASTRUCTURE: 'var(--module-infra)' }
                      const ICONS: Record<string, React.ReactNode> = { WEB: <Globe size={13}/>, APP: <Smartphone size={13}/>, BACKEND: <Server size={13}/>, INFRASTRUCTURE: <Database size={13}/> }
                      const col = COLS[m.module] || 'var(--orange)'
                      return (
                        <div key={m.module} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: col }}>{ICONS[m.module] ?? <Package size={13}/>}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{m.module}</p>
                            <p className="font-brand" style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{m.count}</p>
                          </div>
                          {m.P1 > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}>P1:{m.P1}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* K ── TOP ENDPOINTS (conditional) ────────────────────── */}
        {stats.topPageUrls.length > 0 && (
          <section>
            <SectionHead label="Top Affected Endpoints" />
            <Card pad={20}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Highest-impact routes</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Extracted from bug context data</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                {stats.topPageUrls.map((p, i) => {
                  const col = SEV[p.maxSeverity] ?? 'var(--tx-3)'
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${p.maxSeverity === 'P1' ? 'rgba(255,123,114,.2)' : 'transparent'}` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: col + '18', color: col, border: `1px solid ${col}28`, flexShrink: 0 }}>{p.maxSeverity}</span>
                      <span className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.url}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{p.count}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </section>
        )}

      </div>
    </div>
  )
}
