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
  ysdp: JiraTicket[]
  ysdpTotal: number
  ysc: JiraTicket[]
  yscTotal: number
  ysdt: JiraTicket[]
  ysdtTotal: number
  lastFetched: string | null
}

const EMPTY: JiraSpacesData = {
  ysdp: [], ysdpTotal: 0,
  ysc: [], yscTotal: 0,
  ysdt: [], ysdtTotal: 0,
  lastFetched: null,
}

export function useJiraSpaces() {
  const [data, setData] = useState<JiraSpacesData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSpaces = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/jira/spaces')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as JiraSpacesData
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Jira spaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSpaces() }, [fetchSpaces])

  return { data, loading, error, refresh: fetchSpaces }
}
