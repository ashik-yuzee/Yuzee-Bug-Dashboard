'use client'

import { useCwScanState } from '@/hooks/useCwScanState'
import { relativeTime } from '@/lib/utils'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { RefreshCw, AlertTriangle } from 'lucide-react'

const STALE_MINUTES = 15
const HIGH_ERROR_THRESHOLD = 10

function minutesSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: color + '18', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export default function CloudWatchMonitorTab() {
  const { groups, loading, error, refresh } = useCwScanState()
  const staleGroups = groups.filter(g => {
    const mins = minutesSince(g.last_scanned_at)
    return g.is_active !== false && mins !== null && mins > STALE_MINUTES
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {staleGroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.28)', borderRadius: 'var(--r-lg)' }}>
          <AlertTriangle size={15} color="var(--warning)" />
          <p style={{ fontSize: 13, color: 'var(--warning)', flex: 1 }}>
            <strong>{staleGroups.length}</strong> active log group{staleGroups.length > 1 ? 's have' : ' has'} not been scanned in over {STALE_MINUTES} minutes — the CloudWatch poller may be stalled.
          </p>
        </div>
      )}

      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>CloudWatch Monitor</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>Log group scan state · polled every 10 minutes by n8n</p>
          </div>
          <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        {loading ? <div style={{ padding: 16 }}><SkeletonCard h={200} /></div> : error ? (
          <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{error}</p>
        ) : groups.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--tx-3)', padding: '24px 16px', textAlign: 'center' }}>No log groups configured</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  {['Log Group', 'Last Scanned', 'Last Event', 'Errors (24h)', 'Active'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const mins = minutesSince(g.last_scanned_at)
                  const isStale = g.is_active !== false && mins !== null && mins > STALE_MINUTES
                  const highErrors = (g.error_count_24h ?? 0) > HIGH_ERROR_THRESHOLD
                  return (
                    <tr key={g.log_group} style={{ borderBottom: '1px solid var(--border)', background: isStale ? 'rgba(227,179,65,.04)' : 'transparent' }}>
                      <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'monospace', color: 'var(--tx-1)' }}>{g.log_group}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: isStale ? 'var(--warning)' : 'var(--tx-2)', fontWeight: isStale ? 600 : 400 }} title={g.last_scanned_at}>
                        {relativeTime(g.last_scanned_at)}{isStale ? ' ⚠' : ''}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--tx-3)' }} title={g.last_event_at || ''}>{relativeTime(g.last_event_at)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700, color: highErrors ? 'var(--danger)' : 'var(--tx-1)' }}>{g.error_count_24h ?? 0}</td>
                      <td style={{ padding: '9px 12px' }}>{g.is_active === false ? <Pill label="Inactive" color="var(--tx-3)" /> : <Pill label="Active" color="var(--success)" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
