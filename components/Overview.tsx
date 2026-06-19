'use client'

import type { DashboardStats, ParsedBug } from '@/lib/bugUtils'
import { AlertTriangle, TrendingUp, Zap, Info, Smartphone, Globe, Server, Cpu, Cloud, Activity, Database, Package } from 'lucide-react'

interface Props {
  stats: DashboardStats
  bugs: ParsedBug[]
  onNavigateToBugs: (f: Record<string, string[]>) => void
  onNavigateToClusters?: () => void
}

/* ─── Local sub-components ───────────────────────────────── */
function KpiCard({ label, value, sub, color, alert, onClick }: {
  label: string; value: string | number; sub?: string; color?: string; alert?: boolean; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background:'var(--surface-1)',
        border:`1px solid ${alert ? 'rgba(255,123,114,.28)' : 'var(--border)'}`,
        borderRadius:'var(--r-lg)', padding:16,
        boxShadow: alert ? '0 0 0 1px rgba(255,123,114,.08) inset' : 'none',
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'border-color .15s' : undefined,
      }}
    >
      <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>{label}</p>
      <p className="font-brand" style={{ fontSize:28, fontWeight:700, color: color || 'var(--tx-1)', lineHeight:1 }}>{value}</p>
      {sub && <p style={{ fontSize:11, color:'var(--tx-3)', marginTop:5, lineHeight:1.4 }}>{sub}</p>}
    </div>
  )
}

function Section({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom:14 }}>
      <p className="font-brand" style={{ fontWeight:600, fontSize:13, color:'var(--tx-1)' }}>{title}</p>
      {sub && <p style={{ fontSize:11, color:'var(--tx-3)', marginTop:2 }}>{sub}</p>}
    </div>
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ flex:1, height:6, background:'var(--surface-2)', borderRadius:3, overflow:'hidden' }}>
      <div style={{ width:`${max ? (value / max) * 100 : 0}%`, height:'100%', background:color, borderRadius:3, minWidth: value > 0 ? 3 : 0, transition:'width .4s ease' }} aria-hidden />
    </div>
  )
}

function InsightIcon({ type }: { type: string }) {
  const s = 15
  if (type === 'critical') return <AlertTriangle size={s} color="var(--danger)"  aria-hidden />
  if (type === 'warning')  return <TrendingUp    size={s} color="var(--warning)" aria-hidden />
  if (type === 'action')   return <Zap           size={s} color="var(--purple)"  aria-hidden />
  return                          <Info           size={s} color="var(--info)"    aria-hidden />
}

const INSIGHT_BORDER: Record<string, string> = {
  critical: 'rgba(255,123,114,.22)',
  warning:  'rgba(227,179,65,.22)',
  action:   'rgba(163,113,247,.22)',
  info:     'rgba(88,166,255,.18)',
}
const INSIGHT_METRIC: Record<string, string> = {
  critical: 'var(--danger)',
  warning:  'var(--warning)',
  action:   'var(--purple)',
  info:     'var(--info)',
}
const INSIGHT_BG: Record<string, string> = {
  critical: 'rgba(255,123,114,.08)',
  warning:  'rgba(227,179,65,.08)',
  action:   'rgba(163,113,247,.08)',
  info:     'rgba(88,166,255,.08)',
}

/* ─── Main ───────────────────────────────────────────────── */
export default function Overview({ stats, bugs, onNavigateToBugs, onNavigateToClusters }: Props) {
  const dupCount   = bugs.filter(b => b.is_duplicate).length
  const maxDaily   = Math.max(...stats.dailyVolume.map(d => d.total), 1)
  const maxCluster = stats.errorClusters[0]?.count || 1
  const maxVersion = stats.versionBreakdown[0]?.total || 1
  const maxCat     = stats.categoryBreakdown[0]?.count || 1
  const maxHour    = Math.max(...stats.hourlyVolume.map(h => h.count), 1)

  const isIncident = stats.p1count > 0 || (stats.dailyVolume.at(-1)?.total ?? 0) >= 15

  const SEV = { P1:'var(--p1)', P2:'var(--p2)', P3:'var(--p3)', P4:'var(--p4)', none:'var(--surface-3)', unknown:'var(--surface-3)' } as Record<string,string>

  return (
    <div style={{ flex:1, overflowY:'auto', padding:20, display:'flex', flexDirection:'column', gap:18 }}>

      {/* Incident banner */}
      {isIncident && (
        <div role="alert" className="anim-fadeup" style={{
          display:'flex', alignItems:'flex-start', gap:12, padding:'12px 16px',
          background:'rgba(255,123,114,.08)', border:'1px solid rgba(255,123,114,.22)',
          borderRadius:'var(--r-lg)',
        }}>
          <span style={{ fontSize:18, marginTop:1 }} aria-hidden>🚨</span>
          <div style={{ flex:1 }}>
            <p style={{ fontWeight:700, color:'var(--danger)', fontSize:13, marginBottom:3 }}>
              {stats.p1count > 0 ? `${stats.p1count} P1 critical bug${stats.p1count > 1 ? 's' : ''} require immediate attention` : 'Volume spike detected yesterday'}
            </p>
            <p style={{ fontSize:12, color:'var(--tx-2)', lineHeight:1.5 }}>
              {stats.p1count > 0
                ? 'NullPointerException in signUpUser on /users/api/v1/public/users/signup — may be blocking new user registration. See YSC-111, YSC-113.'
                : `${stats.dailyVolume.at(-1)?.total} bugs in one day — ${Math.round((stats.dailyVolume.at(-1)?.total ?? 0) / (stats.total / stats.dailyVolume.length))}× the daily average.`
              }
            </p>
          </div>
          <button
            onClick={() => onNavigateToBugs({ severity: ['P1'] })}
            aria-label="View P1 critical bugs"
            style={{
              background:'rgba(255,123,114,.14)', border:'1px solid rgba(255,123,114,.28)',
              color:'var(--danger)', borderRadius:'var(--r-sm)', padding:'4px 10px',
              fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
            }}
          >
            View P1s →
          </button>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12 }}>
        <KpiCard label="Total Bugs"     value={stats.total}              sub="Jun 10–19" />
        <KpiCard label="P1 Critical"    value={stats.p1count}            sub="fix immediately"           color="var(--p1)"     alert={stats.p1count > 0} />
        <KpiCard label="P2 High"        value={stats.p2count}            sub={`${Math.round(stats.p2count/stats.total*100)}% of total`} color="var(--p2)" />
        <KpiCard label="No Jira Ticket" value={stats.pendingNoJira}      sub="pipeline gap"              color={stats.pendingNoJira > 0 ? 'var(--purple)' : 'var(--tx-1)'} />
        <KpiCard label="Resolved"       value={`${stats.resolvedRate}%`} sub={`${bugs.filter(b=>b.status==='complete').length} complete`} color="var(--success)" />
        <KpiCard label="Needs Review"   value={stats.needsHumanReview}   sub="AI flagged low-confidence" />
        {dupCount > 0 && (
          <KpiCard
            label="Duplicates"
            value={dupCount}
            sub="view in Error Clusters"
            color="var(--info)"
            onClick={onNavigateToClusters}
          />
        )}
      </div>

      {/* Daily chart + distribution */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>

        {/* Daily volume bar chart */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Daily Bug Volume" sub="Stacked by severity · Jun 10–19" />
          <div role="img" aria-label="Stacked bar chart of daily bug volume" style={{ display:'flex', gap:6, alignItems:'flex-end', height:110, marginBottom:10 }}>
            {stats.dailyVolume.map(day => {
              const barH = Math.max(4, (day.total / maxDaily) * 100)
              const segs = [
                { k:'P1', v:day.P1, c:'var(--p1)' }, { k:'P2', v:day.P2, c:'var(--p2)' },
                { k:'P3', v:day.P3, c:'var(--p3)' }, { k:'P4', v:day.P4, c:'var(--p4)' },
                { k:'none', v:day.none, c:'var(--surface-3)' },
              ].filter(s => s.v > 0)
              return (
                <div key={day.date} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <span style={{ fontSize:11, fontWeight:600, color:'var(--tx-2)' }}>{day.total > 0 ? day.total : ''}</span>
                  <div
                    title={`${day.label}: ${day.total} bugs (P1:${day.P1} P2:${day.P2} P3:${day.P3})`}
                    style={{ width:'100%', height:`${barH}px`, display:'flex', flexDirection:'column-reverse', borderRadius:'3px 3px 0 0', overflow:'hidden', minHeight:4 }}
                  >
                    {segs.map((s, i) => (
                      <div key={s.k} style={{ flex:s.v, minHeight:2, background:s.c, borderRadius: i === segs.length-1 ? '3px 3px 0 0' : 0 }} />
                    ))}
                  </div>
                  <span style={{ fontSize:10, color:'var(--tx-3)', writingMode:'vertical-rl', transform:'rotate(180deg)' }}>{day.label}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
            {[['P1','var(--p1)'],['P2','var(--p2)'],['P3','var(--p3)'],['P4 / unclassified','var(--surface-3)']].map(([l,c]) => (
              <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:c }} aria-hidden />
                <span style={{ fontSize:11, color:'var(--tx-3)' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Severity + status distribution */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18, display:'flex', flexDirection:'column', gap:18 }}>
          <Section title="Distribution" />
          <div>
            <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>Severity</p>
            {(['P1','P2','P3','P4'] as const).map(sev => {
              const cnt = bugs.filter(b => b.severity === sev).length
              return (
                <div key={sev} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
                  <span className="font-mono" style={{ width:24, fontSize:11, fontWeight:700, color: SEV[sev] }}>{sev}</span>
                  <Bar value={cnt} max={stats.total} color={SEV[sev]} />
                  <span style={{ width:28, fontSize:11, color:'var(--tx-2)', textAlign:'right' }}>{cnt}</span>
                </div>
              )
            })}
          </div>
          <div>
            <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>Status</p>
            {[['complete','var(--success)'],['pending','var(--warning)'],['triaging','var(--purple)']].map(([s,c]) => {
              const cnt = bugs.filter(b => b.status === s).length
              return (
                <div key={s} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
                  <span style={{ width:52, fontSize:11, color:c, fontWeight:600 }}>{s}</span>
                  <Bar value={cnt} max={stats.total} color={c} />
                  <span style={{ width:28, fontSize:11, color:'var(--tx-2)', textAlign:'right' }}>{cnt}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Error clusters + insights */}
      <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>

        {/* Top clusters */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Top Error Clusters" sub="Unique patterns ranked by frequency" />
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {stats.errorClusters.slice(0, 8).map((c, i) => {
              const sev = c.dominantSeverity || 'unknown'
              const col = SEV[sev] || 'var(--tx-3)'
              const desc = c.description.length > 68 ? c.description.slice(0, 68) + '…' : c.description
              return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ width:20, fontSize:11, color:'var(--tx-3)', textAlign:'right', flexShrink:0, fontFamily:'monospace' }}>#{i+1}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'1px 6px', borderRadius:4, background:col+'16', color:col, border:`1px solid ${col}28`, flexShrink:0 }}>{sev}</span>
                      <span className="font-mono" style={{ fontSize:11, color:'var(--tx-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:300 }}>{desc}</span>
                    </div>
                    <div style={{ height:4, background:'var(--surface-2)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ width:`${(c.count/maxCluster)*100}%`, height:'100%', background:col+'aa', borderRadius:2 }} aria-hidden />
                    </div>
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--tx-1)', width:28, textAlign:'right', flexShrink:0 }} aria-label={`${c.count} reports`}>{c.count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Insight cards */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Section title="Actionable Insights" sub="Auto-derived from your data" />
          {stats.insights.length === 0 && (
            <p style={{ fontSize:13, color:'var(--tx-3)', textAlign:'center', padding:'20px 0' }}>No critical insights detected.</p>
          )}
          {stats.insights.slice(0, 4).map((ins, i) => (
            <div key={i} style={{
              background:'var(--surface-1)', border:`1px solid ${INSIGHT_BORDER[ins.type] || 'var(--border)'}`,
              borderRadius:'var(--r-md)', padding:'11px 13px',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:9 }}>
                <InsightIcon type={ins.type} />
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:12, fontWeight:700, color:'var(--tx-1)', marginBottom:3, lineHeight:1.4 }}>{ins.title}</p>
                  <p style={{ fontSize:11, color:'var(--tx-2)', lineHeight:1.55 }}>{ins.body}</p>
                  <span style={{
                    display:'inline-block', marginTop:6, fontSize:10, fontWeight:700,
                    padding:'2px 7px', borderRadius:10,
                    background: INSIGHT_BG[ins.type], color: INSIGHT_METRIC[ins.type],
                  }}>
                    {ins.metric}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Version + Category + Hours */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>

        {/* Version regression */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="By App Version" sub="P1+P2 = release risk" />
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {stats.versionBreakdown.map(v => {
              const riskColor = v.P1 > 0 ? 'var(--p1)' : (v.P1+v.P2)/v.total > 0.5 ? 'var(--p2)' : 'var(--p3)'
              return (
                <div key={v.version} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span className="font-mono" style={{ fontSize:11, fontWeight:600, color:'var(--tx-1)' }}>{v.version}</span>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      {v.P1 > 0 && <span style={{ fontSize:10, color:'var(--p1)', fontWeight:700 }}>P1:{v.P1}</span>}
                      {v.P2 > 0 && <span style={{ fontSize:10, color:'var(--p2)', fontWeight:700 }}>P2:{v.P2}</span>}
                      <span style={{ fontSize:11, color:'var(--tx-3)' }}>{v.total}</span>
                    </div>
                  </div>
                  <Bar value={v.total} max={maxVersion} color={riskColor} />
                </div>
              )
            })}
          </div>
        </div>

        {/* Category */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="By Category" sub="AI triage classification" />
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {stats.categoryBreakdown.slice(0, 8).map(c => (
              <div key={c.category} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:84, fontSize:11, color:'var(--tx-2)', textTransform:'capitalize', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {c.category.replace(/_/g,' ')}
                </span>
                <Bar value={c.count} max={maxCat} color={c.P1 > 0 ? 'var(--p1)' : c.P2 > 0 ? 'var(--p2)' : 'var(--p3)'} />
                <span style={{ fontSize:11, color:'var(--tx-2)', width:22, textAlign:'right' }}>{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Peak hours */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Peak Hours (UTC)" sub="When bugs arrive — deploy timing" />
          <div role="img" aria-label="Bar chart of bugs by hour UTC" style={{ display:'flex', gap:3, alignItems:'flex-end', height:80, marginBottom:8 }}>
            {stats.hourlyVolume.map(h => (
              <div key={h.hour} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <div
                  title={`${h.hour}:00 UTC — ${h.count} bugs`}
                  style={{
                    width:'100%', height:`${Math.max(3, (h.count/maxHour)*70)}px`,
                    background: h.count === maxHour ? 'var(--orange)' : 'var(--surface-2)',
                    borderRadius:'2px 2px 0 0', transition:'height .3s ease',
                    border: h.count === maxHour ? '1px solid rgba(249,115,22,.35)' : 'none',
                  }}
                />
                <span style={{ fontSize:9, color:'var(--tx-3)' }}>{h.hour}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize:11, color:'var(--tx-3)', lineHeight:1.5 }}>
            Peak at <strong style={{ color:'var(--tx-2)' }}>10:00 UTC</strong> (8pm AEST) — 31 bugs. Activity window: 04:00–14:00 UTC only, matching active user hours.
          </p>

          {/* Rollbar groups */}
          {stats.rollbarGroups.length > 0 && (
            <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--border)' }}>
              <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>Same-root (Rollbar)</p>
              {stats.rollbarGroups.slice(0, 3).map(g => (
                <div key={g.itemId} style={{ display:'flex', alignItems:'flex-start', gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:10, fontWeight:700, color:'var(--danger)', background:'rgba(255,123,114,.10)', padding:'1px 5px', borderRadius:3, flexShrink:0 }}>{g.count}×</span>
                  <div>
                    <p className="font-mono" style={{ fontSize:10, color:'var(--tx-2)', lineHeight:1.4 }}>{g.description.slice(0, 48)}…</p>
                    {g.jiraKeys.length > 0 && <p style={{ fontSize:10, color:'var(--tx-3)' }}>→ {g.jiraKeys.join(', ')}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Affected endpoints */}
      {stats.topPageUrls.length > 0 && (
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Top Affected Endpoints & Pages" sub="Extracted from bug context — highest-impact routes" />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
            {stats.topPageUrls.map((p, i) => {
              const col = SEV[p.maxSeverity] || 'var(--tx-3)'
              return (
                <div key={i} style={{
                  display:'flex', alignItems:'center', gap:8,
                  background:'var(--surface-2)', borderRadius:'var(--r-md)', padding:'8px 10px',
                  border:`1px solid ${p.maxSeverity === 'P1' ? 'rgba(255,123,114,.25)' : 'transparent'}`,
                }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:3, background:col+'16', color:col, border:`1px solid ${col}28`, flexShrink:0 }}>{p.maxSeverity}</span>
                  <span className="font-mono" style={{ fontSize:11, color:'var(--tx-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.url}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--tx-1)', flexShrink:0 }}>{p.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── By Module ─────────────────────────────────────── */}
      {stats.moduleBreakdown.length > 0 && (
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Bugs by Module" sub="Classified by platform and source · WEB · APP · BACKEND · INFRASTRUCTURE" />
          <div style={{ display:'grid', gridTemplateColumns:`repeat(${Math.min(stats.moduleBreakdown.length, 4)},1fr)`, gap:12 }}>
            {stats.moduleBreakdown.map(m => {
              const icons: Record<string,React.ReactNode> = {
                'WEB':           <Globe      size={18} color="var(--module-web)"   aria-hidden />,
                'APP':           <Smartphone size={18} color="var(--module-app)"   aria-hidden />,
                'BACKEND':       <Server     size={18} color="var(--module-be)"    aria-hidden />,
                'INFRASTRUCTURE':<Cpu        size={18} color="var(--module-infra)" aria-hidden />,
              }
              const accent: Record<string,string> = {
                'WEB':'var(--module-web)', 'APP':'var(--module-app)',
                'BACKEND':'var(--module-be)', 'INFRASTRUCTURE':'var(--module-infra)',
              }
              const col = accent[m.module] || 'var(--orange)'
              const hasP1 = m.P1 > 0
              return (
                <div key={m.module} style={{
                  background:'var(--surface-2)', border:`1px solid ${hasP1 ? 'rgba(255,123,114,.25)' : 'var(--border)'}`,
                  borderRadius:'var(--r-lg)', padding:16,
                  boxShadow: hasP1 ? '0 0 0 1px rgba(255,123,114,.08) inset' : 'none',
                }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', textTransform:'uppercase', letterSpacing:'.07em' }}>{m.module}</span>
                    {icons[m.module]}
                  </div>
                  <p className="font-brand" style={{ fontSize:32, fontWeight:800, color:col, lineHeight:1, marginBottom:8 }}>{m.count}</p>
                  <div style={{ height:3, background:'var(--border)', borderRadius:2, marginBottom:10, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${stats.total > 0 ? (m.count/stats.total)*100 : 0}%`, background:col, borderRadius:2, transition:'width .4s' }} />
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    {m.P1 > 0 && <span style={{ fontSize:11, fontWeight:700, color:'var(--p1)' }}>P1: {m.P1}</span>}
                    {m.P2 > 0 && <span style={{ fontSize:11, fontWeight:700, color:'var(--p2)' }}>P2: {m.P2}</span>}
                    {m.P3 > 0 && <span style={{ fontSize:11, color:'var(--p3)' }}>P3: {m.P3}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Environment + Source ──────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* By Environment */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="By Environment" sub="Where bugs are occurring" />
          {stats.environmentBreakdown.length === 0 ? (
            <p style={{ fontSize:12, color:'var(--tx-3)', fontStyle:'italic' }}>No environment data yet</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {stats.environmentBreakdown.map(e => {
                const isProd = e.env.toLowerCase().includes('prod')
                const col = isProd ? 'var(--danger)' : e.env.toLowerCase().includes('staging') ? 'var(--warning)' : 'var(--info)'
                const maxEnv = stats.environmentBreakdown[0].count
                return (
                  <div key={e.env} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background:col, flexShrink:0 }} />
                        <span style={{ fontSize:12, color:'var(--tx-1)', fontWeight: isProd ? 600 : 400 }}>{e.env}</span>
                        {isProd && <span style={{ fontSize:9, color:'var(--danger)', background:'var(--danger-dim)', padding:'1px 5px', borderRadius:10, fontWeight:700 }}>PROD</span>}
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        {e.P1 > 0 && <span style={{ fontSize:11, fontWeight:700, color:'var(--p1)' }}>P1:{e.P1}</span>}
                        {e.P2 > 0 && <span style={{ fontSize:11, fontWeight:700, color:'var(--p2)' }}>P2:{e.P2}</span>}
                        <span style={{ fontSize:12, fontWeight:700, color:'var(--tx-1)', width:28, textAlign:'right' }}>{e.count}</span>
                      </div>
                    </div>
                    <Bar value={e.count} max={maxEnv} color={col} />
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Where complaints come from */}
        <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
          <Section title="Where Complaints Come From" sub="Source breakdown — users, Rollbar, automation" />
          {stats.sourceBreakdown.length === 0 ? (
            <p style={{ fontSize:12, color:'var(--tx-3)', fontStyle:'italic' }}>No source data yet</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
              {stats.sourceBreakdown.map(s => {
                const maxSrc = stats.sourceBreakdown[0].count
                const srcColors: Record<string,string> = {
                  rollbar:'var(--danger)', posthog:'var(--purple)', 'user':'var(--warning)',
                  n8n:'var(--success)', app:'var(--info)', web:'var(--info)',
                }
                const col = srcColors[s.source.toLowerCase()] || 'var(--orange)'
                return (
                  <div key={s.source} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ width:72, fontSize:11, color:'var(--tx-2)', textTransform:'capitalize', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {s.source}
                    </span>
                    <Bar value={s.count} max={maxSrc} color={col} />
                    <span style={{ fontSize:11, color:'var(--tx-2)', width:28, textAlign:'right', flexShrink:0 }}>{s.count}</span>
                    <span style={{ fontSize:10, color:'var(--tx-3)', width:28, textAlign:'right', flexShrink:0 }}>{s.percentage}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Error Type Classification ─────────────────────── */}
      <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
        <Section title="Error Type Classification" sub="AI-detected error patterns across all reports" />
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          {stats.errorTypeBreakdown.map(et => {
            const etColors: Record<string,string> = {
              TypeError:'var(--danger)', NullPointerException:'var(--warning)',
              InvokeException:'var(--purple)', HttpError:'var(--info)',
              ChunkLoadError:'var(--success)', RateLimit:'var(--tx-3)',
              Unimplemented:'var(--purple)', Unknown:'var(--tx-3)',
            }
            const col = etColors[et.type] || 'var(--orange)'
            const pct = stats.total > 0 ? Math.round((et.count/stats.total)*100) : 0
            return (
              <div key={et.type} style={{
                background:'var(--surface-2)', borderRadius:'var(--r-md)',
                padding:'12px 14px', border:'1px solid var(--border)',
              }}>
                <p style={{ fontSize:11, fontWeight:700, color:col, marginBottom:6 }}>{et.type}</p>
                <p className="font-brand" style={{ fontSize:24, fontWeight:800, color:'var(--tx-1)', lineHeight:1, marginBottom:6 }}>{et.count}</p>
                <div style={{ height:3, background:'var(--border)', borderRadius:2, overflow:'hidden', marginBottom:6 }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:col, borderRadius:2 }} />
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:10, color:'var(--tx-3)' }}>{pct}% of total</span>
                  {et.P1 > 0 && <span style={{ fontSize:10, fontWeight:700, color:'var(--p1)' }}>P1:{et.P1}</span>}
                  {et.P2 > 0 && <span style={{ fontSize:10, fontWeight:700, color:'var(--p2)' }}>P2:{et.P2}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Infrastructure (static placeholder) ──────────── */}
      <div style={{ background:'var(--surface-1)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div>
            <p className="font-brand" style={{ fontWeight:600, fontSize:13, color:'var(--tx-1)' }}>Infrastructure</p>
            <p style={{ fontSize:11, color:'var(--tx-3)', marginTop:2 }}>AWS · Cloud services · API integrations — configure in Developer tab</p>
          </div>
          <span style={{ fontSize:11, color:'var(--tx-3)', background:'var(--surface-2)', border:'1px solid var(--border)', padding:'3px 10px', borderRadius:20 }}>
            Pending configuration
          </span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          {([
            { name:'AWS EC2',      icon:<Cpu      size={16} />, desc:'Compute instances',   status:'pending' },
            { name:'CloudWatch',   icon:<Activity size={16} />, desc:'Metrics & logs',       status:'pending' },
            { name:'RDS',          icon:<Database size={16} />, desc:'Database layer',       status:'pending' },
            { name:'S3',           icon:<Package  size={16} />, desc:'Storage & assets',     status:'pending' },
            { name:'Rollbar',      icon:<Cloud    size={16} />, desc:'Error tracking',       status:'awaiting-key' },
            { name:'PostHog',      icon:<Cloud    size={16} />, desc:'Product analytics',    status:'awaiting-key' },
            { name:'n8n',          icon:<Activity size={16} />, desc:'Workflow automation',  status:'awaiting-key' },
            { name:'CloudFront',   icon:<Globe    size={16} />, desc:'CDN & edge',           status:'pending' },
          ] as const).map(svc => (
            <div key={svc.name} style={{
              background:'var(--surface-2)', border:'1px solid var(--border)',
              borderRadius:'var(--r-md)', padding:'10px 12px',
              display:'flex', alignItems:'center', gap:10, opacity: 0.65,
            }}>
              <div style={{ color:'var(--tx-3)', flexShrink:0 }}>{svc.icon}</div>
              <div style={{ minWidth:0 }}>
                <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-2)' }}>{svc.name}</p>
                <p style={{ fontSize:10, color:'var(--tx-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{svc.desc}</p>
              </div>
              <div style={{ marginLeft:'auto', flexShrink:0 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--tx-3)', display:'block' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
