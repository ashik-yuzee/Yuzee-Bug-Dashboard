'use client'

import type { ParsedBug, DashboardStats } from '@/lib/bugUtils'
import { ROUTING_COLORS } from '@/lib/utils'
import { ExternalLink, AlertTriangle, User } from 'lucide-react'

interface Props { bugs: ParsedBug[]; stats: DashboardStats; onViewBugs?: (routing: string) => void }

const SEV: Record<string, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)' }

interface Dev {
  name: string; role: string; routing: string; emoji: string
  note?: string
}

const DEVS: Dev[] = [
  { name: 'Junaid',    role: 'Backend Engineer',        routing: 'BACKEND', emoji: '⚙️',  note: 'Java / Spring Boot / AWS' },
  { name: 'Shaqeeba',  role: 'Mobile Engineer',         routing: 'MOBILE',  emoji: '📱',  note: 'iOS / Android / Flutter' },
  { name: 'Ramzan',    role: 'Frontend Engineer',        routing: 'WEB',     emoji: '🌐',  note: 'React / Next.js / TypeScript' },
  { name: 'Asif',      role: 'AI / Data Engineer',      routing: 'Unknown', emoji: '🤖',  note: 'Gemini / n8n / Analytics' },
]

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex: 1, height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${max ? (value / max) * 100 : 0}%`, height: '100%', background: color, borderRadius: 3, minWidth: value > 0 ? 3 : 0, transition: 'width .4s ease' }} aria-hidden />
    </div>
  )
}

function DevCard({ dev, bugs, onView }: { dev: Dev; bugs: ParsedBug[]; onView?: () => void }) {
  const rc = dev.routing !== 'Unknown' ? ROUTING_COLORS[dev.routing as 'BACKEND' | 'MOBILE' | 'WEB'] : null

  const total   = bugs.length
  const p1      = bugs.filter(b => b.severity === 'P1').length
  const p2      = bugs.filter(b => b.severity === 'P2').length
  const p3      = bugs.filter(b => b.severity === 'P3').length
  const p4      = bugs.filter(b => b.severity === 'P4').length
  const noJira  = bugs.filter(b => !b.jira_key && !b.jira_pending).length
  const pending = bugs.filter(b => b.jira_pending === true).length
  const open    = bugs.filter(b => b.status !== 'complete' && b.status !== 'resolved').length

  const maxSev = Math.max(p1, p2, p3, p4, 1)

  const urgency = p1 > 0 ? 'critical' : p2 > 3 ? 'warning' : 'normal'

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: `1px solid ${urgency === 'critical' ? 'rgba(255,123,114,.3)' : urgency === 'warning' ? 'rgba(227,179,65,.25)' : rc ? rc.border : 'var(--border)'}`,
      borderRadius: 'var(--r-xl)',
      padding: 20,
      display: 'flex', flexDirection: 'column', gap: 16,
      boxShadow: p1 > 0 ? '0 0 0 1px rgba(255,123,114,.06) inset' : 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>{dev.emoji}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx-1)' }}>{dev.name}</p>
              {rc && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                  {dev.routing}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--tx-3)', marginTop: 2 }}>{dev.role}</p>
            {dev.note && <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 1, fontStyle: 'italic' }}>{dev.note}</p>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 32, fontWeight: 800, color: urgency === 'critical' ? 'var(--p1)' : urgency === 'warning' ? 'var(--p2)' : rc?.color || 'var(--tx-1)', lineHeight: 1 }}>{total}</p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>{open} open</p>
        </div>
      </div>

      {/* Severity pill counts */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([['P1', p1], ['P2', p2], ['P3', p3], ['P4', p4]] as [string, number][]).map(([sev, cnt]) => (
          <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: cnt > 0 ? (SEV[sev] + '18') : 'var(--surface-2)', border: `1px solid ${cnt > 0 ? (SEV[sev] + '35') : 'var(--border)'}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: cnt > 0 ? SEV[sev] : 'var(--tx-3)' }}>{sev}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: cnt > 0 ? SEV[sev] : 'var(--tx-3)' }}>{cnt}</span>
          </div>
        ))}
      </div>

      {/* Severity bar chart */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {([['P1', p1, 'var(--p1)'], ['P2', p2, 'var(--p2)'], ['P3', p3, 'var(--p3)'], ['P4', p4, 'var(--p4)']] as [string, number, string][]).filter(([, v]) => v > 0).map(([sev, cnt, col]) => (
          <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 22, fontSize: 10, fontWeight: 700, color: col, flexShrink: 0 }}>{sev}</span>
            <Bar value={cnt} max={maxSev} color={col} />
            <span style={{ width: 24, fontSize: 11, color: 'var(--tx-2)', textAlign: 'right', flexShrink: 0 }}>{cnt}</span>
          </div>
        ))}
      </div>

      {/* Attention items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {noJira > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--tx-3)', flexShrink: 0 }} aria-hidden />
            <span><strong style={{ color: 'var(--tx-1)' }}>{noJira}</strong> bugs without a Jira ticket</span>
          </div>
        )}
        {pending > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--warning)' }}>
            <AlertTriangle size={12} style={{ flexShrink: 0 }} aria-hidden />
            <span><strong>{pending}</strong> ticket{pending > 1 ? 's' : ''} failed to create — needs manual retry</span>
          </div>
        )}
      </div>

      {/* View link */}
      {onView && (
        <button onClick={onView} style={{ display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: rc?.color || 'var(--orange)', background: rc ? rc.bg : 'var(--orange-dim)', border: `1px solid ${rc ? rc.border : 'rgba(249,115,22,.25)'}`, borderRadius: 'var(--r-md)', padding: '5px 12px', cursor: 'pointer', transition: 'opacity .15s' }}>
          View their bugs <ExternalLink size={11} aria-hidden />
        </button>
      )}
    </div>
  )
}

export default function DeveloperView({ bugs, stats, onViewBugs }: Props) {
  const unresolvedBugs = bugs.filter(b => b.status !== 'complete' && b.status !== 'resolved')

  const devBugs = (dev: Dev) => {
    if (dev.routing === 'Unknown') {
      return bugs.filter(b => !b.routingToken)
    }
    return bugs.filter(b => b.routingToken === dev.routing)
  }

  const devsWithBugs = DEVS.map(dev => ({
    dev,
    bugs: devBugs(dev),
  })).sort((a, b) => {
    const aP1 = a.bugs.filter(b => b.severity === 'P1').length
    const bP1 = b.bugs.filter(b => b.severity === 'P1').length
    if (aP1 !== bP1) return bP1 - aP1
    return b.bugs.length - a.bugs.length
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

      {/* Summary header */}
      <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <User size={18} color="var(--tx-3)" aria-hidden />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>
            Total unresolved bugs: <strong style={{ color: 'var(--orange)' }}>{unresolvedBugs.length}</strong>
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--tx-3)', marginLeft: 8 }}>
              — distributed across {DEVS.length} developers
            </span>
          </p>
          <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 3 }}>
            Routing: BACKEND → Junaid · MOBILE → Shaqeeba · WEB → Ramzan · Unrouted → Asif
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
          {stats.routingBreakdown.map(r => {
            const rc = r.routing !== 'Unknown' ? ROUTING_COLORS[r.routing as 'BACKEND' | 'MOBILE' | 'WEB'] : null
            return (
              <div key={r.routing} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: rc?.color || 'var(--tx-3)', lineHeight: 1 }}>{r.count}</p>
                <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600 }}>{r.routing}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Dev cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {devsWithBugs.map(({ dev, bugs: devBugList }) => (
          <DevCard
            key={dev.name}
            dev={dev}
            bugs={devBugList}
            onView={onViewBugs ? () => onViewBugs(dev.routing) : undefined}
          />
        ))}
      </div>

      {/* Team summary table */}
      <div style={{ marginTop: 20, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Team Summary</p>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              {['Developer', 'Total', 'P1', 'P2', 'P3', 'P4', 'No Jira', 'Jira Failed', 'Open'].map(h => (
                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {devsWithBugs.map(({ dev, bugs: db }) => {
              const rc = dev.routing !== 'Unknown' ? ROUTING_COLORS[dev.routing as 'BACKEND' | 'MOBILE' | 'WEB'] : null
              return (
                <tr key={dev.name} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span>{dev.emoji}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>{dev.name}</span>
                      {rc && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: rc.bg, color: rc.color }}>{dev.routing}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 14, fontWeight: 700, color: 'var(--tx-1)' }}>{db.length}</td>
                  {([['P1', 'var(--p1)'], ['P2', 'var(--p2)'], ['P3', 'var(--p3)'], ['P4', 'var(--p4)']] as [string, string][]).map(([sev, col]) => {
                    const cnt = db.filter(b => b.severity === sev).length
                    return <td key={sev} style={{ padding: '8px 12px', fontSize: 13, fontWeight: cnt > 0 ? 700 : 400, color: cnt > 0 ? col : 'var(--tx-3)' }}>{cnt}</td>
                  })}
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tx-2)' }}>{db.filter(b => !b.jira_key && !b.jira_pending).length}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: db.filter(b => b.jira_pending).length > 0 ? 'var(--warning)' : 'var(--tx-3)' }}>
                    {db.filter(b => b.jira_pending).length}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--tx-2)' }}>{db.filter(b => b.status !== 'complete' && b.status !== 'resolved').length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

    </div>
  )
}
