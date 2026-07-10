import { NextRequest, NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { searchJiraJql, jiraConfigured } from '@/lib/jiraClient'

interface RawFields {
  status: { name: string; statusCategory: { name: string } }
}

/**
 * POST /api/jira/statuses  { keys: string[] }
 * Batched live status lookup — one Jira call for up to 100 keys at a time,
 * instead of one request per row.
 */
export async function POST(req: NextRequest) {
  const denied = await checkAuth()
  if (denied) return denied
  if (!jiraConfigured()) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const body = await req.json().catch(() => null) as { keys?: string[] } | null
  const keys = [...new Set((body?.keys || []).filter(Boolean))]
  if (keys.length === 0) return NextResponse.json({ statuses: {} })

  const CHUNK = 100
  const chunks: string[][] = []
  for (let i = 0; i < keys.length; i += CHUNK) chunks.push(keys.slice(i, i + CHUNK))

  try {
    const statuses: Record<string, { status: string; statusCategory: string }> = {}

    await Promise.all(chunks.map(async chunk => {
      const jql = `key in (${chunk.join(',')})`
      const result = await searchJiraJql(jql, ['status'], chunk.length)
      for (const issue of result.issues) {
        const f = issue.fields as unknown as RawFields
        statuses[issue.key] = {
          status: f.status?.name ?? 'Unknown',
          statusCategory: f.status?.statusCategory?.name ?? 'Unknown',
        }
      }
    }))

    return NextResponse.json({ statuses })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch Jira statuses'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
