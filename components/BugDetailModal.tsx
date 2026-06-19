'use client'

import { useEffect } from 'react'
import type { BugReport } from './DashboardClient'
import { X, ExternalLink } from 'lucide-react'

interface Props { bug: BugReport; onClose: () => void }

const SEV_COL: Record<string,string> = { P1:'var(--p1)', P2:'var(--p2)', P3:'var(--p3)', P4:'var(--p4)' }

function Field({ label, value, mono }: { label:string; value:React.ReactNode; mono?:boolean }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ marginBottom:10 }}>
      <span style={{ fontSize:11, color:'var(--tx-3)', fontWeight:500, display:'block', marginBottom:2 }}>{label}</span>
      <span style={{ fontSize:13, color:'var(--tx-1)', fontFamily: mono ? 'monospace' : undefined, lineHeight:1.5, wordBreak:'break-word' }}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:20 }}>
      <p style={{ fontSize:11, fontWeight:600, color:'var(--tx-3)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>{title}</p>
      {children}
    </div>
  )
}

export default function BugDetailModal({ bug, onClose }: Props) {
  // Trap focus and handle Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const labels = (() => { try { return JSON.parse(bug.labels || '[]') as string[] } catch { return [] } })()
  const fmt = (d?:string|null) => d ? new Date(d).toLocaleString('en-AU', { dateStyle:'medium', timeStyle:'short' }) : null
  const sevCol = SEV_COL[bug.severity || ''] || 'var(--tx-2)'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Bug detail: ${bug.jira_key || bug.report_id}`}
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position:'fixed', inset:0, zIndex:100,
        background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)',
        display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
      }}
    >
      <div className="anim-slidein" style={{
        width:500, height:'100vh', overflowY:'auto',
        background:'var(--surface-1)', borderLeft:'1px solid var(--border)',
        display:'flex', flexDirection:'column',
      }}>
        {/* Header */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 18px', borderBottom:'1px solid var(--border)',
          position:'sticky', top:0, background:'var(--surface-1)', zIndex:1, flexShrink:0,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{
              fontFamily:'monospace', fontSize:12, fontWeight:700, padding:'2px 8px', borderRadius:'var(--r-sm)',
              background: sevCol + '14', color:sevCol, border:`1px solid ${sevCol}28`,
            }}>
              {bug.severity || '??'}
            </span>
            {bug.jira_key && (
              <a href={bug.jira_url||'#'} target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', alignItems:'center', gap:4, fontFamily:'monospace', fontSize:14, fontWeight:700, color:'var(--info)' }}
                aria-label={`Open ${bug.jira_key} in Jira`}
              >
                {bug.jira_key} <ExternalLink size={12} aria-hidden />
              </a>
            )}
          </div>
          <button onClick={onClose} aria-label="Close detail panel" style={{
            background:'var(--surface-2)', border:'1px solid var(--border)',
            borderRadius:'var(--r-md)', padding:6, color:'var(--tx-2)', display:'flex', transition:'all .15s',
          }}>
            <X size={15} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding:18, flex:1 }}>
          <p style={{ fontSize:14, color:'var(--tx-1)', lineHeight:1.6, marginBottom:18,
            fontFamily: bug.description?.includes('Error') || bug.description?.includes('Exception') ? 'monospace' : undefined }}>
            {bug.description}
          </p>

          {bug.ai_summary && (
            <div style={{ background:'rgba(163,113,247,.08)', border:'1px solid rgba(163,113,247,.20)', borderRadius:'var(--r-md)', padding:'12px 14px', marginBottom:18 }}>
              <p style={{ fontSize:11, fontWeight:600, color:'var(--purple)', marginBottom:5, textTransform:'uppercase', letterSpacing:'.06em' }}>AI Summary</p>
              <p style={{ fontSize:13, color:'var(--tx-2)', lineHeight:1.6 }}>{bug.ai_summary}</p>
            </div>
          )}

          <Section title="Details">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
              <Field label="Status"      value={bug.status} />
              <Field label="Category"    value={bug.category?.replace(/_/g,' ')} />
              <Field label="Component"   value={bug.component} />
              <Field label="Platform"    value={bug.platform} />
              <Field label="Source"      value={bug.source?.replace(/_/g,' ')} />
              <Field label="App version" value={bug.app_version} mono />
              <Field label="Frequency"   value={bug.frequency} />
              <Field label="Location"    value={bug.location} mono />
              <Field label="Reporter"    value={bug.reporter_email} />
              <Field label="Confidence"  value={bug.confidence != null ? `${(bug.confidence*100).toFixed(0)}%` : null} />
              <Field label="Is duplicate" value={bug.is_duplicate ? 'Yes' : 'No'} />
              <Field label="Retry count" value={bug.retry_count?.toString()} />
            </div>
          </Section>

          <Section title="Timestamps">
            <Field label="Reported" value={fmt(bug.created_at)} />
            <Field label="Triaged"  value={fmt(bug.triaged_at)} />
          </Section>

          {labels.length > 0 && (
            <Section title="Labels">
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {labels.map((l:string) => (
                  <span key={l} style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:20, background:'var(--surface-2)', color:'var(--tx-2)', border:'1px solid var(--border)' }}>
                    {l}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section title="Report ID">
            <code style={{ fontFamily:'monospace', fontSize:12, color:'var(--tx-3)', background:'var(--surface-2)', padding:'6px 10px', borderRadius:'var(--r-sm)', display:'block', wordBreak:'break-all' }}>
              {bug.report_id}
            </code>
          </Section>
        </div>
      </div>
    </div>
  )
}
