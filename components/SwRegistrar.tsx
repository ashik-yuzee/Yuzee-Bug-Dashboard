'use client'
import { useEffect } from 'react'

export default function SwRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/ai-sw.js').catch(() => {})
    }
  }, [])
  return null
}
