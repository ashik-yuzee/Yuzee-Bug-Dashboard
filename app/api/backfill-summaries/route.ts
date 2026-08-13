import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase/server'
import type { BugReport } from '@/components/DashboardClient'

const GEMINI_KEY = process.env.GEMINI_API_KEY_SERVER || ''
const BATCH_SIZE = 5       // bugs per call — keeps route under ~25s total
const RATE_DELAY_MS = 4200 // gap between Gemini calls → ~14 RPM, safely under 15 RPM free tier

function buildPrompt(bug: BugReport): string {
  const lines = [
    'You are a senior software engineer reviewing a bug report.',
    'Write exactly 2 sentences as a developer-facing summary:',
    '  Sentence 1: What technically failed (the error, component, or operation).',
    '  Sentence 2: What the likely user impact is or what triggered it.',
    'Plain text only. No markdown. No bullet points. 60 words maximum.',
    '',
    `Description: ${(bug.description || '(none)').slice(0, 400)}`,
  ]
  if (bug.severity)                              lines.push(`Severity: ${bug.severity}`)
  if (bug.component && bug.component !== 'Unknown') lines.push(`Component: ${bug.component}`)
  if (bug.category)                              lines.push(`Category: ${bug.category}`)
  if (bug.platform)                              lines.push(`Platform: ${bug.platform}`)
  if (bug.environment)                           lines.push(`Environment: ${bug.environment}`)
  return lines.join('\n')
}

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
        }),
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim() || null
  } catch {
    return null
  }
}

/**
 * POST /api/backfill-summaries
 * Processes the next BATCH_SIZE bugs with no ai_summary, calling Gemini sequentially
 * with a RATE_DELAY_MS gap to stay within the 15 RPM free-tier limit.
 * Returns { processed, failed, remaining } — call in a loop until remaining = 0.
 */
export async function POST() {
  const denied = await checkAuth()
  if (denied) return denied

  if (!GEMINI_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY_SERVER not configured' }, { status: 503 })
  }

  const supabase = await createClient()

  const { data: bugs, error } = await supabase
    .from('bug_reports')
    .select('report_id, description, severity, component, category, platform, environment, source')
    .is('ai_summary', null)
    .or('is_duplicate.is.null,is_duplicate.eq.false')
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!bugs || bugs.length === 0) return NextResponse.json({ processed: 0, failed: 0, remaining: 0 })

  let processed = 0
  let failed = 0

  for (let i = 0; i < bugs.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, RATE_DELAY_MS))

    const bug = bugs[i] as BugReport
    const summary = await callGemini(buildPrompt(bug))

    if (!summary) {
      failed++
      continue
    }

    const { error: upErr } = await supabase
      .from('bug_reports')
      .update({ ai_summary: summary })
      .eq('report_id', bug.report_id)

    if (upErr) failed++
    else processed++
  }

  const { count: remaining } = await supabase
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .is('ai_summary', null)
    .or('is_duplicate.is.null,is_duplicate.eq.false')

  return NextResponse.json({ processed, failed, remaining: remaining ?? 0 })
}
