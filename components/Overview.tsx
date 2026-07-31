'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
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
  Database, Package, BarChart2,
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
  void _globalStats // superseded by the range-scoped `stats` computed below

  // Captured once per mount rather than read live during render — Date.now() is an
  // impure call and must not be invoked directly in the render body (react-hooks/purity).
  const [nowMs] = useState(() => Date.now())

  const [dayRange, setDayRange] = useState<DayRange>(30)

  // Overview-wide time filter — affects every stat card and chart below.
  // Re-defaults whenever the legacy toggle flips (adjusting state on prop change,
  // done during render rather than in an effect — see react.dev "you might not need an effect").
  const [range, setRange] = useState<RangeFilter>(() => includeLegacy ? 'all' : 'month')
  const [prevIncludeLegacy, setPrevIncludeLegacy] = useState(includeLegacy)
  if (includeLegacy !== prevIncludeLegacy) {
    setPrevIncludeLegacy(includeLegacy)
    setRange(includeLegacy ? 'all' : 'month')
  }

  const rangeStart = useMemo(() => rangeCutoff(range, nowMs), [range, nowMs])
  const bugs = useMemo(
    () => rangeStart ? allBugs.filter(b => new Date(b.timestamp_utc || b.created_at) >= rangeStart) : allBugs,
    [allBugs, rangeStart]
  )
  const stats = useMemo(() => computeStats(bugs), [bugs])

  const cutoff    = new Date(nowMs - dayRange * 86_400_000).toISOString().slice(0, 10)
  const chartDays = stats.dailyVolume.filter(d => d.date >= cutoff)

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

  /* integration health — derived from all bugs in the selected range */
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

  /* insight styles */
  const ISTYLE: Record<string, { border: string; bg: string; col: string }> = {
    critical: { border: 'rgba(255,123,114,.22)', bg: 'rgba(255,123,114,.06)', col: 'var(--danger)'  },
    warning:  { border: 'rgba(227,179,65,.22)',  bg: 'rgba(227,179,65,.06)',  col: 'var(--warning)' },
    action:   { border: 'rgba(163,113,247,.22)', bg: 'rgba(163,113,247,.06)', col: 'var(--purple)'  },
    info:     { border: 'rgba(88,166,255,.18)',  bg: 'rgba(88,166,255,.06)',  col: 'var(--info)'    },
  }

  const maxCluster = stats.errorClusters[0]?.count || 1

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        <PageInfo storageKey="overview">
          A live snapshot of the whole bug pipeline: KPIs, volume trends, severity/status/routing/component
          breakdowns, AI triage health, and auto-generated insights. Most charts and numbers are clickable — click a
          bar, slice, or KPI to jump to the matching bugs in Bug Reports.
        </PageInfo>

        {/* 1 ── CRITICAL SUMMARY (top of page, minimal, no walls of numbers) ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <Divider label="Critical Summary" />
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {(Object.keys(RANGE_LABELS) as RangeFilter[]).map(r => (
                <button key={r} onClick={() => setRange(r)} style={{
                  padding: '4px 11px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: range === r ? 'var(--orange)' : 'var(--surface-2)',
                  color:      range === r ? '#fff'          : 'var(--tx-2)',
                  border:     `1px solid ${range === r ? 'var(--orange)' : 'var(--border)'}`,
                  cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}>{RANGE_LABELS[r]}</button>
              ))}
            </div>
          </div>

          <Card pad={16}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 18 }}>
              {/* Severity */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Severity</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['P1', 'P2', 'P3', 'P4'] as const).map(s => {
                    const n = bugs.filter(b => b.severity === s).length
                    return (
                      <button key={s} onClick={() => onNavigateToBugs({ severity: [s] })} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20,
                        background: n > 0 ? SEV[s] + '18' : 'var(--surface-2)',
                        border: `1px solid ${n > 0 ? SEV[s] + '35' : 'var(--border)'}`,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: n > 0 ? SEV[s] : 'var(--tx-3)' }}>{s}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: n > 0 ? SEV[s] : 'var(--tx-3)' }}>{n}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Source (counts only, no percentages) */}
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Source</p>
                <div style={{ display: 'flex', gap: 12 }}>
                  {([
                    ['Rollbar', bugs.filter(b => b.source === 'rollbar_auto').length],
                    ['CloudWatch', bugs.filter(b => b.source === 'cloudwatch_poller').length],
                    ['User-reported', bugs.filter(b => b.source === 'user_report' || b.source === 'yuzee_app').length],
                  ] as [string, number][]).map(([label, n]) => (
                    <div key={label}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--tx-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n}</p>
                      <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Jira coverage */}
              <div onClick={() => onNavigateToBugs({ hasJira: 'no' })} style={{ cursor: 'pointer' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Jira Coverage</p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: '#3fb950', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{bugs.filter(b => !!b.jira_key).length}</p>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>Have ticket</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: stats.pendingNoJira > 0 ? '#e3b341' : 'var(--tx-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{stats.pendingNoJira}</p>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>Missing</p>
                  </div>
                </div>
              </div>

              {/* Pending / in-review */}
              <div onClick={() => onNavigateToBugs({ status: ['pending'] })} style={{ cursor: 'pointer' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Pending / In Review</p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--tx-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{bugs.filter(b => b.status === 'pending').length}</p>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>Pending</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 800, color: stats.needsHumanReview > 0 ? '#58a6ff' : 'var(--tx-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{stats.needsHumanReview}</p>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>In review</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Secondary health row — smaller, subordinate to the summary above */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 10 }}>
            <Kpi label="Total Bugs"   value={stats.total}              sub={dateRange}                                icon={<BarChart2    size={14}/>} delta={{ n: todayCount - yestCount, label: 'vs yesterday' }} />
            <Kpi label="Resolved"     value={`${stats.resolvedRate}%`} sub={`${bugs.filter(b => b.status === 'complete').length} complete`} accent="#3fb950" icon={<CheckCircle2 size={14}/>} trendGood />
            <Kpi label="Duplicates"   value={stats.duplicateCount}     sub={`${dupRate}% total · ${stats.rollbarDuplicateCount} Rollbar`}    accent="#6b7280" icon={<Link         size={14}/>} onClick={onNavigateToClusters} />
            <Kpi label="Jira Pending" value={stats.jiraPendingCount}    sub="ticket creation failed"                   warning={stats.jiraPendingCount > 0} icon={<XCircle      size={14}/>} onClick={() => onNavigateToBugs({ jiraPending: 'yes' })} />
          </div>
        </section>

        {/* 2 ── VOLUME CHART (full width, capped bar size) ──────── */}
        <section>
          <Divider label="Bug Volume" />
          <Card pad={20} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Daily Bug Volume</p>
                <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>Stacked by severity — showing {chartDays.length} day{chartDays.length !== 1 ? 's' : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([7, 14, 30] as DayRange[]).map(r => (
                  <button key={r} onClick={() => setDayRange(r)} style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: dayRange === r ? 'var(--orange)' : 'var(--surface-2)',
                    color:      dayRange === r ? '#fff'          : 'var(--tx-2)',
                    border:     `1px solid ${dayRange === r ? 'var(--orange)' : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
                  }}>{r}d</button>
                ))}
              </div>
            </div>

            {chartDays.length === 0 ? (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No data for this date range</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={chartDays}
                    maxBarSize={28}
                    barCategoryGap="30%"
                    margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid vertical={false} stroke="rgba(48,54,61,.6)" strokeDasharray="3 6" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#7d8590' }}
                      axisLine={false} tickLine={false}
                      interval={dayRange === 7 ? 0 : dayRange === 14 ? 1 : 'preserveStartEnd'}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#7d8590' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,.03)' }} />
                    <Bar dataKey="P1"   stackId="s" fill={CHART_FILL.P1}   isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { date?: string } }) => d?.payload?.date && onNavigateToBugs({ dateFrom: d.payload.date, dateTo: d.payload.date })} />
                    <Bar dataKey="P2"   stackId="s" fill={CHART_FILL.P2}   isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { date?: string } }) => d?.payload?.date && onNavigateToBugs({ dateFrom: d.payload.date, dateTo: d.payload.date })} />
                    <Bar dataKey="P3"   stackId="s" fill={CHART_FILL.P3}   isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { date?: string } }) => d?.payload?.date && onNavigateToBugs({ dateFrom: d.payload.date, dateTo: d.payload.date })} />
                    <Bar dataKey="P4"   stackId="s" fill={CHART_FILL.P4}   isAnimationActive={false} cursor="pointer" onClick={(d: { payload?: { date?: string } }) => d?.payload?.date && onNavigateToBugs({ dateFrom: d.payload.date, dateTo: d.payload.date })} />
                    <Bar dataKey="none" stackId="s" fill={CHART_FILL.none} isAnimationActive={false} radius={[3,3,0,0]} cursor="pointer" onClick={(d: { payload?: { date?: string } }) => d?.payload?.date && onNavigateToBugs({ dateFrom: d.payload.date, dateTo: d.payload.date })} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 20, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  {[['P1 Critical','#ef4444'],['P2 High','#f59e0b'],['P3 Medium','#3b82f6'],['P4 / Unclassified','#3d444d']] .map(([l,c]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{l}</span>
                    </div>
                  ))}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {chartDays.reduce((s, d) => s + d.total, 0)} total in range
                  </span>
                </div>
              </>
            )}
          </Card>
        </section>

        {/* 3 ── DISTRIBUTION (4 equal mini-cards) ──────────────── */}
        <section>
          <Divider label="Distribution" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>

            <DistCard title="Severity" onRowClick={s => onNavigateToBugs({ severity: [s] })} rows={
              (['P1','P2','P3','P4'] as const).map(s => ({
                label: s, color: SEV[s],
                value: bugs.filter(b => b.severity === s).length,
                max: stats.total || 1,
              }))
            } />

            <DistCard title="Status" onRowClick={s => onNavigateToBugs({ status: [s] })} rows={[
              { label: 'complete', color: '#3fb950', value: bugs.filter(b => b.status === 'complete').length, max: stats.total || 1 },
              { label: 'triaging', color: '#a371f7', value: bugs.filter(b => b.status === 'triaging').length, max: stats.total || 1 },
              { label: 'pending',  color: '#e3b341', value: bugs.filter(b => b.status === 'pending').length,  max: stats.total || 1 },
              { label: 'resolved', color: '#58a6ff', value: bugs.filter(b => b.status === 'resolved').length, max: stats.total || 1 },
            ]} />

            <DistCard title="Routing" onRowClick={r => onNavigateToBugs({ platform: [r] })} rows={
              stats.routingBreakdown.slice(0, 4).map(r => ({
                label: r.routing,
                color: r.routing === 'BACKEND' ? '#a371f7' : r.routing === 'MOBILE' ? '#2dd4bf' : r.routing === 'WEB' ? '#3fb950' : 'var(--tx-3)',
                value: r.count, max: stats.routingBreakdown[0]?.count || 1,
                badge: r.P1 > 0 ? `P1:${r.P1}` : undefined,
              }))
            } />

            <DistCard title="Component" onRowClick={c => onNavigateToBugs({ component: [c] })} rows={
              stats.componentBreakdown.slice(0, 5).map(c => ({
                label: c.component, color: '#f97316',
                value: c.count, max: stats.componentBreakdown[0]?.count || 1,
                badge: c.P1 > 0 ? `P1:${c.P1}` : undefined,
              }))
            } />
          </div>
        </section>

        {/* 4 ── INTEGRATIONS ────────────────────────────────────── */}
        <section>
          <Divider label="Bug Sources &amp; Integration Health" />
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 8, marginBottom: 10 }}>
            Bugs enter via <strong style={{ color: 'var(--tx-2)' }}>Rollbar</strong> (auto-detected errors),{' '}
            <strong style={{ color: 'var(--tx-2)' }}>CloudWatch</strong> (log scanning), or{' '}
            <strong style={{ color: 'var(--tx-2)' }}>user submission</strong>.{' '}
            All are then processed by n8n and triaged by Gemini — 100% of bugs go through that pipeline.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <IntegCard name="Rollbar"        icon={<Radio      size={15}/>} color="#3b82f6" pct={integ.rollbar.pct}     detail={`${integ.rollbar.n} of ${integ.total} bugs — auto-detected backend/mobile errors with stack traces & occurrence counts`} />
            <IntegCard name="CloudWatch"     icon={<Activity   size={15}/>} color="#2dd4bf" pct={integ.cloudwatch.pct}  detail={`${integ.cloudwatch.n} of ${integ.total} bugs have correlation_id — enables ±15 min CloudWatch log window links`} />
            <IntegCard name="User-Reported"  icon={<Cloud      size={15}/>} color="#f97316" pct={integ.userReports.pct} detail={`${integ.userReports.n} of ${integ.total} bugs were manually submitted via the app — source: user_report / yuzee_app`} />
            <IntegCard name="AI Triage"      icon={<Cpu        size={15}/>} color="#a371f7" pct={integ.aiTriage.pct}    detail={`${integ.aiTriage.n} of ${integ.total} bugs have Gemini-generated ai_summary — pipeline ${integ.aiTriage.pct > 50 ? 'healthy' : 'needs attention'}`} />
          </div>
        </section>

        {/* 5 ── JIRA SPACES ─────────────────────────────────────── */}
        <section>
          <Divider label="Jira Spaces" />
          <div style={{ marginTop: 12 }}>
            <JiraSpacesPanel bugs={bugs} />
          </div>
        </section>

        {/* 5b ── INTERNAL TICKETS ───────────────────────────────── */}
        <section>
          <Divider label="Internal Tickets" />
          <div style={{ marginTop: 12 }}>
            <TicketsWidget onNavigate={onNavigateToTickets} />
          </div>
        </section>

        {/* 5c ── POSTHOG OVERVIEW ───────────────────────────────── */}
        <section>
          <Divider label="Product Analytics (PostHog)" />
          <div style={{ marginTop: 12 }}>
            <PostHogOverviewWidget onNavigate={onNavigateToPostHog} />
          </div>
        </section>

        {/* 6 ── PIPELINE + INSIGHTS ─────────────────────────────── */}
        <section>
          <Divider label="Pipeline &amp; Insights" />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginTop: 12 }}>
            <PipelineWidget />
            <Card>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Actionable Insights</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Auto-derived from current data</p>
              {stats.insights.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 12px', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.18)', borderRadius: 8 }}>
                  <CheckCircle2 size={13} color="#3fb950" />
                  <span style={{ fontSize: 12, color: '#3fb950' }}>No critical insights — all looks healthy</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.insights.slice(0, 5).map((ins, i) => {
                    const s = ISTYLE[ins.type] ?? ISTYLE.info
                    return (
                      <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          {ins.type === 'critical' && <AlertTriangle size={13} color={s.col} style={{ flexShrink: 0, marginTop: 1 }} />}
                          {ins.type === 'warning'  && <TrendingUp    size={13} color={s.col} style={{ flexShrink: 0, marginTop: 1 }} />}
                          {ins.type === 'action'   && <Zap           size={13} color={s.col} style={{ flexShrink: 0, marginTop: 1 }} />}
                          {ins.type === 'info'     && <Info          size={13} color={s.col} style={{ flexShrink: 0, marginTop: 1 }} />}
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 2, lineHeight: 1.4 }}>{ins.title}</p>
                            <p style={{ fontSize: 11, color: 'var(--tx-2)', lineHeight: 1.5 }}>{ins.body}</p>
                            <span style={{ display: 'inline-block', marginTop: 5, fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: s.bg, color: s.col, border: `1px solid ${s.border}` }}>{ins.metric}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* 7 ── ERROR CLUSTERS ──────────────────────────────────── */}
        <section>
          <Divider label="Top Error Clusters" />
          <Card pad={20} style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 2 }}>Grouped by error pattern</p>
                <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>Click any row to open filtered bug list</p>
              </div>
              <span style={{ fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '2px 9px', borderRadius: 99, fontVariantNumeric: 'tabular-nums' }}>
                {stats.errorClusters.length} pattern{stats.errorClusters.length !== 1 ? 's' : ''}
              </span>
            </div>
            {stats.errorClusters.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No clusters detected yet</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                {stats.errorClusters.slice(0, 10).map((c, i) => {
                  const sev   = c.dominantSeverity || 'unknown'
                  const col   = SEV[sev] ?? 'var(--tx-3)'
                  const route = (c.routingTokens[0] as 'BACKEND' | 'MOBILE' | 'WEB' | undefined) ?? null
                  const rc    = route ? ROUTING_COLORS[route] : null
                  const critP = c.count > 0 ? Math.round(((c.severities.P1 || 0) + (c.severities.P2 || 0)) / c.count * 100) : 0
                  return (
                    <div
                      key={i}
                      onClick={() => onNavigateToBugs({ search: c.normalizedKey.slice(0, 40) })}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px',
                        borderLeft: `3px solid ${col}`, cursor: 'pointer', transition: 'opacity .12s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '.75'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: col + '18', color: col, border: `1px solid ${col}28` }}>{sev}</span>
                          {rc && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>{route}</span>}
                          {c.topComponent && <span style={{ fontSize: 9, color: 'var(--tx-3)', background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 3 }}>{c.topComponent}</span>}
                          {critP > 50 && <span style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 700, background: 'rgba(255,123,114,.08)', border: '1px solid rgba(255,123,114,.2)', padding: '1px 5px', borderRadius: 3 }}>{critP}% critical</span>}
                        </div>
                        <p className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.description.length > 62 ? c.description.slice(0, 62) + '…' : c.description}
                        </p>
                        <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ width: `${(c.count / maxCluster) * 100}%`, height: '100%', background: col + '99', borderRadius: 99 }} />
                        </div>
                      </div>
                      <span className="font-brand" style={{ fontSize: 18, fontWeight: 800, color: 'var(--tx-1)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1, marginTop: 2 }}>{c.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </section>

        {/* 8 ── SECONDARY BREAKDOWNS ────────────────────────────── */}
        <section>
          <Divider label="Breakdown Details" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, marginTop: 12 }}>

            {/* Category */}
            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>By Category</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>AI triage classification</p>
              {stats.categoryBreakdown.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No category data yet</p>
                : stats.categoryBreakdown.slice(0, 7).map(c => {
                    const maxCat = stats.categoryBreakdown[0]?.count || 1
                    const col = c.P1 > 0 ? 'var(--danger)' : c.P2 > 0 ? 'var(--warning)' : 'var(--info)'
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

            {/* Version */}
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

            {/* Peak Hours */}
            <Card pad={16}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif', marginBottom: 3 }}>Peak Hours (UTC)</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Hourly bug arrival pattern</p>
              {stats.hourlyVolume.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No timing data</p>
                : (
                  <div role="img" aria-label="Bug count by UTC hour" style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                    {stats.hourlyVolume.map(h => {
                      const maxH = Math.max(...stats.hourlyVolume.map(x => x.count), 1)
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

        {/* 9 ── ENVIRONMENT + SOURCE ────────────────────────────── */}
        <section>
          <Divider label="Environment &amp; Source" />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, marginTop: 12 }}>

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
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Where reports originate — counts only, all data comes from n8n automations</p>
              {bugs.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No source data yet</p>
                : ([
                    ['Rollbar', bugs.filter(b => b.source === 'rollbar_auto').length, 'var(--info)'],
                    ['CloudWatch', bugs.filter(b => b.source === 'cloudwatch_poller').length, '#2dd4bf'],
                    ['User-reported', bugs.filter(b => b.source === 'user_report' || b.source === 'yuzee_app').length, 'var(--warning)'],
                  ] as [string, number, string][]).map(([label, n, col]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span style={{ width: 96, fontSize: 11, color: 'var(--tx-2)', flexShrink: 0 }}>{label}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '3px 10px', background: n > 0 ? col + '14' : 'var(--surface-2)', border: `1px solid ${n > 0 ? col + '30' : 'var(--border)'}`, borderRadius: 20 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: n > 0 ? col : 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                      </div>
                    </div>
                  ))
              }
              {/* Module mini-grid */}
              {stats.moduleBreakdown.length > 0 && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>By Module</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    {stats.moduleBreakdown.map(m => {
                      const ICONS: Record<string, React.ReactNode> = { WEB: <Globe size={13}/>, APP: <Smartphone size={13}/>, BACKEND: <Server size={13}/>, INFRASTRUCTURE: <Database size={13}/> }
                      const COLS:  Record<string, string>           = { WEB: 'var(--module-web)', APP: 'var(--module-app)', BACKEND: 'var(--module-be)', INFRASTRUCTURE: 'var(--module-infra)' }
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

        {/* 10 ── TOP ENDPOINTS (conditional) ──────────────────────*/}
        {stats.topPageUrls.length > 0 && (
          <section>
            <Divider label="Top Affected Endpoints" />
            <Card pad={20} style={{ marginTop: 12 }}>
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
