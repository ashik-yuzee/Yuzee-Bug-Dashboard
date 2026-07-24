import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { checkAuth } from '@/lib/apiAuth'

const JIRA_BASE  = process.env.JIRA_BASE_URL  || 'https://yuzeeau.atlassian.net'
const JIRA_EMAIL = process.env.JIRA_EMAIL     || ''
const JIRA_KEY   = process.env.JIRA_API_KEY   || ''
const SPACE_YSC  = process.env.JIRA_SPACE_YSC || 'YSC'

function basicAuth() {
  return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_KEY}`).toString('base64')
}

const jiraHeaders = () => ({
  Authorization: basicAuth(),
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

const priorityMap: Record<string, string> = {
  P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low',
}

// POST /api/jira/retry
// Body (optional): { reportId: string }  → retry single bug
// Body empty / omitted              → retry ALL jira_pending bugs
export async function POST(req: NextRequest) {
  const authError = await checkAuth()
  if (authError) return authError
  if (!JIRA_KEY) return NextResponse.json({ error: 'Jira not configured' }, { status: 503 })

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) },
      },
    }
  )

  // Determine which bugs to retry
  let body: { reportId?: string } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  let query = supabase.from('bug_reports').select('*').eq('jira_pending', true).is('jira_key', null)
  if (body.reportId) query = query.eq('report_id', body.reportId) as typeof query

  const { data: bugs, error: fetchErr } = await query.limit(50)
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!bugs?.length) return NextResponse.json({ retried: 0, succeeded: 0, failed: 0, results: [] })

  const results: { reportId: string; success: boolean; jiraKey?: string; error?: string }[] = []

  for (const bug of bugs) {
    try {
      // Build Jira ticket payload from the bug record
      const severity  = bug.severity ?? 'P3'
      const component = bug.component ?? 'Unknown'
      const platform  = bug.platform ?? ''
      const env       = bug.environment ?? 'production'
      const routingToken = bug.category?.includes('backend') ? 'BACKEND'
        : bug.category?.includes('mobile') ? 'MOBILE'
        : ['ios', 'android'].includes(platform.toLowerCase()) ? 'MOBILE'
        : platform === 'Linux' ? 'BACKEND'
        : 'WEB'

      const summary = `[${severity}][${routingToken}] ${
        bug.rollbar_id ? `[#${bug.rollbar_id}] ` : ''
      }${(bug.description ?? 'Bug report').slice(0, 200)}`

      const descText = [
        bug.ai_summary   ? `AI Summary: ${bug.ai_summary}` : null,
        bug.description  ? `Description: ${bug.description}` : null,
        `Report ID: ${bug.report_id}`,
        `Source: ${bug.source ?? 'unknown'}`,
        `Platform: ${platform || 'unknown'}  |  Environment: ${env}`,
        `Component: ${component}  |  Severity: ${severity}`,
        bug.correlation_id ? `Correlation ID: ${bug.correlation_id}` : null,
        bug.rollbar_id ? `Rollbar: https://rollbar.com/yuzee/${bug.rollbar_project_id === '782547' ? 'NewYuzeeApp' : 'YuzeeWebRollbar'}/items/${bug.rollbar_id}/` : null,
      ].filter(Boolean).join('\n\n')

      const payload = {
        fields: {
          project:   { key: SPACE_YSC },
          issuetype: { name: 'Bug' },
          summary:   summary.slice(0, 255),
          priority:  { name: priorityMap[severity] ?? 'Medium' },
          description: {
            type: 'doc', version: 1,
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: descText }] },
            ],
          },
          labels: ['yuzee-bug-dashboard', component.toLowerCase(), severity.toLowerCase()].filter(Boolean),
        },
      }

      const jiraRes = await fetch(`${JIRA_BASE}/rest/api/3/issue`, {
        method: 'POST',
        headers: jiraHeaders(),
        body: JSON.stringify(payload),
      })

      if (!jiraRes.ok) {
        const txt = await jiraRes.text()
        results.push({ reportId: bug.report_id, success: false, error: `Jira ${jiraRes.status}: ${txt.slice(0, 200)}` })
        continue
      }

      const jiraData = await jiraRes.json()
      const jiraKey = jiraData.key as string

      // Write the new jira_key back to Supabase and clear jira_pending
      const { error: updateErr } = await supabase
        .from('bug_reports')
        .update({ jira_key: jiraKey, jira_pending: null })
        .eq('report_id', bug.report_id)

      if (updateErr) {
        results.push({ reportId: bug.report_id, success: false, error: `Jira ticket created (${jiraKey}) but Supabase update failed: ${updateErr.message}` })
      } else {
        results.push({ reportId: bug.report_id, success: true, jiraKey })
      }
    } catch (err) {
      results.push({ reportId: bug.report_id, success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed    = results.filter(r => !r.success).length

  return NextResponse.json({ retried: bugs.length, succeeded, failed, results })
}
