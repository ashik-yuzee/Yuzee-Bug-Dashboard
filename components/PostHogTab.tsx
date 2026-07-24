'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, Tooltip, XAxis, YAxis,
  ResponsiveContainer, CartesianGrid, Legend, LabelList,
} from 'recharts'
import {
  Activity, Users, MousePointer, Layers, Globe, Smartphone, Flag,
  TrendingUp, TrendingDown, Minus, RefreshCw, ExternalLink, Copy,
  ChevronRight, AlertTriangle, CheckCircle2, Eye, MonitorSmartphone,
  BarChart2, Zap, Target, Brain, Clock, DollarSign, ArrowDown, Maximize2, Minimize2,
  Calendar, Flame, UserCheck, Search, X,
} from 'lucide-react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { usePostHogAnalytics } from '@/hooks/usePostHogAnalytics'
import type { ParsedBug } from '@/lib/bugUtils'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// PostHog country name → topojson name mismatches
const COUNTRY_NAME_MAP: Record<string, string> = {
  'united states':              'united states of america',
  'usa':                        'united states of america',
  'uk':                         'united kingdom',
  'south korea':                'south korea',
  'north korea':                'north korea',
  'czech republic':             'czechia',
  'republic of ireland':        'ireland',
  'trinidad and tobago':        'trinidad and tobago',
  'democratic republic of the congo': 'dem. rep. congo',
  'republic of the congo':      'congo',
  'ivory coast':                'côte d\'ivoire',
  'myanmar':                    'myanmar',
  'laos':                       'lao pdr',
  'vietnam':                    'vietnam',
  'russia':                     'russia',
  'iran':                       'iran',
  'syria':                      'syria',
  'tanzania':                   'united republic of tanzania',
  'bolivia':                    'bolivia',
  'venezuela':                  'venezuela',
  'moldova':                    'moldova',
  'taiwan':                     'taiwan',
}

const PH_BASE    = 'https://us.posthog.com'
const PH_PROJ_ID = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_ID ?? '436283'

/* ── design tokens ──────────────────────────────────────────────────────── */
const C = {
  purple:   '#8b5cf6', purpleDim: 'rgba(139,92,246,.12)',
  teal:     '#14b8a6', tealDim:   'rgba(20,184,166,.12)',
  orange:   '#f97316', orangeDim: 'rgba(249,115,22,.12)',
  blue:     '#3b82f6', blueDim:   'rgba(59,130,246,.12)',
  green:    '#22c55e', greenDim:  'rgba(34,197,94,.12)',
  red:      '#ef4444', redDim:    'rgba(239,68,68,.12)',
  amber:    '#f59e0b', amberDim:  'rgba(245,158,11,.12)',
  grey:     '#6b7280', greyDim:   'rgba(107,114,128,.12)',
  pink:     '#ec4899', pinkDim:   'rgba(236,72,153,.12)',
}

const PIE_COLORS = [C.purple, C.teal, C.blue, C.orange, C.green, C.pink, C.amber, C.red, C.grey]

type SubTab = 'overview' | 'events' | 'users' | 'sessions' | 'platform' | 'funnels' | 'flags' | 'pathways' | 'dropoff' | 'modules' | 'ai' | 'cohorts' | 'heatmap' | 'growth' | 'segments'

/* ── helpers ────────────────────────────────────────────────────────────── */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
function fmtDur(sec: number): string {
  if (!sec) return '—'
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}
function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function relTime(iso: string): string {
  if (!iso) return '—'
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 60)   return `${Math.round(d)}s ago`
  if (d < 3600) return `${Math.round(d / 60)}m ago`
  if (d < 86400)return `${Math.round(d / 3600)}h ago`
  return `${Math.round(d / 86400)}d ago`
}
function shortPath(p: string): string {
  if (!p || p === '(unknown)') return '(unknown)'
  try { return new URL(p).pathname } catch { return p }
}

/* ── atoms ──────────────────────────────────────────────────────────────── */
function Skeleton({ h = 20, r = 6 }: { h?: number; r?: number }) {
  return <div className="skeleton" style={{ height: h, borderRadius: r }} />
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 18, ...style,
    }}>{children}</div>
  )
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>{children}</p>
}

function KpiCard({
  label, value, sub, color, icon, loading, trend, tooltip,
}: {
  label: string; value: string; sub?: string; color: string
  icon: React.ReactNode; loading?: boolean; trend?: { pct: number; good?: boolean } | null
  tooltip?: string
}) {
  const trendGood = trend ? (trend.good === false ? trend.pct < 0 : trend.pct > 0) : null
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</p>
            {tooltip && <InfoTooltip text={tooltip} />}
          </div>
          {loading
            ? <Skeleton h={28} r={4} />
            : <p style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
          }
          {sub && !loading && <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 4 }}>{sub}</p>}
          {trend && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              {trendGood === true  ? <TrendingUp  size={12} color={C.green} /> :
               trendGood === false ? <TrendingDown size={12} color={C.red}  /> :
                                     <Minus size={12} color={C.grey} />}
              <span style={{ fontSize: 11, fontWeight: 600, color: trendGood === true ? C.green : trendGood === false ? C.red : C.grey }}>
                {trend.pct > 0 ? '+' : ''}{trend.pct}% vs prev period
              </span>
            </div>
          )}
        </div>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color }}>
          {icon}
        </div>
      </div>
    </Card>
  )
}

function EmptyState({ msg = 'No data available' }: { msg?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 8 }}>
      <BarChart2 size={28} color="var(--tx-3)" />
      <p style={{ fontSize: 13, color: 'var(--tx-3)' }}>{msg}</p>
    </div>
  )
}

function ErrState({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: 8, fontSize: 12, color: C.red }}>
      <AlertTriangle size={14} /> {msg}
    </div>
  )
}

function DaysControl({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {([7, 14, 30, 60] as const).map(d => (
        <button key={d} onClick={() => onChange(d)} style={{
          padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
          background: value === d ? C.purple + '22' : 'var(--surface-2)',
          color: value === d ? C.purple : 'var(--tx-3)',
          border: `1px solid ${value === d ? C.purple + '55' : 'var(--border)'}`,
          cursor: 'pointer', transition: 'all .15s',
        }}>{d}d</button>
      ))}
    </div>
  )
}

function PillBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>{label}</span>
  )
}

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>{title}</p>
        {sub && <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

/* ── InfoTooltip — ⓘ icon with hover explanation ── */
function InfoTooltip({ text, position = 'top' }: { text: string; position?: 'top' | 'bottom' }) {
  const [show, setShow] = useState(false)
  const isTop = position !== 'bottom'
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 4, flexShrink: 0 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {/* The ⓘ icon */}
      <span style={{
        width: 14, height: 14, borderRadius: 99,
        border: '1.5px solid var(--tx-3)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'help', color: 'var(--tx-3)', fontSize: 8, fontWeight: 900,
        lineHeight: 1, userSelect: 'none', transition: 'border-color .15s, color .15s',
        ...(show ? { borderColor: C.purple, color: C.purple } : {}),
      }}>i</span>

      {/* Tooltip bubble */}
      {show && (
        <span style={{
          position: 'absolute',
          ...(isTop
            ? { bottom: 'calc(100% + 8px)' }
            : { top: 'calc(100% + 8px)' }),
          left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 12px',
          fontSize: 11, color: 'var(--tx-1)', lineHeight: 1.6,
          width: 260, zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,.7)',
          pointerEvents: 'none', whiteSpace: 'normal',
        }}>
          {text}
          {/* Arrow */}
          <span style={{
            position: 'absolute',
            ...(isTop ? { top: '100%' } : { bottom: '100%' }),
            left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            ...(isTop
              ? { borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid var(--border)' }
              : { borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '5px solid var(--border)' }),
          }} />
        </span>
      )}
    </span>
  )
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface-2)', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 11, color: 'var(--tx-1)',
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Overview                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function OverviewPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  useEffect(() => {
    ph.loadOverview()
    ph.loadDau()
    ph.loadNewVsReturn()
  }, [ph.days])

  const ov = ph.overview.data
  const loading = ph.overview.loading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.overview.error && <ErrState msg={ph.overview.error} />}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12 }}>
        <KpiCard label="DAU (today)"      value={loading ? '…' : fmt(ov?.dau ?? 0)}           color={C.purple}  icon={<Users size={16} />}        loading={loading}
          tooltip="Daily Active Users — distinct users who triggered at least one event today. Resets at midnight UTC." />
        <KpiCard label="MAU (this month)" value={loading ? '…' : fmt(ov?.mau ?? 0)}           color={C.teal}    icon={<Activity size={16} />}      loading={loading}
          tooltip="Monthly Active Users — distinct users who triggered at least one event since the start of this calendar month." />
        <KpiCard label="Sessions today"   value={loading ? '…' : fmt(ov?.sessions ?? 0)}      color={C.blue}    icon={<MousePointer size={16} />}  loading={loading}
          tooltip="A session groups all events from the same user within a continuous period. A new session starts after 30 minutes of inactivity." />
        <KpiCard label="Events today"     value={loading ? '…' : fmt(ov?.eventsToday ?? 0)}   color={C.orange}  icon={<Zap size={16} />}           loading={loading}
          tooltip="Total number of events (both custom and auto-captured) fired today. Includes page views, screen views, button clicks, and any custom events your app sends." />
        <KpiCard label="Bounce rate (7d)" value={loading ? '…' : `${ov?.bounceRate ?? 0}%`}   color={ov && ov.bounceRate > 60 ? C.red : C.green}  icon={<TrendingUp size={16} />} loading={loading}
          tooltip="Bounce rate — % of sessions where only 1 event was recorded. A 'bounce' means the user arrived and left without interacting further. Lower is better. Above 60% warrants investigation." />
        <KpiCard label="Avg session (7d)" value={loading ? '…' : fmtDur(ov?.avgSessionSec ?? 0)} color={C.pink} icon={<Eye size={16} />}          loading={loading}
          tooltip="Average session duration over the last 7 days, measured as the time between the first and last event in a session. Sessions with only 1 event count as 0 seconds. A few very long sessions can pull this number up — see Pathways → Median for a more stable measure." />
      </div>

      {/* New vs Returning */}
      <Card>
        <SectionHeader title="New vs Returning Users" sub={`Daily breakdown · last ${ph.days} days`} action={
          <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadNewVsReturn(true) }} />
        } />
        {ph.newVsReturning.loading ? <Skeleton h={160} /> : ph.newVsReturning.error ? <ErrState msg={ph.newVsReturning.error} /> :
         !ph.newVsReturning.data?.length ? <EmptyState msg="No new vs returning data" /> : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={ph.newVsReturning.data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, n) => [fmt(Number(v)), n === 'newUsers' ? 'New' : 'Returning']} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={n => n === 'newUsers' ? 'New users' : 'Returning users'} />
              <Bar dataKey="newUsers"       stackId="a" fill={C.green}  radius={[0,0,0,0]} />
              <Bar dataKey="returningUsers" stackId="a" fill={C.purple} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* DAU Trend + Top Custom Events side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(260px,280px)', gap: 14 }}>
        <Card>
          <SectionHeader title="Daily Active Users" sub={`Last ${ph.days} days`} action={
            <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadDau(true) }} />
          } />
          {ph.dau.loading ? <Skeleton h={180} /> : ph.dau.error ? <ErrState msg={ph.dau.error} /> :
            ph.dau.data?.length === 0 ? <EmptyState msg="No pageview data yet" /> : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={ph.dau.data ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [fmt(Number(v)), 'Users']} />
                <Line type="monotone" dataKey="users" stroke={C.purple} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <SectionHeader title="Top Custom Events" sub="Last 7 days" />
          {loading ? Array.from({length:5}).map((_,i)=><Skeleton key={i} h={20} />) :
           ov?.topCustomEvents.length === 0 ? <EmptyState msg="No custom events found" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(ov?.topCustomEvents ?? []).map((e, i) => (
                <div key={e.event} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', width: 14 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, color: 'var(--tx-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.event}</p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{fmt(e.count)} events</span>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>·</span>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{fmt(e.users)} users</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }}>{fmt(e.count)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>
              Total events (30d): <strong style={{ color: 'var(--tx-1)' }}>{fmt(ov?.events30d ?? 0)}</strong>
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Events                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */
function EventsPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    ph.loadEventTrend()
    ph.loadTopEvents()
    ph.loadPages()
    ph.loadScreens()
  }, [ph.days])

  const filteredEvents = useMemo(() =>
    (ph.topEvents.data ?? []).filter(e =>
      !search || e.event.toLowerCase().includes(search.toLowerCase())
    ), [ph.topEvents.data, search])

  const filteredPages = useMemo(() =>
    (ph.pages.data ?? []).filter(p =>
      !search || p.path.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 20), [ph.pages.data, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Event Volume Trend */}
      <Card>
        <SectionHeader title="Event Volume Trend" sub={`Last ${ph.days} days — custom vs auto-captured`} action={
          <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadEventTrend(true) }} />
        } />
        {ph.eventTrend.loading ? <Skeleton h={200} /> : ph.eventTrend.error ? <ErrState msg={ph.eventTrend.error} /> :
         ph.eventTrend.data?.length === 0 ? <EmptyState /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ph.eventTrend.data ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, n) => [fmt(Number(v)), n === 'customEvents' ? 'Custom' : n === 'autoEvents' ? 'Auto-captured' : 'Users']} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={n => n === 'customEvents' ? 'Custom events' : n === 'autoEvents' ? 'Auto-captured' : 'Active users'} />
              <Bar dataKey="customEvents" stackId="a" fill={C.purple}  radius={[0,0,0,0]} />
              <Bar dataKey="autoEvents"   stackId="a" fill={C.blue}    radius={[3,3,0,0]} />
              <Line type="monotone" dataKey="users" stroke={C.orange} strokeWidth={2} dot={false} yAxisId={0} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Search bar */}
      <input
        type="search" placeholder="Filter events and pages…"
        value={search} onChange={e => setSearch(e.target.value)}
        style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '7px 12px', fontSize: 13, color: 'var(--tx-1)', width: '100%', boxSizing: 'border-box',
        }}
      />

      {/* Top events + Top pages side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Top Events Table */}
        <Card>
          <SectionHeader title="Top Events" sub={`${filteredEvents.length} events — last ${ph.days} days`} />
          {ph.topEvents.loading ? <Skeleton h={300} /> : ph.topEvents.error ? <ErrState msg={ph.topEvents.error} /> : (
            <div style={{ overflowY: 'auto', maxHeight: 380 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Event', 'Total', 'Users', 'Today', 'Trend'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12 }}>No events match</td></tr>
                  ) : filteredEvents.slice(0, 30).map(e => (
                    <tr key={e.event} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                      onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                      onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '6px 8px', maxWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {e.event.startsWith('$')
                            ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--surface-3)', color: 'var(--tx-3)' }}>auto</span>
                            : <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: C.purpleDim, color: C.purple }}>custom</span>
                          }
                          <span style={{ fontSize: 11, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }} title={e.event}>{e.event}</span>
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{fmt(e.total)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--tx-2)' }}>{fmt(e.uniqueUsers)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--tx-3)' }}>{fmt(e.today)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {e.changePct == null ? <span style={{ color: 'var(--tx-3)', fontSize: 10 }}>—</span>
                          : e.changePct > 0 ? <span style={{ color: C.green, fontSize: 10, fontWeight: 600 }}>+{e.changePct}%</span>
                          : e.changePct < 0 ? <span style={{ color: C.red, fontSize: 10, fontWeight: 600 }}>{e.changePct}%</span>
                          : <span style={{ color: 'var(--tx-3)', fontSize: 10 }}>0%</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Top Pages */}
        <Card>
          <SectionHeader title="Top Pages / Screens" sub={`Web paths + Mobile screens — last ${ph.days} days`} />
          {ph.pages.loading ? <Skeleton h={300} /> : (
            <div style={{ overflowY: 'auto', maxHeight: 380 }}>
              {filteredPages.length === 0 && !ph.pages.loading
                ? <EmptyState msg="No pageview data" />
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {filteredPages.map((p, i) => {
                      const maxViews = filteredPages[0]?.views || 1
                      const pct = Math.min(100, Math.round((p.views / maxViews) * 100))
                      return (
                        <div key={p.path} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16 }}>{i + 1}</span>
                            <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.path}>{shortPath(p.path) || '/'}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)', flexShrink: 0 }}>{fmt(p.views)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 16 }} />
                            <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: C.purple, borderRadius: 99, transition: 'width .4s' }} />
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>{fmt(p.uniqueUsers)} users</span>
                          </div>
                        </div>
                      )
                    })}
                    {/* Mobile screens */}
                    {(ph.screens.data ?? []).slice(0, 5).map((s, i) => (
                      <div key={`sc-${s.screen}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Smartphone size={11} color="var(--tx-3)" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--tx-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.screen}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)' }}>{fmt(s.views)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Users                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
function UsersPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'last_seen' | 'events' | 'sessions'>('last_seen')

  useEffect(() => { ph.loadUsers() }, [ph.days])

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return (ph.users.data ?? [])
      .filter(u => !s || u.distinctId.includes(s) || u.email?.toLowerCase().includes(s) || u.name?.toLowerCase().includes(s))
      .sort((a, b) =>
        sort === 'events' ? b.events - a.events :
        sort === 'sessions' ? b.sessions - a.sessions :
        new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
      )
  }, [ph.users.data, search, sort])

  function phUserUrl(distinctId: string) {
    return `${PH_BASE}/project/${process.env.NEXT_PUBLIC_POSTHOG_PROJECT_ID ?? '436283'}/person/${encodeURIComponent(distinctId)}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ph.users.error && <ErrState msg={ph.users.error} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="search" placeholder="Search by user ID, email, or name…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'var(--tx-1)', flex: 1 }}
        />
        <select
          value={sort} onChange={e => setSort(e.target.value as typeof sort)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: 'var(--tx-1)', cursor: 'pointer' }}
        >
          <option value="last_seen">Sort: Last seen</option>
          <option value="events">Sort: Most events</option>
          <option value="sessions">Sort: Most sessions</option>
        </select>
        <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadUsers(true) }} />
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                {['User', 'Country', 'Device', 'First Seen', 'Last Seen', 'Sessions', 'Events', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ph.users.loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      {Array.from({ length: 8 }).map((_, j) => <td key={j} style={{ padding: '8px 12px' }}><Skeleton h={14} /></td>)}
                    </tr>
                  ))
                : filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>No users found</td></tr>
                  ) : filtered.map(u => (
                    <tr key={u.distinctId} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                      onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                      onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '8px 12px', maxWidth: 180 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email || '—'}</p>
                        <p style={{ fontSize: 10, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{u.distinctId.slice(0, 24)}{u.distinctId.length > 24 ? '…' : ''}</p>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>{u.country || '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>
                        {u.os && <span style={{ marginRight: 4 }}>{u.os}</span>}
                        {u.browser && <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{u.browser}</span>}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-3)', whiteSpace: 'nowrap', fontSize: 11 }}>{fmtDate(u.firstSeen)}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', whiteSpace: 'nowrap', fontSize: 11 }} title={u.lastSeen}>{relTime(u.lastSeen)}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{u.sessions}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(u.events)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={phUserUrl(u.distinctId)} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.purple, fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
                          <ExternalLink size={11} /> PostHog
                        </a>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--tx-3)' }}>
          Showing {filtered.length} of {ph.users.data?.length ?? 0} users · last {ph.days} days
        </div>
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Sessions                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function SessionsPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [search, setSearch] = useState('')

  useEffect(() => { ph.loadSessions() }, [ph.days])

  function replayUrl(sessionId: string) {
    return `${PH_BASE}/project/${PH_PROJ_ID}/replay/${sessionId}`
  }

  const sessions = ph.sessions.data ?? []
  const filtered = sessions.filter(s =>
    !search || s.sessionId.includes(search) || s.userId.includes(search)
      || s.browser.toLowerCase().includes(search.toLowerCase())
      || s.country.toLowerCase().includes(search.toLowerCase())
  )

  const avgDur = sessions.length > 0
    ? Math.round(sessions.reduce((a, s) => a + s.durationSec, 0) / sessions.length)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ph.sessions.error && <ErrState msg={ph.sessions.error} />}

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {([
          { label: 'Total Sessions', value: fmt(sessions.length), color: C.blue,
            tip: 'Total sessions recorded in this period. A session groups all events from one user within a continuous window — a new session starts after 30 minutes of inactivity.' },
          { label: 'Avg Duration', value: fmtDur(avgDur), color: C.purple,
            tip: 'Average (mean) session duration — the sum of all session lengths divided by the session count. Because it is an average, a few very long sessions from power users can raise this figure significantly. For a more representative measure, see the Pathways tab where the median is also shown.' },
          { label: 'Avg Pages/Session', value: sessions.length > 0 ? (sessions.reduce((a, s) => a + s.pages, 0) / sessions.length).toFixed(1) : '—', color: C.teal,
            tip: 'Average number of distinct pages (unique URL paths) visited per session. Higher values suggest users explore more of the product. Low values could indicate poor navigation or users not finding what they need.' },
          { label: 'Avg Events/Session', value: sessions.length > 0 ? fmt(Math.round(sessions.reduce((a, s) => a + s.eventCount, 0) / sessions.length)) : '—', color: C.orange,
            tip: 'Average total number of events (all types combined) fired per session. This includes page views, button clicks, screen views, and any custom events your app tracks. A proxy for user engagement depth.' },
        ] as const).map(k => (
          <div key={k.label} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{k.label}</p>
              <InfoTooltip text={k.tip} />
            </div>
            <p style={{ fontSize: 20, fontWeight: 800, color: k.color, fontVariantNumeric: 'tabular-nums' }}>{ph.sessions.loading ? '…' : k.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="search" placeholder="Filter by session ID, user, browser, country…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'var(--tx-1)', flex: 1 }}
        />
        <DaysControl value={Math.min(ph.days, 14)} onChange={d => { ph.setDays(d); ph.loadSessions(true) }} />
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {['Started', 'User', 'Browser / OS', 'Country', 'Duration', 'Pages', 'Events', 'Replay'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ph.sessions.loading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      {Array.from({ length: 8 }).map((_, j) => <td key={j} style={{ padding: '8px 12px' }}><Skeleton h={14} /></td>)}
                    </tr>
                  ))
                : filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>No sessions found</td></tr>
                  ) : filtered.map(s => (
                    <tr key={s.sessionId} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                      onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                      onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--tx-2)', fontSize: 11 }} title={s.startedAt}>{relTime(s.startedAt)}</td>
                      <td style={{ padding: '8px 12px', maxWidth: 130 }}>
                        <span style={{ fontSize: 10, color: 'var(--tx-3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{s.userId.slice(0, 20)}{s.userId.length > 20 ? '…' : ''}</span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--tx-2)' }}>{[s.browser, s.os].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)' }}>{s.country || '—'}</td>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: s.durationSec > 300 ? C.green : 'var(--tx-1)', whiteSpace: 'nowrap' }}>{fmtDur(s.durationSec)}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{s.pages}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{s.eventCount}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={replayUrl(s.sessionId)} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.purple, fontSize: 11, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          <Eye size={11} /> Watch
                        </a>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--tx-3)' }}>
          {filtered.length} sessions shown · up to 14 days · click Watch to view session replay in PostHog
        </div>
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Platform                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function PlatformPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [platTab, setPlatTab] = useState<'overview' | 'geography' | 'devices' | 'network'>('overview')

  useEffect(() => {
    ph.loadPlatforms()
  }, [ph.days])

  useEffect(() => {
    if (platTab === 'geography') ph.loadGeoDetail()
    if (platTab === 'devices' || platTab === 'network') ph.loadDeviceDetail()
  }, [platTab, ph.days])

  const plat   = ph.platforms.data
  const geo    = ph.geoDetail.data
  const dev    = ph.deviceDetail.data
  const platLoading = ph.platforms.loading
  const geoLoading  = ph.geoDetail.loading
  const devLoading  = ph.deviceDetail.loading

  const PLAT_TABS = [
    { id: 'overview' as const,   label: '📊 Overview' },
    { id: 'geography' as const,  label: '🌍 Geography' },
    { id: 'devices' as const,    label: '📱 Devices' },
    { id: 'network' as const,    label: '📡 Network' },
  ]

  function DonutChart({ data, title }: { data: { name: string; users: number }[]; title: string }) {
    const total = data.reduce((a, d) => a + d.users, 0)
    return (
      <Card>
        <SectionHeader title={title} />
        {platLoading ? <Skeleton h={180} /> :
         data.length === 0 ? <EmptyState /> : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={data} dataKey="users" nameKey="name" cx="50%" cy="50%"
                  innerRadius={45} outerRadius={70} paddingAngle={2} strokeWidth={0}>
                  {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, n) => [`${fmt(Number(v))} users (${total > 0 ? Math.round((Number(v)/total)*100) : 0}%)`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
              {data.slice(0, 6).map((d, i) => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span style={{ fontSize: 11, color: 'var(--tx-2)', flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.users)}</span>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 30, textAlign: 'right' }}>{total > 0 ? Math.round((d.users / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    )
  }

  function RankedList({ items }: { items: { name: string; users: number }[] }) {
    const max = items[0]?.users || 1
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {items.map((item, i) => {
          const pct = Math.round((item.users / max) * 100)
          return (
            <div key={item.name} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16, flexShrink: 0 }}>{i+1}</span>
                <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }}>{fmt(item.users)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 24 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99 }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.platforms.error && <ErrState msg={ph.platforms.error} />}
      {ph.geoDetail.error  && <ErrState msg={ph.geoDetail.error} />}
      {ph.deviceDetail.error && <ErrState msg={ph.deviceDetail.error} />}

      {/* Sub-nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {PLAT_TABS.map(t => (
            <button key={t.id} onClick={() => setPlatTab(t.id)} style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: platTab === t.id ? C.purpleDim : 'var(--surface-2)',
              color: platTab === t.id ? C.purple : 'var(--tx-3)',
              border: `1px solid ${platTab === t.id ? C.purple + '55' : 'var(--border)'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadPlatforms(true) }} />
      </div>

      {/* ── OVERVIEW ── */}
      {platTab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
            <DonutChart data={plat?.os ?? []}      title="Operating System" />
            <DonutChart data={plat?.browser ?? []} title="Browser" />
            <DonutChart data={plat?.device ?? []}  title="Device Type" />
          </div>
          <Card>
            <SectionHeader title="Top Countries" sub={`Unique users by country · last ${ph.days} days`} />
            {platLoading ? <Skeleton h={200} /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={(plat?.country ?? []).slice(0, 12)} layout="vertical" margin={{ left: 10, right: 50, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--tx-2)' }} width={100} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={v => [fmt(Number(v)), 'Users']} />
                  <Bar dataKey="users" radius={[0, 4, 4, 0]} fill={C.teal}>
                    <LabelList dataKey="users" position="right" style={{ fontSize: 10, fill: 'var(--tx-3)' }} formatter={(v: unknown) => fmt(Number(v))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </>
      )}

      {/* ── GEOGRAPHY ── */}
      {platTab === 'geography' && (
        <>
          {/* Continent donut + timezone list */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <SectionHeader title="Continents" sub="Users by world region" />
              {geoLoading ? <Skeleton h={180} /> : !geo?.continents.length ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={geo.continents} dataKey="users" nameKey="continent" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={2}>
                      {geo.continents.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, n) => [fmt(Number(v)), n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
            <Card>
              <SectionHeader title="Timezones" sub="Where in the world users are" />
              {geoLoading ? <Skeleton h={180} /> : !geo?.timezones.length ? <EmptyState /> : (
                <div style={{ overflowY: 'auto', maxHeight: 220 }}>
                  <RankedList items={(geo.timezones ?? []).map(t => ({ name: t.tz, users: t.users }))} />
                </div>
              )}
            </Card>
          </div>

          {/* Countries detailed */}
          <Card>
            <SectionHeader title="Countries" sub="All countries with user activity" />
            {geoLoading ? <Skeleton h={160} /> : (
              <ResponsiveContainer width="100%" height={Math.max(160, Math.min((plat?.country ?? []).length * 30, 320))}>
                <BarChart data={plat?.country ?? []} layout="vertical" margin={{ left: 10, right: 50, top: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--tx-2)' }} width={120} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={v => [fmt(Number(v)), 'Users']} />
                  <Bar dataKey="users" radius={[0, 4, 4, 0]}>
                    {(plat?.country ?? []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    <LabelList dataKey="users" position="right" style={{ fontSize: 10, fill: 'var(--tx-3)' }} formatter={(v: unknown) => fmt(Number(v))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Cities + Regions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <SectionHeader title="Top Cities" sub="City-level breakdown" />
              {geoLoading ? <Skeleton h={260} /> : !geo?.cities.length ? <EmptyState msg="No city data available" /> : (
                <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                  {(geo.cities).map((c, i) => (
                    <div key={`${c.city}-${c.country}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16 }}>{i+1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--tx-1)', fontWeight: 600 }}>{c.city}</span>
                          <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 5 }}>{c.country}</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(c.users)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <SectionHeader title="States / Regions" sub="Sub-national breakdown" />
              {geoLoading ? <Skeleton h={260} /> : !geo?.regions.filter(r => r.region !== 'Unknown').length ? <EmptyState msg="No region data available" /> : (
                <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                  {(geo.regions.filter(r => r.region !== 'Unknown')).map((r, i) => (
                    <div key={`${r.region}-${r.country}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16 }}>{i+1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--tx-1)', fontWeight: 600 }}>{r.region}</span>
                          <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 5 }}>{r.country}</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(r.users)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ── DEVICES ── */}
      {platTab === 'devices' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <SectionHeader title="OS Versions" sub="Operating system + version breakdown" />
              {devLoading ? <Skeleton h={260} /> : !dev?.osVersions.length ? <EmptyState /> : (
                <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                  <RankedList items={(dev.osVersions).map(v => ({ name: v.version || 'Unknown', users: v.users }))} />
                </div>
              )}
            </Card>
            <Card>
              <SectionHeader title="Browser Versions" sub="Browser + version breakdown" />
              {devLoading ? <Skeleton h={260} /> : !dev?.browserVersions.length ? <EmptyState /> : (
                <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                  <RankedList items={(dev.browserVersions).map(v => ({ name: v.version || 'Unknown', users: v.users }))} />
                </div>
              )}
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Card>
              <SectionHeader title="Screen Resolutions" sub="Device screen size (width × height)" />
              {devLoading ? <Skeleton h={200} /> : !dev?.screenSizes.filter(s => s.size !== '0×0').length ? <EmptyState msg="No screen data captured" /> : (
                <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                  {(dev.screenSizes.filter(s => s.size !== '0×0')).map((s, i) => {
                    const max = dev.screenSizes[0]?.users || 1
                    const pct = Math.round((s.users / max) * 100)
                    const w = parseInt(s.size.split('×')[0])
                    const label = w >= 1920 ? 'Desktop HD' : w >= 1280 ? 'Desktop' : w >= 768 ? 'Tablet' : 'Mobile'
                    return (
                      <div key={s.size} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, fontFamily: 'monospace' }}>{s.size}</span>
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: C.purpleDim, color: C.purple }}>{label}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(s.users)}</span>
                        </div>
                        <div style={{ height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
            <Card>
              <SectionHeader title="Device Models" sub="Specific device / hardware model" />
              {devLoading ? <Skeleton h={200} /> : !dev?.deviceModels.filter(d => d.model !== 'Unknown').length ? <EmptyState msg="No device model data (web users don't expose model)" /> : (
                <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                  <RankedList items={(dev.deviceModels.filter(d => d.model !== 'Unknown')).map(d => ({ name: d.model, users: d.users }))} />
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ── NETWORK ── */}
      {platTab === 'network' && (
        <>
          <Card>
            <SectionHeader title="Network / Carrier" sub="Mobile carrier or connection type captured at event time" />
            {devLoading ? <Skeleton h={180} /> : !dev?.networkTypes.filter(n => n.network !== 'Unknown').length ? <EmptyState msg="No network carrier data — only captured on mobile apps that pass $network_carrier" /> : (
              <RankedList items={(dev.networkTypes.filter(n => n.network !== 'Unknown')).map(n => ({ name: n.network, users: n.users }))} />
            )}
          </Card>

          {/* Battery / Power — not available notice */}
          <Card style={{ border: `1px solid ${C.amber}44`, background: C.amberDim }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.amber, marginBottom: 4 }}>Battery & Power Usage — Not Available</p>
                <p style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.6 }}>
                  Browser battery level data is not available. The W3C Battery Status API was deprecated in 2019 and has been removed from Firefox and Safari due to fingerprinting privacy concerns. Chrome retains it but only in secure contexts and it is not captured by PostHog&apos;s autocapture SDK.
                </p>
                <p style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.6, marginTop: 8 }}>
                  To capture battery data on mobile, your native iOS/Android app would need to explicitly send a custom PostHog event (e.g. <code style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 3 }}>device_info</code>) with <code style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 3 }}>battery_level</code> and <code style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 3 }}>is_charging</code> properties.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Funnels                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */
function FunnelsPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  useEffect(() => { ph.loadFunnel() }, [ph.days])

  const steps = ph.funnel.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Critical Path Funnel — Yuzee</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Discovery → Search → Application journey · derived from PostHog events</p>
        </div>
        <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadFunnel(true) }} />
      </div>

      {ph.funnel.error && <ErrState msg={ph.funnel.error} />}

      {ph.funnel.loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={72} r={8} />)}
        </div>
      ) : steps.length === 0 ? <EmptyState msg="No funnel data found" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {steps.map((step, i) => (
            <div key={step.label}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '14px 18px', marginBottom: 0,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0, fontWeight: 800, fontSize: 14,
                  background: C.purple + '22', color: C.purple,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{step.label}</p>
                    <PillBadge label={`${step.pct}% of total`} color={step.pct > 50 ? C.green : step.pct > 20 ? C.amber : C.red} />
                    {i > 0 && step.dropPct > 0 && (
                      <PillBadge label={`↓ ${step.dropPct}% drop`} color={step.dropPct > 50 ? C.red : step.dropPct > 25 ? C.amber : C.grey} />
                    )}
                  </div>
                  <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{
                      width: `${step.pct}%`, height: '100%', borderRadius: 99, transition: 'width .6s ease',
                      background: step.pct > 50 ? C.green : step.pct > 20 ? C.amber : C.red,
                    }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmt(step.count)}</p>
                  <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 2 }}>users</p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 22px' }}>
                  <div style={{ width: 2, height: 24, background: 'var(--border)', marginLeft: 15 }} />
                  {steps[i + 1] && steps[i].count > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--tx-3)', marginLeft: 4 }}>
                      {steps[i].count - steps[i + 1].count > 0
                        ? `${fmt(steps[i].count - steps[i + 1].count)} users dropped off here`
                        : 'No drop-off'}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Card>
        <SectionHeader title="Funnel Chart" sub="Visualised conversion at each step" />
        {ph.funnel.loading ? <Skeleton h={200} /> : steps.length === 0 ? <EmptyState /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={steps} layout="vertical" margin={{ left: 10, right: 60, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: 'var(--tx-2)' }} width={160} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={v => [fmt(Number(v)), 'Users']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {steps.map((s, i) => (
                  <Cell key={i} fill={s.pct > 50 ? C.green : s.pct > 20 ? C.amber : C.red} />
                ))}
                <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: 'var(--tx-2)', fontWeight: 600 }} formatter={(v: unknown) => fmt(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <p style={{ fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--tx-2)' }}>How this funnel works:</strong> Each step counts unique users who triggered relevant events or visited matching paths during the period.
          Counts are independent (not sequential) — step N may be greater than step N+1 for users who skipped earlier steps.
          For strict sequential funnels, use PostHog&apos;s native Funnel Insight.{' '}
          <a href={`${PH_BASE}/project/436283/insights`} target="_blank" rel="noopener noreferrer" style={{ color: C.purple }}>Open PostHog Insights →</a>
        </p>
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Feature Flags                                                      */
/* ─────────────────────────────────────────────────────────────────────────── */
function FeatureFlagsPane({ ph, bugs }: { ph: ReturnType<typeof usePostHogAnalytics>; bugs: ParsedBug[] }) {
  const [search, setSearch] = useState('')

  useEffect(() => { ph.loadFeatureFlags() }, [])

  const flags = useMemo(() =>
    (ph.featureFlags.data ?? []).filter(f =>
      !search || f.key.includes(search) || f.name.toLowerCase().includes(search.toLowerCase())
    ), [ph.featureFlags.data, search])

  // Count how many bugs have each flag in their feature_flags JSON
  const flagBugCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    bugs.forEach(b => {
      if (!b.feature_flags) return
      try {
        const obj = JSON.parse(b.feature_flags as string)
        Object.keys(obj).forEach(k => { counts[k] = (counts[k] ?? 0) + 1 })
      } catch { /* skip */ }
    })
    return counts
  }, [bugs])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {ph.featureFlags.error && <ErrState msg={ph.featureFlags.error} />}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="search" placeholder="Search flags by key or name…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'var(--tx-1)', flex: 1 }}
        />
        <a href={`${PH_BASE}/project/${PH_PROJ_ID}/feature_flags`} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, background: C.purpleDim, color: C.purple, fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', border: `1px solid ${C.purple}44` }}>
          <ExternalLink size={13} /> Open in PostHog
        </a>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {[
          { label: 'Total Flags', value: ph.featureFlags.data?.length ?? 0, color: C.purple },
          { label: 'Enabled', value: (ph.featureFlags.data ?? []).filter(f => f.enabled).length, color: C.green },
          { label: 'Appear in Bug Reports', value: Object.keys(flagBugCounts).length, color: C.amber },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
            <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>{k.label}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{ph.featureFlags.loading ? '…' : k.value}</p>
          </div>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            <tr>
              {['Flag Key', 'Name', 'Status', 'Rollout', 'Groups', 'Bugs w/ Flag', 'Updated', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ph.featureFlags.loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    {Array.from({ length: 8 }).map((_, j) => <td key={j} style={{ padding: '10px 12px' }}><Skeleton h={14} /></td>)}
                  </tr>
                ))
              : flags.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>
                    {ph.featureFlags.data?.length === 0 ? 'No feature flags found in PostHog project' : 'No flags match search'}
                  </td></tr>
                ) : flags.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                    onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                    onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 12px' }}>
                      <code style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, color: C.purple }}>{f.key}</code>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--tx-1)', maxWidth: 180 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{f.name || '—'}</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <PillBadge label={f.enabled ? 'Enabled' : 'Disabled'} color={f.enabled ? C.green : C.grey} />
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--tx-1)' }}>
                      {f.rolloutPercentage != null ? `${f.rolloutPercentage}%` :
                       f.hasVariants ? 'Multi-variant' : f.groupCount > 0 ? 'Targeted' : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--tx-3)' }}>{f.groupCount}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {flagBugCounts[f.key]
                        ? <PillBadge label={`${flagBugCounts[f.key]} bugs`} color={C.amber} />
                        : <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--tx-3)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(f.updatedAt || f.createdAt)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <a href={`${PH_BASE}/project/${PH_PROJ_ID}/feature_flags/${f.id}`} target="_blank" rel="noopener noreferrer"
                        style={{ color: C.purple, fontSize: 11, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ExternalLink size={11} />
                      </a>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Pathways (screen-to-screen journey + session duration)             */
/* ─────────────────────────────────────────────────────────────────────────── */
function PathwaysPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [hoveredNode,    setHoveredNode]    = useState<string | null>(null)
  const [journeySort,    setJourneySort]    = useState<'count' | 'duration'>('count')
  const [searchQ,        setSearchQ]        = useState('')
  const [searchResults,  setSearchResults]  = useState<{ distinctId: string; email: string; name: string; lastSeen: string; events: number }[]>([])
  const [searchLoading,  setSearchLoading]  = useState(false)
  const [selectedUser,   setSelectedUser]   = useState<{ distinctId: string; email: string; name: string } | null>(null)
  const [expandedSess,   setExpandedSess]   = useState<string | null>(null)

  useEffect(() => {
    if (!searchQ.trim() || searchQ.length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const res = await fetch(`/api/posthog/analytics?type=user_search&q=${encodeURIComponent(searchQ)}`)
        if (res.ok) { const j = await res.json(); setSearchResults(j.users ?? []) }
      } finally { setSearchLoading(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ])

  useEffect(() => {
    if (selectedUser) ph.loadUserJourney(selectedUser.distinctId, true)
  }, [selectedUser, ph.days])

  useEffect(() => { ph.loadPathways() }, [ph.days])

  const d       = ph.pathways.data
  const loading = ph.pathways.loading

  /* SVG layout constants */
  const NODE_W = 152, NODE_H = 34, NODES_PER_COL = 5
  const COL_GAP = 108, SVG_PAD = 14, HEADER_H = 26, NODE_SPACING = 60
  // SVG_W = PAD + NODE_W + GAP + NODE_W + GAP + NODE_W + PAD = 14+152+108+152+108+152+14 = 700
  const SVG_W = SVG_PAD * 2 + NODE_W * 3 + COL_GAP * 2
  // SVG_H: header + (n-1)*spacing + nodeHeight + bottom pad
  const SVG_H = SVG_PAD + HEADER_H + (NODES_PER_COL - 1) * NODE_SPACING + NODE_H + SVG_PAD
  const COL_X: [number, number, number] = [
    SVG_PAD,
    SVG_PAD + NODE_W + COL_GAP,
    SVG_PAD + NODE_W * 2 + COL_GAP * 2,
  ]
  const COL_COLORS: [string, string, string] = [C.green, C.purple, C.red]
  const COL_LABELS = ['ENTRY', 'MID', 'EXIT']

  /* Build per-column node lists */
  const sankeyData = useMemo(() => {
    if (!d?.topPaths.length) return null
    const scores = new Map<string, [number, number, number]>()
    for (const p of d.topPaths) {
      p.screens.forEach((screen, idx) => {
        if (!screen || idx > 2) return
        const s = scores.get(screen) ?? [0, 0, 0]
        s[idx] += p.count
        scores.set(screen, s)
      })
    }
    const cols: [Map<string, number>, Map<string, number>, Map<string, number>] = [new Map(), new Map(), new Map()]
    for (const [screen, [c0, c1, c2]] of scores) {
      const max = Math.max(c0, c1, c2)
      const col = max === c0 ? 0 : max === c1 ? 1 : 2
      cols[col].set(screen, max)
    }
    const colNodes = cols.map(m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, NODES_PER_COL)) as
      [[string, number][], [string, number][], [string, number][]]
    return { colNodes }
  }, [d])

  /* Position map — node top-left corner */
  const nodeMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number; col: number; count: number }>()
    if (!sankeyData) return m
    sankeyData.colNodes.forEach((nodes, ci) => {
      nodes.forEach(([name, count], i) => {
        m.set(name, { x: COL_X[ci], y: SVG_PAD + HEADER_H + i * NODE_SPACING, col: ci, count })
      })
    })
    return m
  }, [sankeyData])

  const maxTrans = Math.max(...(d?.transitions ?? []).map(t => t.count), 1)

  /* Edges — ADJACENT COLUMNS ONLY so arcs stay in their inter-column lane */
  const edges = useMemo(() => {
    if (!d) return []
    return d.transitions
      .filter(t => {
        if (!nodeMap.has(t.from) || !nodeMap.has(t.to)) return false
        return nodeMap.get(t.to)!.col - nodeMap.get(t.from)!.col === 1
      })
      .slice(0, 40)
      .map((t, i) => {
        const f  = nodeMap.get(t.from)!
        const to = nodeMap.get(t.to)!
        const x1 = f.x + NODE_W,  y1 = f.y + NODE_H / 2
        const x2 = to.x,           y2 = to.y + NODE_H / 2
        const cx = (x1 + x2) / 2
        const w  = Math.max(1.5, (t.count / maxTrans) * 9)
        return { i, from: t.from, to: t.to, x1, y1, x2, y2, cx, count: t.count, w, colFrom: f.col }
      })
  }, [d, nodeMap, maxTrans])

  const totalPathSessions = (d?.topPaths ?? []).reduce((a, b) => a + b.count, 0)

  const sortedJourneys = useMemo(() =>
    [...(d?.topPaths ?? [])].sort((a, b) =>
      journeySort === 'duration' ? b.avgDurSec - a.avgDurSec : b.count - a.count
    ), [d?.topPaths, journeySort])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.pathways.error && <ErrState msg={ph.pathways.error} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>User Pathways</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Where users go, how long they stay, and when they leave</p>
        </div>
        <DaysControl value={ph.days} onChange={days => { ph.setDays(days); ph.loadPathways(true) }} />
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {([
          { label: 'Sessions Analysed',        value: loading ? '…' : fmt(d?.totalSessions ?? 0),        color: C.blue,
            tip: 'Number of unique sessions that contained at least one screen view or page view event in this period.' },
          { label: 'Avg Session Length',        value: loading ? '…' : fmtDur(d?.avgSessionSec ?? 0),    color: C.purple,
            tip: 'Average (arithmetic mean) session duration — the total time across all sessions divided by the number of sessions. One unusually long session can push this number up significantly, making it look longer than most users actually experience.' },
          { label: 'Median Session Length',     value: loading ? '…' : fmtDur(d?.medianSessionSec ?? 0), color: C.teal,
            tip: 'Median session duration — the midpoint value where half of all sessions are shorter and half are longer. Unlike the average, the median ignores outliers, so it represents the experience of a typical user more accurately. If median is much lower than average, a small number of very long sessions are skewing the average upward.' },
          { label: 'Unique Screen Transitions', value: loading ? '…' : fmt(d?.transitions.length ?? 0),  color: C.orange,
            tip: 'Number of distinct screen-to-screen pairs observed (e.g. Home → Search counts as one transition). Higher values indicate users explore more of the app.' },
        ] as const).map(k => (
          <div key={k.label} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{k.label}</p>
              <InfoTooltip text={k.tip} />
            </div>
            <p style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* ── Individual User Journey ── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Individual User Journey</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Search by email, name, or user ID to trace a single user's session history</p>
          </div>
          {selectedUser && (
            <button onClick={() => { setSelectedUser(null); setSearchQ(''); setSearchResults([]) }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7, fontSize: 12,
                background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--tx-2)', cursor: 'pointer' }}>
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px' }}>
            <Search size={14} color="var(--tx-3)" style={{ flexShrink: 0 }} />
            <input
              type="text" placeholder="Search users by email, name, or ID…" value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSelectedUser(null) }}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: 'var(--tx-1)' }}
            />
            {searchLoading && <RefreshCw size={12} color="var(--tx-3)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
          </div>

          {/* Dropdown results */}
          {searchResults.length > 0 && !selectedUser && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
              background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
              {searchResults.map(u => (
                <button key={u.distinctId} onClick={() => { setSelectedUser(u); setSearchResults([]) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: C.purpleDim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Users size={12} color={C.purple} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.name ? u.name : u.email ? u.email : <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{u.distinctId.slice(0, 28)}…</span>}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.name && u.email && u.email !== u.name && <>{u.email} · </>}
                      <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{u.distinctId.slice(0, 20)}…</span>
                      {' · '}{fmt(u.events)} events · {relTime(u.lastSeen)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchQ.length >= 2 && !searchLoading && searchResults.length === 0 && !selectedUser && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
              background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px',
              color: 'var(--tx-3)', fontSize: 12, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
              No users found matching "{searchQ}"
            </div>
          )}
        </div>

        {/* Selected user + journey */}
        {selectedUser && (() => {
          const jData  = ph.userJourney.data
          const jLoad  = ph.userJourney.loading
          const jErr   = ph.userJourney.error

          // Group events by sessionId
          const sessions = jData ? (() => {
            const map = new Map<string, typeof jData.events>()
            for (const ev of jData.events) {
              const sid = ev.sessionId || 'unknown'
              if (!map.has(sid)) map.set(sid, [])
              map.get(sid)!.push(ev)
            }
            return [...map.entries()].map(([sid, evs]) => ({
              sid,
              startedAt: evs[0]?.timestamp ?? '',
              duration: evs.length > 1 ? Math.round((new Date(evs[evs.length - 1].timestamp).getTime() - new Date(evs[0].timestamp).getTime()) / 1000) : 0,
              os: evs.find(e => e.os)?.os ?? '',
              browser: evs.find(e => e.browser)?.browser ?? '',
              events: evs,
            }))
          })() : []

          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 16, background: C.purpleDim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Users size={14} color={C.purple} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>{selectedUser.name || selectedUser.email || selectedUser.distinctId}</p>
                  <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                    {selectedUser.name && selectedUser.name !== selectedUser.email && <><strong style={{ color: 'var(--tx-2)' }}>{selectedUser.name}</strong> · </>}
                    {selectedUser.email || <span style={{ opacity: 0.5 }}>no email</span>} · ID: <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{selectedUser.distinctId.slice(0, 20)}…</span>
                  </p>
                </div>
                {!jLoad && <p style={{ fontSize: 12, color: 'var(--tx-3)', flexShrink: 0 }}>{sessions.length} sessions · {jData?.events.length ?? 0} events (last {ph.days}d)</p>}
              </div>

              {jLoad && <Skeleton h={120} />}
              {jErr  && <ErrState msg={jErr} />}
              {!jLoad && !jErr && sessions.length === 0 && <EmptyState msg="No events found for this user in the selected time range" />}
              {!jLoad && sessions.map(sess => {
                const isOpen = expandedSess === sess.sid
                return (
                  <div key={sess.sid} style={{ marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <button
                      onClick={() => setExpandedSess(isOpen ? null : sess.sid)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                        background: isOpen ? 'var(--surface-2)' : 'var(--surface-1)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <ChevronRight size={13} color="var(--tx-3)" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)' }}>{fmtDateTime(sess.startedAt)}</span>
                        {sess.os && <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{sess.os}</span>}
                        {sess.browser && <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{sess.browser}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--tx-3)', flexShrink: 0 }}>{sess.events.length} events · {fmtDur(sess.duration)}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '0 0 6px 0', maxHeight: 380, overflowY: 'auto' }}>
                        {sess.events.map((ev, ei) => {
                          const isScreen = ev.event === '$screen' || ev.event === '$pageview'
                          const isErr    = ev.event.toLowerCase().includes('error') || ev.event.toLowerCase().includes('exception')
                          const col      = isErr ? C.red : isScreen ? C.blue : 'var(--tx-2)'
                          return (
                            <div key={ei} style={{ display: 'flex', gap: 10, padding: '5px 14px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, color: 'var(--tx-3)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, width: 80 }}>
                                {new Date(ev.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span style={{ fontSize: 11, color: col, flexShrink: 0, fontWeight: isErr ? 700 : isScreen ? 600 : 400, minWidth: 80 }}>{ev.event}</span>
                              {ev.screen && <span style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.screen}</span>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {!selectedUser && !searchQ && (
          <EmptyState msg="Type a name, email, or user ID above to look up an individual user's journey" />
        )}
      </Card>

      {/* Sankey + Duration */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px,260px)', gap: 14 }}>
        <Card>
          <SectionHeader title="Screen Flow Diagram"
            sub="Entry → mid → exit · arc thickness = volume · hover nodes to trace paths" />
          {loading ? <Skeleton h={SVG_H} /> : !sankeyData ? <EmptyState msg="No pathway data for this period" /> : (
            <div style={{ overflowX: 'auto' }}>
              <svg
                width="100%"
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                style={{ minWidth: 480, display: 'block' }}
              >
                {/* Column header labels */}
                {COL_X.map((x, ci) => (
                  <text key={ci} x={x + NODE_W / 2} y={SVG_PAD + 13}
                    textAnchor="middle" fontSize={9} fill={COL_COLORS[ci]}
                    fontWeight="700" letterSpacing="2">
                    {COL_LABELS[ci]}
                  </text>
                ))}
                {/* Subtle divider under each column header */}
                {COL_X.map((x, ci) => (
                  <line key={`div-${ci}`}
                    x1={x} y1={SVG_PAD + 18} x2={x + NODE_W} y2={SVG_PAD + 18}
                    stroke={COL_COLORS[ci] + '33'} strokeWidth={1} />
                ))}

                {/* ── EDGES drawn first — nodes rendered on top ── */}
                {edges.map(e => {
                  const isHigh = hoveredNode === e.from || hoveredNode === e.to
                  const isDim  = hoveredNode !== null && !isHigh
                  return (
                    <path key={e.i}
                      d={`M ${e.x1} ${e.y1} C ${e.cx} ${e.y1}, ${e.cx} ${e.y2}, ${e.x2} ${e.y2}`}
                      fill="none"
                      stroke={COL_COLORS[e.colFrom]}
                      strokeWidth={isHigh ? e.w + 2 : e.w}
                      strokeOpacity={isDim ? 0.07 : isHigh ? 0.9 : 0.35}
                      style={{ transition: 'stroke-opacity .2s, stroke-width .15s' }}
                    >
                      <title>{`${e.from} → ${e.to}: ${fmt(e.count)} sessions`}</title>
                    </path>
                  )
                })}

                {/* ── NODES drawn last — OPAQUE background blocks edges behind them ── */}
                {sankeyData.colNodes.map((nodes, ci) =>
                  nodes.map(([name, count], i) => {
                    const x     = COL_X[ci]
                    const y     = SVG_PAD + HEADER_H + i * NODE_SPACING
                    const label = name.length > 19 ? name.slice(0, 18) + '…' : name
                    const isHov = hoveredNode === name
                    const hasHov = hoveredNode !== null
                    const isConn = hasHov && edges.some(e =>
                      (e.from === name || e.to === name) &&
                      (e.from === hoveredNode || e.to === hoveredNode)
                    )
                    const alpha = hasHov && !isHov && !isConn ? 0.3 : 1

                    return (
                      <g key={`n-${ci}-${i}`}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredNode(name)}
                        onMouseLeave={() => setHoveredNode(null)}
                      >
                        {/* Opaque fill so arcs behind are hidden */}
                        <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={5}
                          fill="var(--surface-2)"
                          stroke={COL_COLORS[ci]}
                          strokeWidth={isHov ? 2 : 1}
                          opacity={alpha}
                          style={{ transition: 'opacity .2s, stroke-width .15s' }}
                        />
                        <text x={x + 8} y={y + NODE_H / 2 + 4}
                          fontSize={9.5} fill={COL_COLORS[ci]}
                          fontFamily="ui-monospace,monospace"
                          opacity={alpha}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}>
                          {label}
                        </text>
                        <text x={x + NODE_W - 6} y={y + NODE_H / 2 + 4}
                          fontSize={9} fill={COL_COLORS[ci]}
                          textAnchor="end" fontWeight="700"
                          opacity={alpha}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}>
                          {fmt(count)}
                        </text>
                        <title>{`${name}\n${fmt(count)} sessions`}</title>
                      </g>
                    )
                  })
                )}
              </svg>
            </div>
          )}
          {!loading && sankeyData && (
            <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 8 }}>
              Hover a node to highlight its connections · only adjacent-column transitions shown
            </p>
          )}
        </Card>

        {/* Session duration before drop-off */}
        <Card>
          <SectionHeader title="Time Before Drop-off" sub="How long users stay before leaving" />
          {loading ? <Skeleton h={SVG_H} /> : !d?.timeBeforeDropoff.length ? <EmptyState /> : (
            <>
              <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Avg</p>
                    <InfoTooltip text="Average (mean) session length — sum of all durations divided by session count. Sensitive to outliers: a handful of very long power-user sessions can raise this well above what most users experience." />
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.purple }}>{fmtDur(d.avgSessionSec)}</p>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Median</p>
                    <InfoTooltip text="Median session length — the middle value when all sessions are sorted by duration. Exactly 50% of sessions are shorter than this, 50% are longer. A better measure of the typical user experience than the average, because it ignores extreme outliers. If median is much shorter than average, a small number of very long sessions are skewing the average upward." />
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.teal }}>{fmtDur(d.medianSessionSec)}</p>
                </div>
              </div>
              {(() => {
                const maxS   = Math.max(...d.timeBeforeDropoff.map(b => b.sessions), 1)
                const colors = [C.red, C.amber, C.blue, C.teal, C.green]
                return d.timeBeforeDropoff.map((b, i) => (
                  <div key={b.bucket} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-2)' }}>{b.bucket}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: colors[i % colors.length], fontVariantNumeric: 'tabular-nums' }}>{fmt(b.sessions)}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden', marginBottom: 3 }}>
                      <div style={{ width: `${Math.round((b.sessions / maxS) * 100)}%`, height: '100%', background: colors[i % colors.length], borderRadius: 99, transition: 'width .5s' }} />
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--tx-3)' }}>avg {fmtDur(b.avgSec)} in session</p>
                  </div>
                ))
              })()}
            </>
          )}
        </Card>
      </div>

      {/* Top journeys + Transition table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Most Common Journeys</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Top 3-screen paths · green=entry, red=last seen screen</p>
            </div>
            <select
              value={journeySort}
              onChange={e => setJourneySort(e.target.value as typeof journeySort)}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: 'var(--tx-2)', cursor: 'pointer' }}
            >
              <option value="count">Sort: Volume</option>
              <option value="duration">Sort: Duration</option>
            </select>
          </div>
          {loading ? <Skeleton h={320} /> : !d?.topPaths.length ? <EmptyState msg="No journey data" /> : (
            <div style={{ overflowY: 'auto', maxHeight: 380 }}>
              {sortedJourneys.slice(0, 15).map((p, i) => {
                const pct = totalPathSessions > 0 ? Math.round((p.count / totalPathSessions) * 100) : 0
                return (
                  <div key={i}
                    style={{ padding: '8px 4px', borderBottom: '1px solid var(--border)', transition: 'background .1s', borderRadius: 4, cursor: 'default' }}
                    onMouseEnter={el => {
                      (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                      setHoveredNode(p.screens[0] ?? null)
                    }}
                    onMouseLeave={el => {
                      (el.currentTarget as HTMLElement).style.background = 'transparent'
                      setHoveredNode(null)
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16, flexShrink: 0, paddingTop: 3 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                          {p.screens.map((screen, si) => {
                            const isEntry = si === 0
                            const isLast  = si === p.screens.length - 1
                            const color   = isEntry ? C.green : isLast ? C.red : C.purple
                            const bg      = isEntry ? C.greenDim : isLast ? C.redDim : C.purpleDim
                            return (
                              <span key={si} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace',
                                  background: bg, color, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap', display: 'block' }} title={screen}>
                                  {screen.length > 18 ? screen.slice(0, 17) + '…' : screen}
                                </span>
                                {si < p.screens.length - 1 && <ChevronRight size={10} color="var(--tx-3)" />}
                              </span>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div style={{ flex: 1, maxWidth: 80, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: C.purple, borderRadius: 99 }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{fmt(p.count)} sessions · {pct}%</span>
                          {p.avgDurSec > 0 && <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>avg {fmtDur(p.avgDurSec)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 10px' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Screen Transitions</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Hover to highlight in the flow diagram</p>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 390 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {['#', 'From', 'To', 'Volume'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i}>{[1,2,3,4].map(j => <td key={j} style={{ padding: '8px 10px' }}><Skeleton h={14} /></td>)}</tr>
                    ))
                  : !d?.transitions.length ? (
                      <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>No transition data</td></tr>
                    ) : d.transitions.slice(0, 30).map((t, i) => {
                      const maxCount  = d.transitions[0]?.count ?? 1
                      const isRelated = hoveredNode === t.from || hoveredNode === t.to
                      return (
                        <tr key={i}
                          style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s',
                            background: isRelated ? 'var(--surface-2)' : 'transparent' }}
                          onMouseEnter={el => {
                            (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                            setHoveredNode(t.from)
                          }}
                          onMouseLeave={el => {
                            (el.currentTarget as HTMLElement).style.background = isRelated ? 'var(--surface-2)' : 'transparent'
                            setHoveredNode(null)
                          }}
                        >
                          <td style={{ padding: '7px 10px', color: 'var(--tx-3)', fontSize: 10, width: 22 }}>{i + 1}</td>
                          <td style={{ padding: '7px 10px', maxWidth: 130 }}>
                            <code style={{ fontSize: 10, color: C.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={t.from}>{t.from}</code>
                          </td>
                          <td style={{ padding: '7px 10px', maxWidth: 130 }}>
                            <code style={{ fontSize: 10, color: C.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={t.to}>{t.to}</code>
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 44, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.round((t.count / maxCount) * 100)}%`, height: '100%', background: C.purple, borderRadius: 99 }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{fmt(t.count)}</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                }
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Drop-off Analysis                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
function DropoffPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [view, setView] = useState<'mobile' | 'web'>('mobile')

  useEffect(() => { ph.loadDropoff() }, [ph.days])

  const d = ph.dropoff.data
  const loading = ph.dropoff.loading

  const exitData = view === 'mobile'
    ? (d?.exitScreens ?? []).slice(0, 12)
    : (d?.exitPages   ?? []).slice(0, 12).map(p => ({ screen: p.page, exits: p.exits, users: p.users }))

  const maxExits = exitData[0]?.exits || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.dropoff.error && <ErrState msg={ph.dropoff.error} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Drop-off Analysis</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Where users leave, what they did last, and how deep they go</p>
        </div>
        <DaysControl value={ph.days} onChange={d2 => { ph.setDays(d2); ph.loadDropoff(true) }} />
      </div>

      {/* Session depth distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>Session Depth Distribution</p>
                <InfoTooltip text="Depth = number of events in a session. A session with 1 event is a bounce — the user arrived and left without interacting. Sessions with 20+ events are deep explorers. A healthy app should see most sessions in the 4–20 event range." />
              </div>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>How many events users trigger before leaving</p>
            </div>
          </div>
          {loading ? <Skeleton h={200} /> : !d?.depth.length ? <EmptyState /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.depth} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: 'var(--tx-3)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, name) => [
                  name === 'sessions' ? `${fmt(Number(v))} sessions` : `${Math.round(Number(v))}s avg`,
                  name === 'sessions' ? 'Sessions' : 'Avg Duration',
                ]} />
                <Bar dataKey="sessions" fill={C.purple} radius={[4, 4, 0, 0]}>
                  {(d.depth).map((_, i) => {
                    const colors = [C.red, C.amber, C.amber, C.blue, C.teal, C.green]
                    return <Cell key={i} fill={colors[i] ?? C.purple} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {!loading && d?.depth && (
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 8 }}>
              {(() => {
                const bounced = d.depth.find(b => b.bucket === '1 event')
                const total = d.depth.reduce((a, b) => a + b.sessions, 0)
                if (!bounced || !total) return null
                return `Bounce sessions (1 event only): ${Math.round((bounced.sessions / total) * 100)}% of total`
              })()}
            </p>
          )}
        </Card>

        {/* Last action before drop-off */}
        <Card>
          <SectionHeader title="Last Action Before Drop-off" sub="What users did right before leaving" />
          {loading ? <Skeleton h={200} /> : !d?.lastAction.length ? <EmptyState /> : (
            <div style={{ overflowY: 'auto', maxHeight: 220 }}>
              {d.lastAction.slice(0, 12).map((a, i) => {
                const pct = Math.round((a.sessions / (d.lastAction[0]?.sessions || 1)) * 100)
                const isAuto = a.event.startsWith('$')
                return (
                  <div key={a.event} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--tx-3)', width: 14, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                        background: isAuto ? 'var(--surface-3)' : C.orangeDim,
                        color: isAuto ? 'var(--tx-3)' : C.orange,
                      }}>{isAuto ? 'auto' : 'custom'}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.event}>{a.event}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)', flexShrink: 0 }}>{fmt(a.sessions)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ width: 14, flexShrink: 0 }} />
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.orange, borderRadius: 99, transition: 'width .4s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>{fmt(a.users)} users</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Exit screen/page analysis */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Where Users Exit</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Last screen/page before ending the session</p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['mobile', 'web'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                background: view === v ? C.tealDim : 'var(--surface-2)',
                color: view === v ? C.teal : 'var(--tx-3)',
                border: `1px solid ${view === v ? C.teal + '55' : 'var(--border)'}`,
              }}>{v === 'mobile' ? '📱 Mobile' : '🌐 Web'}</button>
            ))}
          </div>
        </div>

        {loading ? <Skeleton h={240} /> : exitData.length === 0 ? <EmptyState msg={`No ${view} exit data for this period`} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Bar list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {exitData.map((item, i) => {
                const pct = Math.round((item.exits / maxExits) * 100)
                return (
                  <div key={item.screen} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 16, flexShrink: 0 }}>{i + 1}</span>
                      <ArrowDown size={10} color={C.red} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.screen}>{item.screen}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.red, flexShrink: 0 }}>{fmt(item.exits)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ width: 16, flexShrink: 0 }} />
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.red, borderRadius: 99, transition: 'width .4s', opacity: 0.6 + 0.4 * (1 - i / exitData.length) }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0, width: 60, textAlign: 'right' }}>{fmt(item.users)} users</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Entry screens — where they start */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.07em' }}>
                Entry points (where sessions begin)
              </p>
              {(d?.entryScreens ?? []).slice(0, 10).map((e, i) => {
                const maxS = d?.entryScreens[0]?.sessions || 1
                const pct = Math.round((e.sessions / maxS) * 100)
                return (
                  <div key={e.screen} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 14 }}>{i + 1}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.screen}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.green }}>{fmt(e.sessions)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ width: 14 }} />
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.green, borderRadius: 99, transition: 'width .4s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 80, textAlign: 'right' }}>{e.avgEventsAfter} events avg</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Module Engagement                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */
function ModulesPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [sort, setSort] = useState<'views' | 'users' | 'engagement'>('views')

  useEffect(() => { ph.loadModules() }, [ph.days])

  const modules = useMemo(() => {
    const list = ph.modules.data?.modules ?? []
    return [...list].sort((a, b) =>
      sort === 'users'      ? b.users - a.users :
      sort === 'engagement' ? b.avgEventsPerSession - a.avgEventsPerSession :
      b.views - a.views
    )
  }, [ph.modules.data, sort])

  const maxViews = modules[0]?.views || 1
  const maxEngage = Math.max(...modules.map(m => m.avgEventsPerSession), 1)

  const engageColor = (score: number) => {
    if (score >= maxEngage * 0.7) return C.green
    if (score >= maxEngage * 0.4) return C.teal
    if (score >= maxEngage * 0.2) return C.blue
    return C.grey
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.modules.error && <ErrState msg={ph.modules.error} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Module Engagement</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Which parts of the app users visit most and spend the most time in</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={sort} onChange={e => setSort(e.target.value as typeof sort)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, color: 'var(--tx-1)', cursor: 'pointer' }}
          >
            <option value="views">Sort: Most viewed</option>
            <option value="users">Sort: Most users</option>
            <option value="engagement">Sort: Most engaged</option>
          </select>
          <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadModules(true) }} />
        </div>
      </div>

      {/* Summary KPIs */}
      {!ph.modules.loading && modules.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {[
            { label: 'Most Visited', value: modules.sort((a,b) => b.views-a.views)[0]?.module ?? '—', color: C.purple, sub: `${fmt(modules[0]?.views ?? 0)} views` },
            { label: 'Most Users', value: [...modules].sort((a,b) => b.users-a.users)[0]?.module ?? '—', color: C.teal, sub: `${fmt([...modules].sort((a,b) => b.users-a.users)[0]?.users ?? 0)} unique users` },
            { label: 'Most Engaging', value: [...modules].sort((a,b) => b.avgEventsPerSession-a.avgEventsPerSession)[0]?.module ?? '—', color: C.green, sub: `${[...modules].sort((a,b) => b.avgEventsPerSession-a.avgEventsPerSession)[0]?.avgEventsPerSession ?? 0} events/session` },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>{k.label}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: k.color, lineHeight: 1.2 }}>{k.value}</p>
              <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 3 }}>{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(280px,340px)', gap: 14 }}>
        {/* Bar chart of views */}
        <Card>
          <SectionHeader title="Views by Module" sub={`Sorted by ${sort} · last ${ph.days} days`} />
          {ph.modules.loading ? <Skeleton h={300} /> : modules.length === 0 ? <EmptyState msg="No module data yet" /> : (
            <ResponsiveContainer width="100%" height={Math.max(240, modules.slice(0, 14).length * 34)}>
              <BarChart
                data={modules.slice(0, 14).map(m => ({ ...m, engageScore: Math.round(m.avgEventsPerSession * 10) / 10 }))}
                layout="vertical"
                margin={{ left: 10, right: 60, top: 0, bottom: 0 }}
              >
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                <YAxis type="category" dataKey="module" tick={{ fontSize: 11, fill: 'var(--tx-2)' }} width={100} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, name) => [
                  name === 'views' ? `${fmt(Number(v))} views` :
                  name === 'users' ? `${fmt(Number(v))} users` :
                  `${v} events/session`, name,
                ]} />
                <Bar dataKey={sort === 'engagement' ? 'engageScore' : sort} radius={[0, 4, 4, 0]}>
                  {modules.slice(0, 14).map((m, i) => (
                    <Cell key={m.module} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                  <LabelList
                    dataKey={sort === 'engagement' ? 'engageScore' : sort}
                    position="right"
                    style={{ fontSize: 10, fill: 'var(--tx-3)' }}
                    formatter={(v: unknown) => sort === 'engagement' ? `${v}/s` : fmt(Number(v))}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Engagement table */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 0' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Engagement Breakdown</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2, marginBottom: 12 }}>Events/session = time-in-module proxy</p>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 380 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {([
                    { h: 'Module',   tip: null },
                    { h: 'Views',    tip: 'Total number of times this module was opened (all users combined).' },
                    { h: 'Users',    tip: 'Distinct users who visited this module at least once in this period.' },
                    { h: 'Sessions', tip: 'Number of distinct sessions that included at least one visit to this module.' },
                    { h: 'Engage',   tip: 'Average events per session in this module — a proxy for how deeply users interact. Higher = more engagement. Calculated as total events in the module divided by sessions that touched it.' },
                  ]).map(({ h, tip }) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{h}{tip && <InfoTooltip text={tip} />}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ph.modules.loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 5 }).map((_, j) => <td key={j} style={{ padding: '8px 12px' }}><Skeleton h={14} /></td>)}</tr>
                    ))
                  : modules.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>No data</td></tr>
                    ) : modules.map((m, i) => (
                      <tr key={m.module} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                        onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                        onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                      >
                        <td style={{ padding: '7px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)' }}>{m.module}</span>
                          </div>
                        </td>
                        <td style={{ padding: '7px 12px', fontVariantNumeric: 'tabular-nums', color: 'var(--tx-1)', fontWeight: 600 }}>{fmt(m.views)}</td>
                        <td style={{ padding: '7px 12px', fontVariantNumeric: 'tabular-nums', color: 'var(--tx-2)' }}>{fmt(m.users)}</td>
                        <td style={{ padding: '7px 12px', fontVariantNumeric: 'tabular-nums', color: 'var(--tx-3)' }}>{fmt(m.sessions)}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 36, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                              <div style={{ width: `${Math.round((m.avgEventsPerSession / maxEngage) * 100)}%`, height: '100%', background: engageColor(m.avgEventsPerSession), borderRadius: 99, transition: 'width .4s' }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: engageColor(m.avgEventsPerSession), flexShrink: 0 }}>{m.avgEventsPerSession}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
          {!ph.modules.loading && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--tx-3)' }}>
              {modules.length} modules · Engage = avg events fired while in that module per session
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: AI Usage                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */
function AIUsagePane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [userSort, setUserSort] = useState<'requests' | 'tokens' | 'cost'>('requests')
  const [search, setSearch] = useState('')

  useEffect(() => { ph.loadAiUsage() }, [ph.days])

  const ai = ph.aiUsage.data
  const loading = ph.aiUsage.loading

  const sortedUsers = useMemo(() => {
    const u = (ai?.users ?? [])
      .filter(u => !search || u.email?.toLowerCase().includes(search) || u.name?.toLowerCase().includes(search) || u.distinctId.includes(search))
    return [...u].sort((a, b) =>
      userSort === 'tokens' ? b.tokens - a.tokens :
      userSort === 'cost'   ? b.cost   - a.cost   :
      b.requests - a.requests
    )
  }, [ai?.users, userSort, search])

  const fmtCost = (c: number) => c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`

  const noData = !loading && !ai?.overview.totalRequests

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.aiUsage.error && <ErrState msg={ph.aiUsage.error} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>AI Feature Usage</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Which users use AI most, token consumption, and estimated cost</p>
        </div>
        <DaysControl value={ph.days} onChange={d => { ph.setDays(d); ph.loadAiUsage(true) }} />
      </div>

      {noData && (
        <div style={{ padding: '14px 16px', background: C.amberDim, border: `1px solid ${C.amber}44`, borderRadius: 8, fontSize: 12, color: C.amber }}>
          <strong>No AI events found</strong> — AI usage tracking requires events with <code>ai_</code>, <code>gemini</code>, or <code>tokens_used</code> properties in PostHog.
          Ask your mobile/frontend team to instrument AI feature calls.
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <KpiCard label="Total AI Requests" value={loading ? '…' : fmt(ai?.overview.totalRequests ?? 0)} color={C.purple} icon={<Brain size={16} />} loading={loading} />
        <KpiCard label="Unique AI Users" value={loading ? '…' : fmt(ai?.overview.uniqueUsers ?? 0)} color={C.teal} icon={<Users size={16} />} loading={loading} />
        <KpiCard label="Total Tokens" value={loading ? '…' : fmt(ai?.overview.totalTokens ?? 0)} color={C.blue} icon={<Zap size={16} />} loading={loading}
          sub={ai?.overview.totalTokens ? `~${fmt(Math.round(ai.overview.totalTokens / Math.max(ai.overview.totalRequests, 1)))} per request` : undefined} />
        <KpiCard label="Est. Cost" value={loading ? '…' : fmtCost(ai?.overview.estimatedCost ?? 0)} color={C.amber} icon={<DollarSign size={16} />} loading={loading}
          sub="Based on $0.000002/token avg" />
      </div>

      {/* Trend + Model breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px,260px)', gap: 14 }}>
        <Card>
          <SectionHeader title="AI Usage Trend" sub={`Daily requests + estimated cost · last ${ph.days} days`} />
          {loading ? <Skeleton h={200} /> : !ai?.trend.length ? <EmptyState msg="No trend data" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={ai.trend} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={d => d.slice(5)} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={v => `$${Number(v).toFixed(3)}`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v, name) =>
                  name === 'requests' ? [fmt(Number(v)), 'Requests'] :
                  name === 'users'    ? [fmt(Number(v)), 'Users']    :
                  [`$${Number(v).toFixed(4)}`, 'Est. Cost']
                } />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left"  type="monotone" dataKey="requests" stroke={C.purple} strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="requests" />
                <Line yAxisId="left"  type="monotone" dataKey="users"    stroke={C.teal}   strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="users"    strokeDasharray="4 2" />
                <Line yAxisId="right" type="monotone" dataKey="cost"     stroke={C.amber}  strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} name="cost"  strokeDasharray="2 3" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <SectionHeader title="AI Events Breakdown" sub="Top AI-related event types" />
          {loading ? <Skeleton h={200} /> : !ai?.events.length ? <EmptyState msg="No AI events found" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 220 }}>
              {ai.events.slice(0, 12).map((e, i) => {
                const pct = Math.round((e.total / (ai.events[0]?.total || 1)) * 100)
                return (
                  <div key={e.event} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 14 }}>{i + 1}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.event}>{e.event}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(e.total)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ width: 14 }} />
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99, transition: 'width .4s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>
                        {e.tokens > 0 ? `${fmt(e.tokens)} tok` : `${fmt(e.users)} users`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Model breakdown */}
          {(ai?.models ?? []).length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Models</p>
              {ai!.models.map((m, i) => (
                <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 2, flexShrink: 0, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span style={{ fontSize: 11, color: 'var(--tx-2)', flex: 1 }}>{m.model}</span>
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>{fmt(m.total)}</span>
                  {m.cost > 0 && <span style={{ fontSize: 10, color: C.amber }}>{fmtCost(m.cost)}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Per-user leaderboard */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>AI Power Users</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2, marginBottom: 12 }}>Ranked by usage · last {ph.days} days</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 12 }}>
            <input
              type="search" placeholder="Search user…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, color: 'var(--tx-1)', width: 160 }}
            />
            <select
              value={userSort} onChange={e => setUserSort(e.target.value as typeof userSort)}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, color: 'var(--tx-1)', cursor: 'pointer' }}
            >
              <option value="requests">Sort: Requests</option>
              <option value="tokens">Sort: Tokens</option>
              <option value="cost">Sort: Cost</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                {['#', 'User', 'AI Requests', 'Sessions w/ AI', 'Tokens Used', 'Est. Cost', 'Last Used', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} style={{ padding: '8px 12px' }}><Skeleton h={14} /></td>)}</tr>
                  ))
                : sortedUsers.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>
                      {noData ? 'No AI usage tracked yet' : 'No users match search'}
                    </td></tr>
                  ) : sortedUsers.slice(0, 50).map((u, i) => (
                    <tr key={u.distinctId} style={{ borderBottom: '1px solid var(--border)', transition: 'background .1s' }}
                      onMouseEnter={el => (el.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                      onMouseLeave={el => (el.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: i < 3 ? [C.amber, C.grey, C.orange][i] : 'var(--tx-3)', fontSize: i < 3 ? 14 : 12 }}>
                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                      </td>
                      <td style={{ padding: '8px 12px', maxWidth: 180 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email || '—'}</p>
                        <p style={{ fontSize: 10, color: 'var(--tx-3)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || u.distinctId.slice(0, 20)}</p>
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: C.purple, fontVariantNumeric: 'tabular-nums' }}>{fmt(u.requests)}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{u.sessionsWithAI}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {u.tokens > 0 ? fmt(u.tokens) : <span style={{ color: 'var(--tx-3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: u.cost > 0.01 ? 600 : 400, color: u.cost > 0.10 ? C.amber : u.cost > 0.01 ? C.blue : 'var(--tx-3)' }}>
                        {u.cost > 0 ? fmtCost(u.cost) : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--tx-3)', fontSize: 11, whiteSpace: 'nowrap' }} title={u.lastUsed}>{relTime(u.lastUsed)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <a href={`${PH_BASE}/project/${PH_PROJ_ID}/person/${encodeURIComponent(u.distinctId)}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: C.purple, fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ExternalLink size={11} />
                        </a>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
        {!loading && sortedUsers.length > 0 && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--tx-3)' }}>
            {sortedUsers.length} users used AI features · Total estimated cost: {fmtCost(ai?.overview.estimatedCost ?? 0)} · Token cost rate: $0.000002/token (blended avg)
          </div>
        )}
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Cohort Retention                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function CohortsPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  useEffect(() => { ph.loadCohorts() }, [])

  const cohorts = ph.cohorts.data?.cohorts ?? []
  const loading = ph.cohorts.loading

  const maxWeeks = Math.max(0, ...cohorts.map(c => Math.max(...c.weeks.map(w => w.weekNum), 0)))

  function pctColor(pct: number) {
    if (pct >= 60) return C.green
    if (pct >= 35) return C.teal
    if (pct >= 20) return C.blue
    if (pct >= 10) return C.amber
    return C.red
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.cohorts.error && <ErrState msg={ph.cohorts.error} />}

      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Cohort Retention</p>
        <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Weekly cohorts — % of users returning each subsequent week · last 12 weeks</p>
      </div>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <div style={{ padding: 20 }}><Skeleton h={280} /></div> : cohorts.length === 0 ? <EmptyState msg="No cohort data yet" /> : (
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>Cohort Week</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>Size<InfoTooltip text="Number of new users who were first seen during this week. These users form the cohort." position="bottom" /></span>
                </th>
                {Array.from({ length: Math.min(maxWeeks + 1, 12) }, (_, i) => (
                  <th key={i} style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {i === 0 ? 'Wk 0' : `+${i}w`}
                      <InfoTooltip
                        text={i === 0
                          ? 'Week 0 — the cohort\'s first week. This is always 100% or close to it, since users are included in the cohort because they were active this week.'
                          : `+${i} week${i>1?'s':''} — % of the cohort who returned and were active exactly ${i} week${i>1?'s':''} after their first week. A drop from +1w to +2w shows early churn.`}
                        position="bottom"
                      />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c, ci) => {
                const weekMap = new Map(c.weeks.map(w => [w.weekNum, w]))
                return (
                  <tr key={c.week} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 14px', color: 'var(--tx-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(c.week)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>{c.size}</td>
                    {Array.from({ length: Math.min(maxWeeks + 1, 12) }, (_, i) => {
                      const w = weekMap.get(i)
                      if (!w) return <td key={i} style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--tx-3)', opacity: 0.3 }}>—</td>
                      return (
                        <td key={i} style={{ padding: '5px 4px', textAlign: 'center' }} title={`${w.retained} users returned`}>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 42, height: 28, borderRadius: 5, fontSize: 11, fontWeight: 700,
                            background: `${pctColor(w.pct)}22`, color: pctColor(w.pct),
                          }}>{w.pct}%</div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>Color Guide</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {([
            { range: '≥ 60%', color: C.green, desc: 'Strong retention' },
            { range: '≥ 35%', color: C.teal,  desc: 'Good' },
            { range: '≥ 20%', color: C.blue,  desc: 'Average' },
            { range: '≥ 10%', color: C.amber, desc: 'Weak' },
            { range: '< 10%', color: C.red,   desc: 'Churning' },
          ] as const).map(item => (
            <div key={item.range} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: item.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: item.color }}>{item.range}</span>
              <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{item.desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Activity Heatmap                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────── */
/* Geographic World Map Heatmap                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */
function WorldMapHeatmap({ countries }: { countries: { name: string; users: number }[] }) {
  const [tooltip, setTooltip] = useState<{ name: string; users: number; x: number; y: number } | null>(null)

  const maxUsers = Math.max(1, ...countries.map(c => c.users))

  const userMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of countries) {
      const key = c.name.toLowerCase()
      const mapped = COUNTRY_NAME_MAP[key] ?? key
      m.set(mapped, (m.get(mapped) ?? 0) + c.users)
      // also store original in case map topology name matches directly
      if (mapped !== key) m.set(key, (m.get(key) ?? 0) + c.users)
    }
    return m
  }, [countries])

  function fillColor(geoName: string): string {
    const key = geoName.toLowerCase()
    const users = userMap.get(key) ?? 0
    if (!users) return 'var(--surface-3)'
    // sqrt scale so small-user countries get visible colour
    const t = Math.sqrt(users / maxUsers)
    const r = Math.round(20  + t * 10)
    const g = Math.round(120 + t * 77)
    const b = Math.round(100 + t * 66)
    return `rgba(${r},${g},${b},${(0.35 + t * 0.65).toFixed(2)})`
  }

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <ComposableMap
        projectionConfig={{ scale: 150, center: [0, 10] }}
        style={{ width: '100%', height: 'auto', background: 'transparent' }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: { rsmKey: string; properties: Record<string, unknown> }[] }) =>
            geographies.map((geo: { rsmKey: string; properties: Record<string, unknown> }) => {
              const name    = String(geo.properties?.name ?? '')
              const users   = userMap.get(name.toLowerCase()) ?? 0
              const fill    = fillColor(name)
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke="var(--border)"
                  strokeWidth={0.4}
                  onMouseMove={(e: React.MouseEvent) => {
                    setTooltip({ name, users, x: e.clientX, y: e.clientY })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    default:  { outline: 'none' },
                    hover:    { fill: users ? C.teal : 'var(--surface-2)', outline: 'none', transition: 'fill .15s' },
                    pressed:  { outline: 'none' },
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 10, zIndex: 9999, pointerEvents: 'none',
          background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, color: 'var(--tx-1)', boxShadow: '0 8px 24px rgba(0,0,0,.6)',
        }}>
          <p style={{ fontWeight: 700, marginBottom: 2 }}>{tooltip.name}</p>
          <p style={{ color: tooltip.users ? C.teal : 'var(--tx-3)' }}>
            {tooltip.users ? `${tooltip.users.toLocaleString()} users` : 'No data'}
          </p>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>0 users</span>
        {[0.05, 0.2, 0.4, 0.6, 0.8, 1.0].map(t => {
          const r = Math.round(20  + t * 10)
          const g = Math.round(120 + t * 77)
          const b = Math.round(100 + t * 66)
          return (
            <div key={t} style={{
              width: 28, height: 12, borderRadius: 3,
              background: `rgba(${r},${g},${b},${(0.35 + t * 0.65).toFixed(2)})`,
            }} />
          )
        })}
        <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{maxUsers.toLocaleString()} users</span>
      </div>
    </div>
  )
}

function HeatmapPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [view, setView]               = useState<'activity' | 'geography'>('activity')
  const [metric, setMetric]           = useState<'events' | 'users'>('events')
  const [moduleFilter, setModuleFilter] = useState('all')
  const HEATMAP_MODULES = ['all', 'Home', 'Search', 'Auth', 'Profile', 'Courses', 'Applications', 'Onboarding', 'Settings', 'Notifications', 'Chat', 'Documents']

  useEffect(() => {
    if (view === 'activity') ph.loadHeatmap(true, moduleFilter === 'all' ? '' : moduleFilter)
    if (view === 'geography') ph.loadPlatforms()
  }, [ph.days, moduleFilter, view])

  const cells = ph.heatmap.data ?? []
  const loading = ph.heatmap.loading
  const maxVal = Math.max(1, ...cells.map(c => metric === 'events' ? c.events : c.users))
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const HOURS = Array.from({ length: 24 }, (_, i) => i)

  function cellColor(val: number) {
    const t = val / maxVal
    return `rgba(139,92,246,${(t * 0.85 + 0.05).toFixed(2)})`
  }

  const cellMap = new Map(cells.map(c => [`${c.dow}-${c.hour}`, c]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.heatmap.error && <ErrState msg={ph.heatmap.error} />}

      {/* View toggle + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {([
              { id: 'activity'  as const, label: '🕐 Activity', desc: 'When — day × hour grid' },
              { id: 'geography' as const, label: '🌍 Geography', desc: 'Where — world user map' },
            ]).map(v => (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: view === v.id ? C.purpleDim : 'var(--surface-2)',
                color: view === v.id ? C.purple : 'var(--tx-3)',
                border: `1px solid ${view === v.id ? C.purple + '55' : 'var(--border)'}`,
              }}>{v.label}</button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 0 }}>
            {view === 'activity'
              ? 'When are your users most active? Day of week × hour of day'
              : 'Where are your users coming from? Country-level density map'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DaysControl value={ph.days} onChange={d => { ph.setDays(d); if (view === 'activity') ph.loadHeatmap(true, moduleFilter === 'all' ? '' : moduleFilter); else ph.loadPlatforms(true) }} />
          {view === 'activity' && (
            <>
              <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, color: 'var(--tx-2)', cursor: 'pointer' }}>
                {HEATMAP_MODULES.map(m => <option key={m} value={m}>{m === 'all' ? 'All modules' : m}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['events', 'users'] as const).map(v => (
                  <button key={v} onClick={() => setMetric(v)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    background: metric === v ? C.purpleDim : 'var(--surface-2)',
                    color: metric === v ? C.purple : 'var(--tx-3)',
                    border: `1px solid ${metric === v ? C.purple + '55' : 'var(--border)'}`,
                  }}>{v}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Geography view ── */}
      {view === 'geography' && (
        <>
          <Card>
            <SectionHeader title="User Geography" sub={`Where your users are located · last ${ph.days} days`} />
            {ph.platforms.loading ? <Skeleton h={340} /> :
             ph.platforms.error   ? <ErrState msg={ph.platforms.error} /> :
             !ph.platforms.data?.country?.length ? <EmptyState msg="No geographic data available" /> : (
              <WorldMapHeatmap countries={ph.platforms.data.country} />
            )}
          </Card>

          {/* Top countries ranked list below the map */}
          {!ph.platforms.loading && !!ph.platforms.data?.country?.length && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
              {ph.platforms.data.country.slice(0, 12).map((c, i) => {
                const max = ph.platforms.data!.country[0].users
                const pct = Math.round((c.users / max) * 100)
                return (
                  <div key={c.name} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)' }}>{c.name}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{c.users.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 99 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Activity heatmap ── */}
      {view === 'activity' && (
      <>
      <Card style={{ overflowX: 'auto', padding: '16px 14px' }}>
        {loading ? <Skeleton h={200} /> : cells.length === 0 ? <EmptyState msg="No heatmap data for this period" /> : (
          <div>
            {/* Hour axis header */}
            <div style={{ display: 'flex', marginBottom: 6, marginLeft: 36 }}>
              {HOURS.map(h => (
                <div key={h} style={{ flex: 1, minWidth: 22, textAlign: 'center', fontSize: 9, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {h % 4 === 0 ? `${h}h` : ''}
                </div>
              ))}
            </div>
            {/* Grid rows — dow 1=Mon to 7=Sun */}
            {DAYS.map((day, di) => {
              const dow = di + 1
              return (
                <div key={day} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ width: 32, fontSize: 10, color: 'var(--tx-3)', flexShrink: 0, fontWeight: 600 }}>{day}</span>
                  {HOURS.map(h => {
                    const c = cellMap.get(`${dow}-${h}`)
                    const val = c ? (metric === 'events' ? c.events : c.users) : 0
                    return (
                      <div key={h} title={c ? `${day} ${h}:00 — ${c.events} events, ${c.users} users` : undefined}
                        style={{
                          flex: 1, minWidth: 22, height: 26, borderRadius: 3, margin: '0 1px',
                          background: val > 0 ? cellColor(val) : 'var(--surface-2)',
                          transition: 'background .15s',
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
            {/* Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 36 }}>
              <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>Low</span>
              {[0.1, 0.3, 0.5, 0.7, 0.9].map(t => (
                <div key={t} style={{ width: 20, height: 14, borderRadius: 3, background: `rgba(139,92,246,${t})` }} />
              ))}
              <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>High</span>
            </div>
          </div>
        )}
      </Card>

      {/* Peak hour summary */}
      {!loading && cells.length > 0 && (() => {
        const byHour = new Map<number, number>()
        const byDay  = new Map<number, number>()
        for (const c of cells) {
          const v = metric === 'events' ? c.events : c.users
          byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + v)
          byDay.set(c.dow,   (byDay.get(c.dow)   ?? 0) + v)
        }
        const peakHour = [...byHour.entries()].sort((a,b) => b[1]-a[1])[0]
        const peakDay  = [...byDay.entries()].sort((a,b) => b[1]-a[1])[0]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {([
              { label: 'Peak Hour', value: peakHour ? `${peakHour[0]}:00–${peakHour[0]+1}:00` : '—', sub: peakHour ? `${fmt(peakHour[1])} ${metric}` : '', color: C.purple,
                tip: `The 1-hour window with the highest total ${metric} across all days in this period. Use this to time push notifications, feature releases, or maintenance windows.` },
              { label: 'Peak Day',  value: peakDay  ? DAYS[(peakDay[0]-1) % 7] : '—', sub: peakDay ? `${fmt(peakDay[1])} ${metric}` : '', color: C.teal,
                tip: `The day of the week with the highest total ${metric} summed across all weeks in this period. Useful for scheduling support coverage and campaign sends.` },
            ] as const).map(k => (
              <div key={k.label} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', borderTop: `2px solid ${k.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                  <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>{k.label}</p>
                  <InfoTooltip text={k.tip} />
                </div>
                <p style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</p>
                <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>{k.sub}</p>
              </div>
            ))}
          </div>
        )
      })()}
      </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Growth Analytics                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */
function GrowthPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  useEffect(() => { ph.loadGrowth() }, [ph.days])

  const d       = ph.growth.data
  const loading = ph.growth.loading
  const maxSrc  = Math.max(1, ...(d?.sources ?? []).map(s => s.users))
  const maxCtry = Math.max(1, ...(d?.countries ?? []).map(c => c.users))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.growth.error && <ErrState msg={ph.growth.error} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Growth Analytics</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>New user trends, acquisition channels, and geographic reach</p>
        </div>
        <DaysControl value={ph.days} onChange={d2 => { ph.setDays(d2); ph.loadGrowth(true) }} />
      </div>

      {/* Weekly new users trend */}
      <Card>
        <SectionHeader title="New Users per Week" sub="First-time users acquired each week" />
        {loading ? <Skeleton h={200} /> : !d?.weeklyNew.length ? <EmptyState msg="No growth data for this period" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.weeklyNew} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={d2 => d2.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--tx-3)' }} tickFormatter={fmt} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: unknown) => [fmt(Number(v)), 'New Users']} />
              <Bar dataKey="newUsers" fill={C.green} radius={[4, 4, 0, 0]} name="New Users">
                <LabelList dataKey="newUsers" position="top" style={{ fontSize: 9, fill: C.green }} formatter={(v: unknown) => fmt(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Sources + Geography */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <SectionHeader title="Traffic Sources" sub="Where users come from (referrer domain)" />
          {loading ? <Skeleton h={260} /> : !d?.sources.length ? <EmptyState msg="No source data" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {d.sources.slice(0, 12).map((s, i) => {
                const pct = Math.round((s.users / maxSrc) * 100)
                return (
                  <div key={s.source} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 14 }}>{i + 1}</span>
                      <Globe size={10} color={C.blue} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.source}>{s.source}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>{fmt(s.users)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 22 }}>
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.blue, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>{fmt(s.sessions)} sessions</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Geographic Breakdown" sub="Users by country" />
          {loading ? <Skeleton h={260} /> : !d?.countries.length ? <EmptyState msg="No geography data" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {d.countries.slice(0, 15).map((c, i) => {
                const pct = Math.round((c.users / maxCtry) * 100)
                return (
                  <div key={c.country} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 14 }}>{i + 1}</span>
                      <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1 }}>{c.country}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length] }}>{fmt(c.users)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 22 }}>
                      <div style={{ flex: 1, height: 3, background: 'var(--surface-3)', borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{fmt(c.events)} events</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* SUB-TAB: Engagement Segments                                                 */
/* ─────────────────────────────────────────────────────────────────────────── */
function SegmentsPane({ ph }: { ph: ReturnType<typeof usePostHogAnalytics> }) {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  useEffect(() => { ph.loadSegments() }, [])

  const d = ph.segments.data
  const loading = ph.segments.loading

  const SEG_CONFIG: Record<string, { color: string; desc: string }> = {
    Power:   { color: C.purple, desc: '200+ events, active last 30d' },
    Regular: { color: C.blue,   desc: '50-199 events, active last 30d' },
    Casual:  { color: C.teal,   desc: '< 50 events, active last 30d' },
    'At Risk': { color: C.amber, desc: 'Not seen in 30-60 days' },
    Dormant: { color: C.red,    desc: 'Not seen in 60+ days' },
  }

  const filteredUsers = (d?.users ?? []).filter(u => {
    if (filter !== 'all' && u.segment !== filter) return false
    if (search && !u.email.toLowerCase().includes(search.toLowerCase()) && !u.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {ph.segments.error && <ErrState msg={ph.segments.error} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Engagement Segments</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Users classified by activity over 90 days</p>
        </div>
        <button onClick={() => ph.loadSegments(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7, fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--tx-2)', cursor: 'pointer' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Segment summary cards */}
      {!loading && d && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(SEG_CONFIG).map(([seg, cfg]) => {
            const count = d.summary[seg] ?? 0
            const pct = d.totalUsers > 0 ? Math.round((count / d.totalUsers) * 100) : 0
            return (
              <button key={seg} onClick={() => setFilter(filter === seg ? 'all' : seg)}
                style={{ flex: '1 1 130px', padding: '12px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: filter === seg ? `${cfg.color}18` : 'var(--surface-1)',
                  border: `1px solid ${filter === seg ? cfg.color + '66' : 'var(--border)'}`,
                  borderTop: `3px solid ${cfg.color}` }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>{seg}</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: 'var(--tx-1)' }}>{count}</p>
                <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 2 }}>{pct}% of users</p>
                <p style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 1, lineHeight: '1.3' }}>{cfg.desc}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* User table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="search" placeholder="Filter by name or email…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', fontSize: 12, color: 'var(--tx-1)' }} />
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <button onClick={() => setFilter('all')} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: filter === 'all' ? C.purpleDim : 'var(--surface-2)', color: filter === 'all' ? C.purple : 'var(--tx-3)',
              border: `1px solid ${filter === 'all' ? C.purple + '55' : 'var(--border)'}` }}>All</button>
            {Object.entries(SEG_CONFIG).map(([seg, cfg]) => (
              <button key={seg} onClick={() => setFilter(filter === seg ? 'all' : seg)} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: filter === seg ? `${cfg.color}18` : 'var(--surface-2)', color: filter === seg ? cfg.color : 'var(--tx-3)',
                border: `1px solid ${filter === seg ? cfg.color + '55' : 'var(--border)'}` }}>{seg}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: 400 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {['User', 'Segment', 'Events', 'Sessions', 'First Seen', 'Last Active'].map(h => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>{[1,2,3,4,5,6].map(j => <td key={j} style={{ padding: '9px 12px' }}><Skeleton h={13} /></td>)}</tr>
                  ))
                : filteredUsers.length === 0
                ? <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--tx-3)' }}>No users match this filter</td></tr>
                : filteredUsers.slice(0, 100).map(u => {
                    const cfg = SEG_CONFIG[u.segment] ?? { color: C.grey }
                    return (
                      <tr key={u.distinctId} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{u.name || u.email || u.distinctId.slice(0, 20) + '…'}</p>
                          {u.email && u.email !== u.name && <p style={{ fontSize: 10, color: 'var(--tx-3)' }}>{u.email}</p>}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: `${cfg.color}18`, color: cfg.color }}>{u.segment}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{fmt(u.events)}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{u.sessions}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtDate(u.firstSeen)}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--tx-3)', whiteSpace: 'nowrap' }} title={u.lastSeen}>{relTime(u.lastSeen)}</td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
        {!loading && filteredUsers.length > 100 && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--tx-3)' }}>
            Showing 100 of {filteredUsers.length} users
          </div>
        )}
      </Card>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MAIN COMPONENT                                                              */
/* ─────────────────────────────────────────────────────────────────────────── */
const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',       icon: <BarChart2 size={13} /> },
  { id: 'events',    label: 'Events',         icon: <Zap size={13} /> },
  { id: 'users',     label: 'Users',          icon: <Users size={13} /> },
  { id: 'sessions',  label: 'Sessions',       icon: <Eye size={13} /> },
  { id: 'platform',  label: 'Platform',       icon: <MonitorSmartphone size={13} /> },
  { id: 'funnels',   label: 'Funnels',        icon: <Target size={13} /> },
  { id: 'flags',     label: 'Feature Flags',  icon: <Flag size={13} /> },
  { id: 'pathways',  label: 'Pathways',       icon: <ChevronRight size={13} /> },
  { id: 'dropoff',   label: 'Drop-off',       icon: <ArrowDown size={13} /> },
  { id: 'modules',   label: 'Modules',        icon: <Layers size={13} /> },
  { id: 'ai',        label: 'AI Usage',       icon: <Brain size={13} /> },
  { id: 'cohorts',   label: 'Retention',      icon: <Calendar size={13} /> },
  { id: 'heatmap',   label: 'Heatmap',        icon: <Flame size={13} /> },
  { id: 'growth',    label: 'Growth',         icon: <TrendingUp size={13} /> },
  { id: 'segments',  label: 'Segments',       icon: <UserCheck size={13} /> },
]

export default function PostHogTab({ bugs }: { bugs: ParsedBug[] }) {
  const [subTab, setSubTab]         = useState<SubTab>('overview')
  const [fullscreen, setFullscreen] = useState(false)
  const ph = usePostHogAnalytics()

  useEffect(() => {
    if (!fullscreen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...(fullscreen
        ? { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg)' }
        : { height: '100%' }),
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 18px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-1)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.purpleDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={15} color={C.purple} />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', fontFamily: 'Space Grotesk, sans-serif' }}>PostHog Analytics</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>Product analytics, session replay &amp; feature flags · Project {PH_PROJ_ID}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href={`${PH_BASE}/project/${PH_PROJ_ID}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, background: C.purpleDim, color: C.purple, fontSize: 12, fontWeight: 600, textDecoration: 'none', border: `1px solid ${C.purple}44` }}>
            <ExternalLink size={12} /> Open PostHog
          </a>
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8,
              border: `1px solid ${fullscreen ? C.purple + '55' : 'var(--border)'}`,
              background: fullscreen ? C.purpleDim : 'var(--surface-2)',
              color: fullscreen ? C.purple : 'var(--tx-2)',
              cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {fullscreen ? 'Exit' : 'Full screen'}
          </button>
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '8px 18px',
        background: 'var(--surface-1)', borderBottom: '1px solid var(--border)',
        overflowX: 'auto', flexShrink: 0,
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7,
              background: subTab === t.id ? C.purpleDim : 'transparent',
              color: subTab === t.id ? C.purple : 'var(--tx-3)',
              border: `1px solid ${subTab === t.id ? C.purple + '55' : 'transparent'}`,
              fontSize: 12, fontWeight: subTab === t.id ? 600 : 400,
              cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '18px' }}>
        {subTab === 'overview' && <OverviewPane ph={ph} />}
        {subTab === 'events'   && <EventsPane ph={ph} />}
        {subTab === 'users'    && <UsersPane ph={ph} />}
        {subTab === 'sessions' && <SessionsPane ph={ph} />}
        {subTab === 'platform' && <PlatformPane ph={ph} />}
        {subTab === 'funnels'  && <FunnelsPane ph={ph} />}
        {subTab === 'flags'    && <FeatureFlagsPane ph={ph} bugs={bugs} />}
        {subTab === 'pathways'  && <PathwaysPane ph={ph} />}
        {subTab === 'dropoff'   && <DropoffPane ph={ph} />}
        {subTab === 'modules'   && <ModulesPane ph={ph} />}
        {subTab === 'ai'        && <AIUsagePane ph={ph} />}
        {subTab === 'cohorts'   && <CohortsPane ph={ph} />}
        {subTab === 'heatmap'   && <HeatmapPane ph={ph} />}
        {subTab === 'growth'    && <GrowthPane ph={ph} />}
        {subTab === 'segments'  && <SegmentsPane ph={ph} />}
      </div>
    </div>
  )
}
