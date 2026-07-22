'use client'

import { useMemo, useState } from 'react'
import { useFeedbackReports } from '@/hooks/useFeedbackReports'
import { jiraUrl } from '@/lib/utils'
import { SkeletonCard } from '@/components/ui/Skeleton'
import PageInfo from './ui/PageInfo'
import { RefreshCw, ExternalLink, Check, Minus, MessageSquare } from 'lucide-react'

const SENTIMENT_STYLE: Record<string, { bg: string; color: string }> = {
  positive: { bg: 'rgba(63,185,80,.12)', color: 'var(--success)' },
  negative: { bg: 'rgba(248,81,73,.12)', color: 'var(--danger)' },
  neutral:  { bg: 'rgba(125,133,144,.12)', color: 'var(--tx-3)' },
}

const SEV_COL: Record<string, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)' }

function fmtTs(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Pill({ label, color, bg }: { label: string; color: string; bg?: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg || color + '18', color, border: `1px solid ${color}40`, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
      {label}
    </span>
  )
}

export default function FeedbackReportsTab() {
  const { reports, loading, error, refresh } = useFeedbackReports()
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [actionableFilter, setActionableFilter] = useState('all')

  const categories = useMemo(() => [...new Set(reports.map(r => r.ai_category).filter(Boolean))] as string[], [reports])

  const filtered = useMemo(() => reports.filter(r =>
    (sentimentFilter === 'all' || r.ai_sentiment === sentimentFilter) &&
    (categoryFilter === 'all' || r.ai_category === categoryFilter) &&
    (actionableFilter === 'all' || (actionableFilter === 'yes' ? r.ai_actionable === true : r.ai_actionable !== true))
  ), [reports, sentimentFilter, categoryFilter, actionableFilter])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageInfo storageKey="feedback">
        In-app product feedback — a separate stream from automated bug reports, submitted through the app&apos;s own
        feedback form and classified by Gemini into sentiment and category.
      </PageInfo>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--tx-1)' }}>Feedback Reports</p>
            <p style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>In-app product feedback — separate from automated bug reports</p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
              <option value="all">All sentiment</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
              <option value="all">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={actionableFilter} onChange={e => setActionableFilter(e.target.value)} style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--tx-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 7px' }}>
              <option value="all">Actionable: all</option>
              <option value="yes">Actionable only</option>
              <option value="no">Non-actionable</option>
            </select>
            <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--tx-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '4px 9px', cursor: 'pointer' }}>
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 16 }}><SkeletonCard h={200} /></div>
        ) : error ? (
          <p style={{ fontSize: 13, color: 'var(--danger)', padding: 16 }}>{error}</p>
        ) : reports.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '40px 16px', textAlign: 'center' }}>
            <MessageSquare size={26} color="var(--tx-3)" />
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>No feedback submissions yet</p>
            <p style={{ fontSize: 12, color: 'var(--tx-3)', maxWidth: 340 }}>
              Feedback submitted through the in-app feedback form will appear here once triaged by Gemini.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  {['Source', 'Category', 'Sentiment', 'Summary', 'Feature Area', 'Actionable', 'Severity', 'Jira Key', 'Created At'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: 'var(--tx-3)' }}>No feedback matches your filters</td></tr>
                ) : filtered.map(r => {
                  const jl = jiraUrl(r.jira_key)
                  const sentStyle = SENTIMENT_STYLE[r.ai_sentiment || 'neutral'] || SENTIMENT_STYLE.neutral
                  return (
                    <tr key={r.feedback_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.source}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.ai_category || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>{r.ai_sentiment ? <Pill label={r.ai_sentiment} color={sentStyle.color} bg={sentStyle.bg} /> : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--tx-1)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ai_summary || r.message || ''}>
                        {r.ai_summary || r.message || '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-2)' }}>{r.feature_area || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>{r.ai_actionable ? <Check size={13} color="var(--success)" /> : <Minus size={13} color="var(--tx-3)" />}</td>
                      <td style={{ padding: '9px 12px' }}>{r.severity ? <Pill label={r.severity} color={SEV_COL[r.severity] || 'var(--tx-2)'} /> : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>—</span>}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {jl ? (
                          <a href={jl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            {r.jira_key} <ExternalLink size={10} />
                          </a>
                        ) : <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--tx-3)', whiteSpace: 'nowrap' }}>{fmtTs(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
