'use client'

import { useEffect, useState, useCallback } from 'react'

export interface JiraTicket {
  key: string
  summary: string
  status: string
  statusCategory: string
  priority: string
  assignee: { name: string; email: string; avatar: string } | null
  created: string
  updated: string
  labels: string[]
  url: string
}

export interface JiraSpacesData {
  ysc: JiraTicket[]
  yscIsLast: boolean
  ysdt: JiraTicket[]
  ysdtIsLast: boolean
  lastFetched: string | null
}

const EMPTY: JiraSpacesData = {
  ysc: [], yscIsLast: true,
  ysdt: [], ysdtIsLast: true,
  lastFetched: null,
}

async function fetchSpacesData(): Promise<{ data: JiraSpacesData; error: string | null }> {
  try {
    const res = await fetch('/api/jira/spaces')
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    const json = await res.json() as JiraSpacesData
    return { data: json, error: null }
  } catch (err) {
    return { data: EMPTY, error: err instanceof Error ? err.message : 'Failed to load Jira spaces' }
  }
}

export function useJiraSpaces() {
  const [data, setData] = useState<JiraSpacesData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await fetchSpacesData()
      if (cancelled) return
      if (result.error === null) setData(result.data)
      setError(result.error)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [refreshToken])

  const refresh = useCallback(() => setRefreshToken(t => t + 1), [])

  return { data, loading, error, refresh }
}
