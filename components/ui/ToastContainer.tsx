'use client'

import { useEffect, useState, useCallback } from 'react'
import toast, { type ToastItem } from '@/lib/toast'
import { X, CheckCircle, AlertTriangle, Info, AlertCircle, Loader2 } from 'lucide-react'

const COLORS: Record<ToastItem['type'], { bar: string; icon: string; bg: string; border: string }> = {
  success: { bar: 'var(--success)',  icon: 'var(--success)',  bg: 'rgba(63,185,80,.08)',    border: 'rgba(63,185,80,.20)' },
  error:   { bar: 'var(--danger)',   icon: 'var(--danger)',   bg: 'rgba(255,123,114,.08)',  border: 'rgba(255,123,114,.20)' },
  warning: { bar: 'var(--warning)',  icon: 'var(--warning)',  bg: 'rgba(227,179,65,.08)',   border: 'rgba(227,179,65,.20)' },
  info:    { bar: 'var(--info)',     icon: 'var(--info)',     bg: 'rgba(88,166,255,.08)',   border: 'rgba(88,166,255,.20)' },
  loading: { bar: 'var(--orange)',   icon: 'var(--orange)',   bg: 'rgba(249,115,22,.08)',   border: 'rgba(249,115,22,.20)' },
}

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  const sz = 16
  if (type === 'success') return <CheckCircle  size={sz} color={COLORS.success.icon} aria-hidden />
  if (type === 'error')   return <AlertCircle  size={sz} color={COLORS.error.icon}   aria-hidden />
  if (type === 'warning') return <AlertTriangle size={sz} color={COLORS.warning.icon} aria-hidden />
  if (type === 'loading') return <Loader2      size={sz} color={COLORS.loading.icon}  className="anim-spin" aria-hidden />
  return                         <Info          size={sz} color={COLORS.info.icon}    aria-hidden />
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const c = COLORS[item.type]
  const [visible, setVisible] = useState(true)

  const startDismiss = useCallback(() => {
    setVisible(false)
    setTimeout(onDismiss, 260) // wait for exit animation
  }, [onDismiss])

  useEffect(() => {
    if (item.duration > 0) {
      const t = setTimeout(startDismiss, item.duration)
      return () => clearTimeout(t)
    }
  }, [item.duration, startDismiss])

  return (
    <div
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 14px',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.bar}`,
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-md)',
        backdropFilter: 'blur(8px)',
        maxWidth: 380, width: '100%',
        animation: `${visible ? 'toastIn' : 'toastOut'} .25s ease both`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1 }}>
        <ToastIcon type={item.type} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', lineHeight: 1.4 }}>
          {item.title}
        </p>
        {item.body && (
          <p style={{ fontSize: 12, color: 'var(--tx-2)', marginTop: 2, lineHeight: 1.5 }}>
            {item.body}
          </p>
        )}
      </div>
      {item.type !== 'loading' && (
        <button
          onClick={startDismiss}
          aria-label="Dismiss notification"
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 'var(--r-sm)',
            background: 'transparent', opacity: 0.6,
            transition: 'opacity .15s, background .15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <X size={13} aria-hidden />
        </button>
      )}
      {/* Progress bar for timed toasts */}
      {item.duration > 0 && item.type !== 'loading' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
          background: c.bar, opacity: 0.35,
          animation: `toastOut ${item.duration}ms linear both`,
          transformOrigin: 'left',
        }} aria-hidden />
      )}
    </div>
  )
}

export default function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const unsubShow = toast._onShow(item => {
      setItems(prev => [...prev.slice(-4), item])  // cap at 5
    })
    const unsubDismiss = toast._onDismiss(id => {
      setItems(prev => prev.filter(i => i.id !== id))
    })
    return () => { unsubShow(); unsubDismiss() }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      aria-label="Notifications"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column-reverse', gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map(item => (
        <div key={item.id} style={{ pointerEvents: 'auto' }}>
          <Toast item={item} onDismiss={() => setItems(prev => prev.filter(i => i.id !== item.id))} />
        </div>
      ))}
    </div>
  )
}
