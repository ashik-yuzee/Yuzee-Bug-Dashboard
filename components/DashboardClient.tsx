'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logoutAction } from '@/app/actions/auth'
import { parseBug, computeStats } from '@/lib/bugUtils'
import toast from '@/lib/toast'
import { useRealtimeBugs } from '@/hooks/useRealtimeBugs'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import FilterSidebar from './FilterSidebar'
import BugTable from './BugTable'
import Overview from './Overview'
import BugClusters from './BugClusters'
import DeveloperView from './DeveloperView'
import AIAnalysisPanel from './AIAnalysisPanel'
import BugDetailModal from './BugDetailModal'
import {
  Bug, LogOut, RefreshCw, Sparkles, SlidersHorizontal,
  BarChart3, List, Layers, WifiOff, Radio, Bell, Code2, FileText
} from 'lucide-react'
import Reports from './Reports'

export type BugReport = {
  report_id: string; source: string | null; reporter_email: string | null
  description: string | null; platform: string | null; app_version: string | null
  severity: string | null; ai_summary: string | null; jira_key: string | null
  jira_url: string | null; status: string | null; created_at: string
  full_data: string | null; category: string | null; location: string | null
  when: string | null; frequency: string | null; anything_else: string | null
  labels: string | null; component: string | null; confidence: number | null
  is_duplicate: boolean | null; triaged_at: string | null; screenshot_url: string | null
  jira_pending: boolean | null; retry_count: number | null
}

export type Filters = {
  search: string; severity: string[]; status: string[]; category: string[]
  platform: string[]; source: string[]; component: string[]; errorType: string[]
  environment: string[]; module: string[]; isDuplicate: string; dateFrom: string; dateTo: string
}

export type SortConfig = { key: keyof BugReport; dir: 'asc' | 'desc' }
type Tab = 'overview' | 'bugs' | 'clusters' | 'developer' | 'reports'

const BLANK_FILTERS: Filters = {
  search: '', severity: [], status: [], category: [], platform: [],
  source: [], component: [], errorType: [], environment: [], module: [],
  isDuplicate: 'all', dateFrom: '', dateTo: ''
}

interface AdminUser { email: string }
interface Props { user: AdminUser; initialBugs: BugReport[] }

/* ─── Styles ─────────────────────────────────────────────── */
const S = {
  root: { display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--bg)' } as const,
  header: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'0 18px', height:52, flexShrink:0,
    background:'var(--surface-1)', borderBottom:'1px solid var(--border)',
  } as const,
  logo: { display:'flex', alignItems:'center', gap:8 } as const,
  logoMark: {
    width:28, height:28, borderRadius:'var(--r-sm)',
    background:'var(--orange)', display:'flex', alignItems:'center', justifyContent:'center'
  } as const,
  nav: { display:'flex', gap:2 } as const,
  headerRight: { display:'flex', alignItems:'center', gap:8 } as const,
  divider: { width:1, height:20, background:'var(--border)', margin:'0 2px' } as const,
  body: { display:'flex', flex:1, overflow:'hidden' } as const,
}

export default function DashboardClient({ user, initialBugs }: Props) {
  const supabase = createClient()
  const { online } = useNetworkStatus()
  const { newBugs, status: rtStatus, clearNewBugs } = useRealtimeBugs()

  const [bugs, setBugs] = useState<BugReport[]>(initialBugs)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Filters>(BLANK_FILTERS)
  const [sort, setSort] = useState<SortConfig>({ key: 'created_at', dir: 'desc' })
  const [showFilters, setShowFilters] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [detailBug, setDetailBug] = useState<BugReport | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const prevOnline = useRef<boolean | null>(null)

  // Network recovery: auto-refresh when coming back online
  useEffect(() => {
    if (online === true && prevOnline.current === false) {
      toast.info('Connection restored', 'Refreshing bug reports…')
      handleRefresh()
    }
    if (online === false && prevOnline.current !== false) {
      toast.warning('You are offline', 'Data may be stale. Changes will resume when reconnected.')
    }
    prevOnline.current = online
  }, [online])


  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    const tid = toast.loading('Refreshing bug reports…')
    try {
      const { data, error } = await supabase
        .from('bug_reports')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setBugs(data || [])
      clearNewBugs()
      toast.dismiss(tid)
      toast.success('Data refreshed', `${data?.length ?? 0} reports loaded`)
    } catch (err) {
      toast.dismiss(tid)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('429') || msg.includes('rate'))
        toast.error('Supabase rate limit', 'Too many requests. Wait a moment and try again.', 10_000)
      else if (!navigator.onLine)
        toast.warning('Offline', 'Cannot refresh while disconnected.')
      else
        toast.error('Refresh failed', msg)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const handleSignOut = () => logoutAction()

  // Absorb real-time new bugs
  const handleAbsorbNew = useCallback(() => {
    setBugs(prev => {
      const existingIds = new Set(prev.map(b => b.report_id))
      const fresh = newBugs.filter(b => !existingIds.has(b.report_id))
      return [...fresh, ...prev]
    })
    clearNewBugs()
    toast.success(`${newBugs.length} new bug${newBugs.length > 1 ? 's' : ''} added`)
  }, [newBugs])

  const parsedBugs = useMemo(() => bugs.map(parseBug), [bugs])
  const stats = useMemo(() => computeStats(parsedBugs), [parsedBugs])

  const filtered = useMemo(() => {
    let r = [...parsedBugs]
    const { search, severity, status, category, platform, source,
            component, errorType, environment, module, isDuplicate, dateFrom, dateTo } = filters
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(b =>
        b.description?.toLowerCase().includes(q) ||
        b.jira_key?.toLowerCase().includes(q) ||
        b.report_id.toLowerCase().includes(q) ||
        b.ai_summary?.toLowerCase().includes(q) ||
        b.component?.toLowerCase().includes(q) ||
        b.category?.toLowerCase().includes(q)
      )
    }
    if (severity.length)    r = r.filter(b => b.severity    && severity.includes(b.severity))
    if (status.length)      r = r.filter(b => b.status      && status.includes(b.status))
    if (category.length)    r = r.filter(b => b.category    && category.includes(b.category))
    if (platform.length)    r = r.filter(b => b.platform    && platform.includes(b.platform))
    if (source.length)      r = r.filter(b => b.source      && source.includes(b.source))
    if (component.length)   r = r.filter(b => b.component   && component.includes(b.component))
    if (errorType.length)   r = r.filter(b => errorType.includes(b.errorType))
    if (environment.length) r = r.filter(b => b.environment && environment.includes(b.environment))
    if (module.length)      r = r.filter(b => module.includes(b.module))
    if (isDuplicate === 'yes') r = r.filter(b => b.is_duplicate)
    if (isDuplicate === 'no')  r = r.filter(b => !b.is_duplicate)
    if (dateFrom) r = r.filter(b => new Date(b.created_at) >= new Date(dateFrom))
    if (dateTo)   r = r.filter(b => new Date(b.created_at) <= new Date(dateTo + 'T23:59:59'))
    r.sort((a, b) => {
      const av = String(a[sort.key as keyof typeof a] ?? '')
      const bv = String(b[sort.key as keyof typeof b] ?? '')
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return r
  }, [parsedBugs, filters, sort])

  const selectedBugs = useMemo(() => filtered.filter(b => selected.has(b.report_id)), [filtered, selected])

  const toggleSelect  = useCallback((id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const selectAll     = useCallback(() => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(b => b.report_id)))
  }, [filtered, selected.size])
  const clearFilters  = useCallback(() => setFilters(BLANK_FILTERS), [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const activeFilterCount = useMemo(() => [
    filters.search,
    ...filters.severity, ...filters.status, ...filters.category,
    ...filters.platform, ...filters.source, ...filters.component,
    ...filters.errorType, ...filters.environment, ...filters.module,
    filters.isDuplicate !== 'all' ? '1' : '',
    filters.dateFrom, filters.dateTo,
  ].filter(Boolean).length, [filters])

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview',   label: 'Overview',       icon: <BarChart3 size={14} aria-hidden /> },
    { id: 'bugs',       label: 'All Bugs',        icon: <List      size={14} aria-hidden />, badge: bugs.length },
    { id: 'clusters',   label: 'Error Clusters',  icon: <Layers    size={14} aria-hidden />, badge: stats.errorClusters.length },
    { id: 'developer',  label: 'Developer',       icon: <Code2     size={14} aria-hidden /> },
    { id: 'reports',    label: 'Reports',          icon: <FileText  size={14} aria-hidden /> },
  ]

  return (
    <div style={S.root}>
      {/* Offline banner */}
      {online === false && (
        <div role="alert" style={{
          display:'flex', alignItems:'center', gap:8, padding:'7px 18px',
          background:'rgba(227,179,65,.10)', borderBottom:'1px solid rgba(227,179,65,.25)',
          fontSize:13, color:'var(--warning)', flexShrink:0,
        }}>
          <WifiOff size={14} aria-hidden /> You are offline. Data may be stale.
        </div>
      )}

      {/* New bugs banner */}
      {newBugs.length > 0 && (
        <div style={{
          display:'flex', alignItems:'center', gap:10, padding:'7px 18px',
          background:'rgba(88,166,255,.08)', borderBottom:'1px solid rgba(88,166,255,.20)',
          flexShrink:0,
        }} role="status" aria-live="polite">
          <Bell size={13} color="var(--info)" aria-hidden />
          <span style={{ fontSize:13, color:'var(--info)', fontWeight:500 }}>
            {newBugs.length} new bug{newBugs.length > 1 ? 's' : ''} recorded
          </span>
          <button onClick={handleAbsorbNew} style={{
            fontSize:12, fontWeight:600, color:'var(--info)',
            background:'rgba(88,166,255,.15)', border:'1px solid rgba(88,166,255,.30)',
            borderRadius:'var(--r-sm)', padding:'2px 10px', cursor:'pointer',
          }}>
            Load now
          </button>
          <button onClick={clearNewBugs} aria-label="Dismiss new bug notification"
            style={{ marginLeft:'auto', background:'none', color:'var(--tx-3)', fontSize:12, cursor:'pointer' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={S.logo}>
            <div style={S.logoMark} aria-hidden>
              <Bug size={15} color="#fff" />
            </div>
            <span className="font-brand" style={{ fontWeight:700, fontSize:15, color:'var(--tx-1)' }}>
              Yuzee Bug Dashboard
            </span>
          </div>

          {/* Realtime indicator */}
          <span title={`Realtime: ${rtStatus}`} aria-label={`Live updates: ${rtStatus}`} style={{
            display:'flex', alignItems:'center', gap:5, fontSize:11, color:'var(--tx-3)',
          }}>
            <Radio size={11} color={rtStatus === 'connected' ? 'var(--success)' : rtStatus === 'error' ? 'var(--danger)' : 'var(--tx-3)'} aria-hidden />
            <span style={{ display:'none' }}>{rtStatus}</span>
          </span>

          {/* Tab navigation */}
          <nav aria-label="Dashboard sections" style={S.nav}>
            {tabs.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display:'flex', alignItems:'center', gap:6,
                    padding:'5px 11px', borderRadius:'var(--r-sm)',
                    background: active ? 'var(--orange-dim)' : 'transparent',
                    color: active ? 'var(--orange)' : 'var(--tx-3)',
                    fontSize:13, fontWeight: active ? 600 : 400,
                    border: active ? '1px solid rgba(249,115,22,.20)' : '1px solid transparent',
                    transition:'all .15s', cursor:'pointer',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span style={{
                      fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:10,
                      background: active ? 'var(--orange)' : 'var(--surface-2)',
                      color: active ? '#fff' : 'var(--tx-3)',
                    }} aria-hidden>
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        <div style={S.headerRight}>
          {/* AI analysis button */}
          {selected.size > 0 && (
            <button
              onClick={() => setShowAI(true)}
              aria-label={`Analyse ${selected.size} selected bug${selected.size > 1 ? 's' : ''} with Gemini AI`}
              style={{
                display:'flex', alignItems:'center', gap:6,
                background:'linear-gradient(135deg,#8b5cf6,#6d28d9)',
                color:'#fff', borderRadius:'var(--r-md)',
                padding:'6px 13px', fontSize:13, fontWeight:600,
                transition:'opacity .15s', border:'none',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.88'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              <Sparkles size={13} aria-hidden />
              Analyse {selected.size} with AI
            </button>
          )}

          {/* Filter toggle (bugs tab only) */}
          {activeTab === 'bugs' && (
            <button
              onClick={() => setShowFilters(v => !v)}
              aria-label={`${showFilters ? 'Hide' : 'Show'} filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
              aria-pressed={showFilters}
              style={{
                display:'flex', alignItems:'center', gap:6,
                background: showFilters ? 'var(--orange-dim)' : 'var(--surface-2)',
                color: showFilters ? 'var(--orange)' : 'var(--tx-2)',
                border:`1px solid ${showFilters ? 'rgba(249,115,22,.25)' : 'var(--border)'}`,
                borderRadius:'var(--r-md)', padding:'6px 11px',
                fontSize:12, fontWeight:500, transition:'all .15s',
              }}
            >
              <SlidersHorizontal size={13} aria-hidden />
              Filters
              {activeFilterCount > 0 && (
                <span style={{
                  background:'var(--orange)', color:'#fff',
                  borderRadius:10, padding:'1px 5px', fontSize:10, fontWeight:700
                }} aria-hidden>
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}

          <button
            onClick={handleRefresh}
            disabled={refreshing || online === false}
            aria-label="Refresh bug reports"
            title={online === false ? 'Unavailable offline' : 'Refresh data'}
            style={{
              display:'flex', alignItems:'center', gap:5,
              background:'var(--surface-2)', color:'var(--tx-2)',
              border:'1px solid var(--border)', borderRadius:'var(--r-md)',
              padding:'6px 11px', fontSize:12,
              opacity: online === false ? 0.45 : 1,
              cursor: online === false ? 'not-allowed' : 'pointer',
              transition:'all .15s',
            }}
          >
            <RefreshCw size={13} className={refreshing ? 'anim-spin' : ''} aria-hidden />
            <span>Refresh</span>
          </button>

          <div style={S.divider} aria-hidden />

          <span style={{ fontSize:12, color:'var(--tx-3)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {user.email}
          </span>
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            style={{
              display:'flex', alignItems:'center', gap:4,
              background:'transparent', color:'var(--tx-3)',
              border:'1px solid var(--border)', borderRadius:'var(--r-sm)',
              padding:'5px 9px', fontSize:11, transition:'all .15s',
            }}
          >
            <LogOut size={12} aria-hidden /> Sign out
          </button>
        </div>
      </header>

      {/* Main body */}
      <div style={S.body}>
        {activeTab === 'bugs' && showFilters && (
          <ErrorBoundary label="Filter sidebar error">
            <FilterSidebar bugs={parsedBugs} filters={filters} setFilters={setFilters} onClear={clearFilters} />
          </ErrorBoundary>
        )}

        <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }} id="main-content">
          <ErrorBoundary label="Content area error">
            {activeTab === 'overview' && (
              <Overview
                stats={stats}
                bugs={parsedBugs}
                onNavigateToBugs={(f) => { setFilters(prev => ({ ...prev, ...f })); setActiveTab('bugs') }}
              />
            )}
            {activeTab === 'bugs' && (
              <>
                {/* Quick-filter chip strip */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                  background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                  flexShrink: 0, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>SEV</span>
                  {([
                    { id:'P1', color:'var(--p1)' }, { id:'P2', color:'var(--p2)' },
                    { id:'P3', color:'var(--p3)' }, { id:'P4', color:'var(--p4)' },
                  ] as const).map(({ id, color }) => {
                    const active = filters.severity.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev,
                        severity: prev.severity.includes(id) ? prev.severity.filter(s => s !== id) : [...prev.severity, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>{id}</button>
                    )
                  })}

                  <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />

                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>STATUS</span>
                  {([
                    { id:'pending',  color:'var(--warning)' },
                    { id:'triaging', color:'var(--purple)'  },
                    { id:'complete', color:'var(--success)' },
                  ] as const).map(({ id, color }) => {
                    const active = filters.status.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev,
                        status: prev.status.includes(id) ? prev.status.filter(s => s !== id) : [...prev.status, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                        textTransform: 'capitalize' as const,
                      }}>{id}</button>
                    )
                  })}

                  <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />

                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>MODULE</span>
                  {([
                    { id:'WEB',            label:'WEB',   color:'var(--module-web)'   },
                    { id:'APP',            label:'APP',   color:'var(--module-app)'   },
                    { id:'BACKEND',        label:'BE',    color:'var(--module-be)'    },
                    { id:'INFRASTRUCTURE', label:'INFRA', color:'var(--module-infra)' },
                  ] as const).map(({ id, label, color }) => {
                    const active = filters.module.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev,
                        module: prev.module.includes(id) ? prev.module.filter(m => m !== id) : [...prev.module, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>{label}</button>
                    )
                  })}

                  {activeFilterCount > 0 && (
                    <button onClick={clearFilters} style={{
                      marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)',
                      background: 'none', border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)', padding: '2px 9px', cursor: 'pointer',
                    }}>
                      Clear ({activeFilterCount})
                    </button>
                  )}
                </div>

                <BugTable
                  bugs={filtered}
                  total={bugs.length}
                  selected={selected}
                  onToggle={toggleSelect}
                  onSelectAll={selectAll}
                  onClearSelection={clearSelection}
                  sort={sort}
                  onSort={setSort}
                  onDetail={b => setDetailBug(b as BugReport)}
                  onClearFilters={clearFilters}
                  hasActiveFilters={activeFilterCount > 0}
                />
              </>
            )}
            {activeTab === 'clusters' && (
              <BugClusters
                clusters={stats.errorClusters}
                onAnalyse={(clusterBugs) => {
                  setSelected(new Set(clusterBugs.map(b => b.report_id)))
                  setShowAI(true)
                }}
                onViewBug={b => setDetailBug(b as BugReport)}
              />
            )}
            {activeTab === 'developer' && (
              <DeveloperView bugs={parsedBugs} stats={stats} />
            )}
            {activeTab === 'reports' && (
              <Reports bugs={parsedBugs} stats={stats} />
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Modals */}
      {showAI && (
        <AIAnalysisPanel
          bugs={selectedBugs}
          stats={stats}
          onClose={() => setShowAI(false)}
        />
      )}
      {detailBug && (
        <BugDetailModal bug={detailBug} onClose={() => setDetailBug(null)} />
      )}
    </div>
  )
}
