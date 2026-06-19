'use client'

import { useMemo, useId } from 'react'
import type { ParsedBug } from '@/lib/bugUtils'
import type { Filters } from './DashboardClient'
import { X, Search } from 'lucide-react'

interface Props { bugs: ParsedBug[]; filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>>; onClear: () => void }

const SEV_LABELS: Record<string,string> = { P1:'P1 — Critical', P2:'P2 — High', P3:'P3 — Medium', P4:'P4 — Low' }
const SEV_COLOR:  Record<string,string> = { P1:'var(--p1)', P2:'var(--p2)', P3:'var(--p3)', P4:'var(--p4)' }
const STATUS_LABELS: Record<string,string> = { pending:'Pending', triaging:'Triaging', complete:'Complete' }
const ET_LABELS: Record<string,string> = {
  TypeError:'TypeError', NullPointerException:'NullPointerExc.',
  InvokeException:'Jersey/Invoke', HttpError:'HttpError',
  ChunkLoadError:'ChunkLoadError', RateLimit:'RateLimit', Unknown:'Unknown',
}
const MODULE_LABELS: Record<string,string> = {
  WEB:'WEB — Frontend', APP:'APP — Mobile', BACKEND:'BACKEND — Java', INFRASTRUCTURE:'INFRA — AWS',
}
const MODULE_COLOR: Record<string,string> = {
  WEB:'var(--module-web)', APP:'var(--module-app)', BACKEND:'var(--module-be)', INFRASTRUCTURE:'var(--module-infra)',
}

function Group({ label, options, value, onChange, labelMap, colorMap, counts }: {
  label:string; options:string[]; value:string[];
  onChange:(v:string[])=>void; labelMap?:Record<string,string>
  colorMap?:Record<string,string>; counts:Record<string,number>
}) {
  const id = useId()
  if (!options.length) return null
  const toggle = (opt:string) => value.includes(opt) ? onChange(value.filter(v=>v!==opt)) : onChange([...value,opt])

  return (
    <fieldset style={{ border:'none', padding:0, marginBottom:16 }}>
      <legend style={{ fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:7, display:'block' }}>
        {label}
      </legend>
      {options.map(opt => {
        const active = value.includes(opt)
        const col = colorMap?.[opt]
        return (
          <label key={opt} htmlFor={`${id}-${opt}`} style={{
            display:'flex', alignItems:'center', gap:7, cursor:'pointer',
            padding:'4px 6px', borderRadius:'var(--r-sm)', marginBottom:2,
            background: active ? 'var(--orange-dim)' : 'transparent',
            transition:'background .12s',
          }}>
            <input
              id={`${id}-${opt}`}
              type="checkbox"
              checked={active}
              onChange={() => toggle(opt)}
              style={{
                width:13, height:13, borderRadius:3, cursor:'pointer',
                accentColor:'var(--orange)',
              }}
            />
            <span style={{ flex:1, fontSize:12, color: col && active ? col : active ? 'var(--orange)' : 'var(--tx-2)', fontWeight: active ? 600 : 400, lineHeight:1.3 }}>
              {labelMap?.[opt] || opt}
            </span>
            <span style={{ fontSize:10, color:'var(--tx-3)' }}>{counts[opt] ?? 0}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

export default function FilterSidebar({ bugs, filters, setFilters, onClear }: Props) {
  const opts = useMemo(() => {
    const uniq = (arr:(string|null|undefined)[]) => [...new Set(arr.filter(Boolean) as string[])].sort()
    const cnt  = (key:keyof ParsedBug) => {
      const c:Record<string,number>={}
      bugs.forEach(b=>{ const v=b[key] as string; if(v) c[v]=(c[v]||0)+1 })
      return c
    }
    return {
      severity:    { opts:['P1','P2','P3','P4'],                       counts:cnt('severity')    },
      status:      { opts:['pending','triaging','complete'],            counts:cnt('status')      },
      category:    { opts:uniq(bugs.map(b=>b.category)),                counts:cnt('category')    },
      platform:    { opts:uniq(bugs.map(b=>b.platform)),                counts:cnt('platform')    },
      source:      { opts:uniq(bugs.map(b=>b.source)),                  counts:cnt('source')      },
      component:   { opts:uniq(bugs.map(b=>b.component)),               counts:cnt('component')   },
      errorType:   { opts:uniq(bugs.map(b=>b.errorType)),               counts:cnt('errorType')   },
      environment: { opts:uniq(bugs.map(b=>b.environment).filter(Boolean)), counts:cnt('environment') },
      module:      { opts:['WEB','APP','BACKEND','INFRASTRUCTURE'],          counts:cnt('module')      },
    }
  }, [bugs])

  const up = <K extends keyof Filters>(key:K, val:Filters[K]) => setFilters(prev=>({...prev,[key]:val}))

  const hasFilters = !!(filters.search || filters.severity.length || filters.status.length ||
    filters.category.length || filters.platform.length || filters.source.length ||
    filters.component.length || filters.errorType.length || filters.environment.length ||
    filters.module.length ||
    filters.isDuplicate !== 'all' || filters.dateFrom || filters.dateTo)

  return (
    <aside
      aria-label="Filter controls"
      style={{
        width:216, flexShrink:0, background:'var(--surface-1)',
        borderRight:'1px solid var(--border)', overflowY:'auto', padding:'14px 12px',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <span className="font-brand" style={{ fontWeight:600, fontSize:13, color:'var(--tx-1)' }}>Filters</span>
        {hasFilters && (
          <button onClick={onClear} aria-label="Clear all filters" style={{ display:'flex', alignItems:'center', gap:3, color:'var(--orange)', fontSize:11, fontWeight:500, cursor:'pointer' }}>
            <X size={10} aria-hidden /> Clear all
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom:16 }}>
        <label htmlFor="bug-search" style={{ fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.08em', textTransform:'uppercase', display:'block', marginBottom:6 }}>Search</label>
        <div style={{ position:'relative' }}>
          <Search size={12} style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', color:'var(--tx-3)', pointerEvents:'none' }} aria-hidden />
          <input
            id="bug-search"
            type="search"
            value={filters.search}
            onChange={e => up('search', e.target.value)}
            placeholder="ID, error, Jira key…"
            aria-label="Search bugs"
            style={{
              width:'100%', background:'var(--surface-2)', border:'1px solid var(--border)',
              borderRadius:'var(--r-md)', padding:'7px 8px 7px 26px',
              fontSize:12, color:'var(--tx-1)', outline:'none', transition:'border-color .15s',
            }}
            onFocus={e => (e.target as HTMLElement).style.borderColor='var(--orange)'}
            onBlur={e  => (e.target as HTMLElement).style.borderColor='var(--border)'}
          />
          {filters.search && (
            <button onClick={() => up('search','')} aria-label="Clear search" style={{ position:'absolute', right:7, top:'50%', transform:'translateY(-50%)', background:'none', color:'var(--tx-3)', cursor:'pointer', display:'flex' }}>
              <X size={11} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <Group label="Severity"    options={opts.severity.opts}    value={filters.severity}    onChange={v=>up('severity',v)}    labelMap={SEV_LABELS} colorMap={SEV_COLOR} counts={opts.severity.counts} />
      <Group label="Status"      options={opts.status.opts}      value={filters.status}      onChange={v=>up('status',v)}      labelMap={STATUS_LABELS} counts={opts.status.counts} />
      <Group label="Error type"  options={opts.errorType.opts}   value={filters.errorType}   onChange={v=>up('errorType',v)}   labelMap={ET_LABELS} counts={opts.errorType.counts} />
      <Group label="Category"    options={opts.category.opts}    value={filters.category}    onChange={v=>up('category',v)}    counts={opts.category.counts} />
      <Group label="Component"   options={opts.component.opts}   value={filters.component}   onChange={v=>up('component',v)}   counts={opts.component.counts} />
      <Group label="Platform"    options={opts.platform.opts}    value={filters.platform}    onChange={v=>up('platform',v)}    counts={opts.platform.counts} />
      <Group label="Source"      options={opts.source.opts}      value={filters.source}      onChange={v=>up('source',v)}      counts={opts.source.counts} />
      {opts.environment.opts.length > 0 && (
        <Group label="Environment" options={opts.environment.opts} value={filters.environment} onChange={v=>up('environment',v)} counts={opts.environment.counts} />
      )}
      <Group label="Module" options={opts.module.opts} value={filters.module} onChange={v=>up('module',v)} labelMap={MODULE_LABELS} colorMap={MODULE_COLOR} counts={opts.module.counts} />

      {/* Duplicate toggle */}
      <fieldset style={{ border:'none', padding:0, marginBottom:16 }}>
        <legend style={{ fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:7, display:'block' }}>Duplicates</legend>
        <div style={{ display:'flex', gap:5 }} role="group">
          {(['all','yes','no'] as const).map(val => (
            <button
              key={val}
              onClick={() => up('isDuplicate', val)}
              aria-pressed={filters.isDuplicate === val}
              style={{
                flex:1, padding:'5px 0', borderRadius:'var(--r-sm)', fontSize:11, fontWeight:600, textTransform:'capitalize',
                background: filters.isDuplicate===val ? 'var(--orange)' : 'var(--surface-2)',
                color: filters.isDuplicate===val ? '#fff' : 'var(--tx-2)',
                border:`1px solid ${filters.isDuplicate===val ? 'var(--orange)' : 'var(--border)'}`,
                transition:'all .15s',
              }}
            >{val}</button>
          ))}
        </div>
      </fieldset>

      {/* Date range */}
      <fieldset style={{ border:'none', padding:0 }}>
        <legend style={{ fontSize:10, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:7, display:'block' }}>Date range</legend>
        {([['From','dateFrom'],['To','dateTo']] as [string, 'dateFrom'|'dateTo'][]).map(([lbl,key]) => (
          <div key={key} style={{ marginBottom:7 }}>
            <label htmlFor={`date-${key}`} style={{ fontSize:10, color:'var(--tx-3)', display:'block', marginBottom:3 }}>{lbl}</label>
            <input
              id={`date-${key}`}
              type="date"
              value={filters[key]}
              onChange={e => up(key, e.target.value)}
              style={{
                width:'100%', background:'var(--surface-2)', border:'1px solid var(--border)',
                borderRadius:'var(--r-md)', padding:'5px 7px', fontSize:12,
                color:'var(--tx-1)', outline:'none', colorScheme:'dark',
              }}
            />
          </div>
        ))}
      </fieldset>
    </aside>
  )
}
