import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { searchJiraJqlAll, jiraConfigured, jiraBrowseUrl } from '@/lib/jiraClient'
import { createClient } from '@/lib/supabase/server'

const SPACE_YSC  = process.env.JIRA_SPACE_YSC  || 'YSC'
const SPACE_YSDT = process.env.JIRA_SPACE_YSDT || 'YSDT'
const FIELDS = ['summary', 'description', 'status', 'priority', 'assignee', 'labels', 'issuetype', 'created', 'updated']

interface RawFields {
  summary?: string
  description?: unknown
  status?: { name?: string }
  priority?: { name?: string }
  assignee?: { displayName?: string } | null
  labels?: string[]
  issuetype?: { name?: string }
  created?: string
  updated?: string
}

// Jira priority names → the dashboard's P1–P4 scale (inverse of the P1→Highest mapping
// used when the automation creates tickets — see app/api/jira/route.ts's priorityMap).
const PRIORITY_TO_P: Record<string, string> = {
  highest: 'P1', high: 'P2', medium: 'P3', low: 'P4', lowest: 'P4',
}

// Best-effort mapping from whatever status names this Jira project actually uses to our
// 4-column workflow. Adjust here if your real YSC workflow uses different status names —
// this couldn't be verified against live data because the configured Jira account currently
// has no Browse Projects permission on YSC (see CLAUDE.md for the full diagnosis).
function mapStatus(name: string | undefined): 'todo' | 'in_progress' | 'in_review' | 'done' {
  const s = (name || '').toLowerCase()
  if (/done|closed|resolved|complete/.test(s)) return 'done'
  if (/review/.test(s)) return 'in_review'
  if (/progress|doing/.test(s)) return 'in_progress'
  return 'todo'
}

function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) return n.content.map(adfToPlainText).join(n.type === 'paragraph' ? '\n' : '')
  return ''
}

// Strip lone Unicode surrogates (U+D800–U+DFFF) that Postgres rejects with 22P02.
// These appear in Jira ticket text when emoji are encoded as unpaired surrogates.
function stripSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDFFF]/g, '�')
}

/** POST /api/jira/sync-tickets — mirrors every YSC issue into internal_tickets (upsert by jira_key). */
export async function POST() {
  const denied = await checkAuth()
  if (denied) return denied

  if (!jiraConfigured()) {
    return NextResponse.json({ error: 'Jira not configured — JIRA_API_KEY missing' }, { status: 503 })
  }

  function mapIssues(issues: Awaited<ReturnType<typeof searchJiraJqlAll>>) {
    return issues.map(issue => {
      const f = issue.fields as RawFields
      const priorityName = (f.priority?.name || '').toLowerCase()
      return {
        ticket_key: issue.key,
        jira_key: issue.key,
        jira_url: jiraBrowseUrl(issue.key),
        title: stripSurrogates((f.summary || issue.key).slice(0, 500)),
        description: stripSurrogates(adfToPlainText(f.description).slice(0, 5000)) || null,
        type: 'bug' as const,
        status: mapStatus(f.status?.name),
        priority: PRIORITY_TO_P[priorityName] || null,
        assignee: f.assignee?.displayName || null,
        labels: f.labels || [],
        source: 'jira' as const,
        jira_status: f.status?.name || null,
        jira_created_at: f.created || null,
        jira_updated_at: f.updated || null,
        reporter: 'jira-sync',
      }
    })
  }

  try {
    // Fetch both spaces in parallel — YSDT ticket keys are YSDT-xxx so there's no
    // conflict with YSC-xxx keys in the unique ticket_key column.
    const [yscIssues, ysdtIssues] = await Promise.all([
      searchJiraJqlAll(`project = ${SPACE_YSC} ORDER BY updated DESC`, FIELDS),
      searchJiraJqlAll(`project = ${SPACE_YSDT} ORDER BY updated DESC`, FIELDS),
    ])

    const rows = [...mapIssues(yscIssues), ...mapIssues(ysdtIssues)]

    if (rows.length === 0) {
      return NextResponse.json({ synced: 0, note: 'No issues returned from Jira — check project access / permissions.' })
    }

    const supabase = await createClient()
    // Conflict target is ticket_key, not jira_key: the table's original ticket_key unique
    // constraint fires on every re-sync too (Jira rows always set ticket_key = jira_key), and
    // Postgres can't reconcile two different unique constraints inside one upsert — targeting
    // jira_key here previously raised "duplicate key value violates ... ticket_key_key" (23505)
    // on the very first re-sync, once a ticket already existed from a prior sync.
    const { error } = await supabase.from('internal_tickets').upsert(rows, { onConflict: 'ticket_key' })
    if (error) throw error

    return NextResponse.json({ synced: rows.length, ysc: yscIssues.length, ysdt: ysdtIssues.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-tickets] error:', msg, err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
