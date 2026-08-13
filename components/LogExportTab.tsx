'use client'

import { useState, useRef, useCallback } from 'react'
import { Download, Play, Square, CheckCircle, AlertTriangle, FileText, Package, Cloud, Zap, Clock, Activity } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExportConfig {
  runMode: 'ONE_DAY_DOWNLOAD' | 'RANGE_GENERATE'
  selectedDay: string
  rangeMode: 'CUSTOM' | 'LAST_N_DAYS'
  customStartDate: string
  customEndDate: string
  daysToExport: number
  includeToday: boolean
  sources: { cloudwatch: boolean; rollbar: boolean }
}

interface ReadyFile {
  name: string
  content: string  // base64
  sizeBytes: number
  isZip: boolean
  isReduced: boolean
}

interface LogLine {
  text: string
  isWarn: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function nDaysAgoUtc(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1_048_576).toFixed(1)} MB`
}

function triggerDownload(name: string, base64: string, mimeType: string) {
  const binary = atob(base64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  const blob = new Blob([buf], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 15_000)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--tx-3)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>{title}</div>
      <div style={{ padding: '16px 20px' }}>{children}</div>
    </div>
  )
}

function SegmentedControl({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{
      display: 'inline-flex',
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: 3,
      gap: 2,
    }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          padding: '5px 16px',
          borderRadius: 'calc(var(--r-md) - 2px)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          border: 'none',
          transition: 'all .15s',
          background: value === opt.value ? 'var(--surface-1)' : 'transparent',
          color: value === opt.value ? 'var(--tx-1)' : 'var(--tx-3)',
          boxShadow: value === opt.value ? '0 1px 3px rgba(0,0,0,.3)' : 'none',
        }}>{opt.label}</button>
      ))}
    </div>
  )
}

function SourceCard({
  icon, title, subtitle, detail, active, onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  detail: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      padding: '14px 16px',
      borderRadius: 'var(--r-md)',
      border: `2px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
      background: active ? 'rgba(249,115,22,.07)' : 'var(--surface-2)',
      cursor: 'pointer',
      textAlign: 'left',
      transition: 'all .15s',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: active ? 'var(--orange)' : 'var(--tx-3)' }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--tx-1)' : 'var(--tx-2)' }}>{title}</span>
        </div>
        <div style={{
          width: 16, height: 16, borderRadius: '50%',
          border: `2px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
          background: active ? 'var(--orange)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--tx-2)' }}>{subtitle}</div>
      <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>{detail}</div>
    </button>
  )
}

const INPUT: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  color: 'var(--tx-1)',
  fontSize: 13,
  padding: '6px 10px',
  outline: 'none',
  colorScheme: 'dark',
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LogExportTab() {
  const today = todayUtc()

  const [config, setConfig] = useState<ExportConfig>({
    runMode: 'ONE_DAY_DOWNLOAD',
    selectedDay: nDaysAgoUtc(1),
    rangeMode: 'CUSTOM',
    customStartDate: nDaysAgoUtc(7),
    customEndDate: nDaysAgoUtc(1),
    daysToExport: 7,
    includeToday: false,
    sources: { cloudwatch: true, rollbar: true },
  })

  const [running, setRunning] = useState(false)
  const [pct, setPct] = useState(0)
  const [pctMsg, setPctMsg] = useState('')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [files, setFiles] = useState<ReadyFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const appendLog = useCallback((text: string, isWarn = false) => {
    setLogs(prev => [...prev.slice(-500), { text, isWarn }])
    setTimeout(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), 30)
  }, [])

  const set = useCallback((partial: Partial<ExportConfig>) =>
    setConfig(prev => ({ ...prev, ...partial })), [])
  const setSrc = useCallback((partial: Partial<ExportConfig['sources']>) =>
    setConfig(prev => ({ ...prev, sources: { ...prev.sources, ...partial } })), [])

  const startExport = useCallback(async () => {
    setRunning(true); setDone(false); setError(null)
    setLogs([]); setFiles([]); setPct(0); setPctMsg('Starting…')
    abortRef.current = new AbortController()

    try {
      const resp = await fetch('/api/export-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: abortRef.current.signal,
      })
      if (!resp.ok) throw new Error(`Server error ${resp.status}: ${await resp.text()}`)

      const reader = resp.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: end, value } = await reader.read()
        if (end) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          let ev: Record<string, unknown>
          try { ev = JSON.parse(line) } catch { continue }

          switch (ev.type) {
            case 'progress':
              setPct(ev.pct as number)
              setPctMsg(ev.message as string)
              break
            case 'log':
              appendLog(ev.text as string, (ev.text as string).includes('⚠'))
              break
            case 'file':
              setFiles(prev => [...prev, {
                name: ev.name as string,
                content: ev.content as string,
                sizeBytes: ev.sizeBytes as number,
                isZip: false,
                isReduced: (ev.name as string).includes('_reduced'),
              }])
              break
            case 'zip':
              setFiles(prev => [...prev, {
                name: ev.name as string,
                content: ev.content as string,
                sizeBytes: ev.sizeBytes as number,
                isZip: true,
                isReduced: false,
              }])
              appendLog(`📦 ${ev.name as string} (${fmtBytes(ev.sizeBytes as number)})`)
              break
            case 'done':
              setDone(true); setPct(100); setPctMsg('Export complete')
              break
            case 'error':
              throw new Error(ev.message as string)
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
        appendLog(`Error: ${err.message}`, true)
      }
    } finally {
      setRunning(false)
    }
  }, [config, appendLog])

  const stopExport = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    setPctMsg('Stopped')
  }, [])

  const downloadAll = useCallback(() => {
    files.forEach((f, i) => setTimeout(() =>
      triggerDownload(f.name, f.content, f.isZip ? 'application/zip' : 'text/csv'), i * 250))
  }, [files])

  const isRangeMode = config.runMode === 'RANGE_GENERATE'
  const isCustomRange = config.rangeMode === 'CUSTOM'
  const noSources = !config.sources.cloudwatch && !config.sources.rollbar
  const zipFile = files.find(f => f.isZip)
  const csvFiles = files.filter(f => !f.isZip)
  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Page header */}
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--tx-1)' }}>Log Export</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--tx-3)', lineHeight: 1.5 }}>
            Export CloudWatch error logs and Rollbar occurrences for any time window.
            CloudWatch logs are automatically reduced to key fields for LLM analysis.
          </p>
        </div>

        {/* ── Time Window ──────────────────────────────────────────────────── */}
        <SectionCard title="Time Window">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <FieldLabel>Mode</FieldLabel>
              <SegmentedControl
                value={config.runMode}
                onChange={v => set({ runMode: v as ExportConfig['runMode'] })}
                options={[
                  { value: 'ONE_DAY_DOWNLOAD', label: 'Single Day' },
                  { value: 'RANGE_GENERATE', label: 'Date Range' },
                ]}
              />
              <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 6 }}>
                {isRangeMode
                  ? 'Produces one ZIP per day across the selected range.'
                  : 'Produces one ZIP for a single UTC day.'}
              </div>
            </div>

            {!isRangeMode && (
              <div>
                <FieldLabel>Date (UTC)</FieldLabel>
                <input type="date" value={config.selectedDay} max={today}
                  onChange={e => set({ selectedDay: e.target.value })} style={INPUT} />
              </div>
            )}

            {isRangeMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <FieldLabel>Range Type</FieldLabel>
                  <SegmentedControl
                    value={config.rangeMode}
                    onChange={v => set({ rangeMode: v as ExportConfig['rangeMode'] })}
                    options={[
                      { value: 'CUSTOM', label: 'Custom Dates' },
                      { value: 'LAST_N_DAYS', label: 'Last N Days' },
                    ]}
                  />
                </div>

                {isCustomRange ? (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <FieldLabel>Start Date (UTC)</FieldLabel>
                      <input type="date" value={config.customStartDate} max={today}
                        onChange={e => set({ customStartDate: e.target.value })} style={INPUT} />
                    </div>
                    <div>
                      <FieldLabel>End Date (UTC)</FieldLabel>
                      <input type="date" value={config.customEndDate}
                        min={config.customStartDate} max={today}
                        onChange={e => set({ customEndDate: e.target.value })} style={INPUT} />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <FieldLabel>Days to Export</FieldLabel>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" min={1} max={90} value={config.daysToExport}
                          onChange={e => set({ daysToExport: Math.max(1, parseInt(e.target.value) || 7) })}
                          style={{ ...INPUT, width: 70 }} />
                        <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>days</span>
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: 'var(--tx-2)', paddingBottom: 7 }}>
                      <input type="checkbox" checked={config.includeToday}
                        onChange={e => set({ includeToday: e.target.checked })}
                        style={{ accentColor: 'var(--orange)', width: 14, height: 14 }} />
                      Include today (partial data)
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Sources ──────────────────────────────────────────────────────── */}
        <SectionCard title="Sources">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <SourceCard
              icon={<Cloud size={16} />}
              title="CloudWatch"
              subtitle="31 log groups · ap-southeast-1"
              detail="Reduced to key fields — AI-ready CSV"
              active={config.sources.cloudwatch}
              onClick={() => setSrc({ cloudwatch: !config.sources.cloudwatch })}
            />
            <SourceCard
              icon={<Zap size={16} />}
              title="Rollbar"
              subtitle="Web + App projects"
              detail="All occurrences with full context"
              active={config.sources.rollbar}
              onClick={() => setSrc({ rollbar: !config.sources.rollbar })}
            />
          </div>
          {noSources && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--warning)' }}>
              <AlertTriangle size={12} aria-hidden /> Select at least one source to export.
            </div>
          )}
        </SectionCard>

        {/* ── Run / Stop ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', padding: '14px 20px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>
              {isRangeMode ? 'Generate range export' : 'Export single day'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
              {noSources ? 'Select at least one source above.' : isRangeMode
                ? 'Streams one ZIP per day — keep this tab open.'
                : 'Downloads a single ZIP when complete.'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {done && !running && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                <CheckCircle size={14} aria-hidden />
                {files.length} file{files.length !== 1 ? 's' : ''} ready
                {totalBytes > 0 && <span style={{ fontWeight: 400, color: 'var(--tx-3)' }}>· {fmtBytes(totalBytes)}</span>}
              </span>
            )}
            {!running ? (
              <button onClick={startExport} disabled={noSources} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
                background: noSources ? 'var(--surface-2)' : 'var(--orange)',
                color: noSources ? 'var(--tx-3)' : '#fff',
                border: `1px solid ${noSources ? 'var(--border)' : 'var(--orange)'}`,
                borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700,
                cursor: noSources ? 'not-allowed' : 'pointer',
                transition: 'opacity .15s', flexShrink: 0,
              }}>
                <Play size={14} aria-hidden /> Export Logs
              </button>
            ) : (
              <button onClick={stopExport} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
                background: 'rgba(239,68,68,.1)', color: 'var(--danger)',
                border: '1px solid rgba(239,68,68,.3)',
                borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
              }}>
                <Square size={14} aria-hidden /> Stop Export
              </button>
            )}
          </div>
        </div>

        {/* ── Progress ─────────────────────────────────────────────────────── */}
        {(running || logs.length > 0) && (
          <div style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}>
            {/* Status bar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {running ? (
                  <Activity size={13} color="var(--orange)" aria-hidden style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                ) : done ? (
                  <CheckCircle size={13} color="var(--success)" aria-hidden />
                ) : (
                  <Clock size={13} color="var(--tx-3)" aria-hidden />
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: done ? 'var(--success)' : 'var(--tx-1)' }}>
                  {pctMsg || 'Running…'}
                </span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 2, background: 'var(--surface-2)' }}>
              <div style={{
                height: '100%', transition: 'width .5s ease',
                background: done ? 'var(--success)' : 'var(--orange)',
                width: `${pct}%`,
              }} />
            </div>

            {/* Log output */}
            <div ref={logRef} style={{
              fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7,
              maxHeight: 200, overflowY: 'auto', overflowX: 'hidden',
              padding: '10px 14px',
            }}>
              {logs.length === 0 && (
                <span style={{ color: 'var(--tx-3)' }}>Initialising export…</span>
              )}
              {logs.map((l, i) => (
                <div key={i} style={{ color: l.isWarn ? 'var(--warning)' : 'var(--tx-3)', wordBreak: 'break-all' }}>
                  {l.text}
                </div>
              ))}
              {running && <span style={{ color: 'var(--orange)' }}>▌</span>}
            </div>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────────── */}
        {error && (
          <div role="alert" style={{
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
            borderRadius: 'var(--r-lg)', padding: '12px 16px',
            display: 'flex', gap: 10, color: 'var(--danger)', fontSize: 13,
          }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
            <div>
              <div style={{ fontWeight: 700 }}>Export failed</div>
              <div style={{ fontSize: 12, marginTop: 3, opacity: 0.85 }}>{error}</div>
            </div>
          </div>
        )}

        {/* ── Files ────────────────────────────────────────────────────────── */}
        {files.length > 0 && (
          <div style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}>
            {/* Files header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {done
                  ? <CheckCircle size={13} color="var(--success)" aria-hidden />
                  : <Activity size={13} color="var(--orange)" aria-hidden />}
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)' }}>
                  {done ? 'Files Ready' : 'Files (generating…)'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                  {files.length} file{files.length !== 1 ? 's' : ''} · {fmtBytes(totalBytes)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {zipFile && (
                  <button onClick={() => triggerDownload(zipFile.name, zipFile.content, 'application/zip')} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
                    background: 'var(--orange)', color: '#fff',
                    border: 'none', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                    <Package size={12} aria-hidden /> Download ZIP
                  </button>
                )}
                {csvFiles.length > 1 && (
                  <button onClick={downloadAll} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
                    background: 'var(--surface-1)', color: 'var(--tx-2)',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}>
                    <Download size={12} aria-hidden /> All Files
                  </button>
                )}
              </div>
            </div>

            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>

              {/* ZIP entry */}
              {zipFile && (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 'var(--r-md)',
                    background: 'rgba(249,115,22,.07)', border: '1px solid rgba(249,115,22,.2)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Package size={16} color="var(--orange)" aria-hidden style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--orange)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {zipFile.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 1 }}>
                          Contains all {csvFiles.length} CSV file{csvFiles.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{fmtBytes(zipFile.sizeBytes)}</span>
                      <button onClick={() => triggerDownload(zipFile.name, zipFile.content, 'application/zip')} style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '5px 14px',
                        background: 'var(--orange)', color: '#fff', border: 'none',
                        borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}>
                        <Download size={10} aria-hidden /> Download
                      </button>
                    </div>
                  </div>

                  {csvFiles.length > 0 && (
                    <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                  )}
                </>
              )}

              {/* Individual CSV files */}
              {csvFiles.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 12px', borderRadius: 'var(--r-md)',
                  background: f.isReduced ? 'rgba(139,92,246,.05)' : 'var(--surface-2)',
                  border: `1px solid ${f.isReduced ? 'rgba(139,92,246,.18)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                    <FileText size={13} color={f.isReduced ? '#8b5cf6' : 'var(--tx-3)'} aria-hidden style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: f.isReduced ? 600 : 400,
                        color: f.isReduced ? '#8b5cf6' : 'var(--tx-1)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {f.name}
                      </div>
                      {f.isReduced && (
                        <div style={{ fontSize: 10, color: '#8b5cf6', marginTop: 1 }}>
                          AI-ready — paste directly into Claude or ChatGPT
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{fmtBytes(f.sizeBytes)}</span>
                    <button onClick={() => triggerDownload(f.name, f.content, 'text/csv')} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                      background: 'var(--surface-1)', color: 'var(--tx-2)',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>
                      <Download size={10} aria-hidden /> Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
