'use client'

import { useState } from 'react'
import type { ParsedBug } from '@/lib/bugUtils'
import type { BugReport, SortConfig } from './DashboardClient'
import { ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown, Eye, Clipboard, Check } from 'lucide-react'

interface Props {
  bugs: ParsedBug[]; total: number; selected: Set<string>
  onToggle: (id: string) => void; onSelectAll: () => void; onClearSelection: () => void
  sort: SortConfig; onSort: (s: SortConfig) => void; onDetail: (b: ParsedBug) => void
  onClearFilters: () => void; hasActiveFilters: boolean
}

const SEV_CLS: Record<string, string> = { P1:'badge-p1', P2:'badge-p2', P3:'badge-p3', P4:'badge-p4' }

const STATUS: Record<string, { bg:string; color:string; dot:string }> = {
  complete: { bg:'rgba(63,185,80,.10)',  color:'var(--success)', dot:'var(--success)' },
  pending:  { bg:'rgba(227,179,65,.10)', color:'var(--warning)', dot:'var(--warning)' },
  triaging: { bg:'rgba(163,113,247,.10)',color:'var(--purple)',  dot:'var(--purple)'  },
}

const ET: Record<string, { color:string; label:string }> = {
  TypeError:          { color:'var(--p1)',     label:'TypeError' },
  NullPointerException:{ color:'var(--p2)',    label:'NPE'       },
  InvokeException:    { color:'var(--purple)', label:'Jersey'    },
  HttpError:          { color:'var(--p3)',     label:'HTTP'      },
  ChunkLoadError:     { color:'var(--success)',label:'Chunk'     },
  RateLimit:          { color:'var(--tx-3)',   label:'RateLimit' },
  Unimplemented:      { color:'var(--tx-3)',   label:'NI'        },
  Unknown:            { color:'var(--tx-3)',   label:'?'         },
}

function SortBtn({ col, sort, onSort, label }: { col:keyof BugReport; sort:SortConfig; onSort:(s:SortConfig)=>void; label:string }) {
  const active = sort.key === col
  const icon = !active
    ? <ChevronsUpDown size={11} style={{ opacity:.3 }} aria-hidden />
    : sort.dir === 'asc'
    ? <ChevronUp size={11} color="var(--orange)" aria-hidden />
    : <ChevronDown size={11} color="var(--orange)" aria-hidden />

  return (
    <button
      onClick={() => onSort({ key:col, dir: sort.key===col && sort.dir==='asc' ? 'desc' : 'asc' })}
      aria-label={`Sort by ${label} ${sort.key===col ? (sort.dir==='asc'?'descending':'ascending') : 'ascending'}`}
      aria-sort={active ? (sort.dir==='asc'?'ascending':'descending') : 'none'}
      style={{
        display:'flex', alignItems:'center', gap:3, padding:'8px 10px',
        fontSize:10, fontWeight:600, letterSpacing:'.07em', textTransform:'uppercase',
        color: active ? 'var(--orange)' : 'var(--tx-3)',
        background:'none', border:'none', cursor:'pointer', whiteSpace:'nowrap',
      }}
    >
      {label} {icon}
    </button>
  )
}

function Checkbox({ id, checked, indeterminate, onClick, label }: {
  id:string; checked:boolean; indeterminate?:boolean; onClick:()=>void; label:string
}) {
  return (
    <div
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick()}
      style={{
        width:15, height:15, borderRadius:'var(--r-sm)', cursor:'pointer', flexShrink:0,
        border:`2px solid ${checked||indeterminate ? 'var(--orange)' : 'var(--border-hi)'}`,
        background: checked ? 'var(--orange)' : indeterminate ? 'var(--orange-dim)' : 'transparent',
        display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
      }}
    >
      {checked && <Check size={9} color="#fff" strokeWidth={3} aria-hidden />}
      {indeterminate && !checked && <div style={{ width:7, height:2, background:'var(--orange)', borderRadius:1 }} aria-hidden />}
    </div>
  )
}

export default function BugTable({ bugs, total, selected, onToggle, onSelectAll, onClearSelection, sort, onSort, onDetail, onClearFilters, hasActiveFilters }: Props) {
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const allChecked = bugs.length > 0 && selected.size === bugs.length
  const someChecked = selected.size > 0 && !allChecked
  const fmt = (d:string) => new Date(d).toLocaleDateString('en-AU', { day:'2-digit', month:'short' })

  const copyId = (id:string) => {
    navigator.clipboard.writeText(id)
      .then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 1600) })
      .catch(() => {})
  }

  return (
    <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
      {/* Toolbar */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'9px 14px', borderBottom:'1px solid var(--border)',
        background:'var(--surface-1)', flexShrink:0,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:13, color:'var(--tx-2)' }}>
            <strong style={{ color:'var(--tx-1)' }}>{bugs.length}</strong>
            {hasActiveFilters && <span style={{ color:'var(--tx-3)' }}> of {total}</span>}
            {' '}bug{bugs.length !== 1 ? 's' : ''}
          </span>
          {selected.size > 0 && (
            <>
              <span style={{
                fontSize:11, color:'var(--orange)', background:'var(--orange-dim)',
                border:'1px solid rgba(249,115,22,.22)', padding:'1px 7px', borderRadius:20, fontWeight:600,
              }} aria-live="polite">
                {selected.size} selected
              </span>
              <button onClick={onClearSelection} style={{ fontSize:11, color:'var(--tx-3)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                Clear selection
              </button>
            </>
          )}
        </div>
        {hasActiveFilters && (
          <button onClick={onClearFilters} style={{ fontSize:11, color:'var(--tx-3)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex:1, overflow:'auto' }} role="region" aria-label="Bug reports table">
        {bugs.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:300, gap:14 }} role="status">
            <span style={{ fontSize:36 }} aria-hidden>🔍</span>
            <div style={{ textAlign:'center' }}>
              <p style={{ fontSize:14, fontWeight:600, color:'var(--tx-1)', marginBottom:6 }}>No bugs match your filters</p>
              {hasActiveFilters && (
                <button onClick={onClearFilters} style={{ fontSize:13, color:'var(--orange)', background:'none', border:'none', cursor:'pointer', fontWeight:500 }}>
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:1000 }} role="table">
            <thead>
              <tr style={{ background:'var(--surface-2)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:10 }}>
                <th scope="col" style={{ padding:'8px 10px', width:34 }}>
                  <Checkbox
                    id="select-all"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onClick={onSelectAll}
                    label={allChecked ? 'Deselect all bugs' : someChecked ? 'Select all bugs' : 'Select all bugs'}
                  />
                </th>
                {([
                  ['severity','Sev'], ['jira_key','Jira'], ['description','Error'],
                  ['status','Status'], ['category','Category'], ['component','Comp.'],
                  ['platform','Platform'], ['source','Source'], ['created_at','Date'],
                ] as [keyof BugReport, string][]).map(([col, label]) => (
                  <th scope="col" key={col} style={{ padding:0, textAlign:'left' }}>
                    <SortBtn col={col} sort={sort} onSort={onSort} label={label} />
                  </th>
                ))}
                <th scope="col" style={{ padding:'8px 10px', fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.07em', textTransform:'uppercase' }}>Type</th>
                <th scope="col" style={{ padding:'8px 10px', fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.07em', textTransform:'uppercase' }}>Env</th>
                <th scope="col" style={{ padding:'8px 10px' }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {bugs.map((bug, i) => {
                const isSelected = selected.has(bug.report_id)
                const st  = STATUS[bug.status || ''] || { bg:'rgba(125,133,144,.10)', color:'var(--tx-3)', dot:'var(--tx-3)' }
                const et  = ET[bug.errorType] || ET.Unknown
                const rowBg = isSelected ? 'rgba(249,115,22,.06)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)'

                return (
                  <tr
                    key={bug.report_id}
                    style={{ background:rowBg, borderBottom:'1px solid var(--border)', transition:'background .12s' }}
                    onMouseEnter={e => { if(!isSelected)(e.currentTarget as HTMLElement).style.background='var(--hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background=rowBg }}
                  >
                    <td style={{ padding:'9px 10px' }}>
                      <Checkbox id={`row-${bug.report_id}`} checked={isSelected} onClick={() => onToggle(bug.report_id)} label={`Select ${bug.jira_key || bug.report_id}`} />
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span className={`badge ${SEV_CLS[bug.severity||'']||'badge-p4'}`} style={{ fontFamily:'monospace' }}>
                        {bug.severity || '—'}
                      </span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      {bug.jira_key ? (
                        <a href={bug.jira_url||'#'} target="_blank" rel="noopener noreferrer"
                          style={{ display:'flex', alignItems:'center', gap:3, fontFamily:'monospace', fontSize:11, fontWeight:600, color:'var(--info)', whiteSpace:'nowrap' }}
                          aria-label={`Open ${bug.jira_key} in Jira`}
                        >
                          {bug.jira_key} <ExternalLink size={9} aria-hidden />
                        </a>
                      ) : <span style={{ fontSize:11, color:'var(--warning)' }}>no ticket</span>}
                    </td>

                    <td style={{ padding:'9px 10px', maxWidth:280 }}>
                      <p style={{
                        fontSize:11, color:'var(--tx-1)', overflow:'hidden', textOverflow:'ellipsis',
                        whiteSpace:'nowrap', maxWidth:280,
                        fontFamily: bug.errorType !== 'Unknown' ? 'monospace' : 'inherit',
                      }} title={bug.description || undefined}>
                        {bug.description || '—'}
                      </p>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:st.bg, color:st.color }}>
                        <span style={{ width:5, height:5, borderRadius:'50%', background:st.dot, flexShrink:0 }} aria-hidden />
                        {bug.status || '—'}
                      </span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:11, color:'var(--tx-2)', textTransform:'capitalize' }}>{bug.category?.replace(/_/g,' ')||'—'}</span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:11, color:'var(--tx-2)' }}>{bug.component||'—'}</span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:11, color:'var(--tx-3)', textTransform:'capitalize' }}>{bug.platform||'—'}</span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span style={{ fontSize:11, fontWeight:500, color: bug.source==='rollbar_auto'?'var(--info)': bug.source==='user_report'?'var(--success)':'var(--tx-3)' }}>
                        {bug.source?.replace(/_/g,' ')||'—'}
                      </span>
                    </td>

                    <td style={{ padding:'9px 10px', whiteSpace:'nowrap', fontSize:11, color:'var(--tx-3)' }}>
                      {fmt(bug.created_at)}
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <span title={bug.errorType} style={{ fontSize:10, fontWeight:700, color:et.color, background:et.color+'16', padding:'1px 5px', borderRadius:3, cursor:'default' }}>
                        {et.label}
                      </span>
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      {bug.environment && (
                        <span style={{ fontSize:10, color: bug.environment==='production'?'var(--danger)':'var(--tx-3)', background:'var(--surface-2)', padding:'1px 5px', borderRadius:3 }}>
                          {bug.environment}
                        </span>
                      )}
                    </td>

                    <td style={{ padding:'9px 10px' }}>
                      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                        <button
                          onClick={() => onDetail(bug)}
                          aria-label={`View details for ${bug.jira_key || bug.report_id}`}
                          style={{ background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', padding:'4px 6px', color:'var(--tx-2)', display:'flex', transition:'all .15s' }}
                        >
                          <Eye size={12} aria-hidden />
                        </button>
                        <button
                          onClick={() => copyId(bug.report_id)}
                          aria-label={copiedId===bug.report_id ? 'Copied!' : `Copy report ID ${bug.report_id}`}
                          style={{
                            background: copiedId===bug.report_id ? 'var(--orange-dim)' : 'var(--surface-2)',
                            border:`1px solid ${copiedId===bug.report_id ? 'rgba(249,115,22,.28)' : 'var(--border)'}`,
                            borderRadius:'var(--r-sm)', padding:'4px 6px',
                            color: copiedId===bug.report_id ? 'var(--orange)' : 'var(--tx-3)',
                            display:'flex', transition:'all .15s',
                          }}
                        >
                          {copiedId===bug.report_id ? <Check size={12} aria-hidden /> : <Clipboard size={12} aria-hidden />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
