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
  // grouping fields (added in anomaly_grouping_by_fingerprint migration)
  error_fingerprint: string
  occurrence_count: number
  first_seen: string
  last_seen: string
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
  if (m.last_error_class === 'timeout') return { color: C.warning, label: 'Slow / Timeout', pulse: false }
  return { color: C.danger, label: 'Down', pulse: true }
}

function computeOverallStatus(monitors: MonitorRow[]): { label: string; color: string; bg: string; border: string } {
  const enabled = monitors.filter(m => m.enabled)
  if (enabled.length === 0) return { label: 'No Monitors', color: C.muted, bg: C.mutedBg, border: C.mutedBorder }
  // Timeouts are slow/degraded, not a hard outage — don't colour the status red for them
  const hardDown      = enabled.filter(m => m.status === 'down' && m.last_error_class !== 'timeout').length
  const degradedCount = enabled.filter(m => m.status === 'degraded' || (m.status === 'down' && m.last_error_class === 'timeout')).length
  if (hardDown > 0) {
    const isMinor = hardDown === 1 || hardDown <= Math.floor(enabled.length * 0.1)
    const label = `${hardDown} Service${hardDown > 1 ? 's' : ''} Down`
    if (isMinor) return { label, color: C.warning, bg: C.warningBg, border: C.warningBorder }
    return { label, color: C.danger, bg: C.dangerBg, border: C.dangerBorder }
  }
  if (degradedCount > 0) return { label: 'Performance Degraded', color: C.warning, bg: C.warningBg, border: C.warningBorder }
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
      {hasActiveIncident && (() => {
        const isTimeout = monitor.last_error_class === 'timeout'
        const bg     = isTimeout ? C.warningBg  : C.dangerBg
        const border = isTimeout ? C.warningBorder : C.dangerBorder
        const color  = isTimeout ? C.warning    : C.danger
        const icon   = isTimeout ? '🟡' : '🔴'
        const label  = isTimeout ? 'Slow since' : 'Down since'
        return (
        <div style={{
          background: bg,
          borderWidth: 1, borderStyle: 'solid', borderColor: border,
          borderRadius: 'var(--r-sm)', padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color }}>
            {icon} {label} {incidentAge(monitor.incident_started_at!)}
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
        )
      })()}
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
      <text x="50%" y="64%" textAnchor="middle"
        style={{ fill: '#7D8590', fontSize: `${Math.round(size / 14)}px` }}>
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
        // Use per-monitor degraded_threshold_ms to match n8n workflow's degraded detection
        const threshold = mon.degraded_threshold_ms ?? (isWebEndpoint(mon.name) ? 800 : 200)
        const color = ms >= threshold ? C.danger : ms >= threshold * 0.75 ? C.warning : C.success
        const pct = Math.max(3, (ms / maxMs) * 100)
        const thresholdPct = Math.min(100, (threshold / maxMs) * 100)
        return (
          <div key={mon.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--tx-2)', width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{mon.name}</span>
            <div style={{ flex: 1, height: 7, background: 'rgba(125,133,144,.15)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .5s ease' }} />
              {/* Threshold marker */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${thresholdPct}%`, width: 1, background: 'rgba(125,133,144,.5)' }} />
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
            sub="service hours only"
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

  type Run = { status: string; errorClass: string | null; count: number; firstTime: string; lastTime: string }
  const groupRuns = (rows: FailedCheckRow[]): Run[] => {
    const sorted = [...rows].sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
    const runs: Run[] = []
    for (const c of sorted) {
      const last = runs[runs.length - 1]
      if (last && last.status === c.status && last.errorClass === (c.error_class ?? null)) {
        last.count++; last.lastTime = c.checked_at
      } else {
        runs.push({ status: c.status, errorClass: c.error_class ?? null, count: 1, firstTime: c.checked_at, lastTime: c.checked_at })
      }
    }
    return runs.reverse()
  }

  return (
    <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Recent Failed Checks</h2>
        {(() => {
          const downTotal     = failedChecks.filter(c => c.status === 'down').length
          const degradedTotal = failedChecks.filter(c => c.status === 'degraded').length
          return (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {downTotal > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: C.dangerBg, color: C.danger, borderWidth: 1, borderStyle: 'solid', borderColor: C.dangerBorder }}>
                  {downTotal} down
                </span>
              )}
              {degradedTotal > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: C.warningBg, color: C.warning, borderWidth: 1, borderStyle: 'solid', borderColor: C.warningBorder }}>
                  {degradedTotal} degraded
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{monitorIds.length} monitor{monitorIds.length !== 1 ? 's' : ''}</span>
            </div>
          )
        })()}
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
        const downCount     = checks.filter(c => c.status === 'down').length
        const degradedCount = checks.filter(c => c.status === 'degraded').length

        return (
          <div key={monId} style={{ borderBottomWidth: isLast && !isOpen ? 0 : 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <button onClick={() => toggle(monId)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 10, color: 'var(--tx-3)', display: 'inline-block', width: 10, flexShrink: 0, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', minWidth: 140 }}>{name}</span>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {downCount > 0 && <span style={{ fontSize: 12, color: C.danger, fontWeight: 600 }}>{downCount} down</span>}
                  {downCount > 0 && degradedCount > 0 && <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>·</span>}
                  {degradedCount > 0 && <span style={{ fontSize: 12, color: C.warning, fontWeight: 600 }}>{degradedCount} degraded</span>}
                </div>
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

            {isOpen && (() => {
              const runs = groupRuns(checks)
              return (
                <div style={{ borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface-2)' }}>
                          {['From (MYT)', 'To (MYT)', 'Status', 'Count', 'Error Type'].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((run, ri) => (
                          <tr key={ri} style={{ borderBottomWidth: ri < runs.length - 1 ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}>
                            <td style={{ padding: '7px 14px', color: 'var(--tx-2)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                              {new Date(run.firstTime).toLocaleString('en-MY', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                            </td>
                            <td style={{ padding: '7px 14px', color: run.count > 1 ? 'var(--tx-2)' : 'var(--tx-3)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                              {run.count > 1 ? new Date(run.lastTime).toLocaleString('en-MY', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '—'}
                            </td>
                            <td style={{ padding: '7px 14px' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: run.status === 'down' ? C.dangerBg : C.warningBg, color: run.status === 'down' ? C.danger : C.warning, borderWidth: 1, borderStyle: 'solid', borderColor: run.status === 'down' ? C.dangerBorder : C.warningBorder, textTransform: 'uppercase' as const }}>
                                {run.status}
                              </span>
                            </td>
                            <td style={{ padding: '7px 14px', color: run.count > 1 ? C.danger : 'var(--tx-2)', fontWeight: run.count > 1 ? 700 : 400, fontFamily: 'monospace' }}>
                              {run.count}×
                            </td>
                            <td style={{ padding: '7px 14px', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>
                              {errorLabel(run.errorClass ?? 'unknown')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--tx-3)', textAlign: 'right', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
                    {checks.length} checks → {runs.length} run{runs.length !== 1 ? 's' : ''} in the last 24h
                  </div>
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

// ─── Lighthouse Audit Section ─────────────────────────────────

interface LighthouseResult {
  url: string; fetchedAt: string
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null }
  metrics: { fcp: number | null; lcp: number | null; tbt: number | null; cls: number | null; tti: number | null; speedIndex: number | null; ttfb: number | null }
  opportunities: { id: string; title: string; savingsMs: number }[]
  diagnostics: { id: string; title: string; description: string }[]
}

interface LighthouseAuditRow {
  id: string
  url: string
  strategy: 'desktop' | 'mobile'
  scores: LighthouseResult['scores']
  metrics: LighthouseResult['metrics']
  opportunities: LighthouseResult['opportunities']
  diagnostics: LighthouseResult['diagnostics']
  fetched_at: string   // snake_case from Supabase
  created_at: string
}

function scoreGrade(s: number | null): { color: string; label: string } {
  if (s === null) return { color: C.muted, label: '?' }
  if (s >= 90) return { color: C.success, label: 'Good' }
  if (s >= 50) return { color: C.warning, label: 'Needs Work' }
  return { color: C.danger, label: 'Poor' }
}

// Key is `${target}::${strategy}`
type LHResults = Record<string, LighthouseResult | { error: string } | 'loading'>

function ScoreBlock({ label, score }: { label: string; score: number | null }) {
  const g = scoreGrade(score)
  return (
    <div style={{ textAlign: 'center', minWidth: 64 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: g.color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{score ?? '—'}</div>
      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 1 }}>{label}</div>
      <div style={{ fontSize: 9, color: g.color, fontWeight: 700 }}>{g.label}</div>
    </div>
  )
}

function MetricChip({ label, val, good, poor, unit, title }: { label: string; val: number | null; good: number; poor: number; unit: string; title: string }) {
  const color   = val === null ? C.muted : val <= good ? C.success : val <= poor ? C.warning : C.danger
  const display = val !== null ? (unit === '' ? (val / 1000).toFixed(3) : `${val}${unit}`) : '—'
  return (
    <div title={title} style={{ padding: '4px 8px', borderRadius: 6, background: `${color}12`, border: `1px solid ${color}30`, cursor: 'help' }}>
      <div style={{ fontSize: 9, color: 'var(--tx-3)', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{display}</div>
    </div>
  )
}

function StrategyPane({ res, error, loading, strategy }: {
  res: LighthouseResult | null; error: string | null; loading: boolean; strategy: 'desktop' | 'mobile'
}) {
  const icon  = strategy === 'mobile' ? '📱' : '🖥️'
  const label = strategy === 'desktop' ? 'Desktop' : 'Mobile web (simulated Moto G4 · throttled 4G)'
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)' }}>{strategy === 'desktop' ? 'Desktop' : 'Mobile'}</span>
        <span style={{ fontSize: 10, color: 'var(--tx-3)' }} title={label}>({strategy === 'mobile' ? 'web on simulated phone' : 'full desktop Chrome'})</span>
      </div>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#60a5fa' }}>
          <span className="anim-spin" style={{ display: 'inline-block' }}>⟳</span> Running Lighthouse…
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: C.danger }}>{error}</div>}
      {res && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <ScoreBlock label="Performance"   score={res.scores.performance} />
            <ScoreBlock label="Accessibility" score={res.scores.accessibility} />
            <ScoreBlock label="Best Practices" score={res.scores.bestPractices} />
            <ScoreBlock label="SEO"           score={res.scores.seo} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: res.opportunities.length > 0 ? 10 : 0 }}>
            <MetricChip label="FCP"  val={res.metrics.fcp}   good={1800} poor={3000} unit="ms" title="First Contentful Paint — time until first text/image appears" />
            <MetricChip label="LCP"  val={res.metrics.lcp}   good={2500} poor={4000} unit="ms" title="Largest Contentful Paint — time until main content loads" />
            <MetricChip label="TBT"  val={res.metrics.tbt}   good={200}  poor={600}  unit="ms" title="Total Blocking Time — JS blocking the main thread" />
            <MetricChip label="CLS"  val={res.metrics.cls !== null ? res.metrics.cls * 1000 : null} good={100} poor={250} unit="" title="Cumulative Layout Shift (×10⁻³) — visual stability" />
            <MetricChip label="TTI"  val={res.metrics.tti}   good={3800} poor={7300} unit="ms" title="Time to Interactive — when page is fully usable" />
            <MetricChip label="TTFB" val={res.metrics.ttfb}  good={800}  poor={1800} unit="ms" title="Time to First Byte — server response speed" />
          </div>
          {res.opportunities.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Opportunities</div>
              {res.opportunities.map(op => (
                <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--tx-1)', flex: 1 }}>{op.title}</span>
                  <span style={{ fontSize: 10, color: C.warning, fontWeight: 600 }}>−{op.savingsMs}ms</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 9, color: 'var(--tx-3)', marginTop: 8 }}>
            {new Date(res.fetchedAt).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })} MYT · Google PageSpeed Insights
          </div>
        </>
      )}
    </div>
  )
}

// Public pages sourced from landing-routing.module.ts (YZ-WEB-PG-001 → PG-019).
// Authenticated routes (user/**, institution/**, etc.) are excluded — Lighthouse
// cannot audit pages behind login. Dynamic-ID routes (/public/job/:id) are also excluded.
const ALL_WEB_ROUTES: { label: string; path: string }[] = [
  { label: 'Homepage',                    path: '/' },
  { label: 'Login',                       path: '/login' },
  { label: 'Sign Up',                     path: '/sign-up' },
  { label: 'Forgot Password',             path: '/forgot-password' },
  { label: 'Reset Password',              path: '/reset-password' },
  { label: 'Guest Profile Setup',         path: '/guest-profile-setup' },
  { label: 'Build My Plan',              path: '/build-my-plan' },
  { label: 'Request Offer (RMO)',         path: '/request-offer-rmo' },
  { label: 'Guest Apply Application',     path: '/guest-entry-apply-application' },
  { label: 'Guest Application Landing',   path: '/guest-application-landing' },
  { label: 'Browse Courses (Guest)',      path: '/guest-courses' },
  { label: 'Browse Jobs (Guest)',         path: '/guest-jobs' },
  { label: 'About',                       path: '/about' },
  { label: 'Contact',                    path: '/contact' },
  { label: 'Cookie Policy',              path: '/cookies' },
  { label: 'Privacy Policy',             path: '/privacy' },
  { label: 'Terms',                      path: '/terms' },
]

function LighthouseAuditSection({ monitors }: { monitors: MonitorRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const webMonitors = monitors.filter(m => m.enabled && isWebEndpoint(m.name) && m.target?.startsWith('http'))
  const [results, setResults] = useState<LHResults>({})
  const [runningAll, setRunningAll] = useState(false)
  const [mode, setMode] = useState<'monitors' | 'all'>('monitors')
  const [baseUrl, setBaseUrl] = useState('')
  const [history, setHistory] = useState<LighthouseAuditRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)

  const thirtyDaysAgo = useMemo(() => new Date(Date.now() - 30 * 86_400_000).toISOString(), [])

  const refreshHistory = useCallback(() => {
    supabase
      .from('lighthouse_audits')
      .select('*')
      .gte('created_at', thirtyDaysAgo)
      .order('fetched_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        setHistory((data ?? []) as LighthouseAuditRow[])
        setHistoryLoading(false)
      })
  }, [supabase, thirtyDaysAgo])

  useEffect(() => { refreshHistory() }, [refreshHistory])

  const saveAudit = useCallback(async (result: LighthouseResult, strategy: 'desktop' | 'mobile') => {
    await supabase.from('lighthouse_audits').insert({
      url: result.url, strategy,
      scores: result.scores, metrics: result.metrics,
      opportunities: result.opportunities, diagnostics: result.diagnostics,
      fetched_at: result.fetchedAt,
    })
    // Prune records older than 30 days (best-effort, low-traffic table)
    await supabase.from('lighthouse_audits').delete().lt('created_at', thirtyDaysAgo)
    refreshHistory()
  }, [supabase, thirtyDaysAgo, refreshHistory])

  const defaultBase = (() => {
    if (!webMonitors.length) return ''
    try { return new URL(webMonitors[0].target).origin } catch { return '' }
  })()

  const effectiveBase = baseUrl || defaultBase

  const items: { name: string; target: string }[] = mode === 'monitors'
    ? webMonitors.map(m => ({ name: m.name, target: m.target }))
    : ALL_WEB_ROUTES.map(r => ({ name: r.label, target: effectiveBase + r.path }))

  const lhKey = (target: string, strategy: string) => `${target}::${strategy}`

  const runAudit = useCallback(async (target: string) => {
    setResults(prev => ({ ...prev, [lhKey(target, 'desktop')]: 'loading', [lhKey(target, 'mobile')]: 'loading' }))
    await Promise.all((['desktop', 'mobile'] as const).map(async strategy => {
      try {
        const res  = await fetch(`/api/lighthouse?url=${encodeURIComponent(target)}&strategy=${strategy}`)
        const data = await res.json()
        setResults(prev => ({ ...prev, [lhKey(target, strategy)]: data }))
        if (!('error' in data)) saveAudit(data as LighthouseResult, strategy)
      } catch {
        setResults(prev => ({ ...prev, [lhKey(target, strategy)]: { error: 'Network error' } }))
      }
    }))
  }, [saveAudit])

  const runAll = useCallback(async () => {
    setRunningAll(true)
    for (const item of items) { if (item.target) await runAudit(item.target) }
    setRunningAll(false)
  }, [items, runAudit])

  const getResult = (target: string, strategy: string) => {
    const r = results[lhKey(target, strategy)]
    return {
      loading: r === 'loading',
      error:   r && r !== 'loading' && 'error' in r ? (r as { error: string }).error : null,
      res:     r && r !== 'loading' && !('error' in r) ? r as LighthouseResult : null,
    }
  }

  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 24 }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Lighthouse Audits</h2>
        <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
          Desktop + Mobile · Performance · Accessibility · Best Practices · SEO · Core Web Vitals
        </span>
        <span
          style={{ fontSize: 11, color: 'var(--tx-3)', padding: '2px 8px', borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          title="Mobile = your web app tested in Chrome with Moto G4 device emulation and throttled 4G network. Not the native iOS/Android app."
        >
          ⓘ Mobile = web on simulated phone
        </span>

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
          {(['monitors', 'all'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '3px 11px', fontSize: 11, fontWeight: mode === m ? 700 : 400,
              background: mode === m ? '#3b82f6' : 'var(--surface-2)',
              color: mode === m ? '#fff' : 'var(--tx-3)',
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {m === 'monitors' ? 'Monitored endpoints' : 'All pages'}
            </button>
          ))}
        </div>

        <button
          onClick={runAll}
          disabled={runningAll || (mode === 'all' && !effectiveBase)}
          style={{
            marginLeft: 'auto', fontSize: 11, padding: '4px 12px', borderRadius: 6,
            cursor: runningAll ? 'default' : 'pointer',
            background: '#3b82f6', color: '#fff', border: 'none',
            opacity: runningAll || (mode === 'all' && !effectiveBase) ? 0.6 : 1,
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          }}
        >
          {runningAll && <span className="anim-spin" style={{ display: 'inline-block' }}>⟳</span>}
          Audit all ({items.length})
        </button>
      </div>

      {/* All-pages base URL row */}
      {mode === 'all' && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--tx-3)', flexShrink: 0 }}>Base URL:</span>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value.replace(/\/$/, ''))}
            placeholder={defaultBase || 'https://yuzee.com'}
            style={{
              flex: 1, maxWidth: 340, padding: '5px 9px', fontSize: 12,
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--tx-1)', outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{items.length} pages will be audited</span>
        </div>
      )}

      {/* Items list */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
            No web endpoints configured. Add monitors with HTTP targets to audit them here.
          </div>
        ) : items.map(item => {
          const desktop = getResult(item.target, 'desktop')
          const mobile  = getResult(item.target, 'mobile')
          const hasAny  = desktop.res || mobile.res || desktop.loading || mobile.loading
          return (
            <div key={item.target} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasAny ? 12 : 0, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)' }}>{item.name}</span>
                <span style={{ fontSize: 11, color: 'var(--tx-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.target}</span>
                <button
                  onClick={() => runAudit(item.target)}
                  disabled={!item.target || desktop.loading || mobile.loading}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                    background: 'var(--surface-1)', color: '#3b82f6', border: '1px solid var(--border)',
                    opacity: desktop.loading || mobile.loading ? 0.5 : 1,
                  }}
                >
                  {hasAny ? 'Re-audit' : 'Audit →'}
                </button>
              </div>
              {hasAny && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <StrategyPane strategy="desktop" {...desktop} />
                  <StrategyPane strategy="mobile"  {...mobile} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Audit History ── */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => setShowHistory(h => !h)}
          style={{
            width: '100%', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--tx-3)', display: 'inline-block', width: 10, transform: showHistory ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-2)' }}>Audit History</span>
          <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>last 30 days</span>
          {!historyLoading && (
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--tx-3)', marginLeft: 'auto' }}>
              {history.length} saved
            </span>
          )}
        </button>

        {showHistory && (
          <div style={{ padding: '0 20px 16px' }}>
            {historyLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 36 }} />)}
              </div>
            ) : history.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic', margin: 0 }}>
                No saved audits yet. Run an audit above to start building history.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      {['When (MYT)', 'URL', 'Strategy', 'Perf', 'A11y', 'BP', 'SEO', 'LCP', 'TBT'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', fontSize: 9, letterSpacing: '.06em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, i) => {
                      const g = (s: number | null) => s === null ? C.muted : s >= 90 ? C.success : s >= 50 ? C.warning : C.danger
                      const isLast = i === history.length - 1
                      return (
                        <tr key={row.id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', color: 'var(--tx-3)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10 }}>
                            {new Date(row.fetched_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--tx-2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.url}>
                            {row.url.replace(/^https?:\/\//, '')}
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, color: row.strategy === 'desktop' ? '#60a5fa' : '#34d399' }}>
                              {row.strategy === 'desktop' ? '🖥 Desktop' : '📱 Mobile'}
                            </span>
                          </td>
                          {[row.scores.performance, row.scores.accessibility, row.scores.bestPractices, row.scores.seo].map((s, si) => (
                            <td key={si} style={{ padding: '6px 10px', fontWeight: 700, color: g(s), fontVariantNumeric: 'tabular-nums' }}>{s ?? '—'}</td>
                          ))}
                          <td style={{ padding: '6px 10px', color: g(row.metrics.lcp !== null ? (row.metrics.lcp <= 2500 ? 90 : row.metrics.lcp <= 4000 ? 60 : 30) : null), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {row.metrics.lcp !== null ? `${row.metrics.lcp}ms` : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: g(row.metrics.tbt !== null ? (row.metrics.tbt <= 200 ? 90 : row.metrics.tbt <= 600 ? 60 : 30) : null), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {row.metrics.tbt !== null ? `${row.metrics.tbt}ms` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Performance Insights Section ─────────────────────────────

function PerformanceInsightsSection({ monitors }: { monitors: MonitorRow[] }) {
  const slow = monitors.filter(m => {
    if (!m.avg_response_24h || !m.enabled) return false
    const threshold = m.degraded_threshold_ms ?? (isWebEndpoint(m.name) ? 800 : 200)
    return m.avg_response_24h >= threshold
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
          // Use per-monitor degraded_threshold_ms to match n8n workflow degraded detection
          const benchmark = m.degraded_threshold_ms ?? (web ? 800 : 200)
          const scale     = web ? 3000 : Math.max(800, benchmark * 2)
          const pct       = interpolatePercentile(avg, table)
          const barPct    = Math.min(100, (avg / scale) * 100)
          const bmPct     = Math.min(100, (benchmark / scale) * 100)
          const barColor  = avg > benchmark * 2 ? C.danger : C.warning
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

function MonitorDetailPanel({ monitor, incidents, monitorNames, onClose, initialChecks, anomalies, onNavigateToIncident }: {
  monitor: MonitorRow
  incidents: IncidentRow[]
  monitorNames: Record<string, string>
  onClose: () => void
  initialChecks: CheckRow[]
  anomalies: AnomalyRow[]
  onNavigateToIncident: (id: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const info = statusInfo(monitor)
  const monitorIncidents = incidents.filter(i => i.monitor_id === monitor.id)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [checkRange, setCheckRange] = useState<CheckRange>('1h')

  // Map checked_at → stored anomaly (for inline AI diagnosis without requiring CloudWatch)
  const anomalyByCheckedAt = useMemo(() => {
    const map: Record<string, AnomalyRow> = {}
    for (const a of anomalies) {
      if (a.monitor_id === monitor.id) map[a.checked_at] = a
    }
    return map
  }, [anomalies, monitor.id])
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
                            {/* Stored AI diagnosis from monitor_anomalies — shown without needing to open CloudWatch */}
                            {anomalyByCheckedAt[c.checked_at]?.ai_analysis && !logCache[c.checked_at]?.analysis && (
                              <div style={{ marginTop: 5, padding: '5px 8px', borderRadius: 'var(--r-sm)', background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.18)', fontSize: 10, color: 'var(--tx-1)', lineHeight: 1.5 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 2 }}>AI Diagnosis</span>
                                {anomalyByCheckedAt[c.checked_at].ai_analysis}
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
                  <div
                    key={inc.id}
                    onClick={() => onNavigateToIncident(inc.id)}
                    style={{
                      background: 'var(--surface-2)',
                      borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
                      borderRadius: 'var(--r-md)', padding: '10px 14px',
                      cursor: 'pointer', transition: 'background .12s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-3, rgba(255,255,255,.05))'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
                  >
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
                    <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 4, fontWeight: 600 }}>View in Incidents tab →</div>
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

type HealthTab = 'overview' | 'monitors' | 'checks' | 'performance' | 'lighthouse' | 'incidents' | 'anomalies'

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
    { id: 'lighthouse',  label: 'Lighthouse' },
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
  const hardDownCount = monitors.filter(m => m.status === 'down' && m.last_error_class !== 'timeout').length
  const slowCount     = monitors.filter(m => m.last_error_class === 'timeout' || m.status === 'degraded').length
  const headerLabel   = hardDownCount > 0 && slowCount > 0
    ? `${hardDownCount} Down · ${slowCount} Slow`
    : hardDownCount > 0
      ? `${hardDownCount} Service${hardDownCount !== 1 ? 's' : ''} Down`
      : `${slowCount} Service${slowCount !== 1 ? 's' : ''} Slow`
  const headerColor   = hardDownCount > 0 ? C.danger  : C.warning
  const borderColor   = hardDownCount > 0 ? C.dangerBorder : C.warningBorder
  const dotClass      = hardDownCount > 0 ? 'anim-pulse' : ''

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 6px)', right: 0,
        background: 'var(--surface-1)',
        borderWidth: 1, borderStyle: 'solid', borderColor: borderColor,
        borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)',
        zIndex: 41, minWidth: 290, overflow: 'hidden',
      }}>
        <div style={{ padding: '8px 14px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={dotClass} style={{ width: 7, height: 7, borderRadius: '50%', background: headerColor, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: headerColor, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {headerLabel}
          </span>
        </div>
        {monitors.map((m, i) => (
          <button key={m.id} onClick={() => onSelect(m)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'none', cursor: 'pointer', textAlign: 'left', borderBottomWidth: i < monitors.length - 1 ? 1 : 0, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
            <span className={m.last_error_class === 'timeout' ? '' : 'anim-pulse'} style={{ width: 8, height: 8, borderRadius: '50%', background: m.last_error_class === 'timeout' ? C.warning : C.danger, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.last_error_class === 'timeout'
                  ? (m.incident_started_at ? `Slow since ${incidentAge(m.incident_started_at)}` : 'Currently slow')
                  : (m.incident_started_at ? `Down since ${incidentAge(m.incident_started_at)}` : 'Currently down')
                } · {m.target}
              </div>
            </div>
            <span style={{ fontSize: 10, color: (m.last_error_class === 'timeout' || m.status === 'degraded') ? C.warning : C.danger, fontWeight: 600, flexShrink: 0 }}>View →</span>
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
  // Distinguish monitors that are STILL failing vs those that recovered
  const currentlyUnhealthyIds = new Set(monitors.filter(mon => mon.enabled && mon.status !== 'up').map(mon => mon.id))
  const stillFailingCount  = failMonitorIds.filter(id => currentlyUnhealthyIds.has(id)).length
  const recoveredCount     = failMonitorIds.length - stillFailingCount

  const slowCount = monitors.filter(mon => {
    if (!mon.avg_response_24h || !mon.enabled) return false
    const threshold = mon.degraded_threshold_ms ?? (isWebEndpoint(mon.name) ? 800 : 200)
    return mon.avg_response_24h >= threshold
  }).length

  const score  = activeScore
  const sColor = score !== null ? scoreColor(score) : C.muted
  const sLabel = score !== null ? scoreLabel(score) : 'Unknown'
  const statusSummary = [
    m.up.length > 0       && `${m.up.length} up`,
    m.down.length > 0     && `${m.down.length} down`,
    m.degraded.length > 0 && `${m.degraded.length} degraded`,
  ].filter(Boolean).join(' · ')

  // Recent activity feed — last 6 notable events (incidents + unique failed checks)
  const recentEvents = useMemo(() => {
    type Ev = { time: string; label: string; sub: string; color: string; icon: string; resolved: boolean }
    const evts: Ev[] = []
    incidents.slice(0, 5).forEach(inc => {
      evts.push({
        time:     inc.started_at,
        label:    inc.monitors?.name ?? 'Monitor',
        sub:      inc.probable_cause ?? inc.first_error_class ?? 'Incident',
        color:    inc.is_open ? C.danger : C.muted,
        icon:     inc.is_open ? '●' : '○',
        resolved: !inc.is_open,
      })
    })
    const seen = new Set<string>()
    for (const fc of failedChecks) {
      if (seen.has(fc.monitor_id)) continue
      seen.add(fc.monitor_id)
      const mon = monitors.find(mm => mm.id === fc.monitor_id)
      evts.push({
        time:     fc.checked_at,
        label:    mon?.name ?? 'Monitor',
        sub:      fc.error_class ?? fc.status,
        color:    fc.status === 'down' ? C.danger : C.warning,
        icon:     fc.status === 'down' ? '✕' : '▲',
        resolved: mon?.status === 'up',
      })
    }
    return evts.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6)
  }, [incidents, failedChecks, monitors])

  const ISSUE_CARD = (borderColor: string) => ({
    background:   'var(--surface-1)' as const,
    borderWidth:  1, borderStyle: 'solid' as const, borderColor,
    borderRadius: 'var(--r-lg)', padding: '16px 20px',
    cursor:       'pointer' as const, textAlign: 'left' as const,
    display:      'flex', flexDirection: 'column' as const, gap: 4,
    transition:   'box-shadow .15s, transform .12s',
    flex:         '1 1 160px',
  })

  const enabledMons = monitors.filter(mon => mon.enabled)
  const sortedMons  = [...enabledMons].sort((a, b) => {
    const rank = (r: MonitorRow) => r.status === 'down' ? 0 : r.status === 'degraded' ? 1 : 2
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
  const hasResponseData = monitors.some(mon => mon.enabled && mon.avg_response_24h !== null && (mon.avg_response_24h as number) < 9500)

  // Compact inline stat chip helper
  const IChip = ({ label, value, color, sub, onClick }: { label: string; value: string; color: string; sub: string; onClick?: () => void }) => (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 1, padding: '8px 14px',
        background: 'none', border: 'none', cursor: onClick ? 'pointer' : 'default',
        borderLeft: '1px solid var(--border)', textAlign: 'left',
        transition: 'background .12s',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.background = 'none' }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{sub}</span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Hero card: ring + monitor pills + inline stats ── */}
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {/* Top row: ring + pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {/* Uptime ring — compact */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '14px 20px', minWidth: 148,
            borderRight: '1px solid var(--border)',
            background: score !== null && score >= 99
              ? `radial-gradient(ellipse at 50% 70%, ${C.success}14 0%, transparent 70%)`
              : score !== null && score < 95
                ? `radial-gradient(ellipse at 50% 70%, ${C.danger}12 0%, transparent 70%)`
                : undefined,
          }}>
            {loading
              ? <div className="skeleton" style={{ width: 110, height: 110, borderRadius: '50%' }} />
              : <UptimeRing value={score} size={110} sub={uptimeLabel} />
            }
            {loading
              ? <div className="skeleton" style={{ width: 64, height: 18, borderRadius: 10 }} />
              : <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 10, background: sColor + '18', color: sColor, border: `1px solid ${sColor}40` }}>{sLabel}</span>
            }
          </div>

          {/* Monitor pills */}
          <div style={{ flex: 1, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Monitor Status</span>
              {!loading && <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{m.enabled.length} active · {statusSummary || 'all up'}</span>}
            </div>
            {loading
              ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 26, width: 100, borderRadius: 20 }} />)}</div>
              : <MonitorStatusGrid monitors={monitors} onOpenMonitor={onOpenMonitor} />
            }
          </div>
        </div>

        {/* Inline stats strip — zero extra height */}
        <div style={{ display: 'flex', flexWrap: 'wrap', borderTop: '1px solid var(--border)', alignItems: 'stretch' }}>
          {loading ? (
            <div style={{ display: 'flex', gap: 12, padding: '10px 16px' }}>
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 44, width: 90, borderRadius: 'var(--r-sm)' }} />)}
            </div>
          ) : (
            <>
              <IChip
                label="Failed checks"
                value={String(failMonitorIds.length)}
                color={stillFailingCount > 0 ? C.danger : failMonitorIds.length > 0 ? C.warning : C.muted}
                sub={stillFailingCount > 0
                  ? `${stillFailingCount} still failing · ${recoveredCount} recovered`
                  : failMonitorIds.length > 0 ? `All ${failMonitorIds.length} recovered` : 'None today'
                }
                onClick={() => onNavigate('checks')}
              />
              <IChip label="Slow monitors" value={String(slowCount)} color={slowCount > 0 ? C.warning : C.muted} sub={slowCount > 0 ? 'above threshold' : 'All fast'} onClick={() => onNavigate('performance')} />
              <IChip label="Open incidents" value={String(m.openIncidents.length)} color={m.openIncidents.length > 0 ? C.danger : C.muted} sub={m.openIncidents.length > 0 ? 'active now' : `${m.incidents7d.length} this period`} onClick={() => onNavigate('incidents')} />
              <IChip label={`Avg response`} value={m.avgResponseMs !== null ? `${m.avgResponseMs}ms` : '—'} color={m.avgResponseMs !== null ? responseColor(m.avgResponseMs, null) : C.muted} sub="service hours" />
              {m.avgResolutionSec !== null && <IChip label="Avg resolution" value={formatDuration(Math.round(m.avgResolutionSec))} color="var(--tx-1)" sub="per incident" />}
            </>
          )}
        </div>
      </div>

      {/* ── Response time + Recent Activity ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {/* Response time bars */}
        <div style={{ flex: '2 1 300px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '14px 18px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', margin: '0 0 2px' }}>Response Times</p>
          <p style={{ fontSize: 10, color: 'var(--tx-3)', margin: '0 0 12px' }}>Service-hours avg · 00:00–09:00 MYT excluded · threshold markers shown</p>
          {loading
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 8 }} />)}</div>
            : hasResponseData
              ? <ResponseTimeBars monitors={monitors} />
              : <p style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic', margin: 0 }}>No response-time data yet — check back after the first probe cycle.</p>
          }
        </div>

        {/* Recent Activity */}
        <div style={{ flex: '1 1 200px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)' }}>Recent Activity</span>
            <button onClick={() => onNavigate('incidents')} style={{ fontSize: 10, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>All →</button>
          </div>
          {loading ? (
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 32 }} />)}
            </div>
          ) : recentEvents.length === 0 ? (
            <div style={{ padding: '18px 14px', textAlign: 'center', fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic' }}>All clear ✓</div>
          ) : recentEvents.map((ev, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderBottom: i < recentEvents.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 11, marginTop: 1, flexShrink: 0, color: ev.color, fontWeight: 900, lineHeight: '18px' }}>{ev.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.label}</div>
                <div style={{ fontSize: 12, color: ev.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.sub}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>{new Date(ev.time).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })} MYT</div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: ev.resolved ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)', color: ev.resolved ? '#22c55e' : '#ef4444', border: `1px solid ${ev.resolved ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'}` }}>
                    {ev.resolved ? '✓ Resolved' : '● Open'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Health signals strip (compact, no box if empty) ── */}
      {!loading && bullets.length > 0 && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.07em', alignSelf: 'center', marginRight: 4, whiteSpace: 'nowrap' }}>Signals</span>
          {bullets.map(b => (
            <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: `${b.color}10`, border: `1px solid ${b.color}30`, color: 'var(--tx-1)' }}>
              <span style={{ color: b.color, fontWeight: 700, fontSize: 10 }}>{b.icon}</span>
              {b.text}
            </span>
          ))}
        </div>
      )}
      {loading && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 14px', display: 'flex', gap: 8 }}>
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 26, width: 180, borderRadius: 20 }} />)}
        </div>
      )}

      {/* ── Monitor table ── */}
      <MonitorTableWidget monitors={sortedMons} loading={loading} onOpenMonitor={onOpenMonitor} tableLimit={8} onViewAll={() => onNavigate('monitors')} />
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────

export default function ServerHealthPage({ onRateLimitUpdate }: { onRateLimitUpdate?: (resetMs: number | null) => void } = {}) {
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
  const [activeTab,        setActiveTab]        = useState<HealthTab>('overview')
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
  const [aiProcessing,     setAiProcessing]     = useState(false)
  const [aiRateLimitReset, setAiRateLimitReset] = useState<number | null>(null)
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

  // Restore saved tab after hydration (cannot use lazy initializer — causes SSR/CSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('server-health-tab') as HealthTab
      const VALID: HealthTab[] = ['overview', 'monitors', 'checks', 'performance', 'lighthouse', 'incidents', 'anomalies']
      if (VALID.includes(saved)) setActiveTab(saved)
    } catch {}
  }, [])

  useEffect(() => { onRateLimitUpdate?.(aiRateLimitReset) }, [aiRateLimitReset, onRateLimitUpdate])

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

  // Non-blocking AI processing — runs in parallel with fetchAll, updates anomaly rows in-place
  const runAiProcessing = useCallback(async (newAnomalies: unknown[]) => {
    setAiProcessing(true)
    try {
      const res = await fetch('/api/anomalies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnomalies),
      })
      if (!res.ok) return
      const data: { upserted: number; analyzed: number; tokensUsed?: number; rateLimitResetMs?: number } = await res.json()
      if (data.rateLimitResetMs) setAiRateLimitReset(data.rateLimitResetMs)
      if (data.analyzed > 0) {
        // Refresh anomalies from DB so newly-analyzed rows show their diagnosis
        const freshRes = await fetch('/api/anomalies?days=30')
        if (freshRes.ok) {
          const freshData = await freshRes.json()
          setAnomalies(freshData as AnomalyRow[])
        }
      }
    } catch { /* best-effort */ }
    finally { setAiProcessing(false) }
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

      // Override avg_response_24h with maintenance-excluded avg from the sparkline checks
      // (checks already have isMaintenancePeriod filtered out, so this reflects active service hours only)
      const adjustedMonitors = monList.map(mon => {
        const checks = checksMap[mon.id] ?? []
        const validMs = checks
          .filter(c => c.status === 'up' && c.response_time_ms !== null && c.response_time_ms > 0 && c.response_time_ms < 9_500)
          .map(c => c.response_time_ms!)
        if (validMs.length === 0) return mon
        return { ...mon, avg_response_24h: Math.round(validMs.reduce((a, b) => a + b, 0) / validMs.length) }
      })
      setMonitors(adjustedMonitors)

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
          const isSpike = avgMs > 0 && (row.response_time_ms ?? 0) >= avgMs * 5  // 5× baseline — only real spikes
          const isDown  = row.status === 'down'
          // ponytail: degraded excluded — too noisy; re-add if specific monitors warrant it
          if (!isSpike && !isDown) continue
          postedAnomalyKeys.current.add(key)
          const ratio = avgMs > 0 && row.response_time_ms ? row.response_time_ms / avgMs : null
          newAnomalies.push({
            monitor_id:      mon.id,
            monitor_name:    mon.name,
            monitor_target:  mon.target,
            checked_at:      row.checked_at,
            anomaly_type:    isDown ? 'down' : 'spike',
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
      // Non-blocking — drains backlog on every cycle, shows progress in UI
      runAiProcessing(newAnomalies)
      // Fetch stored anomalies for Anomalies tab — window matches the selected time range
      const anomalyWin = getTimeWindow(timeRange, customFrom, customTo)
      let anomalyQ = supabase
        .from('monitor_anomalies')
        .select('*')
        .order('checked_at', { ascending: false })
        .limit(2000)
      if (anomalyWin.since) anomalyQ = anomalyQ.gte('checked_at', anomalyWin.since)
      if (anomalyWin.until) anomalyQ = anomalyQ.lte('checked_at', anomalyWin.until)
      const { data: aData } = await anomalyQ
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
  }, [supabase, timeRange, customFrom, customTo, sparklineRange, runAiProcessing])

  useEffect(() => {
    const t = setTimeout(() => fetchAll(false), 0)
    const interval = setInterval(() => fetchAll(true), 30_000)
    // Resume immediately when user returns to this tab/page
    const onVisible = () => { if (document.visibilityState === 'visible') fetchAll(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(t); clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
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

  // DB query now filters by time range — anomalies state already contains only matching rows
  const filteredAnomalies = anomalies

  // Tab badge counts
  const tabBadges = useMemo((): Partial<Record<HealthTab, number>> => {
    const enabled = monitors.filter(m => m.enabled)
    const down    = enabled.filter(m => m.status === 'down' || m.status === 'degraded').length
    const failGroups = new Set(failedChecks.map(fc => fc.monitor_id)).size
    const slow = monitors.filter(m => {
      if (!m.avg_response_24h || !m.enabled) return false
      const threshold = m.degraded_threshold_ms ?? (isWebEndpoint(m.name) ? 800 : 200)
      return m.avg_response_24h >= threshold
    }).length
    const openInc = incidents.filter(i => i.is_open).length
    return {
      monitors:    down > 0 ? down : undefined,
      checks:      failGroups > 0 ? failGroups : undefined,
      performance: slow > 0 ? slow : undefined,
      incidents:   openInc > 0 ? openInc : undefined,
      anomalies:   filteredAnomalies.length > 0 ? filteredAnomalies.length : undefined,
    }
  }, [monitors, failedChecks, incidents, filteredAnomalies])

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
              <p style={{ fontSize: 13, color: 'var(--tx-3)', margin: 0 }}>
                Live infrastructure monitoring · updates every 30 s
                {!loading && <> · Last updated {secondsAgo === 0 ? 'just now' : `${secondsAgo}s ago`}</>}
              </p>
              {/* AI status chip */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 10,
                color: aiRateLimitReset ? C.warning : aiProcessing ? '#60a5fa' : 'var(--tx-3)',
                padding: '3px 10px', borderRadius: 10,
                background: aiRateLimitReset ? 'rgba(245,158,11,.1)' : aiProcessing ? 'rgba(59,130,246,.12)' : 'var(--surface-2)',
                border: `1px solid ${aiRateLimitReset ? 'rgba(245,158,11,.3)' : aiProcessing ? 'rgba(59,130,246,.3)' : 'var(--border)'}`,
                transition: 'all .3s',
              }}>
                {aiRateLimitReset
                  ? <>⚠ AI limit reached · resets {new Date(aiRateLimitReset).toLocaleString('en-AU', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} MYT</>
                  : aiProcessing
                    ? <><span className="anim-spin" style={{ display: 'inline-block', fontSize: 10 }}>⟳</span> AI analyzing…</>
                    : <><span style={{ fontSize: 9, opacity: 0.7 }}>✦</span> AI ready</>
                }
              </span>
            </div>
          </div>
          {!loading && monitors.length > 0 && (() => {
            const affectedMonitors = monitors.filter(m => m.enabled && (m.status === 'down' || m.status === 'degraded'))
            return (
              <div style={{ position: 'relative', alignSelf: 'flex-start' }}>
                <button
                  onClick={() => affectedMonitors.length > 0 && setShowDownPopover(s => !s)}
                  style={{
                    fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20,
                    background: overallStatus.bg, color: overallStatus.color,
                    borderWidth: 1, borderStyle: 'solid', borderColor: overallStatus.border,
                    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
                    cursor: affectedMonitors.length > 0 ? 'pointer' : 'default',
                  }}
                >
                  {overallStatus.label}
                  {affectedMonitors.length > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>▾</span>}
                </button>
                {showDownPopover && affectedMonitors.length > 0 && (
                  <DownServicesPopover
                    monitors={affectedMonitors}
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

        {/* ── Lighthouse Tab ── */}
        {activeTab === 'lighthouse' && (
          loading ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 80 }} />)}
            </div>
          ) : (
            <LighthouseAuditSection monitors={monitors} />
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
        {activeTab === 'anomalies' && (() => {
          // Determine status for each anomaly group relative to current monitor state
          const monitorStatusMap = new Map(monitors.map(m => [m.id, m.status]))
          const now = Date.now()
          const twoHoursMs = 2 * 3_600_000

          const withStatus = filteredAnomalies.map(a => {
            const monStatus = monitorStatusMap.get(a.monitor_id)
            const lastSeenMs = new Date(a.last_seen).getTime()
            const isMonitorDown = monStatus === 'down' || monStatus === 'degraded'
            const quieted = (now - lastSeenMs) > twoHoursMs

            let status: 'active' | 'recurring' | 'quiet'
            if (isMonitorDown || (!quieted && a.occurrence_count > 1)) status = 'active'
            else if (!quieted) status = 'recurring'
            else status = 'quiet'

            return { ...a, _status: status }
          })

          // Sort: active first, then recurring, then quiet; within each group by occurrence_count desc
          const sorted = [...withStatus].sort((a, b) => {
            const order = { active: 0, recurring: 1, quiet: 2 }
            if (order[a._status] !== order[b._status]) return order[a._status] - order[b._status]
            return b.occurrence_count - a.occurrence_count
          })

          // Cross-monitor grouping: collapse rows sharing the same error_fingerprint into one card
          const groupMap = new Map<string, typeof sorted>()
          for (const a of sorted) {
            const arr = groupMap.get(a.error_fingerprint) ?? []
            arr.push(a)
            groupMap.set(a.error_fingerprint, arr)
          }
          const groups = Array.from(groupMap.values()).map(rows => {
            const groupStatus: 'active' | 'recurring' | 'quiet' =
              rows.some(r => r._status === 'active') ? 'active'
              : rows.some(r => r._status === 'recurring') ? 'recurring' : 'quiet'
            const rep = rows.find(r => r.ai_analysis) ?? rows[0]
            return {
              fingerprint:      rep.error_fingerprint,
              anomaly_type:     rep.anomaly_type,
              error_class:      rep.error_class,
              error_message:    rep.error_message,
              status_code:      rep.status_code,
              ai_analysis:      rep.ai_analysis,
              cloudwatch_url:   rep.cloudwatch_url,
              rep,
              totalOccurrences: rows.reduce((s, r) => s + r.occurrence_count, 0),
              firstSeen:        rows.map(r => r.first_seen).sort()[0],
              lastSeen:         rows.map(r => r.last_seen).sort().reverse()[0],
              _status:          groupStatus,
              monitors:         rows.map(r => ({
                id:               r.id,
                monitor_id:       r.monitor_id,
                monitor_name:     r.monitor_name,
                monitor_target:   r.monitor_target,
                occurrence_count: r.occurrence_count,
                _status:          r._status,
                spike_ratio:      r.spike_ratio,
                response_time_ms: r.response_time_ms,
                avg_ms:           r.avg_ms,
                first_seen:       r.first_seen,
                last_seen:        r.last_seen,
                checked_at:       r.checked_at,
                status_code:      r.status_code,
                cloudwatch_url:   r.cloudwatch_url,
              })),
            }
          }).sort((a, b) => {
            const order = { active: 0, recurring: 1, quiet: 2 }
            if (order[a._status] !== order[b._status]) return order[a._status] - order[b._status]
            return b.totalOccurrences - a.totalOccurrences
          })

          const activeCount    = groups.filter(g => g._status === 'active').length
          const recurringCount = groups.filter(g => g._status === 'recurring').length

          return (
            <div style={{ background: 'var(--surface-1)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '14px 20px', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx-1)', margin: 0 }}>Anomaly Groups</h2>
                {!loading && (
                  <div style={{ display: 'flex', gap: 5 }}>
                    {activeCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: C.dangerBg, color: C.danger, border: `1px solid ${C.dangerBorder}` }}>
                        {activeCount} active
                      </span>
                    )}
                    {recurringCount > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: C.warningBg, color: C.warning, border: `1px solid ${C.warningBorder}` }}>
                        {recurringCount} recurring
                      </span>
                    )}
                  </div>
                )}
                {aiRateLimitReset ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#f59e0b', padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)' }}>
                    ⚠ OpenRouter rate limit — resets {new Date(aiRateLimitReset).toLocaleString('en-AU', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })} MYT
                  </span>
                ) : aiProcessing && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#60a5fa', padding: '2px 8px', borderRadius: 10, background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)' }}>
                    <span className="anim-spin" style={{ display: 'inline-block' }}>⟳</span> AI analyzing…
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--tx-3)', marginLeft: 'auto' }}>
                  Each row = one unique error pattern · recurrences collapsed · {getWindowLabel(timeRange, customFrom, customTo)}
                </span>
              </div>

              {loading ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 70 }} />)}
                </div>
              ) : sorted.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
                  No anomalies detected in {getWindowLabel(timeRange, customFrom, customTo).toLowerCase()}.
                  {anomalies.length > 0 && timeRange !== '30d' && (
                    <span> Try <button onClick={() => setTimeRange('30d')} style={{ color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13 }}>last 30 days</button>.</span>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {groups.map((g, i) => {
                    const isExpanded = expandedAnomalyId === g.fingerprint
                    const logData    = anomalyLogs[g.rep.id]
                    const isLast     = i === groups.length - 1

                    // Colours by type
                    const maxRatio   = Math.max(...g.monitors.map(m => m.spike_ratio ?? 0))
                    const typeColor  = g.anomaly_type === 'down' ? C.danger
                      : maxRatio >= 6 ? C.danger
                      : maxRatio >= 3 ? '#f97316'
                      : C.warning
                    const typeBg     = g.anomaly_type === 'down' ? C.dangerBg : 'rgba(227,179,65,.12)'
                    const typeBorder = g.anomaly_type === 'down' ? C.dangerBorder : 'rgba(227,179,65,.3)'

                    // Status pill
                    const statusColor  = g._status === 'active' ? C.danger : g._status === 'recurring' ? C.warning : C.muted
                    const statusBg     = g._status === 'active' ? C.dangerBg : g._status === 'recurring' ? C.warningBg : C.mutedBg
                    const statusBorder = g._status === 'active' ? C.dangerBorder : g._status === 'recurring' ? C.warningBorder : C.mutedBorder
                    const statusLabel  = g._status === 'active' ? '● Active' : g._status === 'recurring' ? '↺ Recurring' : '○ Quiet'

                    const fmtMYT = (iso: string) => new Date(iso).toLocaleString('en-MY', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
                    })
                    const isMultiDay = g.firstSeen.slice(0, 10) !== g.lastSeen.slice(0, 10)

                    // Primary title: error class (the WHAT), not the monitor name
                    const errorTitle = g.error_class ?? (g.anomaly_type === 'down' ? 'Service down' : 'Performance spike')

                    return (
                      <div key={g.fingerprint} style={{
                        borderBottomWidth: isLast && !isExpanded ? 0 : 1,
                        borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
                      }}>
                        {/* Group row — click anywhere to expand detail */}
                        <div
                          onClick={() => setExpandedAnomalyId(isExpanded ? null : g.fingerprint)}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 20px',
                            background: isExpanded ? 'rgba(59,130,246,.04)' : undefined,
                            cursor: 'pointer',
                          }}
                        >
                          {/* Left: type badge + status */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, paddingTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', background: typeBg, color: typeColor, borderWidth: 1, borderStyle: 'solid', borderColor: typeBorder, whiteSpace: 'nowrap' }}>
                              {g.anomaly_type === 'spike' ? '⚡ spike' : '✗ down'}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: statusBg, color: statusColor, borderWidth: 1, borderStyle: 'solid', borderColor: statusBorder, whiteSpace: 'nowrap' }}>
                              {statusLabel}
                            </span>
                          </div>

                          {/* Middle: error title + plain-English summary + monitors + AI */}
                          <div style={{ flex: 1, minWidth: 0 }}>

                            {/* Row 1: Error title + HTTP status + detection count */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                              <span style={{
                                fontSize: 14, fontWeight: 700,
                                fontFamily: g.error_class ? 'monospace' : 'inherit',
                                color: typeColor,
                                background: g.error_class ? typeBg : 'transparent',
                                padding: g.error_class ? '1px 6px' : 0,
                                borderRadius: 4,
                              }}>
                                {errorTitle}
                              </span>
                              {g.status_code != null && (
                                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: g.status_code >= 500 ? C.dangerBg : C.warningBg, color: g.status_code >= 500 ? C.danger : C.warning }}>
                                  HTTP {g.status_code}
                                </span>
                              )}
                              <span
                                title="How many times our health checker detected this problem across all monitors"
                                style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: typeColor + '18', color: typeColor, border: `1px solid ${typeColor}40`, whiteSpace: 'nowrap', cursor: 'help' }}
                              >
                                {g.totalOccurrences} detection{g.totalOccurrences !== 1 ? 's' : ''}
                              </span>
                            </div>

                            {/* Row 2: Plain-English summary */}
                            <div style={{ fontSize: 12, color: 'var(--tx-2)', marginBottom: 7, lineHeight: 1.4 }}>
                              {g.anomaly_type === 'down'
                                ? 'Connection failed — the service did not respond to health checks'
                                : (() => {
                                    const bestM = g.monitors.reduce((best, m) =>
                                      (m.spike_ratio ?? 0) > (best.spike_ratio ?? 0) ? m : best, g.monitors[0])
                                    const ratio = bestM.spike_ratio
                                    const actual = bestM.response_time_ms
                                    const avg = bestM.avg_ms
                                    if (ratio != null && actual != null && avg != null)
                                      return `Responded in ${actual.toLocaleString()}ms — ${ratio.toFixed(1)}× slower than the usual ${avg.toLocaleString()}ms baseline`
                                    if (actual != null)
                                      return `Responded in ${actual.toLocaleString()}ms — significantly above normal response times`
                                    return 'Response time was significantly above the normal baseline'
                                  })()
                              }
                              {g.error_message && (
                                <span style={{ color: 'var(--tx-3)' }}> · {g.error_message.slice(0, 120)}{g.error_message.length > 120 ? '…' : ''}</span>
                              )}
                            </div>

                            {/* Row 3: Spike severity bar (spike only) */}
                            {g.anomaly_type === 'spike' && (() => {
                              const bestRatio = Math.max(...g.monitors.map(m => m.spike_ratio ?? 0))
                              if (bestRatio <= 0) return null
                              const cappedPct = Math.min(100, (bestRatio / 10) * 100)
                              const barColor = bestRatio >= 6 ? C.danger : bestRatio >= 3 ? '#f97316' : C.warning
                              return (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                                      <div style={{ width: `${cappedPct}%`, height: '100%', background: barColor, borderRadius: 99, transition: 'width .4s ease' }} />
                                    </div>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: barColor, whiteSpace: 'nowrap', minWidth: 60 }}
                                      title="Spike ratio: how many times slower than the rolling 30-day average. 1× = normal, 3× = 3 times slower than usual.">
                                      {bestRatio.toFixed(1)}× slower ⓘ
                                    </span>
                                  </div>
                                </div>
                              )
                            })()}

                            {/* Row 4: Affected monitors */}
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                              {g.monitors.map(m => {
                                const mBg  = m._status === 'active' ? C.dangerBg : m._status === 'recurring' ? C.warningBg : 'var(--surface-3)'
                                const mCol = m._status === 'active' ? C.danger   : m._status === 'recurring' ? C.warning   : 'var(--tx-2)'
                                const mBdr = m._status === 'active' ? C.dangerBorder : m._status === 'recurring' ? C.warningBorder : 'var(--border)'
                                return (
                                  <span key={m.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', background: mBg, color: mCol, border: `1px solid ${mBdr}` }}
                                    title={m.spike_ratio != null ? `${m.occurrence_count} detection${m.occurrence_count !== 1 ? 's' : ''} · responded ${m.spike_ratio.toFixed(1)}× slower than usual (${m.response_time_ms}ms vs ${m.avg_ms}ms baseline)` : `${m.occurrence_count} detection${m.occurrence_count !== 1 ? 's' : ''}`}>
                                    {m.monitor_name}
                                    {m.spike_ratio != null
                                      ? <span style={{ marginLeft: 5, fontSize: 10, opacity: .75 }}>{m.spike_ratio.toFixed(1)}× slower</span>
                                      : m.occurrence_count > 1 && <span style={{ marginLeft: 4, fontWeight: 700 }}>{m.occurrence_count}×</span>}
                                  </span>
                                )
                              })}
                            </div>

                            {/* Row 5: AI diagnosis or fallback */}
                            {g.ai_analysis ? (
                              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--tx-1)', lineHeight: 1.55, padding: '7px 10px', background: 'rgba(59,130,246,.08)', borderRadius: 'var(--r-sm)', borderLeft: '3px solid rgba(59,130,246,.5)', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 13, flexShrink: 0 }}>🤖</span>
                                <span>{g.ai_analysis}</span>
                              </div>
                            ) : (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {aiRateLimitReset
                                  ? <span style={{ color: '#f59e0b' }}>⚠ AI rate-limited — will retry when quota resets</span>
                                  : aiProcessing
                                    ? <span>⟳ AI analyzing…</span>
                                    : <span>AI diagnosis pending</span>}
                                {g.cloudwatch_url && !g.ai_analysis && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setExpandedAnomalyId(g.fingerprint); fetchAnomalyLogs(g.rep) }}
                                    style={{ fontSize: 10, padding: '1px 8px', borderRadius: 4, cursor: 'pointer', background: 'var(--surface-3)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.3)', fontFamily: 'inherit' }}
                                  >
                                    Load logs →
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Row 6: Timestamps (compact) */}
                            <div style={{ fontSize: 10, color: 'var(--tx-3)', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                              <span>First: <span style={{ color: 'var(--tx-2)' }}>{fmtMYT(g.firstSeen)} MYT</span></span>
                              {g.totalOccurrences > 1 && (
                                <span>Last: <span style={{ color: g._status === 'active' ? C.danger : 'var(--tx-2)' }}>{fmtMYT(g.lastSeen)} MYT</span></span>
                              )}
                              {isMultiDay && g.totalOccurrences > 1 && (
                                <span style={{ color: C.warning }}>↻ spanning {Math.ceil((new Date(g.lastSeen).getTime() - new Date(g.firstSeen).getTime()) / 86_400_000)}d</span>
                              )}
                            </div>
                          </div>

                          {/* Right: expand chevron */}
                          <div style={{ flexShrink: 0, paddingTop: 4 }}>
                            <span style={{ fontSize: 16, color: 'var(--tx-3)', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>▾</span>
                          </div>
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (() => {
                          const durMs = new Date(g.lastSeen).getTime() - new Date(g.firstSeen).getTime()
                          const dur = durMs < 60_000 ? 'under a minute'
                            : durMs < 3_600_000 ? `${Math.round(durMs / 60_000)} min`
                            : durMs < 86_400_000 ? `${(durMs / 3_600_000).toFixed(1)}h`
                            : `${Math.ceil(durMs / 86_400_000)} days`
                          const severity = g.anomaly_type === 'down' ? { label: 'Critical — service unreachable', color: C.danger }
                            : maxRatio >= 6 ? { label: `Critical — ${maxRatio.toFixed(1)}× normal response time`, color: C.danger }
                            : maxRatio >= 3 ? { label: `High — ${maxRatio.toFixed(1)}× normal response time`, color: '#f97316' }
                            : { label: `Medium — ${maxRatio.toFixed(1)}× normal response time`, color: C.warning }
                          const sectionHead = (label: string) => (
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: 10, paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                              {label}
                            </div>
                          )
                          // Per-monitor log state (keyed by row id)
                          const perMonitorLogs = g.monitors.reduce((acc, m) => {
                            acc[m.id] = anomalyLogs[m.id] ?? null
                            return acc
                          }, {} as Record<string, typeof anomalyLogs[string] | null>)

                          // Derive a full AnomalyRow-compatible object for each monitor for fetchAnomalyLogs
                          const monitorAsRow = (m: typeof g.monitors[0]): AnomalyRow => ({
                            ...g.rep,
                            id:               m.id,
                            monitor_id:       m.monitor_id,
                            monitor_name:     m.monitor_name,
                            monitor_target:   m.monitor_target,
                            occurrence_count: m.occurrence_count,
                            spike_ratio:      m.spike_ratio,
                            response_time_ms: m.response_time_ms,
                            avg_ms:           m.avg_ms,
                            first_seen:       m.first_seen,
                            last_seen:        m.last_seen,
                            checked_at:       m.checked_at,
                            status_code:      m.status_code,
                            cloudwatch_url:   m.cloudwatch_url,
                          })

                          // Active log panel — which monitor's logs are expanded
                          const activeLogMonitorId = Object.keys(perMonitorLogs).find(id => perMonitorLogs[id] != null)

                          return (
                            <div style={{ borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)', background: 'var(--surface-2)' }}>
                              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 22 }}>

                                {/* ── 1. AI DIAGNOSIS (first — most useful) ── */}
                                <div>
                                  {sectionHead('🤖 AI Diagnosis')}
                                  {g.ai_analysis ? (
                                    <div style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.75, padding: '12px 16px', background: 'rgba(59,130,246,.08)', borderRadius: 'var(--r-md)', borderLeft: '3px solid rgba(59,130,246,.5)' }}>
                                      {g.ai_analysis}
                                    </div>
                                  ) : (
                                    <div style={{ padding: '12px 16px', background: 'var(--surface-3)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      {aiRateLimitReset
                                        ? <span style={{ fontSize: 12, color: '#f59e0b' }}>⚠ AI quota reached — will retry when it resets</span>
                                        : aiProcessing
                                          ? <span style={{ fontSize: 12, color: '#60a5fa' }}>⟳ AI is analyzing this anomaly — check back in a moment</span>
                                          : <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>No AI diagnosis yet. {g.anomaly_type === 'spike' && !g.error_class ? 'This is a pure performance spike with no error signal — load CloudWatch logs below for context.' : 'Analysis is queued.'}</span>}
                                      {g.cloudwatch_url && (
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                          {g.monitors.filter(m => m.cloudwatch_url).map(m => {
                                            const ld = perMonitorLogs[m.id]
                                            return (
                                              <button key={m.id}
                                                onClick={e => { e.stopPropagation(); fetchAnomalyLogs(monitorAsRow(m)) }}
                                                disabled={ld?.loading}
                                                style={{ fontSize: 11, padding: '4px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: ld ? 'rgba(59,130,246,.12)' : 'var(--surface-2)', color: ld ? '#60a5fa' : 'var(--tx-2)', border: `1px solid ${ld ? 'rgba(59,130,246,.35)' : 'var(--border)'}`, fontFamily: 'inherit' }}
                                              >
                                                {ld?.loading ? '⟳ loading…' : ld?.error ? '⚠ retry' : ld ? '✓ logs loaded' : `Load logs — ${m.monitor_name}`}
                                              </button>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* ── 2. WHAT HAPPENED ── */}
                                <div>
                                  {sectionHead('What happened')}
                                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                    <div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Type</div>
                                      <div style={{ fontSize: 13, color: 'var(--tx-1)' }}>{g.anomaly_type === 'down' ? '✗ Service unreachable — connection failed' : '⚡ Response time spike'}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Severity</div>
                                      <div style={{ fontSize: 13, fontWeight: 600, color: severity.color }}>{severity.label}</div>
                                    </div>
                                    {g.status_code != null && (
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>HTTP status</div>
                                        <div style={{ fontSize: 13, fontFamily: 'monospace', color: g.status_code >= 500 ? C.danger : C.warning }}>HTTP {g.status_code}</div>
                                      </div>
                                    )}
                                    {g.error_class && (
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Error class</div>
                                        <code style={{ fontSize: 12, fontFamily: 'monospace', color: typeColor, background: typeBg, padding: '2px 8px', borderRadius: 4 }}>{g.error_class}</code>
                                      </div>
                                    )}
                                  </div>
                                  {g.error_message && (
                                    <div style={{ marginTop: 10 }}>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 4 }}>Error message</div>
                                      <div style={{ fontSize: 12, color: 'var(--tx-2)', fontFamily: 'monospace', background: 'var(--surface-3)', padding: '8px 12px', borderRadius: 'var(--r-sm)', wordBreak: 'break-all' }}>{g.error_message}</div>
                                    </div>
                                  )}
                                </div>

                                {/* ── 3. RESPONSE TIME VISUAL (spike only) ── */}
                                {g.anomaly_type === 'spike' && g.monitors.some(m => m.response_time_ms != null) && (
                                  <div>
                                    {sectionHead('Response time — actual vs baseline')}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      {g.monitors.filter(m => m.response_time_ms != null).sort((a, b) => (b.spike_ratio ?? 0) - (a.spike_ratio ?? 0)).map(m => {
                                        const actual = m.response_time_ms!
                                        const avg    = m.avg_ms ?? actual
                                        const ratio  = m.spike_ratio ?? (actual / avg)
                                        const barColor = ratio >= 6 ? C.danger : ratio >= 3 ? '#f97316' : C.warning
                                        // Normalize: baseline = 40% of bar, actual = proportional to ratio
                                        const baselinePct = 30
                                        const actualPct   = Math.min(100, baselinePct * ratio)
                                        return (
                                          <div key={m.id}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                              <span style={{ fontSize: 11, color: 'var(--tx-2)', fontWeight: 500 }}>{m.monitor_name}</span>
                                              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--tx-3)' }}>{actual.toLocaleString()}ms <span style={{ color: 'var(--tx-4, var(--tx-3))' }}>vs</span> {avg.toLocaleString()}ms baseline</span>
                                            </div>
                                            <div style={{ position: 'relative', height: 22, background: 'var(--surface-3)', borderRadius: 6, overflow: 'hidden' }}>
                                              {/* Baseline bar */}
                                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${baselinePct}%`, background: '#3fb95044', borderRight: '2px dashed #3fb95099' }} />
                                              {/* Actual bar */}
                                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${actualPct}%`, background: barColor + '66', borderRight: `2px solid ${barColor}`, transition: 'width .5s ease' }} />
                                              {/* Labels */}
                                              <div style={{ position: 'absolute', left: 6, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
                                                <span style={{ fontSize: 9, color: '#3fb950', fontWeight: 700, whiteSpace: 'nowrap' }}>baseline</span>
                                              </div>
                                              <div style={{ position: 'absolute', right: 6, top: 0, height: '100%', display: 'flex', alignItems: 'center' }}>
                                                <span style={{ fontSize: 10, color: barColor, fontWeight: 700 }}>{ratio.toFixed(1)}× slower</span>
                                              </div>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--tx-3)' }}>
                                      <span style={{ color: '#3fb950', fontWeight: 600 }}>Green dashed line</span> = 30-day rolling average (baseline). <span style={{ color: C.warning, fontWeight: 600 }}>Coloured bar</span> = actual response time during the anomaly. Longer bar = slower response.
                                    </div>
                                  </div>
                                )}

                                {/* ── 4. WHEN ── */}
                                <div>
                                  {sectionHead('When')}
                                  <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                                    <div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>First detected</div>
                                      <div style={{ fontSize: 13, color: 'var(--tx-1)' }}>{fmtMYT(g.firstSeen)} MYT</div>
                                    </div>
                                    {g.totalOccurrences > 1 && (
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Last detected</div>
                                        <div style={{ fontSize: 13, color: g._status === 'active' ? C.danger : 'var(--tx-1)' }}>{fmtMYT(g.lastSeen)} MYT{g._status === 'active' && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: C.danger }}>● still active</span>}</div>
                                      </div>
                                    )}
                                    <div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Duration</div>
                                      <div style={{ fontSize: 13, color: 'var(--tx-1)' }}>{dur}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginBottom: 2 }}>Total detections</div>
                                      <div style={{ fontSize: 13, fontWeight: 700, color: typeColor }}>{g.totalOccurrences} across {g.monitors.length} monitor{g.monitors.length !== 1 ? 's' : ''}</div>
                                      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 2 }}>Each detection = one failed health check</div>
                                    </div>
                                  </div>
                                </div>

                                {/* ── 5. WHERE — per-monitor table with log buttons ── */}
                                <div>
                                  {sectionHead(`Where — ${g.monitors.length} affected monitor${g.monitors.length !== 1 ? 's' : ''}`)}
                                  <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                          {[
                                            { h: 'Monitor',            tip: null },
                                            { h: 'Detections',         tip: 'How many times our health checker detected this problem for this monitor' },
                                            { h: 'Actual response',    tip: 'The response time recorded when the anomaly was detected' },
                                            { h: 'Baseline (30d avg)', tip: 'The average response time over the last 30 days — used to detect spikes' },
                                            { h: 'Spike ratio',        tip: 'How many times slower the actual response was vs the baseline. 3× means it took 3 times longer than usual.' },
                                            { h: 'Last seen',          tip: null },
                                            { h: 'Logs',               tip: 'Load CloudWatch logs from ±2 minutes around the anomaly time' },
                                          ].map(({ h, tip }) => (
                                            <th key={h} title={tip ?? undefined} style={{ textAlign: h === 'Monitor' ? 'left' : 'right', padding: '3px 10px 7px', color: 'var(--tx-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap', cursor: tip ? 'help' : 'default' }}>
                                              {h}{tip && ' ⓘ'}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.monitors.slice().sort((a, b) => b.occurrence_count - a.occurrence_count).map((m, mi) => {
                                          const mColor  = m._status === 'active' ? C.danger : m._status === 'recurring' ? C.warning : 'var(--tx-2)'
                                          const spikeC  = (m.spike_ratio ?? 0) >= 6 ? C.danger : (m.spike_ratio ?? 0) >= 3 ? '#f97316' : C.warning
                                          const mLogData = perMonitorLogs[m.id]
                                          return (
                                            <tr key={m.id} style={{ borderBottom: mi < g.monitors.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                              <td style={{ padding: '8px 10px 8px 0', color: 'var(--tx-1)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: mColor, marginRight: 7, verticalAlign: 'middle' }} />
                                                {m.monitor_name}
                                              </td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: typeColor, fontWeight: 700 }}>{m.occurrence_count}</td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: 'var(--tx-1)', fontWeight: 600 }}>
                                                {m.response_time_ms != null ? `${m.response_time_ms.toLocaleString()}ms` : '—'}
                                              </td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', color: 'var(--tx-3)' }}>
                                                {m.avg_ms != null ? `${m.avg_ms.toLocaleString()}ms` : '—'}
                                              </td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: m.spike_ratio != null ? spikeC : 'var(--tx-3)' }}>
                                                {m.spike_ratio != null ? `${m.spike_ratio.toFixed(1)}× slower` : '—'}
                                              </td>
                                              <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--tx-2)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtMYT(m.last_seen)} MYT</td>
                                              <td style={{ padding: '8px 0 8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {m.cloudwatch_url ? (
                                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                    <button
                                                      onClick={e => { e.stopPropagation(); fetchAnomalyLogs(monitorAsRow(m)) }}
                                                      disabled={mLogData?.loading}
                                                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: mLogData ? 'rgba(59,130,246,.12)' : 'var(--surface-3)', color: mLogData ? '#60a5fa' : 'var(--tx-2)', border: `1px solid ${mLogData ? 'rgba(59,130,246,.35)' : 'var(--border)'}`, fontFamily: 'inherit' }}
                                                    >
                                                      {mLogData?.loading ? '⟳' : mLogData?.error ? '⚠ retry' : mLogData ? '✓ loaded' : 'Load logs'}
                                                    </button>
                                                    <a href={m.cloudwatch_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 10, color: 'var(--tx-3)', textDecoration: 'none' }} title="Open in CloudWatch console">↗</a>
                                                  </div>
                                                ) : <span style={{ color: 'var(--tx-4, var(--tx-3))', fontSize: 10 }}>no URL</span>}
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>

                                  {/* Per-monitor log viewer */}
                                  {g.monitors.filter(m => perMonitorLogs[m.id]).map(m => {
                                    const ld = perMonitorLogs[m.id]!
                                    return (
                                      <div key={m.id} style={{ marginTop: 14 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <span>Logs: {m.monitor_name}</span>
                                          <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>±2 min around {fmtMYT(m.last_seen)} MYT</span>
                                        </div>
                                        {ld.loading ? (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 10, maxWidth: `${80 - i * 15}%` }} />)}
                                          </div>
                                        ) : ld.error ? (
                                          <div style={{ color: C.danger, fontSize: 12 }}>⚠ {ld.error}</div>
                                        ) : (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {ld.analysis && (
                                              <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>AI Diagnosis (from logs)</div>
                                                <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.6 }}>{ld.analysis}</p>
                                              </div>
                                            )}
                                            {ld.events.length === 0 ? (
                                              <div style={{ fontSize: 12, color: 'var(--tx-3)', fontStyle: 'italic', padding: '8px 0' }}>No log events in this time window.</div>
                                            ) : (
                                              <pre style={{ margin: 0, padding: '12px 14px', background: '#0d1117', borderRadius: 'var(--r-md)', fontSize: 11, fontFamily: 'monospace', overflowX: 'auto', maxHeight: 280, overflowY: 'auto', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {ld.events.map((ev, ei) => {
                                                  const msg   = ev.message ?? ''
                                                  const isErr = /error|fatal|exception/i.test(msg)
                                                  const isWrn = /warn/i.test(msg)
                                                  const ts    = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
                                                  return (
                                                    <div key={ei} style={{ color: isErr ? C.danger : isWrn ? C.warning : 'var(--tx-2)', marginBottom: 2 }}>
                                                      {ts && <span style={{ color: 'var(--tx-3)', marginRight: 10, fontSize: 10 }}>{ts}</span>}
                                                      {msg}
                                                    </div>
                                                  )
                                                })}
                                              </pre>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>

                                {/* ── 6. TERMINOLOGY LEGEND ── */}
                                <div style={{ background: 'var(--surface-3)', borderRadius: 'var(--r-md)', padding: '10px 14px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--tx-2)' }}>Detections</span> — how many health checks reported this problem
                                  </div>
                                  <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--tx-2)' }}>Spike ratio</span> — how many times slower than the 30-day rolling average (1× = normal, 3× = 3 times slower)
                                  </div>
                                  <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--tx-2)' }}>Baseline</span> — rolling average response time from the past 30 days, used to detect what's abnormal
                                  </div>
                                </div>

                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

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
          anomalies={anomalies}
          onNavigateToIncident={(id) => {
            setExpandedMonitor(null)
            setActiveTab('incidents')
            setExpandedIncIds(new Set([id]))
          }}
        />
      )}
    </div>
  )
}
