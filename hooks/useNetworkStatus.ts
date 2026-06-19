'use client'

import { useEffect, useState } from 'react'

export function useNetworkStatus() {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    setOnline(navigator.onLine)
    const up   = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online',  up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  return { online }
}
