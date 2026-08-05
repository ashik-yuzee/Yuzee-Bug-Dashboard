'use client'

import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logoutAction } from '@/app/actions/auth'
import { parseBug, computeStats } from '@/lib/bugUtils'
import type { ParsedBug } from '@/lib/bugUtils'
import toast from '@/lib/toast'
import { useRealtimeBugs } from '@/hooks/useRealtimeBugs'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useGeminiQueue } from '@/hooks/useGeminiQueue'
import { useInternalTickets } from '@/hooks/useInternalTickets'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import BugTable from './BugTable'
import Overview from './Overview'
import BugClusters from './BugClusters'
import DeveloperView from './DeveloperView'
import AIAnalysisPanel from './AIAnalysisPanel'
import BugDetailPanel from './BugDetailPanel'
import PipelineTab from './PipelineTab'
import TriageRulesTab from './TriageRulesTab'
import FeedbackReportsTab from './FeedbackReportsTab'
import DailyDigestTab from './DailyDigestTab'
import TicketsTab from './TicketsTab'
import TicketDetailPanel from './TicketDetailPanel'
import GuideTab from './GuideTab'
import {
  Bug, LogOut, RefreshCw, Sparkles,
  BarChart3, List, Layers, WifiOff, Radio, Bell, Code2, FileText,
  Activity, AlertTriangle, X, History, ShieldCheck, MessageSquare, Calendar,
  Ticket as TicketIcon, ChevronsLeft, ChevronsRight, BookOpen, BarChart2,
  Sun, Moon, Server,
} from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import Reports from './Reports'
import PostHogTab from './PostHogTab'
import ServerHealthPage from './ServerHealthPage'
import { isLegacy, LEGACY_CUTOFF_ISO } from '@/lib/utils'

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
  correlation_id: string | null
  rollbar_id: string | null
  rollbar_project_id: string | null
  timestamp_utc: string | null
  environment: string | null
  // Ownership / routing
  assigned_owner: string | null
  ownership_team: string | null
  ownership_reason: string | null
  ownership: string | null
  ticket_action: string | null
  // Ticketability / triage scoring
  ticketability_score: number | null
  evidence_score: number | null
  impact_score: number | null
  ticketability_confidence_score: number | null
  ticketability_reason: string | null
  triage_reasoning: string | null
  review_reason: string | null
  suppression_reason: string | null
  is_critical_path: boolean | null
  low_evidence: boolean | null
  occurrence_count: number | null
  // Request / technical shape
  api_endpoint: string | null
  http_method: string | null
  request_body_shape: string | null
  request_headers_shape: string | null
  query_params_shape: string | null
  frontend_route: string | null
  previous_route: string | null
  user_action: string | null
  backend_service: string | null
  downstream_service: string | null
  downstream_endpoint: string | null
  downstream_status: string | null
  error_source: string | null
  exception_class: string | null
  operation: string | null
  handler_method: string | null
  controller: string | null
  duration_ms: number | null
  server_name: string | null
  trace_id: string | null
  page_url: string | null
  cloudwatch_event_type: string | null
  // Rollbar / CloudWatch identifiers
  rollbar_project_type: string | null
  rollbar_replay_api_path: string | null
  cw_log_stream: string | null
  cw_source_group: string | null
  n8n_execution_id: string | null
  // Dedup / fingerprinting
  rollbar_hash: string | null
  error_fingerprint: string | null
  fingerprint: string | null
  // Device / browser / OS
  device_model: string | null
  device_os: string | null
  device_os_ver: string | null
  browser: string | null
  network_effective: string | null
  screen_res: string | null
  battery_level: number | null
  battery_saving: boolean | null
  user_id: string | null
  // Rollbar session replay
  rollbar_session_id: string | null
  rollbar_replay_id: string | null
  rollbar_replay_enabled: boolean | null
  rollbar_replay_s3_url: string | null
  rollbar_replay_archive_status: string | null
  rollbar_language: string | null
  rollbar_framework: string | null
  rollbar_notifier: string | null
  rollbar_component: string | null
  rollbar_auth_state: string | null
  rollbar_network_type: string | null
  // PostHog
  posthog_session_id: string | null
  posthog_session_url: string | null
  feature_flags: string | null
  // Misc technical
  context_complete: boolean | null
  is_java_backend: boolean | null
  http_status_code: string | null
  backend_service_name: string | null
  api_request_payload: string | null
  api_response_payload: string | null
  cloudwatch_log_group: string | null
  component_ucl: string | null
  module: string | null
  page_name: string | null
  active_footer_tab: string | null
  active_component: string | null
  header_title: string | null
  request_id: string | null
  filtered_reason: string | null
  ignore_auto_ticket: boolean | null
  rollbar_enrichment: unknown
  posthog_enrichment: unknown
}

export type GeminiQueueItem = {
  id: string
  report_id: string
  status: 'queued' | 'processed' | 'stale' | 'failed'
  queued_at: string
  started_at: string | null
  finished_at: string | null
  processed_at: string | null
  retry_count: number
  error_message: string | null
  n8n_execution_id: string | null
  created_at: string
}

export type TriageFeedback = {
  id: string
  report_id: string
  jira_key: string
  error_class: string | null
  endpoint_pattern: string | null
  original_tier: string | null
  original_category: string | null
  original_owner: string | null
  correct_tier: string | null
  correct_category: string | null
  correct_owner: string | null
  correct_severity: string | null
  correction_reason: string | null
  weight: number | null
  promoted: boolean | null
  source: string | null
  created_at: string
}

export type BugRule = {
  id: string
  name: string
  match_field: 'error_message' | 'endpoint' | 'stack_trace' | 'any'
  match_pattern: string
  force_tier: string | null
  force_category: string | null
  force_severity: string | null
  force_owner: string | null
  force_labels: string[] | null
  suppress_ticket: boolean | null
  notes: string | null
  priority: number | null
  enabled: boolean | null
  created_by: string | null
  created_at: string
}

export type JiraCommentAction = {
  id: string
  comment_id: string
  jira_key: string
  comment_author: string | null
  intent: string | null
  action_taken: string | null
  gemini_used: boolean | null
  processed_at: string | null
}

export type CwScanState = {
  log_group: string
  last_scanned_at: string
  last_event_at: string | null
  error_count_24h: number | null
  is_active: boolean | null
}

export type FeedbackReport = {
  feedback_id: string
  source: string
  reporter_email: string | null
  message: string | null
  feature_area: string | null
  rating: number | null
  page_url: string | null
  platform: string | null
  app_version: string | null
  environment: string | null
  user_id: string | null
  status: string | null
  severity: string | null
  ai_category: string | null
  ai_sentiment: string | null
  ai_summary: string | null
  ai_labels: string | null
  ai_confidence: number | null
  ai_actionable: boolean | null
  jira_key: string | null
  jira_url: string | null
  jira_pending: boolean | null
  retry_count: number | null
  created_at: string
}

export type DailyBugReport = {
  id: string
  report_date: string
  report_url: string | null
  html_content: string | null
  total_bugs: number | null
  p1_count: number | null
  p2_count: number | null
  p3_count: number | null
  p4_count: number | null
  duplicate_count: number | null
  recurring_count: number | null
  created_at: string
}

export type TicketType = 'task' | 'bug' | 'story' | 'improvement'
export type TicketStatus = 'todo' | 'in_progress' | 'in_review' | 'done'

export type TicketSource = 'internal' | 'jira'

export type InternalTicket = {
  id: string
  ticket_key: string
  title: string
  description: string | null
  type: TicketType
  status: TicketStatus
  priority: string | null
  assignee: string | null
  reporter: string
  labels: string[] | null
  linked_report_id: string | null
  due_date: string | null
  created_at: string
  updated_at: string
  // Jira sync — 'internal' rows are created in-dashboard; 'jira' rows are mirrored from YSC.
  source: TicketSource
  jira_key: string | null
  jira_url: string | null
  jira_status: string | null
  jira_created_at: string | null
  jira_updated_at: string | null
}

export type TicketComment = {
  id: string
  ticket_id: string
  author: string
  comment_text: string
  created_at: string
}

export type TicketActivity = {
  id: string
  ticket_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

export type Filters = {
  search: string; severity: string[]; status: string[]; category: string[]
  platform: string[]; source: string[]; component: string[]; errorType: string[]
  environment: string[]; module: string[]; isDuplicate: string; dateFrom: string; dateTo: string
  hasJira: string; jiraPending: string; jiraClosed: string
}

export type SortConfig = { key: keyof BugReport; dir: 'asc' | 'desc' }
export type PipelineSubTab = 'queue' | 'quality' | 'cloudwatch'
export type TriageSubTab = 'rules' | 'feedback' | 'jira'
type Tab = 'overview' | 'bugs' | 'clusters' | 'pipeline' | 'triage' | 'feedback' | 'developer' | 'reports' | 'daily' | 'tickets' | 'posthog' | 'server-health' | 'guide'
export type TicketsSubTab = 'board' | 'list'

export const BLANK_FILTERS: Filters = {
  search: '', severity: [], status: [], category: [], platform: [],
  source: [], component: [], errorType: [], environment: [], module: [],
  isDuplicate: 'no', dateFrom: '', dateTo: '', hasJira: 'all', jiraPending: 'all',
  jiraClosed: 'open_only',
}

interface AdminUser { email: string }
interface Props { user: AdminUser; initialBugs: BugReport[]; initialTab?: Tab }

function LegacyEmptyState({ onEnable }: { onEnable: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <span style={{ fontSize: 34 }} aria-hidden>📭</span>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginTop: 12, marginBottom: 6 }}>
          No live data yet
        </p>
        <p style={{ fontSize: 13, color: 'var(--tx-3)', lineHeight: 1.5, marginBottom: 16 }}>
          Every bug report on file was reported before 10 Jul 2026 and is being treated as legacy data.
          Enable the legacy toggle to view historical reports.
        </p>
        <button onClick={onEnable} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
          color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.3)',
          borderRadius: 'var(--r-md)', padding: '7px 16px', cursor: 'pointer',
        }}>
          Include legacy data (before Jul 10)
        </button>
      </div>
    </div>
  )
}

const SIDEBAR_W = 216
const SIDEBAR_W_COLLAPSED = 60

const S = {
  root: { display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--bg)' } as const,
  shell: { display:'flex', flex:1, overflow:'hidden', minHeight:0 } as const,
  sidebar: {
    display:'flex', flexDirection:'column', flexShrink:0,
    background:'var(--surface-1)', borderRight:'1px solid var(--border)',
    transition:'width .16s ease', overflow:'hidden',
  } as const,
  sidebarHeader: {
    display:'flex', alignItems:'center', gap:9, height:52, flexShrink:0,
    padding:'0 14px', borderBottom:'1px solid var(--border)',
  } as const,
  logoMark: {
    width:28, height:28, borderRadius:'var(--r-sm)', flexShrink:0,
    background:'var(--orange)', display:'flex', alignItems:'center', justifyContent:'center'
  } as const,
  sidebarNav: { display:'flex', flexDirection:'column', gap:1, padding:'10px 8px', flex:1, overflowY:'auto' } as const,
  sidebarFooter: { padding:'8px', borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:1, flexShrink:0 } as const,
  topbar: {
    display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
    padding:'0 16px', height:52, flexShrink:0, minWidth:0,
    background:'var(--surface-1)', borderBottom:'1px solid var(--border)',
  } as const,
  headerRight: { display:'flex', alignItems:'center', gap:6, flexShrink:0 } as const,
  divider: { width:1, height:20, background:'var(--border)', margin:'0 2px', flexShrink:0 } as const,
  mainColumn: { display:'flex', flexDirection:'column', flex:1, overflow:'hidden', minWidth:0 } as const,
  body: { display:'flex', flex:1, overflow:'hidden' } as const,
}

export default function DashboardClient({ user, initialBugs, initialTab }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { theme, toggleTheme } = useTheme()
  const { online } = useNetworkStatus()
  const { newBugs, status: rtStatus, clearNewBugs } = useRealtimeBugs()
  const { stats: queueStats } = useGeminiQueue()
  const { tickets: fetchedTickets, loading: ticketsLoading, error: ticketsError, refresh: refreshTickets } = useInternalTickets()

  const [bugs, setBugs] = useState<BugReport[]>(initialBugs)
  const [activeTab, _setActiveTab] = useState<Tab>(initialTab ?? 'overview')
  const setActiveTab = useCallback((tab: Tab) => {
    _setActiveTab(tab)
    history.replaceState(null, '', tab === 'overview' ? window.location.pathname + window.location.search : `#${tab}`)
    try { document.cookie = `yuzee_active_tab=${tab};path=/;max-age=86400;SameSite=Lax` } catch {}
  }, [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Filters>(BLANK_FILTERS)
  const [sort, setSort] = useState<SortConfig>({ key: 'created_at', dir: 'desc' })
  const [showAI, setShowAI] = useState(false)
  const [detailBug, setDetailBug] = useState<ParsedBug | null>(null)
  const [detailTicket, setDetailTicket] = useState<InternalTicket | null>(null)
  const [tickets, setTickets] = useState<InternalTicket[]>(fetchedTickets)
  const [refreshing, setRefreshing] = useState(false)
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const prevOnline = useRef<boolean | null>(null)

  // Sidebar collapse preference lives in localStorage (a genuine external system,
  // unavailable during SSR) — read once after mount, then keep in sync on toggle.
  // Deferred a tick so the effect body itself never synchronously calls a state setter.
  useEffect(() => {
    const id = setTimeout(() => {
      if (localStorage.getItem('yuzee-sidebar-collapsed') === '1') setSidebarCollapsed(true)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // Hash-based tab restore — only when no cookie was provided by the server.
  // Cookie takes priority (no flash on refresh). Hash still works for shared links.
  useLayoutEffect(() => {
    if (initialTab) return
    const VALID_TABS: Tab[] = ['overview','bugs','clusters','pipeline','triage','feedback','developer','reports','daily','tickets','posthog','server-health','guide']
    const hash = window.location.hash.slice(1) as Tab
    if (VALID_TABS.includes(hash)) _setActiveTab(hash)
  }, [initialTab])
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('yuzee-sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }, [])

  // "Adjusting state when a prop changes" during render (not in an effect) — the
  // React-recommended way to re-sync local editable state from an async source
  // (useInternalTickets) without an extra render pass or a setState-in-effect lint error.
  const [syncedFetchedTickets, setSyncedFetchedTickets] = useState(fetchedTickets)
  if (fetchedTickets !== syncedFetchedTickets) {
    setSyncedFetchedTickets(fetchedTickets)
    setTickets(fetchedTickets)
  }

  const handleTicketCreated = useCallback((t: InternalTicket) => {
    setTickets(prev => [t, ...prev])
  }, [])
  const handleTicketUpdated = useCallback((id: string, changes: Partial<InternalTicket>) => {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t))
  }, [])
  const handleOpenTicket = useCallback((t: InternalTicket) => {
    setDetailBug(null)
    setDetailTicket(t)
    setActiveTab('tickets')
  }, [])


  // Legacy toggle: default ON only when there's no live (post-cutoff) data yet,
  const [aiRateLimitReset, setAiRateLimitReset] = useState<number | null>(null)

  // so the dashboard isn't empty on first load before real live data exists.
  const [includeLegacy, setIncludeLegacy] = useState<boolean>(() => {
    const hasNonLegacy = initialBugs.some(b => new Date(b.created_at).getTime() >= new Date(LEGACY_CUTOFF_ISO).getTime())
    return !hasNonLegacy
  })

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
  }, [refreshing, supabase, clearNewBugs])

  useEffect(() => {
    if (online === true && prevOnline.current === false) {
      toast.info('Connection restored', 'Refreshing bug reports…')
      handleRefresh()
    }
    if (online === false && prevOnline.current !== false) {
      toast.warning('You are offline', 'Data may be stale. Changes will resume when reconnected.')
    }
    prevOnline.current = online
  }, [online, handleRefresh])

  const handleSignOut = () => logoutAction()

  const handleAbsorbNew = useCallback(() => {
    setBugs(prev => {
      const existingIds = new Set(prev.map(b => b.report_id))
      const fresh = newBugs.filter(b => !existingIds.has(b.report_id))
      return [...fresh, ...prev]
    })
    clearNewBugs()
    toast.success(`${newBugs.length} new bug${newBugs.length > 1 ? 's' : ''} added`)
  }, [newBugs, clearNewBugs])

  const visibleBugs = useMemo(
    () => includeLegacy ? bugs : bugs.filter(b => !isLegacy(b)),
    [bugs, includeLegacy]
  )
  const legacyEmpty = !includeLegacy && visibleBugs.length === 0 && bugs.length > 0

  const parsedBugs = useMemo(() => visibleBugs.map(parseBug), [visibleBugs])
  const stats = useMemo(() => computeStats(parsedBugs), [parsedBugs])

  const jiraPendingCount = useMemo(() => parsedBugs.filter(b => b.jira_pending === true).length, [parsedBugs])

  // Set of jira_keys whose internal_tickets entry is status='done' (closed in Jira).
  // Bugs linked to a closed ticket are hidden by default (jiraClosed='open_only').
  const closedJiraKeys = useMemo(
    () => new Set(tickets.filter(t => t.status === 'done').map(t => t.ticket_key)),
    [tickets]
  )
  const stuckCount = queueStats.stuckItems.length
  const openTicketCount = useMemo(() => tickets.filter(t => t.ticket_key.startsWith('YSDT-') && t.status !== 'done').length, [tickets])

  const handleOpenBugFromTicket = useCallback((reportId: string) => {
    const bug = parsedBugs.find(b => b.report_id === reportId)
    if (!bug) { toast.warning('Bug not found', 'It may be filtered by the legacy toggle.'); return }
    setDetailTicket(null)
    setDetailBug(bug)
    setActiveTab('bugs')
  }, [parsedBugs])

  const filtered = useMemo(() => {
    let r = [...parsedBugs]
    const { search, severity, status, category, platform, source,
            component, errorType, environment, module, isDuplicate,
            dateFrom, dateTo, hasJira, jiraPending, jiraClosed } = filters

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
    // platform filter uses routingToken (BACKEND/MOBILE/WEB)
    if (platform.length)    r = r.filter(b => b.routingToken && platform.includes(b.routingToken))
    if (source.length)      r = r.filter(b => b.source      && source.includes(b.source))
    if (component.length)   r = r.filter(b => b.component   && component.includes(b.component))
    if (errorType.length)   r = r.filter(b => errorType.includes(b.errorType))
    if (environment.length) r = r.filter(b => b.environment && environment.includes(b.environment))
    if (module.length)      r = r.filter(b => module.includes(b.module))
    if (isDuplicate === 'yes') r = r.filter(b => b.is_duplicate)
    if (isDuplicate === 'no')  r = r.filter(b => !b.is_duplicate)
    if (dateFrom) r = r.filter(b => new Date(b.timestamp_utc || b.created_at) >= new Date(dateFrom))
    if (dateTo)   r = r.filter(b => new Date(b.timestamp_utc || b.created_at) <= new Date(dateTo + 'T23:59:59'))
    if (hasJira === 'yes')     r = r.filter(b => !!b.jira_key)
    if (hasJira === 'no')      r = r.filter(b => !b.jira_key)
    if (jiraPending === 'yes') r = r.filter(b => b.jira_pending === true)
    if (jiraPending === 'no')  r = r.filter(b => !b.jira_pending)
    // open_only: hide bugs whose linked ticket is done; closed_only: show only those
    if (jiraClosed === 'open_only')   r = r.filter(b => !b.jira_key || !closedJiraKeys.has(b.jira_key))
    if (jiraClosed === 'closed_only') r = r.filter(b => !!b.jira_key && closedJiraKeys.has(b.jira_key))

    r.sort((a, b) => {
      const av = String(a[sort.key as keyof typeof a] ?? '')
      const bv = String(b[sort.key as keyof typeof b] ?? '')
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return r
  }, [parsedBugs, filters, sort])

  const selectedBugs = useMemo(() => filtered.filter(b => selected.has(b.report_id)), [filtered, selected])

  const toggleSelect    = useCallback((id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }, [])
  const selectAll       = useCallback(() => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(b => b.report_id)))
  }, [filtered, selected.size])
  const clearFilters    = useCallback(() => setFilters(BLANK_FILTERS), [])
  const clearSelection  = useCallback(() => setSelected(new Set()), [])
  const dismissBanner   = useCallback((key: string) => {
    setDismissedBanners(prev => new Set([...prev, key]))
  }, [])

  const activeFilterCount = useMemo(() => [
    filters.search,
    ...filters.severity, ...filters.status, ...filters.category,
    ...filters.platform, ...filters.source, ...filters.component,
    ...filters.errorType, ...filters.environment, ...filters.module,
    filters.isDuplicate !== 'no' ? '1' : '',
    filters.dateFrom, filters.dateTo,
    filters.hasJira !== 'all' ? '1' : '',
    filters.jiraPending !== 'all' ? '1' : '',
    filters.jiraClosed !== 'open_only' ? '1' : '',
  ].filter(Boolean).length, [filters])

  const navigateToBugs = useCallback((f: Record<string, string | string[]>) => {
    setFilters(prev => ({ ...prev, ...f }))
    setActiveTab('bugs')
  }, [])

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview',  label: 'Overview',       icon: <BarChart3     size={14} aria-hidden /> },
    { id: 'bugs',      label: 'Bug Reports',    icon: <List          size={14} aria-hidden />, badge: parsedBugs.filter(b => !b.is_duplicate).length },
    { id: 'clusters',  label: 'Error Clusters',  icon: <Layers       size={14} aria-hidden />, badge: stats.errorClusters.length },
    { id: 'pipeline',  label: 'Pipeline',        icon: <Activity     size={14} aria-hidden />, badge: stuckCount > 0 ? stuckCount : undefined },
    { id: 'triage',    label: 'Triage & Rules',  icon: <ShieldCheck   size={14} aria-hidden /> },
    { id: 'feedback',  label: 'Feedback',        icon: <MessageSquare size={14} aria-hidden /> },
    { id: 'developer', label: 'Developer',       icon: <Code2         size={14} aria-hidden /> },
    { id: 'reports',   label: 'Reports',         icon: <FileText      size={14} aria-hidden /> },
    { id: 'daily',     label: 'Daily Digest',    icon: <Calendar      size={14} aria-hidden /> },
    { id: 'tickets',   label: 'Tickets',         icon: <TicketIcon    size={14} aria-hidden />, badge: openTicketCount },
    { id: 'posthog',        label: 'PostHog',        icon: <BarChart2 size={14} aria-hidden /> },
    { id: 'server-health', label: 'Server Health',  icon: <Server    size={14} aria-hidden /> },
  ]

  const showJiraBanner    = jiraPendingCount > 0 && !dismissedBanners.has('jira')
  const showPipelineBanner = stuckCount > 0 && !dismissedBanners.has('pipeline')

  return (
    <div style={S.root}>

      {/* Alert banners — stacked */}
      {showJiraBanner && (
        <div role="alert" style={{
          display:'flex', alignItems:'center', gap:8, padding:'7px 18px',
          background:'rgba(245,158,11,.10)', borderBottom:'1px solid rgba(245,158,11,.25)',
          fontSize:13, color:'var(--warning)', flexShrink:0,
        }}>
          <AlertTriangle size={14} aria-hidden />
          <span>
            <strong>{jiraPendingCount}</strong> bug{jiraPendingCount > 1 ? 's' : ''} failed to create a Jira ticket and need manual attention.
          </span>
          <button onClick={() => { navigateToBugs({ jiraPending: 'yes' }) }} style={{ marginLeft: 4, fontSize:12, fontWeight:600, color:'var(--warning)', background:'rgba(245,158,11,.15)', border:'1px solid rgba(245,158,11,.35)', borderRadius:'var(--r-sm)', padding:'2px 10px', cursor:'pointer' }}>
            View affected bugs
          </button>
          <button onClick={() => dismissBanner('jira')} aria-label="Dismiss Jira pending alert" style={{ marginLeft:'auto', background:'none', color:'var(--tx-3)', cursor:'pointer', padding:2 }}>
            <X size={13} />
          </button>
        </div>
      )}

      {showPipelineBanner && (
        <div role="alert" style={{
          display:'flex', alignItems:'center', gap:8, padding:'7px 18px',
          background:'rgba(245,158,11,.10)', borderBottom:'1px solid rgba(245,158,11,.25)',
          fontSize:13, color:'var(--warning)', flexShrink:0,
        }}>
          <AlertTriangle size={14} aria-hidden />
          <span>Gemini queue has <strong>{stuckCount}</strong> bug{stuckCount > 1 ? 's' : ''} stuck for &gt;30 minutes — scheduler may be stalled.</span>
          <button onClick={() => setActiveTab('pipeline')} style={{ marginLeft: 4, fontSize:12, fontWeight:600, color:'var(--warning)', background:'rgba(245,158,11,.15)', border:'1px solid rgba(245,158,11,.35)', borderRadius:'var(--r-sm)', padding:'2px 10px', cursor:'pointer' }}>
            View pipeline
          </button>
          <button onClick={() => dismissBanner('pipeline')} aria-label="Dismiss pipeline stuck alert" style={{ marginLeft:'auto', background:'none', color:'var(--tx-3)', cursor:'pointer', padding:2 }}>
            <X size={13} />
          </button>
        </div>
      )}

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

      <div style={S.shell}>
        {/* Sidebar */}
        <aside style={{ ...S.sidebar, width: sidebarCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W }}>
          <div style={S.sidebarHeader}>
            <div style={S.logoMark} aria-hidden>
              <Bug size={15} color="#fff" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-brand" style={{ fontWeight:700, fontSize:14, color:'var(--tx-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                Yuzee Bugs
              </span>
            )}
          </div>

          <nav aria-label="Dashboard sections" style={S.sidebarNav}>
            {tabs.map(tab => {
              const active = activeTab === tab.id
              const isPipelineAlert = tab.id === 'pipeline' && stuckCount > 0
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  title={sidebarCollapsed ? tab.label : undefined}
                  style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%', position:'relative',
                    padding: sidebarCollapsed ? '9px 0' : '8px 10px',
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    borderRadius:'var(--r-md)',
                    background: active ? 'var(--orange-dim)' : 'transparent',
                    color: active ? 'var(--orange)' : 'var(--tx-3)',
                    fontSize:13, fontWeight: active ? 600 : 400,
                    border: active ? '1px solid rgba(249,115,22,.20)' : '1px solid transparent',
                    transition:'all .15s', cursor:'pointer',
                  }}
                >
                  {tab.icon}
                  {!sidebarCollapsed && (
                    <span style={{ flex:1, textAlign:'left', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {tab.label}
                    </span>
                  )}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    sidebarCollapsed ? (
                      <span aria-hidden style={{
                        position:'absolute', top:6, right:6, width:7, height:7, borderRadius:'50%',
                        background: isPipelineAlert ? 'var(--warning)' : 'var(--orange)',
                      }} />
                    ) : (
                      <span style={{
                        fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, flexShrink:0,
                        background: isPipelineAlert ? 'var(--warning)' : active ? 'var(--orange)' : 'var(--surface-2)',
                        color: isPipelineAlert ? '#000' : active ? '#fff' : 'var(--tx-3)',
                      }} aria-hidden>
                        {tab.badge}
                      </span>
                    )
                  )}
                </button>
              )
            })}
          </nav>

          <div style={S.sidebarFooter}>
            <button
              onClick={() => setActiveTab('guide')}
              aria-current={activeTab === 'guide' ? 'page' : undefined}
              title={sidebarCollapsed ? 'Guide — how to use this dashboard' : undefined}
              style={{
                display:'flex', alignItems:'center', gap:10, width:'100%',
                padding: sidebarCollapsed ? '9px 0' : '8px 10px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderRadius:'var(--r-md)',
                background: activeTab === 'guide' ? 'var(--orange-dim)' : 'transparent',
                color: activeTab === 'guide' ? 'var(--orange)' : 'var(--tx-3)',
                fontSize:13, fontWeight: activeTab === 'guide' ? 600 : 400,
                border: activeTab === 'guide' ? '1px solid rgba(249,115,22,.20)' : '1px solid transparent',
                cursor:'pointer', transition:'all .15s',
              }}
            >
              <BookOpen size={15} aria-hidden />
              {!sidebarCollapsed && <span>Guide</span>}
            </button>
            <button
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                display:'flex', alignItems:'center', gap:10, width:'100%',
                padding: sidebarCollapsed ? '9px 0' : '8px 10px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderRadius:'var(--r-md)', color:'var(--tx-3)', fontSize:12,
                background:'none', border:'none', cursor:'pointer', transition:'all .15s',
              }}
            >
              {sidebarCollapsed ? <ChevronsRight size={15} aria-hidden /> : <ChevronsLeft size={15} aria-hidden />}
              {!sidebarCollapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>

        <div style={S.mainColumn}>
          {/* Top bar */}
          <header style={S.topbar}>
            <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, overflow:'hidden' }}>
              <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:15, fontWeight:700, color:'var(--tx-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {activeTab === 'guide' ? <BookOpen size={14} aria-hidden /> : tabs.find(t => t.id === activeTab)?.icon}
                {activeTab === 'guide' ? 'Guide' : tabs.find(t => t.id === activeTab)?.label}
              </span>
              <span title={`Realtime: ${rtStatus}`} aria-label={`Live updates: ${rtStatus}`} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
                <Radio size={11} color={rtStatus === 'connected' ? 'var(--success)' : rtStatus === 'error' ? 'var(--danger)' : 'var(--tx-3)'} aria-hidden />
              </span>
            </div>

            <div style={S.headerRight}>
              {selected.size > 0 && (
                <button
                  onClick={() => setShowAI(true)}
                  aria-label={`Analyse ${selected.size} selected bug${selected.size > 1 ? 's' : ''} with Gemini AI`}
                  style={{
                    display:'flex', alignItems:'center', gap:6, flexShrink:0,
                    background:'linear-gradient(135deg,#8b5cf6,#6d28d9)',
                    color:'#fff', borderRadius:'var(--r-md)',
                    padding:'6px 13px', fontSize:13, fontWeight:600,
                    transition:'opacity .15s', border:'none', cursor:'pointer', whiteSpace:'nowrap',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.88'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                >
                  <Sparkles size={13} aria-hidden />
                  Analyse {selected.size}
                </button>
              )}

              {aiRateLimitReset && (
                <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#f59e0b', padding:'3px 10px', borderRadius:10, background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.3)', flexShrink:0, whiteSpace:'nowrap' }}>
                  ⚠ AI limit resets {new Date(aiRateLimitReset).toLocaleString('en-AU', { timeZone:'Asia/Kuala_Lumpur', hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' })} MYT
                </span>
              )}

              <button
                onClick={() => setIncludeLegacy(v => !v)}
                aria-pressed={includeLegacy}
                aria-label="Toggle legacy data (before Jul 10)"
                title={`Legacy = bugs reported before 10 Jul 2026. Currently ${includeLegacy ? 'shown' : 'hidden'} — click to ${includeLegacy ? 'hide' : 'show'} them.`}
                style={{
                  display:'flex', alignItems:'center', gap:6, justifyContent:'center', flexShrink:0,
                  height:32, padding:'0 10px', whiteSpace:'nowrap',
                  background: includeLegacy ? 'var(--orange-dim)' : 'var(--surface-2)',
                  color: includeLegacy ? 'var(--orange)' : 'var(--tx-2)',
                  border: `1px solid ${includeLegacy ? 'rgba(249,115,22,.3)' : 'var(--border)'}`,
                  borderRadius:'var(--r-md)', cursor:'pointer', transition:'all .15s',
                  fontSize:12, fontWeight:600,
                }}
              >
                <History size={13} aria-hidden />
                Legacy {includeLegacy ? 'on' : 'off'}
              </button>


              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  width:32, height:32,
                  background:'var(--surface-2)', color:'var(--tx-2)',
                  border:'1px solid var(--border)', borderRadius:'var(--r-md)',
                  cursor:'pointer', transition:'all .15s',
                }}
              >
                {theme === 'dark' ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
              </button>

              <div style={S.divider} aria-hidden />

              <button
                onClick={handleRefresh}
                disabled={refreshing || online === false}
                aria-label="Refresh bug reports"
                title={online === false ? 'Unavailable offline' : 'Refresh data'}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  width:32, height:32,
                  background:'var(--surface-2)', color:'var(--tx-2)',
                  border:'1px solid var(--border)', borderRadius:'var(--r-md)',
                  opacity: online === false ? 0.45 : 1,
                  cursor: online === false ? 'not-allowed' : 'pointer',
                  transition:'all .15s',
                }}
              >
                <RefreshCw size={14} className={refreshing ? 'anim-spin' : ''} aria-hidden />
              </button>

              <div style={S.divider} aria-hidden />

              <span style={{ fontSize:12, color:'var(--tx-3)', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1 }} title={user.email}>
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                aria-label="Sign out"
                title="Sign out"
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                  width:32, height:32,
                  background:'transparent', color:'var(--tx-3)',
                  border:'1px solid var(--border)', borderRadius:'var(--r-sm)',
                  transition:'all .15s', cursor:'pointer',
                }}
              >
                <LogOut size={13} aria-hidden />
              </button>
            </div>
          </header>

          {/* Main body */}
          <div style={S.body}>
        <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }} id="main-content">
          <ErrorBoundary label="Content area error">
            {activeTab === 'overview' && (
              legacyEmpty ? <LegacyEmptyState onEnable={() => setIncludeLegacy(true)} /> : (
                <Overview
                  stats={stats}
                  bugs={parsedBugs}
                  includeLegacy={includeLegacy}
                  onNavigateToBugs={navigateToBugs}
                  onNavigateToClusters={() => setActiveTab('clusters')}
                  onNavigateToTickets={() => setActiveTab('tickets')}
                  onNavigateToPostHog={() => setActiveTab('posthog')}
                />
              )
            )}

            {activeTab === 'bugs' && legacyEmpty && (
              <LegacyEmptyState onEnable={() => setIncludeLegacy(true)} />
            )}

            {activeTab === 'bugs' && !legacyEmpty && (
              <>
                {/* Quick-filter chip strip */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                  background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                  flexShrink: 0, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>SEV</span>
                  {(['P1','P2','P3','P4'] as const).map(id => {
                    const colors: Record<string,string> = { P1:'var(--p1)', P2:'var(--p2)', P3:'var(--p3)', P4:'var(--p4)' }
                    const color = colors[id]
                    const active = filters.severity.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev, severity: active ? prev.severity.filter(s => s !== id) : [...prev.severity, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>{id}</button>
                    )
                  })}

                  <div style={{ width:1, height:14, background:'var(--border)', margin:'0 3px', flexShrink:0 }} />

                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>STATUS</span>
                  {(['pending','triaging','complete'] as const).map(id => {
                    const colors: Record<string,string> = { pending:'var(--warning)', triaging:'var(--purple)', complete:'var(--success)' }
                    const color = colors[id]
                    const active = filters.status.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev, status: active ? prev.status.filter(s => s !== id) : [...prev.status, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s', textTransform:'capitalize' as const,
                      }}>{id}</button>
                    )
                  })}

                  <div style={{ width:1, height:14, background:'var(--border)', margin:'0 3px', flexShrink:0 }} />

                  <span style={{ fontSize: 10, color: 'var(--tx-3)', fontWeight: 700, letterSpacing: '.07em', flexShrink: 0 }}>ROUTING</span>
                  {(['BACKEND','MOBILE','WEB'] as const).map(id => {
                    const colors: Record<string,string> = { BACKEND:'#a78bfa', MOBILE:'#2dd4bf', WEB:'#4ade80' }
                    const color = colors[id]
                    const active = filters.platform.includes(id)
                    return (
                      <button key={id} onClick={() => setFilters(prev => ({
                        ...prev, platform: active ? prev.platform.filter(m => m !== id) : [...prev.platform, id],
                      }))} style={{
                        padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: active ? color + '22' : 'var(--surface-1)',
                        color: active ? color : 'var(--tx-2)',
                        border: `1px solid ${active ? color + '66' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}>{id}</button>
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
                  total={visibleBugs.length}
                  selected={selected}
                  onToggle={toggleSelect}
                  onSelectAll={selectAll}
                  onClearSelection={clearSelection}
                  sort={sort}
                  onSort={setSort}
                  onDetail={b => setDetailBug(b)}
                  onClearFilters={clearFilters}
                  hasActiveFilters={activeFilterCount > 0}
                  filters={filters}
                  setFilters={setFilters}
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
                onViewBug={b => setDetailBug(b)}
                onNavigateToBugs={(pattern) => navigateToBugs({ search: pattern })}
              />
            )}

            {activeTab === 'pipeline' && (
              <PipelineTab />
            )}

            {activeTab === 'triage' && (
              <TriageRulesTab />
            )}

            {activeTab === 'feedback' && (
              <FeedbackReportsTab />
            )}

            {activeTab === 'daily' && (
              <DailyDigestTab />
            )}

            {activeTab === 'tickets' && (
              <TicketsTab
                tickets={tickets}
                loading={ticketsLoading}
                error={ticketsError}
                refresh={refreshTickets}
                onOpen={setDetailTicket}
                onUpdated={handleTicketUpdated}
                onCreated={handleTicketCreated}
                bugs={parsedBugs}
              />
            )}

            {activeTab === 'developer' && (
              <DeveloperView
                bugs={parsedBugs}
                stats={stats}
                onViewBugs={(routing) => navigateToBugs({ platform: [routing] })}
              />
            )}

            {activeTab === 'reports' && (
              <Reports bugs={parsedBugs} stats={stats} />
            )}

            {activeTab === 'posthog' && (
              <PostHogTab bugs={parsedBugs} />
            )}

            {activeTab === 'server-health' && (
              <ServerHealthPage onRateLimitUpdate={setAiRateLimitReset} />
            )}

            {activeTab === 'guide' && (
              <GuideTab />
            )}
          </ErrorBoundary>
        </main>
          </div>
        </div>
      </div>

      {/* AI panel */}
      {showAI && (
        <AIAnalysisPanel
          bugs={selectedBugs}
          stats={stats}
          onClose={() => setShowAI(false)}
        />
      )}

      {/* Bug detail side panel */}
      {detailBug && (
        <BugDetailPanel
          bug={detailBug}
          onClose={() => setDetailBug(null)}
          onBugUpdated={(reportId, changes) => {
            setBugs(prev => prev.map(b => b.report_id === reportId ? { ...b, ...changes } : b))
          }}
          onOpenTicket={handleOpenTicket}
        />
      )}

      {/* Ticket detail side panel — always looked up fresh from `tickets` so it reflects
          optimistic updates made anywhere (board move, another edit) while it's open. */}
      {detailTicket && (
        <TicketDetailPanel
          ticket={tickets.find(t => t.id === detailTicket.id) || detailTicket}
          onClose={() => setDetailTicket(null)}
          onUpdated={handleTicketUpdated}
          onOpenBug={handleOpenBugFromTicket}
          bugs={parsedBugs}
        />
      )}
    </div>
  )
}
