'use client'

import { useMemo, useState } from 'react'
import type { ErrorCluster, ParsedBug } from '@/lib/bugUtils'
import { ROUTING_COLORS } from '@/lib/utils'
import PageInfo from './ui/PageInfo'
import { ChevronDown, ChevronRight, ExternalLink, Sparkles, Copy, CheckCheck, GitMerge, Search, X, Wand2 } from 'lucide-react'

type SortMode = 'count' | 'severity' | 'recent' | 'oldest' | 'component'
const SEV_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3, unknown: 4 }

interface Props {
  clusters: ErrorCluster[]
  onAnalyse: (bugs: ParsedBug[]) => void
  onViewBug: (bug: ParsedBug) => void
  onNavigateToBugs?: (pattern: string) => void
}

const SEV: Record<string, { bg: string; color: string; border: string }> = {
  P1:      { bg: 'var(--p1-dim)',              color: 'var(--p1)',   border: 'rgba(255,123,114,.22)' },
  P2:      { bg: 'var(--p2-dim)',              color: 'var(--p2)',   border: 'rgba(227,179,65,.22)'  },
  P3:      { bg: 'var(--p3-dim)',              color: 'var(--p3)',   border: 'rgba(88,166,255,.22)'  },
  P4:      { bg: 'rgba(139,148,158,.08)',      color: 'var(--p4)',   border: 'rgba(139,148,158,.22)' },
  unknown: { bg: 'var(--surface-2)',           color: 'var(--tx-3)', border: 'var(--border)'         },
}

const ET_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  TypeError:           { bg: 'rgba(255,123,114,.10)', color: 'var(--danger)',  label: 'TypeError'     },
  NullPointerException:{ bg: 'rgba(227,179,65,.10)',  color: 'var(--warning)', label: 'NullPtr'       },
  InvokeException:     { bg: 'rgba(163,113,247,.10)', color: 'var(--purple)',  label: 'Jersey/Invoke' },
  HttpError:           { bg: 'rgba(88,166,255,.10)',  color: 'var(--info)',    label: 'HttpError'     },
  ChunkLoadError:      { bg: 'rgba(63,185,80,.10)',   color: 'var(--success)', label: 'ChunkLoad'     },
  RateLimit:           { bg: 'rgba(139,148,158,.10)', color: 'var(--tx-3)',    label: 'RateLimit'     },
  Unimplemented:       { bg: 'rgba(163,113,247,.10)', color: 'var(--purple)',  label: 'Unimplemented' },
  Unknown:             { bg: 'var(--surface-2)',       color: 'var(--tx-3)',   label: 'Unknown'       },
}

const STATUS_COLOR: Record<string, string> = {
  complete: 'var(--success)', pending: 'var(--warning)', triaging: 'var(--purple)', unknown: 'var(--tx-3)',
}

function MiniSevBar({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  if (!total) return null
  const keys = Object.keys(data).filter(k => data[k] > 0)
  return (
    <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', width: 72, gap: 1, flexShrink: 0 }}>
      {keys.map(k => (
        <div key={k} style={{ flex: data[k], background: (SEV[k] || SEV.unknown).color + 'cc', minWidth: 2 }} title={`${k}: ${data[k]}`} />
      ))}
    </div>
  )
}

function ClusterCard({ cluster, rank, onAnalyse, onViewBug, onNavigateToBugs }: {
  cluster: ErrorCluster; rank: number; onAnalyse: (bugs: ParsedBug[]) => void; onViewBug: (bug: ParsedBug) => void
  onNavigateToBugs?: (pattern: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const domSev = cluster.dominantSeverity || 'unknown'
  const sevStyle = SEV[domSev] || SEV.unknown
  const isUrgent = domSev === 'P1' || domSev === 'P2'
  const errType = cluster.bugs[0]?.errorType || 'Unknown'
  const errBadge = ET_BADGE[errType] || ET_BADGE.Unknown
  const isProd = cluster.environments.includes('production')
  const fmtDate = (s: string) => s ? s.slice(0, 10) : '—'
  const domRouting = cluster.routingTokens[0] as 'BACKEND' | 'MOBILE' | 'WEB' | undefined
  const routeStyle = domRouting ? ROUTING_COLORS[domRouting] : null

  const copyKey = () => {
    navigator.clipboard.writeText(cluster.description).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{
      background: 'var(--surface-1)',
      border: `1px solid ${expanded ? 'var(--border-hi)' : isUrgent ? sevStyle.border : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      flexShrink: 0,
      boxShadow: isUrgent && !expanded ? `0 0 0 1px ${sevStyle.color}18 inset` : 'none',
      transition: 'border-color .15s',
    }}>
      {/* ── Card header — always visible ── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpanded(v => !v)}
        onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'var(--hover)' }}
        onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = '' }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '12px 14px',
          cursor: 'pointer',
          background: expanded ? 'var(--surface-2)' : '',
          transition: 'background .12s',
          outline: 'none',
        }}
      >
        {/* Expand chevron */}
        <div style={{ paddingTop: 15, flexShrink: 0, color: 'var(--tx-3)' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </div>

        {/* Severity / count badge */}
        <div style={{
          flexShrink: 0,
          width: 54,
          borderRadius: 'var(--r-md)',
          background: sevStyle.bg,
          border: `1px solid ${sevStyle.border}`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '8px 4px', gap: 1,
        }}>
          <span className="font-brand" style={{ fontSize: 24, fontWeight: 800, color: sevStyle.color, lineHeight: 1 }}>
            {cluster.count}
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, color: sevStyle.color + 'cc', letterSpacing: '.05em' }}>
            {domSev}
          </span>
          {cluster.count > 1 && (
            <span style={{ fontSize: 8, color: sevStyle.color + 'aa', display: 'flex', alignItems: 'center', gap: 2 }}>
              <GitMerge size={7} /> dupes
            </span>
          )}
        </div>

        {/* ── Content area — fills remaining space ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Badges row */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              background: errBadge.bg, color: errBadge.color, flexShrink: 0,
            }}>
              {errBadge.label}
            </span>
            {routeStyle && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: routeStyle.bg, color: routeStyle.color, border: `1px solid ${routeStyle.border}`, flexShrink: 0 }}>
                {domRouting}
              </span>
            )}
            {cluster.topComponent && (
              <span style={{ fontSize: 10, color: 'var(--tx-3)', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', flexShrink: 0 }}>
                {cluster.topComponent}
              </span>
            )}
            {isProd && (
              <span style={{
                fontSize: 10, color: 'var(--danger)', background: 'rgba(248,81,73,.10)',
                padding: '2px 6px', borderRadius: 3, flexShrink: 0,
              }}>
                🔴 prod
              </span>
            )}
            {!isProd && cluster.environments.length > 0 && (
              <span style={{
                fontSize: 10, color: 'var(--tx-3)', background: 'var(--surface-2)',
                padding: '2px 6px', borderRadius: 3, flexShrink: 0,
              }}>
                {cluster.environments[0]}
              </span>
            )}
            {cluster.rollbarIds.length > 0 && (
              <span style={{
                fontSize: 10, color: 'var(--info)', background: 'rgba(88,166,255,.10)',
                padding: '2px 6px', borderRadius: 3, flexShrink: 0,
              }}>
                Rollbar ×{cluster.rollbarIds.length}
              </span>
            )}
            {cluster.occurrenceTotal > cluster.count && (
              <span style={{
                fontSize: 10, color: 'var(--purple)', background: 'rgba(163,113,247,.10)',
                padding: '2px 6px', borderRadius: 3, flexShrink: 0,
              }}>
                ~{cluster.occurrenceTotal} occurrences
              </span>
            )}
          </div>

          {/* Description — 2 lines max */}
          <p className="font-mono" style={{
            fontSize: 12, color: 'var(--tx-1)', lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', wordBreak: 'break-all', margin: '0 0 6px',
          }}>
            {cluster.description}
          </p>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
              #{rank}
            </span>
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
              {Object.keys(cluster.versions).length} version{Object.keys(cluster.versions).length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
              first {fmtDate(cluster.firstSeen)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>
              last {fmtDate(cluster.lastSeen)}
            </span>
            {cluster.modules.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--info)' }}>
                {cluster.modules.join(' · ')}
              </span>
            )}
          </div>
        </div>

        {/* ── Right column — actions ── */}
        <div style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column',
          gap: 6, alignItems: 'flex-end', minWidth: 96,
        }}>
          {/* Severity bar */}
          <MiniSevBar data={cluster.severities} />
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {Object.entries(cluster.severities).filter(([, v]) => v > 0).map(([sev, cnt]) => {
              const s = SEV[sev] || SEV.unknown
              return (
                <span key={sev} style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                  background: s.bg, color: s.color,
                }}>
                  {sev}:{cnt}
                </span>
              )
            })}
          </div>

          {/* Jira keys */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {cluster.jiraKeys.slice(0, 2).map(k => (
              <a
                key={k}
                href={`https://yuzeeau.atlassian.net/browse/${k}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 10, fontWeight: 700, color: 'var(--info)', textDecoration: 'none',
                }}
              >
                <span className="font-mono">{k}</span>
                <ExternalLink size={8} />
              </a>
            ))}
            {cluster.jiraKeys.length > 2 && (
              <span style={{ fontSize: 9, color: 'var(--tx-3)' }}>+{cluster.jiraKeys.length - 2} more</span>
            )}
            {cluster.jiraKeys.length === 0 && (
              <span style={{
                fontSize: 10, color: 'var(--warning)', background: 'var(--p2-dim)',
                padding: '2px 6px', borderRadius: 4, textAlign: 'center',
              }}>
                no Jira
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {onNavigateToBugs && (
              <button
                onClick={e => { e.stopPropagation(); onNavigateToBugs(cluster.normalizedKey.slice(0, 40)) }}
                aria-label={`View ${cluster.count} bugs for this cluster`}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '5px 9px', fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', cursor: 'pointer', transition: 'all .15s' }}
              >
                View {cluster.count} →
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); copyKey() }}
              aria-label="Copy error message"
              title="Copy error message"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '5px 7px', color: 'var(--tx-3)', display: 'flex', alignItems: 'center', cursor: 'pointer', transition: 'all .15s' }}
            >
              {copied ? <CheckCheck size={11} color="var(--success)" /> : <Copy size={11} />}
            </button>
            <button
              onClick={e => { e.stopPropagation(); onAnalyse(cluster.bugs) }}
              aria-label="Run AI analysis on this cluster"
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--purple-dim)', border: '1px solid rgba(163,113,247,.25)', borderRadius: 'var(--r-sm)', padding: '5px 9px', fontSize: 11, fontWeight: 600, color: 'var(--purple)', cursor: 'pointer', transition: 'all .15s' }}
            >
              <Sparkles size={11} /> AI
            </button>
          </div>
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          {/* Cluster meta */}
          <div style={{
            padding: '12px 16px 10px',
            display: 'flex', gap: 24, flexWrap: 'wrap',
            borderBottom: '1px solid var(--border)',
          }}>
            <div>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                Affected Versions
              </p>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--tx-2)' }}>
                {Object.entries(cluster.versions).sort(([, a], [, b]) => b - a).map(([v, c]) => `${v} (${c})`).join(', ') || '—'}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                Components
              </p>
              <p style={{ fontSize: 11, color: 'var(--tx-2)' }}>{cluster.components.join(', ') || '—'}</p>
            </div>
            <div>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                Environments
              </p>
              <p style={{ fontSize: 11, color: 'var(--tx-2)' }}>{cluster.environments.join(', ') || '—'}</p>
            </div>
            <div>
              <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                Status Split
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.entries(cluster.statuses).map(([s, c]) => (
                  <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--tx-2)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[s] || 'var(--tx-3)', flexShrink: 0 }} />
                    {s}: {c}
                  </span>
                ))}
              </div>
            </div>
            {cluster.rollbarIds.length > 0 && (
              <div>
                <p style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                  Rollbar IDs
                </p>
                <p className="font-mono" style={{ fontSize: 11, color: 'var(--info)' }}>{cluster.rollbarIds.join(', ')}</p>
              </div>
            )}
          </div>

          {/* Individual reports */}
          <div>
            <p style={{
              fontSize: 10, color: 'var(--tx-3)', fontWeight: 600,
              letterSpacing: '.06em', textTransform: 'uppercase',
              padding: '8px 16px 4px',
            }}>
              {cluster.count} Grouped Report{cluster.count !== 1 ? 's' : ''}
            </p>
            {cluster.bugs.map((bug, i) => (
              <div
                key={bug.report_id}
                onClick={() => onViewBug(bug)}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-1)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 16px',
                  borderTop: '1px solid var(--border)',
                  cursor: 'pointer', transition: 'background .1s',
                }}
              >
                <span style={{ fontSize: 10, color: 'var(--tx-3)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>

                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                  background: (SEV[bug.severity || 'unknown'] || SEV.unknown).bg,
                  color: (SEV[bug.severity || 'unknown'] || SEV.unknown).color,
                }}>
                  {bug.severity || '??'}
                </span>

                {bug.is_duplicate && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: 'rgba(163,113,247,.15)', color: 'var(--purple)', flexShrink: 0,
                  }}>
                    DUPLICATE
                  </span>
                )}

                {bug.jira_key ? (
                  <a
                    href={bug.jira_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--info)',
                      textDecoration: 'none', flexShrink: 0,
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    <span className="font-mono">{bug.jira_key}</span>
                    <ExternalLink size={9} />
                  </a>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--warning)', flexShrink: 0 }}>no Jira</span>
                )}

                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_COLOR[bug.status || 'unknown'], flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{bug.status}</span>
                </span>

                <span className="font-mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>{bug.app_version}</span>
                <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>{bug.created_at.slice(0, 10)}</span>

                {bug.environment && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 3,
                    color: bug.environment === 'production' ? 'var(--danger)' : 'var(--tx-3)',
                    background: bug.environment === 'production' ? 'var(--danger-dim)' : 'var(--surface-1)',
                  }}>
                    {bug.environment}
                  </span>
                )}

                <div style={{ flex: 1 }} />
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>{bug.report_id.slice(-8)}</span>
                <span style={{ fontSize: 10, color: 'var(--orange)' }}>view →</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BugClusters({ clusters, onAnalyse, onViewBug, onNavigateToBugs }: Props) {
  const [clusterFilter, setClusterFilter] = useState<'all' | 'unresolved' | 'no-jira' | 'production'>('all')
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string[]>([])
  const [routingFilter, setRoutingFilter] = useState<string[]>([])
  const [componentFilter, setComponentFilter] = useState('all')
  const [sortBy, setSortBy] = useState<SortMode>('count')
  const [inferring, setInferring] = useState(false)
  const [inferResult, setInferResult] = useState<{ updatedComponent: number; updatedCategory: number; skipped: number } | null>(null)

  const unknownCount = useMemo(() =>
    clusters.filter(c => !c.routingTokens.length || !c.topComponent).length
  , [clusters])

  async function handleFixUnknowns() {
    setInferring(true)
    setInferResult(null)
    try {
      const res = await fetch('/api/update-components', { method: 'POST' })
      const json = await res.json()
      setInferResult(json)
    } catch {
      setInferResult(null)
    } finally {
      setInferring(false)
    }
  }

  const componentOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of clusters) if (c.topComponent) set.add(c.topComponent)
    return [...set].sort()
  }, [clusters])

  const toggleSeverity = (s: string) => setSeverityFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  const toggleRouting = (r: string) => setRoutingFilter(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])

  const filtered = useMemo(() => {
    let r = clusters.filter(c => {
      if (clusterFilter === 'unresolved' && !Object.entries(c.statuses).some(([s, n]) => s !== 'complete' && n > 0)) return false
      if (clusterFilter === 'no-jira' && c.jiraKeys.length > 0) return false
      if (clusterFilter === 'production' && !c.environments.includes('production')) return false
      if (search && !c.description.toLowerCase().includes(search.toLowerCase())) return false
      if (severityFilter.length && !severityFilter.includes(c.dominantSeverity || 'unknown')) return false
      if (routingFilter.length && !c.routingTokens.some(t => routingFilter.includes(t))) return false
      if (componentFilter !== 'all' && c.topComponent !== componentFilter) return false
      return true
    })
    r = [...r].sort((a, b) => {
      switch (sortBy) {
        case 'severity':  return (SEV_RANK[a.dominantSeverity || 'unknown'] ?? 5) - (SEV_RANK[b.dominantSeverity || 'unknown'] ?? 5)
        case 'recent':    return (b.lastSeen || '').localeCompare(a.lastSeen || '')
        case 'oldest':    return (a.firstSeen || '').localeCompare(b.firstSeen || '')
        case 'component': return (a.topComponent || '').localeCompare(b.topComponent || '')
        default:          return b.count - a.count
      }
    })
    return r
  }, [clusters, clusterFilter, search, severityFilter, routingFilter, componentFilter, sortBy])

  const activeFilterCount = (search ? 1 : 0) + severityFilter.length + routingFilter.length + (componentFilter !== 'all' ? 1 : 0)
  const clearAllFilters = () => { setSearch(''); setSeverityFilter([]); setRoutingFilter([]); setComponentFilter('all') }

  const totalBugs  = clusters.reduce((a, c) => a + c.count, 0)
  const dupeGroups = clusters.filter(c => c.count > 1)
  const dupeBugs   = dupeGroups.reduce((a, c) => a + c.count, 0)

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 18px 0' }}>
        <PageInfo storageKey="clusters">
          Bugs are automatically grouped by a normalized version of their error message, so the same underlying
          failure shows up once instead of dozens of times. Filter and sort to find what&apos;s breaking most often,
          then click &quot;View N →&quot; to jump to those exact bugs.
        </PageInfo>
      </div>

      {/* Advanced filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 18px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-1)', flexShrink: 0,
      }}>
        <div style={{ position: 'relative', minWidth: 200 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--tx-3)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search error pattern…"
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '5px 10px 5px 26px', fontSize: 12, color: 'var(--tx-1)', boxSizing: 'border-box' }}
          />
        </div>

        <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.06em' }}>SEV</span>
        {(['P1', 'P2', 'P3', 'P4'] as const).map(s => {
          const active = severityFilter.includes(s)
          const col = SEV[s].color
          return (
            <button key={s} onClick={() => toggleSeverity(s)} style={{
              padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700,
              background: active ? col + '22' : 'var(--surface-2)', color: active ? col : 'var(--tx-2)',
              border: `1px solid ${active ? col + '66' : 'var(--border)'}`, cursor: 'pointer',
            }}>{s}</button>
          )
        })}

        <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.06em', marginLeft: 4 }}>ROUTING</span>
        {(['BACKEND', 'MOBILE', 'WEB'] as const).map(rt => {
          const active = routingFilter.includes(rt)
          const rc = ROUTING_COLORS[rt]
          return (
            <button key={rt} onClick={() => toggleRouting(rt)} style={{
              padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              background: active ? rc.bg : 'var(--surface-2)', color: active ? rc.color : 'var(--tx-2)',
              border: `1px solid ${active ? rc.border : 'var(--border)'}`, cursor: 'pointer',
            }}>{rt}</button>
          )
        })}

        {componentOptions.length > 0 && (
          <select value={componentFilter} onChange={e => setComponentFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
            <option value="all">All components</option>
            {componentOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.06em', marginLeft: 4 }}>SORT</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortMode)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
          <option value="count">Most reports</option>
          <option value="severity">Highest severity</option>
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
          <option value="component">Component (A–Z)</option>
        </select>

        {activeFilterCount > 0 && (
          <button onClick={clearAllFilters} style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '3px 9px', cursor: 'pointer' }}>
            <X size={11} /> Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface-1)', flexShrink: 0, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--tx-2)' }}>
            <strong className="font-brand" style={{ color: 'var(--tx-1)' }}>{clusters.length}</strong> unique error patterns ·{' '}
            <strong style={{ color: 'var(--tx-1)' }}>{totalBugs}</strong> total reports
          </span>
          {dupeGroups.length > 0 && (
            <span style={{
              fontSize: 12, color: 'var(--warning)', background: 'var(--p2-dim)',
              padding: '2px 10px', borderRadius: 12, border: '1px solid rgba(227,179,65,.2)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <GitMerge size={11} />
              {dupeGroups.length} duplicate group{dupeGroups.length !== 1 ? 's' : ''} ({dupeBugs} reports merged)
            </span>
          )}
          {unknownCount > 0 && (
            <button
              onClick={handleFixUnknowns}
              disabled={inferring}
              title={`${unknownCount} clusters have no routing or component — click to infer from existing data`}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600,
                background: inferring ? 'var(--surface-2)' : 'rgba(163,113,247,.12)',
                color: inferring ? 'var(--tx-3)' : 'var(--purple)',
                border: '1px solid rgba(163,113,247,.3)',
                borderRadius: 'var(--r-sm)', padding: '3px 10px', cursor: inferring ? 'default' : 'pointer',
              }}
            >
              <Wand2 size={11} />
              {inferring ? 'Inferring…' : `Fix ${unknownCount} unknown${unknownCount !== 1 ? 's' : ''}`}
            </button>
          )}
          {inferResult && (
            <span style={{ fontSize: 11, color: 'var(--success)' }}>
              ✓ {inferResult.updatedComponent} component{inferResult.updatedComponent !== 1 ? 's' : ''} · {inferResult.updatedCategory} categor{inferResult.updatedCategory !== 1 ? 'ies' : 'y'} updated · {inferResult.skipped} skipped
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all', 'unresolved', 'production', 'no-jira'] as const).map(val => (
            <button
              key={val}
              onClick={() => setClusterFilter(val)}
              style={{
                padding: '4px 11px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: clusterFilter === val ? 'var(--orange)' : 'var(--surface-2)',
                color: clusterFilter === val ? '#fff' : 'var(--tx-2)',
                border: `1px solid ${clusterFilter === val ? 'var(--orange)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all .15s', textTransform: 'capitalize',
              }}
            >
              {val === 'no-jira' ? 'No Jira' : val.charAt(0).toUpperCase() + val.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{
        display: 'flex', gap: 20, padding: '8px 18px',
        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          🎯 Top error: <strong style={{ color: 'var(--tx-1)' }}>{clusters[0]?.count ?? 0}</strong> reports
          {totalBugs > 0 && ` (${Math.round(((clusters[0]?.count || 0) / totalBugs) * 100)}%)`}
        </span>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          🔗 No Jira: <strong style={{ color: 'var(--warning)' }}>{clusters.filter(c => c.jiraKeys.length === 0).length}</strong> clusters
        </span>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          🔴 P1 clusters: <strong style={{ color: 'var(--danger)' }}>{clusters.filter(c => (c.severities['P1'] || 0) > 0).length}</strong>
        </span>
        <span style={{ fontSize: 12, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <GitMerge size={11} /> Duplicates saved: <strong style={{ color: 'var(--tx-1)' }}>{dupeBugs - dupeGroups.length}</strong> consolidations
        </span>
      </div>

      {/* Cluster list */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {filtered.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 200, gap: 8, color: 'var(--tx-3)',
          }}>
            <GitMerge size={28} />
            <p style={{ fontSize: 14 }}>No clusters match this filter</p>
          </div>
        ) : (
          filtered.map((cluster, i) => (
            <ClusterCard
              key={cluster.normalizedKey || cluster.description}
              cluster={cluster}
              rank={i + 1}
              onAnalyse={onAnalyse}
              onViewBug={onViewBug}
              onNavigateToBugs={onNavigateToBugs}
            />
          ))
        )}
      </div>
    </div>
  )
}
