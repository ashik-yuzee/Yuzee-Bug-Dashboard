'use client'

import { useEffect, useState, useRef } from 'react'

export interface JiraStatusInfo { status: string; statusCategory: string }

/**
 * Live Jira status per key, fetched in one batched call (see
 * /api/jira/statuses) rather than one request per bug row.
 */
export function useJiraStatuses(jiraKeys: (string | null | undefined)[]) {
  const [fetchedStatuses, setFetchedStatuses] = useState<Record<string, JiraStatusInfo>>({})
  const [loading, setLoading] = useState(false)
  const lastKeysRef = useRef<string>('')

  const uniqueSorted = [...new Set(jiraKeys.filter((k): k is string => !!k))].sort()
  const keySignature = uniqueSorted.join(',')

  useEffect(() => {
    if (keySignature === lastKeysRef.current) return
    lastKeysRef.current = keySignature
    // Nothing to fetch — the empty case is derived below without touching state.
    if (uniqueSorted.length === 0) return

    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/jira/statuses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: uniqueSorted }),
        })
        const json = await res.json()
        if (!cancelled) setFetchedStatuses(json.statuses || {})
      } catch {
        if (!cancelled) setFetchedStatuses({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature])

  const statuses = uniqueSorted.length === 0 ? {} : fetchedStatuses
  return { statuses, loading }
}
