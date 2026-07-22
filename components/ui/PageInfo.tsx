'use client'

import { useState, useId, useEffect } from 'react'
import { Info, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  children: React.ReactNode
  /** Optional stable key for this page's collapse preference (defaults to a random id, i.e. not persisted). */
  storageKey?: string
}

/**
 * A small "what am I looking at" explainer shown at the top of every tab.
 * Collapsible (and remembers the collapsed state per page) so it stays out of
 * the way for people who've already read it, without ever fully disappearing.
 */
export default function PageInfo({ children, storageKey }: Props) {
  const autoId = useId()
  const key = `yuzee-pageinfo-collapsed-${storageKey || autoId}`
  const [collapsed, setCollapsed] = useState(false)
  // Deferred a tick so the effect body itself never synchronously calls a state
  // setter (matches the sidebar-collapse pattern) — also avoids any hydration
  // mismatch since the server always renders the expanded (collapsed=false) state.
  useEffect(() => {
    const id = setTimeout(() => {
      if (localStorage.getItem(key) === '1') setCollapsed(true)
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(key, next ? '1' : '0')
      return next
    })
  }

  return (
    <div style={{
      display: 'flex', alignItems: collapsed ? 'center' : 'flex-start', gap: 9,
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      padding: collapsed ? '6px 12px' : '10px 14px', marginBottom: 16,
    }}>
      <Info size={14} color="var(--info)" style={{ flexShrink: 0, marginTop: collapsed ? 0 : 1 }} />
      {!collapsed && (
        <p style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.6, flex: 1 }}>{children}</p>
      )}
      {collapsed && <span style={{ fontSize: 12, color: 'var(--tx-3)', flex: 1 }}>What is this page?</span>}
      <button
        onClick={toggle}
        aria-label={collapsed ? 'Show page explanation' : 'Hide page explanation'}
        style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', color: 'var(--tx-3)', cursor: 'pointer', padding: 2 }}
      >
        {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>
    </div>
  )
}
