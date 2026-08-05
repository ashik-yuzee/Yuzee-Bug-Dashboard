import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

interface AnomalyPayload {
  monitor_id: string
  monitor_name: string
  monitor_target: string
  checked_at: string
  anomaly_type: 'spike' | 'down'
  response_time_ms: number | null
  avg_ms: number | null
  spike_ratio: number | null
  error_class: string | null
  error_message: string | null
  status_code: number | null
  cloudwatch_url: string | null
}

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (c) => { c.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } } }
  )
}

export async function POST(req: NextRequest) {
  const anomalies: AnomalyPayload[] = await req.json()
  console.log('[anomaly-api] POST called, incoming anomalies:', anomalies?.length ?? 0)
  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  // 30-day retention cleanup (fire-and-forget)
  supabase.from('monitor_anomalies')
    .delete()
    .lt('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .then(() => {})

  if (anomalies?.length) {
    // 30-min cooldown per monitor — don't flood DB with repeated anomalies for ongoing incidents
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data: recentRows } = await supabase
      .from('monitor_anomalies')
      .select('monitor_id')
      .gte('checked_at', thirtyMinAgo)
    const coolingDown = new Set((recentRows ?? []).map((r: { monitor_id: string }) => r.monitor_id))
    const toInsert = anomalies.filter(a => !coolingDown.has(a.monitor_id))

    if (toInsert.length) {
      await supabase
        .from('monitor_anomalies')
        .upsert(toInsert, { onConflict: 'monitor_id,checked_at', ignoreDuplicates: true })
    }
  }

  // Drain the pending backlog — table is already curated (5× threshold, 30-min cooldown), analyze all
  const { data: pending } = await supabase
    .from('monitor_anomalies')
    .select('id, monitor_name, monitor_target, anomaly_type, response_time_ms, avg_ms, spike_ratio, error_class, error_message, status_code')
    .is('ai_analysis', null)
    .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(15)

  let analyzed = 0
  let tokensUsed = 0
  let rateLimitResetMs: number | null = null
  for (const row of (pending ?? [])) {
    const result = await analyzeAnomaly(row)
    if (result && 'rateLimited' in result) { rateLimitResetMs = result.resetMs; break }  // stop immediately
    if (result && 'text' in result) {
      await supabase.from('monitor_anomalies').update({ ai_analysis: result.text }).eq('id', row.id)
      analyzed++
      tokensUsed += result.tokens
    }
  }

  return NextResponse.json({ upserted: anomalies?.length ?? 0, analyzed, tokensUsed, rateLimitResetMs })
}

// GET /api/anomalies?days=30 — read stored anomalies for the Anomalies tab
export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data, error } = await supabase
    .from('monitor_anomalies')
    .select('*')
    .gte('created_at', since)
    .order('checked_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

async function analyzeAnomaly(anomaly: {
  monitor_name: string; monitor_target: string; anomaly_type: string
  response_time_ms: number | null; avg_ms: number | null; spike_ratio: number | null
  error_class: string | null; error_message: string | null; status_code: number | null
}): Promise<{ text: string; tokens: number } | { rateLimited: true; resetMs: number } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const lines = [
    'You are a backend reliability engineer. Analyze this server monitor anomaly and give a 1-2 sentence technical diagnosis of the most likely cause.',
    '',
    `Monitor: ${anomaly.monitor_name} (${anomaly.monitor_target})`,
    `Type: ${anomaly.anomaly_type}`,
    anomaly.response_time_ms != null
      ? `Response: ${anomaly.response_time_ms}ms (baseline avg: ${anomaly.avg_ms ?? '?'}ms, ${anomaly.spike_ratio?.toFixed(1) ?? '?'}× normal)`
      : '',
    anomaly.status_code != null ? `HTTP status: ${anomaly.status_code}` : '',
    anomaly.error_class        ? `Error class: ${anomaly.error_class}` : '',
    anomaly.error_message      ? `Error message: ${anomaly.error_message}` : '',
    '',
    'Reply with only the diagnosis, no preamble or labels.',
  ].filter(Boolean)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yuzee.com',
        'X-Title': 'Yuzee Bug Monitor',
      },
      body: JSON.stringify({
        model: 'google/gemma-4-26b-a4b-it:free',
        messages: [{ role: 'user', content: lines.join('\n') }],
        max_tokens: 120,
        temperature: 0.3,
      }),
    })
    if (res.status === 429) {
      const resetMs = parseInt(res.headers.get('X-RateLimit-Reset') ?? '0', 10) || null
      console.warn('[anomaly-ai] Rate limited — resets at', resetMs ? new Date(resetMs).toISOString() : 'unknown')
      return { rateLimited: true, resetMs: resetMs ?? 0 }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '(unreadable)')
      console.error(`[anomaly-ai] OpenRouter ${res.status}:`, errText)
      return null
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? null
    if (!text) return null
    // Free models often return usage: 0 — estimate from character counts (÷4 ≈ tokens)
    const prompt = lines.join('\n')
    const estimated = Math.ceil(prompt.length / 4) + Math.ceil(text.length / 4)
    return { text, tokens: data.usage?.total_tokens || estimated }
  } catch {
    return null
  }
}
