'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, RefreshCw, Shield, X } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts'

// ─── Types ────────────────────────────────────────────────────

interface MonitorRow {
  id: string
  name: string
  target: string
  type: 'http' | 'keyword' | 'json_api'
  enabled: boolean
  severity: 'critical' | 'warning' | 'info'
  interval_seconds: number
  degraded_threshold_ms: number | null
  status: 'up' | 'down' | 'degraded' | null
  incident_since: string | null
  status_updated_at: string | null
  last_response_ms: number | null
  last_status_code: number | null
  last_error_class: string | null
  last_error_message: string | null
  last_checked_at: string | null
  uptime_1h: number | null
  uptime_24h: number | null
  uptime_7d: number | null
  uptime_30d: number | null
  avg_response_24h: number | null
  p95_response_24h: number | null
  total_checks_24h: number | null
  down_checks_24h: number | null
  active_incident_id: string | null
  incident_started_at: string | null
  incident_error_class: string | null
  incident_error_message: string | null
  incident_probable_cause: string | null
  incident_attack_indicators: string[] | null
  incident_concurrent_down: number | null
  incident_peak_response_ms: number | null
}

interface CheckRow {
  monitor_id: string
  status: 'up' | 'down' | 'degraded'
  response_time_ms: number | null
  checked_at: string
  error_class: string | null
  error_message: string | null
  status_code: number | null
}

interface IncidentRow {
  id: string
  monitor_id: string
  started_at: string
  resolved_at: string | null
  is_open: boolean
  first_error_class: string | null
  first_error_message: string | null
  first_status_code: number | null
  probable_cause: string | null
  attack_indicators: string[] | null
  concurrent_down_count: number | null
  duration_seconds: number | null
  monitors: { name: string } | null
}

interface FailedCheckRow {
  id: string
  monitor_id: string
  status: 'down' | 'degraded'
  response_time_ms: number | null
  status_code: number | null
  error_class: string | null
  error_message: string | null
  checked_at: string
}

type ChecksByMonitor = Record<string, CheckRow[]>

interface AnomalyRow {
  id: string
  monitor_id: string
  monitor_name: string
  monitor_target: string
  checked_at: string
  anomaly_type: 'spike' | 'down' | 'degraded'
  response_time_ms: number | null
  avg_ms: number | null
  spike_ratio: number | null
  error_class: string | null
  error_message: string | null
  status_code: number | null
  ai_analysis: string | null
  cloudwatch_url: string | null
  created_at: string
}

// ─── Colour constants (real hex — never CSS vars — so rgba alpha works) ──────

const C = {
  success: '#3FB950',
  successBg: 'rgba(63,185,80,.10)',
  successBorder: 'rgba(63,185,80,.30)',
  warning: '#E3B341',
  warningBg: 'rgba(227,179,65,.10)',
  warningBorder: 'rgba(227,179,65,.30)',
  danger: '#FF7B72',
  dangerBg: 'rgba(255,123,114,.08)',
  dangerBorder: 'rgba(255,123,114,.25)',
  muted: '#7D8590',
  mutedBg: 'rgba(125,133,144,.10)',
  mutedBorder: 'rgba(125,133,144,.25)',
} as const

// ─── Helpers ──────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

function incidentAge(iso: string): string {
  return formatDuration((Date.now() - new Date(iso).getTime()) / 1000)
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── MYT / Maintenance helpers ────────────────────────────────
// MYT = Asia/Kuala_Lumpur = UTC+8. Maintenance window: 00:00–09:00 MYT daily.

function getMYTHour(iso: string): number {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).getUTCHours()
}

function isMaintenancePeriod(iso: string): boolean {
  const h = getMYTHour(iso)
  return h >= 0 && h < 9
}

function isMYTMaintenanceNow(): boolean {
  return isMaintenancePeriod(new Date().toISOString())
}

function todayMYT(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
}

function formatMYT(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  }) + ' MYT'
}

// ─── Performance benchmarks (HTTP Archive 2024 + Google Core Web Vitals) ──────

const WEB_PERCENTILES = [
  { ms: 0,    pct: 0  },
  { ms: 400,  pct: 20 },
  { ms: 800,  pct: 50 },   // Google "good" TTFB threshold
  { ms: 1500, pct: 75 },
  { ms: 1800, pct: 80 },   // Google "needs improvement"
  { ms: 2500, pct: 90 },
  { ms: 4000, pct: 95 },
  { ms: 9500, pct: 99 },
] as const

const API_PERCENTILES = [
  { ms: 0,    pct: 0  },
  { ms: 50,   pct: 25 },
  { ms: 100,  pct: 45 },
  { ms: 200,  pct: 60 },
  { ms: 400,  pct: 78 },
  { ms: 800,  pct: 90 },
  { ms: 2000, pct: 97 },
  { ms: 9500, pct: 99 },
] as const

function interpolatePercentile(ms: number, table: readonly { ms: number; pct: number }[]): number {
  for (let i = 1; i < table.length; i++) {
    if (ms <= table[i].ms) {
      const t = (ms - table[i - 1].ms) / (table[i].ms - table[i - 1].ms)
      return Math.round(table[i - 1].pct + t * (table[i].pct - table[i - 1].pct))
    }
  }
  return 99
}

function isWebEndpoint(name: string): boolean {
  return name.toLowerCase().includes('frontend')
}

const ERROR_CLASS_LABELS: Record<string, string> = {
  timeout:                'Connection Timeout',
  dns_failure:            'DNS Resolution Failed',
  tls_error:              'SSL / TLS Error',
  tcp_refused:            'Connection Refused',
  connection_reset:       'Connection Reset',
  network_error:          'Network Error',
  http_5xx:               'HTTP Server Error (5xx)',
  http_4xx:               'HTTP Client Error (4xx)',
  http_unexpected_status: 'Unexpected HTTP Status',
  keyword_missing:        'Keyword Not Found',
  assertion_failed:       'Assertion Failed',
  invalid_json:           'Invalid JSON Response',
  slow_response:          'Slow Response',
}

function errorLabel(cls: string | null): string {
  if (!cls) return 'Unknown Error'
  return ERROR_CLASS_LABELS[cls] ?? cls.replace(/_/g, ' ')
}

function getSlownessReasons(monitor: MonitorRow, web: boolean): string[] {
  const avg = monitor.avg_response_24h ?? 0
  const reasons: string[] = []
  if (web) {
    if (avg > 1800) {
      reasons.push("Exceeds Google's 1.8s 'poor' TTFB threshold — check server CPU/memory and rendering pipeline")
      reasons.push('Consider enabling edge caching or CDN to reduce origin load')
    } else if (avg > 800) {
      reasons.push("Above Google's 800ms 'good' TTFB threshold — may affect Core Web Vitals score")
      reasons.push('Common causes: server-side rendering latency, cold starts, or blocking database queries on page load')
      reasons.push('Monitoring runs from a single region — actual end-user latency may vary by location')
    }
  } else {
    if (avg > 600) {
      reasons.push('Auth/API response >600ms — check Keycloak connection pool size, JWT validation time, and session cache hit rate')
      reasons.push('Possible cold cache or slow external IdP round-trips')
    } else if (avg > 200) {
      reasons.push('Response above 200ms baseline — may be acceptable for Keycloak with active session validation')
      reasons.push('Consider cache tuning if latency has increased recently compared to baseline')
    }
  }
  if ((monitor.down_checks_24h ?? 0) > 0) {
    reasons.push(`${monitor.down_checks_24h} failed checks alongside slow responses may indicate intermittent resource pressure`)
  }
  return reasons
}

function uptimeColors(v: number | null): { text: string; bg: string; border: string } {
  if (v === null) return { text: C.muted,   bg: C.mutedBg,   border: C.mutedBorder }
  if (v >= 99)   return { text: C.success,  bg: C.successBg, border: C.successBorder }
  if (v >= 95)   return { text: C.warning,  bg: C.warningBg, border: C.warningBorder }
  return           { text: C.danger,   bg: C.dangerBg,  border: C.dangerBorder }
}

function responseColor(ms: number | null, errorClass: string | null): string {
  if (errorClass === 'timeout') return C.danger
  if (ms === null) return C.muted
  if (ms < 500) return C.success
  if (ms <= 1500) return C.warning
  return C.danger
}

function statusInfo(m: MonitorRow): { color: string; label: string; pulse: boolean } {
  if (!m.enabled) return { color: C.muted,   label: 'Disabled',    pulse: false }
  if (!m.status)  return { color: C.muted,   label: 'Unknown',     pulse: false }
  if (m.status === 'up')       return { color: C.success, label: 'Operational', pulse: false }
  if (m.status === 'degraded') return { color: C.warning, label: 'Degraded',    pulse: false }
  return { color: C.danger, label: 'Down', pulse: true }
}

function computeOverallStatus(monitors: MonitorRow[]): { label: string; color: string; bg: string; border: string } {
  const enabled = monitors.filter(m => m.enabled)
  if (enabled.length === 0) return { label: 'No Monitors', color: C.muted, bg: C.mutedBg, border: C.mutedBorder }
  const downCount     = enabled.filter(m => m.status === 'down').length
  const degradedCount = enabled.filter(m => m.status === 'degraded').length
  if (downCount > 0)     return { label: `${downCount} Service${downCount > 1 ? 's' : ''} Down`, color: C.danger,  bg: C.dangerBg,  border: C.dangerBorder }
  if (degradedCount > 0) return { label: 'Performance Degraded',   color: C.warning, bg: C.warningBg, border: C.warningBorder }
  return { label: 'All Systems Operational', color: C.success, bg: C.successBg, border: C.successBorder }
}

function incidentDurationStr(inc: IncidentRow): string {
  if (inc.is_open) return 'Ongoing'
  if (inc.duration_seconds !== null) return formatDuration(inc.duration_seconds)
  if (inc.resolved_at) return formatDuration((new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 1000)
  return '—'
}

// ─── CloudWatch spike link ────────────────────────────────────

function deriveLogGroup(target: string): string | null {
  const t = target.toLowerCase()
  if (t.includes('/courses'))       return '/aws/yuzee/course-service'
  if (t.includes('/institutes'))    return '/aws/yuzee/institute-service'
  if (t.includes('/search'))        return '/aws/yuzee/search-service'
  if (t.includes('/payment'))       return '/aws/yuzee/payment-service'
  if (t.includes('yuzee'))          return '/aws/yuzee/user-service'
  return null
}

function buildSpikeCloudWatchUrl(target: string, checkedAt: string, statusCode: number | null): string | null {
  const logGroup = deriveLogGroup(target)
  if (!logGroup) return null

  const ts    = new Date(checkedAt).getTime()
  const start = ts - 2 * 60_000
  const end   = ts + 2 * 60_000
  const filter = statusCode ? `"${statusCode}"` : ''
  const encoded = encodeURIComponent(logGroup)
  const filterPart = filter ? `filterPattern=${encodeURIComponent(filter)}&` : ''
  return `https://console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1`
    + `#logsV2:log-groups/log-group/${encoded}`
    + `/log-events?${filterPart}start=${start}&end=${end}`
}

// ─── Sparkline ────────────────────────────────────────────────

function spikeSeverityColor(ms: number, avg: number): string {
  const ratio = avg > 0 ? ms / avg : 1
  if (ratio >= 6) return C.danger    // red: 6× avg+
  if (ratio >= 3) return '#f97316'   // orange: 3–6× avg
  return C.warning                   // amber: 2–3× avg
}

interface SparkDatum {
  ms: number; rawMs: number | null; status: string; checked_at?: string
  isSpike: boolean; spikeColor: string
  errorClass?: string | null; errorMsg?: string | null; statusCode?: number | null
}
interface DotProps { cx?: number; cy?: number; payload?: SparkDatum; index?: number }

function SparkDot(props: DotProps) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return <g />
  const fill = payload?.status === 'down' ? C.danger : payload?.status === 'degraded' ? C.warning : C.success
  return <circle cx={cx} cy={cy} r={2} fill={fill} strokeWidth={0} />
}

function SpikeMarker({ cx, cy, color = C.warning }: { cx?: number; cy?: number; color?: string }) {
  if (cx == null || cy == null) return <g />
  const h = 7, w = 9
  return (
    <polygon
      points={`${cx},${cy - h - 3} ${cx - w / 2},${cy - 3} ${cx + w / 2},${cy - 3}`}
      fill={color} opacity={0.9}
    />
  )
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SparkDatum }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const color = d.status === 'down' ? C.danger : d.status === 'degraded' ? C.warning : d.isSpike ? d.spikeColor : C.success
  const msText = d.rawMs === null ? 'Timeout' : `${d.rawMs}ms`
  const time = d.checked_at
    ? new Date(d.checked_at).toLocaleString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
    : ''
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '6px 10px', fontSize: 11,
      boxShadow: '0 2px 8px rgba(0,0,0,.3)', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 240,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 700, color }}>{msText}</span>
        {d.isSpike && (
          <span style={{ fontSize: 10, fontWeight: 700, color: d.spikeColor, background: d.spikeColor + '18', border: `1px solid ${d.spikeColor}50`, borderRadius: 4, padding: '1px 5px' }}>
            ⚡ Spike
          </span>
        )}
      </div>
      {d.statusCode != null && <div style={{ color: 'var(--tx-3)' }}>HTTP {d.statusCode}</div>}
      {d.errorClass && <div style={{ color: 'var(--tx-2)', fontFamily: 'monospace', fontSize: 10 }}>{d.errorClass}</div>}
      {d.errorMsg && (
        <div style={{ color: 'var(--tx-3)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
          {d.errorMsg}
        </div>
      )}
      {time && <div style={{ color: 'var(--tx-3)', marginTop: 1 }}>{time} MYT</div>}
    </div>
  )
}

function Sparkline({ checks }: { checks: CheckRow[] }) {
  if (checks.length === 0) {
    return (
      <div style={{ height: 60, borderRadius: 'var(--r-sm)', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>No data</span>
      </div>
    )
  }
  const nonZero = checks.filter(c => c.response_time_ms !== null && c.response_time_ms > 0)
  const avgMs = nonZero.length > 0 ? nonZero.reduce((s, c) => s + c.response_time_ms!, 0) / nonZero.length : 0
  const spikeThreshold = avgMs * 2

  const data: SparkDatum[] = checks.map(c => {
    const spike = avgMs > 0 && c.response_time_ms !== null && c.response_time_ms >= spikeThreshold
    return {
      ms: c.response_time_ms ?? 0,
      rawMs: c.response_time_ms,
      status: c.status,
      checked_at: c.checked_at,
      isSpike: spike,
      spikeColor: spike ? spikeSeverityColor(c.response_time_ms!, avgMs) : C.warning,
      errorClass: c.error_class,
      errorMsg: c.error_message,
      statusCode: c.status_code,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={data} margin={{ top: 14, right: 2, left: 2, bottom: 4 }}>
        <Tooltip
          content={<SparkTooltip />}
          cursor={{ stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: '3 3' }}
        />
        <Line
          type="monotone"
          dataKey="ms"
          stroke="var(--border-hi)"
          strokeWidth={1.5}
          dot={(dotProps) => {
            const p = dotProps as DotProps
            const d = p.index !== undefined ? data[p.index] : undefined
            if (d?.isSpike) {
              return (
                <g key={`d-${p.index}`}>
                  <SparkDot {...p} />
                  <SpikeMarker cx={p.cx} cy={p.cy} color={d.spikeColor} />
                </g>
              )
            }
            return <SparkDot {...p} />
          }}
          activeDot={(dotProps: DotProps) => {
            const { cx, cy, payload } = dotProps
            if (cx == null || cy == null) return <g />
            const fill = payload?.status === 'down' ? C.danger
              : payload?.status === 'degraded' ? C.warning
              : payload?.isSpike ? payload.spikeColor
              : C.success
            return <circle cx={cx} cy={cy} r={4} fill={fill} stroke="var(--surface-1)" strokeWidth={1.5} />
          }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Uptime Chip ──────────────────────────────────────────────

function UptimeChip({ label, value }: { label: string; value: number | null }) {
  const col = uptimeColors(value)
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 12,
      borderWidth: 1, borderStyle: 'solid', borderColor: col.border,
      background: col.bg, color: col.text, whiteSpace: 'nowrap',
    }}>
      {label} {value !== null ? `${value.toFixed(1)}%` : '—'}
    </span>
  )
}

// ─── Monitor Card ─────────────────────────────────────────────

function MonitorCard({ monitor, checks, onClick, sparklineLabel, isLoading }: {
  monitor: MonitorRow
  checks: CheckRow[]
  onClick: () => void
  sparklineLabel?: string
  isLoading?: boolean
}) {
  const info = statusInfo(monitor)
  const hasActiveIncident = monitor.active_incident_id !== null && monitor.incident_started_at !== null

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${monitor.name}: ${info.label}. Click for details.`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      style={{
        background: 'var(--surface-1)',
        // Use separate border properties to avoid React shorthand reconciliation warning
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: hasActiveIncident ? C.dangerBorder : 'var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '16px 18px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'box-shadow .15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
    >
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className={info.pulse ? 'anim-pulse' : undefined}
          style={{ width: 9, height: 9, borderRadius: '50%', background: info.color, flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: info.color }}>{info.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)' }}>
          {relativeTime(monitor.last_checked_at)}
        </span>
      </div>

      {/* Name + target */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 3 }}>{monitor.name}</div>
        <div style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {monitor.target}
        </div>
      </div>

      {/* Response time + status code */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Response</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: responseColor(monitor.last_response_ms, monitor.last_error_class) }}>
          {monitor.last_error_class === 'timeout' ? 'Timeout'
            : monitor.last_response_ms !== null ? `${monitor.last_response_ms}ms`
            : '—'}
        </span>
        {monitor.last_status_code !== null && (
          <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto' }}>
            HTTP {monitor.last_status_code}
          </span>
        )}
      </div>

      {/* Uptime chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <UptimeChip label="24h" value={monitor.uptime_24h} />
        <UptimeChip label="7d"  value={monitor.uptime_7d}  />
        <UptimeChip label="30d" value={monitor.uptime_30d} />
      </div>

      {/* Sparkline */}
      <div>
        {sparklineLabel && (
          <div style={{ fontSize: 9, color: 'var(--tx-3)', textAlign: 'right', marginBottom: 2, letterSpacing: '.04em' }}>
            {sparklineLabel}
          </div>
        )}
        {isLoading ? (
          <div className="skeleton" style={{ height: 60, borderRadius: 'var(--r-sm)' }} />
        ) : (
          <Sparkline checks={checks} />
        )}
      </div>

      {/* Active incident banner */}
      {hasActiveIncident && (
        <div style={{
          background: C.dangerBg,
          borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder,
          borderRadius: 'var(--r-sm)', padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.danger }}>
            🔴 Down since {incidentAge(monitor.incident_started_at!)}
          </div>
          {monitor.incident_probable_cause && (
            <div style={{ fontSize: 11, color: 'var(--tx-2)' }}>{monitor.incident_probable_cause}</div>
          )}
          {monitor.incident_attack_indicators && monitor.incident_attack_indicators.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--tx-3)', fontStyle: 'italic' }}>
              {monitor.incident_attack_indicators[0]}
            </div>
          )}
          {(monitor.incident_concurrent_down ?? 0) >= 2 && (
            <div style={{ fontSize: 11, color: C.warning, fontWeight: 600 }}>
              ⚠️ {monitor.incident_concurrent_down} monitors simultaneously down
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Health Summary ───────────────────────────────────────────

function scoreColor(pct: number): string {
  if (pct >= 99) return C.success
  if (pct >= 95) return C.success
  if (pct >= 80) return C.warning
  return C.danger
}

function scoreLabel(pct: number): string {
  if (pct >= 99) return 'Excellent'
  if (pct >= 95) return 'Good'
  if (pct >= 80) return 'Fair'
  if (pct >= 60) return 'Poor'
  return 'Critical'
}

interface SummaryMetrics {
  enabled: MonitorRow[]
  up: MonitorRow[]
  down: MonitorRow[]
  degraded: MonitorRow[]
  avgUptime7d: number | null
  avgResponseMs: number | null
  avgResolutionSec: number | null
  incidents7d: IncidentRow[]
  openIncidents: IncidentRow[]
  troubled: MonitorRow[]    // < 95 % 7d uptime
  timedOut: MonitorRow[]    // every check timing out (avg ≥ 9 500 ms)
  reliable: MonitorRow[]    // ≥ 99 % 7d uptime and currently up
}

function computeMetrics(monitors: MonitorRow[], incidents: IncidentRow[]): SummaryMetrics {
  const enabled   = monitors.filter(m => m.enabled)
  const up        = enabled.filter(m => m.status === 'up')
  const down      = enabled.filter(m => m.status === 'down')
  const degraded  = enabled.filter(m => m.status === 'degraded')

  const withUptime = enabled.filter(m => m.uptime_7d !== null)
  const avgUptime7d = withUptime.length > 0
    ? withUptime.reduce((s, m) => s + (m.uptime_7d ?? 0), 0) / withUptime.length
    : null

  // Only average response time for monitors that are NOT timing out
  const healthy = enabled.filter(m => m.avg_response_24h !== null && m.avg_response_24h < 9_500)
  const avgResponseMs = healthy.length > 0
    ? Math.round(healthy.reduce((s, m) => s + (m.avg_response_24h ?? 0), 0) / healthy.length)
    : null

  const incidents7d    = incidents  // already filtered to the selected time range by fetchAll
  const openIncidents  = incidents.filter(i => i.is_open)
  const closed         = incidents.filter(i => !i.is_open && i.duration_seconds !== null)
  const avgResolutionSec = closed.length > 0
    ? closed.reduce((s, i) => s + (i.duration_seconds ?? 0), 0) / closed.length
    : null

  const timedOut  = enabled.filter(m => m.avg_response_24h !== null && m.avg_response_24h >= 9_500)
  // "Needs Attention" = only currently failing monitors — operational monitors never appear here
  const troubled  = enabled.filter(m => m.status === 'down' || m.status === 'degraded')
    .sort((a, b) => (a.uptime_7d ?? 0) - (b.uptime_7d ?? 0))
  const reliable  = enabled.filter(m => (m.uptime_7d ?? 0) >= 99 && m.status !== 'down').sort((a, b) => (b.uptime_7d ?? 0) - (a.uptime_7d ?? 0))

  return { enabled, up, down, degraded, avgUptime7d, avgResponseMs, avgResolutionSec, incidents7d, openIncidents, troubled, timedOut, reliable }
}

interface BulletPoint { icon: string; text: string; color: string; key: string }

function buildBullets(m: SummaryMetrics): BulletPoint[] {
  if (m.enabled.length === 0) return [{ icon: '—', text: 'No monitors configured yet', color: C.muted, key: 'no-monitors' }]
  const bullets: BulletPoint[] = []

  if (m.down.length > 0) {
    bullets.push({ icon: '✕', text: `${m.down.map(mon => mon.name).join(', ')} — currently down`, color: C.danger, key: `down:${m.down.map(mon => mon.id).join(',')}` })
  }
  if (m.degraded.length > 0) {
    bullets.push({ icon: '⚠', text: `${m.degraded.map(mon => mon.name).join(', ')} — degraded performance`, color: C.warning, key: `degraded:${m.degraded.map(mon => mon.id).join(',')}` })
  }

  const partial = m.enabled.filter(mon =>
    mon.status !== 'down' && mon.uptime_7d !== null &&
    (mon.uptime_7d ?? 0) > 0 && (mon.uptime_7d ?? 0) < 95
  )
  if (partial.length === 1) {
    const mon = partial[0]
    bullets.push({ icon: '⚠', text: `${mon.name}: ${(mon.uptime_7d ?? 0).toFixed(1)}% uptime — ${mon.down_checks_24h ?? 0}/${mon.total_checks_24h ?? 0} checks failed in 24h`, color: C.warning, key: `partial:${mon.id}` })
  } else if (partial.length > 1) {
    const worst = partial.reduce((a, b) => (a.uptime_7d ?? 100) < (b.uptime_7d ?? 100) ? a : b)
    bullets.push({ icon: '⚠', text: `${partial.length} monitors with intermittent failures — lowest: ${worst.name} at ${(worst.uptime_7d ?? 0).toFixed(1)}%. All currently operational.`, color: C.warning, key: `partial-group:${partial.map(p => p.id).join(',')}` })
  }

  if (m.down.length === 0 && m.degraded.length === 0 && partial.length === 0) {
    bullets.push({ icon: '✓', text: 'All services healthy — no issues detected', color: C.success, key: 'all-clear' })
  }

  const perfect = m.enabled.filter(mon => (mon.uptime_7d ?? 0) >= 99.9 && mon.status !== 'down')
  if (perfect.length > 0) {
    bullets.push({ icon: '✓', text: `${perfect.map(mon => mon.name).join(', ')} — 100% uptime (7d avg)`, color: C.success, key: `perfect:${perfect.map(p => p.id).join(',')}` })
  }

  const inc7d = m.incidents7d.length
  if (inc7d === 0) {
    bullets.push({ icon: '✓', text: 'No incidents in the selected period', color: C.success, key: 'no-incidents-7d' })
  } else if (m.openIncidents.length > 0) {
    bullets.push({ icon: '✕', text: `${inc7d} incident${inc7d !== 1 ? 's' : ''} — ${m.openIncidents.length} still open`, color: C.danger, key: `open-incidents:${m.openIncidents.map(i => i.id).join(',')}` })
  } else {
    bullets.push({ icon: '✓', text: `${inc7d} incident${inc7d !== 1 ? 's' : ''} — all resolved${m.avgResolutionSec !== null ? ` (avg ${formatDuration(Math.round(m.avgResolutionSec))})` : ''}`, color: C.success, key: `resolved-${inc7d}` })
  }

  return bullets
}

function StatChip({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--surface-2)',
      borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
      borderRadius: 'var(--r-md)', padding: '10px 16px', flex: '1 1 130px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color ?? 'var(--tx-1)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ─── Uptime Ring ─────────────────────────────────────────────

function UptimeRing({ value, size = 130, sub = '7d avg uptime' }: { value: number | null; size?: number; sub?: string }) {
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const pct = value !== null ? Math.max(0, Math.min(100, value)) : 0
  const dash = (pct / 100) * circ
  const color = value === null ? C.muted : pct >= 99 ? C.success : pct >= 95 ? C.warning : C.danger
  const display = value !== null ? (pct >= 99.95 ? '100%' : `${value.toFixed(1)}%`) : '—'
  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }} aria-label={`Uptime: ${display}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(125,133,144,.18)" strokeWidth={10} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transformOrigin: '50% 50%', transform: 'rotate(-90deg)', transition: 'stroke-dasharray .7s ease' }}
      />
      <text x="50%" y="44%" dominantBaseline="middle" textAnchor="middle"
        style={{ fill: color, fontSize: `${Math.round(size / 6.5)}px`, fontWeight: 800 }}>
        {display}
      </text>
      <text x="50%" y="62%" textAnchor="middle"
        style={{ fill: '#7D8590', fontSize: `${Math.round(size / 10)}px` }}>
        {sub}
      </text>
    </svg>
  )
}

// ─── Monitor Status Grid ──────────────────────────────────────

function MonitorStatusGrid({ monitors, onOpenMonitor }: { monitors: MonitorRow[]; onOpenMonitor: (m: MonitorRow) => void }) {
  const enabled = monitors.filter(m => m.enabled)
  if (enabled.length === 0) return <p style={{ fontSize: 12, color: '#7D8590', fontStyle: 'italic' }}>No monitors configured.</p>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {enabled.map(mon => {
        const info = statusInfo(mon)
        return (
          <button
            key={mon.id}
            onClick={() => onOpenMonitor(mon)}
            title={`${mon.name} · ${info.label}${mon.uptime_7d !== null ? ` · ${mon.uptime_7d.toFixed(1)}% 7d uptime` : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 11px', borderRadius: 20,
              border: `1px solid ${info.color}40`,
              background: info.color + '12',
              cursor: 'pointer', transition: 'opacity .15s',
            }}
          >
            <span
              className={info.pulse ? 'anim-pulse' : undefined}
              style={{ width: 7, height: 7, borderRadius: '50%', background: info.color, flexShrink: 0 }}
            />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tx-1)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mon.name}
            </span>
            {mon.uptime_7d !== null && (
              <span style={{ fontSize: 10, fontWeight: 700, color: info.color }}>{mon.uptime_7d.toFixed(1)}%</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Response Time Bars ───────────────────────────────────────

function ResponseTimeBars({ monitors }: { monitors: MonitorRow[] }) {
  const data = monitors
    .filter(m => m.enabled && m.avg_response_24h !== null && (m.avg_response_24h as number) < 9500)
    .sort((a, b) => (b.avg_response_24h ?? 0) - (a.avg_response_24h ?? 0))
    .slice(0, 10)
  if (data.length === 0) return null
  const maxMs = Math.max(...data.map(m => m.avg_response_24h ?? 0), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {data.map(mon => {
        const ms = mon.avg_response_24h ?? 0
        const threshold = isWebEndpoint(mon.name) ? 800 : 200
        const color = ms >= threshold ? C.danger : ms >= threshold * 0.8 ? C.warning : C.success
        const pct = Math.max(3, (ms / maxMs) * 100)
        return (
          <div key={mon.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--tx-2)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{mon.name}</span>
            <div style={{ flex: 1, height: 7, background: 'rgba(125,133,144,.15)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .5s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color, width: 52, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(ms)}ms
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MonitorHealthRow({ monitor, type }: { monitor: MonitorRow; type: 'troubled' | 'reliable' }) {
  const isTrouble = type === 'troubled'
  const dotColor  = isTrouble ? C.danger : C.success
  const textColor = isTrouble ? C.danger : C.success
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0',
      borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {monitor.name}
      </span>
      <span style={{ fontSize: 11, color: textColor, fontWeight: 600, flexShrink: 0 }}>
        {monitor.uptime_7d !== null ? `${monitor.uptime_7d.toFixed(1)}%` : '—'} 7d
      </span>
      {monitor.avg_response_24h !== null && monitor.avg_response_24h < 9_500 && (
        <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>
          {Math.round(monitor.avg_response_24h)}ms
        </span>
      )}
    </div>
  )
}

function HealthSummary({ monitors, incidents, timeRange }: { monitors: MonitorRow[]; incidents: IncidentRow[]; timeRange: TimeRange }) {
  const m = computeMetrics(monitors, incidents)

  if (monitors.length === 0) return null

  const uptimeField: keyof MonitorRow =
    timeRange === 'today' ? 'uptime_24h' : timeRange === '7d' ? 'uptime_7d' : 'uptime_30d'
  const uptimePeriodLabel =
    timeRange === 'today' ? '24h' : timeRange === '7d' ? '7d' : '30d'
  const withUptime = m.enabled.filter(mon => mon[uptimeField] !== null)
  const score = withUptime.length > 0
    ? withUptime.reduce((s, mon) => s + ((mon[uptimeField] as number) ?? 0), 0) / withUptime.length
    : null
  const sColor  = score !== null ? scoreColor(score) : C.muted
  const sLabel  = score !== null ? scoreLabel(score) : 'Unknown'
  const bullets = buildBullets(m)

  const statusSummary = [
    m.up.length > 0      && `${m.up.length} up`,
    m.down.length > 0    && `${m.down.length} down`,
    m.degraded.length > 0 && `${m.degraded.length} degraded`,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{
      background: 'var(--surface-1)',
      borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
      borderRadius: 'var(--r-lg)', marginBottom: 24, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Health Analysis</h2>
        <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
          {m.enabled.length} monitor{m.enabled.length !== 1 ? 's' : ''} evaluated
        </span>
      </div>

      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stat chips */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatChip
            label={`${uptimePeriodLabel} avg uptime`}
            value={score !== null ? `${score.toFixed(1)}%` : '—'}
            color={sColor}
            sub={sLabel}
          />
          <StatChip
            label="Monitor status"
            value={`${m.up.length} / ${m.enabled.length}`}
            color={m.down.length > 0 ? C.danger : m.degraded.length > 0 ? C.warning : C.success}
            sub={statusSummary}
          />
          <StatChip
            label={`Incidents (${uptimePeriodLabel})`}
            value={String(m.incidents7d.length)}
            color={m.openIncidents.length > 0 ? C.danger : m.incidents7d.length > 0 ? C.warning : C.success}
            sub={m.openIncidents.length > 0 ? `${m.openIncidents.length} open` : m.incidents7d.length === 0 ? 'None recorded' : 'All resolved'}
          />
          <StatChip
            label="Avg response"
            value={m.avgResponseMs !== null ? `${m.avgResponseMs}ms` : '—'}
            color={m.avgResponseMs !== null ? responseColor(m.avgResponseMs, null) : C.muted}
            sub="healthy monitors only"
          />
          {m.avgResolutionSec !== null && (
            <StatChip
              label="Avg resolution"
              value={formatDuration(Math.round(m.avgResolutionSec))}
              color="var(--tx-1)"
              sub="per incident"
            />
          )}
        </div>

        {/* Bullet points */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bullets.map((b, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '8px 12px',
              background: 'var(--surface-2)',
              borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
              borderRadius: 'var(--r-md)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: b.color, flexShrink: 0, lineHeight: '18px' }}>{b.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: '18px' }}>{b.text}</span>
            </div>
          ))}
        </div>

        {/* Needs Attention */}
        {m.troubled.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.warning, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
              ⚠ Needs Attention
            </div>
            {m.troubled.map(mon => <MonitorHealthRow key={mon.id} monitor={mon} type="troubled" />)}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Failed Checks Section ────────────────────────────────────

function FailedChecksSection({ monitors, failedChecks, windowLabel }: {
  monitors: MonitorRow[]
  failedChecks: FailedCheckRow[]
  windowLabel: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const nameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const mon of monitors) m[mon.id] = mon.name
    return m
  }, [monitors])

  const byMonitor = useMemo(() => {
    const map: Record<string, FailedCheckRow[]> = {}
    for (const fc of failedChecks) {
      if (!map[fc.monitor_id]) map[fc.monitor_id] = []
      map[fc.monitor_id].push(fc)
    }
    return map
  }, [failedChecks])

  const monitorIds = Object.keys(byMonitor)
  if (monitorIds.length === 0) return null

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) { next.delete(id) } else { next.add(id) }
    return next
  })

  return (
    <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Recent Failed Checks</h2>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: C.dangerBg, color: C.danger, borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder }}>
          {failedChecks.length} failures · {monitorIds.length} monitor{monitorIds.length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--tx-3)', marginLeft: 'auto' }}>{windowLabel} — click a row to expand</span>
      </div>

      {monitorIds.map((monId, mIdx) => {
        const name = nameMap[monId] ?? monId
        const checks = byMonitor[monId]
        const isOpen = expanded.has(monId)
        const isLast = mIdx === monitorIds.length - 1

        const errorCounts: Record<string, number> = {}
        for (const c of checks) { const k = c.error_class ?? 'unknown'; errorCounts[k] = (errorCounts[k] ?? 0) + 1 }
        const topErrors = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)

        return (
          <div key={monId} style={{ borderBottomWidth: isLast && !isOpen ? 0 : 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <button onClick={() => toggle(monId)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 10, color: 'var(--tx-3)', display: 'inline-block', width: 10, flexShrink: 0, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', minWidth: 140 }}>{name}</span>
                <span style={{ fontSize: 12, color: C.danger, fontWeight: 600, flexShrink: 0 }}>{checks.length} failure{checks.length !== 1 ? 's' : ''}</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
                  {topErrors.map(([ec, cnt]) => (
                    <span key={ec} style={{ fontSize: 10, padding: '1px 8px', borderRadius: 10, background: 'var(--surface-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>
                      {cnt}× {errorLabel(ec)}
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--tx-3)', flexShrink: 0 }}>
                  Last: {formatMYT(checks[0].checked_at)}
                </span>
              </button>
            </div>

            {isOpen && (
              <div style={{ borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        {['Time (MYT)', 'Status', 'HTTP', 'Error Type', 'Error Message', 'Response'].map(h => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {checks.slice(0, 20).map((c, ci) => (
                        <tr key={c.id} style={{ borderBottomWidth: ci < Math.min(checks.length, 20) - 1 ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
                          <td style={{ padding: '7px 14px', color: 'var(--tx-2)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                            {new Date(c.checked_at).toLocaleString('en-MY', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                          </td>
                          <td style={{ padding: '7px 14px' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: c.status === 'down' ? C.dangerBg : C.warningBg, color: c.status === 'down' ? C.danger : C.warning, borderWidth: 1, borderStyle: 'solid', borderColor: c.status === 'down' ? C.dangerBorder : C.warningBorder, textTransform: 'uppercase' }}>
                              {c.status}
                            </span>
                          </td>
                          <td style={{ padding: '7px 14px', color: 'var(--tx-2)', fontFamily: 'monospace' }}>{c.status_code ?? '—'}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>{errorLabel(c.error_class)}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--tx-3)', maxWidth: 300 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.error_message ?? '—'}</div>
                          </td>
                          <td style={{ padding: '7px 14px', color: 'var(--tx-2)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            {c.response_time_ms !== null ? `${c.response_time_ms}ms` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {checks.length > 20 && (
                  <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--tx-3)', textAlign: 'right', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
                    Showing 20 of {checks.length} failures in the last 24h
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Performance Insights Section ─────────────────────────────

function PerformanceInsightsSection({ monitors }: { monitors: MonitorRow[] }) {
  const slow = monitors.filter(m => {
    if (!m.avg_response_24h || !m.enabled) return false
    return m.avg_response_24h >= (isWebEndpoint(m.name) ? 800 : 200)
  })
  if (slow.length === 0) return null

  return (
    <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Performance Insights</h2>
        <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{slow.length} monitor{slow.length !== 1 ? 's' : ''} above response benchmark</span>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {slow.map(m => {
          const avg  = Math.round(m.avg_response_24h ?? 0)
          const p95  = m.p95_response_24h !== null ? Math.round(m.p95_response_24h) : null
          const web  = isWebEndpoint(m.name)
          const table = web ? WEB_PERCENTILES : API_PERCENTILES
          const benchmark = web ? 800 : 200
          const scale     = web ? 3000 : 800
          const pct       = interpolatePercentile(avg, table)
          const barPct    = Math.min(100, (avg / scale) * 100)
          const bmPct     = Math.min(100, (benchmark / scale) * 100)
          const barColor  = avg > benchmark * 2.25 ? C.danger : C.warning
          const reasons   = getSlownessReasons(m, web)

          return (
            <div key={m.id} style={{ background: 'var(--surface-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: C.warningBg, color: C.warning, borderWidth: 1, borderStyle: 'solid', borderColor: C.warningBorder }}>SLOW</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)' }}>{m.name}</span>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>
                  Avg {avg}ms{p95 !== null ? ` · P95 ${p95}ms` : ''}
                </span>
              </div>

              {/* Response bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--border)' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${barPct}%`, background: barColor, borderRadius: 4, transition: 'width .3s' }} />
                  <div style={{ position: 'absolute', top: -4, bottom: -4, left: `${bmPct}%`, width: 2, background: C.success, borderRadius: 1 }} title={`Target: ${benchmark}ms`} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: 'var(--tx-3)' }}>
                  <span>0ms</span>
                  <span style={{ color: C.success }}>✓ {benchmark}ms target</span>
                  <span>{scale}ms</span>
                </div>
              </div>

              {/* Percentile summary */}
              <div style={{ fontSize: 13, color: 'var(--tx-2)', marginBottom: 12, padding: '8px 12px', background: 'var(--surface-1)', borderRadius: 'var(--r-sm)', lineHeight: 1.5 }}>
                Avg response of <strong style={{ color: 'var(--tx-1)' }}>{avg}ms</strong> is slower than approximately{' '}
                <strong style={{ color: barColor }}>{pct}% of comparable {web ? 'web pages' : 'API endpoints'}</strong> globally
                {pct < 60 && <span style={{ color: 'var(--tx-3)' }}> — marginally above the good threshold, monitor trend</span>}
                .
              </div>

              {/* Potential causes */}
              {reasons.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Potential Causes</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {reasons.map((r, i) => <li key={i} style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.5 }}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Monitor Detail Panel ─────────────────────────────────────

function MonitorDetailPanel({ monitor, incidents, monitorNames, onClose, initialChecks }: {
  monitor: MonitorRow
  incidents: IncidentRow[]
  monitorNames: Record<string, string>
  onClose: () => void
  initialChecks: CheckRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const info = statusInfo(monitor)
  const monitorIncidents = incidents.filter(i => i.monitor_id === monitor.id)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [checkRange, setCheckRange] = useState<CheckRange>('1h')
  const [panelChecks, setPanelChecks] = useState<CheckRow[]>(initialChecks)
  const [loadingChecks, setLoadingChecks] = useState(false)
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null)
  const [logCache, setLogCache] = useState<Record<string, {
    events: { timestamp: number | null; message: string }[]
    analysis: string | null
    loading: boolean
    error: string | null
  }>>({})
  const fetchedLogKeys = useRef<Set<string>>(new Set())

  const fetchCheckLogs = async (checked_at: string, status_code: number | null) => {
    const logGroup = deriveLogGroup(monitor.target)
    if (!logGroup) return
    const key = checked_at
    if (fetchedLogKeys.current.has(key)) return
    fetchedLogKeys.current.add(key)
    setLogCache(prev => ({ ...prev, [key]: { events: [], analysis: null, loading: true, error: null } }))
    const ts = new Date(checked_at).getTime()
    const params = new URLSearchParams({
      logGroup,
      start: String(ts - 2 * 60_000),
      end: String(ts + 2 * 60_000),
      monitorId: monitor.id,
      checkedAt: checked_at,
    })
    if (status_code) params.set('filter', String(status_code))
    try {
      const res = await fetch(`/api/cloudwatch-logs?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setLogCache(prev => ({ ...prev, [key]: { events: data.events, analysis: data.analysis, loading: false, error: null } }))
    } catch (err: unknown) {
      fetchedLogKeys.current.delete(key)
      const msg = err instanceof Error ? err.message : 'Failed to load logs'
      setLogCache(prev => ({ ...prev, [key]: { events: [], analysis: null, loading: false, error: msg } }))
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const opt = CHECK_RANGE_OPTS.find(o => o.id === checkRange)
    if (!opt) return
    setLoadingChecks(true)
    const since = new Date(Date.now() - opt.minutes * 60_000).toISOString()
    supabase
      .from('checks')
      .select('monitor_id, status, response_time_ms, checked_at, error_class, error_message, status_code')
      .eq('monitor_id', monitor.id)
      .gte('checked_at', since)
      .order('checked_at', { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (!error && data) setPanelChecks((data as CheckRow[]).filter(c => !isMaintenancePeriod(c.checked_at)))
        setLoadingChecks(false)
      })
  }, [checkRange, monitor.id, supabase])

  const toggleIndicators = (id: string) => setExpandedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50 }} />
      <div className="anim-slidein" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 100vw)',
        background: 'var(--surface-1)',
        borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: 'var(--border)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 51, display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 20px',
          borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
          flexShrink: 0, position: 'sticky', top: 0, background: 'var(--surface-1)', zIndex: 1,
        }}>
          <span
            className={info.pulse ? 'anim-pulse' : undefined}
            style={{ width: 9, height: 9, borderRadius: '50%', background: info.color, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)' }}>{monitor.name}</div>
            <div style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {monitor.target}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: 'var(--r-sm)',
            background: 'var(--surface-2)', color: 'var(--tx-3)', cursor: 'pointer',
            borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
          }}>
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Metrics row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {([
              { label: '24h uptime',    val: monitor.uptime_24h    !== null ? `${monitor.uptime_24h.toFixed(2)}%`        : '—', color: uptimeColors(monitor.uptime_24h).text },
              { label: '7d uptime',     val: monitor.uptime_7d     !== null ? `${monitor.uptime_7d.toFixed(2)}%`         : '—', color: uptimeColors(monitor.uptime_7d).text },
              { label: 'Avg resp 24h',  val: monitor.avg_response_24h  !== null ? `${Math.round(monitor.avg_response_24h)}ms`  : '—', color: responseColor(monitor.avg_response_24h, null) },
              { label: 'P95 resp 24h',  val: monitor.p95_response_24h  !== null ? `${Math.round(monitor.p95_response_24h)}ms`  : '—', color: responseColor(monitor.p95_response_24h, null) },
            ] as const).map(({ label, val, color }) => (
              <div key={label} style={{
                background: 'var(--surface-2)',
                borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
                borderRadius: 'var(--r-md)', padding: '8px 14px', flex: '1 1 120px',
              }}>
                <div style={{ fontSize: 10, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Response time chart + range selector */}
          <div style={{ background: 'var(--surface-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-2)' }}>
                Response times{loadingChecks ? ' …' : ` (${panelChecks.length} checks, excl. maintenance)`}
              </span>
              <div style={{ display: 'flex', gap: 2, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 2 }}>
                {CHECK_RANGE_OPTS.map(opt => (
                  <button key={opt.id} onClick={() => setCheckRange(opt.id)} style={{
                    fontSize: 11, fontWeight: checkRange === opt.id ? 700 : 400,
                    padding: '3px 9px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    background: checkRange === opt.id ? 'var(--orange-dim)' : 'transparent',
                    color: checkRange === opt.id ? 'var(--orange)' : 'var(--tx-3)',
                    whiteSpace: 'nowrap', transition: 'all .12s',
                  }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {loadingChecks ? (
              <div className="skeleton" style={{ height: 60, borderRadius: 'var(--r-sm)' }} />
            ) : (
              <Sparkline checks={panelChecks} />
            )}
          </div>

          {/* Anomalous checks timeline */}
          {(() => {
            if (loadingChecks) return null
            const nonZero = panelChecks.filter(c => c.response_time_ms !== null && c.response_time_ms > 0)
            const avg = nonZero.length ? nonZero.reduce((s, c) => s + c.response_time_ms!, 0) / nonZero.length : 0
            const anomalous = panelChecks
              .filter(c => c.status !== 'up' || (avg > 0 && (c.response_time_ms ?? 0) >= avg * 2))
              .slice()
              .reverse()
            if (anomalous.length === 0) return null
            return (
              <div style={{ background: 'var(--surface-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '9px 14px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)' }}>Anomalous Checks</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: C.dangerBg, color: C.danger, fontWeight: 700, border: `1px solid ${C.dangerBorder}` }}>
                    {anomalous.length}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto' }}>
                    {avg > 0 ? `avg ${Math.round(avg)}ms · ⚡ = ≥${Math.round(avg * 2)}ms` : 'failures only'}
                  </span>
                </div>
                <div>
                  {anomalous.slice(0, 60).map((c, i) => {
                    const isDown  = c.status === 'down'
                    const isDeg   = c.status === 'degraded'
                    const isSpike = avg > 0 && c.status === 'up' && (c.response_time_ms ?? 0) >= avg * 2
                    const dotColor = isDown ? C.danger : isDeg ? C.warning : isSpike ? spikeSeverityColor(c.response_time_ms ?? 0, avg) : C.warning
                    const time = new Date(c.checked_at).toLocaleString('en-MY', {
                      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
                    })
                    const hasLogs    = !!deriveLogGroup(monitor.target)
                    const logKey     = c.checked_at
                    const isLogOpen  = expandedLogKey === logKey
                    const logData    = logCache[logKey]
                    const isLastItem = i === anomalous.slice(0, 60).length - 1
                    return (
                      <div key={i} style={{
                        borderBottomWidth: isLastItem && !isLogOpen ? 0 : 1,
                        borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
                      }}>
                        {/* Check row */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 14px' }}>
                          <span style={{ fontSize: 9, color: dotColor, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                            {isSpike ? '⚡' : isDown ? '✕' : '⚠'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: c.error_class || c.error_message ? 3 : 0 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: dotColor, flexShrink: 0 }}>
                                {c.response_time_ms !== null ? `${c.response_time_ms}ms` : 'Timeout'}
                              </span>
                              {c.status_code != null && (
                                <span style={{ fontSize: 10, color: 'var(--tx-3)', flexShrink: 0 }}>HTTP {c.status_code}</span>
                              )}
                              {isSpike && (
                                <span style={{ fontSize: 10, color: dotColor, fontWeight: 600, flexShrink: 0 }}>spike</span>
                              )}
                              <span style={{ fontSize: 10, color: 'var(--tx-3)', marginLeft: 'auto', flexShrink: 0 }}>{time} MYT</span>
                            </div>
                            {c.error_class && (
                              <div style={{ fontSize: 10, color: 'var(--tx-2)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.error_class}
                              </div>
                            )}
                            {c.error_message && (
                              <div style={{ fontSize: 10, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.error_message}
                              </div>
                            )}
                            {hasLogs && (
                              <button
                                onClick={() => {
                                  const wasOpen = expandedLogKey === logKey
                                  setExpandedLogKey(wasOpen ? null : logKey)
                                  if (!wasOpen) fetchCheckLogs(c.checked_at, c.status_code)
                                }}
                                style={{
                                  marginTop: 4, fontSize: 10, fontWeight: 600, padding: '2px 8px',
                                  borderRadius: 'var(--r-sm)', cursor: 'pointer',
                                  background: isLogOpen ? 'rgba(59,130,246,.15)' : 'var(--surface-2)',
                                  color: isLogOpen ? '#60a5fa' : '#3b82f6',
                                  borderWidth: 1, borderStyle: 'solid',
                                  borderColor: isLogOpen ? 'rgba(59,130,246,.3)' : 'rgba(59,130,246,.2)',
                                }}
                              >
                                {isLogOpen ? 'Hide logs' : 'View logs'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Inline log viewer */}
                        {isLogOpen && (
                          <div style={{ padding: '0 14px 12px 34px' }}>
                            {!logData || logData.loading ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>Fetching logs + AI analysis…</div>
                                {Array.from({ length: 4 }, (_, si) => (
                                  <div key={si} className="skeleton" style={{ height: 8, maxWidth: `${80 - si * 10}%` }} />
                                ))}
                              </div>
                            ) : logData.error ? (
                              <div style={{ fontSize: 10, color: C.danger }}>⚠ {logData.error}</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {logData.analysis && (
                                  <div style={{ background: 'rgba(59,130,246,.08)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(59,130,246,.2)', borderRadius: 'var(--r-sm)', padding: '8px 10px' }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>AI Diagnosis</div>
                                    <p style={{ margin: 0, fontSize: 11, color: 'var(--tx-1)', lineHeight: 1.55 }}>{logData.analysis}</p>
                                  </div>
                                )}
                                {logData.events.length === 0 ? (
                                  <div style={{ fontSize: 10, color: 'var(--tx-3)', fontStyle: 'italic' }}>No log events found in this ±2 min window.</div>
                                ) : (
                                  <div>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
                                      {logData.events.length} events · ±2 min window
                                    </div>
                                    <pre style={{ margin: 0, padding: '8px 10px', background: '#0d1117', borderRadius: 'var(--r-sm)', fontSize: 10, fontFamily: 'monospace', overflowX: 'auto', maxHeight: 220, overflowY: 'auto', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                      {logData.events.map((ev, ei) => {
                                        const msg     = ev.message ?? ''
                                        const isErr   = /error|fatal|exception/i.test(msg)
                                        const isWarn  = /warn/i.test(msg)
                                        const evTs    = ev.timestamp
                                          ? new Date(ev.timestamp).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                          : ''
                                        return (
                                          <div key={ei} style={{ color: isErr ? C.danger : isWarn ? C.warning : 'var(--tx-2)', marginBottom: 1 }}>
                                            {evTs && <span style={{ color: 'var(--tx-3)', marginRight: 8, fontSize: 9 }}>{evTs}</span>}
                                            {msg}
                                          </div>
                                        )
                                      })}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Active incident */}
          {monitor.active_incident_id !== null && (
            <div style={{
              background: C.dangerBg,
              borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder,
              borderRadius: 'var(--r-md)', padding: '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.danger }}>
                🔴 Active Incident
                {monitor.incident_started_at && (
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--tx-3)', marginLeft: 8 }}>
                    since {incidentAge(monitor.incident_started_at)}
                  </span>
                )}
              </div>

              {monitor.incident_probable_cause && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Probable Cause</div>
                  <div style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.5 }}>{monitor.incident_probable_cause}</div>
                </div>
              )}

              {monitor.incident_attack_indicators && monitor.incident_attack_indicators.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Attack Indicators</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {monitor.incident_attack_indicators.map((ind, i) => (
                      <li key={i} style={{ fontSize: 12, color: 'var(--tx-2)' }}>{ind}</li>
                    ))}
                  </ul>
                </div>
              )}

              {monitor.incident_error_message && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>Error Message</div>
                  <pre className="font-mono" style={{
                    fontSize: 11, color: C.danger, background: 'var(--surface-3)',
                    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
                    borderRadius: 'var(--r-sm)', padding: '8px 10px', margin: 0,
                    overflowX: 'auto', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160,
                  }}>
                    {monitor.incident_error_message}
                  </pre>
                </div>
              )}

              {(monitor.incident_concurrent_down ?? 0) >= 2 && (
                <div style={{
                  background: C.warningBg,
                  borderWidth: 1, borderStyle: 'solid', borderColor: C.warningBorder,
                  borderRadius: 'var(--r-sm)', padding: '8px 12px',
                  fontSize: 12, fontWeight: 600, color: C.warning,
                }}>
                  ⚠️ Multiple monitors were simultaneously down — possible infrastructure-level incident
                </div>
              )}
            </div>
          )}

          {/* Incident history */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 10 }}>Incident History</div>
            {monitorIncidents.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--tx-3)', fontStyle: 'italic' }}>No incidents recorded for this monitor.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {monitorIncidents.map(inc => (
                  <div key={inc.id} style={{
                    background: 'var(--surface-2)',
                    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
                    borderRadius: 'var(--r-md)', padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span
                        className={inc.is_open ? 'anim-pulse' : undefined}
                        style={{ width: 7, height: 7, borderRadius: '50%', background: inc.is_open ? C.danger : C.muted, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-1)' }}>
                        {new Date(inc.started_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })} MYT
                      </span>
                      <span style={{ fontSize: 11, color: inc.is_open ? C.danger : 'var(--tx-3)', marginLeft: 'auto', fontWeight: inc.is_open ? 600 : 400 }}>
                        {incidentDurationStr(inc)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--tx-2)' }}>
                      {inc.probable_cause ?? inc.first_error_class ?? 'Unknown cause'}
                    </div>
                    {/* Use monitorNames map as fallback for the panel title */}
                    {inc.monitor_id !== monitor.id && (
                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 2 }}>
                        {inc.monitors?.name ?? monitorNames[inc.monitor_id] ?? inc.monitor_id}
                      </div>
                    )}
                    {inc.attack_indicators && inc.attack_indicators.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          onClick={() => toggleIndicators(inc.id)}
                          style={{ fontSize: 10, color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          {expandedIds.has(inc.id) ? 'Hide' : 'Show'} indicators
                        </button>
                        {expandedIds.has(inc.id) && (
                          <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
                            {inc.attack_indicators.map((ind, i) => (
                              <li key={i} style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 2 }}>{ind}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Skeleton Card ────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--surface-1)',
      borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
      borderRadius: 'var(--r-lg)', padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div className="skeleton" style={{ height: 10, width: '40%' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="skeleton" style={{ height: 14, width: '70%' }} />
        <div className="skeleton" style={{ height: 10, width: '90%' }} />
      </div>
      <div className="skeleton" style={{ height: 10, width: '30%' }} />
      <div style={{ display: 'flex', gap: 6 }}>
        {[60, 60, 60].map((w, i) => <div key={i} className="skeleton" style={{ height: 20, width: w, borderRadius: 12 }} />)}
      </div>
      <div className="skeleton" style={{ height: 60 }} />
    </div>
  )
}

// ─── Tab Types & Bar ─────────────────────────────────────────

type HealthTab = 'overview' | 'monitors' | 'checks' | 'performance' | 'incidents' | 'anomalies'

type TimeRange = 'today' | '7d' | '30d' | '60d' | 'all' | 'custom'

interface TimeWindow { since: string | null; until: string | null }

const TIME_RANGE_OPTS: { id: TimeRange; label: string }[] = [
  { id: 'today',  label: 'Today'    },
  { id: '7d',     label: '7 days'   },
  { id: '30d',    label: '30 days'  },
  { id: '60d',    label: '2 months' },
  { id: 'all',    label: 'All time' },
  { id: 'custom', label: 'Custom'   },
]

function getTimeWindow(r: TimeRange, customFrom?: string, customTo?: string): TimeWindow {
  if (r === 'custom' && customFrom && customTo) {
    return {
      since: new Date(customFrom + 'T00:00:00+08:00').toISOString(),
      until: new Date(customTo   + 'T23:59:59+08:00').toISOString(),
    }
  }
  const days = r === 'today' ? 1 : r === '7d' ? 7 : r === '30d' ? 30 : r === '60d' ? 60 : null
  if (days === null) return { since: null, until: null }
  return { since: new Date(Date.now() - days * 86_400_000).toISOString(), until: null }
}

function getWindowLabel(r: TimeRange, customFrom?: string, customTo?: string): string {
  if (r === 'custom' && customFrom && customTo) return `${customFrom} → ${customTo} MYT`
  if (r === 'today') return 'Last 24h'
  if (r === '7d')    return 'Last 7 days'
  if (r === '30d')   return 'Last 30 days'
  if (r === '60d')   return 'Last 2 months'
  return 'All time'
}

// ─── Monitor check range (for detail panel sparkline) ─────────
type CheckRange = '30m' | '1h' | '2h' | '6h' | '12h' | '24h'
const CHECK_RANGE_OPTS: { id: CheckRange; label: string; minutes: number }[] = [
  { id: '30m', label: '30 min', minutes: 30   },
  { id: '1h',  label: '1 h',   minutes: 60   },
  { id: '2h',  label: '2 h',   minutes: 120  },
  { id: '6h',  label: '6 h',   minutes: 360  },
  { id: '12h', label: '12 h',  minutes: 720  },
  { id: '24h', label: '1 day', minutes: 1440 },
]

function TabBar({ active, onChange, badges }: {
  active: HealthTab
  onChange: (t: HealthTab) => void
  badges: Partial<Record<HealthTab, number | string>>
}) {
  const TABS: { id: HealthTab; label: string }[] = [
    { id: 'overview',    label: 'Overview' },
    { id: 'monitors',    label: 'Monitors' },
    { id: 'checks',      label: 'Failed Checks' },
    { id: 'performance', label: 'Performance' },
    { id: 'incidents',   label: 'Incidents' },
    { id: 'anomalies',   label: 'Anomalies' },
  ]
  return (
    <div style={{ display: 'flex', gap: 0, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', marginBottom: 24, overflowX: 'auto' }}>
      {TABS.map(tab => {
        const badge = badges[tab.id]
        const isActive = active === tab.id
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)} style={{
            padding: '9px 18px', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: isActive ? 700 : 500,
            color: isActive ? 'var(--tx-1)' : 'var(--tx-3)',
            borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: isActive ? '#3b82f6' : 'transparent',
            marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap', flexShrink: 0, transition: 'color .15s',
          }}>
            {tab.label}
            {badge != null && badge !== 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                background: isActive ? 'rgba(59,130,246,.15)' : 'var(--surface-2)',
                color: isActive ? '#3b82f6' : 'var(--tx-3)',
              }}>{badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Down Services Popover & Time Range Bar ───────────────────

function DownServicesPopover({ monitors, onSelect, onClose }: {
  monitors: MonitorRow[]
  onSelect: (m: MonitorRow) => void
  onClose: () => void
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 6px)', right: 0,
        background: 'var(--surface-1)',
        borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder,
        borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
        zIndex: 41, minWidth: 290, overflow: 'hidden',
      }}>
        <div style={{ padding: '8px 14px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="anim-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: C.danger, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: C.danger, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {monitors.length} Service{monitors.length !== 1 ? 's' : ''} Down
          </span>
        </div>
        {monitors.map((m, i) => (
          <button key={m.id} onClick={() => onSelect(m)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', cursor: 'pointer', textAlign: 'left', borderBottomWidth: i < monitors.length - 1 ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
            <span className="anim-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: C.danger, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.incident_started_at ? `Down since ${incidentAge(m.incident_started_at)}` : 'Currently down'} · {m.target}
              </div>
            </div>
            <span style={{ fontSize: 10, color: C.danger, fontWeight: 600, flexShrink: 0 }}>View →</span>
          </button>
        ))}
      </div>
    </>
  )
}

function TimeRangeBar({ value, onChange, customFrom, customTo, onCustomFrom, onCustomTo }: {
  value: TimeRange
  onChange: (r: TimeRange) => void
  customFrom: string
  customTo: string
  onCustomFrom: (d: string) => void
  onCustomTo: (d: string) => void
}) {
  const today = todayMYT()
  const inputStyle: React.CSSProperties = {
    padding: '2px 7px', fontSize: 11, fontWeight: 500,
    background: 'var(--surface-1)', color: 'var(--tx-1)',
    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
    colorScheme: 'dark',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3, flexShrink: 0, flexWrap: 'wrap' }}>
      {TIME_RANGE_OPTS.map(r => {
        const active = value === r.id
        return (
          <button key={r.id} onClick={() => onChange(r.id)} style={{
            fontSize: 12, fontWeight: active ? 700 : 400, padding: '4px 12px',
            borderRadius: 'var(--r-sm)', background: active ? 'var(--orange-dim)' : 'transparent',
            color: active ? 'var(--orange)' : 'var(--tx-3)', border: 'none', cursor: 'pointer',
            transition: 'all .15s', whiteSpace: 'nowrap',
          }}>
            {r.label}
          </button>
        )
      })}
      {value === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8, borderLeft: '1px solid var(--border)', marginLeft: 2, flexWrap: 'wrap' }}>
          <input type="date" value={customFrom} max={customTo || today}
            onChange={e => onCustomFrom(e.target.value)} style={inputStyle} />
          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>to</span>
          <input type="date" value={customTo} min={customFrom} max={today}
            onChange={e => onCustomTo(e.target.value)} style={inputStyle} />
          <span style={{ fontSize: 10, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>MYT</span>
        </div>
      )}
    </div>
  )
}

// ─── Monitor Table Widget (compact, paginated) ────────────────

function MonitorTableWidget({ monitors, loading, onOpenMonitor, tableLimit, onViewAll }: {
  monitors: MonitorRow[]
  loading: boolean
  onOpenMonitor: (m: MonitorRow) => void
  tableLimit: number
  onViewAll: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? monitors : monitors.slice(0, tableLimit)
  const hidden = monitors.length - tableLimit

  return (
    <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)' }}>Monitor Status</span>
        {!loading && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{monitors.length} active</span>}
        <button onClick={onViewAll} style={{ marginLeft: 'auto', fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Full view →
        </button>
      </div>
      {loading ? (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 10 }} />)}
        </div>
      ) : monitors.length === 0 ? (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12 }}>No monitors configured.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['Monitor', 'Status', 'Uptime', 'Response', 'Last check'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((mon, i) => {
                  const info = statusInfo(mon)
                  const u7   = uptimeColors(mon.uptime_7d)
                  return (
                    <tr
                      key={mon.id}
                      onClick={() => onOpenMonitor(mon)}
                      style={{ borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                    >
                      <td style={{ padding: '7px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span className={info.pulse ? 'anim-pulse' : undefined} style={{ width: 6, height: 6, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 500, color: 'var(--tx-1)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{mon.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: info.color }}>{info.label}</span>
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: u7.border, background: u7.bg, color: u7.text, whiteSpace: 'nowrap' }}>
                          {mon.uptime_7d !== null ? `${mon.uptime_7d.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: 11, color: responseColor(mon.avg_response_24h, null), whiteSpace: 'nowrap' }}>
                        {mon.avg_response_24h !== null && mon.avg_response_24h < 9500 ? `${Math.round(mon.avg_response_24h)}ms` : '—'}
                      </td>
                      <td style={{ padding: '7px 12px', fontSize: 10, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>
                        {relativeTime(mon.last_checked_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!showAll && hidden > 0 && (
            <div style={{ padding: '8px 16px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setShowAll(true)}
                style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                Show {hidden} more ↓
              </button>
              <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>or use the Monitors tab for full details</span>
            </div>
          )}
          {showAll && monitors.length > tableLimit && (
            <div style={{ padding: '8px 16px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
              <button
                onClick={() => setShowAll(false)}
                style={{ fontSize: 11, color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Show less ↑
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────

function OverviewTab({ monitors, incidents, failedChecks, loading, timeRange, onNavigate, onOpenMonitor }: {
  monitors: MonitorRow[]
  incidents: IncidentRow[]
  failedChecks: FailedCheckRow[]
  loading: boolean
  timeRange: TimeRange
  onNavigate: (tab: HealthTab) => void
  onOpenMonitor: (mon: MonitorRow) => void
}) {
  const m = useMemo(() => computeMetrics(monitors, incidents), [monitors, incidents])
  const bullets = useMemo(() => buildBullets(m), [m])

  // Pick the pre-computed uptime column that best matches the selected time range
  const uptimeField: keyof MonitorRow =
    timeRange === 'today' ? 'uptime_24h' :
    timeRange === '7d'    ? 'uptime_7d'  : 'uptime_30d'
  const uptimeLabel =
    timeRange === 'today' ? '24h avg uptime' :
    timeRange === '7d'    ? '7d avg uptime'  : '30d avg uptime'
  const activeScore = useMemo(() => {
    const enabled = monitors.filter(mon => mon.enabled)
    const withData = enabled.filter(mon => mon[uptimeField] !== null)
    if (!withData.length) return null
    return withData.reduce((sum, mon) => sum + ((mon[uptimeField] as number) ?? 0), 0) / withData.length
  }, [monitors, uptimeField])

  // Failed check groups
  const byMonitor = useMemo(() => {
    const map: Record<string, FailedCheckRow[]> = {}
    for (const fc of failedChecks) {
      if (!map[fc.monitor_id]) map[fc.monitor_id] = []
      map[fc.monitor_id].push(fc)
    }
    return map
  }, [failedChecks])
  const failMonitorIds   = Object.keys(byMonitor)
  const visibleFailCount = failedChecks.length

  // Slow monitors
  const slowCount = monitors.filter(mon => {
    if (!mon.avg_response_24h || !mon.enabled) return false
    return mon.avg_response_24h >= (isWebEndpoint(mon.name) ? 800 : 200)
  }).length

  const score   = activeScore
  const sColor  = score !== null ? scoreColor(score) : C.muted
  const sLabel  = score !== null ? scoreLabel(score) : 'Unknown'
  const statusSummary = [
    m.up.length > 0       && `${m.up.length} up`,
    m.down.length > 0     && `${m.down.length} down`,
    m.degraded.length > 0 && `${m.degraded.length} degraded`,
  ].filter(Boolean).join(' · ')

  const CARD_BTN = (borderColor: string) => ({
    background: 'var(--surface-1)' as const,
    borderWidth: 1, borderStyle: 'solid' as const, borderColor,
    borderRadius: 'var(--r-lg)', padding: '16px 20px',
    cursor: 'pointer' as const, textAlign: 'left' as const,
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    transition: 'box-shadow .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Hero: Uptime ring + Monitor status grid ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden',
      }}>
        {/* Left: uptime ring */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, padding: '24px 28px',
          borderRight: '1px solid var(--border)',
          background: score !== null && score >= 99 ? `${C.success}08` : score !== null && score < 95 ? `${C.danger}06` : undefined,
        }}>
          {loading ? (
            <div className="skeleton" style={{ width: 140, height: 140, borderRadius: '50%' }} />
          ) : (
            <UptimeRing value={score} size={140} sub={uptimeLabel} />
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20,
            background: sColor + '18', color: sColor, border: `1px solid ${sColor}40`,
          }}>
            {sLabel}
          </span>
        </div>

        {/* Right: monitor grid + stats */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Monitor Status</p>
              {!loading && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{m.enabled.length} active · {statusSummary || 'all up'}</span>}
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 30, width: 110, borderRadius: 20 }} />)}
              </div>
            ) : (
              <MonitorStatusGrid monitors={monitors} onOpenMonitor={onOpenMonitor} />
            )}
          </div>

          {/* Inline stat chips */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <StatChip label={`Incidents (${uptimeLabel.split(' ')[0]})`} value={String(m.incidents7d.length)} color={m.openIncidents.length > 0 ? C.danger : m.incidents7d.length > 0 ? C.warning : C.success} sub={m.openIncidents.length > 0 ? `${m.openIncidents.length} open` : m.incidents7d.length === 0 ? 'None this period' : 'All resolved'} />
            <StatChip label="Avg response" value={m.avgResponseMs !== null ? `${m.avgResponseMs}ms` : '—'} color={m.avgResponseMs !== null ? responseColor(m.avgResponseMs, null) : C.muted} sub="healthy monitors" />
            {m.avgResolutionSec !== null && <StatChip label="Avg resolution" value={formatDuration(Math.round(m.avgResolutionSec))} color="var(--tx-1)" sub="per incident" />}
          </div>
        </div>
      </div>

      {/* ── Issue mini-cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        <button
          onClick={() => onNavigate('checks')}
          style={CARD_BTN(failMonitorIds.length > 0 ? C.dangerBorder : 'var(--border)')}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Failed Checks</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: failMonitorIds.length > 0 ? C.danger : C.muted, lineHeight: 1.1 }}>{visibleFailCount}</div>
          <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            {failMonitorIds.length > 0 ? `${failMonitorIds.length} monitor${failMonitorIds.length !== 1 ? 's' : ''} affected` : 'No failures'}
          </div>
          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, marginTop: 4 }}>View details →</div>
        </button>

        <button
          onClick={() => onNavigate('performance')}
          style={CARD_BTN(slowCount > 0 ? C.warningBorder : 'var(--border)')}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Slow Monitors</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: slowCount > 0 ? C.warning : C.muted, lineHeight: 1.1 }}>{slowCount}</div>
          <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            {slowCount > 0 ? 'above response threshold' : 'All within target'}
          </div>
          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, marginTop: 4 }}>View details →</div>
        </button>

        <button
          onClick={() => onNavigate('incidents')}
          style={CARD_BTN(m.openIncidents.length > 0 ? C.dangerBorder : 'var(--border)')}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Open Incidents</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: m.openIncidents.length > 0 ? C.danger : C.muted, lineHeight: 1.1 }}>{m.openIncidents.length}</div>
          <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            {m.openIncidents.length > 0 ? 'active right now' : `${m.incidents7d.length} in period, all resolved`}
          </div>
          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, marginTop: 4 }}>View all →</div>
        </button>
      </div>

      {/* ── Response time visual chart ── */}
      {!loading && monitors.some(mon => mon.enabled && mon.avg_response_24h !== null && (mon.avg_response_24h as number) < 9500) && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '16px 20px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 2 }}>Response Times — 24h Average</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 14 }}>Thresholds: API 200ms · Frontend 800ms</p>
          <ResponseTimeBars monitors={monitors} />
        </div>
      )}

      {/* ── Health Signals ── */}
      <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)' }}>Health Signals</span>
          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{bullets.length} signal{bullets.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bullets.map(b => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', background: 'var(--surface-2)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-md)' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: b.color, flexShrink: 0, lineHeight: '18px' }}>{b.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: '18px', flex: 1 }}>{b.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Monitor details table ── */}
      {(() => {
        const TABLE_LIMIT = 8
        const enabledMons = monitors.filter(mon => mon.enabled)
        // Sort: down first, then degraded, then by name
        const sorted = [...enabledMons].sort((a, b) => {
          const rank = (m: MonitorRow) => m.status === 'down' ? 0 : m.status === 'degraded' ? 1 : 2
          return rank(a) - rank(b) || a.name.localeCompare(b.name)
        })
        return (
        <MonitorTableWidget
          monitors={sorted}
          loading={loading}
          onOpenMonitor={onOpenMonitor}
          tableLimit={TABLE_LIMIT}
          onViewAll={() => onNavigate('monitors')}
        />
        )
      })()}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────

export default function ServerHealthPage() {
  const supabase = useMemo(() => createClient(), [])
  const [monitors,         setMonitors]         = useState<MonitorRow[]>([])
  const [checksByMonitor,  setChecksByMonitor]  = useState<ChecksByMonitor>({})
  const [incidents,        setIncidents]        = useState<IncidentRow[]>([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState<string | null>(null)
  const [refreshing,       setRefreshing]       = useState(false)
  const [secondsAgo,       setSecondsAgo]       = useState(0)
  const [expandedMonitor,  setExpandedMonitor]  = useState<MonitorRow | null>(null)
  const [expandedIncIds,   setExpandedIncIds]   = useState<Set<string>>(new Set())
  const [failedChecks,     setFailedChecks]     = useState<FailedCheckRow[]>([])
  const [incPage,          setIncPage]          = useState(0)
  const [activeTab,        setActiveTab]        = useState<HealthTab>(() => {
    if (typeof window === 'undefined') return 'overview'
    try {
      const saved = localStorage.getItem('server-health-tab') as HealthTab
      const VALID: HealthTab[] = ['overview', 'monitors', 'checks', 'performance', 'incidents', 'anomalies']
      return VALID.includes(saved) ? saved : 'overview'
    } catch { return 'overview' }
  })
  const [timeRange,        setTimeRange]        = useState<TimeRange>('today')
  const [customFrom,       setCustomFrom]       = useState(() => {
    const d = new Date(Date.now() + 8 * 3_600_000 - 7 * 86_400_000)
    return d.toISOString().slice(0, 10)
  })
  const [customTo,         setCustomTo]         = useState(todayMYT)
  const [sparklineRange,   setSparklineRange]   = useState<CheckRange>('1h')
  const [dataLoading,      setDataLoading]      = useState(false)
  const [showDownPopover,  setShowDownPopover]  = useState(false)
  const [anomalies,        setAnomalies]        = useState<AnomalyRow[]>([])
  const [expandedAnomalyId, setExpandedAnomalyId] = useState<string | null>(null)
  const [anomalyLogs, setAnomalyLogs] = useState<Record<string, {
    events: { timestamp: number | null; message: string }[]
    analysis: string | null
    loading: boolean
    error: string | null
  }>>({})
  const postedAnomalyKeys  = useRef<Set<string>>(new Set())
  const fetchedAnomalyIds  = useRef<Set<string>>(new Set())
  const INC_PAGE_SIZE = 8

  const isMaintenance = isMYTMaintenanceNow()

  const toggleIncident = useCallback((id: string) => {
    setExpandedIncIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const fetchAnomalyLogs = useCallback(async (a: AnomalyRow) => {
    const logGroup = deriveLogGroup(a.monitor_target)
    if (!logGroup) return
    if (fetchedAnomalyIds.current.has(a.id)) return  // cached
    fetchedAnomalyIds.current.add(a.id)
    setAnomalyLogs(prev => ({ ...prev, [a.id]: { events: [], analysis: null, loading: true, error: null } }))
    const ts = new Date(a.checked_at).getTime()
    const params = new URLSearchParams({
      logGroup,
      start: String(ts - 2 * 60_000),
      end: String(ts + 2 * 60_000),
      monitorId: a.monitor_id,
      checkedAt: a.checked_at,
    })
    if (a.status_code) params.set('filter', String(a.status_code))
    try {
      const res = await fetch(`/api/cloudwatch-logs?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setAnomalyLogs(prev => ({ ...prev, [a.id]: { events: data.events, analysis: data.analysis, loading: false, error: null } }))
      // Update local anomalies state so "Initial AI Diagnosis" column reflects the saved result
      if (data.analysis) {
        setAnomalies(prev => prev.map(item =>
          item.id === a.id && !item.ai_analysis ? { ...item, ai_analysis: data.analysis } : item
        ))
      }
    } catch (err: unknown) {
      fetchedAnomalyIds.current.delete(a.id)  // allow retry
      const msg = err instanceof Error ? err.message : 'Failed to load logs'
      setAnomalyLogs(prev => ({ ...prev, [a.id]: { events: [], analysis: null, loading: false, error: msg } }))
    }
  }, [])

  const fetchAll = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    setError(null)
    try {
      const { data: monData, error: mErr } = await supabase
        .from('dashboard_monitor_view')
        .select('*')
        .order('name')
      if (mErr) throw mErr

      const monList: MonitorRow[] = monData ?? []
      setMonitors(monList)

      const checksMap: ChecksByMonitor = {}
      if (monList.length > 0) {
        const sparkOpt = CHECK_RANGE_OPTS.find(o => o.id === sparklineRange)!
        const sparkSince = new Date(Date.now() - sparkOpt.minutes * 60_000).toISOString()
        // Cap at 200 points per monitor — enough for smooth sparklines even at 1-day range
        const pointCap = 200
        const { data: cData, error: cErr } = await supabase
          .from('checks')
          .select('monitor_id, status, response_time_ms, checked_at, error_class, error_message, status_code')
          .in('monitor_id', monList.map(m => m.id))
          .gte('checked_at', sparkSince)
          .order('checked_at', { ascending: false })
          .limit(pointCap * monList.length)
        if (cErr) throw cErr

        for (const row of (cData ?? []) as CheckRow[]) {
          if (!checksMap[row.monitor_id]) checksMap[row.monitor_id] = []
          if (checksMap[row.monitor_id].length < pointCap && !isMaintenancePeriod(row.checked_at)) {
            checksMap[row.monitor_id].push(row)
          }
        }
        for (const k of Object.keys(checksMap)) checksMap[k].reverse()
      }
      setChecksByMonitor(checksMap)

      // ── Anomaly detection ─────────────────────────────────────
      const newAnomalies: {
        monitor_id: string; monitor_name: string; monitor_target: string
        checked_at: string; anomaly_type: 'spike' | 'down' | 'degraded'
        response_time_ms: number | null; avg_ms: number | null; spike_ratio: number | null
        error_class: string | null; error_message: string | null; status_code: number | null
        cloudwatch_url: string | null
      }[] = []
      for (const mon of monList) {
        const rows = checksMap[mon.id] ?? []
        const validMs = rows.map(r => r.response_time_ms).filter((v): v is number => v != null && v > 0)
        const avgMs = validMs.length ? validMs.reduce((a, b) => a + b, 0) / validMs.length : 0
        for (const row of rows) {
          const key = `${mon.id}:${row.checked_at}`
          if (postedAnomalyKeys.current.has(key)) continue
          const isSpike = avgMs > 0 && (row.response_time_ms ?? 0) >= avgMs * 2
          const isDown  = row.status === 'down'
          const isDeg   = row.status === 'degraded'
          if (!isSpike && !isDown && !isDeg) continue
          postedAnomalyKeys.current.add(key)
          const ratio = avgMs > 0 && row.response_time_ms ? row.response_time_ms / avgMs : null
          newAnomalies.push({
            monitor_id:      mon.id,
            monitor_name:    mon.name,
            monitor_target:  mon.target,
            checked_at:      row.checked_at,
            anomaly_type:    isDown ? 'down' : isDeg ? 'degraded' : 'spike',
            response_time_ms: row.response_time_ms,
            avg_ms:          avgMs > 0 ? Math.round(avgMs) : null,
            spike_ratio:     ratio ? parseFloat(ratio.toFixed(2)) : null,
            error_class:     row.error_class,
            error_message:   row.error_message,
            status_code:     row.status_code,
            cloudwatch_url:  buildSpikeCloudWatchUrl(mon.target, row.checked_at, row.status_code),
          })
        }
      }
      if (newAnomalies.length) {
        fetch('/api/anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAnomalies) })
          .catch(() => {/* silent — anomaly storage is best-effort */})
      }
      // Fetch stored anomalies for Anomalies tab (last 30 days)
      const { data: aData } = await supabase
        .from('monitor_anomalies')
        .select('*')
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
        .order('checked_at', { ascending: false })
        .limit(500)
      setAnomalies((aData ?? []) as AnomalyRow[])
      // ─────────────────────────────────────────────────────────

      const win = getTimeWindow(timeRange, customFrom, customTo)
      let incQ = supabase
        .from('incidents')
        .select('*, monitors(name)')
        .order('started_at', { ascending: false })
        .limit(200)
      if (win.since) incQ = incQ.gte('started_at', win.since)
      if (win.until) incQ = incQ.lte('started_at', win.until)
      const { data: iData, error: iErr } = await incQ
      if (iErr) throw iErr
      // Filter out incidents that started during maintenance
      const allInc = (iData ?? []) as IncidentRow[]
      setIncidents(allInc.filter(i => !isMaintenancePeriod(i.started_at)))
      setIncPage(0)

      // Failed checks — window controlled by timeRange
      if (monList.length > 0) {
        const w = getTimeWindow(timeRange, customFrom, customTo)
        let fcQ = supabase
          .from('checks')
          .select('id, monitor_id, status, response_time_ms, status_code, error_class, error_message, checked_at')
          .in('monitor_id', monList.map(m => m.id))
          .neq('status', 'up')
          .order('checked_at', { ascending: false })
          .limit(w.since ? 500 : 1000)
        if (w.since) fcQ = fcQ.gte('checked_at', w.since)
        if (w.until) fcQ = fcQ.lte('checked_at', w.until)
        const { data: fcData, error: fcErr } = await fcQ
        if (!fcErr) {
          const all = (fcData ?? []) as FailedCheckRow[]
          // Exclude checks that occurred during maintenance window (00:00–09:00 MYT)
          setFailedChecks(all.filter(c => !isMaintenancePeriod(c.checked_at)))
        }
      }

      setSecondsAgo(0)
    } catch (err) {
      setError('Failed to load monitor data — retrying in 30 seconds.')
      console.error('[server-health]', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setDataLoading(false)
    }
  }, [supabase, timeRange, customFrom, customTo, sparklineRange])

  useEffect(() => {
    const t = setTimeout(() => fetchAll(false), 0)
    const interval = setInterval(() => fetchAll(true), 30_000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [fetchAll])

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo(s => s + 1), 1_000)
    return () => clearInterval(tick)
  }, [])

  const overallStatus = useMemo(() => computeOverallStatus(monitors), [monitors])

  const monitorNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of monitors) map[m.id] = m.name
    return map
  }, [monitors])

  // Tab badge counts
  const tabBadges = useMemo((): Partial<Record<HealthTab, number>> => {
    const enabled = monitors.filter(m => m.enabled)
    const down    = enabled.filter(m => m.status === 'down' || m.status === 'degraded').length
    const failGroups = new Set(failedChecks.map(fc => fc.monitor_id)).size
    const slow = monitors.filter(m => m.avg_response_24h && m.enabled && m.avg_response_24h >= (isWebEndpoint(m.name) ? 800 : 200)).length
    const openInc = incidents.filter(i => i.is_open).length
    const recentAnomalies = anomalies.filter(a => Date.now() - new Date(a.checked_at).getTime() < 24 * 3_600_000).length
    return {
      monitors:    down > 0 ? down : undefined,
      checks:      failGroups > 0 ? failGroups : undefined,
      performance: slow > 0 ? slow : undefined,
      incidents:   openInc > 0 ? openInc : undefined,
      anomalies:   recentAnomalies > 0 ? recentAnomalies : undefined,
    }
  }, [monitors, failedChecks, incidents, anomalies])

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 48px' }}>

        {/* Error banner */}
        {error && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: C.dangerBg, borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder, borderRadius: 'var(--r-md)', fontSize: 13, color: C.danger, marginBottom: 20 }}>
            <AlertTriangle size={14} aria-hidden />
            {error}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Shield size={20} color="var(--tx-2)" aria-hidden />
              <h1 className="font-brand" style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx-1)', margin: 0 }}>Server Health</h1>
              {refreshing && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)' }}>
                  <RefreshCw size={11} className="anim-spin" aria-hidden />
                  Refreshing…
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: 'var(--tx-3)', margin: 0 }}>
              Live infrastructure monitoring · updates every 30 s
              {!loading && <> · Last updated {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}</>}
            </p>
          </div>
          {!loading && monitors.length > 0 && (() => {
            const downMonitors = monitors.filter(m => m.enabled && m.status === 'down')
            return (
              <div style={{ position: 'relative', alignSelf: 'flex-start' }}>
                <button
                  onClick={() => downMonitors.length > 0 && setShowDownPopover(s => !s)}
                  style={{
                    fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20,
                    background: overallStatus.bg, color: overallStatus.color,
                    borderWidth: 1, borderStyle: 'solid', borderColor: overallStatus.border,
                    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
                    cursor: downMonitors.length > 0 ? 'pointer' : 'default',
                  }}
                >
                  {overallStatus.label}
                  {downMonitors.length > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>▾</span>}
                </button>
                {showDownPopover && downMonitors.length > 0 && (
                  <DownServicesPopover
                    monitors={downMonitors}
                    onSelect={m => { setExpandedMonitor(m); setShowDownPopover(false) }}
                    onClose={() => setShowDownPopover(false)}
                  />
                )}
              </div>
            )
          })()}
        </div>

        {/* Maintenance window notice */}
        {isMaintenance && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 12, background: 'rgba(227,179,65,.10)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(227,179,65,.30)', borderRadius: 'var(--r-md)', fontSize: 12, color: C.warning }}>
            <span style={{ fontSize: 14 }}>🔧</span>
            <span><strong>Maintenance window active</strong> — 12:00 AM – 9:00 AM MYT. Failures during this period are excluded from all data.</span>
          </div>
        )}

        {/* Time range + tab bar row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>Show:</span>
            <TimeRangeBar
              value={timeRange}
              onChange={r => { setTimeRange(r); setShowDownPopover(false); setDataLoading(true) }}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFrom={v => { setCustomFrom(v); setDataLoading(true) }}
              onCustomTo={v => { setCustomTo(v); setDataLoading(true) }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            Maintenance hours (00:00–09:00 MYT) excluded from all data
          </span>
        </div>
        {/* Tab bar */}
        <TabBar active={activeTab} onChange={t => { setActiveTab(t); setExpandedIncIds(new Set()); try { localStorage.setItem('server-health-tab', t) } catch {} }} badges={tabBadges} />

        <div style={{ opacity: dataLoading && !loading ? 0.55 : 1, transition: 'opacity 0.25s', pointerEvents: dataLoading && !loading ? 'none' : undefined }}>

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 'var(--r-md)' }} />)}
            </div>
          ) : (
            <OverviewTab
              monitors={monitors}
              incidents={incidents}
              failedChecks={failedChecks}
              loading={loading}
              timeRange={timeRange}
              onNavigate={t => { setActiveTab(t); setExpandedIncIds(new Set()) }}
              onOpenMonitor={setExpandedMonitor}
            />
          )
        )}

        {/* ── Monitors Tab ── */}
        {activeTab === 'monitors' && (() => {
          const sparkOpt = CHECK_RANGE_OPTS.find(o => o.id === sparklineRange)!
          const sparklineLabel = `Last ${sparkOpt.label}`
          return (
            <>
              {!loading && monitors.length > 0 && (
                <HealthSummary monitors={monitors} incidents={incidents} timeRange={timeRange} />
              )}

              {/* Sparkline range selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 3 }}>
                  {CHECK_RANGE_OPTS.map(opt => {
                    const active = sparklineRange === opt.id
                    return (
                      <button key={opt.id} onClick={() => { setSparklineRange(opt.id); setDataLoading(true) }} style={{
                        fontSize: 12, fontWeight: active ? 700 : 400, padding: '4px 12px',
                        borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                        background: active ? 'var(--orange-dim)' : 'transparent',
                        color: active ? 'var(--orange)' : 'var(--tx-3)',
                        whiteSpace: 'nowrap', transition: 'all .15s',
                      }}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>Click a card to inspect</span>
              </div>

              {loading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                  {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
                </div>
              ) : monitors.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 12, background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)' }}>
                  <Shield size={32} color="var(--tx-3)" aria-hidden />
                  <p style={{ fontSize: 14, color: 'var(--tx-3)', margin: 0 }}>No monitors configured yet.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                  {monitors.map(m => (
                    <MonitorCard
                      key={m.id}
                      monitor={m}
                      checks={checksByMonitor[m.id] ?? []}
                      onClick={() => setExpandedMonitor(m)}
                      sparklineLabel={sparklineLabel}
                      isLoading={dataLoading}
                    />
                  ))}
                </div>
              )}
            </>
          )
        })()}

        {/* ── Checks Tab ── */}
        {activeTab === 'checks' && (
          loading ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
            </div>
          ) : failedChecks.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', color: 'var(--tx-3)', fontSize: 13 }}>
              No failed checks in the last 24 hours. All monitors are passing.
            </div>
          ) : (
            <FailedChecksSection
              monitors={monitors}
              failedChecks={failedChecks}
              windowLabel={getWindowLabel(timeRange, customFrom, customTo)}
            />
          )
        )}

        {/* ── Performance Tab ── */}
        {activeTab === 'performance' && (
          loading ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton" style={{ height: 80 }} />)}
            </div>
          ) : (
            <PerformanceInsightsSection monitors={monitors} />
          )
        )}

        {/* ── Incidents Tab ── */}
        {activeTab === 'incidents' && (() => {
          const totalPages = Math.ceil(incidents.length / INC_PAGE_SIZE)
          const pageStart  = incPage * INC_PAGE_SIZE
          const pageSlice  = incidents.slice(pageStart, pageStart + INC_PAGE_SIZE)

          return (
            <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Recent Incidents</h2>
                {!loading && incidents.length > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--tx-3)' }}>{incidents.length}</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--tx-3)', marginLeft: 'auto' }}>Click any row to expand details</span>
              </div>

              {loading ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 12 }} />)}
                </div>
              ) : incidents.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>No incidents recorded yet.</div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface-2)' }}>
                          {['Monitor', 'Started (MYT)', 'Duration', 'Status', 'Error Type', 'Cause'].map(h => (
                            <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageSlice.map((inc, rowIdx) => {
                          const isExpanded = expandedIncIds.has(inc.id)
                          const monName    = inc.monitors?.name ?? monitorNames[inc.monitor_id] ?? 'Unknown'
                          const isLast     = rowIdx === pageSlice.length - 1
                          return (
                            <React.Fragment key={inc.id}>
                              <tr
                                onClick={() => toggleIncident(inc.id)}
                                style={{ borderBottomWidth: isExpanded || !isLast ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', cursor: 'pointer', background: isExpanded ? 'var(--surface-2)' : undefined }}
                                onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                                onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '' }}
                              >
                                <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 10, flexShrink: 0, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>▶</span>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{monName}</span>
                                  </div>
                                </td>
                                <td style={{ padding: '11px 16px', color: 'var(--tx-2)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                                  {new Date(inc.started_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                                </td>
                                <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                                  {inc.is_open ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.danger, fontWeight: 600, fontSize: 12 }}>
                                      <span className="anim-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: C.danger, display: 'inline-block' }} />
                                      Ongoing
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--tx-2)' }}>{incidentDurationStr(inc)}</span>
                                  )}
                                </td>
                                <td style={{ padding: '11px 16px' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', background: inc.is_open ? C.dangerBg : C.successBg, color: inc.is_open ? C.danger : C.success, borderWidth: 1, borderStyle: 'solid', borderColor: inc.is_open ? C.dangerBorder : C.successBorder }}>
                                    {inc.is_open ? 'Open' : 'Resolved'}
                                  </span>
                                </td>
                                <td style={{ padding: '11px 16px', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>{errorLabel(inc.first_error_class)}</td>
                                <td style={{ padding: '11px 16px', color: 'var(--tx-2)', maxWidth: 280 }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.probable_cause ?? '—'}</div>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr style={{ borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', background: 'var(--surface-2)' }}>
                                  <td colSpan={6} style={{ padding: '12px 20px 16px 40px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                                      <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Incident Info</div>
                                        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                          {[
                                            ['HTTP Code',      inc.first_status_code ?? '—'],
                                            ['Error Message',  inc.first_error_message ?? '—'],
                                            ['Concurrent Down', inc.concurrent_down_count != null ? `${inc.concurrent_down_count} monitor(s)` : '—'],
                                            ['Duration',       inc.is_open ? 'Still ongoing' : incidentDurationStr(inc)],
                                            ['Resolved At',    inc.resolved_at ? formatMYT(inc.resolved_at) : '—'],
                                          ].map(([label, val]) => (
                                            <div key={label} style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                                              <dt style={{ color: 'var(--tx-3)', minWidth: 110, flexShrink: 0 }}>{label}:</dt>
                                              <dd style={{ margin: 0, color: 'var(--tx-1)', wordBreak: 'break-all' }}>{val}</dd>
                                            </div>
                                          ))}
                                        </dl>
                                      </div>
                                      {inc.probable_cause && (
                                        <div>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Probable Cause</div>
                                          <p style={{ margin: 0, fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.5 }}>{inc.probable_cause}</p>
                                        </div>
                                      )}
                                      {inc.attack_indicators && inc.attack_indicators.length > 0 && (
                                        <div>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: C.warning, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>⚠ Attack / Anomaly Indicators</div>
                                          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                            {inc.attack_indicators.map((ind, i) => <li key={i} style={{ fontSize: 12, color: 'var(--tx-2)' }}>{ind}</li>)}
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
                      <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                        {pageStart + 1}–{Math.min(pageStart + INC_PAGE_SIZE, incidents.length)} of {incidents.length} incidents
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setIncPage(p => p - 1)} disabled={incPage === 0} style={{ fontSize: 12, padding: '4px 14px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: incPage === 0 ? 'var(--tx-3)' : 'var(--tx-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', cursor: incPage === 0 ? 'not-allowed' : 'pointer' }}>← Previous</button>
                        <span style={{ fontSize: 11, color: 'var(--tx-3)', alignSelf: 'center', padding: '0 4px' }}>{incPage + 1} / {totalPages}</span>
                        <button onClick={() => setIncPage(p => p + 1)} disabled={incPage >= totalPages - 1} style={{ fontSize: 12, padding: '4px 14px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', color: incPage >= totalPages - 1 ? 'var(--tx-3)' : 'var(--tx-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', cursor: incPage >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>Next →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}


        {/* ── Anomalies Tab ── */}
        {activeTab === 'anomalies' && (
          <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Detected Anomalies</h2>
              {!loading && anomalies.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--tx-3)' }}>{anomalies.length}</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--tx-3)', marginLeft: 'auto' }}>Last 30 days · click View Logs to fetch CloudWatch + AI diagnosis</span>
            </div>
            {loading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 12 }} />)}
              </div>
            ) : anomalies.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>No anomalies detected in the last 30 days.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      {['Time (MYT)', 'Monitor', 'Type', 'Response', 'Ratio', 'HTTP', 'Error', 'Initial AI Diagnosis', 'Logs'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {anomalies.map((a, i) => {
                      const isLast = i === anomalies.length - 1
                      const isExpanded = expandedAnomalyId === a.id
                      const logData = anomalyLogs[a.id]
                      const typeColor = a.anomaly_type === 'spike'
                        ? (a.spike_ratio != null
                            ? a.spike_ratio >= 6 ? C.danger : a.spike_ratio >= 3 ? '#f97316' : C.warning
                            : C.warning)
                        : a.anomaly_type === 'down' ? C.danger : C.warning
                      const typeBg     = a.anomaly_type === 'down' ? C.dangerBg : 'rgba(227,179,65,.12)'
                      const typeBorder = a.anomaly_type === 'down' ? C.dangerBorder : 'rgba(227,179,65,.3)'
                      const hasLogs    = !!a.cloudwatch_url
                      return (
                        <React.Fragment key={a.id}>
                          <tr style={{ borderBottomWidth: isExpanded || !isLast ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', background: isExpanded ? 'rgba(59,130,246,.05)' : undefined }}
                            onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                            onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '' }}>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11, color: 'var(--tx-2)' }}>
                              {new Date(a.checked_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                            </td>
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--tx-1)', whiteSpace: 'nowrap' }}>{a.monitor_name}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', background: typeBg, color: typeColor, borderWidth: 1, borderStyle: 'solid', borderColor: typeBorder }}>
                                {a.anomaly_type === 'spike' ? '⚡ spike' : a.anomaly_type === 'down' ? '✗ down' : '⚠ degraded'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: typeColor, fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                              {a.response_time_ms != null ? `${a.response_time_ms}ms` : '—'}
                              {a.avg_ms != null && <span style={{ color: 'var(--tx-3)', fontWeight: 400, marginLeft: 4 }}>/ {a.avg_ms}ms avg</span>}
                            </td>
                            <td style={{ padding: '10px 14px', color: a.spike_ratio != null ? typeColor : 'var(--tx-3)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>
                              {a.spike_ratio != null ? `${a.spike_ratio.toFixed(1)}×` : '—'}
                            </td>
                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: a.status_code && a.status_code >= 500 ? C.danger : a.status_code && a.status_code >= 400 ? C.warning : 'var(--tx-2)' }}>
                              {a.status_code ?? '—'}
                            </td>
                            <td style={{ padding: '10px 14px', maxWidth: 180 }}>
                              {a.error_class && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.error_class}>{a.error_class}</div>}
                              {a.error_message && <div style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={a.error_message}>{a.error_message}</div>}
                              {!a.error_class && !a.error_message && <span style={{ color: 'var(--tx-3)' }}>—</span>}
                            </td>
                            <td style={{ padding: '10px 14px', maxWidth: 240, minWidth: 160 }}>
                              {a.ai_analysis
                                ? <span style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.45 }}>{a.ai_analysis}</span>
                                : <span style={{ fontSize: 11, color: 'var(--tx-3)', fontStyle: 'italic' }}>Pending…</span>}
                            </td>
                            <td style={{ padding: '10px 14px' }}>
                              {hasLogs ? (
                                <button
                                  onClick={() => {
                                    const wasExpanded = expandedAnomalyId === a.id
                                    setExpandedAnomalyId(wasExpanded ? null : a.id)
                                    if (!wasExpanded) fetchAnomalyLogs(a)
                                  }}
                                  style={{
                                    fontSize: 11, padding: '3px 10px', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap', cursor: 'pointer',
                                    background: isExpanded ? 'rgba(59,130,246,.15)' : 'var(--surface-2)',
                                    color: isExpanded ? '#60a5fa' : 'var(--tx-2)',
                                    borderWidth: 1, borderStyle: 'solid',
                                    borderColor: isExpanded ? 'rgba(59,130,246,.3)' : 'var(--border)',
                                  }}
                                >
                                  {isExpanded ? 'Hide' : 'View Logs'}
                                </button>
                              ) : (
                                <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>—</span>
                              )}
                            </td>
                          </tr>

                          {/* Inline log viewer */}
                          {isExpanded && (
                            <tr style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', background: 'var(--surface-2)' }}>
                              <td colSpan={9} style={{ padding: '16px 20px 20px' }}>
                                {!logData || logData.loading ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 4 }}>Fetching CloudWatch logs and running AI analysis…</div>
                                    {Array.from({ length: 5 }, (_, si) => (
                                      <div key={si} className="skeleton" style={{ height: 10, maxWidth: `${85 - si * 10}%` }} />
                                    ))}
                                  </div>
                                ) : logData.error ? (
                                  <div style={{ color: C.danger, fontSize: 12 }}>⚠ {logData.error}</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {/* AI diagnosis from actual logs */}
                                    {logData.analysis ? (
                                      <div style={{ background: 'rgba(59,130,246,.08)', borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(59,130,246,.2)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>AI Diagnosis (from CloudWatch logs)</div>
                                        <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.6 }}>{logData.analysis}</p>
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>
                                        {logData.events.length === 0 ? 'No log events found — AI analysis skipped.' : 'AI analysis unavailable (check OPENROUTER_API_KEY).'}
                                      </div>
                                    )}
                                    {/* Log lines */}
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                                        CloudWatch Logs · {logData.events.length} event{logData.events.length !== 1 ? 's' : ''} · ±2 min window around {new Date(a.checked_at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })} MYT
                                      </div>
                                      {logData.events.length === 0 ? (
                                        <div style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>No log events found in this ±2 min window. The log group may not have captured this request.</div>
                                      ) : (
                                        <pre style={{ margin: 0, padding: '12px 14px', background: '#0d1117', borderRadius: 'var(--r-md)', fontSize: 11, fontFamily: 'monospace', overflowX: 'auto', maxHeight: 300, overflowY: 'auto', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          {logData.events.map((ev, ei) => {
                                            const msg = ev.message ?? ''
                                            const isErr  = /error|fatal|exception/i.test(msg)
                                            const isWarn = /warn/i.test(msg)
                                            const evTs   = ev.timestamp
                                              ? new Date(ev.timestamp).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                              : ''
                                            return (
                                              <div key={ei} style={{ color: isErr ? C.danger : isWarn ? C.warning : 'var(--tx-2)', marginBottom: 2 }}>
                                                {evTs && <span style={{ color: 'var(--tx-3)', marginRight: 10, fontSize: 10, flexShrink: 0 }}>{evTs}</span>}
                                                {msg}
                                              </div>
                                            )
                                          })}
                                        </pre>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

        </div>{/* /dataLoading wrapper */}

      {/* Monitor detail panel */}
      {expandedMonitor && (
        <MonitorDetailPanel
          monitor={expandedMonitor}
          incidents={incidents}
          monitorNames={monitorNames}
          onClose={() => setExpandedMonitor(null)}
          initialChecks={checksByMonitor[expandedMonitor.id] ?? []}
        />
      )}
    </div>
  )
}
