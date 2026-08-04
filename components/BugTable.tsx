'use client'

import { useState, useMemo, useRef } from 'react'
import type { ParsedBug } from '@/lib/bugUtils'
import type { BugReport, SortConfig, Filters } from './DashboardClient'
import {
  relativeTime, formatTimestamp, jiraUrl, rollbarUrl, ROUTING_COLORS,
  getReporterIdentity, getUserAgentString, parseUserAgent, deriveOS, isLegacy,
} from '@/lib/utils'
import { useJiraStatuses } from '@/hooks/useJiraStatuses'
import PageInfo from './ui/PageInfo'
import {
  ChevronUp, ChevronDown, ChevronsUpDown, ExternalLink, AlertTriangle,
  Check, Copy, X, Search, ChevronLeft, ChevronRight, History,
} from 'lucide-react'

const PAGE_SIZE = 25

interface Props {
  bugs: ParsedBug[]; total: number; selected: Set<string>
  onToggle: (id: string) => void; onSelectAll: () => void; onClearSelection: () => void
  sort: SortConfig; onSort: (s: SortConfig) => void; onDetail: (b: ParsedBug) => void
  onClearFilters: () => void; hasActiveFilters: boolean
  filters: Filters; setFilters: (f: Filters) => void
}

const SEV_COL: Record<string, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)' }

/** aria-sort belongs on the <th role="columnheader"> element, not the button inside it. */
function ariaSortFor(sort: SortConfig, col: keyof BugReport): 'ascending' | 'descending' | 'none' {
  return sort.key === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
}

function SortBtn({ col, sort, onSort, label }: { col: keyof BugReport; sort: SortConfig; onSort: (s: SortConfig) => void; label: string }) {
  const active = sort.key === col
  return (
    <button
      onClick={() => onSort({ key: col, dir: sort.key === col && sort.dir === 'asc' ? 'desc' : 'asc' })}
      aria-label={`Sort by ${label}`}
      style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '6px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: active ? 'var(--orange)' : 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {label}
      {!active ? <ChevronsUpDown size={10} style={{ opacity: 0.3 }} aria-hidden /> :
        sort.dir === 'asc' ? <ChevronUp size={10} color="var(--orange)" aria-hidden /> :
          <ChevronDown size={10} color="var(--orange)" aria-hidden />}
    </button>
  )
}

function Checkbox({ checked, indeterminate, onClick, label }: { checked: boolean; indeterminate?: boolean; onClick: () => void; label: string }) {
  return (
    <div role="checkbox" aria-checked={indeterminate ? 'mixed' : checked} aria-label={label} tabIndex={0}
      onClick={onClick} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
      style={{ width: 14, height: 14, borderRadius: 'var(--r-sm)', cursor: 'pointer', flexShrink: 0, border: `2px solid ${checked || indeterminate ? 'var(--orange)' : 'var(--border-hi)'}`, background: checked ? 'var(--orange)' : indeterminate ? 'var(--orange-dim)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
      {checked && <Check size={8} color="#fff" strokeWidth={3} aria-hidden />}
      {indeterminate && !checked && <div style={{ width: 6, height: 2, background: 'var(--orange)', borderRadius: 1 }} aria-hidden />}
    </div>
  )
}

function DropFilter({ label, value, options, onChange, active }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; active: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: active ? 'var(--orange)' : 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ background: active ? 'var(--orange-dim)' : 'var(--surface-2)', border: `1px solid ${active ? 'rgba(249,115,22,.35)' : 'var(--border)'}`, borderRadius: 'var(--r-sm)', color: active ? 'var(--orange)' : 'var(--tx-1)', fontSize: 11, padding: '3px 6px', outline: 'none', cursor: 'pointer' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function jiraStatusColor(statusCategory: string): string {
  const l = statusCategory.toLowerCase()
  if (l === 'done') return 'var(--success)'
  if (l.includes('progress')) return 'var(--info)'
  return 'var(--tx-3)'
}

export default function BugTable({ bugs, total, selected, onToggle, onSelectAll, onClearSelection, sort, onSort, onDetail, onClearFilters, hasActiveFilters, filters, setFilters }: Props) {
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { statuses: jiraStatuses } = useJiraStatuses(useMemo(() => bugs.map(b => b.jira_key), [bugs]))

  const allChecked = bugs.length > 0 && selected.size === bugs.length
  const someChecked = selected.size > 0 && !allChecked

  // Reset to page 1 when filters change — adjusted during render (react.dev "Adjusting
  // state when a prop changes"), not in an effect, so it takes effect before the paint
  // that shows stale out-of-range rows.
  const [prevBugsLength, setPrevBugsLength] = useState(bugs.length)
  const [prevFilters, setPrevFilters] = useState(filters)
  if (bugs.length !== prevBugsLength || filters !== prevFilters) {
    setPrevBugsLength(bugs.length)
    setPrevFilters(filters)
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(bugs.length / PAGE_SIZE))
  const pageBugs = useMemo(() => bugs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [bugs, page])
  const rangeStart = bugs.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, bugs.length)

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1600) }).catch(() => {})
  }

  const set = <K extends keyof Filters>(key: K, val: Filters[K]) => setFilters({ ...filters, [key]: val })

  const activeCount = useMemo(() => [
    filters.search,
    ...filters.severity, ...filters.status, ...filters.platform,
    ...filters.component, ...filters.source, ...filters.environment,
    filters.isDuplicate !== 'all' ? '1' : '',
    filters.hasJira !== 'all' ? '1' : '',
    filters.jiraPending !== 'all' ? '1' : '',
    filters.jiraClosed !== 'open_only' ? '1' : '',
    filters.dateFrom, filters.dateTo,
  ].filter(Boolean).length, [filters])

  const COMPONENTS = ['Auth', 'Payment', 'Search', 'Profile', 'Admissions', 'Dashboard', 'Unknown']

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      <div style={{ padding: '12px 14px 0' }}>
        <PageInfo storageKey="bugs">
          Every bug report from Rollbar, CloudWatch, and user submissions — fully filterable and sortable. Click any
          row to see its full AI triage, raw stack trace, telemetry timeline, and debug links.
        </PageInfo>
      </div>

      {/* ─── Inline filter bar ─── */}
      <div style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)', padding: '10px 14px', flexShrink: 0 }}>
        {/* Row 1: search + quick counts */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--tx-3)', pointerEvents: 'none' }} aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={filters.search}
              onChange={e => set('search', e.target.value)}
              placeholder="Search description, report ID, Jira key, AI summary…"
              style={{ width: '100%', background: 'var(--surface-2)', border: `1px solid ${filters.search ? 'rgba(249,115,22,.35)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', padding: '5px 28px 5px 26px', fontSize: 12, color: 'var(--tx-1)', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target as HTMLElement).style.borderColor = 'var(--orange)'}
              onBlur={e => (e.target as HTMLElement).style.borderColor = filters.search ? 'rgba(249,115,22,.35)' : 'var(--border)'}
            />
            {filters.search && (
              <button onClick={() => set('search', '')} aria-label="Clear search" style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--tx-3)', display: 'flex', cursor: 'pointer' }}>
                <X size={11} />
              </button>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--tx-2)', flexShrink: 0 }}>
            <strong style={{ color: 'var(--tx-1)' }}>{rangeStart}–{rangeEnd}</strong> of <strong style={{ color: 'var(--tx-1)' }}>{bugs.length}</strong>
            {hasActiveFilters && <span style={{ color: 'var(--tx-3)' }}> (filtered from {total})</span>}
          </span>
          {activeCount > 0 && (
            <button onClick={onClearFilters} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 9px', borderRadius: 'var(--r-sm)', background: 'var(--orange-dim)', color: 'var(--orange)', border: '1px solid rgba(249,115,22,.28)', cursor: 'pointer' }}>
              <X size={10} /> {activeCount} filter{activeCount > 1 ? 's' : ''} active
            </button>
          )}
        </div>

        {/* Row 2: dropdown filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <DropFilter label="Severity" value={filters.severity[0] || 'all'} active={filters.severity.length > 0}
            options={[{ value: 'all', label: 'All severities' }, ...['P1', 'P2', 'P3', 'P4'].map(s => ({ value: s, label: s }))]}
            onChange={v => set('severity', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Platform" value={filters.platform[0] || 'all'} active={filters.platform.length > 0}
            options={[{ value: 'all', label: 'All platforms' }, ...['BACKEND', 'MOBILE', 'WEB'].map(s => ({ value: s, label: s }))]}
            onChange={v => set('platform', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Component" value={filters.component[0] || 'all'} active={filters.component.length > 0}
            options={[{ value: 'all', label: 'All components' }, ...COMPONENTS.map(c => ({ value: c, label: c }))]}
            onChange={v => set('component', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Source" value={filters.source[0] || 'all'} active={filters.source.length > 0}
            options={[{ value: 'all', label: 'All sources' }, { value: 'rollbar_auto', label: 'Rollbar auto' }, { value: 'user_report', label: 'User report' }]}
            onChange={v => set('source', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Status" value={filters.status[0] || 'all'} active={filters.status.length > 0}
            options={[{ value: 'all', label: 'All statuses' }, ...['pending', 'triaging', 'triaged', 'resolved', 'complete'].map(s => ({ value: s, label: s }))]}
            onChange={v => set('status', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Environment" value={filters.environment[0] || 'all'} active={filters.environment.length > 0}
            options={[{ value: 'all', label: 'All envs' }, { value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }]}
            onChange={v => set('environment', v === 'all' ? [] : [v])}
          />
          <DropFilter label="Has Jira" value={filters.hasJira} active={filters.hasJira !== 'all'}
            options={[{ value: 'all', label: 'All' }, { value: 'has_ticket', label: 'Has ticket' }, { value: 'no_ticket', label: 'No ticket' }]}
            onChange={v => set('hasJira', v)}
          />
          <DropFilter label="Duplicate" value={filters.isDuplicate} active={filters.isDuplicate !== 'all'}
            options={[{ value: 'all', label: 'All' }, { value: 'yes', label: 'Duplicates only' }, { value: 'no', label: 'Non-duplicates' }]}
            onChange={v => set('isDuplicate', v)}
          />
          <DropFilter label="Jira pending" value={filters.jiraPending} active={filters.jiraPending !== 'all'}
            options={[{ value: 'all', label: 'All' }, { value: 'pending_only', label: 'Failed tickets' }]}
            onChange={v => set('jiraPending', v)}
          />
          <DropFilter label="Ticket status" value={filters.jiraClosed} active={filters.jiraClosed !== 'open_only'}
            options={[{ value: 'all', label: 'All' }, { value: 'open_only', label: 'Open tickets only' }, { value: 'closed_only', label: 'Closed tickets' }]}
            onChange={v => set('jiraClosed', v)}
          />

          {/* Date range */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: filters.dateFrom ? 'var(--orange)' : 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>From</span>
            <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
              style={{ background: 'var(--surface-2)', border: `1px solid ${filters.dateFrom ? 'rgba(249,115,22,.35)' : 'var(--border)'}`, borderRadius: 'var(--r-sm)', color: 'var(--tx-1)', fontSize: 11, padding: '3px 6px', outline: 'none' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: filters.dateTo ? 'var(--orange)' : 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>To</span>
            <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
              style={{ background: 'var(--surface-2)', border: `1px solid ${filters.dateTo ? 'rgba(249,115,22,.35)' : 'var(--border)'}`, borderRadius: 'var(--r-sm)', color: 'var(--tx-1)', fontSize: 11, padding: '3px 6px', outline: 'none' }} />
          </label>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div style={{ flex: 1, overflow: 'auto' }} role="region" aria-label="Bug reports table">
        {bugs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 14 }} role="status">
            <span style={{ fontSize: 36 }} aria-hidden>🔍</span>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 6 }}>No bugs match your filters</p>
              {hasActiveFilters && (
                <button onClick={onClearFilters} style={{ fontSize: 13, color: 'var(--orange)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1450 }} role="table">
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10 }}>
                <th scope="col" style={{ padding: '7px 10px', width: 32 }}>
                  <Checkbox checked={allChecked} indeterminate={someChecked} onClick={onSelectAll} label="Select all" />
                </th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'severity')} style={{ padding: 0, width: 64 }}><SortBtn col="severity" sort={sort} onSort={onSort} label="Sev" /></th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'platform')} style={{ padding: 0, width: 88 }}><SortBtn col="platform" sort={sort} onSort={onSort} label="Platform" /></th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'component')} style={{ padding: 0, width: 96 }}><SortBtn col="component" sort={sort} onSort={onSort} label="Component" /></th>
                <th scope="col" style={{ padding: '7px 10px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Description</th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'source')} style={{ padding: 0, width: 94 }}><SortBtn col="source" sort={sort} onSort={onSort} label="Source" /></th>
                <th scope="col" style={{ padding: '7px 10px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '.06em', textTransform: 'uppercase', width: 130 }}>User</th>
                <th scope="col" style={{ padding: '7px 10px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '.06em', textTransform: 'uppercase', width: 140 }}>Device</th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'environment')} style={{ padding: 0, width: 88 }}><SortBtn col="environment" sort={sort} onSort={onSort} label="Env" /></th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'jira_key')} style={{ padding: 0, width: 110 }}><SortBtn col="jira_key" sort={sort} onSort={onSort} label="Jira" /></th>
                <th scope="col" style={{ padding: '7px 10px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '.06em', textTransform: 'uppercase', width: 44 }}>RB</th>
                <th scope="col" aria-sort={ariaSortFor(sort, 'timestamp_utc')} style={{ padding: 0, width: 96 }}><SortBtn col="timestamp_utc" sort={sort} onSort={onSort} label="Time" /></th>
                <th scope="col" style={{ padding: '7px 8px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '.06em', textTransform: 'uppercase', width: 54 }}>Flags</th>
                <th scope="col" style={{ padding: '7px 8px', width: 36 }}><span className="sr-only">View</span></th>
              </tr>
            </thead>
            <tbody>
              {pageBugs.map((bug, i) => {
                const isSelected = selected.has(bug.report_id)
                const sevCol = SEV_COL[bug.severity || ''] || 'var(--tx-3)'
                const routeStyle = bug.routingToken ? ROUTING_COLORS[bug.routingToken] : null
                const jiraLink = jiraUrl(bug.jira_key)
                const rbLink = rollbarUrl(bug)
                const rowBg = isSelected ? 'rgba(249,115,22,.05)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.01)'
                const reporter = getReporterIdentity(bug)
                const ua = parseUserAgent(getUserAgentString(bug))
                const os = deriveOS(bug)
                const legacy = isLegacy(bug)
                const jiraStatus = bug.jira_key ? jiraStatuses[bug.jira_key] : undefined

                return (
                  <tr key={bug.report_id}
                    style={{ background: rowBg, borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = rowBg }}
                    onClick={() => onDetail(bug)}
                  >
                    <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                      <Checkbox checked={isSelected} onClick={() => onToggle(bug.report_id)} label={`Select ${bug.report_id}`} />
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: sevCol + '18', color: sevCol, border: `1px solid ${sevCol}30`, fontFamily: 'monospace', display: 'inline-block' }}>
                        {bug.severity || '—'}
                      </span>
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      {routeStyle ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: routeStyle.bg, color: routeStyle.color, border: `1px solid ${routeStyle.border}`, display: 'inline-block' }}>
                          {bug.routingToken}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      {bug.component ? (
                        <span style={{ fontSize: 11, color: 'var(--tx-2)', background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>{bug.component}</span>
                      ) : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                    </td>

                    <td style={{ padding: '8px 10px', minWidth: 200, maxWidth: 340 }}>
                      <p className={bug.errorType !== 'Unknown' ? 'font-mono' : undefined}
                        style={{ fontSize: 11, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320, lineHeight: 1.4 }}
                        title={bug.description || undefined}>
                        {(bug.description || '—').slice(0, 80)}{(bug.description?.length || 0) > 80 ? '…' : ''}
                      </p>
                      {bug.ai_summary && (
                        <p style={{ fontSize: 10, color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320, marginTop: 2 }}
                          title={bug.ai_summary}>
                          {bug.ai_summary.slice(0, 75)}…
                        </p>
                      )}
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: bug.source === 'rollbar_auto' ? 'var(--info)' : bug.source === 'user_report' ? 'var(--warning)' : 'var(--tx-3)', whiteSpace: 'nowrap' }}>
                        {bug.source === 'rollbar_auto' ? 'rollbar' : bug.source === 'user_report' ? 'user' : bug.source?.replace(/_/g, ' ') || '—'}
                      </span>
                    </td>

                    <td style={{ padding: '8px 10px', maxWidth: 130, overflow: 'hidden' }}>
                      <span style={{ fontSize: 11, color: reporter ? 'var(--tx-2)' : 'var(--tx-3)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={reporter || undefined}>
                        {reporter || '—'}
                      </span>
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, color: 'var(--tx-2)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{os}</span>
                        {(ua.deviceModel || ua.browser) && (
                          <span style={{ fontSize: 10, color: 'var(--tx-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={[ua.deviceModel, ua.browser].filter(Boolean).join(' · ')}>
                            {[ua.deviceModel, ua.browser].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '8px 10px' }}>
                      {bug.environment ? (
                        <span style={{ fontSize: 10, padding: '2px 5px', borderRadius: 3, color: bug.environment === 'production' ? 'var(--danger)' : 'var(--tx-3)', background: bug.environment === 'production' ? 'var(--danger-dim)' : 'var(--surface-2)', fontWeight: bug.environment === 'production' ? 600 : 400 }}>
                          {bug.environment === 'production' ? 'prod' : bug.environment}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                    </td>

                    <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                      {bug.jira_pending === true ? (
                        <span title="Ticket creation failed" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                          <AlertTriangle size={11} aria-hidden />⚠ failed
                        </span>
                      ) : bug.jira_key ? (
                        <div>
                          <a href={jiraLink || '#'} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: 'var(--info)', whiteSpace: 'nowrap' }}>
                            {bug.jira_key} <ExternalLink size={9} aria-hidden />
                          </a>
                          {jiraStatus && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: jiraStatusColor(jiraStatus.statusCategory) }}>{jiraStatus.status}</span>
                          )}
                        </div>
                      ) : <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>—</span>}
                    </td>

                    <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                      {rbLink && (
                        <a href={rbLink} target="_blank" rel="noopener noreferrer" aria-label={`Rollbar item ${bug.rollbar_id}`}
                          style={{ fontSize: 11, color: 'var(--info)', display: 'flex', alignItems: 'center' }}>
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      )}
                    </td>

                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--tx-2)' }} title={formatTimestamp(bug)}>
                        {relativeTime(bug.timestamp_utc || bug.created_at)}
                      </span>
                    </td>

                    <td style={{ padding: '8px 8px' }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {bug.is_duplicate && (
                          <span title="Duplicate" style={{ fontSize: 12 }} aria-label="Duplicate">🔄</span>
                        )}
                        {bug.jira_pending && (
                          <span title="Jira ticket failed" style={{ fontSize: 12 }} aria-label="Jira pending">⚠️</span>
                        )}
                        {legacy && (
                          <span title="Legacy — reported before 10 Jul 2026" aria-label="Legacy" style={{
                            display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700,
                            color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)',
                            padding: '1px 5px', borderRadius: 3,
                          }}>
                            <History size={9} aria-hidden /> Legacy
                          </span>
                        )}
                      </div>
                    </td>

                    <td style={{ padding: '8px 8px' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => copyId(bug.report_id)}
                        aria-label={copiedId === bug.report_id ? 'Copied!' : `Copy report ID`}
                        style={{ background: copiedId === bug.report_id ? 'var(--orange-dim)' : 'var(--surface-2)', border: `1px solid ${copiedId === bug.report_id ? 'rgba(249,115,22,.28)' : 'var(--border)'}`, borderRadius: 'var(--r-sm)', padding: '3px 5px', color: copiedId === bug.report_id ? 'var(--orange)' : 'var(--tx-3)', display: 'flex', transition: 'all .15s' }}
                      >
                        {copiedId === bug.report_id ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Pagination ─── */}
      {bugs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-1)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {selected.size > 0 && (
              <>
                <span style={{ fontSize: 11, color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.22)', padding: '1px 7px', borderRadius: 20, fontWeight: 600 }} aria-live="polite">
                  {selected.size} selected
                </span>
                <button onClick={onClearSelection} style={{ fontSize: 11, color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Clear
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>
              {rangeStart}–{rangeEnd} of {bugs.length}
            </span>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              aria-label="Previous page"
              style={{ display: 'flex', alignItems: 'center', padding: '4px 7px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: page === 1 ? 'var(--tx-3)' : 'var(--tx-1)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.45 : 1 }}>
              <ChevronLeft size={13} aria-hidden />
            </button>
            <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>
              {page} / {pageCount}
            </span>
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount}
              aria-label="Next page"
              style={{ display: 'flex', alignItems: 'center', padding: '4px 7px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: page === pageCount ? 'var(--tx-3)' : 'var(--tx-1)', cursor: page === pageCount ? 'not-allowed' : 'pointer', opacity: page === pageCount ? 0.45 : 1 }}>
              <ChevronRight size={13} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
