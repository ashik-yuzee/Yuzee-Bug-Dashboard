'use client'

import { useEffect, useState } from 'react'

export function useNetworkStatus() {
  // Lazy initializer reads the real value on first client render; stays null through SSR
  // (navigator is unavailable there). The effect only subscribes — it never sets state itself.
  const [online, setOnline] = useState<boolean | null>(() => typeof navigator !== 'undefined' ? navigator.onLine : null)

  useEffect(() => {
    const up   = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online',  up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  return { online }
}
