'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { Calendar, ExternalLink, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import PageInfo from './ui/PageInfo'

type LoadState = 'loading' | 'ready' | 'error'

interface DigestFile {
  name: string
  dateLabel: string
  sortKey: string
  url: string
  sizeKb: number
  updatedAt: string | null
}

const BUCKET = 'bug-reports'

function parseDate(name: string): { sortKey: string; label: string } {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/)
  if (!m) return { sortKey: name, label: name }
  const d = new Date(m[1] + 'T00:00:00')
  return {
    sortKey: m[1],
    label: isNaN(d.getTime()) ? m[1] : d.toLocaleDateString('en-AU', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }),
  }
}

function ReportCard({ file, expanded, onToggle }: { file: DigestFile; expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: 'var(--orange-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={16} color="var(--orange)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.dateLabel}</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)' }}>{file.sizeKb} KB · {file.name}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={file.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--orange)', background: 'var(--orange-dim)', border: '1px solid rgba(249,115,22,.25)', borderRadius: 'var(--r-md)', padding: '7px 10px' }}>
            View Full Report <ExternalLink size={11} />
          </a>
          <button onClick={onToggle} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--tx-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 10px', cursor: 'pointer' }}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? 'Hide' : 'Preview'}
          </button>
        </div>
      </div>
      {expanded && (
        <iframe
          src={file.url}
          title={`Daily report ${file.dateLabel}`}
          sandbox=""
          style={{ width: '100%', height: 480, border: 'none', borderTop: '1px solid var(--border)', background: '#fff' }}
        />
      )}
    </div>
  )
}

export default function DailyDigestTab() {
  const [state, setState] = useState<LoadState>('loading')
  const [files, setFiles] = useState<DigestFile[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [expandedName, setExpandedName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      try {
        const { data, error } = await supabase.storage.from(BUCKET).list('', { sortBy: { column: 'name', order: 'desc' } })
        if (cancelled) return
        if (error) throw error
        const items = (data || [])
          .filter(f => f.name.toLowerCase().endsWith('.html'))
          .map(f => {
            const { sortKey, label } = parseDate(f.name)
            const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(f.name)
            return {
              name: f.name,
              dateLabel: label,
              sortKey,
              url: pub.publicUrl,
              sizeKb: Math.round(((f.metadata as { size?: number } | null)?.size || 0) / 1024),
              updatedAt: f.updated_at || null,
            }
          })
          .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
        setFiles(items)
        setState('ready')
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load daily reports')
          setState('error')
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
      <PageInfo>
        Every night at 9 PM, an n8n workflow summarizes the last 24 hours of bugs with Gemini and saves a full HTML
        report to Supabase Storage (bucket <code>{BUCKET}</code>) — the same report posted to Microsoft Teams. Most
        recent report first; click <strong>Preview</strong> to view it inline or <strong>View Full Report</strong> to open it on its own.
      </PageInfo>

      {state === 'loading' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} h={110} />)}
        </div>
      )}
      {state === 'error' && (
        <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{errorMsg}</p>
      )}
      {state === 'ready' && files.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 16px', textAlign: 'center', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
          <Calendar size={22} color="var(--tx-3)" />
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>No daily reports yet</p>
          <p style={{ fontSize: 12, color: 'var(--tx-3)', maxWidth: 360 }}>
            The first report will appear here after tonight&apos;s 9 PM run of the Daily Bug Report workflow.
          </p>
        </div>
      )}
      {state === 'ready' && files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
          {files.map(f => (
            <ReportCard key={f.name} file={f} expanded={expandedName === f.name} onToggle={() => setExpandedName(prev => prev === f.name ? null : f.name)} />
          ))}
        </div>
      )}
    </div>
  )
}
